"""Forecast accuracy metrics. Pure functions over DataFrames with `forecast`, `actual`, `error`."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd


def _r(x: float, nd: int = 1) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def summary(df: pd.DataFrame) -> dict:
    """Headline error statistics (MW). error = forecast - actual."""
    if df.empty:
        return {"n": 0}
    e = df["error"].to_numpy(dtype=float)
    a = df["actual"].to_numpy(dtype=float)
    mae = np.mean(np.abs(e))
    return {
        "n": int(len(e)),
        "mae": _r(mae),
        "rmse": _r(np.sqrt(np.mean(e**2))),
        "bias": _r(np.mean(e)),
        "nmae_pct": _r(100 * mae / np.mean(a)),
        "p10": _r(np.percentile(e, 10)),
        "p50": _r(np.percentile(e, 50)),
        "p90": _r(np.percentile(e, 90)),
        "abs_p90": _r(np.percentile(np.abs(e), 90)),
        "max_shortfall": _r(np.max(e)),
        "max_surplus": _r(np.min(e)),
        "shortfall_share_pct": _r(100 * np.mean(e > 0)),
        "mean_actual": _r(np.mean(a)),
    }


def by_group(df: pd.DataFrame, key: pd.Series, label: str) -> list[dict]:
    rows = []
    for k, g in df.groupby(key, observed=True):
        s = summary(g)
        rows.append({label: k if not hasattr(k, "item") else k.item(), **s})
    return rows


def by_horizon(df: pd.DataFrame, bin_h: int = 3) -> list[dict]:
    """Error vs forecast horizon, in bins of `bin_h` hours (bin label = lower edge)."""
    key = (df["horizon_h"] // bin_h * bin_h).astype(int)
    return by_group(df, key, "horizon_h")


def by_hour_of_day(df: pd.DataFrame) -> list[dict]:
    return by_group(df, df["startTime"].dt.hour, "hour")


def by_forecast_level(df: pd.DataFrame, step: int = 2500) -> list[dict]:
    """Does the size of the error depend on how much wind was forecast?"""
    key = (df["forecast"] // step * step).astype(int)
    return by_group(df, key, "level_mw")


def histogram(errors: pd.Series, width: int = 500) -> list[dict]:
    e = errors.to_numpy(dtype=float)
    if len(e) == 0:
        return []
    lo = math.floor(e.min() / width) * width
    hi = math.ceil(e.max() / width) * width + width
    counts, edges = np.histogram(e, bins=np.arange(lo, hi + 1, width))
    return [{"bin": int(edges[i]), "count": int(c)} for i, c in enumerate(counts)]


def daily(df: pd.DataFrame) -> pd.DataFrame:
    """Daily energy (MWh) from the hourly points: each hourly MW value covers one hour."""
    g = df.groupby("delivery_day").agg(
        forecast_mwh=("forecast", "sum"),
        actual_mwh=("actual", "sum"),
        hours=("forecast", "size"),
        publish_time=("publishTime", "max"),
    )
    g["error_mwh"] = g["forecast_mwh"] - g["actual_mwh"]
    return g.reset_index()


def error_quantiles(errors: pd.Series, qs=(0.1, 0.5, 0.9)) -> dict[float, float]:
    e = errors.to_numpy(dtype=float)
    return {q: float(np.quantile(e, q)) for q in qs}


def paired_block_bootstrap(
    raw_abs: pd.Series, adj_abs: pd.Series, groups: pd.Series, n_boot: int = 5000, seed: int = 7
) -> dict:
    """Is the adjusted forecast's lower MAE real or luck?

    Errors within a day are strongly correlated, so we resample whole days (block bootstrap), keeping
    raw and adjusted errors paired. Returns the % MAE reduction with a 95% interval.
    """
    by_day = pd.DataFrame({"raw": raw_abs, "adj": adj_abs, "g": groups}).groupby("g").sum()
    n = len(by_day)
    if n == 0:
        return {
            "improvement_pct": None,
            "ci_low_pct": None,
            "ci_high_pct": None,
            "days_better": 0,
            "days": 0,
            "n_boot": 0,
        }
    raw, adj = by_day["raw"].to_numpy(), by_day["adj"].to_numpy()
    idx = np.random.default_rng(seed).integers(0, n, size=(n_boot, n))
    boot = 100 * (1 - adj[idx].sum(axis=1) / raw[idx].sum(axis=1))
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return {
        "improvement_pct": _r(100 * (1 - adj.sum() / raw.sum())),
        "ci_low_pct": _r(lo),
        "ci_high_pct": _r(hi),
        "days_better": int((adj < raw).sum()),
        "days": int(n),
        "n_boot": n_boot,
    }
