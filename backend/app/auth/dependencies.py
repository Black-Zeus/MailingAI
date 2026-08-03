import hmac
from dataclasses import dataclass
from typing import Annotated

import asyncpg
from fastapi import Depends, HTTPException, Request
from fastapi import status as http_status

from app.auth.sessions import get_valid_session
from app.config import get_settings
from app.db import get_pool


@dataclass(frozen=True)
class CurrentUser:
    user_id: int
    email_address: str
    display_name: str | None
    role: str
    must_change_password: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


async def get_current_user(
    request: Request,
    pool: Annotated[asyncpg.Pool, Depends(get_pool)],
) -> CurrentUser:
    settings = get_settings()
    raw_token = request.cookies.get(settings.session_cookie_name)
    if not raw_token:
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="No hay sesion activa")
    session = await get_valid_session(pool, raw_token)
    if session is None:
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Sesion invalida o expirada")
    return CurrentUser(
        user_id=session["user_id"],
        email_address=session["email_address"],
        display_name=session["display_name"],
        role=session["role"],
        must_change_password=session["must_change_password"],
    )


async def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Requiere rol admin")
    return user


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
AdminUserDep = Annotated[CurrentUser, Depends(require_admin)]


async def verify_internal_secret(request: Request) -> None:
    """Reusa el mismo secreto compartido que ya validan los webhooks de n8n
    (WEBHOOK_SHARED_SECRET/WEBHOOK_SHARED_SECRET_HEADER) para las rutas
    server-to-server (/internal/*): antes su unica proteccion era no estar
    mapeadas en proxy/nginx.conf, dependiendo solo del aislamiento de red de
    Docker. hmac.compare_digest evita filtrar el secreto por timing."""
    settings = get_settings()
    provided = request.headers.get(settings.webhook_shared_secret_header, "")
    if not settings.webhook_shared_secret or not hmac.compare_digest(provided, settings.webhook_shared_secret):
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Secreto interno invalido o ausente")


InternalSecretDep = Depends(verify_internal_secret)
