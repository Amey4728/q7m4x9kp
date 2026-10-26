"""Elexon client tests with a fake transport: no network, deterministic failures."""

import asyncio
from datetime import UTC, date, datetime

import httpx
import pytest

from app import elexon


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    async def instant(_):
        return None

    monkeypatch.setattr(elexon.asyncio, "sleep", instant)


def test_chunks_cover_range_without_gaps_or_overlap():
    c = elexon.actual_chunks(date(2026, 1, 1), date(2026, 2, 1))
    assert c[0]["settlementDateFrom"] == "2026-01-01" and c[-1]["settlementDateTo"] == "2026-02-01"
    for a, b in zip(c, c[1:], strict=False):
        gap = date.fromisoformat(b["settlementDateFrom"]) - date.fromisoformat(a["settlementDateTo"])
        assert gap.days == 1
    f = elexon.forecast_chunks(datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 3, 12, tzinfo=UTC))
    assert len(f) == 3 and f[-1]["publishDateTimeTo"] == "2026-01-03T12:00:00Z"


def test_fetch_concatenates_chunks_in_order():
    def handler(req: httpx.Request):
        return httpx.Response(200, json=[{"from": req.url.params["publishDateTimeFrom"]}])

    rows = asyncio.run(
        elexon.fetch_wind_forecasts(
            datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 4, tzinfo=UTC), httpx.MockTransport(handler)
        )
    )
    assert [r["from"][:10] for r in rows] == ["2026-01-01", "2026-01-02", "2026-01-03"]


def test_retries_transient_errors_then_succeeds():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("boom")
        if calls["n"] == 2:
            return httpx.Response(503)
        return httpx.Response(200, json={"data": [{"ok": 1}]})  # also accepts the wrapped shape

    rows = asyncio.run(
        elexon.fetch_wind_actuals(date(2026, 1, 1), date(2026, 1, 1), httpx.MockTransport(handler))
    )
    assert rows == [{"ok": 1}] and calls["n"] == 3


def test_does_not_retry_client_errors():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad"})

    with pytest.raises(elexon.ElexonError):
        asyncio.run(
            elexon.fetch_wind_actuals(date(2026, 1, 1), date(2026, 1, 1), httpx.MockTransport(handler))
        )
    assert calls["n"] == 1


def test_gives_up_after_max_retries():
    with pytest.raises(elexon.ElexonError):
        asyncio.run(
            elexon.fetch_wind_actuals(
                date(2026, 1, 1), date(2026, 1, 1), httpx.MockTransport(lambda r: httpx.Response(500))
            )
        )


def test_concurrency_is_bounded(monkeypatch):
    monkeypatch.setattr(elexon, "MAX_CONCURRENCY", 2)
    state = {"live": 0, "peak": 0}

    async def handler(req):
        state["live"] += 1
        state["peak"] = max(state["peak"], state["live"])
        await asyncio.get_running_loop().run_in_executor(None, lambda: None)
        state["live"] -= 1
        return httpx.Response(200, json=[])

    asyncio.run(
        elexon.fetch_wind_forecasts(
            datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 11, tzinfo=UTC), httpx.MockTransport(handler)
        )
    )
    assert 1 <= state["peak"] <= 2
