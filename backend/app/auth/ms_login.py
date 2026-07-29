"""OAuth2 de Microsoft/Entra ID para AUTENTICAR USUARIOS de la app (distinto
del OAuth2 de buzones que administra identity-broker/app/ms_oauth.py, del que
este modulo es una adaptacion). Aca no se guarda ningun token de Microsoft a
largo plazo: se usa una vez para identificar a la persona (scope de solo
identidad, sin offline_access) y el resultado es una sesion propia del
backend (ver app/auth/sessions.py)."""

from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"


class MicrosoftLoginError(Exception):
    pass


def _redirect_uri() -> str:
    settings = get_settings()
    return f"{settings.backend_public_url}/api/auth/microsoft/callback"


def build_authorize_url(state: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.ms_client_id,
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "response_mode": "query",
        "scope": settings.ms_login_scope,
        "state": state,
    }
    return f"https://login.microsoftonline.com/{settings.ms_tenant_id}/oauth2/v2.0/authorize?{urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> dict[str, Any]:
    settings = get_settings()
    token_url = f"https://login.microsoftonline.com/{settings.ms_tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": settings.ms_client_id,
        "client_secret": settings.ms_client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(),
        "scope": settings.ms_login_scope,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(token_url, data=data)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise MicrosoftLoginError(
            f"Microsoft rechazo la solicitud de token ({exc.response.status_code}): {exc.response.text}"
        ) from exc
    except httpx.HTTPError as exc:
        raise MicrosoftLoginError(f"No se pudo contactar a Microsoft: {exc}") from exc
    return response.json()


async def get_me(access_token: str) -> dict[str, Any]:
    """response["id"] es el object id (oid) del usuario en el tenant -- lo
    usamos como identificador estable en identity.users.ms_object_id."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                GRAPH_ME_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise MicrosoftLoginError(f"No se pudo consultar /me en Graph: {exc}") from exc
    return response.json()
