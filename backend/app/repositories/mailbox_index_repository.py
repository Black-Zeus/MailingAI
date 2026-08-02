from datetime import datetime
from uuid import UUID

import asyncpg

_RUN_FIELDS = """
    index_run_id, mailbox_account_id, status, requested_by_user_id,
    total_folders, processed_folders, total_messages_indexed, current_job_id,
    cancel_requested, error_message, requested_at, started_at, finished_at
"""

_FOLDER_FIELDS = """
    folder_run_id, index_run_id, position, folder_id, folder_path, status,
    folder_total_item_count, messages_indexed, windows_processed, detail,
    started_at, finished_at
"""


async def create_index_run(
    pool: asyncpg.Pool, *, mailbox_account_id: int, requested_by_user_id: int
) -> asyncpg.Record:
    """Puede levantar asyncpg.UniqueViolationError si ya hay una corrida
    queued/running (indice unico parcial idx_mailbox_index_runs_one_active) --
    el llamador (mailbox_index_service.start_index) la traduce a
    ActiveIndexRunExistsError. Se deja propagar tal cual aca para no esconder
    el tipo real de error de una capa que no conoce la logica de negocio.
    """
    query = f"""
        INSERT INTO mailing.mailbox_index_runs (mailbox_account_id, requested_by_user_id)
        VALUES ($1, $2)
        RETURNING {_RUN_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, mailbox_account_id, requested_by_user_id)


async def get_active_run(pool: asyncpg.Pool) -> asyncpg.Record | None:
    query = f"""
        SELECT {_RUN_FIELDS} FROM mailing.mailbox_index_runs
        WHERE status IN ('queued', 'running')
        LIMIT 1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def get_index_run(pool: asyncpg.Pool, index_run_id: UUID) -> asyncpg.Record | None:
    query = f"SELECT {_RUN_FIELDS} FROM mailing.mailbox_index_runs WHERE index_run_id = $1;"
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, index_run_id)


async def get_latest_index_run(pool: asyncpg.Pool) -> asyncpg.Record | None:
    query = f"""
        SELECT {_RUN_FIELDS} FROM mailing.mailbox_index_runs
        ORDER BY requested_at DESC LIMIT 1;
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query)


async def list_index_runs(pool: asyncpg.Pool, *, limit: int = 20) -> list[asyncpg.Record]:
    query = f"""
        SELECT {_RUN_FIELDS} FROM mailing.mailbox_index_runs
        ORDER BY requested_at DESC LIMIT $1;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, limit)


async def get_expected_message_count(pool: asyncpg.Pool, index_run_id: UUID) -> int:
    """Suma folder_total_item_count (snapshot tomado en discover_mail_folders,
    antes de indexar) de todas las carpetas de la corrida -- da un total
    esperado para poder mostrar % de avance sin volver a consultar Graph."""
    query = """
        SELECT COALESCE(SUM(folder_total_item_count), 0)::bigint AS total
        FROM mailing.mailbox_index_folders
        WHERE index_run_id = $1;
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, index_run_id)
    return row["total"]


async def list_index_folders(pool: asyncpg.Pool, index_run_id: UUID) -> list[asyncpg.Record]:
    query = f"""
        SELECT {_FOLDER_FIELDS} FROM mailing.mailbox_index_folders
        WHERE index_run_id = $1
        ORDER BY position ASC;
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, index_run_id)


async def insert_folder_rows(
    pool: asyncpg.Pool, index_run_id: UUID, folders: list[asyncpg.Record]
) -> None:
    """Una fila por carpeta descubierta, en el mismo orden que vinieron
    (posicion = orden de recorrido, no importa el criterio real, solo tiene
    que ser estable para mostrar la tabla de progreso siempre igual)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            for position, folder in enumerate(folders):
                await conn.execute(
                    """
                    INSERT INTO mailing.mailbox_index_folders
                      (index_run_id, position, folder_id, folder_path, folder_total_item_count)
                    VALUES ($1, $2, $3, $4, $5);
                    """,
                    index_run_id,
                    position,
                    folder["folder_id"],
                    folder["folder_path"],
                    folder["total_item_count"],
                )


async def mark_folder_started(pool: asyncpg.Pool, folder_run_id: int) -> None:
    query = """
        UPDATE mailing.mailbox_index_folders
        SET status = 'indexando', started_at = now()
        WHERE folder_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, folder_run_id)


async def update_folder_progress(
    pool: asyncpg.Pool,
    folder_run_id: int,
    *,
    messages_indexed: int,
    windows_processed: int,
    detail: str | None,
) -> None:
    query = """
        UPDATE mailing.mailbox_index_folders
        SET messages_indexed = $2, windows_processed = $3, detail = $4
        WHERE folder_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, folder_run_id, messages_indexed, windows_processed, detail)


async def mark_folder_finished(
    pool: asyncpg.Pool, folder_run_id: int, *, status: str, detail: str | None
) -> None:
    query = """
        UPDATE mailing.mailbox_index_folders
        SET status = $2, detail = $3, finished_at = now()
        WHERE folder_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, folder_run_id, status, detail)


