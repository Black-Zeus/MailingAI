from datetime import datetime

import asyncpg

_MAILBOX_JOIN = "LEFT JOIN identity.mailbox_accounts ma ON ma.mailbox_account_id = m.mailbox_account_id"

_LIST_FIELDS = """
    m.message_id, m.conversation_id, m.subject, m.from_address, m.from_name,
    m.sent_datetime, m.has_attachments, m.is_sent, m.folder_id, f.folder_path,
    m.mailbox_account_id, ma.label AS mailbox_label
"""

_DETAIL_FIELDS = """
    m.message_id, m.conversation_id, m.internet_message_id, m.subject,
    m.from_address, m.from_name, m.to_addresses, m.cc_addresses,
    m.sent_datetime, m.received_datetime, m.has_attachments, m.importance,
    m.is_sent, m.categories, m.body_preview, m.body_content, m.body_content_type,
    m.web_link, m.folder_id, f.folder_path,
    m.mailbox_account_id, ma.label AS mailbox_label
"""


def _build_message_conditions(
    *,
    folder_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_address: str | None,
    subject_contains: str | None,
    text_search: str | None,
    text_contains: str | None,
    conversation_id: str | None,
    is_sent: bool | None,
    has_attachments: bool | None,
    attachment_pattern: str | None,
    mailbox_account_id: int | None,
    accessible_mailbox_ids: list[int] | None,
) -> tuple[list[str], list[object], int | None]:
    conditions: list[str] = []
    params: list[object] = []
    text_search_index: int | None = None

    def add(condition_template: str, value: object) -> None:
        params.append(value)
        conditions.append(condition_template.format(len(params)))

    # accessible_mailbox_ids es None solo para admin (sin restriccion). Para
    # el resto es una lista real -- incluso vacia, que entonces no matchea
    # ningun mensaje (ANY sobre lista vacia = false), en vez de devolver todo.
    if accessible_mailbox_ids is not None:
        add("m.mailbox_account_id = ANY(${}::bigint[])", accessible_mailbox_ids)

    if folder_id is not None:
        add("m.folder_id = ${}", folder_id)
    if date_from is not None:
        add("m.sent_datetime >= ${}", date_from)
    if date_to is not None:
        add("m.sent_datetime <= ${}", date_to)
    if from_address is not None:
        add("m.from_address ILIKE ${}", f"%{from_address}%")
    if subject_contains is not None:
        add("m.subject ILIKE ${}", f"%{subject_contains}%")
    if text_search is not None:
        params.append(text_search)
        text_search_index = len(params)
        conditions.append(f"m.search_vector @@ websearch_to_tsquery('spanish', ${text_search_index})")
    if text_contains is not None:
        params.append(f"%{text_contains}%")
        idx = len(params)
        conditions.append(f"(m.subject ILIKE ${idx} OR m.body_content ILIKE ${idx})")
    if conversation_id is not None:
        add("m.conversation_id = ${}", conversation_id)
    if is_sent is not None:
        add("m.is_sent = ${}", is_sent)
    if has_attachments is not None:
        add("m.has_attachments = ${}", has_attachments)
    if attachment_pattern is not None:
        add(
            "EXISTS (SELECT 1 FROM mailing.message_attachments ma "
            "WHERE ma.message_id = m.message_id AND ma.file_name ~* ${})",
            attachment_pattern,
        )
    if mailbox_account_id is not None:
        add("m.mailbox_account_id = ${}", mailbox_account_id)

    return conditions, params, text_search_index


class InvalidAttachmentPatternError(Exception):
    """El patron de adjuntos no es una expresion regular valida para Postgres."""


