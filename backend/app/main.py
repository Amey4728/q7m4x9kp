"""HTTP layer. Thin: validate inputs, call the service, shape errors, add caching/observability.

API design notes (see docs/adr/0002-api-design.md):
  * versioned under /api/v1 so breaking changes can ship as /api/v2 alongside;
  * every response has a Pydantic model -> OpenAPI -> generated TypeScript types;
  * one error shape everywhere: {"error": {"code", "message", "request_id"}};
  * data is an immutable snapshot, so GETs carry an ETag of the data version and a cache lifetime.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pandas as pd
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import schemas, service
from .core.data import DEFAULT_CUTOFF, FIRST_DECISION_DAY, LAST_DECISION_DAY
from .observability import RequestContextMiddleware, configure_logging

VERSION = "1.1.0"

configure_logging()
app = FastAPI(
    title="Wind Forecast Monitor API",
    description="Day-ahead wind forecasts vs outturn for GB, January 2026 (Elexon BMRS data).",
    version=VERSION,
    responses={422: {"model": schemas.ErrorResponse, "description": "Validation error"}},
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(RequestContextMiddleware)

v1 = APIRouter(prefix="/api/v1")

CUTOFF_Q = Query(
    DEFAULT_CUTOFF.strftime("%H:%M"),
    pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
    description="Decision cut-off on D-1, UK time (HH:MM)",
)
CACHE_SECONDS = 3600


# ---------- errors: one shape for everything ----------


def _error(request: Request, status: int, code: str, message: str) -> JSONResponse:
    body = {
        "error": {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}
    }
    return JSONResponse(body, status_code=status)


@app.exception_handler(RequestValidationError)
async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    parts = [f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return _error(request, 422, "validation_error", "; ".join(parts))


@app.exception_handler(StarletteHTTPException)
async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {404: "not_found", 422: "validation_error"}.get(exc.status_code, "http_error")
    return _error(request, exc.status_code, code, str(exc.detail))


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Logged with the request id by the middleware; never leak internals to the client.
    return _error(request, 500, "internal_error", "Unexpected server error")


# ---------- helpers ----------


def _cutoff(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


def _cached(request: Request, response: Response) -> Response | None:
    """Set ETag/Cache-Control; return 304 if the client already has this data version."""
    etag = f'"{service.data_version()}"'
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=dict(response.headers))
    return None


def _in_range(d: date, lo: date, hi: date, name: str) -> None:
    if not lo <= d <= hi:
        raise HTTPException(422, f"{name} must be between {lo} and {hi}")


# ---------- routes ----------


@app.get("/api/health", response_model=schemas.Health, tags=["ops"])
def health() -> dict:
    return {"status": "ok", "version": VERSION}


@v1.get("/meta", response_model=schemas.Meta, tags=["reference"])
def meta(request: Request, response: Response):
    return _cached(request, response) or service.meta()


@v1.get("/decision", response_model=schemas.Decision, tags=["decision"])
def decision(
    request: Request,
    response: Response,
    decision_date: date = Query(..., description="Day the purchase decision is made"),
    cutoff: str = CUTOFF_Q,
):
    _in_range(decision_date, FIRST_DECISION_DAY, LAST_DECISION_DAY, "decision_date")
    return _cached(request, response) or service.decision_view(decision_date, _cutoff(cutoff))


@v1.get("/evolution", response_model=schemas.Evolution, tags=["decision"])
def evolution(
    request: Request,
    response: Response,
    delivery_date: date = Query(..., description="Delivery day"),
):
    _in_range(
        delivery_date,
        FIRST_DECISION_DAY + timedelta(days=1),
        LAST_DECISION_DAY + timedelta(days=1),
        "delivery_date",
    )
    return _cached(request, response) or service.evolution(delivery_date)


@v1.get("/accuracy", response_model=schemas.Accuracy, tags=["accuracy"])
def accuracy(request: Request, response: Response, cutoff: str = CUTOFF_Q):
    return _cached(request, response) or service.accuracy(_cutoff(cutoff))


@v1.get("/forecast", response_model=schemas.Explorer, tags=["accuracy"])
def forecast(
    request: Request,
    response: Response,
    start: date = Query(..., description="First target day (inclusive)"),
    end: date = Query(..., description="Last target day (inclusive)"),
    horizon_h: float = Query(14.0, ge=0, le=60, description="Minimum hours between publish and target"),
):
    if end < start:
        raise HTTPException(422, "end must not be before start")
    if (end - start).days > 31:
        raise HTTPException(422, "range is limited to 31 days")
    s = pd.Timestamp(start, tz="UTC")
    e = pd.Timestamp(end + timedelta(days=1), tz="UTC")
    return _cached(request, response) or service.explorer(s, e, horizon_h)


@v1.get("/export.csv", response_class=PlainTextResponse, tags=["accuracy"])
def export(cutoff: str = CUTOFF_Q) -> PlainTextResponse:
    return PlainTextResponse(
        service.export_csv(_cutoff(cutoff)),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wind_decision_forecasts_jan2026.csv"},
    )


app.include_router(v1)
