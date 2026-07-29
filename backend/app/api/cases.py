from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http_status
from fastapi.responses import Response

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
    CaseBatchCreate,
    CaseBatchRunRead,
    CaseBulkRefreshResponse,
    CaseCreate,
    CaseDetail,
    CaseEvidenceRead,
    CaseNoteCreate,
    CaseNoteRead,
    CaseRefreshResponse,
    CaseSummary,
    CaseUpdate,
    TimelineEventUpdate,
)
from app.services import case_batch_service, cases_service

router = APIRouter(prefix="/api", tags=["cases"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

DeleteCasesScope = Literal["all", "open", "closed"]


@router.post("/cases", response_model=CaseDetail, status_code=http_status.HTTP_201_CREATED)
async def create_case(payload: CaseCreate, pool: PoolDep) -> CaseDetail:
    return await cases_service.create_case(
        pool,
        title=payload.title,
        seed_type=payload.seed_type,
        seed_value=payload.seed_value,
        case_type=payload.case_type,
    )


@router.get("/cases", response_model=list[CaseSummary])
async def list_cases(pool: PoolDep, limit: int = Query(default=50, ge=1, le=200)) -> list[CaseSummary]:
    return await cases_service.list_cases(pool, limit)


@router.post("/cases/batch-create", response_model=CaseBatchRunRead, status_code=http_status.HTTP_201_CREATED)
async def start_case_batch(
    payload: CaseBatchCreate, pool: PoolDep, background_tasks: BackgroundTasks
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
        )
    except case_batch_service.MailboxRequiredForSearchError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    background_tasks.add_task(case_batch_service.run_batch, pool, batch.batch_run_id)
    return batch


@router.get("/cases/batch-create/latest", response_model=CaseBatchRunRead | None)
async def get_latest_case_batch(pool: PoolDep) -> CaseBatchRunRead | None:
    return await case_batch_service.get_latest_batch(pool)


@router.get("/cases/batch-create/{batch_run_id}", response_model=CaseBatchRunRead)
async def get_case_batch(batch_run_id: UUID, pool: PoolDep) -> CaseBatchRunRead:
    batch = await case_batch_service.get_batch(pool, batch_run_id)
    if batch is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Corrida en lote no encontrada")
    return batch


@router.post("/cases/refresh-open", response_model=CaseBulkRefreshResponse)
async def refresh_open_cases(pool: PoolDep) -> CaseBulkRefreshResponse:
    """Re-correlaciona todos los expedientes abiertos contra lo ya indexado --
    util cuando otro trabajo (sin pasar por un expediente puntual) trajo
    correos que podrian corresponder a alguno ya existente."""
    result = await cases_service.refresh_all_open_cases(pool)
    return CaseBulkRefreshResponse(**result)


@router.delete("/cases", status_code=http_status.HTTP_200_OK)
async def delete_cases(pool: PoolDep, scope: DeleteCasesScope = Query(...)) -> dict[str, int]:
    deleted = await cases_service.delete_cases(pool, scope)
    return {"deleted": deleted}


@router.delete("/cases/{case_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: int, pool: PoolDep) -> None:
    deleted = await cases_service.delete_case(pool, case_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")


@router.get("/cases/{case_id}", response_model=CaseDetail)
async def get_case(case_id: int, pool: PoolDep) -> CaseDetail:
    case = await cases_service.get_case_detail(pool, case_id)
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.get("/cases/{case_id}/chart")
async def get_case_chart(
    case_id: int, pool: PoolDep, chart_type: Literal["timeline", "histogram"] = Query(default="timeline")
) -> Response:
    """Grafico (linea de tiempo o histograma) de la actividad de ESTE expediente
    puntual -- a diferencia de "Generar graficos" en Trabajos, que agrega todo
    el buzon. Es agregacion pura sobre datos ya indexados, no llama a Graph ni
    pasa por n8n (mismo criterio ya usado para la correlacion de casos)."""
    case = await cases_repository.get_case_core(pool, case_id)
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
async def update_case(case_id: int, payload: CaseUpdate, pool: PoolDep) -> CaseDetail:
    try:
        case = await cases_service.update_case(pool, case_id, fields=payload.model_dump(exclude_unset=True))
    except (cases_service.CaseClosedError, cases_service.CaseNotEligibleForAIError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/notes", response_model=CaseNoteRead, status_code=http_status.HTTP_201_CREATED)
async def add_case_note(case_id: int, payload: CaseNoteCreate, pool: PoolDep) -> CaseNoteRead:
    try:
        note = await cases_service.add_case_note(pool, case_id, payload.body)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if note is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return note


@router.post("/cases/{case_id}/evidence", response_model=CaseEvidenceRead, status_code=http_status.HTTP_201_CREATED)
async def add_case_evidence(
    case_id: int,
    pool: PoolDep,
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
        )
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
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
async def get_case_evidence_content(case_id: int, evidence_id: int, pool: PoolDep) -> Response:
    record = await cases_service.get_case_evidence_content(pool, case_id, evidence_id)
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Evidencia no encontrada")
    return Response(
        content=record["content"],
        media_type=record["content_type"],
        headers={"Content-Disposition": f'inline; filename="{record["file_name"]}"'},
    )


@router.patch("/cases/{case_id}/ai-summary", response_model=CaseDetail)
async def update_case_ai_summary(case_id: int, payload: CaseAiSummaryUpdate, pool: PoolDep) -> CaseDetail:
    case = await cases_service.update_ai_summary(pool, case_id, payload.summary)
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/refresh", response_model=CaseRefreshResponse)
async def refresh_case(case_id: int, pool: PoolDep) -> CaseRefreshResponse:
    try:
        result = await cases_service.refresh_case_correlation(pool, case_id)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    case, new_messages_found = result
    return CaseRefreshResponse(case=case, new_messages_found=new_messages_found)


@router.post("/cases/{case_id}/messages", response_model=CaseDetail)
async def add_case_message(case_id: int, payload: CaseAddMessage, pool: PoolDep) -> CaseDetail:
    try:
        case = await cases_service.add_message_to_case(pool, case_id, payload.message_id)
    except cases_service.MessageNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"El mensaje {payload.message_id} no está indexado todavía.",
        ) from exc
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.post("/cases/{case_id}/messages/remove", response_model=CaseDetail)
async def remove_case_message(case_id: int, payload: CaseAddMessage, pool: PoolDep) -> CaseDetail:
    try:
        case = await cases_service.remove_message_from_case(pool, case_id, payload.message_id)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    return case


@router.patch("/timeline-events/{event_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def update_timeline_event(event_id: int, payload: TimelineEventUpdate, pool: PoolDep) -> None:
    try:
        updated = await cases_service.update_timeline_event(pool, event_id, payload.determination_type)
    except cases_service.CaseClosedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Evento no encontrado")
