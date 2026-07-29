import json
import logging
import re
from datetime import timedelta

import asyncpg

from app.repositories import ai_runs_repository, cases_repository
from app.schemas.ai import AIAnalyzeResponse, AICaseSummary
from app.schemas.cases import (
    CaseAttachmentRead,
    CaseDetail,
    CaseEvidenceRead,
    CaseMessageRead,
    CaseNoteRead,
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


def _ensure_open(case_core: asyncpg.Record) -> None:
    if case_core["status"] == "closed":
        raise CaseClosedError(
            "El expediente esta cerrado. Debe reabrirse antes de poder modificarlo."
        )


async def _mark_ai_stale(pool: asyncpg.Pool, case_id: int) -> None:
    await cases_repository.update_case(pool, case_id, fields={"ai_stale": True})


async def create_empty_case(
    pool: asyncpg.Pool,
    *,
    title: str,
    seed_value: str,
    case_type: str,
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
        detail = await get_case_detail(pool, existing["case_id"])
        if detail is not None:
            return detail
    case_record = await cases_repository.insert_case(
        pool,
        title=title,
        case_type=case_type,
        external_code=seed_value,
        primary_message_id=None,
    )
    detail = await get_case_detail(pool, case_record["case_id"])
    assert detail is not None
    return detail


async def create_case(
    pool: asyncpg.Pool,
    *,
    title: str,
    seed_type: str,
    seed_value: str,
    case_type: str,
) -> CaseDetail:
    if seed_type == "cr_keyword":
        existing = await cases_repository.find_case_by_external_code(pool, seed_value)
        if existing is not None:
            # Ya existe un expediente para este mismo codigo/ticket -- en vez
            # de duplicarlo, se reutiliza y se refresca la correlacion con lo
            # que haya nuevo indexado desde que se creo. Si esta cerrado no se
            # toca (mismo criterio de inmutabilidad de siempre) y se devuelve
            # tal cual esta.
            try:
                refreshed = await refresh_case_correlation(pool, existing["case_id"])
            except CaseClosedError:
                refreshed = None
            if refreshed is not None:
                return refreshed[0]
            detail = await get_case_detail(pool, existing["case_id"])
            if detail is not None:
                return detail

    primary_message_id: str | None = None
    external_code: str | None = None
    seed_messages: list[asyncpg.Record] = []
    correlation_source_for_seed = "manual"

    if seed_type == "conversation_id":
        seed_messages = await cases_repository.find_messages_by_conversation(pool, seed_value)
        correlation_source_for_seed = "conversation_id"
        if seed_messages:
            primary_message_id = seed_messages[0]["message_id"]
    elif seed_type == "cr_keyword":
        seed_messages = await cases_repository.find_messages_by_cr_keyword(pool, seed_value)
        external_code = seed_value
        correlation_source_for_seed = "cr_keyword"
        if seed_messages:
            primary_message_id = seed_messages[0]["message_id"]
    elif seed_type == "message_id":
        message = await cases_repository.get_message_core(pool, seed_value)
        if message is not None:
            primary_message_id = message["message_id"]
            seed_messages = [message]
        correlation_source_for_seed = "manual"

    case_record = await cases_repository.insert_case(
        pool,
        title=title,
        case_type=case_type,
        external_code=external_code,
        primary_message_id=primary_message_id,
    )
    case_id = case_record["case_id"]

    matched_ids: set[str] = set()

    for i, message in enumerate(seed_messages):
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

    all_matched = await cases_repository.list_case_messages(pool, case_id)
    for message in all_matched:
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

    attachments = await cases_repository.find_attachments_for_messages(pool, list(matched_ids))
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

    return await get_case_detail(pool, case_id)  # type: ignore[return-value]


async def refresh_case_correlation(pool: asyncpg.Pool, case_id: int) -> tuple[CaseDetail, int] | None:
    """Vuelve a buscar correos relacionados para un expediente ya creado.

    A diferencia de create_case (que corre una sola vez, al crear el caso),
    esto se puede pedir en cualquier momento -- util cuando el expediente se
    armo a partir de una busqueda acotada (una carpeta, un rango de fechas)
    y despues se indexaron mas correos que podrian estar relacionados.
    """
    case_core = await cases_repository.get_case_core(pool, case_id)
    if case_core is None:
        return None
    _ensure_open(case_core)

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
            pool, primary_core["conversation_id"]
        )
        for message in conversation_matches:
            if message["message_id"] not in matched_ids:
                new_matches[message["message_id"]] = ("conversation_id", CONFIDENCE_CONVERSATION)

    if case_core["external_code"]:
        cr_matches = await cases_repository.find_messages_by_cr_keyword(pool, case_core["external_code"])
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

    detail = await get_case_detail(pool, case_id)
    return detail, len(new_matches)  # type: ignore[return-value]


async def refresh_all_open_cases(pool: asyncpg.Pool) -> dict[str, int]:
    """Re-correlaciona TODOS los expedientes abiertos contra lo que hay
    indexado ahora mismo -- pensado para cuando otro trabajo (corrido aparte,
    sin pasar por un expediente puntual) trajo correos nuevos que podrian
    corresponder a expedientes ya existentes. Solo mira lo ya indexado (no
    llama a Graph), asi que corre sincronico -- es rapido incluso con muchos
    expedientes abiertos.
    """
    case_ids = await cases_repository.list_open_case_ids(pool)
    cases_checked = 0
    cases_with_new_messages = 0
    new_messages_found = 0
    errors = 0
    for case_id in case_ids:
        cases_checked += 1
        try:
            result = await refresh_case_correlation(pool, case_id)
        except CaseClosedError:
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


async def add_message_to_case(pool: asyncpg.Pool, case_id: int, message_id: str) -> CaseDetail | None:
    """Vincula manualmente un correo real (ya indexado) a un expediente.

    Siempre a partir de un message_id real -- nunca datos escritos a mano --
    para casos donde Graph separo la respuesta en otro hilo (conversation_id
    distinto) o el usuario detecto a ojo que un correo puntual es relevante
    (ej. "en este correo se autorizo el requerimiento") aunque la
    correlacion automatica no lo haya encontrado.
    """
    case_core = await cases_repository.get_case_core(pool, case_id)
    if case_core is None:
        return None
    _ensure_open(case_core)

    message_core = await cases_repository.get_message_core(pool, message_id)
    if message_core is None:
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

    return await get_case_detail(pool, case_id)


async def remove_message_from_case(pool: asyncpg.Pool, case_id: int, message_id: str) -> CaseDetail | None:
    """Desvincula un correo de un expediente (contrario de add_message_to_case).

    Util para sacar correlaciones que matchean el criterio de busqueda (ej.
    un numero de ticket mencionado) pero que en la practica son ruido -- ej.
    un digest periodico que re-lista tickets abiertos sin aportar avance real
    al caso puntual. No borra el mensaje del indice, solo el vinculo.
    """
    case_core = await cases_repository.get_case_core(pool, case_id)
    if case_core is None:
        return None
    _ensure_open(case_core)
    removed = await cases_repository.remove_case_message(pool, case_id, message_id)
    if removed:
        await _mark_ai_stale(pool, case_id)
    return await get_case_detail(pool, case_id)


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
    )


