import re

import bleach
import markdown as _markdown
from markdownify import markdownify as _html_to_markdown

_ALLOWED_TAGS = [
    "p", "br", "strong", "em", "b", "i", "u", "s", "del",
    "ul", "ol", "li", "blockquote", "code", "pre",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "a", "hr", "table", "thead", "tbody", "tr", "th", "td",
]
_ALLOWED_ATTRS = {"a": ["href", "title", "rel"]}
_TAG_RE = re.compile(r"<[^>]+>")


def markdown_to_safe_html(raw_text: str) -> str:
    """Convierte texto (Markdown o texto plano) a HTML saneado.

    Las notas del auditor a veces se redactan con ayuda de IA y se pegan con
    formato Markdown (negritas, listas, etc.) -- se normaliza a HTML al
    guardar para que se vea bien tanto en la lista de notas como en el PDF
    exportado, en vez de mostrar los asteriscos/guiones crudos. bleach.clean
    descarta cualquier tag HTML crudo que el usuario haya pegado (Markdown
    permite HTML embebido) -- solo sobrevive lo que el propio conversor
    generó a partir del Markdown.
    """
    html = _markdown.markdown(raw_text, extensions=["extra", "sane_lists"])
    return bleach.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)


def html_to_plain_text(html: str) -> str:
    """Texto plano de una sola linea a partir de HTML -- para previsualizaciones
    cortas (ej. el evento de linea de tiempo) donde no queremos tags."""
    return " ".join(_TAG_RE.sub(" ", html).split())


def html_to_markdown(html: str) -> str:
    """Inverso de markdown_to_safe_html -- las notas del auditor se guardan
    como HTML (ver arriba), pero para precargar el cuerpo de un correo se
    quiere el equivalente en Markdown (mas facil de leer/editar que el HTML
    crudo). No es un roundtrip perfecto (el Markdown original ya se perdio al
    guardar la nota), pero para HTML generado por nuestro propio conversor
    (tags simples: p, strong, ul/li, etc.) el resultado es limpio."""
    return _html_to_markdown(html, heading_style="ATX").strip()
