import re

import asyncpg

from app.auth.dependencies import CurrentUser
from app.repositories import mail_templates_repository, users_repository
from app.schemas.cases import CaseDetail
from app.schemas.mail_templates import MailTemplateRead
from app.services import cases_service

_OUTCOME_LABELS = {
    "con_hallazgos": "Con hallazgos",
    "sin_hallazgos": "Sin hallazgos (nada que revisar)",
    "pendiente": "Pendiente de revisión",
    "en_proceso": "En proceso",
    "derivado": "Derivado a",
    "mas_antecedentes": "Se solicitan más antecedentes",
    "investigado_sin_compromiso": "Investigado — sin compromiso",
    "falso_positivo": "Falso positivo",
    "mitigado": "Mitigado / remediado",
    "sin_recepcion": "Sin recepción del correo",
}

_VARIABLE_RE = re.compile(r"\[([A-Z0-9_]+)\]")


class ReportRequiresClosedCaseError(Exception):
    """El expediente debe estar cerrado antes de poder generar su reporte."""


def _to_template(record: asyncpg.Record) -> MailTemplateRead:
    return MailTemplateRead(
        template_id=record["template_id"],
        name=record["name"],
        subject_template=record["subject_template"],
        body_template=record["body_template"],
        active=record["active"],
        created_by_user_id=record["created_by_user_id"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


async def create_template(
    pool: asyncpg.Pool, *, name: str, subject_template: str, body_template: str, user: CurrentUser
) -> MailTemplateRead:
    record = await mail_templates_repository.create_template(
        pool, name=name, subject_template=subject_template, body_template=body_template, created_by_user_id=user.user_id
    )
    return _to_template(record)


async def list_templates(pool: asyncpg.Pool, *, active_only: bool = False) -> list[MailTemplateRead]:
    records = await mail_templates_repository.list_templates(pool, active_only=active_only)
    return [_to_template(r) for r in records]


async def update_template(pool: asyncpg.Pool, template_id: int, *, fields: dict[str, object]) -> MailTemplateRead | None:
    record = await mail_templates_repository.update_template(pool, template_id, fields=fields)
    return _to_template(record) if record is not None else None


async def delete_template(pool: asyncpg.Pool, template_id: int) -> bool:
    return await mail_templates_repository.delete_template(pool, template_id)


def _fmt_date(value) -> str:
    return value.strftime("%d-%m-%Y") if value else ""


async def _build_auto_variables(pool: asyncpg.Pool, detail: CaseDetail) -> dict[str, str]:
    """Variables que se completan solas con datos reales del expediente --
    registro fijo, ver plan/documentacion del submodulo Mail Template.
    Cualquier otro [TOKEN] que aparezca en una plantilla y no este aca se
    trata como campo manual (ver render_report)."""
    owner_display = "(sin dueño asignado)"
    if detail.owner_user_id is not None:
        owner = await users_repository.get_user_by_id(pool, detail.owner_user_id)
        if owner is not None:
            owner_display = owner["display_name"] or owner["email_address"]

    evidence_text = (
        "\n".join(f"- {e.glosa}" for e in detail.evidence) if detail.evidence else "(sin evidencia adjunta)"
    )

    return {
        # Nunca ID_CASO (id interno correlativo de mailing.cases) -- un
        # expediente nunca debe identificarse hacia afuera por su id de base
        # de datos, solo por CODIGO (ticket/CR externo) o TITULO.
        "CODIGO": detail.external_code or "(sin código)",
        "TITULO": detail.title,
        "TIPO": detail.case_type,
        "CONCLUSION": _OUTCOME_LABELS.get(detail.outcome, detail.outcome) if detail.outcome else "(sin definir)",
        "FECHA_CREACION": _fmt_date(detail.created_at),
        # Aproximado: no existe una columna closed_at dedicada, se usa la
        # ultima modificacion del expediente -- si se lo edita (nota, adjunto)
        # despues de cerrarlo, esta fecha reflejaria esa edicion, no el cierre.
        "FECHA_CIERRE": _fmt_date(detail.updated_at),
        "CANTIDAD_CORREOS": str(detail.message_count),
        "DUENO": owner_display,
        "TIPO_DE_ALERTA": detail.alert_type or "(sin definir)",
        "EVIDENCIA": evidence_text,
    }


async def render_report(
    pool: asyncpg.Pool, case_id: int, template_id: int, *, manual_values: dict[str, str], user: CurrentUser
) -> tuple[str, str] | None:
    """Devuelve (subject, body) con todas las variables sustituidas, o None
    si el caso o la plantilla no existen (deja que el caller decida 404 vs
    403 -- get_case_detail ya distingue "no existe" de "sin acceso" del
    mismo modo que el resto de cases_service)."""
    detail = await cases_service.get_case_detail(pool, case_id, user=user)
    if detail is None:
        return None
    if detail.status != "closed":
        raise ReportRequiresClosedCaseError("El expediente debe estar cerrado para generar su reporte.")

    template_record = await mail_templates_repository.get_template(pool, template_id)
    if template_record is None:
        return None

    auto_vars = await _build_auto_variables(pool, detail)

    def substitute(text: str) -> str:
        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            if name in auto_vars:
                return auto_vars[name]
            return manual_values.get(name, "")

        return _VARIABLE_RE.sub(replace, text)

    subject = substitute(template_record["subject_template"])
    body = substitute(template_record["body_template"])
    return subject, body
