import asyncio
import logging
from collections import deque
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg

from app.repositories import mailbox_index_repository, messages_repository, notifications_repository, users_repository
from app.schemas.mailbox_index import MailboxDeltaSyncDetail, MailboxIndexFolderRead, MailboxIndexRunRead
from app.services import email_templates, jobs_service, notification_email_service

logger = logging.getLogger(__name__)

_TOP_PAGE_SIZE = 100
_EPOCH_DATE_FROM = datetime(2000, 1, 1, tzinfo=timezone.utc)  # "todo el historial"
_INDEX_POLL_INTERVAL_S = 5
_INDEX_JOB_TIMEOUT_S = 1200  # 20 min por ventana -- prioriza no romper nada sobre velocidad
_INDEX_FOLDER_PAUSE_S = 20  # pausa entre carpetas
_INDEX_WINDOW_PAUSE_S = 5  # pausa entre sub-ventanas de la misma carpeta
_NEAR_CAP_MESSAGES = 1900  # margen bajo el techo real de n8n (top=100 x maxRequests=20 = 2000)
_MIN_WINDOW_SPAN = timedelta(days=1)
_MAX_WINDOWS_PER_FOLDER = 64  # valvula de seguridad ante distribuciones patologicas


class ActiveIndexRunExistsError(Exception):
    """Ya hay una corrida de indexacion completa queued/running -- solo una a la vez en todo el sistema."""


class IndexRunNotCancellableError(Exception):
    """La corrida no existe o ya esta en un estado terminal, no se puede cancelar."""


def _to_folder_read(record: asyncpg.Record) -> MailboxIndexFolderRead:
    return MailboxIndexFolderRead(
        folder_run_id=record["folder_run_id"],
        position=record["position"],
        folder_id=record["folder_id"],
        folder_path=record["folder_path"],
        status=record["status"],
        folder_total_item_count=record["folder_total_item_count"],
        messages_indexed=record["messages_indexed"],
        windows_processed=record["windows_processed"],
        detail=record["detail"],
        started_at=record["started_at"],
        finished_at=record["finished_at"],
    )


async def _to_run_read(
    pool: asyncpg.Pool, record: asyncpg.Record, *, include_folders: bool
) -> MailboxIndexRunRead:
    folders: list[MailboxIndexFolderRead] = []
    if include_folders:
        folder_records = await mailbox_index_repository.list_index_folders(pool, record["index_run_id"])
        folders = [_to_folder_read(f) for f in folder_records]
    expected = await mailbox_index_repository.get_expected_message_count(pool, record["index_run_id"])
    return MailboxIndexRunRead(
        index_run_id=record["index_run_id"],
        mailbox_account_id=record["mailbox_account_id"],
        status=record["status"],
        requested_by_user_id=record["requested_by_user_id"],
        total_folders=record["total_folders"],
        processed_folders=record["processed_folders"],
        total_messages_indexed=record["total_messages_indexed"],
        total_messages_expected=expected,
        current_job_id=record["current_job_id"],
        cancel_requested=record["cancel_requested"],
        error_message=record["error_message"],
        requested_at=record["requested_at"],
        started_at=record["started_at"],
        finished_at=record["finished_at"],
        folders=folders,
    )


async def start_index(
    pool: asyncpg.Pool, *, mailbox_account_id: int, requested_by_user_id: int
) -> MailboxIndexRunRead:
    if await mailbox_index_repository.get_active_run(pool) is not None:
        raise ActiveIndexRunExistsError(
            "Ya hay una indexación completa en curso -- solo puede haber una a la vez en todo el sistema."
        )
    try:
        record = await mailbox_index_repository.create_index_run(
            pool, mailbox_account_id=mailbox_account_id, requested_by_user_id=requested_by_user_id
        )
    except asyncpg.UniqueViolationError as exc:
        # Otra corrida se colo entre el chequeo de arriba y este INSERT --
        # carrera real aunque rara, cerrada por el indice unico parcial
        # idx_mailbox_index_runs_one_active a nivel de base de datos.
        raise ActiveIndexRunExistsError(
            "Ya hay una indexación completa en curso -- solo puede haber una a la vez en todo el sistema."
        ) from exc
    return await _to_run_read(pool, record, include_folders=False)


async def get_run(pool: asyncpg.Pool, index_run_id: UUID) -> MailboxIndexRunRead | None:
    record = await mailbox_index_repository.get_index_run(pool, index_run_id)
    if record is None:
        return None
    return await _to_run_read(pool, record, include_folders=True)


