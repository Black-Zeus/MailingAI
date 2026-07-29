from datetime import date, datetime

from pydantic import BaseModel


class AttachmentRead(BaseModel):
    attachment_id: str
    file_name: str
    extension: str | None
    content_type: str | None
    size_bytes: int | None
    file_date: date | None
    matches_naming_convention: bool
    matches_search_pattern: bool | None
    content_sha256: str | None = None


class AttachmentListItem(BaseModel):
    attachment_id: str
    message_id: str
    file_name: str
    extension: str | None
    content_type: str | None
    size_bytes: int | None
    file_date: date | None
    matches_naming_convention: bool
    matches_search_pattern: bool | None
    content_sha256: str | None
    content_sha256_computed_at: datetime | None
    message_subject: str | None
    message_from_address: str | None
    message_sent_datetime: datetime | None
    folder_path: str | None
    mailbox_account_id: int | None
    mailbox_label: str | None
    linked_to_case: bool


class MessageListItem(BaseModel):
    message_id: str
    conversation_id: str | None
    subject: str | None
    from_address: str | None
    from_name: str | None
    sent_datetime: datetime | None
    has_attachments: bool
    is_sent: bool
    folder_id: str | None
    folder_path: str | None
    mailbox_account_id: int | None
    mailbox_label: str | None
    attachments: list[AttachmentRead] = []


class MessageDetail(BaseModel):
    message_id: str
    conversation_id: str | None
    internet_message_id: str | None
    subject: str | None
    from_address: str | None
    from_name: str | None
    to_addresses: list[str]
    cc_addresses: list[str]
    sent_datetime: datetime | None
    received_datetime: datetime | None
    has_attachments: bool
    importance: str | None
    is_sent: bool
    categories: list[str]
    body_preview: str | None
    body_content: str | None
    body_content_type: str
    web_link: str | None
    folder_id: str | None
    folder_path: str | None
    mailbox_account_id: int | None
    mailbox_label: str | None
    attachments: list[AttachmentRead]


class ConversationRead(BaseModel):
    conversation_id: str
    message_count: int
    first_message_at: datetime | None
    last_message_at: datetime | None
    participants: list[str]
    messages: list[MessageListItem]


class RetraceAttachmentsResponse(BaseModel):
    traced_count: int


class MailFolderRead(BaseModel):
    folder_id: str
    parent_folder_id: str | None
    display_name: str
    folder_path: str | None
    child_folder_count: int
    total_item_count: int
    last_sync_at: datetime | None


class MailFolderNode(MailFolderRead):
    children: list["MailFolderNode"] = []


MailFolderNode.model_rebuild()
