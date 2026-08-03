from datetime import datetime

from pydantic import BaseModel, Field


class TenantConfigRead(BaseModel):
    tenant_config_id: int
    label: str
    ms_tenant_id: str
    ms_client_id: str
    has_client_secret: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TenantConfigCreate(BaseModel):
    label: str = Field(min_length=1)
    ms_tenant_id: str = Field(min_length=1)
    ms_client_id: str = Field(min_length=1)
    ms_client_secret: str = Field(min_length=1)
    is_active: bool = True


class TenantConfigUpdate(BaseModel):
    label: str | None = None
    ms_tenant_id: str | None = None
    ms_client_id: str | None = None
    # None = mantener el client secret existente -- mismo criterio que
    # AIProviderUpdate.api_key (backend/app/schemas/ai_providers.py).
    ms_client_secret: str | None = None
    is_active: bool | None = None
