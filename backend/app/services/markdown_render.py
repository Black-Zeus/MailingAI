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
_STYLE_SCRIPT_RE = re.compile(r"<(style|script)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)


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


def html_to_ai_context(html: str) -> str:
    """Convierte el cuerpo HTML de un correo a Markdown compacto para mandarlo
    como contexto a la IA (preguntas-respuesta sobre un expediente) -- a
    diferencia de html_to_markdown (precarga del cuerpo para responder, donde
    se quiere ver todo tal cual), aca se descartan imagenes (strip=['img'])
    y estilos/scripts: una imagen no le sirve de nada a un modelo de texto,
    y si esta embebida como data: URI o referencia cid: a un adjunto puede
    ser una cantidad enorme de texto que solo consume tokens sin aportar
    nada a la respuesta."""
    if not html:
        return ""
    # markdownify(strip=[...]) solo saca la etiqueta, no el contenido de
    # adentro -- para <style>/<script> eso deja el CSS/JS crudo como texto
    # suelto en el resultado (probado con un caso real, ver commit). Hay que
    # sacar el bloque entero antes de convertir.
    cleaned = _STYLE_SCRIPT_RE.sub("", html)
    text = _html_to_markdown(cleaned, heading_style="ATX", strip=["img"]).strip()
    # Colapsa 3+ saltos de linea seguidos (tablas/firmas HTML generan mucho
    # espaciado vacio) sin perder los parrafos reales.
    return re.sub(r"\n{3,}", "\n\n", text)


def html_to_markdown(html: str) -> str:
    """Inverso de markdown_to_safe_html -- las notas del auditor se guardan
    como HTML (ver arriba), pero para precargar el cuerpo de un correo se
    quiere el equivalente en Markdown (mas facil de leer/editar que el HTML
    crudo). No es un roundtrip perfecto (el Markdown original ya se perdio al
    guardar la nota), pero para HTML generado por nuestro propio conversor
    (tags simples: p, strong, ul/li, etc.) el resultado es limpio."""
    return _html_to_markdown(html, heading_style="ATX").strip()


# Marca el borde entre "lo que esta persona escribio de nuevo" y "el hilo
# citado que Outlook reinserta debajo" -- cubre tanto el formato en espanol
# (De:/Enviado el:) como el que genera Outlook para Android en ingles
# (From:/Sent:), que aparece mezclado en el mismo expediente cuando alguien
# responde desde el celular.
_QUOTE_MARKER_RE = re.compile(
    r"\*\*(?:De|From):\*\*\s*(?P<sender>[^\n]+)\n\s*\*\*(?:Enviado el|Sent):\*\*",
    re.IGNORECASE,
)
_QUOTE_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")


def truncate_quoted_reply(body: str, known_addresses: set[str], known_names: set[str]) -> str:
    """Corta un cuerpo de correo en el primer marcador de cita de Outlook
    (ver _QUOTE_MARKER_RE) SOLO si el remitente citado ahi es alguien que ya
    tiene su propio mensaje en este mismo expediente -- en ese caso el
    contenido citado es 100% redundante (ya esta completo, mas abajo en el
    contexto, como su propio mensaje) y ademas es peligroso dejarlo: un
    intento anterior de sacar solo los parrafos duplicados (no el bloque
    citado entero) termino borrando la respuesta real de una persona de
    ADENTRO de la cita que otra persona hizo de su correo, dejando un
    fragmento huerfano que el modelo le atribuyo a la persona equivocada.
    Cortar en el borde de la cita, entero, evita ese problema de raiz --
    nunca queda un pedazo de cita a medio sacar.

    Si el remitente citado NO tiene su propio mensaje en el expediente (un
    reenvio "FYI" a alguien que no estaba en el hilo original), se deja el
    cuerpo intacto -- ahi la cita puede ser el UNICO registro de esa
    historia previa que existe en este expediente.

    Usada tanto para armar el contexto completo (gateway.py) como para
    generar los chunks que se embeben para busqueda semantica
    (embeddings_service.py) -- el texto que se embebe tiene que ser el mismo
    que se mostraria en la via de contexto completo, si no la recuperacion
    podria traer contenido citado redundante que el contexto completo ya
    descarta."""
    match = _QUOTE_MARKER_RE.search(body)
    if match is None:
        return body
    sender_line = match.group("sender")
    email_match = _QUOTE_EMAIL_RE.search(sender_line)
    if email_match:
        is_known = email_match.group(0).lower() in known_addresses
    else:
        is_known = sender_line.strip().lower() in known_names
    if not is_known:
        return body
    return body[: match.start()].strip()
