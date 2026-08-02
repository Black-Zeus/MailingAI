import json
import logging
import re
from datetime import datetime, timedelta, timezone

import asyncpg

from app.auth.dependencies import CurrentUser
from app.repositories import (
    access_repository,
    ai_runs_repository,
    cases_repository,
    notifications_repository,
    users_repository,
)
from app.services import email_templates, markdown_render, notification_email_service
from app.schemas.ai import AIAnalyzeResponse, AICaseSummary
from app.schemas.cases import (
    CaseAttachmentRead,
    CaseAuditLogRead,
    CaseDashboardStats,
    CaseDetail,
    CaseEvidenceRead,
    CaseMessageRead,
    CaseNoteRead,
    CaseShareRead,
    CaseSummary,
    TimelineEventRead,
)

logger = logging.getLogger(__name__)

_ALLOWED_EVIDENCE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024


class UnsupportedEvidenceTypeError(Exception):
    """El archivo subido como evidencia no es una imagen soportada."""


class EvidenceTooLargeError(Exception):
    """El archivo subido como evidencia supera el tamano maximo permitido."""

_REPLY_PREFIX_RE = re.compile(r"^\s*(re|rv|fwd?|fw)\s*:\s*", re.IGNORECASE)
_HEURISTIC_WINDOW = timedelta(days=30)

CONFIDENCE_CONVERSATION = 1.0
CONFIDENCE_CR_KEYWORD = 0.7
CONFIDENCE_HEURISTIC = 0.4


def _normalize_subject(subject: str | None) -> str:
    if not subject:
        return ""
    normalized = subject
    while True:
        stripped = _REPLY_PREFIX_RE.sub("", normalized)
        if stripped == normalized:
            break
        normalized = stripped
    return normalized.strip()


def _jsonb(value: object) -> list[str]:
    if isinstance(value, str):
        return json.loads(value)
    return list(value or [])


class CaseClosedError(Exception):
    """El expediente esta cerrado -- debe reabrirse antes de poder modificarlo."""


class CaseNotEligibleForAIError(Exception):
    """El expediente esta marcado 'sin_hallazgos' -- no admite analisis de IA ni cierre manual."""


class CaseAccessDeniedError(Exception):
    """El usuario tiene acceso de lectura al expediente (comparticion 'read')
    pero intento una operacion que requiere ser dueño, admin, o tener
    permiso 'edit'."""


class MergeRequiresMultipleCasesError(Exception):
    """Fusionar necesita al menos 2 expedientes distintos."""


class TargetUserNotFoundError(Exception):
    """El usuario al que se quiere reasignar el expediente no existe."""


class CaseUpdateConflictError(Exception):
    """Alguien mas guardo un cambio en el expediente entre que este cliente
    lo cargo y que intento guardar el suyo (bloqueo optimista via
    updated_at) -- el mensaje ya viene armado en español, listo para
    mostrarle al usuario tal cual."""


def _require_edit(case_core: asyncpg.Record) -> None:
    if not case_core["can_edit"]:
        raise CaseAccessDeniedError("No tiene permiso de edición sobre este expediente.")


def _mailbox_accessible(mailbox_account_id: int | None, accessible_mailbox_ids: list[int] | None) -> bool:
    """accessible_mailbox_ids None = admin, sin restriccion. mailbox_account_id
    None = mensaje sin buzon asociado (dato historico) -- se deja pasar, no
    hay nada que restringir ahi."""
    if accessible_mailbox_ids is None or mailbox_account_id is None:
        return True
    return mailbox_account_id in accessible_mailbox_ids


def _ensure_open(case_core: asyncpg.Record) -> None:
    if case_core["status"] == "closed":
        raise CaseClosedError(
            "El expediente esta cerrado. Debe reabrirse antes de poder modificarlo."
        )


async def _mark_ai_stale(pool: asyncpg.Pool, case_id: int) -> None:
    await cases_repository.update_case(pool, case_id, fields={"ai_stale": True})


_AUDIT_FIELD_LABELS = {
    "outcome": "la conclusión",
    "status": "el estado",
    "pending_action": "la acción pendiente",
    "next_review_at": "la próxima revisión",
}


def _audit_str(value: object) -> str | None:
    return None if value is None else str(value)


async def create_empty_case(
    pool: asyncpg.Pool,
    *,
    title: str,
    seed_value: str,
    case_type: str,
    user: CurrentUser,
) -> CaseDetail:
    """Crea el expediente sin correlacionar todavia (siempre seed_type
    "cr_keyword" -- conversation_id y message_id necesitan el mensaje semilla
    desde el principio para saber que expediente arman, asi que esos siguen
    usando create_case completo). Para flujos (como "Crear en lote") que
    separan visiblemente "crear" de "correlacionar contra lo indexado" en dos
    pasos. Llamar a refresh_case_correlation despues para completar la
    correlacion (funciona igual con external_code aunque el expediente no
    tenga primary_message_id todavia).
    """
    existing = await cases_repository.find_case_by_external_code(pool, seed_value)
    if existing is not None:
        detail = await get_case_detail(pool, existing["case_id"], user=user)
        if detail is not None:
            return detail
    case_record = await cases_repository.insert_case(
        pool,
        title=title,
        case_type=case_type,
        external_code=seed_value,
        primary_message_id=None,
        owner_user_id=user.user_id,
    )
    detail = await get_case_detail(pool, case_record["case_id"], user=user)
    assert detail is not None
    return detail


