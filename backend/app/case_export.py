import base64
import hashlib
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel
from weasyprint import HTML

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.repositories import cases_repository, users_repository
from app.schemas.cases import CaseDetail, CaseSendEmailResponse, TimelineEventRead
from app.services import cases_service, email_templates, n8n_client
from app.services.markdown_render import html_to_plain_text, markdown_to_safe_html

router = APIRouter(prefix="/api/cases", tags=["cases"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

_DOCUMENT_VERSION = "1.0"
_MIN_DT = datetime.min.replace(tzinfo=timezone.utc)
_CORREO_SUFFIX_RE = re.compile(r"\s*\(correo:.*\)$")
_FILENAME_UNSAFE_RE = re.compile(r'[\\/:*?"<>|]+')

# Titulos de correo pegados desde Word/Outlook suelen traer tipografia
# "inteligente" (guion largo, comillas curvas) que es perfectamente valida
# como nombre de archivo pero rompe el header HTTP Content-Disposition --
# Starlette lo codifica como latin-1 y esos caracteres no existen ahi
# (UnicodeEncodeError, tumbaba la descarga entera del PDF). Se normalizan a
# su equivalente ASCII antes de sanitizar.
_SMART_PUNCTUATION = {
    "–": "-", "—": "-",  # en dash, em dash
    "‘": "'", "’": "'",  # comillas simples curvas
    "“": '"', "”": '"',  # comillas dobles curvas
}


def _safe_filename(title: str) -> str:
    """Nombre de archivo a partir del titulo del expediente (ej.
    GFCH-260702620) en vez del case_id interno -- el id numerico no le dice
    nada al usuario que recibe el PDF."""
    normalized = title.strip()
    for smart, plain in _SMART_PUNCTUATION.items():
        normalized = normalized.replace(smart, plain)
    cleaned = _FILENAME_UNSAFE_RE.sub("_", normalized)
    # Red de seguridad: cualquier otro caracter fuera de latin-1 (emojis,
    # simbolos raros) se reemplaza en vez de tumbar la respuesta -- mejor un
    # "?" en el nombre del archivo que un 500 sin PDF.
    cleaned = cleaned.encode("latin-1", errors="replace").decode("latin-1")
    return cleaned or "expediente"

_MESES = {
    1: "ene", 2: "feb", 3: "mar", 4: "abr", 5: "may", 6: "jun",
    7: "jul", 8: "ago", 9: "sep", 10: "oct", 11: "nov", 12: "dic",
}

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

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_jinja_env = Environment(
    loader=FileSystemLoader(_TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "jinja"]),
)


def _fmt_day(value: datetime | date | None) -> str:
    if value is None:
        return "—"
    return f"{value.day} {_MESES[value.month]} {value.year}"


def _fmt_time(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%H:%M")


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%d-%m-%Y %H:%M")


def _truncate_words(text: str, max_words: int = 30) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


def _group_email_events(
    timeline: list[TimelineEventRead],
) -> list[tuple[TimelineEventRead, list[TimelineEventRead]]]:
    """Agrupa los adjuntos (document_shared) bajo el correo que los trajo.

    Solo los correos (email_sent) generan un evento de linea de tiempo aqui --
    las notas del auditor se toman de detail.notes (texto completo) y la
    fusion de expedientes de los eventos 'case_merged', ambos combinados por
    separado en build_case_pdf. El resto de action_type (ai_case_summary,
    auditor_note) ya se muestra en otras secciones del documento y se ignora
    aqui para no duplicar informacion.
    """
    children_by_message: dict[str, list[TimelineEventRead]] = {}
    for event in timeline:
        if event.action_type == "document_shared" and event.source_message_id:
            children_by_message.setdefault(event.source_message_id, []).append(event)
    groups = []
    for event in timeline:
        if event.action_type != "email_sent":
            continue
        children = children_by_message.get(event.source_message_id, []) if event.source_message_id else []
        groups.append((event, children))
    return groups


def _build_timeline_items(detail: CaseDetail) -> list[dict]:
    items: list[tuple[datetime, dict]] = []

    for event, children in _group_email_events(detail.timeline):
        confidence_pct = round(event.confidence * 100) if event.confidence is not None else None
        badge_class = "observed" if (event.confidence or 0) >= cases_service.CONFIDENCE_CR_KEYWORD else "manual"
        child_labels = [_CORREO_SUFFIX_RE.sub("", child.description or "") for child in children]
        items.append(
            (
                event.occurred_at or _MIN_DT,
                {
                    "kind": "email",
                    "time": _fmt_dt(event.occurred_at),
                    "title": event.description or event.action_type,
                    "actor": event.actor,
                    "detail": "Comunicación registrada en el expediente.",
                    "confidence_pct": confidence_pct,
                    "badge_class": badge_class,
                    "children": child_labels,
                },
            )
        )

    for event in detail.timeline:
        if event.action_type != "case_merged":
            continue
        items.append(
            (
                event.occurred_at or _MIN_DT,
                {
                    "kind": "merge",
                    "time": _fmt_dt(event.occurred_at),
                    "detail": event.description or "Fusión de expedientes.",
                },
            )
        )

    for note in detail.notes:
        # Solo un adelanto acotado aca -- el texto completo de la nota ya se
        # muestra entero en "Observacion del auditor" (pagina de registro
        # documental). Mostrarlo completo tambien aca es la misma
        # informacion duplicada dos veces en el mismo PDF.
        items.append(
            (
                note.created_at or _MIN_DT,
                {
                    "kind": "note",
                    "time": _fmt_dt(note.created_at),
                    "detail": _truncate_words(html_to_plain_text(note.body)),
                },
            )
        )

    items.sort(key=lambda pair: pair[0])
    return [payload for _dt, payload in items]


def _build_context(
    detail: CaseDetail,
    evidence_records: list[asyncpg.Record],
    *,
    owner_display: str | None,
) -> dict:
    now = datetime.now()
    case_code = detail.title
    messages = detail.messages

    direct_count = sum(1 for m in messages if m.confidence >= cases_service.CONFIDENCE_CR_KEYWORD)
    inferred_count = len(messages) - direct_count

    senders = {m.from_address.strip().lower() for m in messages if m.from_address}

    if detail.first_message_at and detail.last_message_at:
        delta = detail.last_message_at - detail.first_message_at
        thread_duration_label = f"{delta.days} d {delta.seconds // 3600:02d} h"
        period_label = f"{_fmt_day(detail.first_message_at)} – {_fmt_day(detail.last_message_at)}"
    else:
        thread_duration_label = "—"
        period_label = "Sin mensajes registrados"

    ai_result = detail.latest_ai_run.result if detail.latest_ai_run else None
    summary_text = detail.ai_summary_override or (ai_result.summary if ai_result else None)
    summary_paragraphs = [line.strip() for line in summary_text.split("\n") if line.strip()] if summary_text else []

    message_rows = []
    for m in sorted(messages, key=lambda m: m.sent_datetime or _MIN_DT):
        confidence_pct = round(m.confidence * 100)
        message_rows.append(
            {
                "date": _fmt_day(m.sent_datetime) if m.sent_datetime else "—",
                "time": _fmt_time(m.sent_datetime) if m.sent_datetime else "",
                "subject": m.subject or "(sin asunto)",
                "sender": m.from_address or "—",
                "confidence_pct": confidence_pct,
                "is_direct": m.confidence >= cases_service.CONFIDENCE_CR_KEYWORD,
            }
        )

    latest_note = None
    if detail.notes:
        newest = max(detail.notes, key=lambda n: n.created_at)
        latest_note = {"time": _fmt_dt(newest.created_at), "body": newest.body}

    evidence_items = []
    for idx, ev in enumerate(evidence_records, start=1):
        author = ev["creator_display_name"] or ev["creator_email_address"] or "No registrado"
        file_stem = Path(ev["file_name"]).stem or ev["file_name"]
        evidence_items.append(
            {
                "code": f"EV-{idx:03d}",
                "title": file_stem,
                "incorporated_at": _fmt_dt(ev["created_at"]),
                "author": author,
                "content_type": ev["content_type"],
                "content_base64": base64.b64encode(ev["content"]).decode("ascii"),
                "glosa": ev["glosa"],
            }
        )

    return {
        "case_code": case_code,
        "external_code": detail.external_code,
        "status_badge_class": "open" if detail.status == "open" else "closed",
        "status_label": "Abierto" if detail.status == "open" else "Cerrado",
        "period_label": period_label,
        "cutoff_label": f"{_fmt_day(now)} · {_fmt_time(now)}",
        "summary_paragraphs": summary_paragraphs,
        "owner_display": owner_display,
        "message_count": len(messages),
        "participant_count": len(senders),
        "outcome_label": _OUTCOME_LABELS.get(detail.outcome, "Sin conclusión definida"),
        "pending_action_html": markdown_to_safe_html(detail.pending_action) if detail.pending_action else None,
        "next_review_label": _fmt_day(detail.next_review_at) if detail.next_review_at else "-",
        "document_version": _DOCUMENT_VERSION,
        "thread_duration_label": thread_duration_label,
        "direct_count": direct_count,
        "inferred_count": inferred_count,
        "timeline_items": _build_timeline_items(detail),
        "confidence_direct_pct": round(cases_service.CONFIDENCE_CONVERSATION * 100),
        "confidence_keyword_pct": round(cases_service.CONFIDENCE_CR_KEYWORD * 100),
        "confidence_heuristic_pct": round(cases_service.CONFIDENCE_HEURISTIC * 100),
        "message_rows": message_rows,
        "latest_note": latest_note,
        "evidence_items": evidence_items,
    }


def build_case_pdf(
    detail: CaseDetail,
    evidence_records: list[asyncpg.Record],
    *,
    owner_display: str | None = None,
) -> bytes:
    context = _build_context(detail, evidence_records, owner_display=owner_display)
    template = _jinja_env.get_template("case_export.html.jinja")
    html_string = template.render(**context)
    return HTML(string=html_string, base_url=str(_TEMPLATES_DIR)).write_pdf()


async def _resolve_owner_display(pool: asyncpg.Pool, owner_user_id: int | None) -> str | None:
    if owner_user_id is None:
        return None
    record = await users_repository.get_user_by_id(pool, owner_user_id)
    if record is None:
        return None
    return record["display_name"] or record["email_address"]


@router.get("/{case_id}/export.pdf")
async def export_case_pdf(case_id: int, pool: PoolDep, user: CurrentUserDep) -> Response:
    detail = await cases_service.get_case_detail(pool, case_id, user=user)
    if detail is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    evidence_records = await cases_repository.list_case_evidence_with_content(pool, case_id)
    owner_display = await _resolve_owner_display(pool, detail.owner_user_id)
    pdf_bytes = build_case_pdf(detail, evidence_records, owner_display=owner_display)
    content_hash = hashlib.sha256(pdf_bytes).hexdigest()
    await cases_repository.insert_audit_entry(
        pool,
        case_id=case_id,
        user_id=user.user_id,
        description=f"Exportó el expediente a PDF (SHA-256: {content_hash})",
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="expediente_{_safe_filename(detail.title)}.pdf"',
            "X-Content-SHA256": content_hash,
        },
    )


def _split_addresses(raw: str) -> list[str]:
    return [addr.strip() for addr in re.split(r"[;,]", raw) if addr.strip()]


class MarkdownPreviewRequest(BaseModel):
    text: str


class MarkdownPreviewResponse(BaseModel):
    html: str


@router.post("/render-markdown", response_model=MarkdownPreviewResponse)
async def render_markdown_preview(payload: MarkdownPreviewRequest, _user: CurrentUserDep) -> MarkdownPreviewResponse:
    """El cuerpo del correo se edita como Markdown (mas simple de leer/editar
    que HTML crudo) -- este endpoint deja que el frontend previsualice
    exactamente el HTML que se va a enviar, sin duplicar el conversor en
    Javascript."""
    return MarkdownPreviewResponse(html=markdown_to_safe_html(payload.text))


@router.post("/{case_id}/send-email", response_model=CaseSendEmailResponse)
async def send_case_email(
    case_id: int,
    pool: PoolDep,
    user: CurrentUserDep,
    to: Annotated[str, Form(min_length=1)],
    subject: Annotated[str, Form(min_length=1)],
    body: Annotated[str, Form(min_length=1)],
    mailbox_account_id: Annotated[int, Form()],
    cc: Annotated[str, Form()] = "",
    attach_case_pdf: Annotated[bool, Form()] = True,
    attachments: Annotated[list[UploadFile], File()] = [],  # noqa: B006 -- FastAPI construye una lista nueva por request
) -> CaseSendEmailResponse:
    """Unico endpoint del proyecto que escribe hacia Graph (envia un correo
    real) -- todo lo demas es solo lectura. Adjunta automaticamente el PDF
    del expediente si attach_case_pdf, mas cualquier adjunto adicional que
    haya subido el auditor."""
    detail = await cases_service.get_case_detail(pool, case_id, user=user)
    if detail is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")

    to_list = _split_addresses(to)
    cc_list = _split_addresses(cc)
    if not to_list:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST, detail="Debe indicar al menos un destinatario en \"Para\"."
        )

    email_attachments: list[dict[str, str]] = []
    if attach_case_pdf:
        evidence_records = await cases_repository.list_case_evidence_with_content(pool, case_id)
        owner_display = await _resolve_owner_display(pool, detail.owner_user_id)
        pdf_bytes = build_case_pdf(detail, evidence_records, owner_display=owner_display)
        email_attachments.append(
            {
                "filename": f"expediente_{_safe_filename(detail.title)}.pdf",
                "content_type": "application/pdf",
                "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
            }
        )
    for upload in attachments:
        content = await upload.read()
        if not content:
            continue
        email_attachments.append(
            {
                "filename": upload.filename or "adjunto",
                "content_type": upload.content_type or "application/octet-stream",
                "content_base64": base64.b64encode(content).decode("ascii"),
            }
        )

    email_html = email_templates.render_case_message_email(
        subject=subject,
        case_title=detail.title,
        external_code=detail.external_code,
        case_status=detail.status,
        sent_by=user.display_name or user.email_address,
        body_html=markdown_to_safe_html(body),
    )
    try:
        await n8n_client.send_case_email(
            mailbox_account_id=mailbox_account_id,
            to=to_list,
            cc=cc_list,
            subject=subject,
            body=email_html,
            attachments=email_attachments,
        )
    except n8n_client.SendEmailError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    # Unico rastro del envio -- antes no quedaba nada (ni auditoria, ni linea
    # de tiempo, ni el contenido) una vez que el correo salia. Guarda una
    # copia completa (destinatarios/asunto/cuerpo) para poder recuperarla
    # despues, ademas de las marcas cortas de auditoria/linea de tiempo.
    attachment_names = [a["filename"] for a in email_attachments]
    await cases_repository.insert_case_sent_email(
        pool,
        case_id=case_id,
        sent_by_user_id=user.user_id,
        mailbox_account_id=mailbox_account_id,
        to_addresses=to_list,
        cc_addresses=cc_list,
        subject=subject,
        body_html=markdown_to_safe_html(body),
        attached_case_pdf=attach_case_pdf,
        attachment_names=attachment_names,
    )
    await cases_repository.insert_audit_entry(
        pool, case_id=case_id, user_id=user.user_id, description=f'Envió un correo ("{subject}") a {", ".join(to_list)}'
    )
    await cases_repository.insert_timeline_event(
        pool,
        case_id=case_id,
        occurred_at=None,
        actor=user.display_name or user.email_address,
        action_type="report_email_sent",
        description=f'Envió el correo "{subject}" a {", ".join(to_list)}',
        source_message_id=None,
        source_attachment_id=None,
        determination_type="validacion_manual",
        confidence=None,
    )

    return CaseSendEmailResponse(sent=True)
