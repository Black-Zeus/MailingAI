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
    )


async def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Requiere rol admin")
    return user


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
AdminUserDep = Annotated[CurrentUser, Depends(require_admin)]