async def mark_run_running(pool: asyncpg.Pool, index_run_id: UUID) -> None:
    query = """
        UPDATE mailing.mailbox_index_runs
        SET status = 'running', started_at = now()
        WHERE index_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, index_run_id)


async def set_total_folders(pool: asyncpg.Pool, index_run_id: UUID, total_folders: int) -> None:
    query = "UPDATE mailing.mailbox_index_runs SET total_folders = $2 WHERE index_run_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, index_run_id, total_folders)


async def update_run_progress(
    pool: asyncpg.Pool,
    index_run_id: UUID,
    *,
    processed_folders: int,
    total_messages_indexed: int,
) -> None:
    query = """
        UPDATE mailing.mailbox_index_runs
        SET processed_folders = $2, total_messages_indexed = $3
        WHERE index_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, index_run_id, processed_folders, total_messages_indexed)


async def set_current_job_id(pool: asyncpg.Pool, index_run_id: UUID, job_id: UUID | None) -> None:
    query = "UPDATE mailing.mailbox_index_runs SET current_job_id = $2 WHERE index_run_id = $1;"
    async with pool.acquire() as conn:
        await conn.execute(query, index_run_id, job_id)


async def set_cancel_requested(pool: asyncpg.Pool, index_run_id: UUID) -> asyncpg.Record | None:
    """Solo marca la bandera si la corrida sigue queued/running -- devuelve
    None si ya estaba en un estado terminal (nada que cancelar)."""
    query = f"""
        UPDATE mailing.mailbox_index_runs
        SET cancel_requested = true
        WHERE index_run_id = $1 AND status IN ('queued', 'running')
        RETURNING {_RUN_FIELDS};
    """
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, index_run_id)


async def mark_run_finished(
    pool: asyncpg.Pool, index_run_id: UUID, *, status: str, error_message: str | None
) -> None:
    query = """
        UPDATE mailing.mailbox_index_runs
        SET status = $2, error_message = $3, finished_at = now(), current_job_id = NULL
        WHERE index_run_id = $1;
    """
    async with pool.acquire() as conn:
        await conn.execute(query, index_run_id, status, error_message)


async def get_folders_watermark(pool: asyncpg.Pool) -> datetime:
    """Ultimo last_sync_at conocido en mailing.mail_folders antes de disparar
    un discover_mail_folders nuevo -- se usa como punto de corte para
    tag_folders_with_mailbox, evitando comparar contra un reloj externo (el
    now() que importa es el de Postgres, el mismo que escribe el workflow
    n8n al hacer upsert)."""
    query = "SELECT COALESCE(MAX(last_sync_at), '-infinity'::timestamptz) AS watermark FROM mailing.mail_folders;"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query)
    return row["watermark"]


async def tag_folders_with_mailbox(
    pool: asyncpg.Pool, mailbox_account_id: int, *, since: datetime
) -> int:
    """El workflow n8n 06 (discover_mail_folders) nunca escribe
    mail_folders.mailbox_account_id (gap preexistente -- solo se rellena por
    un backfill de una sola vez desde mailing.messages, ver migracion
    20260729_0002). Ante cada discover_mail_folders disparado por esta
    feature, se etiquetan aca las carpetas que ese job acaba de tocar
    (last_sync_at posterior al watermark de get_folders_watermark, tomado
    justo antes de disparar el job) con el buzon correcto, para que
    messages_repository.list_mail_folders(accessible_mailbox_ids=[...])
    las encuentre. Devuelve cuantas carpetas se etiquetaron.
    """
    query = """
        UPDATE mailing.mail_folders
        SET mailbox_account_id = $1
        WHERE last_sync_at > $2
        RETURNING folder_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, mailbox_account_id, since)
    return len(rows)


async def fail_orphaned_index_runs(pool: asyncpg.Pool) -> int:
    """Mismo criterio que case_batch_repository.fail_orphaned_batch_runs --
    se llama al arrancar el backend para cerrar cualquier corrida que haya
    quedado queued/running porque el proceso (BackgroundTasks) murio junto
    con un reinicio/redeploy del contenedor.
    """
    query = """
        UPDATE mailing.mailbox_index_runs
        SET status = 'failed',
            error_message = 'Interrumpida por un reinicio del backend antes de terminar.',
            finished_at = now(),
            current_job_id = NULL
        WHERE status IN ('queued', 'running')
        RETURNING index_run_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)


async def delete_finished_runs(pool: asyncpg.Pool) -> int:
    """Borra las corridas terminadas (cualquier estado que no sea
    queued/running) del historial -- mismo criterio que jobs_repository con
    scope='all-inactive'. Las filas de mailbox_index_folders se van solas por
    ON DELETE CASCADE. No toca mailing.messages ni mailing.mail_folders --
    solo el tracking de progreso de esta feature."""
    query = """
        DELETE FROM mailing.mailbox_index_runs
        WHERE status NOT IN ('queued', 'running')
        RETURNING index_run_id;
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query)
    return len(rows)
