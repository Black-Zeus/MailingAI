from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MailboxProvider = Literal["microsoft"]


class MailboxAccountRead(BaseModel):
    mailbox_account_id: int
    label: str
    email_address: str | None
    provider: MailboxProvider
    enabled: bool
    token_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    owner_user_id: int | None
    is_notification_sender: bool
    tenant_config_id: int | None = None


class NotificationSenderUpdate(BaseModel):
    mailbox_account_id: int | None


class MailboxAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None


class MailboxTenantAssign(BaseModel):
    tenant_config_id: int


class TokenResponse(BaseModel):
    access_token: str
    expires_at: datetime


class MailboxTestResponse(BaseModel):
    email_address: str | None
    display_name: str | None


class MailboxOwnerClaim(BaseModel):
    owner_user_id: int
    force: bool = False


MailboxSharePermission = Literal["read"]


class MailboxShareCreate(BaseModel):
    user_id: int
    permission: MailboxSharePermission = "read"


class MailboxShareRead(BaseModel):
    mailbox_account_id: int
    user_id: int
    email_address: str
    display_name: str | None
    permission: MailboxSharePermission
    shared_by_user_id: int | None
    created_at: datetime


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
