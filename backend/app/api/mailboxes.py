from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import AdminUserDep, CurrentUserDep
from app.db import get_pool
from app.repositories import access_repository, notifications_repository
from app.schemas.mailboxes import (
    MailboxAccessRevokeResponse,
    MailboxAccountRead,
    MailboxAccountUpdate,
    MailboxConnectUrlResponse,
    MailboxSendTestResponse,
    MailboxShareCreate,
    MailboxShareRead,
    MailboxTestResponse,
    NotificationSenderUpdate,
)
from app.services import cases_service, identity_broker_client, n8n_client, notification_email_service
from app.services.identity_broker_client import IdentityBrokerError

router = APIRouter(prefix="/api/mailboxes", tags=["mailboxes"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=detail)


async def _get_accessible_mailbox_or_404(
    pool: asyncpg.Pool, mailbox_account_id: int, user: CurrentUserDep
) -> dict:
    try:
        records = await identity_broker_client.list_mailboxes()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    record = next((r for r in records if r["mailbox_account_id"] == mailbox_account_id), None)
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    if user.is_admin or record.get("owner_user_id") == user.user_id:
        return record
    accessible_ids = await access_repository.get_accessible_mailbox_ids(pool, user.user_id)
    if mailbox_account_id not in accessible_ids:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return record


@router.get("", response_model=list[MailboxAccountRead])
async def list_mailboxes(pool: PoolDep, user: CurrentUserDep) -> list[MailboxAccountRead]:
    try:
        records = await identity_broker_client.list_mailboxes()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if user.is_admin:
        return [MailboxAccountRead(**r) for r in records]
    accessible_ids = set(await access_repository.get_accessible_mailbox_ids(pool, user.user_id))
    return [MailboxAccountRead(**r) for r in records if r["mailbox_account_id"] in accessible_ids]


@router.get("/connect-url", response_model=MailboxConnectUrlResponse)
async def get_connect_url(label: str = Query(min_length=1)) -> MailboxConnectUrlResponse:
    return MailboxConnectUrlResponse(url=identity_broker_client.build_connect_url(label))


@router.get("/notification-sender", response_model=MailboxAccountRead | None)
async def get_notification_sender(_admin: AdminUserDep) -> MailboxAccountRead | None:
    try:
        record = await identity_broker_client.get_notification_sender()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return MailboxAccountRead(**record) if record else None


@router.patch("/notification-sender", response_model=MailboxAccountRead | None)
async def set_notification_sender(payload: NotificationSenderUpdate, _admin: AdminUserDep) -> MailboxAccountRead | None:
    try:
        record = await identity_broker_client.set_notification_sender(payload.mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MailboxAccountRead(**record) if record else None


@router.post("/notification-sender/test", response_model=MailboxSendTestResponse)
async def test_notification_sender(admin: AdminUserDep) -> MailboxSendTestResponse:
    """Manda un correo de prueba al propio admin usando el buzon configurado
    como remitente de notificaciones -- para confirmar que quedo bien
    configurado sin tener que esperar a que alguien comparta algo de verdad."""
    try:
        sender = await identity_broker_client.get_notification_sender()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if sender is None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail="No hay ningún buzón configurado como remitente de notificaciones."
        )
    try:
        await n8n_client.send_case_email(
            mailbox_account_id=sender["mailbox_account_id"],
            to=[admin.email_address],
            cc=[],
            subject="MailingAI — correo de prueba",
            body=(
                f"Este es un correo de prueba del buzón de notificaciones \"{sender['label']}\" "
                f"({sender['email_address'] or 'sin correo'}). Si lo recibiste, la configuración funciona."
            ),
            attachments=[],
        )
    except n8n_client.SendEmailError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return MailboxSendTestResponse(sent=True)


@router.post("/{mailbox_account_id}/claim", response_model=MailboxAccountRead)
async def claim_mailbox(mailbox_account_id: int, user: CurrentUserDep) -> MailboxAccountRead:
    """Se llama tras completar el consentimiento OAuth2 (ver el listener de
    postMessage en SettingsView.tsx) -- quien lo hace queda como dueño. Si
    dos personas completan el flujo casi al mismo tiempo para la misma
    cuenta, la segunda recibe 409."""
    try:
        record = await identity_broker_client.claim_mailbox_owner(mailbox_account_id, owner_user_id=user.user_id)
    except identity_broker_client.MailboxAlreadyClaimedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail="Esta cuenta ya fue reclamada por otro usuario."
        ) from exc
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**record)


