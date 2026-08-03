import logging
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class IdentityBrokerError(Exception):
    pass


def _headers() -> dict[str, str]:
    """Mismo secreto compartido que ya validan los webhooks de n8n -- el
    identity-broker ahora exige este header en /internal/* en vez de confiar
    solo en el aislamiento de red de Docker (ver docs/SECURITY.md)."""
    settings = get_settings()
    return {settings.webhook_shared_secret_header: settings.webhook_shared_secret}


def build_connect_url(label: str, tenant_config_id: int) -> str:
    """URL publica (alcanzable desde el navegador) para iniciar el consentimiento
    OAuth2 de una cuenta nueva -- el frontend navega directo ahi, no pasa por
    este backend (el broker responde con un redirect a login.microsoftonline.com).
    tenant_config_id elige con que tenant registrado (Configuracion -> Tenants
    de Microsoft) se hace el consentimiento."""
    settings = get_settings()
    query = urlencode({"label": label, "tenant_config_id": tenant_config_id})
    return f"{settings.identity_broker_public_url}/oauth/microsoft/start?{query}"


async def list_mailboxes() -> list[dict[str, Any]]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.get(f"{settings.identity_broker_url}/internal/mailboxes")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo listar las cuentas de buzon en el identity-broker")
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def update_mailbox(mailbox_account_id: int, *, label: str | None, enabled: bool | None) -> dict[str, Any] | None:
    settings = get_settings()
    payload = {"label": label, "enabled": enabled}
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.patch(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}", json=payload
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo actualizar la cuenta de buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


class MailboxTenantAlreadyAssignedError(Exception):
    """El buzon ya tiene un tenant asignado y no se puede cambiar."""


async def assign_mailbox_tenant(mailbox_account_id: int, tenant_config_id: int) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.patch(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/tenant",
                json={"tenant_config_id": tenant_config_id},
            )
        if response.status_code == 404:
            return None
        if response.status_code == 409:
            raise MailboxTenantAlreadyAssignedError(mailbox_account_id)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo reasignar el tenant del buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def test_mailbox(mailbox_account_id: int) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            response = await client.get(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/test"
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.exception("La prueba de conexion de la cuenta %s fallo", mailbox_account_id)
        detail = exc.response.text
        try:
            detail = exc.response.json().get("detail", detail)
        except Exception:
            pass
        raise IdentityBrokerError(detail) from exc
    except httpx.HTTPError as exc:
        logger.exception("No se pudo contactar al identity-broker para probar la cuenta %s", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def delete_mailbox(mailbox_account_id: int) -> bool:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.delete(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}"
            )
        if response.status_code == 404:
            return False
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo eliminar la cuenta de buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return True


class MailboxAlreadyClaimedError(Exception):
    """La cuenta ya tiene dueño y no se pidio forzar el cambio."""


async def claim_mailbox_owner(mailbox_account_id: int, *, owner_user_id: int) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.patch(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/owner",
                json={"owner_user_id": owner_user_id, "force": False},
            )
        if response.status_code == 404:
            return None
        if response.status_code == 409:
            raise MailboxAlreadyClaimedError(mailbox_account_id)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo reclamar la cuenta de buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def clear_mailbox_owner(mailbox_account_id: int) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.delete(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/owner"
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo liberar el dueño del buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def get_notification_sender() -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.get(f"{settings.identity_broker_url}/internal/notification-sender")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo consultar el buzon remitente de notificaciones")
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    data = response.json()
    return data if data else None


async def set_notification_sender(mailbox_account_id: int | None) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.put(
                f"{settings.identity_broker_url}/internal/notification-sender",
                json={"mailbox_account_id": mailbox_account_id},
            )
        if response.status_code == 404:
            raise IdentityBrokerError("Esa cuenta no existe.")
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo actualizar el buzon remitente de notificaciones")
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    data = response.json()
    return data if data else None


async def list_mailbox_shares(mailbox_account_id: int) -> list[dict[str, Any]]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.get(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/shares"
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo listar comparticiones del buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def share_mailbox(
    mailbox_account_id: int, *, user_id: int, permission: str, shared_by_user_id: int
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.post(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/shares",
                params={"shared_by_user_id": shared_by_user_id},
                json={"user_id": user_id, "permission": permission},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo compartir el buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def revoke_mailbox_share(mailbox_account_id: int, user_id: int) -> bool:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.delete(
                f"{settings.identity_broker_url}/internal/mailboxes/{mailbox_account_id}/shares/{user_id}"
            )
        if response.status_code == 404:
            return False
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo revocar comparticion del buzon %s en el identity-broker", mailbox_account_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return True


async def list_tenant_configs() -> list[dict[str, Any]]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.get(f"{settings.identity_broker_url}/internal/tenant-configs")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo listar los tenants en el identity-broker")
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def create_tenant_config(
    *, label: str, ms_tenant_id: str, ms_client_id: str, ms_client_secret: str, is_active: bool
) -> dict[str, Any]:
    settings = get_settings()
    payload = {
        "label": label,
        "ms_tenant_id": ms_tenant_id,
        "ms_client_id": ms_client_id,
        "ms_client_secret": ms_client_secret,
        "is_active": is_active,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.post(f"{settings.identity_broker_url}/internal/tenant-configs", json=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo crear el tenant en el identity-broker")
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def update_tenant_config(
    tenant_config_id: int,
    *,
    label: str | None,
    ms_tenant_id: str | None,
    ms_client_id: str | None,
    ms_client_secret: str | None,
    is_active: bool | None,
) -> dict[str, Any] | None:
    settings = get_settings()
    payload = {
        "label": label,
        "ms_tenant_id": ms_tenant_id,
        "ms_client_id": ms_client_id,
        "ms_client_secret": ms_client_secret,
        "is_active": is_active,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.patch(
                f"{settings.identity_broker_url}/internal/tenant-configs/{tenant_config_id}", json=payload
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo actualizar el tenant %s en el identity-broker", tenant_config_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return response.json()


async def delete_tenant_config(tenant_config_id: int) -> bool:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_headers()) as client:
            response = await client.delete(f"{settings.identity_broker_url}/internal/tenant-configs/{tenant_config_id}")
        if response.status_code == 404:
            return False
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo eliminar el tenant %s en el identity-broker", tenant_config_id)
        raise IdentityBrokerError(f"No se pudo contactar al identity-broker: {exc}") from exc
    return True
