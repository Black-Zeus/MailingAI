import logging

from app.services import identity_broker_client, n8n_client
from app.services.identity_broker_client import IdentityBrokerError

logger = logging.getLogger(__name__)


async def try_send_email(*, to_email: str, subject: str, body: str) -> None:
    """Best-effort: si un admin configuro un buzon como remitente de
    notificaciones (Configuración → Notificaciones), el aviso de "te
    compartieron X" tambien sale como correo real ademas de quedar in-app.
    Si no hay ninguno configurado, o el envio falla, no rompe el flujo que lo
    llamo -- compartir sigue funcionando igual, el aviso in-app ya se guardo
    aparte antes de llamar aca."""
    try:
        sender = await identity_broker_client.get_notification_sender()
    except IdentityBrokerError:
        logger.exception("No se pudo consultar el buzon remitente de notificaciones")
        return
    if sender is None:
        return
    try:
        await n8n_client.send_case_email(
            mailbox_account_id=sender["mailbox_account_id"],
            to=[to_email],
            cc=[],
            subject=subject,
            body=body,
            attachments=[],
        )
    except n8n_client.SendEmailError:
        logger.exception("No se pudo enviar el correo de notificacion a %s", to_email)
