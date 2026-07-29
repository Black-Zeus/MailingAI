import asyncio
import logging
from datetime import date, datetime, time, timezone
from uuid import UUID

import asyncpg
from dateutil.relativedelta import relativedelta

from app.auth.dependencies import CurrentUser
from app.repositories import access_repository, case_batch_repository, users_repository
from app.schemas.cases import CaseBatchItemRead, CaseBatchRunRead, CaseDetail
from app.services import cases_service, jobs_service

logger = logging.getLogger(__name__)

_SEARCH_POLL_INTERVAL_S = 3
_SEARCH_TIMEOUT_S = 600
_DEFAULT_MONTHS_BACK = 6


class MailboxRequiredForSearchError(Exception):
    """search_mailbox=True pero no se indico mailbox_account_id -- no hay como saber en que buzon buscar."""


class MailboxNotAccessibleError(Exception):
    """El usuario no tiene acceso (dueño/compartido/admin) al buzon indicado para buscar."""


def _to_item(record: asyncpg.Record) -> CaseBatchItemRead:
    return CaseBatchItemRead(
        item_id=record["item_id"],
        position=record["position"],
        keyword=record["keyword"],
        status=record["status"],
        detail=record["detail"],
        case_id=record["case_id"],
    )


def _to_run(run: asyncpg.Record, items: list[asyncpg.Record]) -> CaseBatchRunRead:
    return CaseBatchRunRead(
        batch_run_id=run["batch_run_id"],
        status=run["status"],
        case_type=run["case_type"],
        total_keywords=run["total_keywords"],
        processed_keywords=run["processed_keywords"],
        error_message=run["error_message"],
        requested_at=run["requested_at"],
        started_at=run["started_at"],
        finished_at=run["finished_at"],
        search_mailbox=run["search_mailbox"],
        mailbox_account_id=run["mailbox_account_id"],
        date_from=run["date_from"],
        date_to=run["date_to"],
        created_count=run["created_count"],
        correlated_count=run["correlated_count"],
        searched_count=run["searched_count"],
        items=[_to_item(i) for i in items],
    )


def _default_date_range() -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    return today - relativedelta(months=_DEFAULT_MONTHS_BACK), today


async def start_batch(
    pool: asyncpg.Pool,
    *,
    keywords: list[str],
    case_type: str,
    search_mailbox: bool = False,
    mailbox_account_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    user: CurrentUser,
) -> CaseBatchRunRead:
    if search_mailbox and mailbox_account_id is None:
        raise MailboxRequiredForSearchError(
            "Para buscar en el buzón real hay que indicar en cuál (mailbox_account_id)."
        )
    if search_mailbox and mailbox_account_id is not None and not user.is_admin:
        accessible_mailbox_ids = await access_repository.get_accessible_mailbox_ids(pool, user.user_id)
        if mailbox_account_id not in accessible_mailbox_ids:
            raise MailboxNotAccessibleError("No tiene acceso a ese buzón.")
    if search_mailbox and (date_from is None or date_to is None):
        default_from, default_to = _default_date_range()
        date_from = date_from or default_from
        date_to = date_to or default_to

    run = await case_batch_repository.create_batch_run(
        pool,
        case_type=case_type,
        keywords=keywords,
        search_mailbox=search_mailbox,
        mailbox_account_id=mailbox_account_id,
        date_from=date_from,
        date_to=date_to,
        requested_by_user_id=user.user_id,
    )
    items = await case_batch_repository.list_batch_items(pool, run["batch_run_id"])
    return _to_run(run, items)


async def get_batch(pool: asyncpg.Pool, batch_run_id: UUID, *, user: CurrentUser) -> CaseBatchRunRead | None:
    run = await case_batch_repository.get_batch_run(pool, batch_run_id, user_id=user.user_id, is_admin=user.is_admin)
    if run is None:
        return None
    items = await case_batch_repository.list_batch_items(pool, batch_run_id)
    return _to_run(run, items)


async def get_latest_batch(pool: asyncpg.Pool, *, user: CurrentUser) -> CaseBatchRunRead | None:
    run = await case_batch_repository.get_latest_batch_run(pool, user_id=user.user_id, is_admin=user.is_admin)
    if run is None:
        return None
    items = await case_batch_repository.list_batch_items(pool, run["batch_run_id"])
    return _to_run(run, items)


