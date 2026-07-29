import base64
import hashlib
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import quote

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi.responses import Response

from app.db import get_pool
from app.repositories import cases_repository
from app.repositories.messages_repository import InvalidAttachmentPatternError
from app.schemas.messages import (
    AttachmentListItem,
    ConversationRead,
    MailFolderNode,
    MessageDetail,
    MessageListItem,
    RetraceAttachmentsResponse,
)
from app.services import messages_service, n8n_client

router = APIRouter(prefix="/api", tags=["messages"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

DeleteMessagesScope = Literal["all", "date_range", "folder", "unlinked"]


@router.get("/messages", response_model=list[MessageListItem])
async def list_messages(
    pool: PoolDep,
    response: Response,
    folder_id: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    from_address: str | None = Query(default=None),
    subject_contains: str | None = Query(default=None),
    text_search: str | None = Query(default=None),
    text_contains: str | None = Query(default=None),
    conversation_id: str | None = Query(default=None),
    is_sent: bool | None = Query(default=None),
    has_attachments: bool | None = Query(default=None),
    attachment_pattern: str | None = Query(default=None),
    mailbox_account_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[MessageListItem]:
    filters = dict(
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
    )
    try:
        total = await messages_service.count_messages(pool, **filters)
        response.headers["X-Total-Count"] = str(total)
        return await messages_service.list_messages(pool, **filters, limit=limit, offset=offset)
    except InvalidAttachmentPatternError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"El patrón de adjuntos no es una expresión regular válida: {exc}",
        ) from exc


@router.delete("/messages", status_code=http_status.HTTP_200_OK)
async def delete_messages(
    pool: PoolDep,
    scope: DeleteMessagesScope = Query(...),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    folder_id: str | None = Query(default=None),
) -> dict[str, int]:
    try:
        deleted = await messages_service.delete_messages(
            pool, scope=scope, date_from=date_from, date_to=date_to, folder_id=folder_id
        )
    except messages_service.InvalidDeleteScopeError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"deleted": deleted}


@router.get("/messages/{message_id}", response_model=MessageDetail)
async def get_message(message_id: str, pool: PoolDep) -> MessageDetail:
    message = await messages_service.get_message(pool, message_id)
    if message is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Mensaje no encontrado")
    return message


@router.get("/messages/{message_id}/attachments/{attachment_id}/download")
async def download_attachment(message_id: str, attachment_id: str, pool: PoolDep) -> Response:
    try:
        data = await n8n_client.download_attachment(message_id, attachment_id)
    except n8n_client.AttachmentDownloadError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    try:
        content = base64.b64decode(data["content_base64"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY, detail="Contenido de adjunto invalido."
        ) from exc

    # Se calcula y guarda el hash real recien aca (primera vez que se trae el
    # contenido de verdad) -- la indexacion masiva solo trae metadatos.
    sha256 = hashlib.sha256(content).hexdigest()
    await messages_service.set_attachment_hash(pool, message_id, attachment_id, sha256)

    file_name = data.get("file_name") or attachment_id
    content_type = data.get("content_type") or "application/octet-stream"
    # Content-Disposition solo acepta Latin-1 en "filename=" -- los nombres reales de
    # adjuntos suelen tener tildes/guiones largos, asi que se manda ademas la variante
    # UTF-8 percent-encoded (RFC 6266), que los navegadores modernos prefieren.
    ascii_fallback = file_name.encode("ascii", "replace").decode("ascii")
    encoded_name = quote(file_name)
    disposition = f'inline; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded_name}'
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": disposition},
    )


@router.post("/messages/{message_id}/retrace-attachments", response_model=RetraceAttachmentsResponse)
async def retrace_attachments(message_id: str, pool: PoolDep) -> RetraceAttachmentsResponse:
    message = await messages_service.get_message(pool, message_id)
    if message is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Mensaje no encontrado")
    try:
        traced_count = await n8n_client.retrace_message_attachments(message_id)
    except n8n_client.AttachmentRetraceError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if traced_count > 0:
        # Si el mensaje ya estaba vinculado a algun expediente antes de que
        # existieran estos adjuntos, la linea de tiempo nunca se enteraba --
        # se completa aca (idempotente, no duplica si se repite el retrace).
        affected_case_ids = await cases_repository.backfill_attachment_timeline_events(pool, message_id)
        for case_id in affected_case_ids:
            case_core = await cases_repository.get_case_core(pool, case_id)
            if case_core is not None and case_core["status"] == "open":
                await cases_repository.update_case(pool, case_id, fields={"ai_stale": True})
    return RetraceAttachmentsResponse(traced_count=traced_count)


@router.get("/conversations/{conversation_id}", response_model=ConversationRead)
async def get_conversation(conversation_id: str, pool: PoolDep) -> ConversationRead:
    conversation = await messages_service.get_conversation(pool, conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Conversacion no encontrada"
        )
    return conversation


@router.get("/attachments", response_model=list[AttachmentListItem])
async def list_attachments(
    pool: PoolDep,
    file_name_contains: str | None = Query(default=None),
    extension: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    only_hashed: bool | None = Query(default=None),
    only_linked_to_case: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AttachmentListItem]:
    return await messages_service.list_all_attachments(
        pool,
        file_name_contains=file_name_contains,
        extension=extension,
        date_from=date_from,
        date_to=date_to,
        only_hashed=only_hashed,
        only_linked_to_case=only_linked_to_case,
        limit=limit,
        offset=offset,
    )


@router.get("/mail-folders", response_model=list[MailFolderNode])
async def list_mail_folders(pool: PoolDep) -> list[MailFolderNode]:
    return await messages_service.list_mail_folders_tree(pool)
