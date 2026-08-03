from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"


class MicrosoftOAuthError(Exception):
    pass


def build_authorize_url(state: str, *, tenant_id: str, client_id: str) -> str:
    settings = get_settings()
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": f"{settings.public_base_url}/oauth/microsoft/callback",
        "response_mode": "query",
        "scope": settings.ms_scope,
        "state": state,
    }
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize?{urlencode(params)}"


async def exchange_code_for_tokens(code: str, *, tenant_id: str, client_id: str, client_secret: str) -> dict[str, Any]:
    settings = get_settings()
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": f"{settings.public_base_url}/oauth/microsoft/callback",
        "scope": settings.ms_scope,
    }
    return await _post_token(token_url, data)


async def refresh_access_token(
    *, tenant_id: str, client_id: str, client_secret: str, refresh_token: str
) -> dict[str, Any]:
    settings = get_settings()
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": settings.ms_scope,
    }
    return await _post_token(token_url, data)


async def _post_token(token_url: str, data: dict[str, str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(token_url, data=data)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise MicrosoftOAuthError(
            f"Microsoft rechazo la solicitud de token ({exc.response.status_code}): {exc.response.text}"
        ) from exc
    except httpx.HTTPError as exc:
        raise MicrosoftOAuthError(f"No se pudo contactar a Microsoft: {exc}") from exc
    return response.json()


def expires_at_from(token_payload: dict[str, Any]) -> datetime:
    expires_in = int(token_payload.get("expires_in") or 3600)
    return datetime.now(timezone.utc) + timedelta(seconds=expires_in)


async def get_me(access_token: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                GRAPH_ME_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise MicrosoftOAuthError(f"No se pudo consultar /me en Graph: {exc}") from exc
    return response.json()