async def get_latest_run(pool: asyncpg.Pool) -> MailboxIndexRunRead | None:
    record = await mailbox_index_repository.get_latest_index_run(pool)
    if record is None:
        return None
    return await _to_run_read(pool, record, include_folders=True)


async def list_runs(pool: asyncpg.Pool, *, limit: int = 20) -> list[MailboxIndexRunRead]:
    records = await mailbox_index_repository.list_index_runs(pool, limit=limit)
    return [await _to_run_read(pool, r, include_folders=False) for r in records]


async def delete_finished_runs(pool: asyncpg.Pool) -> int:
    return await mailbox_index_repository.delete_finished_runs(pool)


async def request_cancel(pool: asyncpg.Pool, index_run_id: UUID) -> MailboxIndexRunRead | None:
    """Devuelve None si la corrida no existe (el llamador responde 404).
    Levanta IndexRunNotCancellableError si existe pero ya esta en un estado
    terminal -- mismo criterio que jobs_service.cancel_job."""
    record = await mailbox_index_repository.set_cancel_requested(pool, index_run_id)
    if record is None:
        existing = await mailbox_index_repository.get_index_run(pool, index_run_id)
        if existing is None:
            return None
        raise IndexRunNotCancellableError(
            f"La corrida {index_run_id} está en estado '{existing['status']}', ya no se puede cancelar."
        )
    if record["current_job_id"] is not None:
        try:
            await jobs_service.cancel_job(pool, record["current_job_id"])
        except jobs_service.JobNotCancellableError:
            pass  # el job en vuelo ya termino solo justo antes -- run_index lo va a notar en el proximo poll
    return await _to_run_read(pool, record, include_folders=False)


async def _run_and_wait_job(
    pool: asyncpg.Pool, *, index_run_id: UUID, job_type: str, parameters: dict
) -> tuple[object | None, str | None, bool]:
    """Dispara un job (discover_mail_folders o fetch_message_series, ya
    existentes) y espera con poll a que termine, revisando cancel_requested
    en cada vuelta para poder cortar antes del timeout si el admin cancela a
    mitad de camino. Devuelve (job, nota_de_error, fue_cancelado).
    """
    created = await jobs_service.create_job(pool, job_type, parameters)
    await mailbox_index_repository.set_current_job_id(pool, index_run_id, created.job_id)
    await jobs_service.trigger_job(pool, created.job_id, job_type, parameters)

    elapsed = 0
    while elapsed < _INDEX_JOB_TIMEOUT_S:
        await asyncio.sleep(_INDEX_POLL_INTERVAL_S)
        elapsed += _INDEX_POLL_INTERVAL_S

        run = await mailbox_index_repository.get_index_run(pool, index_run_id)
        if run is not None and run["cancel_requested"]:
            try:
                await jobs_service.cancel_job(pool, created.job_id)
            except jobs_service.JobNotCancellableError:
                pass
            return None, None, True

        job = await jobs_service.get_job(pool, created.job_id)
        if job is None:
            return None, "El trabajo desapareció inesperadamente.", False
        if job.status == "success":
            return job, None, False
        if job.status in ("failed", "cancelled"):
            return job, f"Terminó en '{job.status}': {job.error_message or 'sin detalle'}.", False
    return None, "Superó el tiempo máximo de espera.", False


async def _discover_folders(
    pool: asyncpg.Pool, index_run_id: UUID, mailbox_account_id: int
) -> tuple[bool, bool, str | None]:
    """Devuelve (ok, fue_cancelado, nota_de_error)."""
    watermark = await mailbox_index_repository.get_folders_watermark(pool)
    job, error, cancelled = await _run_and_wait_job(
        pool,
        index_run_id=index_run_id,
        job_type="discover_mail_folders",
        parameters={"mailbox_account_id": mailbox_account_id},
    )
    await mailbox_index_repository.set_current_job_id(pool, index_run_id, None)
    if cancelled:
        return False, True, None
    if job is None or error is not None:
        return False, False, error or "No se pudo descubrir las carpetas del buzón."
    await mailbox_index_repository.tag_folders_with_mailbox(pool, mailbox_account_id, since=watermark)
    return True, False, None