def _start_of_day_iso(d: date) -> str:
    return datetime.combine(d, time.min, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _end_of_day_iso(d: date) -> str:
    return datetime.combine(d, time(23, 59, 59), tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


_SEARCH_FOLDERS = ("sentitems", "inbox")


async def _run_and_wait_fetch_job(
    pool: asyncpg.Pool,
    *,
    keyword: str,
    date_from: date,
    date_to: date,
    mailbox_account_id: int,
    folder: str,
) -> str | None:
    """Dispara un fetch_message_series (workflow 02) contra Graph, acotado a
    una carpeta puntual, y espera a que termine. Devuelve None si la busqueda
    termino bien, o un mensaje corto explicando que paso si no.
    """
    parameters = {
        "subject_contains": keyword,
        "date_from": _start_of_day_iso(date_from),
        "date_to": _end_of_day_iso(date_to),
        "mailbox_account_id": mailbox_account_id,
        "folder": folder,
    }
    created = await jobs_service.create_job(pool, "fetch_message_series", parameters)
    await jobs_service.trigger_job(pool, created.job_id, "fetch_message_series", parameters)

    elapsed = 0
    while elapsed < _SEARCH_TIMEOUT_S:
        await asyncio.sleep(_SEARCH_POLL_INTERVAL_S)
        elapsed += _SEARCH_POLL_INTERVAL_S
        job = await jobs_service.get_job(pool, created.job_id)
        if job is None:
            return f"[{folder}] El trabajo de búsqueda en el buzón desapareció inesperadamente."
        if job.status == "success":
            return None
        if job.status in ("failed", "cancelled"):
            return f"[{folder}] Búsqueda terminó en '{job.status}': {job.error_message or 'sin detalle'}."
    return f"[{folder}] La búsqueda superó los 10 minutos de espera; se usa lo ya indexado."


async def _search_mailbox_for_keyword(
    pool: asyncpg.Pool,
    *,
    keyword: str,
    date_from: date,
    date_to: date,
    mailbox_account_id: int,
) -> str | None:
    """Busca este keyword en el buzon real (Elementos Enviados + Bandeja de
    entrada, en paralelo -- Graph no admite pedir ambas carpetas en una sola
    llamada) para que la correlacion posterior encuentre coincidencias
    frescas y no solo lo que ya estaba indexado de antes.

    Devuelve None si ambas busquedas terminaron bien, o un mensaje corto
    explicando que paso si alguna fallo (de todas formas se sigue con lo que
    haya, mejor un expediente con lo que se pudo que ninguno).
    """
    results = await asyncio.gather(
        *(
            _run_and_wait_fetch_job(
                pool,
                keyword=keyword,
                date_from=date_from,
                date_to=date_to,
                mailbox_account_id=mailbox_account_id,
                folder=folder,
            )
            for folder in _SEARCH_FOLDERS
        )
    )
    notes = [note for note in results if note]
    return " · ".join(notes) if notes else None


async def run_batch(pool: asyncpg.Pool, batch_run_id: UUID) -> None:
    """Corre como BackgroundTask, dejando el progreso real en
    mailing.case_batch_runs/_items para que el frontend lo pueda consultar en
    cualquier momento (incluso despues de un refresh de la pagina que lo
    disparo).

    Corre en 3 pasadas sobre TODA la lista, no item por item, cada una con su
    propio contador (created_count/correlated_count/searched_count) para que
    la UI pueda mostrar las 3 fases por separado:
      1. Crear todos los expedientes vacios (rapido, feedback inmediato).
      2. Correlacionar todos contra lo que YA esta indexado.
      3. Si search_mailbox esta activo, buscar cada palabra clave en el
         buzon real (Graph) y refrescar la correlacion con lo que aparezca.
    """
    run = await case_batch_repository.get_batch_run_unscoped(pool, batch_run_id)
    if run is None:
        return
    requester = await users_repository.get_user_by_id(pool, run["requested_by_user_id"])
    if requester is None:
        logger.error("El usuario que pidio el batch %s ya no existe -- se aborta.", batch_run_id)
        await case_batch_repository.mark_batch_finished(
            pool, batch_run_id, status="failed", error_message="El usuario que pidio esta corrida ya no existe."
        )
        return
    user = CurrentUser(
        user_id=requester["user_id"],
        email_address=requester["email_address"],
        display_name=requester["display_name"],
        role=requester["role"],
    )
    items = await case_batch_repository.list_batch_items(pool, batch_run_id)
    case_type = run["case_type"]
    search_mailbox = run["search_mailbox"]
    mailbox_account_id = run["mailbox_account_id"]
    date_from = run["date_from"]
    date_to = run["date_to"]

    await case_batch_repository.mark_batch_running(pool, batch_run_id)

    # Fase 1: crear todos los expedientes, vacios (sin correlacionar todavia).
    created_by_item: dict[int, CaseDetail] = {}
    created = 0
    for item in items:
        await case_batch_repository.update_item_status(pool, item["item_id"], status="creando", detail="Creando expediente…")
        try:
            case_detail = await cases_service.create_empty_case(
                pool,
                title=item["keyword"],
                seed_value=item["keyword"],
                case_type=case_type,
                user=user,
            )
            created_by_item[item["item_id"]] = case_detail
            await case_batch_repository.update_item_status(
                pool,
                item["item_id"],
                status="creando",
                detail="Expediente creado — en cola para asociar correos indexados",
                case_id=case_detail.case_id,
            )
        except Exception as exc:
            logger.exception(
                "Fallo al crear el expediente para '%s' dentro del batch %s", item["keyword"], batch_run_id
            )
            await case_batch_repository.update_item_status(
                pool, item["item_id"], status="error", detail=str(exc)[:500]
            )
        created += 1
        await case_batch_repository.update_batch_created_count(pool, batch_run_id, count=created)

    # Fase 2: correlacionar todos los expedientes creados contra lo ya indexado.
    correlated = 0
    for item in items:
        case_detail = created_by_item.get(item["item_id"])
        if case_detail is None:
            continue  # fallo en la fase 1, no hay expediente que correlacionar
        try:
            refreshed = await cases_service.refresh_case_correlation(pool, case_detail.case_id, user=user)
        except (cases_service.CaseClosedError, cases_service.CaseAccessDeniedError):
            refreshed = None
        if refreshed is not None:
            case_detail, _new_count = refreshed
            created_by_item[item["item_id"]] = case_detail
        detail_text = f"{case_detail.message_count} correo(s) (local)"
        if search_mailbox:
            detail_text = f"{detail_text} — en cola para buscar en el buzón"
        await case_batch_repository.update_item_status(
            pool,
            item["item_id"],
            status="listo" if not search_mailbox else "creando",
            detail=detail_text,
            case_id=case_detail.case_id,
        )
        correlated += 1
        await case_batch_repository.update_batch_correlated_count(pool, batch_run_id, count=correlated)
        # processed_keywords se mantiene en sync con correlated_count -- es el
        # campo "legacy" que ya consultaba el resto del frontend (ej. para
        # saber si refrescar la lista de expedientes) antes de que hubiera
        # contadores por fase.
        await case_batch_repository.update_batch_progress(pool, batch_run_id, processed_keywords=correlated)

    # Fase 3: buscar en el buzon real y refrescar cada expediente ya creado.
    if search_mailbox:
        searched = 0
        for item in items:
            case_detail = created_by_item.get(item["item_id"])
            if case_detail is None:
                continue  # fallo en una fase anterior, no hay expediente que refrescar
            await case_batch_repository.update_item_status(
                pool,
                item["item_id"],
                status="creando",
                detail=f"{case_detail.message_count} correo(s) (local) — buscando en el buzón…",
            )
            search_note = await _search_mailbox_for_keyword(
                pool,
                keyword=item["keyword"],
                date_from=date_from,
                date_to=date_to,
                mailbox_account_id=mailbox_account_id,
            )
            try:
                refreshed = await cases_service.refresh_case_correlation(pool, case_detail.case_id)
            except cases_service.CaseClosedError:
                refreshed = None
            if refreshed is not None:
                case_detail, _new_count = refreshed
            detail_text = f"{case_detail.message_count} correo(s)"
            if search_note:
                detail_text = f"{detail_text} — {search_note}"
            await case_batch_repository.update_item_status(
                pool,
                item["item_id"],
                status="listo",
                detail=detail_text,
                case_id=case_detail.case_id,
            )
            searched += 1
            await case_batch_repository.update_batch_searched_count(pool, batch_run_id, count=searched)

    await case_batch_repository.mark_batch_finished(pool, batch_run_id, status="success", error_message=None)
