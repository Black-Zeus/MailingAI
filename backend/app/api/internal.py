from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends
from fastapi import status as http_status

from app.db import get_pool
from app.schemas.mailbox_index import MailboxDeltaSyncNotifyRequest
from app.services import mailbox_index_service

# Server-to-server, sin sesion de usuario -- lo llama n8n directo por la red
# interna de Docker (http://backend:8000/internal/...), nunca desde el
# navegador. Deliberadamente NO se mapea /internal/ en proxy/nginx.conf, asi
# que estas rutas no son alcanzables desde afuera del stack (mismo criterio
# ya documentado ahi para identity-broker).
router = APIRouter(prefix="/internal", tags=["internal"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.post("/mailbox-delta-sync-notify", status_code=http_status.HTTP_204_NO_CONTENT)
async def notify_mailbox_delta_sync(payload: MailboxDeltaSyncNotifyRequest, pool: PoolDep) -> None:
    await mailbox_index_service.notify_delta_sync_done(pool, details=payload.details)