async def list_messages(
    pool: asyncpg.Pool,
    *,
    folder_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_address: str | None,
    subject_contains: str | None,
    text_search: str | None,
    text_contains: str | None,
    conversation_id: str | None,
    is_sent: bool | None,
    has_attachments: bool | None,
    attachment_pattern: str | None,
    mailbox_account_id: int | None,
    accessible_mailbox_ids: list[int] | None,
    limit: int,
    offset: int,
) -> list[asyncpg.Record]:
    conditions, params, text_search_index = _build_message_conditions(
        folder_id=folder_id,
        date_from=date_from,
        date_to=date_to,
        from_address=from_address,
        subject_contains=subject_contains,
        text_search=text_search,
        text_contains=text_contains,
        conversation_id=conversation_id,
        is_sent=is_sent,
        has_attachments=has_attachments,
        attachment_pattern=attachment_pattern,
        mailbox_account_id=mailbox_account_id,
        accessible_mailbox_ids=accessible_mailbox_ids,
    )

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    if text_search_index is not None:
        order_clause = (
            f"ORDER BY ts_rank(m.search_vector, websearch_to_tsquery('spanish', ${text_search_index})) DESC, "
            "m.sent_datetime DESC NULLS LAST"
        )
    else:
        order_clause = "ORDER BY m.sent_datetime DESC NULLS LAST"
    params.append(limit)
    limit_index = len(params)
    params.append(offset)
    offset_index = len(params)

    query = f"""
        SELECT {_LIST_FIELDS}
        FROM mailing.messages m
        LEFT JOIN mailing.mail_folders f ON f.folder_id = m.folder_id
        {_MAILBOX_JOIN}
        {where_clause}
        {order_clause}
        LIMIT ${limit_index} OFFSET ${offset_index};
    """
    async with pool.acquire() as conn:
        try:
            return await conn.fetch(query, *params)
        except asyncpg.exceptions.InvalidRegularExpressionError as exc:
            raise InvalidAttachmentPatternError(str(exc)) from exc


async def count_messages(
    pool: asyncpg.Pool,
    *,
    folder_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_address: str | None,
    subject_contains: str | None,
    text_search: str | None,
    text_contains: str | None,
    conversation_id: str | None,
    is_sent: bool | None,
    has_attachments: bool | None,
    attachment_pattern: str | None,
    mailbox_account_id: int | None,
    accessible_mailbox_ids: list[int] | None,
) -> int:
    conditions, params, _ = _build_message_conditions(
        folder_id=folder_id,
        date_from=date_from,
        date_to=date_to,
        from_address=from_address,
        subject_contains=subject_contains,
        text_search=text_search,
        text_contains=text_contains,
        conversation_id=conversation_id,
        is_sent=is_sent,
        has_attachments=has_attachments,
        attachment_pattern=attachment_pattern,
        mailbox_account_id=mailbox_account_id,
        accessible_mailbox_ids=accessible_mailbox_ids,
    )
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT count(*) FROM mailing.messages m {where_clause};"
    async with pool.acquire() as conn:
        try:
            return await conn.fetchval(query, *params)
        except asyncpg.exceptions.InvalidRegularExpressionError as exc:
            raise InvalidAttachmentPatternError(str(exc)) from exc


async def get_message(
    pool: asyncpg.Pool, message_id: str, *, accessible_mailbox_ids: list[int] | None
) -> asyncpg.Record | None:
    access_clause = "AND m.mailbox_account_id = ANY($2::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT {_DETAIL_FIELDS}
        FROM mailing.messages m
        LEFT JOIN mailing.mail_folders f ON f.folder_id = m.folder_id
        {_MAILBOX_JOIN}
        WHERE m.message_id = $1 {access_clause};
    """
    params = [message_id] if accessible_mailbox_ids is None else [message_id, accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *params)


async def list_attachments_for_message(
    pool: asyncpg.Pool, message_id: str
) -> list[asyncpg.Record]:
    query = """
        SELECT attachment_id, file_name, extension, content_type, size_bytes,
               file_date, matches_naming_convention, matches_search_pattern,
               content_sha256
        FROM mailing.message_attachments
        WHERE message_id = $1
        ORDER BY file_name;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, message_id)


async def list_attachments_for_messages(
    pool: asyncpg.Pool, message_ids: list[str]
) -> list[asyncpg.Record]:
    if not message_ids:
        return []
    query = """
        SELECT message_id, attachment_id, file_name, extension, content_type, size_bytes,
               file_date, matches_naming_convention, matches_search_pattern,
               content_sha256
        FROM mailing.message_attachments
        WHERE message_id = ANY($1::text[])
        ORDER BY file_name;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, message_ids)


async def set_attachment_hash(
    pool: asyncpg.Pool, message_id: str, attachment_id: str, sha256: str
) -> None:
    query = """
        UPDATE mailing.message_attachments
        SET content_sha256 = $3, content_sha256_computed_at = now()
        WHERE message_id = $1 AND attachment_id = $2;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, message_id, attachment_id, sha256)


