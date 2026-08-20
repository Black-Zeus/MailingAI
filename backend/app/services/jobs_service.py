import json
import logging
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import charts_repository, jobs_repository
from app.schemas.jobs import JobCreatedResponse, JobRead
from app.services import n8n_client

logger = logging.getLogger(__name__)


def progress_percentage(processed_items: int, total_items: int | None) -> float | None:
    if not total_items:
        return None
    return round((processed_items / total_items) * 100, 2)


def _result_count(record: asyncpg.Record) -> int | None:
    """Cuantos resultados trajo el job -- n8n nunca llena processed_items, asi
    que se deriva de donde realmente queda el numero: 1 para un grafico
    (siempre genera exactamente uno) o mailing.fetch_runs.total_messages para
    cualquier job que haya hecho un fetch/discover/search (mensajes, carpetas
    o adjuntos segun el tipo de job). None si el job todavia no llego a
    ninguno de los dos (en cola, corriendo, o fallo antes de terminar)."""
    if record["chart_id"] is not None:
        return 1
    if "total_messages" in record.keys():
        return record["total_messages"]
    return None


class JobNotRetryableError(Exception):
    """El job existe pero no esta en un estado que se pueda reintentar (solo 'failed')."""


class JobNotDeletableError(Exception):
    """El job existe pero esta activo (queued/running) y no se puede eliminar todavia."""


class JobNotCancellableError(Exception):
    """El job existe pero ya esta en un estado terminal (no se puede cancelar)."""


def _to_job_read(record: asyncpg.Record) -> JobRead:
    parameters = record["parameters"]
    if isinstance(parameters, str):
        parameters = json.loads(parameters)
    return JobRead(
        job_id=record["job_id"],
        job_type=record["job_type"],
        status=record["status"],
        current_stage=record["current_stage"],
        parameters=parameters,
        processed_items=record["processed_items"],
        total_items=record["total_items"],
        progress_percentage=progress_percentage(
            record["processed_items"], record["total_items"]
        ),
        result_count=_result_count(record),
        requested_at=record["requested_at"],
        started_at=record["started_at"],
        finished_at=record["finished_at"],
        error_code=record["error_code"],
        error_message=record["error_message"],
        retry_count=record["retry_count"],
        retry_of_job_id=record["retry_of_job_id"],
        fetch_run_id=record["fetch_run_id"],
        chart_id=record["chart_id"],
        created_by_user_id=record["created_by_user_id"],
    )


async def create_job(
    pool: asyncpg.Pool, job_type: str, parameters: dict[str, Any], *, created_by_user_id: int
) -> JobCreatedResponse:
    record = await jobs_repository.insert_job(pool, job_type, parameters, created_by_user_id=created_by_user_id)
    return JobCreatedResponse(
        job_id=record["job_id"],
        status=record["status"],
        created_at=record["requested_at"],
    )


async def get_job(pool: asyncpg.Pool, job_id: UUID, *, user_id: int, is_admin: bool) -> JobRead | None:
    record = await jobs_repository.get_job(pool, job_id, user_id=user_id, is_admin=is_admin)
    if record is None:
        return None
    return _to_job_read(record)


async def list_jobs(
    pool: asyncpg.Pool, limit: int, status: str | None, *, user_id: int, is_admin: bool
) -> list[JobRead]:
    records = await jobs_repository.list_jobs(pool, limit=limit, status=status, user_id=user_id, is_admin=is_admin)
    return [_to_job_read(record) for record in records]


async def delete_jobs(pool: asyncpg.Pool, scope: str, *, user_id: int, is_admin: bool) -> int:
    return await jobs_repository.delete_jobs(pool, scope, user_id=user_id, is_admin=is_admin)


async def delete_job(pool: asyncpg.Pool, job_id: UUID, *, user_id: int, is_admin: bool) -> bool:
    job = await get_job(pool, job_id, user_id=user_id, is_admin=is_admin)
    if job is None:
        return False
    if job.status in ("queued", "running"):
        raise JobNotDeletableError(
            f"El job {job_id} esta '{job.status}' -- solo se pueden eliminar trabajos finalizados "
            "(success, failed o cancelled)."
        )
    return await jobs_repository.delete_job(pool, job_id, user_id=user_id, is_admin=is_admin)


async def cancel_job(pool: asyncpg.Pool, job_id: UUID, *, user_id: int, is_admin: bool) -> JobRead | None:
    """Cancela un job en queued/running. Ver docstring de jobs_repository.cancel_job
    para el detalle de por que es una cancelacion 'suave' (no mata la ejecucion
    de n8n que ya este en curso, solo evita que su resultado final pise el
    estado cancelled una vez que termine). Devuelve None si el job no existe."""
    current = await get_job(pool, job_id, user_id=user_id, is_admin=is_admin)
    if current is None:
        return None
    if current.status not in ("queued", "running"):
        raise JobNotCancellableError(
            f"El job {job_id} esta en estado '{current.status}', ya no se puede cancelar."
        )
    record = await jobs_repository.cancel_job(pool, job_id, user_id=user_id, is_admin=is_admin)
    if record is None:
        raise JobNotCancellableError(
            f"El job {job_id} cambio de estado justo antes de poder cancelarlo."
        )
    return _to_job_read(record)


async def get_chart_output_file(pool: asyncpg.Pool, chart_id: int) -> str | None:
    return await charts_repository.get_output_file(pool, chart_id)


async def trigger_job(
    pool: asyncpg.Pool, job_id: UUID, job_type: str, parameters: dict[str, Any]
) -> None:
    """Wrapper para usar como BackgroundTask: si el POST a n8n falla, marca el
    job como failed en vez de dejarlo huerfano en 'queued' para siempre.
    """
    try:
        await n8n_client.trigger_analysis_job(str(job_id), job_type, parameters)
    except n8n_client.JobTriggerError as exc:
        logger.warning("Marcando job %s como failed: %s", job_id, exc)
        await jobs_repository.mark_job_failed_to_dispatch(pool, job_id, str(exc))


async def retry_job(pool: asyncpg.Pool, job_id: UUID, *, user_id: int, is_admin: bool) -> JobCreatedResponse | None:
    """Crea un job NUEVO con los mismos job_type/parameters que uno fallido.

    El job original no se modifica (los jobs son registros historicos
    inmutables) -- el nuevo queda enlazado via retry_of_job_id, con
    retry_count incrementado. Solo se puede reintentar un job en 'failed'.
    Quien reintenta (no necesariamente quien creo el original) queda como
    dueño del job nuevo.
    """
    original = await jobs_repository.get_job(pool, job_id, user_id=user_id, is_admin=is_admin)
    if original is None:
        return None
    if original["status"] != "failed":
        raise JobNotRetryableError(
            f"El job {job_id} esta en estado '{original['status']}', solo se puede reintentar un job 'failed'."
        )
    parameters = original["parameters"]
    if isinstance(parameters, str):
        parameters = json.loads(parameters)
    record = await jobs_repository.insert_retry_job(
        pool,
        job_type=original["job_type"],
        parameters=parameters,
        retry_count=original["retry_count"] + 1,
        retry_of_job_id=job_id,
        created_by_user_id=user_id,
    )
    return JobCreatedResponse(
        job_id=record["job_id"],
        status=record["status"],
        created_at=record["requested_at"],
    )
