"""Sesiones server-side (token opaco, no JWT). El navegador solo ve el token
en una cookie httpOnly; en la base solo se guarda su hash sha256 -- mismo
criterio que se usaria con una contraseña, para que un dump de la tabla no
alcance para robar sesiones activas."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg

from app.config import get_settings
from app.repositories import sessions_repository


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_session(
    pool: asyncpg.Pool,
    *,
    user_id: int,
    user_agent: str | None,
    ip_address: str | None,
) -> str:
    settings = get_settings()
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.session_ttl_seconds)
    await sessions_repository.insert_session(
        pool,
        session_token_hash=_hash_token(raw_token),
        user_id=user_id,
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return raw_token


async def get_valid_session(pool: asyncpg.Pool, raw_token: str) -> asyncpg.Record | None:
    settings = get_settings()
    token_hash = _hash_token(raw_token)
    session = await sessions_repository.get_active_session(pool, token_hash)
    if session is None:
        return None
    now = datetime.now(timezone.utc)
    absolute_deadline = session["created_at"] + timedelta(seconds=settings.session_absolute_ttl_seconds)
    if now >= absolute_deadline:
        await sessions_repository.revoke_session(pool, token_hash)
        return None
    # Ventana deslizante: cada request valido empuja el vencimiento hacia
    # adelante, pero nunca mas alla del tope absoluto desde la creacion real.
    new_expires_at = min(now + timedelta(seconds=settings.session_ttl_seconds), absolute_deadline)
    await sessions_repository.touch_session(pool, token_hash, expires_at=new_expires_at)
    return session


async def revoke_session(pool: asyncpg.Pool, raw_token: str) -> None:
    await sessions_repository.revoke_session(pool, _hash_token(raw_token))


async def revoke_all_sessions(pool: asyncpg.Pool, user_id: int) -> None:
    await sessions_repository.revoke_all_sessions_for_user(pool, user_id)