async def create_case(
    pool: asyncpg.Pool,
    *,
    title: str,
    seed_type: str,
    seed_value: str,
    case_type: str,
    user: CurrentUser,
) -> CaseDetail:
    accessible_mailbox_ids = await access_repository.resolve_accessible_mailbox_ids(pool, user)

    primary_message_id: str | None = None
    external_code: str | None = None
    seed_messages: list[asyncpg.Record] = []
    correlation_source_for_seed = "manual"

    if seed_type == "conversation_id":
        seed_messages = await cases_repository.find_messages_by_conversation(
            pool, seed_value, accessible_mailbox_ids=accessible_mailbox_ids
        )
        correlation_source_for_seed = "conversation_id"
        if seed_messages:
            primary_message_id = seed_messages[0]["message_id"]
    elif seed_type == "cr_keyword":
        seed_messages = await cases_repository.find_messages_by_cr_keyword(
            pool, seed_value, accessible_mailbox_ids=accessible_mailbox_ids
        )
        external_code = seed_value
        correlation_source_for_seed = "cr_keyword"
        if seed_messages:
            primary_message_id = seed_messages[0]["message_id"]
    elif seed_type == "message_id":
        message = await cases_repository.get_message_core(pool, seed_value)
        if message is not None and _mailbox_accessible(message["mailbox_account_id"], accessible_mailbox_ids):
            primary_message_id = message["message_id"]
            seed_messages = [message]
        correlation_source_for_seed = "manual"

    # Deduplicacion: primero por external_code (solo cr_keyword, clave exacta
    # del ticket/codigo), y si no hay nada por ahi, por titulo -- red de
    # respaldo para conversation_id/message_id, que no tienen ninguna clave
    # natural en comun con un expediente creado por otro seed_type para el
    # mismo tema (bug real: un expediente por palabra clave y otro por
    # conversation_id con el mismo titulo terminaban duplicados, porque uno
    # tiene external_code y el otro primary_message_id, nunca ambos).
    existing = None
    if external_code is not None:
        existing = await cases_repository.find_case_by_external_code(pool, external_code)
    if existing is None:
        existing = await cases_repository.find_open_case_by_title(pool, title)

    case_id: int | None = None
    preexisting_ids: set[str] = set()
    if existing is not None:
        try:
            refreshed = await refresh_case_correlation(pool, existing["case_id"], user=user)
        except (CaseClosedError, CaseAccessDeniedError):
            # Cerrado, o el usuario solo tiene lectura -- no se toca (mismo
            # criterio de inmutabilidad de siempre): se devuelve tal cual
            # esta, sin crear nada nuevo ni agregarle los mensajes de esta
            # busqueda.
            detail = await get_case_detail(pool, existing["case_id"], user=user)
            if detail is not None:
                return detail
        else:
            if refreshed is not None:
                # Acceso de edicion confirmado -- se reutiliza este
                # expediente: los mensajes de ESTA busqueda se agregan mas
                # abajo (mismo tramo que arma uno nuevo), en vez de
                # devolverlo sin los datos de la busqueda actual. Se guarda
                # que ya tiene ahora (incluido lo que refresh_case_correlation
                # acaba de agregar por su cuenta) para no volver a timelinear
                # esos mismos mensajes mas abajo.
                case_id = existing["case_id"]
                preexisting_ids = {
                    m["message_id"] for m in await cases_repository.list_case_messages(pool, case_id)
                }
            # refreshed is None: get_case_core no encontro nada visible para
            # este usuario (expediente ajeno, sin compartir) -- se sigue de
            # largo y se crea uno nuevo, como ya pasaba antes de este fix.

    if case_id is None:
        case_record = await cases_repository.insert_case(
            pool,
            title=title,
            case_type=case_type,
            external_code=external_code,
            primary_message_id=primary_message_id,
            owner_user_id=user.user_id,
        )
        case_id = case_record["case_id"]

    matched_ids: set[str] = set()

    for message in seed_messages:
        confidence = (
            CONFIDENCE_CONVERSATION
            if correlation_source_for_seed == "conversation_id"
            else CONFIDENCE_CR_KEYWORD
            if correlation_source_for_seed == "cr_keyword"
            else 1.0
        )
        relationship = "primary" if message["message_id"] == primary_message_id else "related"
        await cases_repository.insert_case_message(
            pool,
            case_id=case_id,
            message_id=message["message_id"],
            relationship_type=relationship,
            confidence=confidence,
            correlation_source=correlation_source_for_seed,
        )
        matched_ids.add(message["message_id"])

    if primary_message_id is not None:
        seed_core = await cases_repository.get_message_core(pool, primary_message_id)
        if seed_core is not None:
            normalized_subject = _normalize_subject(seed_core["subject"])
            participants = list(
                {
                    *(a for a in [seed_core["from_address"]] if a),
                    *_jsonb(seed_core["to_addresses"]),
                    *_jsonb(seed_core["cc_addresses"]),
                }
            )
            sent_dt = seed_core["sent_datetime"]
            date_from = sent_dt - _HEURISTIC_WINDOW if sent_dt else None
            date_to = sent_dt + _HEURISTIC_WINDOW if sent_dt else None
            heuristic_matches = await cases_repository.find_heuristic_related(
                pool,
                exclude_message_id=primary_message_id,
                normalized_subject=normalized_subject,
                participants=participants,
                date_from=date_from,
                date_to=date_to,
                accessible_mailbox_ids=accessible_mailbox_ids,
            )
            for message in heuristic_matches:
                if message["message_id"] in matched_ids:
                    continue
                await cases_repository.insert_case_message(
                    pool,
                    case_id=case_id,
                    message_id=message["message_id"],
                    relationship_type="related",
                    confidence=CONFIDENCE_HEURISTIC,
                    correlation_source="heuristic",
                )
                matched_ids.add(message["message_id"])

    # Solo los mensajes que ESTA llamada agrego de verdad -- ni los que el
    # expediente ya tenia, ni los que refresh_case_correlation ya haya
    # timelineado por su cuenta unas lineas arriba -- para no duplicar
    # timeline_events al reutilizar un expediente existente (para uno recien
    # creado da lo mismo, preexisting_ids queda vacio).
    truly_new_ids = matched_ids - preexisting_ids
    newly_matched = [
        m for m in await cases_repository.list_case_messages(pool, case_id) if m["message_id"] in truly_new_ids
    ]
    for message in newly_matched:
        await cases_repository.insert_timeline_event(
            pool,
            case_id=case_id,
            occurred_at=message["sent_datetime"],
            actor=message["from_address"],
            action_type="email_sent",
            description=message["subject"],
            source_message_id=message["message_id"],
            source_attachment_id=None,
            determination_type="hecho_observado",
            confidence=1.0,
        )

    attachments = await cases_repository.find_attachments_for_messages(pool, list(truly_new_ids))
    for attachment in attachments:
        message_subject = attachment["message_subject"] or "(sin asunto)"
        await cases_repository.insert_timeline_event(
            pool,
            case_id=case_id,
            occurred_at=attachment["message_sent_datetime"],
            actor=attachment["message_from_address"],
            action_type="document_shared",
            description=f"{attachment['file_name']} (correo: {message_subject})",
            source_message_id=attachment["message_id"],
            source_attachment_id=attachment["attachment_row_id"],
            determination_type="hecho_observado",
            confidence=1.0,
        )

    return await get_case_detail(pool, case_id, user=user)  # type: ignore[return-value]