async def _index_folder(
    pool: asyncpg.Pool, index_run_id: UUID, mailbox_account_id: int, folder_row: asyncpg.Record
) -> tuple[int, bool]:
    """Indexa una carpeta completa por bisección de rango de fechas (ver
    docstring de módulo/plan: no se puede confiar en el orden de retorno de
    Graph cuando hay $filter, así que la bisección determinista por rango es
    la única forma de trocear sin tocar n8n). Devuelve
    (mensajes_indexados, fue_cancelado).
    """
    folder_run_id = folder_row["folder_run_id"]
    folder_id = folder_row["folder_id"]
    await mailbox_index_repository.mark_folder_started(pool, folder_run_id)

    now = datetime.now(timezone.utc)
    windows: deque[tuple[datetime, datetime]] = deque([(_EPOCH_DATE_FROM, now)])
    messages_indexed = 0
    windows_processed = 0
    error_notes: list[str] = []
    cancelled = False

    while windows:
        if windows_processed >= _MAX_WINDOWS_PER_FOLDER:
            error_notes.append(f"Se alcanzó el máximo de {_MAX_WINDOWS_PER_FOLDER} sub-rangos; quedó parcial.")
            break

        run = await mailbox_index_repository.get_index_run(pool, index_run_id)
        if run is not None and run["cancel_requested"]:
            cancelled = True
            break

        date_from, date_to = windows.popleft()
        parameters = {
            "folder": folder_id,
            "mailbox_account_id": mailbox_account_id,
            "date_from": date_from.isoformat().replace("+00:00", "Z"),
            "date_to": date_to.isoformat().replace("+00:00", "Z"),
            "top": _TOP_PAGE_SIZE,
        }
        job, error, was_cancelled = await _run_and_wait_job(
            pool, index_run_id=index_run_id, job_type="fetch_message_series", parameters=parameters
        )
        if was_cancelled:
            cancelled = True
            break

        windows_processed += 1
        if job is None or error is not None:
            error_notes.append(error or "fallo desconocido")
        else:
            count = job.result_count or 0
            span = date_to - date_from
            if count >= _NEAR_CAP_MESSAGES and span > _MIN_WINDOW_SPAN:
                # Resultado probablemente truncado por el techo real de n8n
                # (maxRequests x top) -- no es un conteo confiable de esta
                # ventana, asi que no se suma aca (se contaria dos veces: una
                # vez acá, incompleta, y otra vez -- completa -- cuando las
                # mitades en las que se bisecta terminen de procesarse).
                midpoint = date_from + span / 2
                windows.append((date_from, midpoint))
                windows.append((midpoint, date_to))
            else:
                messages_indexed += count

        await mailbox_index_repository.update_folder_progress(
            pool,
            folder_run_id,
            messages_indexed=messages_indexed,
            windows_processed=windows_processed,
            detail=" · ".join(error_notes[-3:]) if error_notes else None,
        )

        if windows:
            await asyncio.sleep(_INDEX_WINDOW_PAUSE_S)

    if cancelled:
        status = "parcial"
        detail = "Cancelada por el administrador antes de completar esta carpeta."
    elif error_notes:
        status = "parcial"
        detail = " · ".join(error_notes[-3:])
    else:
        status = "listo"
        detail = None
    await mailbox_index_repository.mark_folder_finished(pool, folder_run_id, status=status, detail=detail)
    return messages_indexed, cancelled