async def delete_attachment(pool: asyncpg.Pool, message_id: str, attachment_id: str) -> bool:
    """Borra solo el registro de trazabilidad local -- nunca toca Graph ni el
    correo real. Si el mensaje se vuelve a indexar/retrazar, el adjunto puede
    reaparecer (mismo comportamiento que un mensaje borrado y reindexado)."""
    query = """
        DELETE FROM mailing.message_attachments
        WHERE message_id = $1 AND attachment_id = $2
        RETURNING attachment_row_id;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, message_id, attachment_id)
    return row is not None


async def list_all_attachments(
    pool: asyncpg.Pool,
    *,
    file_name_contains: str | None,
    extension: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    only_hashed: bool | None,
    only_linked_to_case: bool | None,
    accessible_mailbox_ids: list[int] | None,
    limit: int,
    offset: int,
) -> list[asyncpg.Record]:
    conditions: list[str] = []
    params: list[object] = []

    def add(condition_template: str, value: object) -> None:
        params.append(value)
        conditions.append(condition_template.format(len(params)))

    if accessible_mailbox_ids is not None:
        add("m.mailbox_account_id = ANY(${}::bigint[])", accessible_mailbox_ids)
    if file_name_contains is not None:
        add("a.file_name ILIKE ${}", f"%{file_name_contains}%")
    if extension is not None:
        add("a.extension = ${}", extension.lower().lstrip("."))
    if date_from is not None:
        add("m.sent_datetime >= ${}", date_from)
    if date_to is not None:
        add("m.sent_datetime <= ${}", date_to)
    if only_hashed is True:
        conditions.append("a.content_sha256 IS NOT NULL")
    elif only_hashed is False:
        conditions.append("a.content_sha256 IS NULL")
    if only_linked_to_case is True:
        conditions.append("EXISTS (SELECT 1 FROM mailing.case_messages cm WHERE cm.message_id = a.message_id)")
    elif only_linked_to_case is False:
        conditions.append(
            "NOT EXISTS (SELECT 1 FROM mailing.case_messages cm WHERE cm.message_id = a.message_id)"
        )

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    limit_index = len(params)
    params.append(offset)
    offset_index = len(params)

    query = f"""
        SELECT
            a.attachment_id, a.message_id, a.file_name, a.extension, a.content_type,
            a.size_bytes, a.file_date, a.matches_naming_convention, a.matches_search_pattern,
            a.content_sha256, a.content_sha256_computed_at,
            m.subject AS message_subject, m.from_address AS message_from_address,
            m.sent_datetime AS message_sent_datetime, f.folder_path,
            m.mailbox_account_id, ma.label AS mailbox_label,
            EXISTS (SELECT 1 FROM mailing.case_messages cm WHERE cm.message_id = a.message_id) AS linked_to_case
        FROM mailing.message_attachments a
        JOIN mailing.messages m ON m.message_id = a.message_id
        LEFT JOIN mailing.mail_folders f ON f.folder_id = m.folder_id
        {_MAILBOX_JOIN}
        {where_clause}
        ORDER BY m.sent_datetime DESC NULLS LAST
        LIMIT ${limit_index} OFFSET ${offset_index};
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def get_conversation_summary(
    pool: asyncpg.Pool, conversation_id: str
) -> asyncpg.Record | None:
    query = """
        SELECT conversation_id, message_count, first_message_at, last_message_at, participants
        FROM mailing.v_conversation_summary
        WHERE conversation_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, conversation_id)


async def list_messages_in_conversation(
    pool: asyncpg.Pool, conversation_id: str, *, accessible_mailbox_ids: list[int] | None
) -> list[asyncpg.Record]:
    access_clause = "AND m.mailbox_account_id = ANY($2::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT {_LIST_FIELDS}
        FROM mailing.messages m
        LEFT JOIN mailing.mail_folders f ON f.folder_id = m.folder_id
        {_MAILBOX_JOIN}
        WHERE m.conversation_id = $1 {access_clause}
        ORDER BY m.sent_datetime ASC NULLS LAST;
    """
    params = [conversation_id] if accessible_mailbox_ids is None else [conversation_id, accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def list_messages_by_run(
    pool: asyncpg.Pool, run_id: int, *, accessible_mailbox_ids: list[int] | None
) -> list[asyncpg.Record]:
    access_clause = "AND m.mailbox_account_id = ANY($2::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT {_LIST_FIELDS}
        FROM mailing.messages m
        LEFT JOIN mailing.mail_folders f ON f.folder_id = m.folder_id
        {_MAILBOX_JOIN}
        WHERE m.run_id = $1 {access_clause}
        ORDER BY m.sent_datetime DESC NULLS LAST;
    """
    params = [run_id] if accessible_mailbox_ids is None else [run_id, accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def delete_all_messages(pool: asyncpg.Pool) -> int:
    query = "DELETE FROM mailing.messages RETURNING message_id;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


async def delete_messages_by_date_range(
    pool: asyncpg.Pool, date_from: datetime, date_to: datetime
) -> int:
    query = """
        DELETE FROM mailing.messages
        WHERE sent_datetime >= $1 AND sent_datetime <= $2
        RETURNING message_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, date_from, date_to)
    return len(rows)


