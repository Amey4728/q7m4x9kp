"""API tests against the real January 2026 snapshot."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
V1 = "/api/v1"


def get(path, **params):
    return client.get(f"{V1}{path}", params=params)


def test_health_has_version():
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["version"]


def test_meta():
    m = get("/meta").json()
    assert len(m["decision_days"]) == 31
    assert m["default_cutoff"] == "11:00"
    assert len(m["data_version"]) == 12


def test_decision_uses_0930_run_and_never_a_later_one():
    d = get("/decision", decision_date="2026-01-15").json()
    assert d["delivery_day"] == "2026-01-16"
    assert d["publish_times"] == ["2026-01-15T09:30:00Z"]
    assert len(d["series"]) == 24
    assert all(t <= d["cutoff"] for t in d["publish_times"])


def test_decision_totals_match_raw_elexon_values():
    # Cross-checked by hand against the live Elexon API (WINDFOR 09:30 run, FUELHH on-the-hour).
    k = get("/decision", decision_date="2026-01-15").json()["kpis"]
    assert k["forecast_mwh"] == 191402
    assert k["actual_mwh"] == 181958


def test_earlier_cutoff_uses_earlier_run():
    d = get("/decision", decision_date="2026-01-15", cutoff="08:00").json()
    assert d["publish_times"] == ["2026-01-15T07:30:00Z"]


def test_first_days_have_no_history_and_no_band():
    d = get("/decision", decision_date="2026-01-01").json()
    assert d["has_history"] is False
    assert d["kpis"]["firm_p10_mwh"] is None
    assert all(p["p10"] is None for p in d["series"])


@pytest.mark.parametrize("day", ["2025-12-31", "2026-02-01"])
def test_decision_out_of_range_uses_error_shape(day):
    r = get("/decision", decision_date=day)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error" and "decision_date" in err["message"]
    assert err["request_id"] == r.headers["x-request-id"]


@pytest.mark.parametrize("cutoff", ["11h", "24:00", "9:00", ""])
def test_bad_cutoff(cutoff):
    assert get("/accuracy", cutoff=cutoff).json()["error"]["code"] == "validation_error"


def test_missing_param():
    r = get("/decision")
    assert r.status_code == 422 and "decision_date" in r.json()["error"]["message"]


def test_unknown_route_uses_error_shape():
    r = client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_accuracy_shape_and_correction_helps():
    a = get("/accuracy").json()
    assert a["raw"]["n"] == 31 * 24
    comp = a["comparison"]
    assert comp["raw"]["n"] == comp["corrected"]["n"]
    assert comp["corrected"]["mae"] < comp["raw"]["mae"]
    sig = a["significance"]
    assert sig["ci_low_pct"] > 0, "improvement should be clearly above zero"
    assert sig["ci_low_pct"] <= sig["improvement_pct"] <= sig["ci_high_pct"]
    assert len(a["heatmap"]) == 31 * 24
    assert len(a["by_hour"]) == 24 and len(a["daily"]) == 31


def test_forecast_horizon_respected():
    r = get("/forecast", start="2026-01-10", end="2026-01-11", horizon_h=24)
    assert r.status_code == 200
    assert all(p["horizon_h"] >= 24 for p in r.json()["forecast"])


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-01-10", "end": "2026-01-09"},
        {"start": "2026-01-01", "end": "2026-03-01"},
        {"start": "2026-01-10", "end": "2026-01-11", "horizon_h": -1},
    ],
)
def test_forecast_bad_input(params):
    assert get("/forecast", **params).status_code == 422


def test_evolution():
    e = get("/evolution", delivery_date="2026-01-16").json()
    assert len(e["runs"]) > 5 and len(e["actual"]) == 48
    assert get("/evolution", delivery_date="2026-03-01").status_code == 422


def test_etag_round_trip_returns_304():
    r1 = get("/meta")
    etag = r1.headers["etag"]
    assert "max-age" in r1.headers["cache-control"]
    r2 = client.get(f"{V1}/meta", headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""


def test_request_id_echo_and_timing():
    r = client.get("/api/health", headers={"X-Request-ID": "abc123"})
    assert r.headers["x-request-id"] == "abc123"
    assert r.headers["server-timing"].startswith("app;dur=")


def test_export_csv():
    r = get("/export.csv")
    assert r.headers["content-type"].startswith("text/csv")
    lines = r.text.splitlines()
    assert lines[0].startswith("delivery_day,startTime,publishTime")
    assert len(lines) == 31 * 24 + 1


def test_openapi_documents_every_v1_route():
    paths = client.get("/openapi.json").json()["paths"]
    for p in ["/meta", "/decision", "/evolution", "/accuracy", "/forecast", "/export.csv"]:
        assert f"{V1}{p}" in paths