async def run_index(pool: asyncpg.Pool, index_run_id: UUID) -> None:
    """Corre como BackgroundTask, dejando el progreso real en
    mailing.mailbox_index_runs/_folders para que el frontend lo pueda
    consultar en cualquier momento (incluso tras un refresh de la página que
    lo disparó) -- mismo patrón que case_batch_service.run_batch.

    Estrictamente secuencial en dos niveles (una carpeta a la vez, una
    ventana de fechas a la vez dentro de esa carpeta) con pausas explícitas
    entre cada paso: es la palanca de "bajo consumo" pedida, nunca hay más
    de un fetch_message_series/discover_mail_folders en vuelo para esta
    feature. Un fallo puntual (una ventana, una carpeta) no aborta el resto
    -- la corrida completa termina en 'partial' en vez de 'failed'.

    El árbol de carpetas (mailing.mail_folders) no queda etiquetado con
    mailbox_account_id por el workflow n8n de descubrimiento (gap
    preexistente, ver mailbox_index_repository.tag_folders_with_mailbox) --
    por eso siempre se vuelve a descubrir y etiquetar el buzón objetivo al
    arrancar, en vez de asumir que el árbol ya guardado es válido.
    """
    run = await mailbox_index_repository.get_index_run(pool, index_run_id)
    if run is None:
        return
    mailbox_account_id = run["mailbox_account_id"]

    await mailbox_index_repository.mark_run_running(pool, index_run_id)

    discovered, discover_cancelled, discover_error = await _discover_folders(
        pool, index_run_id, mailbox_account_id
    )
    if discover_cancelled:
        await mailbox_index_repository.mark_run_finished(pool, index_run_id, status="cancelled", error_message=None)
        return
    if not discovered:
        await mailbox_index_repository.mark_run_finished(
            pool,
            index_run_id,
            status="failed",
            error_message=discover_error or "No se pudo descubrir las carpetas del buzón.",
        )
        return

    folder_records = await messages_repository.list_mail_folders(
        pool, accessible_mailbox_ids=[mailbox_account_id]
    )
    await mailbox_index_repository.insert_folder_rows(pool, index_run_id, folder_records)
    await mailbox_index_repository.set_total_folders(pool, index_run_id, len(folder_records))

    if not folder_records:
        await mailbox_index_repository.mark_run_finished(pool, index_run_id, status="success", error_message=None)
        return

    folder_rows = await mailbox_index_repository.list_index_folders(pool, index_run_id)

    processed = 0
    total_messages = 0
    was_cancelled = False

    for position, folder_row in enumerate(folder_rows):
        run = await mailbox_index_repository.get_index_run(pool, index_run_id)
        if run is not None and run["cancel_requested"]:
            was_cancelled = True
            break

        messages_indexed, cancelled = await _index_folder(pool, index_run_id, mailbox_account_id, folder_row)
        total_messages += messages_indexed
        processed += 1
        await mailbox_index_repository.update_run_progress(
            pool, index_run_id, processed_folders=processed, total_messages_indexed=total_messages
        )
        if cancelled:
            was_cancelled = True
            break

        if position < len(folder_rows) - 1:
            await asyncio.sleep(_INDEX_FOLDER_PAUSE_S)

    if was_cancelled:
        final_status = "cancelled"
    else:
        refreshed_folders = await mailbox_index_repository.list_index_folders(pool, index_run_id)
        any_incomplete = any(f["status"] in ("parcial", "error", "pendiente") for f in refreshed_folders)
        final_status = "partial" if any_incomplete else "success"

    await mailbox_index_repository.mark_run_finished(pool, index_run_id, status=final_status, error_message=None)


async def notify_delta_sync_done(pool: asyncpg.Pool, *, details: list[MailboxDeltaSyncDetail]) -> None:
    """Avisa a los administradores que la sincronizacion delta de buzones
    (n8n, corre sola a diario o forzada a mano desde Configuracion) termino --
    sin esto nadie se entera de que corrio, ni de si trajo algo nuevo, salvo
    que vaya a revisar los expedientes a mano. La llama el propio workflow de
    n8n al final (ver POST /internal/mailbox-delta-sync-notify), no requiere
    sesion de ningun usuario -- por eso no toma un `user` como el resto de
    las notificaciones de este sistema."""
    total = sum(d.new_messages for d in details)
    if total > 0:
        breakdown = ", ".join(f"{d.label}: {d.new_messages}" for d in details if d.new_messages > 0)
        message = f"Sincronización de buzones completada: {total} correo(s) nuevo(s) ({breakdown})."
    else:
        message = "Sincronización de buzones completada: sin correos nuevos."

    email_details = [(d.label, f"{d.new_messages} correo(s) nuevo(s)") for d in details if d.new_messages > 0]
    email_body = email_templates.render_system_notification_email(
        eyebrow="Sincronización de buzones",
        title="Sincronización completada",
        message=(
            f"Se encontraron {total} correo(s) nuevo(s) en total."
            if total > 0
            else "No se encontraron correos nuevos en esta corrida."
        ),
        details=email_details or None,
    )

    admins = await users_repository.list_enabled_admins(pool)
    for admin in admins:
        await notifications_repository.insert_notification(
            pool,
            user_id=admin["user_id"],
            kind="mailbox_delta_sync_done",
            message=message,
            created_by_user_id=None,
        )
        await notification_email_service.try_send_email(
            to_email=admin["email_address"],
            subject="MailingAI — sincronización de buzones completada",
            body=email_body,
        )
