import hmac
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi import status as http_status
from fastapi.responses import HTMLResponse, RedirectResponse

from app import ms_oauth, repository
from app.config import get_settings
from app.db import connect, disconnect, get_pool
from app.ms_oauth import MicrosoftOAuthError
from app.schemas import (
    MailboxAccountRead,
    MailboxAccountUpdate,
    MailboxOwnerClaim,
    MailboxShareCreate,
    MailboxShareRead,
    MailboxTestResponse,
    NotificationSenderUpdate,
    TokenResponse,
)

logger = logging.getLogger(__name__)

# Estado del flujo OAuth2 en curso (state -> label pendiente). En memoria:
# alcanza para un broker de una sola instancia -- si se reinicia a mitad de
# un login, el usuario simplemente vuelve a apretar "Conectar cuenta nueva".
_PENDING_STATES: dict[str, dict[str, float | str]] = {}
_STATE_TTL_SECONDS = 600


def _prune_expired_states() -> None:
    now = time.time()
    expired = [s for s, v in _PENDING_STATES.items() if now - v["created_at"] > _STATE_TTL_SECONDS]
    for s in expired:
        _PENDING_STATES.pop(s, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    try:
        yield
    finally:
        await disconnect()


async def verify_internal_secret(request: Request) -> None:
    """Mismo mecanismo que backend/app/auth/dependencies.py -- reusa el
    secreto compartido de los webhooks de n8n en vez de confiar solo en el
    aislamiento de red de Docker para estas rutas server-to-server."""
    settings = get_settings()
    provided = request.headers.get(settings.webhook_shared_secret_header, "")
    if not settings.webhook_shared_secret or not hmac.compare_digest(provided, settings.webhook_shared_secret):
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Secreto interno invalido o ausente")


internal_router = APIRouter(prefix="/internal", dependencies=[Depends(verify_internal_secret)])

app = FastAPI(title="mailingai-identity-broker", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mailingai-identity-broker"}


@app.get("/oauth/microsoft/start")
async def oauth_start(label: str = Query(min_length=1)) -> RedirectResponse:
    _prune_expired_states()
    state = secrets.token_urlsafe(24)
    _PENDING_STATES[state] = {"label": label, "created_at": time.time()}
    return RedirectResponse(ms_oauth.build_authorize_url(state))


@app.get("/oauth/microsoft/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> HTMLResponse:
    if error:
        return HTMLResponse(
            f"<h1>Microsoft rechazó el login</h1><p>{error}: {error_description or ''}</p>"
            "<p>Volvé a Configuración e intentá de nuevo.</p>",
            status_code=400,
        )
    pending = _PENDING_STATES.pop(state, None) if state else None
    if pending is None or not code:
        return HTMLResponse(
            "<h1>Solicitud inválida o expirada</h1><p>Volvé a Configuración e intentá de nuevo.</p>",
            status_code=400,
        )

    settings = get_settings()
    try:
        tokens = await ms_oauth.exchange_code_for_tokens(code)
        me = await ms_oauth.get_me(tokens["access_token"])
    except MicrosoftOAuthError as exc:
        logger.exception("Fallo el intercambio de codigo OAuth2 con Microsoft")
        return HTMLResponse(f"<h1>No se pudo completar la conexión</h1><p>{exc}</p>", status_code=502)

    email_address = me.get("mail") or me.get("userPrincipalName")
    pool = get_pool()
    account = await repository.upsert_from_oauth(
        pool,
        label=str(pending["label"]),
        email_address=email_address,
        provider="microsoft",
        tenant_id=settings.ms_tenant_id,
        client_id=settings.ms_client_id,
        client_secret=settings.ms_client_secret,
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token", ""),
        token_expires_at=ms_oauth.expires_at_from(tokens),
    )
    return HTMLResponse(
        "<html><body style=\"font-family: sans-serif; padding: 2rem;\">"
        f"<h1>Cuenta conectada</h1><p><strong>{account['email_address']}</strong> quedó registrada "
        f"como «{account['label']}».</p><p>Esta ventana se cierra sola.</p>"
        "<script>"
        f"try {{ window.opener && window.opener.postMessage("
        f"{{type: 'mailingai-mailbox-connected', mailbox_account_id: {account['mailbox_account_id']}, "
        f"email_address: {json.dumps(account['email_address'])}}}, '*'); }} catch (e) {{}}"
        "window.close();"
        "</script>"
        "</body></html>"
    )


@internal_router.get("/mailboxes", response_model=list[MailboxAccountRead])
async def list_mailboxes() -> list[MailboxAccountRead]:
    pool = get_pool()
    records = await repository.list_mailboxes(pool)
    return [MailboxAccountRead(**dict(r)) for r in records]


@internal_router.patch("/mailboxes/{mailbox_account_id}", response_model=MailboxAccountRead)
async def patch_mailbox(mailbox_account_id: int, payload: MailboxAccountUpdate) -> MailboxAccountRead:
    pool = get_pool()
    record = await repository.update_mailbox(
        pool, mailbox_account_id, label=payload.label, enabled=payload.enabled
    )
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**dict(record))


@internal_router.delete("/mailboxes/{mailbox_account_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_mailbox(mailbox_account_id: int) -> None:
    pool = get_pool()
    deleted = await repository.delete_mailbox(pool, mailbox_account_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")


@internal_router.patch("/mailboxes/{mailbox_account_id}/owner", response_model=MailboxAccountRead)
async def claim_mailbox_owner(mailbox_account_id: int, payload: MailboxOwnerClaim) -> MailboxAccountRead:
    pool = get_pool()
    try:
        record = await repository.claim_mailbox_owner(
            pool, mailbox_account_id, owner_user_id=payload.owner_user_id, force=payload.force
        )
    except repository.MailboxAlreadyOwnedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail="Esta cuenta ya fue reclamada por otro usuario."
        ) from exc
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**dict(record))


@internal_router.delete("/mailboxes/{mailbox_account_id}/owner", response_model=MailboxAccountRead)
async def clear_mailbox_owner(mailbox_account_id: int) -> MailboxAccountRead:
    pool = get_pool()
    record = await repository.clear_mailbox_owner(pool, mailbox_account_id)
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**dict(record))


@internal_router.get("/notification-sender", response_model=MailboxAccountRead | None)
async def get_notification_sender() -> MailboxAccountRead | None:
    pool = get_pool()
    record = await repository.get_notification_sender(pool)
    return MailboxAccountRead(**dict(record)) if record is not None else None


@internal_router.put("/notification-sender", response_model=MailboxAccountRead | None)
async def set_notification_sender(payload: NotificationSenderUpdate) -> MailboxAccountRead | None:
    pool = get_pool()
    if payload.mailbox_account_id is not None:
        existing = await repository.get_mailbox_public(pool, payload.mailbox_account_id)
        if existing is None:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    record = await repository.set_notification_sender(pool, payload.mailbox_account_id)
    return MailboxAccountRead(**dict(record)) if record is not None else None


@internal_router.get("/mailboxes/{mailbox_account_id}/shares", response_model=list[MailboxShareRead])
async def list_mailbox_shares(mailbox_account_id: int) -> list[MailboxShareRead]:
    pool = get_pool()
    records = await repository.list_mailbox_shares(pool, mailbox_account_id)
    return [MailboxShareRead(**dict(r)) for r in records]


@internal_router.post("/mailboxes/{mailbox_account_id}/shares", response_model=MailboxShareRead)
async def share_mailbox(
    mailbox_account_id: int, payload: MailboxShareCreate, shared_by_user_id: int = Query(...)
) -> MailboxShareRead:
    pool = get_pool()
    record = await repository.upsert_mailbox_share(
        pool,
        mailbox_account_id=mailbox_account_id,
        user_id=payload.user_id,
        permission=payload.permission,
        shared_by_user_id=shared_by_user_id,
    )
    return MailboxShareRead(**dict(record))


@internal_router.delete("/mailboxes/{mailbox_account_id}/shares/{user_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def revoke_mailbox_share(mailbox_account_id: int, user_id: int) -> None:
    pool = get_pool()
    deleted = await repository.delete_mailbox_share(pool, mailbox_account_id, user_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Comparticion no encontrada")


async def _get_valid_token(mailbox_account_id: int) -> TokenResponse:
    pool = get_pool()
    row = await repository.get_mailbox_for_token(pool, mailbox_account_id)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    if not row["enabled"]:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Cuenta deshabilitada")

    settings = get_settings()
    expires_at: datetime = row["token_expires_at"]
    now = datetime.now(timezone.utc)
    needs_refresh = expires_at is None or (expires_at - now).total_seconds() < settings.token_refresh_margin_seconds

    if not needs_refresh:
        return TokenResponse(access_token=row["access_token"], expires_at=expires_at)

    try:
        tokens = await ms_oauth.refresh_access_token(
            tenant_id=row["tenant_id"],
            client_id=row["client_id"],
            client_secret=row["client_secret"],
            refresh_token=row["refresh_token"],
        )
    except MicrosoftOAuthError as exc:
        logger.exception("No se pudo renovar el token de la cuenta %s", mailbox_account_id)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo renovar el token con Microsoft: {exc}",
        ) from exc

    new_access_token = tokens["access_token"]
    new_refresh_token = tokens.get("refresh_token") or row["refresh_token"]
    new_expires_at = ms_oauth.expires_at_from(tokens)
    await repository.update_tokens(
        pool,
        mailbox_account_id,
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        token_expires_at=new_expires_at,
    )
    return TokenResponse(access_token=new_access_token, expires_at=new_expires_at)


@internal_router.get("/token/{mailbox_account_id}", response_model=TokenResponse)
async def get_token(mailbox_account_id: int) -> TokenResponse:
    return await _get_valid_token(mailbox_account_id)


@internal_router.get("/mailboxes/{mailbox_account_id}/test", response_model=MailboxTestResponse)
async def test_mailbox(mailbox_account_id: int) -> MailboxTestResponse:
    """Confirma que la cuenta realmente funciona: consigue/renueva un token y hace
    una llamada real a Graph (/me), no solo verifica que haya un token guardado."""
    token = await _get_valid_token(mailbox_account_id)
    try:
        me = await ms_oauth.get_me(token.access_token)
    except MicrosoftOAuthError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=f"El token es válido pero Graph rechazó la consulta: {exc}",
        ) from exc
    return MailboxTestResponse(
        email_address=me.get("mail") or me.get("userPrincipalName"),
        display_name=me.get("displayName"),
    )


app.include_router(internal_router)
