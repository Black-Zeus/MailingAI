import logging
import secrets
import time
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse

from app.auth import ms_login, sessions
from app.auth.dependencies import CurrentUserDep
from app.auth.ms_login import MicrosoftLoginError
from app.config import get_settings
from app.db import get_pool
from app.repositories import users_repository
from app.schemas.auth import CurrentUserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

# Estado del flujo OAuth2 en curso (state -> creado_at), solo para validar
# que el callback corresponde a un login que efectivamente iniciamos (CSRF).
# En memoria: alcanza para un backend de una sola instancia -- si se
# reinicia a mitad de un login, el usuario simplemente vuelve a intentar.
_PENDING_STATES: dict[str, float] = {}
_STATE_TTL_SECONDS = 600


def _prune_expired_states() -> None:
    now = time.time()
    expired = [s for s, created_at in _PENDING_STATES.items() if now - created_at > _STATE_TTL_SECONDS]
    for s in expired:
        _PENDING_STATES.pop(s, None)


def _set_session_cookie(response: Response, raw_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=settings.session_absolute_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


@router.get("/login")
async def login() -> RedirectResponse:
    _prune_expired_states()
    state = secrets.token_urlsafe(24)
    _PENDING_STATES[state] = time.time()
    return RedirectResponse(ms_login.build_authorize_url(state))


@router.get("/microsoft/callback")
async def microsoft_callback(
    pool: PoolDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    settings = get_settings()
    _prune_expired_states()
    valid_state = state is not None and _PENDING_STATES.pop(state, None) is not None

    if error or not valid_state or not code:
        return RedirectResponse(f"{settings.frontend_url}/?login_error=oauth_failed")

    try:
        tokens = await ms_login.exchange_code_for_tokens(code)
        me = await ms_login.get_me(tokens["access_token"])
    except MicrosoftLoginError:
        logger.exception("Fallo el intercambio de codigo OAuth2 de login con Microsoft")
        return RedirectResponse(f"{settings.frontend_url}/?login_error=oauth_failed")

    ms_object_id = me.get("id")
    email_address = me.get("mail") or me.get("userPrincipalName")
    if not ms_object_id or not email_address:
        return RedirectResponse(f"{settings.frontend_url}/?login_error=oauth_failed")

    user = await users_repository.find_or_link_by_oauth(
        pool, ms_object_id=ms_object_id, email_address=email_address
    )
    if user is None:
        return RedirectResponse(f"{settings.frontend_url}/?login_error=not_authorized")

    raw_token = await sessions.create_session(pool, user_id=user["user_id"], user_agent=None, ip_address=None)
    response = RedirectResponse(settings.frontend_url)
    _set_session_cookie(response, raw_token)
    return response


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, pool: PoolDep) -> None:
    settings = get_settings()
    raw_token = request.cookies.get(settings.session_cookie_name)
    if raw_token:
        await sessions.revoke_session(pool, raw_token)
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me", response_model=CurrentUserRead)
async def get_me(user: CurrentUserDep) -> CurrentUserRead:
    return CurrentUserRead(
        user_id=user.user_id,
        email_address=user.email_address,
        display_name=user.display_name,
        role=user.role,
    )
