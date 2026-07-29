from datetime import datetime

import asyncpg

_SUMMARY_FIELDS = """
    case_id, case_type, external_code, title, status, confidence,
    message_count, first_message_at, last_message_at, outcome, has_successful_ai_run, ai_stale,
    has_own_reply
"""


async def find_case_by_external_code(pool: asyncpg.Pool, external_code: str) -> asyncpg.Record | None:
    query = "SELECT case_id FROM mailing.cases WHERE external_code = $1 ORDER BY case_id ASC LIMIT 1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, external_code)


async def insert_case(
    pool: asyncpg.Pool,
    *,
    title: str,
    case_type: str,
    external_code: str | None,
    primary_message_id: str | None,
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.cases (title, case_type, external_code, primary_message_id)
        VALUES ($1, $2, $3, $4)
        RETURNING case_id;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, title, case_type, external_code, primary_message_id)


async def get_case_core(pool: asyncpg.Pool, case_id: int) -> asyncpg.Record | None:
    query = """
        SELECT case_id, case_type, external_code, primary_message_id, status, outcome, title
        FROM mailing.cases
        WHERE case_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id)


async def get_case_ai_summary_override(pool: asyncpg.Pool, case_id: int) -> str | None:
    query = "SELECT ai_summary_override FROM mailing.cases WHERE case_id = $1;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, case_id)
    return row["ai_summary_override"] if row is not None else None


async def get_message_core(pool: asyncpg.Pool, message_id: str) -> asyncpg.Record | None:
    query = """
        SELECT message_id, conversation_id, subject, from_address, to_addresses, cc_addresses, sent_datetime
        FROM mailing.messages
        WHERE message_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, message_id)


async def find_messages_by_conversation(
    pool: asyncpg.Pool, conversation_id: str
) -> list[asyncpg.Record]:
    query = """
        SELECT message_id, subject, from_address, sent_datetime
        FROM mailing.messages
        WHERE conversation_id = $1
        ORDER BY sent_datetime ASC NULLS LAST;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, conversation_id)


async def find_messages_by_cr_keyword(pool: asyncpg.Pool, keyword: str) -> list[asyncpg.Record]:
    query = """
        SELECT DISTINCT m.message_id, m.subject, m.from_address, m.sent_datetime
        FROM mailing.messages m
        LEFT JOIN mailing.message_attachments a ON a.message_id = m.message_id
        WHERE m.subject ILIKE $1 OR m.body_content ILIKE $1 OR a.file_name ILIKE $1
        ORDER BY m.sent_datetime ASC NULLS LAST;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, f"%{keyword}%")


async def find_heuristic_related(
    pool: asyncpg.Pool,
    *,
    exclude_message_id: str,
    normalized_subject: str,
    participants: list[str],
    date_from: datetime | None,
    date_to: datetime | None,
) -> list[asyncpg.Record]:
    if not normalized_subject or not participants:
        return []
    query = """
        SELECT message_id, subject, from_address, sent_datetime
        FROM mailing.messages
        WHERE message_id != $1
          AND subject ILIKE $2
          AND (
                from_address = ANY($3::text[])
                OR to_addresses ?| $3
                OR cc_addresses ?| $3
              )
          AND ($4::timestamptz IS NULL OR sent_datetime >= $4)
          AND ($5::timestamptz IS NULL OR sent_datetime <= $5)
        ORDER BY sent_datetime ASC NULLS LAST;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(
            query,
            exclude_message_id,
            f"%{normalized_subject}%",
            participants,
            date_from,
            date_to,
        )


async def insert_case_message(
    pool: asyncpg.Pool,
    *,
    case_id: int,
    message_id: str,
    relationship_type: str,
    confidence: float,
    correlation_source: str,
) -> None:
    query = """
        INSERT INTO mailing.case_messages (case_id, message_id, relationship_type, confidence, correlation_source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (case_id, message_id) DO UPDATE SET
          confidence = GREATEST(mailing.case_messages.confidence, EXCLUDED.confidence),
          correlation_source = CASE
            WHEN EXCLUDED.confidence > mailing.case_messages.confidence THEN EXCLUDED.correlation_source
            ELSE mailing.case_messages.correlation_source
          END;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, case_id, message_id, relationship_type, confidence, correlation_source)


async def delete_ai_summary_timeline_events(pool: asyncpg.Pool, case_id: int) -> None:
    """Borra los eventos 'ai_case_summary' previos de un expediente -- solo
    tiene sentido mostrar el resumen de IA vigente en la linea de tiempo, no
    acumular uno por cada corrida historica (esas ya quedan preservadas para
    auditoria en mailing.ai_runs, con su propio historial completo)."""
    query = "DELETE FROM mailing.timeline_events WHERE case_id = $1 AND action_type = 'ai_case_summary';"
    async with pool.acquire() as conn:
        await conn.execute(query, case_id)


