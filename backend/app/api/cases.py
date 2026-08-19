from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http_status
from fastapi.responses import Response

from app.auth.dependencies import AdminUserDep, CurrentUserDep
from app.charts import (
    HistogramBucket,
    HistogramRequest,
    TimelinePoint,
    TimelineRequest,
)
from app.charts import histogram as render_histogram
from app.charts import timeline as render_timeline
from app.db import get_pool
from app.repositories import cases_repository
from app.schemas.cases import (
    CaseAddMessage,
    CaseAiSummaryUpdate,
    CaseAuditLogRead,
    CaseBatchCreate,
    CaseBatchRunRead,
    CaseBulkRefreshResponse,
    CaseBulkRemoveMessages,
    CaseCreate,
    CaseDashboardStats,
    CaseDetail,
    CaseEvidenceRead,
    CaseMergeRequest,
    CaseMessageRead,
    CaseMessageSearchRequest,
    CaseNoteCreate,
    CaseNoteUpdate,
    CaseOwnerReassignRequest,
    CaseNoteRead,
    CaseRefreshResponse,
    CaseShareCreate,
    CaseShareRead,
    CaseSummary,
    CaseUpdate,
    ExclusionRuleCreate,
    ExclusionRuleRead,
    ExclusionRuleUpdate,
    TimelineEventUpdate,
)
from app.services import case_batch_service, cases_service

