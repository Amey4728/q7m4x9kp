"""Async client for the Elexon BMRS Insights API (no API key needed).

Requests are split into day/week chunks and fetched concurrently, bounded by a semaphore so we stay
polite to the API. Transient failures (network errors, 429, 5xx) are retried with exponential backoff.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

import httpx

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
TIMEOUT = httpx.Timeout(30.0)
MAX_CONCURRENCY = 6
RETRIES = 4

log = logging.getLogger("wfm.elexon")


class ElexonError(RuntimeError):
    pass


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _get(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, path: str, params: dict, backoff: float = 0.5
) -> list[dict]:
    for attempt in range(RETRIES):
        async with sem:
            try:
                resp = await client.get(f"{BASE_URL}/{path}", params=params)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                resp.raise_for_status()
                data = resp.json()
                return data["data"] if isinstance(data, dict) else data
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                retryable = isinstance(exc, httpx.TransportError) or exc.response.status_code in (
                    429,
                    *range(500, 600),
                )
                if not retryable or attempt == RETRIES - 1:
                    raise ElexonError(f"{path} {params}: {exc}") from exc
                log.warning("retrying %s (attempt %d): %s", path, attempt + 1, exc)
        await asyncio.sleep(backoff * 2**attempt)
    raise ElexonError("unreachable")  # pragma: no cover


def actual_chunks(start: date, end: date, days: int = 7) -> list[dict]:
    out, d = [], start
    while d <= end:
        e = min(d + timedelta(days=days - 1), end)
        out.append(
            {"settlementDateFrom": d.isoformat(), "settlementDateTo": e.isoformat(), "fuelType": "WIND"}
        )
        d = e + timedelta(days=1)
    return out


def forecast_chunks(publish_from: datetime, publish_to: datetime) -> list[dict]:
    out, t = [], publish_from
    while t < publish_to:
        t2 = min(t + timedelta(days=1), publish_to)
        out.append({"publishDateTimeFrom": _iso(t), "publishDateTimeTo": _iso(t2)})
        t = t2
    return out


async def _fetch_all(path: str, chunks: list[dict], transport: httpx.AsyncBaseTransport | None) -> list[dict]:
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport) as client:
        parts = await asyncio.gather(*(_get(client, sem, path, c) for c in chunks))
    return [row for part in parts for row in part]


async def fetch_wind_actuals(start: date, end: date, transport=None) -> list[dict]:
    """Half-hourly national wind generation (FUELHH, fuelType=WIND), settlement dates start..end."""
    return await _fetch_all("FUELHH/stream", actual_chunks(start, end), transport)


async def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime, transport=None) -> list[dict]:
    """Every WINDFOR run published in [publish_from, publish_to)."""
    return await _fetch_all("WINDFOR/stream", forecast_chunks(publish_from, publish_to), transport)
