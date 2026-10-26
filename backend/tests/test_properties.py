"""Property-based tests: the 'no peeking into the future' rules must hold for ANY forecast set,
not just the examples we thought of."""

from datetime import date, time, timedelta

import pandas as pd
from hypothesis import given, settings
from hypothesis import strategies as st

from app.core import metrics
from app.core.data import clean_forecasts
from app.core.selection import forecast_at_cutoff, forecast_at_horizon

BASE = pd.Timestamp("2026-01-13T00:00Z")
DELIVERY = date(2026, 1, 15)

# A forecast row: published somewhere in a 3-day window, for an hour somewhere in a 4-day window.
row = st.tuples(
    st.integers(0, 72 * 2 - 1),  # publish offset, half-hours
    st.integers(0, 96 - 1),  # target offset, hours
    st.floats(0, 25_000, allow_nan=False),
)


def frame(rows):
    df = pd.DataFrame(
        {
            "publishTime": pd.to_datetime(
                [BASE + pd.Timedelta(minutes=30 * p) for p, _, _ in rows], utc=True
            ),
            "startTime": pd.to_datetime([BASE + pd.Timedelta(hours=t) for _, t, _ in rows], utc=True),
            "generation": pd.Series([g for _, _, g in rows], dtype="float64"),
        }
    ).drop_duplicates(["publishTime", "startTime"])
    return clean_forecasts(df)


@settings(max_examples=300, deadline=None)
@given(st.lists(row, min_size=0, max_size=60), st.integers(0, 23), st.sampled_from([0, 30]))
def test_cutoff_selection_never_uses_future_and_is_latest(rows, hh, mm):
    f = frame(rows)
    cutoff = time(hh, mm)
    deadline = pd.Timestamp(f"{DELIVERY - timedelta(days=1)}T{hh:02d}:{mm:02d}Z")
    out = forecast_at_cutoff(f, DELIVERY, cutoff)

    # 1. nothing published after the deadline
    assert (out["publishTime"] <= deadline).all()
    # 2. only targets inside the delivery day, one row per hour
    assert out["startTime"].dt.date.eq(DELIVERY).all()
    assert out["startTime"].is_unique
    # 3. for each hour, it is the latest eligible run (no better choice was skipped)
    eligible = f[(f["publishTime"] <= deadline) & (f["startTime"].dt.date == DELIVERY)]
    assert set(out["startTime"]) == set(eligible["startTime"])
    latest = eligible.groupby("startTime")["publishTime"].max()
    chosen = out.set_index("startTime")["publishTime"]
    assert chosen.sort_index().equals(latest.sort_index().rename(chosen.name))


@settings(max_examples=300, deadline=None)
@given(st.lists(row, min_size=0, max_size=60), st.floats(0, 60, allow_nan=False))
def test_horizon_selection_respects_minimum_lead_time(rows, h):
    f = frame(rows)
    out = forecast_at_horizon(f, BASE, BASE + pd.Timedelta(days=4), h)
    lead = (out["startTime"] - out["publishTime"]).dt.total_seconds() / 3600
    assert (lead >= h - 1e-9).all()
    assert out["startTime"].is_unique


@settings(max_examples=200, deadline=None)
@given(st.lists(st.floats(-1e4, 1e4, allow_nan=False), min_size=1, max_size=200))
def test_summary_invariants(errors):
    df = pd.DataFrame({"error": errors, "actual": [10_000.0] * len(errors)})
    s = metrics.summary(df)
    assert s["mae"] <= s["rmse"] + 0.1  # MAE never exceeds RMSE
    assert abs(s["bias"]) <= s["mae"] + 0.1  # |mean| <= mean |x|
    assert s["p10"] <= s["p50"] <= s["p90"]
    assert sum(b["count"] for b in metrics.histogram(df["error"])) == len(errors)