async def insert_timeline_event(
    pool: asyncpg.Pool,
    *,
    case_id: int,
    occurred_at: datetime | None,
    actor: str | None,
    action_type: str,
    description: str | None,
    source_message_id: str | None,
    source_attachment_id: int | None,
    determination_type: str,
    confidence: float | None,
) -> None:
    query = """
        INSERT INTO mailing.timeline_events
          (case_id, occurred_at, actor, action_type, description, source_message_id, source_attachment_id, determination_type, confidence)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    """
    async with pool.acquire() as conn:
        await conn.execute(
            query,
            case_id,
            occurred_at,
            actor,
            action_type,
            description,
            source_message_id,
            source_attachment_id,
            determination_type,
            confidence,
        )


async def remove_case_message(pool: asyncpg.Pool, case_id: int, message_id: str) -> bool:
    query = """
        DELETE FROM mailing.case_messages
        WHERE case_id = $1 AND message_id = $2
        RETURNING message_id;
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(query, case_id, message_id)
            if row is not None:
                await conn.execute(
                    "DELETE FROM mailing.timeline_events WHERE case_id = $1 AND source_message_id = $2;",
                    case_id,
                    message_id,
                )
    return row is not None


async def find_attachments_for_messages(
    pool: asyncpg.Pool, message_ids: list[str]
) -> list[asyncpg.Record]:
    if not message_ids:
        return []
    query = """
        SELECT ma.attachment_row_id, ma.message_id, ma.attachment_id, ma.file_name, ma.extension,
               ma.size_bytes, ma.file_date, ma.matches_naming_convention, ma.matches_search_pattern,
               ma.content_sha256,
               m.subject AS message_subject, m.sent_datetime AS message_sent_datetime,
               m.from_address AS message_from_address
        FROM mailing.message_attachments ma
        JOIN mailing.messages m ON m.message_id = ma.message_id
        WHERE ma.message_id = ANY($1::text[]);
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, message_ids)


