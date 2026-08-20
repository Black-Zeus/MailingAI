import io

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field


router = APIRouter(prefix="/charts", tags=["charts"])

# Sin sesion a proposito (n8n lo llama server-to-server, ver docs/SECURITY.md)
# y mapeado publicamente en nginx -- estos limites son la unica defensa contra
# que alguien sin autenticar pida un render de matplotlib arbitrariamente
# grande (hallazgo M2 de la auditoria, docs/AUDIT_2026-08-19.md). 500 es
# generoso frente al uso real (actividad de UN expediente, nunca miles de
# puntos/remitentes distintos).
_MAX_ITEMS = 500


class TimelinePoint(BaseModel):
    date: str = Field(max_length=32)
    count: int = Field(ge=0, le=1_000_000)


class TimelineRequest(BaseModel):
    points: list[TimelinePoint] = Field(max_length=_MAX_ITEMS)
    title: str = Field(default="Actividad de correo por dia", max_length=200)


class HistogramBucket(BaseModel):
    label: str = Field(max_length=200)
    count: int = Field(ge=0, le=1_000_000)


class HistogramRequest(BaseModel):
    buckets: list[HistogramBucket] = Field(max_length=_MAX_ITEMS)
    title: str = Field(default="Distribucion de correo", max_length=200)


def _figure_to_png(fig) -> Response:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
    plt.close(fig)
    return Response(content=buf.getvalue(), media_type="image/png")


@router.post("/timeline")
def timeline(payload: TimelineRequest) -> Response:
    dates = [p.date for p in payload.points]
    counts = [p.count for p in payload.points]

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(dates, counts, marker="o")
    ax.set_title(payload.title)
    ax.set_xlabel("Fecha")
    ax.set_ylabel("Cantidad de correos")
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate(rotation=45)

    return _figure_to_png(fig)


@router.post("/histogram")
def histogram(payload: HistogramRequest) -> Response:
    labels = [b.label for b in payload.buckets]
    counts = [b.count for b in payload.buckets]

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(labels, counts)
    ax.set_title(payload.title)
    ax.set_xlabel("Categoria")
    ax.set_ylabel("Cantidad de correos")
    ax.grid(True, axis="y", alpha=0.3)
    fig.autofmt_xdate(rotation=45)

    return _figure_to_png(fig)
