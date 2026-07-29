import json
from datetime import datetime

import asyncpg

from app.repositories import messages_repository
from app.schemas.messages import (
    AttachmentListItem,
    AttachmentRead,
    ConversationRead,
    MailFolderNode,
    MessageDetail,
    MessageListItem,
)


def _jsonb(value: object) -> list:
    if isinstance(value, str):
        return json.loads(value)
    return value or []


def _to_attachment(record: asyncpg.Record) -> AttachmentRead:
    return AttachmentRead(
        attachment_id=record["attachment_id"],
        file_name=record["file_name"],
        extension=record["extension"],
        content_type=record["content_type"],
        size_bytes=record["size_bytes"],
        file_date=record["file_date"],
        matches_naming_convention=record["matches_naming_convention"],
        matches_search_pattern=record["matches_search_pattern"],
        content_sha256=record["content_sha256"],
    )


def _to_attachment_list_item(record: asyncpg.Record) -> AttachmentListItem:
    return AttachmentListItem(
        attachment_id=record["attachment_id"],
        message_id=record["message_id"],
        file_name=record["file_name"],
        extension=record["extension"],
        content_type=record["content_type"],
        size_bytes=record["size_bytes"],
        file_date=record["file_date"],
        matches_naming_convention=record["matches_naming_convention"],
        matches_search_pattern=record["matches_search_pattern"],
        content_sha256=record["content_sha256"],
        content_sha256_computed_at=record["content_sha256_computed_at"],
        message_subject=record["message_subject"],
        message_from_address=record["message_from_address"],
        message_sent_datetime=record["message_sent_datetime"],
        folder_path=record["folder_path"],
        mailbox_account_id=record["mailbox_account_id"],
        mailbox_label=record["mailbox_label"],
        linked_to_case=record["linked_to_case"],
    )


def _to_list_item(record: asyncpg.Record) -> MessageListItem:
    return MessageListItem(
        message_id=record["message_id"],
        conversation_id=record["conversation_id"],
        subject=record["subject"],
        from_address=record["from_address"],
        from_name=record["from_name"],
        sent_datetime=record["sent_datetime"],
        has_attachments=record["has_attachments"],
        is_sent=record["is_sent"],
        folder_id=record["folder_id"],
        folder_path=record["folder_path"],
        mailbox_account_id=record["mailbox_account_id"],
        mailbox_label=record["mailbox_label"],
    )


async def list_messages(
    pool: asyncpg.Pool,
    *,
    folder_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_address: str | None,
    subject_contains: str | None,
    text_search: str | None,
    text_contains: str | None,
    conversation_id: str | None,
    is_sent: bool | None,
    has_attachments: bool | None,
    attachment_pattern: str | None,
    mailbox_account_id: int | None,
    accessible_mailbox_ids: list[int] | None,
    limit: int,
    offset: int,
) -> list[MessageListItem]:
    records = await messages_repository.list_messages(
        pool,
        folder_id=folder_id,
        date_from=date_from,
        date_to=date_to,
        from_address=from_address,
        subject_contains=subject_contains,
        text_search=text_search,
        text_contains=text_contains,
        conversation_id=conversation_id,
        is_sent=is_sent,
        has_attachments=has_attachments,
        attachment_pattern=attachment_pattern,
        mailbox_account_id=mailbox_account_id,
        accessible_mailbox_ids=accessible_mailbox_ids,
        limit=limit,
        offset=offset,
    )
    return [_to_list_item(record) for record in records]


async def count_messages(
    pool: asyncpg.Pool,
    *,
    folder_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_address: str | None,
    subject_contains: str | None,
    text_search: str | None,
    text_contains: str | None,
    conversation_id: str | None,
    is_sent: bool | None,
    has_attachments: bool | None,
    attachment_pattern: str | None,
    mailbox_account_id: int | None,
    accessible_mailbox_ids: list[int] | None,
) -> int:
    return await messages_repository.count_messages(
        pool,
        folder_id=folder_id,
        date_from=date_from,
        date_to=date_to,
        from_address=from_address,
        subject_contains=subject_contains,
        text_search=text_search,
        text_contains=text_contains,
        conversation_id=conversation_id,
        is_sent=is_sent,
        has_attachments=has_attachments,
        attachment_pattern=attachment_pattern,
        mailbox_account_id=mailbox_account_id,
        accessible_mailbox_ids=accessible_mailbox_ids,
    )


async def get_message(
    pool: asyncpg.Pool, message_id: str, *, accessible_mailbox_ids: list[int] | None
) -> MessageDetail | None:
    record = await messages_repository.get_message(pool, message_id, accessible_mailbox_ids=accessible_mailbox_ids)
    if record is None:
        return None
    attachment_records = await messages_repository.list_attachments_for_message(pool, message_id)
    attachments = [_to_attachment(a) for a in attachment_records]
    return MessageDetail(
        message_id=record["message_id"],
        conversation_id=record["conversation_id"],
        internet_message_id=record["internet_message_id"],
        subject=record["subject"],
        from_address=record["from_address"],
        from_name=record["from_name"],
        to_addresses=_jsonb(record["to_addresses"]),
        cc_addresses=_jsonb(record["cc_addresses"]),
        sent_datetime=record["sent_datetime"],
        received_datetime=record["received_datetime"],
        has_attachments=record["has_attachments"],
        importance=record["importance"],
        is_sent=record["is_sent"],
        categories=_jsonb(record["categories"]),
        body_preview=record["body_preview"],
        body_content=record["body_content"],
        body_content_type=record["body_content_type"],
        web_link=record["web_link"],
        folder_id=record["folder_id"],
        folder_path=record["folder_path"],
        mailbox_account_id=record["mailbox_account_id"],
        mailbox_label=record["mailbox_label"],
        attachments=attachments,
    )


