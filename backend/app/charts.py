import io

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel


router = APIRouter(prefix="/charts", tags=["charts"])


class TimelinePoint(BaseModel):
    date: str
    count: int


class TimelineRequest(BaseModel):
    points: list[TimelinePoint]
    title: str = "Actividad de correo por dia"


class HistogramBucket(BaseModel):
    label: str
    count: int


class HistogramRequest(BaseModel):
    buckets: list[HistogramBucket]
    title: str = "Distribucion de correo"


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
