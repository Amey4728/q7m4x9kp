"""Use-case layer: turns the core functions into the payloads the API serves."""

from __future__ import annotations

import hashlib
from datetime import date, time, timedelta
from functools import lru_cache

import pandas as pd

from .core import metrics
from .core.correction import WINDOW_DAYS, apply_walk_forward, band_coverage
from .core.data import (
    DATA_DIR,
    DEFAULT_CUTOFF,
    FIRST_DECISION_DAY,
    LAST_DECISION_DAY,
    attach_actuals,
    delivery_window,
    load_actuals,
    load_forecasts,
    utc,
)
from .core.selection import decision_cutoff, decision_dataset, forecast_at_horizon


def decision_days() -> list[date]:
    n = (LAST_DECISION_DAY - FIRST_DECISION_DAY).days + 1
    return [FIRST_DECISION_DAY + timedelta(days=i) for i in range(n)]


def delivery_days() -> list[date]:
    return [d + timedelta(days=1) for d in decision_days()]


def _iso(ts) -> str | None:
    return None if pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(x, nd: int = 0):
    return None if pd.isna(x) else round(float(x), nd)


@lru_cache(maxsize=1)
def data_version() -> str:
    """Short hash of the data snapshot; used for ETags so clients cache until the data changes."""
    h = hashlib.sha256()
    for f in sorted(DATA_DIR.glob("*.csv.gz")):
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


@lru_cache(maxsize=32)
def decision_frame(cutoff: time) -> pd.DataFrame:
    """Decision-time forecast vs actual for all January decisions, with walk-forward correction."""
    dec = decision_dataset(load_forecasts(), load_actuals(), delivery_days(), cutoff)
    return apply_walk_forward(dec)


def meta() -> dict:
    f, a = load_forecasts(), load_actuals()
    return {
        "decision_days": [d.isoformat() for d in decision_days()],
        "default_cutoff": DEFAULT_CUTOFF.strftime("%H:%M"),
        "delivery_window": [_iso(t) for t in delivery_window()],
        "forecast_runs": int(f["publishTime"].nunique()),
        "forecast_rows": int(len(f)),
        "actual_rows": int(len(a)),
        "actuals_range": [_iso(a["startTime"].min()), _iso(a["startTime"].max())],
        "correction_window_days": WINDOW_DAYS,
        "data_version": data_version(),
    }


def decision_view(decision_day: date, cutoff: time) -> dict:
    delivery_day = decision_day + timedelta(days=1)
    dec = decision_frame(cutoff)
    day = dec[dec["delivery_day"] == delivery_day]
    deadline = decision_cutoff(delivery_day, cutoff)

    # Half-hourly actuals for the delivery day, for a detailed outturn line.
    a = load_actuals()
    a_day = a[(a["startTime"] >= utc(delivery_day)) & (a["startTime"] < utc(delivery_day + timedelta(1)))]

    # Hourly view needs the forecast even for hours where the actual is missing (not the case
    # in January, but keep the endpoint honest).
    series = [
        {
            "time": _iso(r.startTime),
            "forecast": _num(r.forecast),
            "corrected": _num(r.corrected),
            "p10": _num(r.p10),
            "p90": _num(r.p90),
            "actual": _num(r.actual),
            "horizon_h": _num(r.horizon_h, 1),
        }
        for r in day.itertuples()
    ]
    has_history = bool(day["has_history"].all()) if len(day) else False
    kpis = {
        "forecast_mwh": _num(day["forecast"].sum()),
        "corrected_mwh": _num(day["corrected"].sum()),
        "firm_p10_mwh": _num(day["p10"].sum()) if has_history else None,
        "actual_mwh": _num(day["actual"].sum()),
        "raw_error_mwh": _num(day["error"].sum()),
        "corrected_error_mwh": _num(day["corrected_error"].sum()),
        "raw_mae": _num(day["error"].abs().mean()),
        "corrected_mae": _num(day["corrected_error"].abs().mean()),
        "peak_forecast_mw": _num(day["forecast"].max()),
        "min_forecast_mw": _num(day["forecast"].min()),
        "scale": _num(day["scale"].iloc[0], 3) if has_history else None,
    }
    return {
        "decision_day": decision_day.isoformat(),
        "delivery_day": delivery_day.isoformat(),
        "cutoff": _iso(deadline),
        "publish_times": sorted({_iso(t) for t in day["publishTime"]}),
        "has_history": has_history,
        "kpis": kpis,
        "series": series,
        "actuals_halfhourly": [
            {"time": _iso(r.startTime), "actual": _num(r.generation)} for r in a_day.itertuples()
        ],
    }


