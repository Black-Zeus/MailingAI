from datetime import date
from uuid import UUID

import asyncpg

_RUN_FIELDS = """
    batch_run_id, status, case_type, total_keywords, processed_keywords,
    error_message, requested_at, started_at, finished_at,
    search_mailbox, mailbox_account_id, date_from, date_to,
    created_count, correlated_count, searched_count, requested_by_user_id
"""

_ITEM_FIELDS = "item_id, position, keyword, status, detail, case_id"


async def create_batch_run(
    pool: asyncpg.Pool,
    *,
    case_type: str,
    keywords: list[str],
    search_mailbox: bool = False,
    mailbox_account_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    requested_by_user_id: int,
) -> asyncpg.Record:
    async with pool.acquire() as conn:
        async with conn.transaction():
            run = await conn.fetchrow(
                f"""
                INSERT INTO mailing.case_batch_runs
                  (case_type, total_keywords, search_mailbox, mailbox_account_id, date_from, date_to, requested_by_user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING {_RUN_FIELDS};
                """,
                case_type,
                len(keywords),
                search_mailbox,
                mailbox_account_id,
                date_from,
                date_to,
                requested_by_user_id,
            )
            for position, keyword in enumerate(keywords):
                await conn.execute(
                    """
                    INSERT INTO mailing.case_batch_run_items (batch_run_id, position, keyword)
                    VALUES ($1, $2, $3);
                    """,
                    run["batch_run_id"],
                    position,
                    keyword,
                )
    return run


async def get_batch_run(
    pool: asyncpg.Pool, batch_run_id: UUID, *, user_id: int, is_admin: bool
) -> asyncpg.Record | None:
    query = f"""
        SELECT {_RUN_FIELDS} FROM mailing.case_batch_runs
        WHERE batch_run_id = $1 AND ($3 OR requested_by_user_id = $2);
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, batch_run_id, user_id, is_admin)


async def get_batch_run_unscoped(pool: asyncpg.Pool, batch_run_id: UUID) -> asyncpg.Record | None:
    """Sin filtro de dueño -- solo para uso interno de run_batch (background
    task, ya corre con los privilegios de todo el sistema)."""
    query = f"SELECT {_RUN_FIELDS} FROM mailing.case_batch_runs WHERE batch_run_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, batch_run_id)


async def get_latest_batch_run(pool: asyncpg.Pool, *, user_id: int, is_admin: bool) -> asyncpg.Record | None:
    query = f"""
        SELECT {_RUN_FIELDS} FROM mailing.case_batch_runs
        WHERE $2 OR requested_by_user_id = $1
        ORDER BY requested_at DESC LIMIT 1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, user_id, is_admin)


async def list_batch_items(pool: asyncpg.Pool, batch_run_id: UUID) -> list[asyncpg.Record]:
    query = f"""
        SELECT {_ITEM_FIELDS} FROM mailing.case_batch_run_items
        WHERE batch_run_id = $1
        ORDER BY position ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, batch_run_id)


async def mark_batch_running(pool: asyncpg.Pool, batch_run_id: UUID) -> None:
    query = """
        UPDATE mailing.case_batch_runs
        SET status = 'running', started_at = now()
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id)


async def update_item_status(
    pool: asyncpg.Pool,
    item_id: int,
    *,
    status: str,
    detail: str | None = None,
    case_id: int | None = None,
) -> None:
    query = """
        UPDATE mailing.case_batch_run_items
        SET status = $2, detail = $3, case_id = $4
        WHERE item_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, item_id, status, detail, case_id)


async def update_batch_progress(pool: asyncpg.Pool, batch_run_id: UUID, *, processed_keywords: int) -> None:
    query = """
        UPDATE mailing.case_batch_runs
        SET processed_keywords = $2
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, processed_keywords)


async def update_batch_created_count(pool: asyncpg.Pool, batch_run_id: UUID, *, count: int) -> None:
    query = "UPDATE mailing.case_batch_runs SET created_count = $2 WHERE batch_run_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, count)


async def update_batch_correlated_count(pool: asyncpg.Pool, batch_run_id: UUID, *, count: int) -> None:
    query = "UPDATE mailing.case_batch_runs SET correlated_count = $2 WHERE batch_run_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, count)


async def update_batch_searched_count(pool: asyncpg.Pool, batch_run_id: UUID, *, count: int) -> None:
    query = "UPDATE mailing.case_batch_runs SET searched_count = $2 WHERE batch_run_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, count)


async def mark_batch_finished(
    pool: asyncpg.Pool, batch_run_id: UUID, *, status: str, error_message: str | None
) -> None:
    query = """
        UPDATE mailing.case_batch_runs
        SET status = $2, error_message = $3, finished_at = now()
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, status, error_message)


async def fail_orphaned_batch_runs(pool: asyncpg.Pool) -> int:
    """Igual que ai_batch_repository.fail_orphaned_batch_runs -- se llama al
    arrancar el backend para cerrar cualquier corrida que haya quedado
    'queued'/'running' porque el proceso que la corria (BackgroundTasks)
    murio junto con un reinicio/redeploy del contenedor.
    """
    query = """
        UPDATE mailing.case_batch_runs
        SET status = 'failed',
            error_message = 'Interrumpida por un reinicio del backend antes de terminar.',
            finished_at = now()
        WHERE status IN ('queued', 'running')
        RETURNING batch_run_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)
