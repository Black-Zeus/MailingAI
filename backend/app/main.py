import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.ai import router as ai_router
from app.api.cases import router as cases_router
from app.api.jobs import router as jobs_router
from app.api.mailboxes import router as mailboxes_router
from app.api.messages import router as messages_router
from app.api.system import router as system_router
from app.case_export import router as case_export_router
from app.charts import router as charts_router
from app.db import connect, disconnect, get_pool
from app.repositories import ai_batch_repository, case_batch_repository


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
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Total-Count"],
)

app.include_router(charts_router)
app.include_router(jobs_router)
app.include_router(messages_router)
app.include_router(cases_router)
app.include_router(case_export_router)
app.include_router(ai_router)
app.include_router(system_router)
app.include_router(mailboxes_router)


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
