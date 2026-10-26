"""Loading and shaping the wind data snapshot.

Conventions used everywhere:
  * all timestamps are UTC (in January, UK time == UTC)
  * horizon_h = startTime - publishTime, in hours
  * error = forecast - actual  (positive = less wind than forecast = shortfall the desk must cover)
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[2] / "data"))

MAX_HORIZON_H = 72

# Purchase decisions made in January 2026 -> delivery days 2 Jan .. 1 Feb.
FIRST_DECISION_DAY = date(2026, 1, 1)
LAST_DECISION_DAY = date(2026, 1, 31)
DEFAULT_CUTOFF = time(11, 0)  # GB day-ahead auction gate closure, UK time on D-1


def utc(d: date, t: time = time(0)) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(d, t, tzinfo=UTC))


def delivery_window() -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) of all delivery periods covered by January decisions."""
    return utc(FIRST_DECISION_DAY + timedelta(days=1)), utc(LAST_DECISION_DAY + timedelta(days=2))


def clean_forecasts(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["horizon_h"] = (df["startTime"] - df["publishTime"]).dt.total_seconds() / 3600
    # Rows for times already in the past when published are not forecasts.
    df = df[(df["horizon_h"] >= 0) & (df["horizon_h"] <= MAX_HORIZON_H)]
    return df.sort_values(["publishTime", "startTime"]).reset_index(drop=True)


def _read(name: str, time_cols: list[str]) -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / f"{name}.csv.gz")
    for c in time_cols:
        df[c] = pd.to_datetime(df[c], utc=True)
    return df


@lru_cache(maxsize=1)
def load_actuals() -> pd.DataFrame:
    return _read("actuals", ["startTime"])


@lru_cache(maxsize=1)
def load_forecasts() -> pd.DataFrame:
    return clean_forecasts(_read("forecasts", ["publishTime", "startTime"]))


def attach_actuals(forecasts: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Join each hourly forecast to the actual for the same startTime and add the error.

    Forecasts are hourly and actuals half-hourly, so we compare on the hour.
    Rows without an actual yet are dropped.
    """
    merged = forecasts.merge(
        actuals.rename(columns={"generation": "actual"}), on="startTime", how="inner"
    ).rename(columns={"generation": "forecast"})
    merged["error"] = merged["forecast"] - merged["actual"]
    return merged
