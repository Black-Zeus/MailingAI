from datetime import datetime
from typing import Literal

from pydantic import BaseModel

NotificationKind = Literal["case_shared", "mailbox_shared", "mailbox_delta_sync_done", "ai_analysis_done"]


class NotificationRead(BaseModel):
    notification_id: int
    kind: NotificationKind
    message: str
    case_id: int | None
    mailbox_account_id: int | None
    read_at: datetime | None
    created_at: datetime


class UnreadCountResponse(BaseModel):
    unread: int
