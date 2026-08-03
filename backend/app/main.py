import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.admin_mailbox_index import router as admin_mailbox_index_router
from app.api.admin_tenants import router as admin_tenants_router
from app.api.admin_users import router as admin_users_router
from app.api.ai import router as ai_router
from app.api.auth import router as auth_router
from app.api.cases import router as cases_router
from app.api.jobs import router as jobs_router
from app.api.mailboxes import router as mailboxes_router
from app.api.internal import router as internal_router
from app.api.messages import router as messages_router
from app.api.notifications import router as notifications_router
from app.api.system import router as system_router
from app.api.users import router as users_router
from app.auth.dependencies import get_current_user, verify_internal_secret
from app.case_export import router as case_export_router
from app.charts import router as charts_router
from app.db import connect, disconnect, get_pool
from app.repositories import ai_batch_repository, ai_runs_repository, case_batch_repository, mailbox_index_repository


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    pool = get_pool()
    orphaned_ai = await ai_batch_repository.fail_orphaned_batch_runs(pool)
    if orphaned_ai:
        logging.getLogger(__name__).warning(
            "Marcadas %d corrida(s) de IA en lote huerfana(s) como failed al arrancar", orphaned_ai
        )
    orphaned_cases = await case_batch_repository.fail_orphaned_batch_runs(pool)
    if orphaned_cases:
        logging.getLogger(__name__).warning(
            "Marcadas %d corrida(s) de creacion de expedientes en lote huerfana(s) como failed al arrancar",
            orphaned_cases,
        )
    orphaned_index = await mailbox_index_repository.fail_orphaned_index_runs(pool)
    if orphaned_index:
        logging.getLogger(__name__).warning(
            "Marcada(s) %d corrida(s) de indexacion de buzon huerfana(s) como failed al arrancar",
            orphaned_index,
        )
    orphaned_ai_runs = await ai_runs_repository.fail_orphaned_ai_runs(pool)
    if orphaned_ai_runs:
        logging.getLogger(__name__).warning(
            "Marcada(s) %d corrida(s) de analisis de IA huerfana(s) como failed al arrancar",
            orphaned_ai_runs,
        )
    try:
        yield
    finally:
        await disconnect()


app = FastAPI(title=os.getenv("APP_NAME", "mailingai-backend"), lifespan=lifespan)

_frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Total-Count"],
)

# auth_router expone el propio login (no puede exigir sesion para si mismo).
# charts_router (prefix /charts, no /api) e internal_router (prefix /internal)
# son server-to-server: los llama n8n directo (http://backend:8000/...) sin
# cookie de sesion de ningun usuario -- exigirla ahi rompe esas llamadas.
# internal_router ademas NO esta mapeado en proxy/nginx.conf a proposito, asi
# que ni siquiera queda alcanzable desde afuera del stack (ver ese archivo) --
# y ahora tambien exige el mismo secreto compartido que ya validan los
# webhooks de n8n (verify_internal_secret), en vez de depender solo de ese
# aislamiento de red (ver docs/SECURITY.md).
# Todo el resto de routers de negocio exige sesion valida vía este guard
# global; el filtrado fino por dueño/permisos se agrega router por router en
# fases siguientes (Fase 4 en adelante) -- aca solo "hay que estar logueado".
_require_session = [Depends(get_current_user)]
app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(admin_mailbox_index_router)
app.include_router(admin_tenants_router)
app.include_router(charts_router)
app.include_router(internal_router, dependencies=[Depends(verify_internal_secret)])
app.include_router(jobs_router, dependencies=_require_session)
app.include_router(messages_router, dependencies=_require_session)
app.include_router(cases_router, dependencies=_require_session)
app.include_router(case_export_router, dependencies=_require_session)
app.include_router(ai_router, dependencies=_require_session)
app.include_router(system_router, dependencies=_require_session)
app.include_router(mailboxes_router, dependencies=_require_session)
app.include_router(users_router, dependencies=_require_session)
app.include_router(notifications_router, dependencies=_require_session)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": os.getenv("APP_NAME", "mailingai-backend"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
