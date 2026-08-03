"""Plantillas HTML (Jinja2) para los correos de notificacion que ya se
mandaban en texto plano -- compartir expediente, compartir buzon, cuenta
creada. Mismo motor y patron que app/case_export.py usa para el PDF, aca
aparte porque son documentos HTML de email, no de expediente.

Los templates de origen (mailing_expediente_compartido.html,
mailing_acceso_buzon.html, mailing_cuenta_creada.html) traian secciones que
este proyecto no tiene (link de activacion de cuenta, id de evento de
auditoria, un email de soporte formal, deep-link a un expediente puntual --
no hay router en el frontend) -- se sacaron al adaptarlos, no se dejaron como
placeholders sueltos.
"""

from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import get_settings

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "emails"
_env = Environment(
    loader=FileSystemLoader(_TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "jinja"]),
)

_ACCESS_LEVEL_LABELS = {"read": "Solo lectura", "edit": "Lectura y edición"}
_PERMISSION_SUMMARIES = {
    "read": "ver el expediente completo (correos, notas, línea de tiempo)",
    "edit": "ver y editar el expediente (agregar notas, cambiar la conclusión, marcar seguimiento, etc.)",
}
_ROLE_LABELS = {"admin": "Administrador", "user": "Usuario"}


def _fmt_datetime(value: datetime) -> str:
    return value.strftime("%d-%m-%Y %H:%M")


def render_case_shared_email(
    *,
    shared_by: str,
    case_title: str,
    external_code: str | None,
    case_status: str,
    permission: str,
    shared_at: datetime,
) -> str:
    template = _env.get_template("case_shared.html.jinja")
    return template.render(
        shared_by=shared_by,
        case_title=case_title,
        external_code=external_code,
        case_status="Abierto" if case_status == "open" else "Cerrado",
        access_level=_ACCESS_LEVEL_LABELS.get(permission, permission),
        permission_summary=_PERMISSION_SUMMARIES.get(permission, "acceder al expediente"),
        shared_at=_fmt_datetime(shared_at),
        app_url=get_settings().frontend_url,
        current_year=datetime.now().year,
    )


def render_mailbox_shared_email(
    *,
    granted_by: str,
    mailbox_name: str,
    mailbox_address: str | None,
    granted_at: datetime,
) -> str:
    template = _env.get_template("mailbox_shared.html.jinja")
    return template.render(
        granted_by=granted_by,
        mailbox_name=mailbox_name,
        mailbox_address=mailbox_address or "sin correo registrado",
        granted_at=_fmt_datetime(granted_at),
        app_url=get_settings().frontend_url,
        current_year=datetime.now().year,
    )


def render_case_message_email(
    *,
    subject: str,
    case_title: str,
    external_code: str | None,
    case_status: str,
    sent_by: str,
    body_html: str,
) -> str:
    template = _env.get_template("case_message.html.jinja")
    return template.render(
        subject=subject,
        case_title=case_title,
        external_code=external_code,
        case_status="Abierto" if case_status == "open" else "Cerrado",
        sent_by=sent_by,
        body_html=body_html,
        current_year=datetime.now().year,
    )


def render_system_notification_email(
    *,
    eyebrow: str,
    title: str,
    message: str,
    details: list[tuple[str, str]] | None = None,
    show_cta: bool = True,
) -> str:
    """Plantilla generica para avisos de estado del sistema (sincronizacion de
    buzones, analisis de IA terminado, correo de prueba) -- a diferencia de
    case_shared/mailbox_shared/account_created (datos fijos, un solo caso de
    uso cada una), esta acepta un mensaje y una lista opcional de pares
    label/valor para no tener que crear un .jinja nuevo por cada aviso de
    este estilo."""
    template = _env.get_template("system_notification.html.jinja")
    return template.render(
        eyebrow=eyebrow,
        title=title,
        message=message,
        details=details or [],
        show_cta=show_cta,
        app_url=get_settings().frontend_url,
        current_year=datetime.now().year,
    )


def render_account_created_email(
    *,
    recipient_name: str,
    recipient_email: str,
    role: str,
    created_by: str,
    auth_method: str,
    username: str | None,
) -> str:
    template = _env.get_template("account_created.html.jinja")
    return template.render(
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        role_name=_ROLE_LABELS.get(role, role),
        created_by=created_by,
        auth_method=auth_method,
        username=username,
        app_url=get_settings().frontend_url,
        current_year=datetime.now().year,
    )