async def list_cases(pool: asyncpg.Pool, limit: int) -> list[CaseSummary]:
    records = await cases_repository.list_cases(pool, limit)
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


async def get_case_detail(pool: asyncpg.Pool, case_id: int) -> CaseDetail | None:
    summary = await cases_repository.get_case_summary(pool, case_id)
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
            CaseNoteRead(note_id=n["note_id"], body=n["body"], created_at=n["created_at"])
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


async def update_ai_summary(pool: asyncpg.Pool, case_id: int, summary: str) -> CaseDetail | None:
    """Guarda la version corregida a mano del resumen de IA -- no toca
    mailing.ai_runs (el registro original de auditoria queda intacto), solo
    la que se muestra en la UI/PDF/linea de tiempo. No requiere el expediente
    abierto: es un ajuste de redaccion, no una reapertura de la revision."""
    case = await cases_repository.get_case_core(pool, case_id)
    if case is None:
        return None
    await cases_repository.update_case(pool, case_id, fields={"ai_summary_override": summary})
    return await get_case_detail(pool, case_id)


async def delete_cases(pool: asyncpg.Pool, scope: str) -> int:
    return await cases_repository.delete_cases(pool, scope)


async def delete_case(pool: asyncpg.Pool, case_id: int) -> bool:
    return await cases_repository.delete_case(pool, case_id)


