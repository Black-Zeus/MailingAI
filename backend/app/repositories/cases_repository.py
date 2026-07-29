from datetime import datetime

import asyncpg

_SUMMARY_FIELDS = """
    case_id, case_type, external_code, title, status, confidence,
    message_count, first_message_at, last_message_at, outcome, has_successful_ai_run, ai_stale,
    has_own_reply, owner_user_id
"""

# Un usuario ve un expediente si es admin, si es el dueño, o si tiene una
# fila en case_shares (cualquier permiso). Reusado en cada query que resuelve
# un case_id puntual o lista expedientes -- asi es imposible que una nueva
# funcion se olvide del filtro (queda en un solo lugar, no copiado a mano).
def _access_clause(*, table_alias: str, case_id_param: str, is_admin_param: str, user_id_param: str) -> str:
    return f"""(
        {is_admin_param}
        OR {table_alias}.owner_user_id = {user_id_param}
        OR EXISTS (
            SELECT 1 FROM mailing.case_shares cs
            WHERE cs.case_id = {case_id_param} AND cs.user_id = {user_id_param}
        )
    )"""


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
    owner_user_id: int | None,
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.cases (title, case_type, external_code, primary_message_id, owner_user_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING case_id;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, title, case_type, external_code, primary_message_id, owner_user_id)


async def get_case_core(
    pool: asyncpg.Pool, case_id: int, *, user_id: int, is_admin: bool
) -> asyncpg.Record | None:
    """Devuelve la fila solo si el usuario tiene acceso de lectura (dueño,
    compartido, o admin) -- si no, None, indistinguible de "no existe" para
    quien llama (evita confirmar la existencia de expedientes ajenos)."""
    access = _access_clause(table_alias="c", case_id_param="c.case_id", is_admin_param="$3", user_id_param="$2")
    edit_access = """(
        $3
        OR c.owner_user_id = $2
        OR EXISTS (
            SELECT 1 FROM mailing.case_shares cs
            WHERE cs.case_id = c.case_id AND cs.user_id = $2 AND cs.permission = 'edit'
        )
    )"""
    query = f"""
        SELECT c.case_id, c.case_type, c.external_code, c.primary_message_id, c.status, c.outcome, c.title,
               c.owner_user_id, {edit_access} AS can_edit
        FROM mailing.cases c
        WHERE c.case_id = $1 AND {access};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, user_id, is_admin)


async def get_case_ai_summary_override(pool: asyncpg.Pool, case_id: int) -> str | None:
    query = "SELECT ai_summary_override FROM mailing.cases WHERE case_id = $1;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, case_id)
    return row["ai_summary_override"] if row is not None else None


async def get_message_core(pool: asyncpg.Pool, message_id: str) -> asyncpg.Record | None:
    query = """
        SELECT message_id, conversation_id, subject, from_address, to_addresses, cc_addresses,
               sent_datetime, mailbox_account_id
        FROM mailing.messages
        WHERE message_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, message_id)


async def find_messages_by_conversation(
    pool: asyncpg.Pool, conversation_id: str, *, accessible_mailbox_ids: list[int] | None
) -> list[asyncpg.Record]:
    access_clause = "AND mailbox_account_id = ANY($2::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT message_id, subject, from_address, sent_datetime
        FROM mailing.messages
        WHERE conversation_id = $1 {access_clause}
        ORDER BY sent_datetime ASC NULLS LAST;
    """
    params = [conversation_id] if accessible_mailbox_ids is None else [conversation_id, accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def find_messages_by_cr_keyword(
    pool: asyncpg.Pool, keyword: str, *, accessible_mailbox_ids: list[int] | None
) -> list[asyncpg.Record]:
    access_clause = "AND m.mailbox_account_id = ANY($2::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT DISTINCT m.message_id, m.subject, m.from_address, m.sent_datetime
        FROM mailing.messages m
        LEFT JOIN mailing.message_attachments a ON a.message_id = m.message_id
        WHERE (m.subject ILIKE $1 OR m.body_content ILIKE $1 OR a.file_name ILIKE $1) {access_clause}
        ORDER BY m.sent_datetime ASC NULLS LAST;
    """
    params = [f"%{keyword}%"] if accessible_mailbox_ids is None else [f"%{keyword}%", accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def find_heuristic_related(
    pool: asyncpg.Pool,
    *,
    exclude_message_id: str,
    normalized_subject: str,
    participants: list[str],
    date_from: datetime | None,
    date_to: datetime | None,
    accessible_mailbox_ids: list[int] | None,
) -> list[asyncpg.Record]:
    if not normalized_subject or not participants:
        return []
    access_clause = "AND mailbox_account_id = ANY($6::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
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
          {access_clause}
        ORDER BY sent_datetime ASC NULLS LAST;
    """
    params = [exclude_message_id, f"%{normalized_subject}%", participants, date_from, date_to]
    if accessible_mailbox_ids is not None:
        params.append(accessible_mailbox_ids)
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


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


async def list_open_case_ids(pool: asyncpg.Pool, *, user_id: int, is_admin: bool) -> list[int]:
    access = _access_clause(table_alias="c", case_id_param="c.case_id", is_admin_param="$2", user_id_param="$1")
    query = f"""
        SELECT c.case_id FROM mailing.cases c
        WHERE c.status = 'open' AND {access}
        ORDER BY c.case_id ASC;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, is_admin)
    return [r["case_id"] for r in rows]