async def refresh_case_correlation(
    pool: asyncpg.Pool, case_id: int, *, user: CurrentUser
) -> tuple[CaseDetail, int] | None:
    """Vuelve a buscar correos relacionados para un expediente ya creado.

    A diferencia de create_case (que corre una sola vez, al crear el caso),
    esto se puede pedir en cualquier momento -- util cuando el expediente se
    armo a partir de una busqueda acotada (una carpeta, un rango de fechas)
    y despues se indexaron mas correos que podrian estar relacionados.
    """
    case_core = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case_core is None:
        return None
    _ensure_open(case_core)
    _require_edit(case_core)

    accessible_mailbox_ids = await access_repository.resolve_accessible_mailbox_ids(pool, user)

    existing_messages = await cases_repository.list_case_messages(pool, case_id)
    matched_ids = {m["message_id"] for m in existing_messages}
    new_matches: dict[str, tuple[str, float]] = {}

    primary_message_id = case_core["primary_message_id"]
    primary_core = (
        await cases_repository.get_message_core(pool, primary_message_id)
        if primary_message_id
        else None
    )

    if primary_core is not None and primary_core["conversation_id"]:
        conversation_matches = await cases_repository.find_messages_by_conversation(
            pool, primary_core["conversation_id"], accessible_mailbox_ids=accessible_mailbox_ids
        )
        for message in conversation_matches:
            if message["message_id"] not in matched_ids:
                new_matches[message["message_id"]] = ("conversation_id", CONFIDENCE_CONVERSATION)

    if case_core["external_code"]:
        cr_matches = await cases_repository.find_messages_by_cr_keyword(
            pool, case_core["external_code"], accessible_mailbox_ids=accessible_mailbox_ids
        )
        for message in cr_matches:
            if message["message_id"] not in matched_ids and message["message_id"] not in new_matches:
                new_matches[message["message_id"]] = ("cr_keyword", CONFIDENCE_CR_KEYWORD)

    if primary_core is not None:
        normalized_subject = _normalize_subject(primary_core["subject"])
        participants = list(
            {
                *(a for a in [primary_core["from_address"]] if a),
                *_jsonb(primary_core["to_addresses"]),
                *_jsonb(primary_core["cc_addresses"]),
            }
        )
        sent_dt = primary_core["sent_datetime"]
        date_from = sent_dt - _HEURISTIC_WINDOW if sent_dt else None
        date_to = sent_dt + _HEURISTIC_WINDOW if sent_dt else None
        heuristic_matches = await cases_repository.find_heuristic_related(
            pool,
            exclude_message_id=primary_message_id,
            normalized_subject=normalized_subject,
            participants=participants,
            date_from=date_from,
            date_to=date_to,
            accessible_mailbox_ids=accessible_mailbox_ids,
        )
        for message in heuristic_matches:
            if message["message_id"] not in matched_ids and message["message_id"] not in new_matches:
                new_matches[message["message_id"]] = ("heuristic", CONFIDENCE_HEURISTIC)

    for message_id, (source, confidence) in new_matches.items():
        await cases_repository.insert_case_message(
            pool,
            case_id=case_id,
            message_id=message_id,
            relationship_type="related",
            confidence=confidence,
            correlation_source=source,
        )
        message_core = await cases_repository.get_message_core(pool, message_id)
        if message_core is not None:
            await cases_repository.insert_timeline_event(
                pool,
                case_id=case_id,
                occurred_at=message_core["sent_datetime"],
                actor=message_core["from_address"],
                action_type="email_sent",
                description=message_core["subject"],
                source_message_id=message_id,
                source_attachment_id=None,
                determination_type="hecho_observado",
                confidence=1.0,
            )

    if new_matches:
        attachments = await cases_repository.find_attachments_for_messages(pool, list(new_matches.keys()))
        for attachment in attachments:
            message_subject = attachment["message_subject"] or "(sin asunto)"
            await cases_repository.insert_timeline_event(
                pool,
                case_id=case_id,
                occurred_at=attachment["message_sent_datetime"],
                actor=attachment["message_from_address"],
                action_type="document_shared",
                description=f"{attachment['file_name']} (correo: {message_subject})",
                source_message_id=attachment["message_id"],
                source_attachment_id=attachment["attachment_row_id"],
                determination_type="hecho_observado",
                confidence=1.0,
            )

    if new_matches:
        await _mark_ai_stale(pool, case_id)

    detail = await get_case_detail(pool, case_id, user=user)
    return detail, len(new_matches)  # type: ignore[return-value]