async def update_case(pool: asyncpg.Pool, case_id: int, *, fields: dict[str, object]) -> CaseDetail | None:
    case_core = await cases_repository.get_case_core(pool, case_id)
    if case_core is None:
        return None

    current_status = case_core["status"]
    next_status = fields.get("status", current_status)
    next_outcome = fields.get("outcome", case_core["outcome"])

    if "outcome" in fields and current_status == "closed" and next_status != "open":
        raise CaseClosedError("El expediente esta cerrado. Debe reabrirse antes de poder modificarlo.")

    if next_status == "closed" and next_outcome == "sin_hallazgos":
        raise CaseNotEligibleForAIError(
            "Este expediente esta marcado 'sin hallazgos' -- no se puede cerrar manualmente."
        )

    updated = await cases_repository.update_case(pool, case_id, fields=fields)
    if not updated:
        return None
    return await get_case_detail(pool, case_id)


async def add_case_note(pool: asyncpg.Pool, case_id: int, body: str) -> CaseNoteRead | None:
    case = await cases_repository.get_case_core(pool, case_id)
    if case is None:
        return None
    _ensure_open(case)
    record = await cases_repository.insert_case_note(pool, case_id, body)
    await _mark_ai_stale(pool, case_id)
    # La nota tambien queda como hecho en la linea de tiempo -- para que se
    # vea en orden cronologico junto a los correos y el analisis de IA, no
    # solo en la tabla de notas aparte. Descripcion acotada a una linea (la
    # tabla de notas ya muestra el texto completo con su formato).
    one_line = "Nota del auditor: " + " ".join(body.split())[:300]
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
    return CaseNoteRead(note_id=record["note_id"], body=record["body"], created_at=record["created_at"])


async def add_case_evidence(
    pool: asyncpg.Pool,
    case_id: int,
    *,
    glosa: str,
    file_name: str,
    content_type: str,
    content: bytes,
) -> CaseEvidenceRead | None:
    case = await cases_repository.get_case_core(pool, case_id)
    if case is None:
        return None
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
    )
    await _mark_ai_stale(pool, case_id)
    return CaseEvidenceRead(
        evidence_id=record["evidence_id"],
        glosa=record["glosa"],
        file_name=record["file_name"],
        content_type=record["content_type"],
        size_bytes=record["size_bytes"],
        created_at=record["created_at"],
    )


async def get_case_evidence_content(pool: asyncpg.Pool, case_id: int, evidence_id: int) -> asyncpg.Record | None:
    return await cases_repository.get_case_evidence_content(pool, case_id, evidence_id)


async def update_timeline_event(
    pool: asyncpg.Pool, event_id: int, determination_type: str
) -> bool:
    info = await cases_repository.get_timeline_event_case_status(pool, event_id)
    if info is None:
        return False
    if info["status"] == "closed":
        raise CaseClosedError("El expediente esta cerrado. Debe reabrirse antes de poder modificarlo.")
    record = await cases_repository.update_timeline_event_determination(
        pool, event_id, determination_type
    )
    return record is not None