async def delete_cases(pool: asyncpg.Pool, scope: str, *, user_id: int, is_admin: bool) -> int:
    scope_clause = _DELETE_SCOPE_CLAUSES[scope]
    access = _access_clause(table_alias="c", case_id_param="c.case_id", is_admin_param="$2", user_id_param="$1")
    query = f"DELETE FROM mailing.cases c WHERE {scope_clause.replace('status', 'c.status')} AND {access} RETURNING c.case_id;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, is_admin)
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


async def delete_case(pool: asyncpg.Pool, case_id: int, *, user_id: int, is_admin: bool) -> bool:
    access = _access_clause(table_alias="c", case_id_param="c.case_id", is_admin_param="$3", user_id_param="$2")
    query = f"DELETE FROM mailing.cases c WHERE c.case_id = $1 AND {access} RETURNING c.case_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, case_id, user_id, is_admin)
    return row is not None


async def list_cases(pool: asyncpg.Pool, limit: int, *, user_id: int, is_admin: bool) -> list[asyncpg.Record]:
    access = _access_clause(
        table_alias="vs", case_id_param="vs.case_id", is_admin_param="$2", user_id_param="$3"
    )
    query = f"""
        SELECT {_SUMMARY_FIELDS}
        FROM mailing.v_case_summary vs
        WHERE {access}
        ORDER BY case_id DESC
        LIMIT $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, limit, is_admin, user_id)


async def get_case_summary(pool: asyncpg.Pool, case_id: int, *, user_id: int, is_admin: bool) -> asyncpg.Record | None:
    access = _access_clause(
        table_alias="vs", case_id_param="vs.case_id", is_admin_param="$3", user_id_param="$2"
    )
    query = f"""
        SELECT {_SUMMARY_FIELDS}
        FROM mailing.v_case_summary vs
        WHERE vs.case_id = $1 AND {access};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, user_id, is_admin)


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


async def get_timeline_event_case_status(
    pool: asyncpg.Pool, event_id: int, *, user_id: int, is_admin: bool
) -> asyncpg.Record | None:
    """Entra por event_id, no por case_id -- necesita su propio chequeo de
    acceso (no pasa por get_case_core en el camino)."""
    access = _access_clause(table_alias="c", case_id_param="c.case_id", is_admin_param="$3", user_id_param="$2")
    query = f"""
        SELECT te.event_id, c.status
        FROM mailing.timeline_events te
        JOIN mailing.cases c ON c.case_id = te.case_id
        WHERE te.event_id = $1 AND {access};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, event_id, user_id, is_admin)


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


async def list_case_shares(pool: asyncpg.Pool, case_id: int) -> list[asyncpg.Record]:
    query = """
        SELECT cs.case_id, cs.user_id, cs.permission, cs.shared_by_user_id, cs.created_at,
               u.email_address, u.display_name
        FROM mailing.case_shares cs
        JOIN identity.users u ON u.user_id = cs.user_id
        WHERE cs.case_id = $1
        ORDER BY cs.created_at ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, case_id)


async def upsert_case_share(
    pool: asyncpg.Pool, *, case_id: int, user_id: int, permission: str, shared_by_user_id: int
) -> asyncpg.Record:
    query = """
        WITH upserted AS (
            INSERT INTO mailing.case_shares (case_id, user_id, permission, shared_by_user_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (case_id, user_id) DO UPDATE SET
                permission = EXCLUDED.permission,
                shared_by_user_id = EXCLUDED.shared_by_user_id
            RETURNING case_id, user_id, permission, shared_by_user_id, created_at
        )
        SELECT upserted.*, u.email_address, u.display_name
        FROM upserted JOIN identity.users u ON u.user_id = upserted.user_id;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, case_id, user_id, permission, shared_by_user_id)


async def delete_case_share(pool: asyncpg.Pool, case_id: int, user_id: int) -> bool:
    query = "DELETE FROM mailing.case_shares WHERE case_id = $1 AND user_id = $2 RETURNING user_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, case_id, user_id)
    return row is not None


async def cascade_revoke_user_mailbox_access(
    pool: asyncpg.Pool, *, user_id: int, mailbox_account_id: int
) -> dict[str, int]:
    """Se llama cuando a un usuario se le quita el acceso a un buzon (share
    revocado o dueño removido): le quita tambien el acceso a cualquier
    expediente que tenga al menos un mensaje de ese buzon.

    - Si era dueño del expediente, el expediente queda sin dueño
      (owner_user_id = NULL, igual que un expediente preexistente sin migrar
      -- nunca se borra, solo pasa a ser visible unicamente para un admin).
    - Si el expediente le habia sido compartido, se borra esa fila de
      case_shares.

    Devuelve cuantos expedientes se vieron afectados de cada forma, para que
    el llamador pueda avisarle al usuario que disparo la accion.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            owner_rows = await conn.fetch(
                """
                UPDATE mailing.cases c
                SET owner_user_id = NULL, updated_at = now()
                WHERE c.owner_user_id = $1
                  AND EXISTS (
                    SELECT 1 FROM mailing.case_messages cm
                    JOIN mailing.messages m ON m.message_id = cm.message_id
                    WHERE cm.case_id = c.case_id AND m.mailbox_account_id = $2
                  )
                RETURNING c.case_id;
                """,
                user_id,
                mailbox_account_id,
            )
            share_rows = await conn.fetch(
                """
                DELETE FROM mailing.case_shares cs
                WHERE cs.user_id = $1
                  AND EXISTS (
                    SELECT 1 FROM mailing.case_messages cm
                    JOIN mailing.messages m ON m.message_id = cm.message_id
                    WHERE cm.case_id = cs.case_id AND m.mailbox_account_id = $2
                  )
                RETURNING cs.case_id;
                """,
                user_id,
                mailbox_account_id,
            )
    return {"ownership_cleared": len(owner_rows), "shares_removed": len(share_rows)}