@lru_cache(maxsize=32)
def accuracy(cutoff: time) -> dict:
    dec = decision_frame(cutoff)
    hist_rows = dec[dec["has_history"]]
    corrected = hist_rows.assign(error=hist_rows["corrected_error"])
    raw_same_days = hist_rows  # fair comparison: same hours for raw and corrected

    # All forecast runs vs actuals over the delivery window, for the horizon curve.
    start, end = delivery_window()
    f = load_forecasts()
    all_runs = attach_actuals(f[(f["startTime"] >= start) & (f["startTime"] < end)], load_actuals())

    daily = metrics.daily(dec)
    raw = metrics.summary(dec)
    return {
        "cutoff": cutoff.strftime("%H:%M"),
        "raw": raw,
        "comparison": {
            "days": int(hist_rows["delivery_day"].nunique()),
            "raw": metrics.summary(raw_same_days),
            "corrected": metrics.summary(corrected),
        },
        "significance": metrics.paired_block_bootstrap(
            hist_rows["error"].abs(), hist_rows["corrected_error"].abs(), hist_rows["delivery_day"]
        ),
        "band_coverage": band_coverage(dec),
        "by_horizon": metrics.by_horizon(all_runs, bin_h=3),
        "by_hour": metrics.by_hour_of_day(dec),
        "by_level": metrics.by_forecast_level(dec),
        "histogram": metrics.histogram(dec["error"], width=500),
        "daily": [
            {
                "day": r.delivery_day.isoformat(),
                "forecast_mwh": _num(r.forecast_mwh),
                "actual_mwh": _num(r.actual_mwh),
                "error_mwh": _num(r.error_mwh),
            }
            for r in daily.itertuples()
        ],
        "heatmap": [
            {"day": r.delivery_day.isoformat(), "hour": int(r.startTime.hour), "error": _num(r.error)}
            for r in dec.itertuples()
        ],
        "insights": _insights(raw, dec, daily),
    }


def _insights(raw: dict, dec: pd.DataFrame, daily: pd.DataFrame) -> list[str]:
    if not raw.get("n"):
        return []
    abs_daily = daily["error_mwh"].abs()
    return [
        f"The forecast available at decision time was too high in {raw['shortfall_share_pct']:.0f}% "
        f"of hours, by {raw['bias'] / 1000:.1f} GW on average.",
        f"Typical hourly miss (MAE) was {raw['mae'] / 1000:.1f} GW, about {raw['nmae_pct']:.0f}% of "
        f"average wind output.",
        f"In 9 hours out of 10 the forecast was off by less than {raw['abs_p90'] / 1000:.1f} GW.",
        f"On the worst hour, wind came in {raw['max_shortfall'] / 1000:.1f} GW below forecast.",
        f"Daily energy was off by more than {abs_daily.quantile(0.5) / 1000:.0f} GWh on half of the days.",
    ]


def explorer(start: pd.Timestamp, end: pd.Timestamp, horizon_h: float) -> dict:
    f = forecast_at_horizon(load_forecasts(), start, end, horizon_h)
    a = load_actuals()
    a = a[(a["startTime"] >= start) & (a["startTime"] < end)]
    matched = attach_actuals(f, a)
    return {
        "horizon_h": horizon_h,
        "forecast": [
            {
                "time": _iso(r.startTime),
                "forecast": _num(r.generation),
                "publish_time": _iso(r.publishTime),
                "horizon_h": _num(r.horizon_h, 1),
            }
            for r in f.itertuples()
        ],
        "actual": [{"time": _iso(r.startTime), "actual": _num(r.generation)} for r in a.itertuples()],
        "summary": metrics.summary(matched),
    }


def evolution(delivery_day: date) -> dict:
    """Every forecast run that covered the delivery day: how the view changed as it got closer."""
    f = load_forecasts()
    s, e = utc(delivery_day), utc(delivery_day + timedelta(days=1))
    f = f[(f["startTime"] >= s) & (f["startTime"] < e)]
    runs = []
    for pt, g in f.groupby("publishTime"):
        runs.append(
            {
                "publish_time": _iso(pt),
                "mwh": _num(g["generation"].sum()),
                "hours": int(len(g)),
                "points": [
                    {"time": _iso(t), "forecast": _num(v)}
                    for t, v in zip(g.startTime, g.generation, strict=True)
                ],
            }
        )
    a = load_actuals()
    a = a[(a["startTime"] >= s) & (a["startTime"] < e)]
    return {
        "delivery_day": delivery_day.isoformat(),
        "runs": runs,
        "actual": [{"time": _iso(r.startTime), "actual": _num(r.generation)} for r in a.itertuples()],
    }


def export_csv(cutoff: time) -> str:
    dec = decision_frame(cutoff)
    cols = [
        "delivery_day",
        "startTime",
        "publishTime",
        "horizon_h",
        "forecast",
        "actual",
        "error",
        "scale",
        "corrected",
        "corrected_error",
        "p10",
        "p90",
    ]
    return dec[cols].to_csv(index=False, float_format="%.2f", date_format="%Y-%m-%dT%H:%M:%SZ")