async def delete_messages_by_folder(pool: asyncpg.Pool, folder_id: str) -> int:
    query = "DELETE FROM mailing.messages WHERE folder_id = $1 RETURNING message_id;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, folder_id)
    return len(rows)


async def delete_unlinked_messages(pool: asyncpg.Pool) -> int:
    query = """
        DELETE FROM mailing.messages m
        WHERE NOT EXISTS (
            SELECT 1 FROM mailing.case_messages cm WHERE cm.message_id = m.message_id
        )
        RETURNING m.message_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


async def list_mail_folders(pool: asyncpg.Pool, *, accessible_mailbox_ids: list[int] | None) -> list[asyncpg.Record]:
    where_clause = "WHERE mailbox_account_id = ANY($1::bigint[])" if accessible_mailbox_ids is not None else ""
    query = f"""
        SELECT folder_id, parent_folder_id, display_name, folder_path,
               child_folder_count, total_item_count, last_sync_at
        FROM mailing.mail_folders
        {where_clause}
        ORDER BY folder_path NULLS LAST, display_name;
    """
    params = [] if accessible_mailbox_ids is None else [accessible_mailbox_ids]
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)


async def search_contacts(
    pool: asyncpg.Pool, *, pattern: str, accessible_mailbox_ids: list[int] | None, limit: int
) -> list[asyncpg.Record]:
    """Libreta de direcciones derivada de los correos ya indexados -- sin
    tabla propia ni paso de indexacion aparte: cualquier direccion que
    aparece como remitente (con nombre, via from_address/from_name -- indice
    trigram idx_messages_from_address_trgm/idx_messages_from_name_trgm) o
    como destinatario/copia (sin nombre, salvo que esa misma direccion
    tambien haya escrito alguna vez) de un mensaje visible para el usuario es
    candidata. to_addresses/cc_addresses son jsonb sin indice, pero son
    arrays chicos (pocos elementos por mensaje) -- el unnest es barato
    comparado con escanear subject/body_content."""
    from_where = "WHERE m.from_address IS NOT NULL AND m.from_address <> ''"
    unnest_where = ""
    params: list[object] = []
    if accessible_mailbox_ids is not None:
        params.append(accessible_mailbox_ids)
        from_where += " AND m.mailbox_account_id = ANY($1::bigint[])"
        unnest_where = "WHERE m.mailbox_account_id = ANY($1::bigint[])"
    params.append(f"%{pattern}%")
    pattern_idx = len(params)
    params.append(limit)
    limit_idx = len(params)

    query = f"""
        WITH contacts AS (
            SELECT lower(m.from_address) AS address, m.from_name AS display_name
            FROM mailing.messages m
            {from_where}
            UNION ALL
            SELECT lower(addr) AS address, NULL::text AS display_name
            FROM mailing.messages m, jsonb_array_elements_text(m.to_addresses) AS addr
            {unnest_where}
            UNION ALL
            SELECT lower(addr) AS address, NULL::text AS display_name
            FROM mailing.messages m, jsonb_array_elements_text(m.cc_addresses) AS addr
            {unnest_where}
        ),
        aggregated AS (
            SELECT address, max(display_name) AS display_name, count(*) AS occurrences
            FROM contacts
            WHERE address <> ''
            GROUP BY address
        )
        SELECT address, display_name, occurrences
        FROM aggregated
        WHERE address ILIKE ${pattern_idx} OR display_name ILIKE ${pattern_idx}
        ORDER BY occurrences DESC, address ASC
        LIMIT ${limit_idx};
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, *params)
