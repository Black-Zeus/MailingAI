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
    owner_user_id: int | None = None
    is_notification_sender: bool = False
    tenant_config_id: int | None = None


class MailboxAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None


class MailboxTenantAssign(BaseModel):
    tenant_config_id: int


class MailboxConnectUrlResponse(BaseModel):
    url: str


class MailboxConnectUrlRequest(BaseModel):
    label: str = Field(min_length=1)


class MailboxTestResponse(BaseModel):
    email_address: str | None
    display_name: str | None


MailboxSharePermission = Literal["read"]


class MailboxShareCreate(BaseModel):
    user_id: int
    permission: MailboxSharePermission = "read"


class MailboxAccessRevokeResponse(BaseModel):
    revoked: bool
    cases_affected: int


class NotificationSenderUpdate(BaseModel):
    mailbox_account_id: int | None


class MailboxSendTestResponse(BaseModel):
    sent: bool


class MailboxDeletionImpactRead(BaseModel):
    message_count: int
    cases_deleted: int
    cases_affected: int


class MailboxShareRead(BaseModel):
    mailbox_account_id: int
    user_id: int
    email_address: str
    display_name: str | None
    permission: MailboxSharePermission
    shared_by_user_id: int | None
    created_at: datetime