async def merge_cases(pool: asyncpg.Pool, *, case_ids: list[int], title: str, user: CurrentUser) -> CaseDetail:
    """Fusiona varios expedientes en uno nuevo (con `title`) y borra los
    origenes -- todo o nada (ver cases_repository.merge_cases). Requiere
    permiso de edicion sobre TODOS los origenes; si alguno no existe o no es
    editable para este usuario, no se toca nada.
    """
    unique_ids = list(dict.fromkeys(case_ids))
    if len(unique_ids) < 2:
        raise MergeRequiresMultipleCasesError("Hacen falta al menos 2 expedientes distintos para fusionar.")

    case_type = "custom"
    for i, case_id in enumerate(unique_ids):
        case_core = await cases_repository.get_case_core(
            pool, case_id, user_id=user.user_id, is_admin=user.is_admin
        )
        if case_core is None:
            raise CaseAccessDeniedError(f"No tiene acceso al expediente #{case_id}.")
        _require_edit(case_core)
        if i == 0:
            case_type = case_core["case_type"]

    new_case_id = await cases_repository.merge_cases(
        pool, case_ids=unique_ids, title=title, case_type=case_type, owner_user_id=user.user_id
    )
    detail = await get_case_detail(pool, new_case_id, user=user)
    assert detail is not None
    return detail


async def refresh_all_open_cases(pool: asyncpg.Pool, *, user: CurrentUser) -> dict[str, int]:
    """Re-correlaciona TODOS los expedientes abiertos (a los que el usuario
    tiene acceso -- todos, si es admin) contra lo que hay indexado ahora
    mismo -- pensado para cuando otro trabajo (corrido aparte, sin pasar por
    un expediente puntual) trajo correos nuevos que podrian corresponder a
    expedientes ya existentes. Solo mira lo ya indexado (no llama a Graph),
    asi que corre sincronico -- es rapido incluso con muchos expedientes
    abiertos.
    """
    case_ids = await cases_repository.list_open_case_ids(pool, user_id=user.user_id, is_admin=user.is_admin)
    cases_checked = 0
    cases_with_new_messages = 0
    new_messages_found = 0
    errors = 0
    for case_id in case_ids:
        cases_checked += 1
        try:
            result = await refresh_case_correlation(pool, case_id, user=user)
        except (CaseClosedError, CaseAccessDeniedError):
            continue
        except Exception:
            logger.exception("Fallo al re-correlacionar el expediente %s en el refresco global", case_id)
            errors += 1
            continue
        if result is None:
            continue
        _detail, found = result
        if found > 0:
            cases_with_new_messages += 1
            new_messages_found += found
    return {
        "cases_checked": cases_checked,
        "cases_with_new_messages": cases_with_new_messages,
        "new_messages_found": new_messages_found,
        "errors": errors,
    }


class MessageNotFoundError(Exception):
    """El message_id que se quiere vincular a mano no existe entre los mensajes indexados."""


async def add_message_to_case(
    pool: asyncpg.Pool, case_id: int, message_id: str, *, user: CurrentUser
) -> CaseDetail | None:
    """Vincula manualmente un correo real (ya indexado) a un expediente.

    Siempre a partir de un message_id real -- nunca datos escritos a mano --
    para casos donde Graph separo la respuesta en otro hilo (conversation_id
    distinto) o el usuario detecto a ojo que un correo puntual es relevante
    (ej. "en este correo se autorizo el requerimiento") aunque la
    correlacion automatica no lo haya encontrado.
    """
    case_core = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case_core is None:
        return None
    _ensure_open(case_core)
    _require_edit(case_core)

    message_core = await cases_repository.get_message_core(pool, message_id)
    if message_core is None:
        raise MessageNotFoundError(message_id)
    accessible_mailbox_ids = await access_repository.resolve_accessible_mailbox_ids(pool, user)
    if not _mailbox_accessible(message_core["mailbox_account_id"], accessible_mailbox_ids):
        raise MessageNotFoundError(message_id)

    existing_messages = await cases_repository.list_case_messages(pool, case_id)
    already_linked = any(m["message_id"] == message_id for m in existing_messages)

    await cases_repository.insert_case_message(
        pool,
        case_id=case_id,
        message_id=message_id,
        relationship_type="related",
        confidence=1.0,
        correlation_source="manual",
    )

    if not already_linked:
        await cases_repository.insert_timeline_event(
            pool,
            case_id=case_id,
            occurred_at=message_core["sent_datetime"],
            actor=message_core["from_address"],
            action_type="email_sent",
            description=message_core["subject"],
            source_message_id=message_id,
            source_attachment_id=None,
            determination_type="hecho_observado",
            confidence=1.0,
        )
        attachments = await cases_repository.find_attachments_for_messages(pool, [message_id])
        for attachment in attachments:
            message_subject = attachment["message_subject"] or "(sin asunto)"
            await cases_repository.insert_timeline_event(
                pool,
                case_id=case_id,
                occurred_at=attachment["message_sent_datetime"],
                actor=attachment["message_from_address"],
                action_type="document_shared",
                description=f"{attachment['file_name']} (correo: {message_subject})",
                source_message_id=attachment["message_id"],
                source_attachment_id=attachment["attachment_row_id"],
                determination_type="hecho_observado",
                confidence=1.0,
            )
        await _mark_ai_stale(pool, case_id)

    return await get_case_detail(pool, case_id, user=user)