async def get_case_activity_by_day(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT date_trunc('day', m.sent_datetime)::date AS day, count(*) AS message_count
        FROM mailing.case_messages cm
        JOIN mailing.messages m ON m.message_id = cm.message_id
        WHERE cm.case_id = $1 AND m.sent_datetime IS NOT NULL
        GROUP BY date_trunc('day', m.sent_datetime)::date
        ORDER BY day;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def get_case_activity_by_sender(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT COALESCE(m.from_address, 'desconocido') AS label, count(*) AS message_count
        FROM mailing.case_messages cm
        JOIN mailing.messages m ON m.message_id = cm.message_id
        WHERE cm.case_id = $1
        GROUP BY COALESCE(m.from_address, 'desconocido')
        ORDER BY message_count DESC
        LIMIT 20;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def backfill_attachment_timeline_events(pool: asyncpg.Pool, message_id: str) -> list[int]:
    """Crea los eventos 'document_shared' que falten para un mensaje ya vinculado
    a uno o mas expedientes -- cubre el caso de un adjunto recuperado despues
    (boton 'Recuperar adjuntos') cuando el mensaje ya se habia correlacionado
    antes de que el adjunto existiera en mailing.message_attachments. Idempotente:
    NOT EXISTS evita duplicar un evento ya creado. Devuelve los case_id afectados."""
    query = """
        INSERT INTO mailing.timeline_events
          (case_id, occurred_at, actor, action_type, description, source_message_id, source_attachment_id, determination_type, confidence)
        SELECT cm.case_id, m.sent_datetime, m.from_address, 'document_shared',
               ma.file_name || ' (correo: ' || COALESCE(m.subject, '(sin asunto)') || ')',
               ma.message_id, ma.attachment_row_id, 'hecho_observado', 1.0
        FROM mailing.message_attachments ma
        JOIN mailing.messages m ON m.message_id = ma.message_id
        JOIN mailing.case_messages cm ON cm.message_id = ma.message_id
        WHERE ma.message_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM mailing.timeline_events te
            WHERE te.case_id = cm.case_id AND te.source_attachment_id = ma.attachment_row_id
          )
        RETURNING case_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, message_id)
    return [r["case_id"] for r in rows]


_DELETE_SCOPE_CLAUSES = {
    "all": "TRUE",
    "open": "status = 'open'",
    "closed": "status = 'closed'",
}


async def list_open_case_ids(pool: asyncpg.Pool) -> list[int]:
    query = "SELECT case_id FROM mailing.cases WHERE status = 'open' ORDER BY case_id ASC;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return [r["case_id"] for r in rows]


async def delete_cases(pool: asyncpg.Pool, scope: str) -> int:
    clause = _DELETE_SCOPE_CLAUSES[scope]
    query = f"DELETE FROM mailing.cases WHERE {clause} RETURNING case_id;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


_UPDATE_CASE_ALLOWED_COLUMNS = {"outcome", "status", "ai_stale", "ai_summary_override"}


async def update_case(pool: asyncpg.Pool, case_id: int, *, fields: dict[str, object]) -> bool:
    """Actualiza solo las columnas presentes en `fields` (nunca las demas).

    `fields` siempre lo arma el servicio a partir de los campos que el
    payload realmente trajo (exclude_unset) -- las claves estan
    restringidas a _UPDATE_CASE_ALLOWED_COLUMNS, nunca se usa una clave
    arbitraria como nombre de columna.
    """
    unknown = set(fields) - _UPDATE_CASE_ALLOWED_COLUMNS
    if unknown:
        raise ValueError(f"Columnas no permitidas en update_case: {unknown}")
    if not fields:
        query = "SELECT case_id FROM mailing.cases WHERE case_id = $1;"
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, case_id)
        return row is not None

    params: list[object] = [case_id]
    set_clauses = []
    for key, value in fields.items():
        params.append(value)
        set_clauses.append(f"{key} = ${len(params)}")

    query = f"""
        UPDATE mailing.cases
        SET {', '.join(set_clauses)}, updated_at = now()
        WHERE case_id = $1
        RETURNING case_id;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, *params)
    return row is not None


async def list_case_notes(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT note_id, body, created_at
        FROM mailing.case_notes
        WHERE case_id = $1
        ORDER BY created_at ASC, note_id ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def insert_case_note(pool: asyncpg.Pool, case_id: int, body: str) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.case_notes (case_id, body)
        VALUES ($1, $2)
        RETURNING note_id, body, created_at;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, body)


async def insert_case_evidence(
    pool: asyncpg.Pool,
    *,
    case_id: int,
    glosa: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
    content: bytes,
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.case_evidence (case_id, glosa, file_name, content_type, size_bytes, content)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING evidence_id, glosa, file_name, content_type, size_bytes, created_at;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, glosa, file_name, content_type, size_bytes, content)


async def list_case_evidence(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT evidence_id, glosa, file_name, content_type, size_bytes, created_at
        FROM mailing.case_evidence
        WHERE case_id = $1
        ORDER BY created_at ASC, evidence_id ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def list_case_evidence_with_content(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    """Igual que list_case_evidence pero trayendo tambien el binario -- lo usa
    el exportador de PDF para embeber cada imagen, evitando N consultas
    (una por evidencia) al armar el documento."""
    query = """
        SELECT evidence_id, glosa, file_name, content_type, size_bytes, content, created_at
        FROM mailing.case_evidence
        WHERE case_id = $1
        ORDER BY created_at ASC, evidence_id ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def get_case_evidence_content(pool: asyncpg.Pool, case_id: int, evidence_id: int) -> asyncpg.Record | None:
    query = """
        SELECT file_name, content_type, content
        FROM mailing.case_evidence
        WHERE case_id = $1 AND evidence_id = $2;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, evidence_id)


async def delete_case(pool: asyncpg.Pool, case_id: int) -> bool:
    query = "DELETE FROM mailing.cases WHERE case_id = $1 RETURNING case_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, case_id)
    return row is not None


async def list_cases(pool: asyncpg.Pool, limit: int) -> list[asyncpg.Record]:
    query = f"""
        SELECT {_SUMMARY_FIELDS}
        FROM mailing.v_case_summary
        ORDER BY case_id DESC
        LIMIT $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, limit)


async def get_case_summary(pool: asyncpg.Pool, case_id: int) -> asyncpg.Record | None:
    query = f"""
        SELECT {_SUMMARY_FIELDS}
        FROM mailing.v_case_summary
        WHERE case_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id)


async def list_case_messages(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT m.message_id, m.subject, m.from_address, m.to_addresses, m.cc_addresses,
               m.sent_datetime, m.has_attachments,
               m.body_preview, m.body_content, m.body_content_type, m.web_link,
               m.mailbox_account_id, ma.label AS mailbox_label,
               cm.relationship_type, cm.confidence, cm.correlation_source
        FROM mailing.case_messages cm
        JOIN mailing.messages m ON m.message_id = cm.message_id
        LEFT JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m.mailbox_account_id
        WHERE cm.case_id = $1
        ORDER BY m.sent_datetime ASC NULLS LAST;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def list_timeline_events(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT event_id, occurred_at, actor, action_type, description,
               source_message_id, source_attachment_id, determination_type, confidence
        FROM mailing.timeline_events
        WHERE case_id = $1
        ORDER BY occurred_at ASC NULLS LAST, event_id ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def get_timeline_event_case_status(pool: asyncpg.Pool, event_id: int) -> asyncpg.Record | None:
    query = """
        SELECT te.event_id, c.status
        FROM mailing.timeline_events te
        JOIN mailing.cases c ON c.case_id = te.case_id
        WHERE te.event_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, event_id)


async def update_timeline_event_determination(
    pool: asyncpg.Pool, event_id: int, determination_type: str
) -> asyncpg.Record | None:
    query = """
        UPDATE mailing.timeline_events
        SET determination_type = $1
        WHERE event_id = $2
        RETURNING event_id;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, determination_type, event_id)
