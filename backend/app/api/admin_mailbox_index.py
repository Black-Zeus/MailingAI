from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import AdminUserDep
from app.db import get_pool
from app.schemas.mailbox_index import MailboxIndexRunRead, MailboxIndexStartRequest
from app.services import mailbox_index_service, n8n_client

router = APIRouter(prefix="/api/admin/mailbox-index", tags=["admin-mailbox-index"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.post("", response_model=MailboxIndexRunRead, status_code=http_status.HTTP_202_ACCEPTED)
async def start_mailbox_index(
    payload: MailboxIndexStartRequest,
    pool: PoolDep,
    admin: AdminUserDep,
    background_tasks: BackgroundTasks,
) -> MailboxIndexRunRead:
    try:
        run = await mailbox_index_service.start_index(
            pool, mailbox_account_id=payload.mailbox_account_id, requested_by_user_id=admin.user_id
        )
    except mailbox_index_service.ActiveIndexRunExistsError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    background_tasks.add_task(mailbox_index_service.run_index, pool, run.index_run_id)
    return run


@router.get("", response_model=list[MailboxIndexRunRead])
async def list_mailbox_index_runs(
    pool: PoolDep, _admin: AdminUserDep, limit: int = Query(default=20, ge=1, le=100)
) -> list[MailboxIndexRunRead]:
    return await mailbox_index_service.list_runs(pool, limit=limit)


@router.delete("", status_code=http_status.HTTP_200_OK)
async def delete_finished_mailbox_index_runs(pool: PoolDep, _admin: AdminUserDep) -> dict[str, int]:
    deleted = await mailbox_index_service.delete_finished_runs(pool)
    return {"deleted": deleted}


@router.post("/delta-sync", status_code=http_status.HTTP_202_ACCEPTED)
async def trigger_mailbox_delta_sync(
    _admin: AdminUserDep, mailbox_account_id: int | None = Query(default=None)
) -> dict[str, bool]:
    """Fuerza a mano el workflow de n8n que normalmente sincroniza solo lo
    nuevo/modificado desde la ultima corrida, una vez al dia. No pasa por
    mailbox_index_service (esa es la reindexacion completa, con su propio
    tracking en mailbox_index_runs) -- esto solo dispara el webhook, n8n hace
    el resto por su cuenta de forma asincrona.

    Sin mailbox_account_id sincroniza todos los buzones habilitados (boton
    global de la pestaña Indexacion). Con mailbox_account_id, solo ese buzon
    puntual (boton "Sincronizar" de su fila en la tabla de Buzones)."""
    try:
        await n8n_client.trigger_mailbox_delta_sync(mailbox_account_id)
    except n8n_client.MailboxDeltaSyncTriggerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {"accepted": True}


@router.get("/latest", response_model=MailboxIndexRunRead | None)
async def get_latest_mailbox_index_run(pool: PoolDep, _admin: AdminUserDep) -> MailboxIndexRunRead | None:
    return await mailbox_index_service.get_latest_run(pool)


@router.get("/{index_run_id}", response_model=MailboxIndexRunRead)
async def get_mailbox_index_run(index_run_id: UUID, pool: PoolDep, _admin: AdminUserDep) -> MailboxIndexRunRead:
    run = await mailbox_index_service.get_run(pool, index_run_id)
    if run is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Corrida de indexación no encontrada")
    return run


@router.post("/{index_run_id}/cancel", response_model=MailboxIndexRunRead)
async def cancel_mailbox_index_run(index_run_id: UUID, pool: PoolDep, _admin: AdminUserDep) -> MailboxIndexRunRead:
    try:
        run = await mailbox_index_service.request_cancel(pool, index_run_id)
    except mailbox_index_service.IndexRunNotCancellableError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if run is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Corrida de indexación no encontrada")
    return run