async def remove_message_from_case(
    pool: asyncpg.Pool, case_id: int, message_id: str, *, user: CurrentUser
) -> CaseDetail | None:
    """Desvincula un correo de un expediente (contrario de add_message_to_case).

    Util para sacar correlaciones que matchean el criterio de busqueda (ej.
    un numero de ticket mencionado) pero que en la practica son ruido -- ej.
    un digest periodico que re-lista tickets abiertos sin aportar avance real
    al caso puntual. No borra el mensaje del indice, solo el vinculo.
    """
    case_core = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case_core is None:
        return None
    _ensure_open(case_core)
    _require_edit(case_core)
    removed = await cases_repository.remove_case_message(pool, case_id, message_id)
    if removed:
        await _mark_ai_stale(pool, case_id)
    return await get_case_detail(pool, case_id, user=user)


def _to_summary(record: asyncpg.Record) -> CaseSummary:
    return CaseSummary(
        case_id=record["case_id"],
        case_type=record["case_type"],
        external_code=record["external_code"],
        title=record["title"],
        status=record["status"],
        confidence=record["confidence"],
        message_count=record["message_count"],
        first_message_at=record["first_message_at"],
        last_message_at=record["last_message_at"],
        outcome=record["outcome"],
        has_successful_ai_run=record["has_successful_ai_run"],
        ai_stale=record["ai_stale"],
        has_own_reply=record["has_own_reply"],
        owner_user_id=record["owner_user_id"],
        created_at=record["created_at"],
        pending_action=record["pending_action"],
        next_review_at=record["next_review_at"],
        previous_owner_label=record["previous_owner_label"],
        updated_at=record["updated_at"],
    )


async def list_cases(pool: asyncpg.Pool, limit: int, *, user: CurrentUser) -> list[CaseSummary]:
    records = await cases_repository.list_cases(pool, limit, user_id=user.user_id, is_admin=user.is_admin)
    return [_to_summary(r) for r in records]


def _to_ai_run(record: asyncpg.Record) -> AIAnalyzeResponse:
    output_json = record["output_json"]
    if isinstance(output_json, str):
        output_json = json.loads(output_json)
    result = AICaseSummary.model_validate(output_json) if output_json else None
    return AIAnalyzeResponse(
        ai_run_id=record["ai_run_id"],
        status=record["status"],
        provider=record["provider"],
        model=record["model"],
        policy=record["policy"],
        result=result,
        error_message=record["error_message"],
        analyzed_at=record["created_at"],
    )


