from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import AdminUserDep
from app.schemas.tenants import TenantConfigCreate, TenantConfigRead, TenantConfigUpdate
from app.services import identity_broker_client
from app.services.identity_broker_client import IdentityBrokerError

router = APIRouter(prefix="/api/admin/tenants", tags=["admin-tenants"])


@router.get("", response_model=list[TenantConfigRead])
async def list_tenant_configs(_admin: AdminUserDep) -> list[TenantConfigRead]:
    try:
        records = await identity_broker_client.list_tenant_configs()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return [TenantConfigRead(**r) for r in records]


@router.post("", response_model=TenantConfigRead, status_code=http_status.HTTP_201_CREATED)
async def create_tenant_config(payload: TenantConfigCreate, _admin: AdminUserDep) -> TenantConfigRead:
    try:
        record = await identity_broker_client.create_tenant_config(
            label=payload.label,
            ms_tenant_id=payload.ms_tenant_id,
            ms_client_id=payload.ms_client_id,
            ms_client_secret=payload.ms_client_secret,
            is_active=payload.is_active,
        )
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return TenantConfigRead(**record)


@router.patch("/{tenant_config_id}", response_model=TenantConfigRead)
async def update_tenant_config(tenant_config_id: int, payload: TenantConfigUpdate, _admin: AdminUserDep) -> TenantConfigRead:
    try:
        record = await identity_broker_client.update_tenant_config(
            tenant_config_id,
            label=payload.label,
            ms_tenant_id=payload.ms_tenant_id,
            ms_client_id=payload.ms_client_id,
            ms_client_secret=payload.ms_client_secret,
            is_active=payload.is_active,
        )
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return TenantConfigRead(**record)


@router.delete("/{tenant_config_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_tenant_config(tenant_config_id: int, _admin: AdminUserDep) -> None:
    """Borrar un tenant registrado no desconecta los buzones que ya se
    conectaron con el (guardan su propio tenant_id/client_id/client_secret,
    ver identity.mailbox_accounts) -- solo deja de aparecer como opcion para
    conectar buzones nuevos."""
    try:
        deleted = await identity_broker_client.delete_tenant_config(tenant_config_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
