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


class MailboxAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None


class TokenResponse(BaseModel):
    access_token: str
    expires_at: datetime


class MailboxTestResponse(BaseModel):
    email_address: str | None
    display_name: str | None
