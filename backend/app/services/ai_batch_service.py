import logging
from uuid import UUID

import asyncpg

from app.repositories import ai_batch_repository
from app.schemas.ai import AIBatchRunRead
from app.services.ai import gateway

logger = logging.getLogger(__name__)


def _to_read(record: asyncpg.Record) -> AIBatchRunRead:
    return AIBatchRunRead(
        batch_run_id=record["batch_run_id"],
        status=record["status"],
        total_cases=record["total_cases"],
        processed_cases=record["processed_cases"],
        succeeded_cases=record["succeeded_cases"],
        failed_cases=record["failed_cases"],
        error_message=record["error_message"],
        requested_at=record["requested_at"],
        started_at=record["started_at"],
        finished_at=record["finished_at"],
    )


async def start_batch(pool: asyncpg.Pool) -> AIBatchRunRead:
    pending_case_ids = await ai_batch_repository.list_pending_case_ids(pool)
    record = await ai_batch_repository.create_batch_run(pool, len(pending_case_ids))
    return _to_read(record)


async def get_batch(pool: asyncpg.Pool, batch_run_id: UUID) -> AIBatchRunRead | None:
    record = await ai_batch_repository.get_batch_run(pool, batch_run_id)
    return _to_read(record) if record else None


async def get_latest_batch(pool: asyncpg.Pool) -> AIBatchRunRead | None:
    record = await ai_batch_repository.get_latest_batch_run(pool)
    return _to_read(record) if record else None


async def run_batch(pool: asyncpg.Pool, batch_run_id: UUID) -> None:
    """Corre como BackgroundTask -- procesa cada expediente pendiente uno a la
    vez (nunca en paralelo, para no saturar al proveedor de IA activo) y deja
    el progreso real en mailing.ai_batch_runs para que el frontend lo pueda
    consultar en cualquier momento, sin depender de que la pestana del
    navegador que lo disparo siga abierta.
    """
    case_ids = await ai_batch_repository.list_pending_case_ids(pool)
    await ai_batch_repository.mark_batch_running(pool, batch_run_id)

    succeeded = 0
    failed = 0
    for case_id in case_ids:
        try:
            result = await gateway.analyze_case(pool, case_id)
            if result is not None and result.status == "success":
                succeeded += 1
            else:
                failed += 1
        except Exception:
            logger.exception("Fallo al analizar el caso %s dentro del batch %s", case_id, batch_run_id)
            failed += 1
        await ai_batch_repository.update_batch_progress(
            pool,
            batch_run_id,
            processed_cases=succeeded + failed,
            succeeded_cases=succeeded,
            failed_cases=failed,
        )

    await ai_batch_repository.mark_batch_finished(pool, batch_run_id, status="success", error_message=None)
