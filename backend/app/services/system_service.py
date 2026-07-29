from urllib.parse import urlparse

import asyncpg
import httpx

from app.config import get_settings
from app.repositories import system_repository
from app.schemas.system import StatsResponse, SystemStatus
from app.services.ai import gateway as ai_gateway


def _n8n_base_url() -> str:
    settings = get_settings()
    parsed = urlparse(settings.n8n_webhook_internal_url)
    return f"{parsed.scheme}://{parsed.netloc}"


async def _check_n8n() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{_n8n_base_url()}/healthz")
            return response.status_code == 200
    except httpx.HTTPError:
        return False


async def get_status(pool: asyncpg.Pool) -> SystemStatus:
    postgres_ok = await system_repository.check_postgres(pool)
    n8n_ok = await _check_n8n()
    ai_health = await ai_gateway.health(pool)
    ai_ok = bool(ai_health.healthy)
    return SystemStatus(backend=True, postgres=postgres_ok, n8n=n8n_ok, ai=ai_ok)


async def get_stats(pool: asyncpg.Pool) -> StatsResponse:
    record = await system_repository.get_stats(pool)
    return StatsResponse(
        message_count=record["message_count"],
        attachment_count=record["attachment_count"],
        conversation_count=record["conversation_count"],
        case_count=record["case_count"],
    )
