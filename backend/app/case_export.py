import base64
import io
import re
from datetime import datetime, timezone
from typing import Annotated
from xml.sax.saxutils import escape

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from fastapi.responses import Response
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.auth.dependencies import CurrentUserDep
from app.db import get_pool
from app.repositories import cases_repository
from app.schemas.cases import CaseDetail, CaseSendEmailResponse, TimelineEventRead
from app.services import cases_service, n8n_client

router = APIRouter(prefix="/api/cases", tags=["cases"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]

# Documento formal: todo el texto va en negro, sin colores de marca -- la
# jerarquia se marca con tamano/negrita (H1/H2/H3), no con color. El unico
# uso de color que queda es de fondo, muy claro, para el bloque de "Analisis
# de cierre" y las lineas divisorias finas -- nunca texto.
_LINE = colors.HexColor("#dde3ea")
_AI_BG = colors.HexColor("#f2f4ff")
_AI_BORDER = colors.HexColor("#d6ddfb")

_CORREO_SUFFIX_RE = re.compile(r"\s*\(correo:.*\)$")
# timestamptz de Postgres llega como datetime con tzinfo -- el "piso" de
# ordenamiento debe ser aware tambien, o comparar con un occurred_at nulo
# revienta con TypeError (naive vs aware).
_MIN_DT = datetime.min.replace(tzinfo=timezone.utc)


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%d-%m-%Y %H:%M")


def _esc(text: str | None) -> str:
    return escape(text or "")


def _truncate_to_width(text: str, font: str, size: float, max_width: float) -> str:
    if stringWidth(text, font, size) <= max_width:
        return text
    ellipsis = "…"
    while text and stringWidth(text + ellipsis, font, size) > max_width:
        text = text[:-1]
    return (text + ellipsis) if text else ellipsis


def _build_canvas_maker(header_text: str) -> type[pdfcanvas.Canvas]:
    margin = 20 * mm

    class _CaseCanvas(pdfcanvas.Canvas):
        def __init__(self, *args, **kwargs):
            pdfcanvas.Canvas.__init__(self, *args, **kwargs)
            self._saved_page_states: list[dict] = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total_pages = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self._draw_header_footer(total_pages)
                pdfcanvas.Canvas.showPage(self)
            pdfcanvas.Canvas.save(self)

        def _draw_header_footer(self, total_pages: int) -> None:
            width, height = letter
            max_width = width - 2 * margin
            # La pagina 1 ya trae el titulo grande al inicio del cuerpo -- una
            # cabecera repitiendolo ahi arriba es la tercera vez que se ve el
            # mismo dato. Solo se dibuja desde la pagina 2 en adelante.
            if self._pageNumber > 1:
                self.setFont("Helvetica-Bold", 9)
                self.setFillColor(colors.black)
                self.drawString(
                    margin,
                    height - 12 * mm,
                    _truncate_to_width(header_text, "Helvetica-Bold", 9, max_width),
                )
                self.setStrokeColor(colors.black)
                self.setLineWidth(0.6)
                self.line(margin, height - 14 * mm, width - margin, height - 14 * mm)
            self.setFont("Helvetica", 8)
            self.setFillColor(colors.black)
            self.drawRightString(
                width - margin, 12 * mm, f"Página {self._pageNumber} de {total_pages}"
            )

    return _CaseCanvas


def _build_evidence_image(content: bytes, max_width: float, max_height: float) -> RLImage | Paragraph:
    try:
        with PILImage.open(io.BytesIO(content)) as im:
            width_px, height_px = im.size
    except Exception:
        return Paragraph("(no se pudo previsualizar esta imagen)", ParagraphStyle("evidenceErr"))
    if not width_px or not height_px:
        return Paragraph("(no se pudo previsualizar esta imagen)", ParagraphStyle("evidenceErr"))
    scale = min(max_width / width_px, max_height / height_px)
    return RLImage(io.BytesIO(content), width=width_px * scale, height=height_px * scale)


def _group_timeline(
    timeline: list[TimelineEventRead],
) -> list[tuple[TimelineEventRead, list[TimelineEventRead]]]:
    """Agrupa los adjuntos (document_shared) bajo el correo que los trajo.

    Solo los correos (email_sent) quedan como eventos de la linea de tiempo del
    PDF -- las notas del auditor se intercalan aparte con su texto completo
    (ver build_case_pdf) en vez de la version acotada a una linea que vive en
    mailing.timeline_events, y el cierre por IA ya se muestra en el bloque
    "Analisis de cierre" al inicio del documento, asi que no se repite aqui.
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


def build_case_pdf(detail: CaseDetail, evidence_records: list[asyncpg.Record]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        title=detail.title,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "caseTitle",
        parent=styles["Title"],
        textColor=colors.black,
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
    )
    heading_style = ParagraphStyle(
        "caseHeading",
        parent=styles["Heading2"],
        textColor=colors.black,
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        spaceBefore=14,
        spaceAfter=4,
    )
    subheading_style = ParagraphStyle(
        "caseSubheading",
        parent=styles["Heading3"],
        textColor=colors.black,
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        spaceBefore=2,
        spaceAfter=2,
    )
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8.5, leading=13, textColor=colors.black)
    attach_style = ParagraphStyle("eventAttach", parent=small, leftIndent=10, fontSize=8)
    story = []

    story.append(Paragraph(f"Expediente caso: {_esc(detail.title)}", title_style))
    story.append(HRFlowable(width="100%", thickness=1.4, color=colors.black, spaceAfter=10))

    meta_rows = []
    meta_rows.append(["Estado", "Abierto" if detail.status == "open" else "Cerrado"])
    meta_rows.append(["Mensajes", str(detail.message_count)])
    meta_rows.append(
        ["Periodo", f"{_fmt_dt(detail.first_message_at)} → {_fmt_dt(detail.last_message_at)}"]
    )
    meta_rows.append(["Exportado", datetime.now().strftime("%d-%m-%Y %H:%M")])
    meta_table = Table(meta_rows, colWidths=[35 * mm, 130 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(meta_table)
    story.append(Spacer(1, 10))

    ai_result = detail.latest_ai_run.result if detail.latest_ai_run else None
    if ai_result is not None:
        # El resumen corregido a mano por el auditor pisa al texto crudo del
        # modelo tambien en el PDF -- un solo texto "vigente".
        summary_text = detail.ai_summary_override or ai_result.summary
        ai_body = [
            [
                Paragraph(
                    f"{_esc(summary_text)}<br/><br/>"
                    f"<b>Prioridad sugerida:</b> {_esc(ai_result.suggested_priority)} &middot; "
                    f"<b>Próxima acción:</b> {_esc(ai_result.suggested_next_action)}",
                    small,
                )
            ]
        ]
        ai_table = Table(ai_body, colWidths=[165 * mm])
        ai_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), _AI_BG),
                    ("BOX", (0, 0), (-1, -1), 0.6, _AI_BORDER),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(Paragraph("Análisis de cierre", heading_style))
        story.append(ai_table)

    note_style = ParagraphStyle("noteBody", parent=small, leftIndent=0, spaceBefore=2)

    email_groups = _group_timeline(detail.timeline)
    timeline_items: list[tuple[datetime, str, object]] = [
        (event.occurred_at or _MIN_DT, "email", (event, children)) for event, children in email_groups
    ]
    timeline_items += [(note.created_at or _MIN_DT, "note", note) for note in detail.notes]
    timeline_items.sort(key=lambda item: item[0])

    story.append(Paragraph("Línea de tiempo", heading_style))
    story.append(HRFlowable(width="100%", thickness=0.6, color=_LINE, spaceAfter=6))
    for _dt, kind, payload in timeline_items:
        if kind == "email":
            event, children = payload
            lines = (
                f"<b>Fecha:</b> {_fmt_dt(event.occurred_at)}<br/>"
                f"<b>Asunto:</b> {_esc(event.description or event.action_type)}<br/>"
                f"<b>De:</b> {_esc(event.actor) if event.actor else '—'}"
            )
            story.append(Paragraph(lines, small))
            for child in children:
                desc = _CORREO_SUFFIX_RE.sub("", child.description or "")
                story.append(Paragraph(f"<b>Adjunto:</b> {_esc(desc)}", attach_style))
        else:
            note = payload
            note_html = _esc(note.body).replace("\n", "<br/>")
            story.append(Paragraph(f"<b>Fecha:</b> {_fmt_dt(note.created_at)}", small))
            story.append(Paragraph("Nota del auditor:", subheading_style))
            story.append(Paragraph(note_html, note_style))
        story.append(Spacer(1, 12))

    if evidence_records:
        story.append(PageBreak())
        story.append(Paragraph("Evidencia", heading_style))
        story.append(HRFlowable(width="100%", thickness=0.6, color=_LINE, spaceAfter=6))
        ev_rows = [["Fecha y hora", "Glosa", "Evidencia"]]
        for ev in evidence_records:
            ev_rows.append(
                [
                    Paragraph(_fmt_dt(ev["created_at"]), small),
                    Paragraph(_esc(ev["glosa"]), small),
                    _build_evidence_image(ev["content"], max_width=80 * mm, max_height=60 * mm),
                ]
            )
        ev_table = Table(ev_rows, colWidths=[28 * mm, 47 * mm, 90 * mm], repeatRows=1)
        ev_table.setStyle(
            TableStyle(
                [
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
                    ("FONTSIZE", (0, 0), (-1, 0), 7.5),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("LINEBELOW", (0, 0), (-1, 0), 1, _LINE),
                    ("LINEBELOW", (0, 1), (-1, -2), 0.5, _LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(ev_table)

    doc.build(story, canvasmaker=_build_canvas_maker(detail.title))
    return buf.getvalue()


@router.get("/{case_id}/export.pdf")
async def export_case_pdf(case_id: int, pool: PoolDep, user: CurrentUserDep) -> Response:
    detail = await cases_service.get_case_detail(pool, case_id, user=user)
    if detail is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Caso no encontrado")
    evidence_records = await cases_repository.list_case_evidence_with_content(pool, case_id)
    pdf_bytes = build_case_pdf(detail, evidence_records)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="expediente_{case_id}.pdf"'},
    )


def _split_addresses(raw: str) -> list[str]:
    return [addr.strip() for addr in re.split(r"[;,]", raw) if addr.strip()]


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
        pdf_bytes = build_case_pdf(detail, evidence_records)
        email_attachments.append(
            {
                "filename": f"expediente_{case_id}.pdf",
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

    try:
        await n8n_client.send_case_email(
            mailbox_account_id=mailbox_account_id,
            to=to_list,
            cc=cc_list,
            subject=subject,
            body=body,
            attachments=email_attachments,
        )
    except n8n_client.SendEmailError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return CaseSendEmailResponse(sent=True)
