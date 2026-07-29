import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class JobTriggerError(Exception):
    pass


async def trigger_analysis_job(job_id: str, job_type: str, parameters: dict[str, Any]) -> None:
    """Dispara el webhook de n8n para un job recien creado, sin bloquear al llamador.

    Si n8n no responde, propaga JobTriggerError para que el llamador (ver
    jobs_service.trigger_job) marque el job como failed en vez de dejarlo
    en 'queued' para siempre.
    """
    settings = get_settings()
    headers = {settings.webhook_shared_secret_header: settings.webhook_shared_secret}
    payload = {"job_id": job_id, "job_type": job_type, "parameters": parameters}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                settings.n8n_webhook_internal_url, json=payload, headers=headers
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo disparar el workflow de n8n para el job %s", job_id)
        raise JobTriggerError(
            f"No se pudo contactar a n8n para iniciar el job: {exc}"
        ) from exc


class AttachmentDownloadError(Exception):
    pass


async def download_attachment(message_id: str, attachment_id: str) -> dict[str, Any]:
    """Llama al webhook sincrono de n8n (workflow 08) y espera el contenido real del adjunto.

    A diferencia de trigger_analysis_job, esta llamada SI espera la respuesta
    (el usuario esta esperando el archivo) y propaga el error al llamador en
    vez de solo loguearlo.
    """
    settings = get_settings()
    headers = {settings.webhook_shared_secret_header: settings.webhook_shared_secret}
    payload = {"message_id": message_id, "attachment_id": attachment_id}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                settings.n8n_webhook_download_url, json=payload, headers=headers
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo descargar el adjunto %s del mensaje %s", attachment_id, message_id)
        raise AttachmentDownloadError(
            "No se pudo obtener el adjunto desde Microsoft Graph. Verifica que n8n esté "
            "corriendo y que la credencial de Graph siga conectada."
        ) from exc

    data = response.json()
    if not data.get("content_base64"):
        raise AttachmentDownloadError("Graph no devolvió contenido para este adjunto.")
    return data


class AttachmentRetraceError(Exception):
    pass


async def retrace_message_attachments(message_id: str) -> int:
    """Llama al webhook sincrono de n8n (workflow 10) para re-listar desde Graph
    los adjuntos reales de un mensaje puntual y volver a indexarlos.

    Util cuando un mensaje quedo con `has_attachments=true` pero cero filas en
    mailing.message_attachments -- porque el job que lo trajo originalmente
    (fetch_sent_items/fetch_message_series/fetch_related_thread) nunca
    consulta adjuntos, solo lo hacen fetch_cr_attachments/search_attachments.
    Devuelve la cantidad de adjuntos reales encontrados y trazados.
    """
    settings = get_settings()
    headers = {settings.webhook_shared_secret_header: settings.webhook_shared_secret}
    payload = {"message_id": message_id}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                settings.n8n_webhook_retrace_url, json=payload, headers=headers
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo retrazar los adjuntos del mensaje %s", message_id)
        raise AttachmentRetraceError(
            "No se pudo consultar los adjuntos desde Microsoft Graph. Verifica que n8n esté "
            "corriendo y que la credencial de Graph siga conectada."
        ) from exc

    data = response.json()
    return int(data.get("traced_count") or 0)


class SendEmailError(Exception):
    pass


async def send_case_email(
    *,
    mailbox_account_id: int,
    to: list[str],
    cc: list[str],
    subject: str,
    body: str,
    attachments: list[dict[str, str]],
) -> None:
    """Llama al webhook sincrono de n8n (workflow 12) para enviar un correo
    real via Microsoft Graph (POST /me/sendMail), con copia guardada en
    Elementos Enviados del buzon que lo manda. Unica escritura real hacia
    Graph en todo el proyecto -- requiere que el buzon tenga el scope
    Mail.Send autorizado (ver identity-broker/app/config.py).
    """
    settings = get_settings()
    headers = {settings.webhook_shared_secret_header: settings.webhook_shared_secret}
    payload = {
        "mailbox_account_id": mailbox_account_id,
        "to": to,
        "cc": cc,
        "subject": subject,
        "body": body,
        "attachments": attachments,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                settings.n8n_webhook_send_email_url, json=payload, headers=headers
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("No se pudo enviar el correo del expediente")
        raise SendEmailError(
            "No se pudo enviar el correo vía Microsoft Graph. Verifica que n8n esté corriendo "
            "y que el buzón tenga el permiso Mail.Send autorizado (puede requerir reconectar la "
            "cuenta en Configuración → Buzones)."
        ) from exc
