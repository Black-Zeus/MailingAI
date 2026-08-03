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
    MailboxTenantAssign,
    MailboxTestResponse,
    NotificationSenderUpdate,
    TenantConfigCreate,
    TenantConfigRead,
    TenantConfigUpdate,
    TokenResponse,
)

logger = logging.getLogger(__name__)

# Estado del flujo OAuth2 en curso (state -> label pendiente). En memoria:
# alcanza para un broker de una sola instancia -- si se reinicia a mitad de
# un login, el usuario simplemente vuelve a apretar "Conectar cuenta nueva".
_PENDING_STATES: dict[str, dict[str, float | str | int]] = {}
_STATE_TTL_SECONDS = 600


def _prune_expired_states() -> None:
    now = time.time()
    expired = [s for s, v in _PENDING_STATES.items() if now - v["created_at"] > _STATE_TTL_SECONDS]
    for s in expired:
        _PENDING_STATES.pop(s, None)


async def _ensure_default_tenant_config() -> None:
    """Si nunca se registro ningun tenant desde la UI, siembra uno a partir
    de las variables de entorno globales (MS_TENANT_ID/MS_CLIENT_ID/
    MS_CLIENT_SECRET, con MS_TENANT_NAME como label -- vacio si no se
    completo) -- para que un deploy existente (de antes de esta tabla) siga
    pudiendo conectar buzones nuevos sin ningun paso manual. Deploys nuevos
    sin esas variables completadas simplemente no siembran nada; el admin
    registra su primer tenant desde Configuracion."""
    settings = get_settings()
    if not (settings.ms_tenant_id and settings.ms_client_id and settings.ms_client_secret):
        return
    pool = get_pool()
    if await repository.count_tenant_configs(pool) > 0:
        return
    await repository.insert_tenant_config(
        pool,
        label=settings.ms_tenant_name,
        ms_tenant_id=settings.ms_tenant_id,
        ms_client_id=settings.ms_client_id,
        ms_client_secret=settings.ms_client_secret,
        is_active=True,
    )
    logger.info("Sembrado el tenant principal desde variables de entorno (identity.tenant_configs estaba vacia)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    try:
        await _ensure_default_tenant_config()
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
async def oauth_start(
    label: str = Query(min_length=1), tenant_config_id: int = Query(...)
) -> RedirectResponse:
    pool = get_pool()
    tenant = await repository.get_tenant_config_for_oauth(pool, tenant_config_id)
    if tenant is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    _prune_expired_states()
    state = secrets.token_urlsafe(24)
    _PENDING_STATES[state] = {
        "label": label,
        "tenant_config_id": tenant_config_id,
        "tenant_id": tenant["ms_tenant_id"],
        "client_id": tenant["ms_client_id"],
        "client_secret": tenant["ms_client_secret"],
        "created_at": time.time(),
    }
    return RedirectResponse(
        ms_oauth.build_authorize_url(state, tenant_id=tenant["ms_tenant_id"], client_id=tenant["ms_client_id"])
    )


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

    try:
        tokens = await ms_oauth.exchange_code_for_tokens(
            code,
            tenant_id=str(pending["tenant_id"]),
            client_id=str(pending["client_id"]),
            client_secret=str(pending["client_secret"]),
        )
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
        tenant_id=str(pending["tenant_id"]),
        client_id=str(pending["client_id"]),
        client_secret=str(pending["client_secret"]),
        tenant_config_id=int(pending["tenant_config_id"]),
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


@internal_router.patch("/mailboxes/{mailbox_account_id}/tenant", response_model=MailboxAccountRead)
async def assign_mailbox_tenant(mailbox_account_id: int, payload: MailboxTenantAssign) -> MailboxAccountRead:
    """Solo permite asignar el tenant de un buzon que todavia no tiene uno
    (ej. buzones conectados antes de que existiera esta tabla) -- una vez
    asignado, no se puede cambiar por acá: las credenciales reales del buzon
    (tenant_id/client_id/client_secret) quedan fijas a como se conecto de
    verdad, cambiar el tenant a mano rompe el proximo refresh de token si el
    buzon en realidad pertenece a otro tenant de Microsoft."""
    pool = get_pool()
    existing = await repository.get_mailbox_public(pool, mailbox_account_id)
    if existing is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    if existing["tenant_config_id"] is not None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Este buzón ya tiene un tenant asignado -- no se puede cambiar.",
        )
    tenant = await repository.get_tenant_config_for_oauth(pool, payload.tenant_config_id)
    if tenant is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    record = await repository.assign_mailbox_tenant(
        pool,
        mailbox_account_id,
        tenant_config_id=payload.tenant_config_id,
        tenant_id=tenant["ms_tenant_id"],
        client_id=tenant["ms_client_id"],
        client_secret=tenant["ms_client_secret"],
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


@internal_router.get("/tenant-configs", response_model=list[TenantConfigRead])
async def list_tenant_configs() -> list[TenantConfigRead]:
    pool = get_pool()
    records = await repository.list_tenant_configs(pool)
    return [TenantConfigRead(**dict(r)) for r in records]


@internal_router.post("/tenant-configs", response_model=TenantConfigRead, status_code=http_status.HTTP_201_CREATED)
async def create_tenant_config(payload: TenantConfigCreate) -> TenantConfigRead:
    pool = get_pool()
    record = await repository.insert_tenant_config(
        pool,
        label=payload.label,
        ms_tenant_id=payload.ms_tenant_id,
        ms_client_id=payload.ms_client_id,
        ms_client_secret=payload.ms_client_secret,
        is_active=payload.is_active,
    )
    return TenantConfigRead(**dict(record))


@internal_router.patch("/tenant-configs/{tenant_config_id}", response_model=TenantConfigRead)
async def update_tenant_config(tenant_config_id: int, payload: TenantConfigUpdate) -> TenantConfigRead:
    pool = get_pool()
    record = await repository.update_tenant_config(
        pool,
        tenant_config_id,
        label=payload.label,
        ms_tenant_id=payload.ms_tenant_id,
        ms_client_id=payload.ms_client_id,
        ms_client_secret=payload.ms_client_secret,
        is_active=payload.is_active,
    )
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return TenantConfigRead(**dict(record))


@internal_router.delete("/tenant-configs/{tenant_config_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_tenant_config(tenant_config_id: int) -> None:
    pool = get_pool()
    deleted = await repository.delete_tenant_config(pool, tenant_config_id)
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")


app.include_router(internal_router)
