"""Which forecast was available when? (the "no peeking into the future" rules)."""

from __future__ import annotations

from datetime import date, time, timedelta

import pandas as pd

from .data import utc


def latest_per_target(forecasts: pd.DataFrame) -> pd.DataFrame:
    """For each startTime keep only the most recently published forecast."""
    if forecasts.empty:
        return forecasts
    idx = forecasts.groupby("startTime")["publishTime"].idxmax()
    return forecasts.loc[idx].sort_values("startTime").reset_index(drop=True)


def decision_cutoff(delivery_day: date, cutoff: time) -> pd.Timestamp:
    """Decision for delivery day D is made on D-1 at the cut-off time."""
    return utc(delivery_day - timedelta(days=1), cutoff)


def forecast_at_cutoff(forecasts: pd.DataFrame, delivery_day: date, cutoff: time) -> pd.DataFrame:
    """Hourly forecast for delivery day D using only runs published at or before the cut-off on D-1.

    Normally this is one run (e.g. 09:30 for an 11:00 cut-off); if that run is missing some hour,
    that hour falls back to the latest earlier run that covers it.
    """
    deadline = decision_cutoff(delivery_day, cutoff)
    start, end = utc(delivery_day), utc(delivery_day + timedelta(days=1))
    pool = forecasts[
        (forecasts["publishTime"] <= deadline)
        & (forecasts["startTime"] >= start)
        & (forecasts["startTime"] < end)
    ]
    return latest_per_target(pool)


def forecast_at_horizon(
    forecasts: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, horizon_h: float
) -> pd.DataFrame:
    """For each target time t in [start, end), the latest forecast published at least
    `horizon_h` hours before t."""
    pool = forecasts[
        (forecasts["startTime"] >= start)
        & (forecasts["startTime"] < end)
        & (forecasts["horizon_h"] >= horizon_h)
    ]
    return latest_per_target(pool)


def decision_dataset(
    forecasts: pd.DataFrame, actuals: pd.DataFrame, days: list[date], cutoff: time
) -> pd.DataFrame:
    """Forecast-at-decision vs actual for every hour of every delivery day."""
    from .data import attach_actuals

    parts = []
    for d in days:
        f = forecast_at_cutoff(forecasts, d, cutoff)
        if not f.empty:
            parts.append(f.assign(delivery_day=d))
    if not parts:
        return pd.DataFrame(
            columns=["publishTime", "startTime", "forecast", "horizon_h", "delivery_day", "actual", "error"]
        )
    return attach_actuals(pd.concat(parts, ignore_index=True), actuals)
