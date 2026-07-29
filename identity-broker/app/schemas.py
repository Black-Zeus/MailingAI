from datetime import datetime
from typing import Literal

from pydantic import BaseModel

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


class NotificationSenderUpdate(BaseModel):
    mailbox_account_id: int | None


class MailboxAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None


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
