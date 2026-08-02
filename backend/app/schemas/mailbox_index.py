from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

MailboxIndexStatus = Literal["queued", "running", "success", "partial", "failed", "cancelled"]
MailboxIndexFolderStatus = Literal["pendiente", "indexando", "listo", "parcial", "error"]


class MailboxIndexStartRequest(BaseModel):
    mailbox_account_id: int


class MailboxDeltaSyncDetail(BaseModel):
    mailbox_account_id: int
    label: str
    new_messages: int


class MailboxDeltaSyncNotifyRequest(BaseModel):
    details: list[MailboxDeltaSyncDetail]


class MailboxIndexFolderRead(BaseModel):
    folder_run_id: int
    position: int
    folder_id: str | None
    folder_path: str | None
    status: MailboxIndexFolderStatus
    folder_total_item_count: int | None
    messages_indexed: int
    windows_processed: int
    detail: str | None
    started_at: datetime | None
    finished_at: datetime | None


class MailboxIndexRunRead(BaseModel):
    index_run_id: UUID
    mailbox_account_id: int
    status: MailboxIndexStatus
    requested_by_user_id: int | None
    total_folders: int
    processed_folders: int
    total_messages_indexed: int
    total_messages_expected: int
    current_job_id: UUID | None
    cancel_requested: bool
    error_message: str | None
    requested_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    folders: list[MailboxIndexFolderRead] = []