router = APIRouter(prefix="/api", tags=["cases"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

DeleteCasesScope = Literal["all", "open", "closed"]


def _forbidden(exc: Exception) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post("/cases", response_model=CaseDetail, status_code=http_status.HTTP_201_CREATED)
async def create_case(payload: CaseCreate, pool: PoolDep, user: CurrentUserDep) -> CaseDetail:
    return await cases_service.create_case(
        pool,
        title=payload.title,
        seed_type=payload.seed_type,
        seed_value=payload.seed_value,
        case_type=payload.case_type,
        user=user,
    )


@router.post("/cases/merge", response_model=CaseDetail, status_code=http_status.HTTP_201_CREATED)
async def merge_cases(payload: CaseMergeRequest, pool: PoolDep, user: CurrentUserDep) -> CaseDetail:
    try:
        return await cases_service.merge_cases(
            pool, case_ids=payload.case_ids, title=payload.title, user=user
        )
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    except cases_service.MergeRequiresMultipleCasesError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/cases", response_model=list[CaseSummary])
async def list_cases(
    pool: PoolDep, user: CurrentUserDep, limit: int = Query(default=50, ge=1, le=200)
) -> list[CaseSummary]:
    return await cases_service.list_cases(pool, limit, user=user)


@router.post("/cases/batch-create", response_model=CaseBatchRunRead, status_code=http_status.HTTP_201_CREATED)
async def start_case_batch(
    payload: CaseBatchCreate, pool: PoolDep, user: CurrentUserDep, background_tasks: BackgroundTasks
) -> CaseBatchRunRead:
    try:
        batch = await case_batch_service.start_batch(
            pool,
            keywords=payload.keywords,
            case_type=payload.case_type,
            search_mailbox=payload.search_mailbox,
            mailbox_account_id=payload.mailbox_account_id,
            date_from=payload.date_from,
            date_to=payload.date_to,
            user=user,
        )
    except case_batch_service.MailboxRequiredForSearchError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except case_batch_service.MailboxNotAccessibleError as exc:
        raise _forbidden(exc) from exc
    background_tasks.add_task(case_batch_service.run_batch, pool, batch.batch_run_id)
    return batch


@router.get("/cases/batch-create/latest", response_model=CaseBatchRunRead | None)
async def get_latest_case_batch(pool: PoolDep, user: CurrentUserDep) -> CaseBatchRunRead | None:
    return await case_batch_service.get_latest_batch(pool, user=user)


@router.get("/cases/batch-create/{batch_run_id}", response_model=CaseBatchRunRead)
async def get_case_batch(batch_run_id: UUID, pool: PoolDep, user: CurrentUserDep) -> CaseBatchRunRead:
    batch = await case_batch_service.get_batch(pool, batch_run_id, user=user)
    if batch is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Corrida en lote no encontrada")
    return batch


@router.post("/cases/refresh-open", response_model=CaseBulkRefreshResponse)
async def refresh_open_cases(pool: PoolDep, user: CurrentUserDep) -> CaseBulkRefreshResponse:
    """Re-correlaciona todos los expedientes abiertos (a los que el usuario
    tiene acceso) contra lo ya indexado -- util cuando otro trabajo (sin
    pasar por un expediente puntual) trajo correos que podrian corresponder
    a alguno ya existente. De paso escanea (sin modificar) los expedientes
    cerrados y marca cuales tienen correos nuevos pendientes."""
    result = await cases_service.refresh_all_cases(pool, user=user)
    return CaseBulkRefreshResponse(**result)


@router.delete("/cases", status_code=http_status.HTTP_200_OK)
async def delete_cases(pool: PoolDep, user: CurrentUserDep, scope: DeleteCasesScope = Query(...)) -> dict[str, int]:
    deleted = await cases_service.delete_cases(pool, scope, user=user)
    return {"deleted": deleted}


@router.delete("/cases/{case_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: int, pool: PoolDep, user: CurrentUserDep) -> None:
    deleted = await cases_service.delete_case(pool, case_id, user=user)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")


@router.get("/cases/dashboard/stats", response_model=CaseDashboardStats)
async def get_cases_dashboard_stats(pool: PoolDep, user: CurrentUserDep) -> CaseDashboardStats:
    return await cases_service.get_dashboard_stats(pool, user=user)


@router.get("/cases/dashboard/by-outcome", response_model=list[CaseSummary])
async def get_cases_by_outcome(pool: PoolDep, user: CurrentUserDep, outcome: str = Query(...)) -> list[CaseSummary]:
    return await cases_service.list_cases_by_outcome(pool, outcome=outcome, user=user)


@router.get("/cases/exclusion-rules", response_model=list[ExclusionRuleRead])
async def list_global_exclusion_rules(pool: PoolDep, user: CurrentUserDep) -> list[ExclusionRuleRead]:
    """Reglas globales del propio usuario -- alcance estrictamente personal,
    nunca las de otro usuario (ver cases_service.list_exclusion_rules)."""
    rules = await cases_service.list_exclusion_rules(pool, case_id=None, user=user)
    return rules or []


@router.post("/cases/exclusion-rules", response_model=ExclusionRuleRead, status_code=http_status.HTTP_201_CREATED)
async def create_global_exclusion_rule(
    payload: ExclusionRuleCreate, pool: PoolDep, user: CurrentUserDep
) -> ExclusionRuleRead:
    rule = await cases_service.create_exclusion_rule(
        pool, case_id=None, pattern=payload.pattern, fields=payload.model_dump(exclude={"pattern"}), user=user
    )
    assert rule is not None  # case_id=None nunca devuelve None (no hay caso que buscar)
    return rule


@router.patch("/cases/exclusion-rules/{rule_id}", response_model=ExclusionRuleRead)
async def update_exclusion_rule(
    rule_id: int, payload: ExclusionRuleUpdate, pool: PoolDep, user: CurrentUserDep
) -> ExclusionRuleRead:
    try:
        rule = await cases_service.update_exclusion_rule(
            pool, rule_id, fields=payload.model_dump(exclude_unset=True), user=user
        )
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if rule is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    return rule


@router.delete("/cases/exclusion-rules/{rule_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_exclusion_rule(rule_id: int, pool: PoolDep, user: CurrentUserDep) -> None:
    try:
        deleted = await cases_service.delete_exclusion_rule(pool, rule_id, user=user)
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")


@router.get("/cases/{case_id}", response_model=CaseDetail)
async def get_case(case_id: int, pool: PoolDep, user: CurrentUserDep) -> CaseDetail:
    case = await cases_service.get_case_detail(pool, case_id, user=user)
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.get("/cases/{case_id}/chart")
async def get_case_chart(
    case_id: int,
    pool: PoolDep,
    user: CurrentUserDep,
    chart_type: Literal["timeline", "histogram"] = Query(default="timeline"),
) -> Response:
    """Grafico (linea de tiempo o histograma) de la actividad de ESTE expediente
    puntual -- a diferencia de "Generar graficos" en Trabajos, que agrega todo
    el buzon. Es agregacion pura sobre datos ya indexados, no llama a Graph ni
    pasa por n8n (mismo criterio ya usado para la correlacion de casos)."""
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")

    if chart_type == "timeline":
        rows = await cases_repository.get_case_activity_by_day(pool, case_id)
        points = [TimelinePoint(date=r["day"].isoformat(), count=r["message_count"]) for r in rows]
        return render_timeline(
            TimelineRequest(points=points, title=f"Actividad del expediente — {case['title']}")
        )

    rows = await cases_repository.get_case_activity_by_sender(pool, case_id)
    buckets = [HistogramBucket(label=r["label"], count=r["message_count"]) for r in rows]
    return render_histogram(
        HistogramRequest(buckets=buckets, title=f"Correos del expediente por remitente — {case['title']}")
    )


@router.patch("/cases/{case_id}", response_model=CaseDetail)
async def update_case(case_id: int, payload: CaseUpdate, pool: PoolDep, user: CurrentUserDep) -> CaseDetail:
    fields = payload.model_dump(exclude_unset=True, exclude={"expected_updated_at"})
    try:
        case = await cases_service.update_case(
            pool, case_id, fields=fields, user=user, expected_updated_at=payload.expected_updated_at
        )
    except (cases_service.CaseClosedError, cases_service.CaseNotEligibleForAIError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.ClosingGlosaRequiredError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    except cases_service.CaseUpdateConflictError as exc:
        # 412 (no 409): distinto de CaseClosedError/CaseNotEligibleForAIError
        # arriba -- el frontend necesita poder distinguir "conflicto de
        # edicion concurrente" (bloqueo optimista) de "el expediente esta
        # cerrado" para saber si mostrar el modal de recargar o no.
        raise HTTPException(status_code=http_status.HTTP_412_PRECONDITION_FAILED, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.patch("/cases/{case_id}/owner", response_model=CaseDetail)
async def reassign_case_owner(
    case_id: int, payload: CaseOwnerReassignRequest, pool: PoolDep, admin: AdminUserDep
) -> CaseDetail:
    """Reasignación manual de dueño -- admin-only, distinta de compartir
    (que puede hacerla el dueño). Pensada sobre todo para corregir expedientes
    que quedaron con previous_owner_label tras eliminar un usuario."""
    try:
        case = await cases_service.reassign_case_owner(
            pool, case_id, new_owner_user_id=payload.new_owner_user_id, admin=admin
        )
    except cases_service.TargetUserNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.get("/cases/{case_id}/audit-log", response_model=list[CaseAuditLogRead])
async def get_case_audit_log(case_id: int, pool: PoolDep, user: CurrentUserDep) -> list[CaseAuditLogRead]:
    entries = await cases_service.list_case_audit_log(pool, case_id, user=user)
    if entries is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return entries


@router.post("/cases/{case_id}/notes", response_model=CaseNoteRead, status_code=http_status.HTTP_201_CREATED)
async def add_case_note(case_id: int, payload: CaseNoteCreate, pool: PoolDep, user: CurrentUserDep) -> CaseNoteRead:
    try:
        note = await cases_service.add_case_note(pool, case_id, payload.body, user=user)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if note is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return note


@router.patch("/cases/{case_id}/notes/{note_id}", response_model=CaseNoteRead)
async def update_case_note(
    case_id: int, note_id: int, payload: CaseNoteUpdate, pool: PoolDep, user: CurrentUserDep
) -> CaseNoteRead:
    try:
        note = await cases_service.update_case_note(pool, case_id, note_id, payload.body, user=user)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    except cases_service.NoteNotEditableError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if note is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso o nota no encontrados")
    return note


@router.post("/cases/{case_id}/evidence", response_model=CaseEvidenceRead, status_code=http_status.HTTP_201_CREATED)
async def add_case_evidence(
    case_id: int,
    pool: PoolDep,
    user: CurrentUserDep,
    glosa: Annotated[str, Form(min_length=1)],
    file: Annotated[UploadFile, File()],
) -> CaseEvidenceRead:
    content = await file.read()
    try:
        evidence = await cases_service.add_case_evidence(
            pool,
            case_id,
            glosa=glosa,
            file_name=file.filename or "evidencia",
            content_type=file.content_type or "application/octet-stream",
            content=content,
            user=user,
        )
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    except cases_service.UnsupportedEvidenceTypeError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Tipo de archivo no soportado: {exc}. Solo se aceptan imágenes (PNG, JPEG, GIF, WEBP).",
        ) from exc
    except cases_service.EvidenceTooLargeError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen supera el tamaño máximo permitido (10 MB).",
        ) from exc
    if evidence is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return evidence


@router.get("/cases/{case_id}/evidence/{evidence_id}/content")
async def get_case_evidence_content(case_id: int, evidence_id: int, pool: PoolDep, user: CurrentUserDep) -> Response:
    record = await cases_service.get_case_evidence_content(pool, case_id, evidence_id, user=user)
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Evidencia no encontrada")
    return Response(
        content=record["content"],
        media_type=record["content_type"],
        headers={"Content-Disposition": f'inline; filename="{record["file_name"]}"'},
    )


@router.patch("/cases/{case_id}/ai-summary", response_model=CaseDetail)
async def update_case_ai_summary(
    case_id: int, payload: CaseAiSummaryUpdate, pool: PoolDep, user: CurrentUserDep
) -> CaseDetail:
    try:
        case = await cases_service.update_ai_summary(
            pool, case_id, payload.summary, user=user, expected_updated_at=payload.expected_updated_at
        )
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    except cases_service.CaseUpdateConflictError as exc:
        raise HTTPException(status_code=http_status.HTTP_412_PRECONDITION_FAILED, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/refresh", response_model=CaseRefreshResponse)
async def refresh_case(case_id: int, pool: PoolDep, user: CurrentUserDep) -> CaseRefreshResponse:
    try:
        result = await cases_service.refresh_case_correlation(pool, case_id, user=user)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    case, new_messages_found = result
    return CaseRefreshResponse(case=case, new_messages_found=new_messages_found)


@router.post("/cases/{case_id}/reopen-with-new-messages", response_model=CaseRefreshResponse)
async def reopen_case_with_new_messages(case_id: int, pool: PoolDep, user: CurrentUserDep) -> CaseRefreshResponse:
    """Reabre un expediente cerrado marcado con correos nuevos pendientes
    (ver refresh_open_cases) y vincula esos correos de una vez."""
    try:
        result = await cases_service.reopen_case_with_new_messages(pool, case_id, user=user)
    except cases_service.CaseNotClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    case, new_messages_found = result
    return CaseRefreshResponse(case=case, new_messages_found=new_messages_found)


@router.post("/cases/{case_id}/messages", response_model=CaseDetail)
async def add_case_message(case_id: int, payload: CaseAddMessage, pool: PoolDep, user: CurrentUserDep) -> CaseDetail:
    try:
        case = await cases_service.add_message_to_case(pool, case_id, payload.message_id, user=user)
    except cases_service.MessageNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"El mensaje {payload.message_id} no está indexado todavía.",
        ) from exc
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/messages/remove", response_model=CaseDetail)
async def remove_case_message(
    case_id: int, payload: CaseAddMessage, pool: PoolDep, user: CurrentUserDep
) -> CaseDetail:
    try:
        case = await cases_service.remove_message_from_case(pool, case_id, payload.message_id, user=user)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/messages/search", response_model=list[CaseMessageRead])
async def search_case_messages(
    case_id: int, payload: CaseMessageSearchRequest, pool: PoolDep, user: CurrentUserDep
) -> list[CaseMessageRead]:
    """Busca texto libre en asunto/cuerpo SOLO entre los correos ya
    vinculados a este expediente -- pensado para encontrar candidatos a
    excluir en lote (ver bulk_remove_case_messages) antes de confirmar."""
    results = await cases_service.search_case_messages(pool, case_id, payload.query, user=user)
    if results is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return results


@router.post("/cases/{case_id}/messages/bulk-remove", response_model=CaseDetail)
async def bulk_remove_case_messages(
    case_id: int, payload: CaseBulkRemoveMessages, pool: PoolDep, user: CurrentUserDep
) -> CaseDetail:
    try:
        case = await cases_service.bulk_remove_messages_from_case(
            pool, case_id, payload.message_ids, query=payload.query, user=user
        )
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.get("/cases/{case_id}/exclusion-rules", response_model=list[ExclusionRuleRead])
async def list_case_exclusion_rules(case_id: int, pool: PoolDep, user: CurrentUserDep) -> list[ExclusionRuleRead]:
    rules = await cases_service.list_exclusion_rules(pool, case_id=case_id, user=user)
    if rules is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return rules


@router.post(
    "/cases/{case_id}/exclusion-rules", response_model=ExclusionRuleRead, status_code=http_status.HTTP_201_CREATED
)
async def create_case_exclusion_rule(
    case_id: int, payload: ExclusionRuleCreate, pool: PoolDep, user: CurrentUserDep
) -> ExclusionRuleRead:
    try:
        rule = await cases_service.create_exclusion_rule(
            pool, case_id=case_id, pattern=payload.pattern, fields=payload.model_dump(exclude={"pattern"}), user=user
        )
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if rule is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return rule


@router.get("/cases/{case_id}/shares", response_model=list[CaseShareRead])
async def list_case_shares(case_id: int, pool: PoolDep, user: CurrentUserDep) -> list[CaseShareRead]:
    shares = await cases_service.list_case_shares(pool, case_id, user=user)
    if shares is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return shares


@router.post("/cases/{case_id}/shares", response_model=CaseShareRead, status_code=http_status.HTTP_201_CREATED)
async def share_case(case_id: int, payload: CaseShareCreate, pool: PoolDep, user: CurrentUserDep) -> CaseShareRead:
    try:
        share = await cases_service.share_case(
            pool, case_id, target_user_id=payload.user_id, permission=payload.permission, user=user
        )
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if share is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return share


@router.delete("/cases/{case_id}/shares/{target_user_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def revoke_case_share(case_id: int, target_user_id: int, pool: PoolDep, user: CurrentUserDep) -> None:
    try:
        revoked = await cases_service.revoke_case_share(pool, case_id, target_user_id, user=user)
    except cases_service.CaseAccessDeniedError as exc:
        raise _forbidden(exc) from exc
    if not revoked:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Comparticion no encontrada")


@router.patch("/timeline-events/{event_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def update_timeline_event(
    event_id: int, payload: TimelineEventUpdate, pool: PoolDep, user: CurrentUserDep
) -> None:
    try:
        updated = await cases_service.update_timeline_event(pool, event_id, payload.determination_type, user=user)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Evento no encontrado")
