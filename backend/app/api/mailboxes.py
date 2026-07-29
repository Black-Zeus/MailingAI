from fastapi import APIRouter, HTTPException, Query
from fastapi import status as http_status

from app.schemas.mailboxes import (
    MailboxAccountRead,
    MailboxAccountUpdate,
    MailboxConnectUrlResponse,
    MailboxTestResponse,
)
from app.services import identity_broker_client
from app.services.identity_broker_client import IdentityBrokerError

router = APIRouter(prefix="/api/mailboxes", tags=["mailboxes"])


@router.get("", response_model=list[MailboxAccountRead])
async def list_mailboxes() -> list[MailboxAccountRead]:
    try:
        records = await identity_broker_client.list_mailboxes()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return [MailboxAccountRead(**r) for r in records]


@router.get("/connect-url", response_model=MailboxConnectUrlResponse)
async def get_connect_url(label: str = Query(min_length=1)) -> MailboxConnectUrlResponse:
    return MailboxConnectUrlResponse(url=identity_broker_client.build_connect_url(label))


@router.post("/{mailbox_account_id}/test", response_model=MailboxTestResponse)
async def test_mailbox(mailbox_account_id: int) -> MailboxTestResponse:
    try:
        result = await identity_broker_client.test_mailbox(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxTestResponse(**result)


@router.patch("/{mailbox_account_id}", response_model=MailboxAccountRead)
async def update_mailbox(mailbox_account_id: int, payload: MailboxAccountUpdate) -> MailboxAccountRead:
    try:
        record = await identity_broker_client.update_mailbox(
            mailbox_account_id, label=payload.label, enabled=payload.enabled
        )
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**record)


@router.delete("/{mailbox_account_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_mailbox(mailbox_account_id: int) -> None:
    try:
        deleted = await identity_broker_client.delete_mailbox(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
