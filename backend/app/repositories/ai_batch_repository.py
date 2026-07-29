from uuid import UUID

import asyncpg

_FIELDS = """
    batch_run_id, status, total_cases, processed_cases, succeeded_cases,
    failed_cases, error_message, requested_at, started_at, finished_at
"""


async def list_pending_case_ids(pool: asyncpg.Pool) -> list[int]:
    query = """
        SELECT c.case_id
        FROM mailing.cases c
        WHERE NOT EXISTS (
            SELECT 1 FROM mailing.ai_runs ar
            WHERE ar.case_id = c.case_id AND ar.status = 'success'
        )
        ORDER BY c.case_id ASC;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return [r["case_id"] for r in rows]


async def create_batch_run(pool: asyncpg.Pool, total_cases: int) -> asyncpg.Record:
    query = f"""
        INSERT INTO mailing.ai_batch_runs (total_cases)
        VALUES ($1)
        RETURNING {_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, total_cases)


async def get_batch_run(pool: asyncpg.Pool, batch_run_id: UUID) -> asyncpg.Record | None:
    query = f"SELECT {_FIELDS} FROM mailing.ai_batch_runs WHERE batch_run_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, batch_run_id)


async def get_latest_batch_run(pool: asyncpg.Pool) -> asyncpg.Record | None:
    query = f"""
        SELECT {_FIELDS} FROM mailing.ai_batch_runs
        ORDER BY requested_at DESC LIMIT 1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def mark_batch_running(pool: asyncpg.Pool, batch_run_id: UUID) -> None:
    query = """
        UPDATE mailing.ai_batch_runs
        SET status = 'running', started_at = now()
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id)


async def update_batch_progress(
    pool: asyncpg.Pool, batch_run_id: UUID, *, processed_cases: int, succeeded_cases: int, failed_cases: int
) -> None:
    query = """
        UPDATE mailing.ai_batch_runs
        SET processed_cases = $2, succeeded_cases = $3, failed_cases = $4
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, processed_cases, succeeded_cases, failed_cases)


async def mark_batch_finished(
    pool: asyncpg.Pool, batch_run_id: UUID, *, status: str, error_message: str | None
) -> None:
    query = """
        UPDATE mailing.ai_batch_runs
        SET status = $2, error_message = $3, finished_at = now()
        WHERE batch_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, batch_run_id, status, error_message)


async def fail_orphaned_batch_runs(pool: asyncpg.Pool) -> int:
    """Marca como 'failed' cualquier corrida que haya quedado 'queued'/'running'.

    Se llama al arrancar el backend: si hay una fila asi, es porque el
    proceso que la estaba corriendo (BackgroundTasks) murio junto con un
    reinicio/redeploy del contenedor -- nadie mas la va a terminar nunca.
    Lo ya procesado antes del reinicio no se pierde (son escrituras reales
    en ai_runs), pero la corrida en si queda huerfana y hay que cerrarla
    explicitamente en vez de dejarla en 'running' para siempre.
    """
    query = """
        UPDATE mailing.ai_batch_runs
        SET status = 'failed',
            error_message = 'Interrumpida por un reinicio del backend antes de terminar.',
            finished_at = now()
        WHERE status IN ('queued', 'running')
        RETURNING batch_run_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)