async def get_conversation(
    pool: asyncpg.Pool, conversation_id: str, *, accessible_mailbox_ids: list[int] | None
) -> ConversationRead | None:
    summary = await messages_repository.get_conversation_summary(pool, conversation_id)
    if summary is None:
        return None
    message_records = await messages_repository.list_messages_in_conversation(
        pool, conversation_id, accessible_mailbox_ids=accessible_mailbox_ids
    )
    return ConversationRead(
        conversation_id=summary["conversation_id"],
        message_count=summary["message_count"],
        first_message_at=summary["first_message_at"],
        last_message_at=summary["last_message_at"],
        participants=_jsonb(summary["participants"]),
        messages=[_to_list_item(record) for record in message_records],
    )


async def list_messages_by_run(
    pool: asyncpg.Pool, run_id: int, *, accessible_mailbox_ids: list[int] | None
) -> list[MessageListItem]:
    records = await messages_repository.list_messages_by_run(pool, run_id, accessible_mailbox_ids=accessible_mailbox_ids)
    items = [_to_list_item(record) for record in records]
    ids_with_attachments = [item.message_id for item in items if item.has_attachments]
    attachment_records = await messages_repository.list_attachments_for_messages(
        pool, ids_with_attachments
    )
    attachments_by_message: dict[str, list[AttachmentRead]] = {}
    for a in attachment_records:
        attachments_by_message.setdefault(a["message_id"], []).append(_to_attachment(a))
    for item in items:
        item.attachments = attachments_by_message.get(item.message_id, [])
    return items


class InvalidDeleteScopeError(Exception):
    """Los parametros de borrado no son validos para el scope elegido."""


async def delete_messages(
    pool: asyncpg.Pool,
    *,
    scope: str,
    date_from: datetime | None,
    date_to: datetime | None,
    folder_id: str | None,
) -> int:
    if scope == "all":
        return await messages_repository.delete_all_messages(pool)
    if scope == "date_range":
        if date_from is None or date_to is None:
            raise InvalidDeleteScopeError("scope=date_range requiere date_from y date_to.")
        return await messages_repository.delete_messages_by_date_range(pool, date_from, date_to)
    if scope == "folder":
        if not folder_id:
            raise InvalidDeleteScopeError("scope=folder requiere folder_id.")
        return await messages_repository.delete_messages_by_folder(pool, folder_id)
    if scope == "unlinked":
        return await messages_repository.delete_unlinked_messages(pool)
    raise InvalidDeleteScopeError(f"scope '{scope}' desconocido.")


async def set_attachment_hash(
    pool: asyncpg.Pool, message_id: str, attachment_id: str, sha256: str
) -> None:
    await messages_repository.set_attachment_hash(pool, message_id, attachment_id, sha256)


async def list_all_attachments(
    pool: asyncpg.Pool,
    *,
    file_name_contains: str | None,
    extension: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    only_hashed: bool | None,
    only_linked_to_case: bool | None,
    accessible_mailbox_ids: list[int] | None,
    limit: int,
    offset: int,
) -> list[AttachmentListItem]:
    records = await messages_repository.list_all_attachments(
        pool,
        file_name_contains=file_name_contains,
        extension=extension,
        date_from=date_from,
        date_to=date_to,
        only_hashed=only_hashed,
        only_linked_to_case=only_linked_to_case,
        accessible_mailbox_ids=accessible_mailbox_ids,
        limit=limit,
        offset=offset,
    )
    return [_to_attachment_list_item(record) for record in records]


async def list_mail_folders_tree(
    pool: asyncpg.Pool, *, accessible_mailbox_ids: list[int] | None
) -> list[MailFolderNode]:
    records = await messages_repository.list_mail_folders(pool, accessible_mailbox_ids=accessible_mailbox_ids)
    nodes: dict[str, MailFolderNode] = {
        record["folder_id"]: MailFolderNode(
            folder_id=record["folder_id"],
            parent_folder_id=record["parent_folder_id"],
            display_name=record["display_name"],
            folder_path=record["folder_path"],
            child_folder_count=record["child_folder_count"],
            total_item_count=record["total_item_count"],
            last_sync_at=record["last_sync_at"],
            children=[],
        )
        for record in records
    }
    roots: list[MailFolderNode] = []
    for node in nodes.values():
        parent_id = node.parent_folder_id
        if parent_id is not None and parent_id in nodes:
            nodes[parent_id].children.append(node)
        else:
            roots.append(node)
    return roots