@router.post("/{mailbox_account_id}/test", response_model=MailboxTestResponse)
async def test_mailbox(mailbox_account_id: int, pool: PoolDep, user: CurrentUserDep) -> MailboxTestResponse:
    await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    try:
        result = await identity_broker_client.test_mailbox(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxTestResponse(**result)


@router.patch("/{mailbox_account_id}", response_model=MailboxAccountRead)
async def update_mailbox(
    mailbox_account_id: int, payload: MailboxAccountUpdate, pool: PoolDep, user: CurrentUserDep
) -> MailboxAccountRead:
    record = await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    if not user.is_admin and record.get("owner_user_id") != user.user_id:
        raise _forbidden("Solo el dueño del buzón (o un admin) puede editarlo.")
    try:
        updated = await identity_broker_client.update_mailbox(
            mailbox_account_id, label=payload.label, enabled=payload.enabled
        )
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    return MailboxAccountRead(**updated)


@router.delete("/{mailbox_account_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_mailbox(mailbox_account_id: int, pool: PoolDep, user: CurrentUserDep) -> None:
    record = await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    if not user.is_admin and record.get("owner_user_id") != user.user_id:
        raise _forbidden("Solo el dueño del buzón (o un admin) puede eliminarlo.")
    try:
        deleted = await identity_broker_client.delete_mailbox(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")


@router.get("/{mailbox_account_id}/shares", response_model=list[MailboxShareRead])
async def list_mailbox_shares(mailbox_account_id: int, pool: PoolDep, user: CurrentUserDep) -> list[MailboxShareRead]:
    await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    try:
        records = await identity_broker_client.list_mailbox_shares(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return [MailboxShareRead(**r) for r in records]


@router.post("/{mailbox_account_id}/shares", response_model=MailboxShareRead)
async def share_mailbox(
    mailbox_account_id: int, payload: MailboxShareCreate, pool: PoolDep, user: CurrentUserDep
) -> MailboxShareRead:
    record = await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    if not user.is_admin and record.get("owner_user_id") != user.user_id:
        raise _forbidden("Solo el dueño del buzón (o un admin) puede compartirlo.")
    try:
        share = await identity_broker_client.share_mailbox(
            mailbox_account_id, user_id=payload.user_id, permission=payload.permission, shared_by_user_id=user.user_id
        )
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    sharer_name = user.display_name or user.email_address
    notification_message = f'{sharer_name} te dio acceso de lectura al buzón "{record["label"]}".'
    await notifications_repository.insert_notification(
        pool,
        user_id=payload.user_id,
        kind="mailbox_shared",
        message=notification_message,
        mailbox_account_id=mailbox_account_id,
        created_by_user_id=user.user_id,
    )
    await notification_email_service.try_send_email(
        to_email=share["email_address"],
        subject=f'MailingAI — te dieron acceso al buzón "{record["label"]}"',
        body=notification_message,
    )
    return MailboxShareRead(**share)


@router.delete("/{mailbox_account_id}/shares/{target_user_id}", response_model=MailboxAccessRevokeResponse)
async def revoke_mailbox_share(
    mailbox_account_id: int, target_user_id: int, pool: PoolDep, user: CurrentUserDep
) -> MailboxAccessRevokeResponse:
    record = await _get_accessible_mailbox_or_404(pool, mailbox_account_id, user)
    if not user.is_admin and record.get("owner_user_id") != user.user_id:
        raise _forbidden("Solo el dueño del buzón (o un admin) puede revocar el acceso.")
    try:
        revoked = await identity_broker_client.revoke_mailbox_share(mailbox_account_id, target_user_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not revoked:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Comparticion no encontrada")
    cascade = await cases_service.cascade_revoke_mailbox_access(
        pool, user_id=target_user_id, mailbox_account_id=mailbox_account_id
    )
    cases_affected = cascade["ownership_cleared"] + cascade["shares_removed"]
    return MailboxAccessRevokeResponse(revoked=True, cases_affected=cases_affected)


@router.delete("/{mailbox_account_id}/owner", response_model=MailboxAccessRevokeResponse)
async def clear_mailbox_owner(mailbox_account_id: int, pool: PoolDep, _admin: AdminUserDep) -> MailboxAccessRevokeResponse:
    """Libera el buzon (queda sin dueño) y le revoca en cascada el acceso a
    los expedientes relacionados a quien era el dueño -- solo un admin puede
    hacerlo (a diferencia de revocar una comparticion, que tambien puede
    hacerla el propio dueño del buzon)."""
    try:
        records = await identity_broker_client.list_mailboxes()
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    record = next((r for r in records if r["mailbox_account_id"] == mailbox_account_id), None)
    if record is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    previous_owner_id = record.get("owner_user_id")
    try:
        await identity_broker_client.clear_mailbox_owner(mailbox_account_id)
    except IdentityBrokerError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if previous_owner_id is None:
        return MailboxAccessRevokeResponse(revoked=True, cases_affected=0)
    cascade = await cases_service.cascade_revoke_mailbox_access(
        pool, user_id=previous_owner_id, mailbox_account_id=mailbox_account_id
    )
    cases_affected = cascade["ownership_cleared"] + cascade["shares_removed"]
    return MailboxAccessRevokeResponse(revoked=True, cases_affected=cases_affected)