async def get_case_detail(pool: asyncpg.Pool, case_id: int, *, user: CurrentUser) -> CaseDetail | None:
    summary = await cases_repository.get_case_summary(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if summary is None:
        return None
    message_records = await cases_repository.list_case_messages(pool, case_id)
    timeline_records = await cases_repository.list_timeline_events(pool, case_id)
    latest_ai_run_record = await ai_runs_repository.get_latest_ai_run_by_case(pool, case_id)

    attachment_records = await cases_repository.find_attachments_for_messages(
        pool, [m["message_id"] for m in message_records]
    )
    note_records = await cases_repository.list_case_notes(pool, case_id)
    evidence_records = await cases_repository.list_case_evidence(pool, case_id)
    ai_summary_override = await cases_repository.get_case_ai_summary_override(pool, case_id)
    attachments_by_message: dict[str, list[CaseAttachmentRead]] = {}
    for a in attachment_records:
        attachments_by_message.setdefault(a["message_id"], []).append(
            CaseAttachmentRead(
                attachment_row_id=a["attachment_row_id"],
                attachment_id=a["attachment_id"],
                file_name=a["file_name"],
                extension=a["extension"],
                size_bytes=a["size_bytes"],
                matches_naming_convention=a["matches_naming_convention"],
                matches_search_pattern=a["matches_search_pattern"],
                content_sha256=a["content_sha256"],
            )
        )

    return CaseDetail(
        **_to_summary(summary).model_dump(),
        messages=[
            CaseMessageRead(
                message_id=m["message_id"],
                subject=m["subject"],
                from_address=m["from_address"],
                to_addresses=_jsonb(m["to_addresses"]),
                cc_addresses=_jsonb(m["cc_addresses"]),
                sent_datetime=m["sent_datetime"],
                relationship_type=m["relationship_type"],
                confidence=m["confidence"],
                correlation_source=m["correlation_source"],
                has_attachments=m["has_attachments"],
                attachments=attachments_by_message.get(m["message_id"], []),
                body_preview=m["body_preview"],
                body_content=m["body_content"],
                body_content_type=m["body_content_type"],
                web_link=m["web_link"],
                mailbox_account_id=m["mailbox_account_id"],
                mailbox_label=m["mailbox_label"],
            )
            for m in message_records
        ],
        timeline=[
            TimelineEventRead(
                event_id=t["event_id"],
                occurred_at=t["occurred_at"],
                actor=t["actor"],
                action_type=t["action_type"],
                # El resumen de IA editado por el auditor pisa el texto crudo
                # en la linea de tiempo tambien -- un solo texto "vigente",
                # no dos versiones distintas mostradas en paralelo.
                description=(
                    ai_summary_override
                    if t["action_type"] == "ai_case_summary" and ai_summary_override
                    else t["description"]
                ),
                source_message_id=t["source_message_id"],
                source_attachment_id=t["source_attachment_id"],
                determination_type=t["determination_type"],
                confidence=t["confidence"],
            )
            for t in timeline_records
        ],
        notes=[
            CaseNoteRead(
                note_id=n["note_id"],
                body=n["body"],
                body_markdown=markdown_render.html_to_markdown(n["body"]),
                created_at=n["created_at"],
            )
            for n in note_records
        ],
        evidence=[
            CaseEvidenceRead(
                evidence_id=e["evidence_id"],
                glosa=e["glosa"],
                file_name=e["file_name"],
                content_type=e["content_type"],
                size_bytes=e["size_bytes"],
                created_at=e["created_at"],
            )
            for e in evidence_records
        ],
        latest_ai_run=_to_ai_run(latest_ai_run_record) if latest_ai_run_record else None,
        ai_summary_override=ai_summary_override,
    )


async def _raise_update_conflict(pool: asyncpg.Pool, case_id: int) -> None:
    """Arma el mensaje de conflicto con quien lo edito de ultimo, mirando el
    log de auditoria (mismo que alimenta la seccion "Historial de auditoría"
    del expediente) -- best effort: si no hay ninguna entrada (ej. el
    conflicto vino de una edicion muy vieja, previa a que existiera el log),
    el mensaje queda generico."""
    recent = await cases_repository.list_audit_log(pool, case_id, limit=1)
    if recent:
        who = recent[0]["user_display_name"] or recent[0]["user_email_address"] or "otra persona"
        raise CaseUpdateConflictError(
            f'{who} modificó este expediente mientras lo tenías abierto. Recargalo para ver los cambios antes de guardar de nuevo.'
        )
    raise CaseUpdateConflictError(
        "Este expediente se modificó mientras lo tenías abierto. Recargalo para ver los cambios antes de guardar de nuevo."
    )


async def update_ai_summary(
    pool: asyncpg.Pool,
    case_id: int,
    summary: str,
    *,
    user: CurrentUser,
    expected_updated_at: datetime | None = None,
) -> CaseDetail | None:
    """Guarda la version corregida a mano del resumen de IA -- no toca
    mailing.ai_runs (el registro original de auditoria queda intacta), solo
    la que se muestra en la UI/PDF/linea de tiempo."""
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    _require_edit(case)
    _ensure_open(case)
    updated = await cases_repository.update_case(
        pool, case_id, fields={"ai_summary_override": summary}, expected_updated_at=expected_updated_at
    )
    if not updated:
        if expected_updated_at is not None:
            await _raise_update_conflict(pool, case_id)
        return None
    await cases_repository.insert_audit_entry(
        pool, case_id=case_id, user_id=user.user_id, description="Editó el resumen de IA"
    )
    return await get_case_detail(pool, case_id, user=user)


async def delete_cases(pool: asyncpg.Pool, scope: str, *, user: CurrentUser) -> int:
    return await cases_repository.delete_cases(pool, scope, user_id=user.user_id, is_admin=user.is_admin)


async def delete_case(pool: asyncpg.Pool, case_id: int, *, user: CurrentUser) -> bool:
    return await cases_repository.delete_case(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)


async def update_case(
    pool: asyncpg.Pool,
    case_id: int,
    *,
    fields: dict[str, object],
    user: CurrentUser,
    expected_updated_at: datetime | None = None,
) -> CaseDetail | None:
    case_core = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case_core is None:
        return None
    _require_edit(case_core)

    current_status = case_core["status"]
    next_status = fields.get("status", current_status)
    next_outcome = fields.get("outcome", case_core["outcome"])

    edits_requiring_open = {"outcome", "pending_action", "next_review_at"}
    if edits_requiring_open & fields.keys() and current_status == "closed" and next_status != "open":
        raise CaseClosedError("El expediente esta cerrado. Debe reabrirse antes de poder modificarlo.")

    if next_status == "closed" and next_outcome == "sin_hallazgos":
        raise CaseNotEligibleForAIError(
            "Este expediente esta marcado 'sin hallazgos' -- no se puede cerrar manualmente."
        )

    updated = await cases_repository.update_case(
        pool, case_id, fields=fields, expected_updated_at=expected_updated_at
    )
    if not updated:
        if expected_updated_at is not None:
            await _raise_update_conflict(pool, case_id)
        return None

    for field_name, new_value in fields.items():
        if field_name not in _AUDIT_FIELD_LABELS:
            continue
        old_value = case_core[field_name]
        if old_value == new_value:
            continue
        label = _AUDIT_FIELD_LABELS[field_name]
        old_display = _audit_str(old_value) or "(sin definir)"
        new_display = _audit_str(new_value) or "(sin definir)"
        await cases_repository.insert_audit_entry(
            pool,
            case_id=case_id,
            user_id=user.user_id,
            field_name=field_name,
            old_value=_audit_str(old_value),
            new_value=_audit_str(new_value),
            description=f'Cambió {label} de "{old_display}" a "{new_display}"',
        )

    return await get_case_detail(pool, case_id, user=user)


async def add_case_note(pool: asyncpg.Pool, case_id: int, body: str, *, user: CurrentUser) -> CaseNoteRead | None:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    _require_edit(case)
    _ensure_open(case)
    # Se normaliza a HTML al guardar (no en cada lectura) -- las notas suelen
    # redactarse con ayuda de IA y pegarse con formato Markdown crudo.
    html_body = markdown_render.markdown_to_safe_html(body)
    record = await cases_repository.insert_case_note(pool, case_id, html_body)
    await _mark_ai_stale(pool, case_id)
    # La nota tambien queda como hecho en la linea de tiempo -- para que se
    # vea en orden cronologico junto a los correos y el analisis de IA, no
    # solo en la tabla de notas aparte. Descripcion acotada a una linea (la
    # tabla de notas ya muestra el texto completo con su formato).
    one_line = "Nota del auditor: " + markdown_render.html_to_plain_text(html_body)[:300]
    await cases_repository.insert_timeline_event(
        pool,
        case_id=case_id,
        occurred_at=record["created_at"],
        actor=None,
        action_type="auditor_note",
        description=one_line,
        source_message_id=None,
        source_attachment_id=None,
        determination_type="validacion_manual",
        confidence=None,
    )
    await cases_repository.insert_audit_entry(
        pool, case_id=case_id, user_id=user.user_id, description="Agregó una nota"
    )
    return CaseNoteRead(
        note_id=record["note_id"], body=record["body"], body_markdown=body, created_at=record["created_at"]
    )


async def add_case_evidence(
    pool: asyncpg.Pool,
    case_id: int,
    *,
    glosa: str,
    file_name: str,
    content_type: str,
    content: bytes,
    user: CurrentUser,
) -> CaseEvidenceRead | None:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    _require_edit(case)
    _ensure_open(case)
    if content_type not in _ALLOWED_EVIDENCE_CONTENT_TYPES:
        raise UnsupportedEvidenceTypeError(content_type)
    if len(content) > _MAX_EVIDENCE_SIZE_BYTES:
        raise EvidenceTooLargeError(len(content))
    record = await cases_repository.insert_case_evidence(
        pool,
        case_id=case_id,
        glosa=glosa,
        file_name=file_name,
        content_type=content_type,
        size_bytes=len(content),
        content=content,
        created_by_user_id=user.user_id,
    )
    await _mark_ai_stale(pool, case_id)
    await cases_repository.insert_audit_entry(
        pool, case_id=case_id, user_id=user.user_id, description=f"Agregó evidencia: {glosa}"
    )
    return CaseEvidenceRead(
        evidence_id=record["evidence_id"],
        glosa=record["glosa"],
        file_name=record["file_name"],
        content_type=record["content_type"],
        size_bytes=record["size_bytes"],
        created_at=record["created_at"],
    )


async def get_case_evidence_content(
    pool: asyncpg.Pool, case_id: int, evidence_id: int, *, user: CurrentUser
) -> asyncpg.Record | None:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    return await cases_repository.get_case_evidence_content(pool, case_id, evidence_id)


async def update_timeline_event(
    pool: asyncpg.Pool, event_id: int, determination_type: str, *, user: CurrentUser
) -> bool:
    info = await cases_repository.get_timeline_event_case_status(
        pool, event_id, user_id=user.user_id, is_admin=user.is_admin
    )
    if info is None:
        return False
    if info["status"] == "closed":
        raise CaseClosedError("El expediente esta cerrado. Debe reabrirse antes de poder modificarlo.")
    record = await cases_repository.update_timeline_event_determination(
        pool, event_id, determination_type
    )
    return record is not None


async def list_case_shares(pool: asyncpg.Pool, case_id: int, *, user: CurrentUser) -> list[CaseShareRead] | None:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    records = await cases_repository.list_case_shares(pool, case_id)
    return [
        CaseShareRead(
            user_id=r["user_id"],
            email_address=r["email_address"],
            display_name=r["display_name"],
            permission=r["permission"],
            created_at=r["created_at"],
        )
        for r in records
    ]


async def share_case(
    pool: asyncpg.Pool, case_id: int, *, target_user_id: int, permission: str, user: CurrentUser
) -> CaseShareRead | None:
    """Solo el dueño o un admin puede compartir -- un usuario con acceso
    'edit' via case_shares no puede, a su vez, re-compartir el expediente con
    otros (evita que la compartición se propague sin control del dueño)."""
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    if not user.is_admin and case["owner_user_id"] != user.user_id:
        raise CaseAccessDeniedError("Solo el dueño del expediente (o un admin) puede compartirlo.")
    record = await cases_repository.upsert_case_share(
        pool, case_id=case_id, user_id=target_user_id, permission=permission, shared_by_user_id=user.user_id
    )
    sharer_name = user.display_name or user.email_address
    permission_label = "edición" if permission == "edit" else "solo lectura"
    notification_message = f'{sharer_name} te compartió el expediente "{case["title"]}" ({permission_label}).'
    await notifications_repository.insert_notification(
        pool,
        user_id=target_user_id,
        kind="case_shared",
        message=notification_message,
        case_id=case_id,
        created_by_user_id=user.user_id,
    )
    email_body = email_templates.render_case_shared_email(
        shared_by=sharer_name,
        case_title=case["title"],
        external_code=case["external_code"],
        case_status=case["status"],
        permission=permission,
        shared_at=datetime.now(timezone.utc),
    )
    await notification_email_service.try_send_email(
        to_email=record["email_address"],
        subject=f'MailingAI — te compartieron el expediente "{case["title"]}"',
        body=email_body,
    )
    return CaseShareRead(
        user_id=record["user_id"],
        email_address=record["email_address"],
        display_name=record["display_name"],
        permission=record["permission"],
        created_at=record["created_at"],
    )


async def cascade_revoke_mailbox_access(pool: asyncpg.Pool, *, user_id: int, mailbox_account_id: int) -> dict[str, int]:
    return await cases_repository.cascade_revoke_user_mailbox_access(
        pool, user_id=user_id, mailbox_account_id=mailbox_account_id
    )


async def get_mailbox_deletion_impact(pool: asyncpg.Pool, mailbox_account_id: int) -> dict[str, int]:
    return await cases_repository.get_mailbox_deletion_impact(pool, mailbox_account_id)


async def delete_mailbox_content(pool: asyncpg.Pool, mailbox_account_id: int, *, mailbox_label: str) -> dict[str, int]:
    return await cases_repository.cascade_delete_mailbox_content(pool, mailbox_account_id, mailbox_label=mailbox_label)


async def list_cases_by_outcome(pool: asyncpg.Pool, *, outcome: str, user: CurrentUser) -> list[CaseSummary]:
    real_outcome = None if outcome == "none" else outcome
    records = await cases_repository.list_cases_by_outcome(
        pool, user_id=user.user_id, is_admin=user.is_admin, outcome=real_outcome
    )
    return [_to_summary(r) for r in records]


async def get_dashboard_stats(pool: asyncpg.Pool, *, user: CurrentUser) -> CaseDashboardStats:
    stats = await cases_repository.get_dashboard_stats(pool, user_id=user.user_id, is_admin=user.is_admin)
    by_outcome_rows = await cases_repository.get_dashboard_stats_by_outcome(
        pool, user_id=user.user_id, is_admin=user.is_admin
    )
    return CaseDashboardStats(
        total=stats["total"],
        open_count=stats["open_count"],
        closed_count=stats["closed_count"],
        overdue_review_count=stats["overdue_review_count"],
        stale_ai_count=stats["stale_ai_count"],
        no_ai_count=stats["no_ai_count"],
        by_outcome={r["outcome"]: r["case_count"] for r in by_outcome_rows},
    )


async def reassign_case_owner(
    pool: asyncpg.Pool, case_id: int, *, new_owner_user_id: int, admin: CurrentUser
) -> CaseDetail | None:
    """Cambia el dueño de un expediente a mano -- distinto de la reasignación
    automática que hace delete_user cuando se elimina una cuenta (esta la
    dispara un admin explícitamente, ej. para corregir un expediente que
    quedó con previous_owner_label después de esa eliminación)."""
    case_core = await cases_repository.get_case_core(pool, case_id, user_id=admin.user_id, is_admin=admin.is_admin)
    if case_core is None:
        return None
    new_owner = await users_repository.get_user_by_id(pool, new_owner_user_id)
    if new_owner is None:
        raise TargetUserNotFoundError(f"No existe el usuario #{new_owner_user_id}.")
    updated = await cases_repository.update_case_owner(pool, case_id, new_owner_user_id=new_owner_user_id)
    if updated is None:
        return None
    new_owner_label = new_owner["display_name"] or new_owner["email_address"]
    await cases_repository.insert_audit_entry(
        pool,
        case_id=case_id,
        user_id=admin.user_id,
        field_name="owner_user_id",
        old_value=str(case_core["owner_user_id"]) if case_core["owner_user_id"] is not None else None,
        new_value=str(new_owner_user_id),
        description=f'Reasignó el expediente a "{new_owner_label}"',
    )
    return await get_case_detail(pool, case_id, user=admin)


async def list_case_audit_log(
    pool: asyncpg.Pool, case_id: int, *, user: CurrentUser
) -> list[CaseAuditLogRead] | None:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return None
    records = await cases_repository.list_audit_log(pool, case_id)
    return [
        CaseAuditLogRead(
            audit_id=r["audit_id"],
            user_display_name=r["user_display_name"] or r["user_email_address"],
            occurred_at=r["occurred_at"],
            field_name=r["field_name"],
            old_value=r["old_value"],
            new_value=r["new_value"],
            description=r["description"],
        )
        for r in records
    ]


async def revoke_case_share(pool: asyncpg.Pool, case_id: int, target_user_id: int, *, user: CurrentUser) -> bool:
    case = await cases_repository.get_case_core(pool, case_id, user_id=user.user_id, is_admin=user.is_admin)
    if case is None:
        return False
    if not user.is_admin and case["owner_user_id"] != user.user_id:
        raise CaseAccessDeniedError("Solo el dueño del expediente (o un admin) puede revocar el acceso.")
    return await cases_repository.delete_case_share(pool, case_id, target_user_id)
