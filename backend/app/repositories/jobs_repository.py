import json
from typing import Any
from uuid import UUID

import asyncpg

_SELECT_FIELDS = """
    job_id, job_type, status, current_stage, parameters,
    processed_items, total_items, requested_at, started_at,
    finished_at, error_code, error_message, retry_count, retry_of_job_id, fetch_run_id,
    chart_id
"""

# n8n nunca llena processed_items/total_items (ver Postgres: Mark Success en
# el workflow 07 -- solo guarda fetch_run_id/chart_id), asi que la cantidad
# real de resultados sale de mailing.fetch_runs.total_messages via el join.
_SELECT_FIELDS_WITH_COUNT = """
    j.job_id, j.job_type, j.status, j.current_stage, j.parameters,
    j.processed_items, j.total_items, j.requested_at, j.started_at,
    j.finished_at, j.error_code, j.error_message, j.retry_count, j.retry_of_job_id, j.fetch_run_id,
    j.chart_id, fr.total_messages
"""
_FROM_JOIN_FETCH_RUNS = """
    FROM mailing.analysis_jobs j
    LEFT JOIN mailing.fetch_runs fr ON fr.run_id = j.fetch_run_id
"""


async def insert_job(
    pool: asyncpg.Pool, job_type: str, parameters: dict[str, Any]
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.analysis_jobs (job_type, parameters)
        VALUES ($1, $2::jsonb)
        RETURNING job_id, job_type, status, requested_at;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, job_type, json.dumps(parameters))


async def insert_retry_job(
    pool: asyncpg.Pool,
    *,
    job_type: str,
    parameters: dict[str, Any],
    retry_count: int,
    retry_of_job_id: UUID,
) -> asyncpg.Record:
    query = """
        INSERT INTO mailing.analysis_jobs (job_type, parameters, retry_count, retry_of_job_id)
        VALUES ($1, $2::jsonb, $3, $4)
        RETURNING job_id, job_type, status, requested_at;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            query, job_type, json.dumps(parameters), retry_count, retry_of_job_id
        )


async def get_job(pool: asyncpg.Pool, job_id: UUID) -> asyncpg.Record | None:
    query = f"""
        SELECT {_SELECT_FIELDS_WITH_COUNT}
        {_FROM_JOIN_FETCH_RUNS}
        WHERE j.job_id = $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, job_id)


_DELETE_SCOPE_CLAUSES = {
    "failed": "status = 'failed'",
    "finished": "status IN ('success', 'failed')",
    "all-inactive": "status NOT IN ('queued', 'running')",
}


async def delete_jobs(pool: asyncpg.Pool, scope: str) -> int:
    clause = _DELETE_SCOPE_CLAUSES[scope]
    query = f"DELETE FROM mailing.analysis_jobs WHERE {clause} RETURNING job_id;"
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


async def delete_job(pool: asyncpg.Pool, job_id: UUID) -> bool:
    query = "DELETE FROM mailing.analysis_jobs WHERE job_id = $1 RETURNING job_id;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, job_id)
    return row is not None


async def cancel_job(pool: asyncpg.Pool, job_id: UUID) -> asyncpg.Record | None:
    """Cancelacion 'suave': marca el job como cancelled solo si sigue queued/running.

    No detiene la ejecucion de n8n que ya esta en curso (no hay integracion con
    la API de administracion de n8n para eso) -- si esa ejecucion termina
    despues, sus nodos "Mark Success"/"Mark Failed" tienen guarda
    `AND status != 'cancelled'` para no pisar la cancelacion.
    """
    query = f"""
        UPDATE mailing.analysis_jobs
        SET status = 'cancelled', finished_at = now(), updated_at = now()
        WHERE job_id = $1 AND status IN ('queued', 'running')
        RETURNING {_SELECT_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, job_id)


async def mark_job_failed_to_dispatch(
    pool: asyncpg.Pool, job_id: UUID, error_message: str
) -> None:
    """Marca como failed un job que nunca llego a n8n (el POST al webhook fallo).

    Solo afecta jobs todavia en 'queued': si n8n ya llego a marcarlo running/
    success/failed por su cuenta, esta funcion no debe pisar ese resultado.
    """
    query = """
        UPDATE mailing.analysis_jobs
        SET status = 'failed', error_message = $2, finished_at = now(), updated_at = now()
        WHERE job_id = $1 AND status = 'queued';
    """
    async with pool.acquire() as conn:
        await conn.execute(query, job_id, error_message)


async def list_jobs(
    pool: asyncpg.Pool, limit: int, status: str | None
) -> list[asyncpg.Record]:
    if status is not None:
        query = f"""
            SELECT {_SELECT_FIELDS_WITH_COUNT}
            {_FROM_JOIN_FETCH_RUNS}
            WHERE j.status = $1
            ORDER BY j.requested_at DESC
            LIMIT $2;
        """
        async with pool.acquire() as conn:
            return await conn.fetch(query, status, limit)

    query = f"""
        SELECT {_SELECT_FIELDS_WITH_COUNT}
        {_FROM_JOIN_FETCH_RUNS}
        ORDER BY j.requested_at DESC
        LIMIT $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, limit)
