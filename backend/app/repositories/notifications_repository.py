import asyncpg

_FIELDS = "notification_id, kind, message, case_id, mailbox_account_id, created_by_user_id, read_at, created_at"


async def insert_notification(
    pool: asyncpg.Pool,
    *,
    user_id: int,
    kind: str,
    message: str,
    case_id: int | None = None,
    mailbox_account_id: int | None = None,
    created_by_user_id: int | None,
) -> None:
    query = """
        INSERT INTO identity.notifications
            (user_id, kind, message, case_id, mailbox_account_id, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6);
    """
    async with pool.acquire() as conn:
        await conn.execute(query, user_id, kind, message, case_id, mailbox_account_id, created_by_user_id)


async def list_notifications(pool: asyncpg.Pool, user_id: int, *, limit: int = 50) -> list[asyncpg.Record]:
    query = f"""
        SELECT {_FIELDS} FROM identity.notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, user_id, limit)


async def count_unread(pool: asyncpg.Pool, user_id: int) -> int:
    query = "SELECT count(*) FROM identity.notifications WHERE user_id = $1 AND read_at IS NULL;"
    async with pool.acquire() as conn:
        return await conn.fetchval(query, user_id)


async def mark_read(pool: asyncpg.Pool, notification_id: int, user_id: int) -> bool:
    query = """
        UPDATE identity.notifications
        SET read_at = now()
        WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL
        RETURNING notification_id;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, notification_id, user_id)
    return row is not None


async def mark_all_read(pool: asyncpg.Pool, user_id: int) -> int:
    query = """
        UPDATE identity.notifications
        SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL
        RETURNING notification_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id)
    return len(rows)
