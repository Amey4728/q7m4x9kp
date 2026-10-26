"""Build the data snapshot used by the app.

Purchase decisions made in January 2026 (decision days 1-31 Jan) are for delivery days 2 Jan - 1 Feb.
We therefore need:
  * forecasts published from 31 Dec 2025 (so horizon analysis has history) to the end of 31 Jan 2026
  * actuals for 1 Jan - 1 Feb 2026

Run from the backend folder:  python -m scripts.fetch_data
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.elexon import fetch_wind_actuals, fetch_wind_forecasts  # noqa: E402

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
ISO = "%Y-%m-%dT%H:%M:%SZ"

FORECAST_PUBLISH_FROM = datetime(2025, 12, 31, tzinfo=UTC)
FORECAST_PUBLISH_TO = datetime(2026, 2, 1, tzinfo=UTC)
ACTUALS_FROM = date(2026, 1, 1)
ACTUALS_TO = date(2026, 2, 1)


def build_actuals() -> pd.DataFrame:
    df = pd.DataFrame(asyncio.run(fetch_wind_actuals(ACTUALS_FROM, ACTUALS_TO)))
    df = df[df["fuelType"] == "WIND"]
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    # If a period was republished, keep the latest value.
    df = df.sort_values("publishTime").drop_duplicates("startTime", keep="last")
    return (
        df[["startTime", "generation"]]
        .sort_values("startTime")
        .reset_index(drop=True)
        .astype({"generation": "float64"})
    )


def build_forecasts() -> pd.DataFrame:
    df = pd.DataFrame(asyncio.run(fetch_wind_forecasts(FORECAST_PUBLISH_FROM, FORECAST_PUBLISH_TO)))
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df = df.drop_duplicates(["publishTime", "startTime"], keep="last")
    return (
        df[["publishTime", "startTime", "generation"]]
        .sort_values(["publishTime", "startTime"])
        .reset_index(drop=True)
        .astype({"generation": "float64"})
    )


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    actuals = build_actuals()
    forecasts = build_forecasts()
    actuals.to_csv(DATA_DIR / "actuals.csv.gz", index=False, date_format=ISO)
    forecasts.to_csv(DATA_DIR / "forecasts.csv.gz", index=False, date_format=ISO)

    expected = int((pd.Timestamp(ACTUALS_TO) - pd.Timestamp(ACTUALS_FROM)).days + 1) * 48
    print(
        f"actuals:   {len(actuals)} rows ({expected} expected), "
        f"{actuals.startTime.min()} -> {actuals.startTime.max()}"
    )
    print(
        f"forecasts: {len(forecasts)} rows, {forecasts.publishTime.nunique()} runs, "
        f"{forecasts.publishTime.min()} -> {forecasts.publishTime.max()}"
    )


if __name__ == "__main__":
    main()
