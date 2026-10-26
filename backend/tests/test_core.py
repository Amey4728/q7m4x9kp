"""Unit tests on small hand-made data, so expected values can be checked by hand."""

from datetime import date, time

import numpy as np
import pandas as pd
import pytest

from app.core import metrics
from app.core.correction import apply_walk_forward, band_coverage
from app.core.data import attach_actuals, clean_forecasts
from app.core.selection import forecast_at_cutoff, forecast_at_horizon, latest_per_target

T = lambda s: pd.Timestamp(s, tz="UTC")  # noqa: E731


def make_forecasts(rows):
    df = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    return clean_forecasts(df)


@pytest.fixture
def runs():
    # Three runs on 14 Jan covering 15 Jan 00:00 and 01:00.
    rows = []
    for pt, base in [("2026-01-14T07:30Z", 100), ("2026-01-14T09:30Z", 200), ("2026-01-14T11:30Z", 300)]:
        rows += [(pt, "2026-01-15T00:00Z", base), (pt, "2026-01-15T01:00Z", base + 1)]
    return make_forecasts(rows)


def test_clean_drops_negative_horizons():
    f = make_forecasts(
        [("2026-01-14T09:30Z", "2026-01-14T08:00Z", 5), ("2026-01-14T09:30Z", "2026-01-14T10:00Z", 6)]
    )
    assert len(f) == 1 and f["horizon_h"].iloc[0] == 0.5


def test_cutoff_picks_latest_run_before_cutoff(runs):
    out = forecast_at_cutoff(runs, date(2026, 1, 15), time(11, 0))
    assert list(out["generation"]) == [200, 201]  # 09:30 run, not 11:30
    assert (out["publishTime"] <= T("2026-01-14T11:00Z")).all()


def test_cutoff_exactly_at_publish_time_is_included(runs):
    out = forecast_at_cutoff(runs, date(2026, 1, 15), time(11, 30))
    assert list(out["generation"]) == [300, 301]


def test_cutoff_falls_back_per_hour_when_latest_run_is_partial():
    f = make_forecasts(
        [
            ("2026-01-14T07:30Z", "2026-01-15T00:00Z", 1),
            ("2026-01-14T07:30Z", "2026-01-15T01:00Z", 2),
            ("2026-01-14T09:30Z", "2026-01-15T00:00Z", 10),  # 09:30 run misses 01:00
        ]
    )
    out = forecast_at_cutoff(f, date(2026, 1, 15), time(11, 0))
    assert list(out["generation"]) == [10, 2]


def test_cutoff_no_runs_returns_empty(runs):
    assert forecast_at_cutoff(runs, date(2026, 1, 15), time(6, 0)).empty


def test_forecast_at_horizon(runs):
    # Target 00:00 on 15 Jan: 07:30 run is 16.5h ahead, 09:30 is 14.5h, 11:30 is 12.5h.
    out = forecast_at_horizon(runs, T("2026-01-15"), T("2026-01-15T01:00Z"), 14)
    assert list(out["generation"]) == [200]
    out = forecast_at_horizon(runs, T("2026-01-15"), T("2026-01-15T01:00Z"), 16)
    assert list(out["generation"]) == [100]
    assert forecast_at_horizon(runs, T("2026-01-15"), T("2026-01-15T01:00Z"), 20).empty


def test_latest_per_target_empty():
    assert latest_per_target(pd.DataFrame(columns=["startTime", "publishTime"])).empty


def test_attach_actuals_and_error_sign(runs):
    a = pd.DataFrame({"startTime": [T("2026-01-15T00:00Z")], "generation": [150.0]})
    m = attach_actuals(runs, a)
    assert len(m) == 3  # only the matching hour, once per run
    assert set(m["error"]) == {100 - 150, 200 - 150, 300 - 150}


def test_summary_hand_calculated():
    df = pd.DataFrame({"forecast": [110, 90, 130, 100.0], "actual": [100, 100, 100, 100.0]})
    df["error"] = df["forecast"] - df["actual"]  # 10, -10, 30, 0
    s = metrics.summary(df)
    assert s["mae"] == 12.5
    assert s["bias"] == 7.5
    assert s["rmse"] == pytest.approx(np.sqrt((100 + 100 + 900 + 0) / 4), abs=0.1)
    assert s["nmae_pct"] == 12.5
    assert s["shortfall_share_pct"] == 50.0
    assert s["max_shortfall"] == 30 and s["max_surplus"] == -10


def test_summary_empty():
    assert metrics.summary(pd.DataFrame(columns=["error", "actual"])) == {"n": 0}


def test_histogram_counts_everything():
    h = metrics.histogram(pd.Series([-600, -10, 0, 499, 501, 1200.0]), width=500)
    assert sum(b["count"] for b in h) == 6
    assert h[0]["bin"] == -1000


def _decision_frame(days, forecast, actual):
    rows = []
    for d in days:
        for h in range(24):
            rows.append(
                {
                    "delivery_day": d,
                    "startTime": T(f"{d}T{h:02d}:00Z"),
                    "publishTime": T(f"{d}T00:00Z"),
                    "forecast": forecast,
                    "actual": actual,
                }
            )
    df = pd.DataFrame(rows)
    df["error"] = df["forecast"] - df["actual"]
    return df


def test_walk_forward_uses_only_settled_days():
    days = [date(2026, 1, d) for d in range(2, 8)]
    dec = apply_walk_forward(_decision_frame(days, forecast=120.0, actual=100.0))
    by_day = dec.groupby("delivery_day")
    # 2 and 3 Jan have no settled day (<= D-2) in the data -> uncorrected, no band.
    assert not by_day["has_history"].first()[date(2026, 1, 2)]
    assert not by_day["has_history"].first()[date(2026, 1, 3)]
    # From 4 Jan, scale = 100/120 learned from earlier days -> corrected = actual.
    d4 = dec[dec["delivery_day"] == date(2026, 1, 4)]
    assert d4["corrected"].iloc[0] == pytest.approx(100.0)


def test_walk_forward_does_not_peek_at_same_or_previous_day():
    days = [date(2026, 1, d) for d in range(2, 6)]
    dec = _decision_frame(days, forecast=100.0, actual=100.0)
    # Make D-1 (4 Jan) wildly different; it must not affect 5 Jan's scale.
    dec.loc[dec["delivery_day"] == date(2026, 1, 4), "actual"] = 1.0
    out = apply_walk_forward(dec)
    assert out[out["delivery_day"] == date(2026, 1, 5)]["scale"].iloc[0] == pytest.approx(1.0)


def test_band_coverage():
    df = pd.DataFrame({"actual": [5, 15, 25.0], "p10": [10, 10, 10.0], "p90": [20, 20, 20.0]})
    c = band_coverage(df)
    assert c["inside_pct"] == pytest.approx(33.3) and c["below_p10_pct"] == pytest.approx(33.3)


def test_bootstrap_detects_clear_improvement_and_none():
    days = pd.Series([d for d in range(20) for _ in range(24)])
    raw = pd.Series([100.0] * len(days))
    better = metrics.paired_block_bootstrap(raw, raw * 0.5, days, n_boot=500)
    assert better["improvement_pct"] == 50.0 and better["ci_low_pct"] == 50.0
    assert better["days_better"] == 20
    same = metrics.paired_block_bootstrap(raw, raw, days, n_boot=500)
    assert same["improvement_pct"] == 0.0 and same["days_better"] == 0
    empty = metrics.paired_block_bootstrap(
        pd.Series([], dtype=float), pd.Series([], dtype=float), pd.Series([], dtype=int)
    )
    assert empty["days"] == 0 and empty["improvement_pct"] is None
