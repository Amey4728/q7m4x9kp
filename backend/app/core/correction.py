"""Walk-forward bias correction and uncertainty band for the decision-time forecast.

The raw Elexon wind forecast runs consistently above outturn in January 2026, and the gap grows with
the size of the forecast. So we scale the forecast by the ratio actual/forecast seen over recent
delivery days. To avoid using information the desk would not have had:

  * for delivery day D (decided on D-1 at the cut-off) we only learn from delivery days <= D-2,
    which have fully settled actuals before the decision is made;
  * the band (P10/P90) comes from the corrected errors of those same past days.

Days with no usable history keep the raw forecast and get no band (`has_history = False`).
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd

WINDOW_DAYS = 14
MIN_HISTORY_HOURS = 24


def apply_walk_forward(dec: pd.DataFrame, window_days: int = WINDOW_DAYS) -> pd.DataFrame:
    """Add `scale`, `corrected`, `corrected_error`, `p10`, `p90`, `has_history` to a decision dataset.

    p10 = wind level the actual exceeded 90% of the time in the past (the "firm" wind),
    p90 = level it exceeded only 10% of the time.
    """
    dec = dec.sort_values("startTime").reset_index(drop=True).copy()
    days = sorted(dec["delivery_day"].unique())

    # First pass: scale factors and corrected values, day by day.
    scale_by_day: dict = {}
    for d in days:
        hist = dec[
            (dec["delivery_day"] <= d - timedelta(days=2))
            & (dec["delivery_day"] > d - timedelta(days=2 + window_days))
        ]
        scale_by_day[d] = (
            hist["actual"].sum() / hist["forecast"].sum() if len(hist) >= MIN_HISTORY_HOURS else np.nan
        )
    dec["scale"] = dec["delivery_day"].map(scale_by_day)
    dec["has_history"] = dec["scale"].notna()
    dec["corrected"] = dec["forecast"] * dec["scale"].fillna(1.0)
    dec["corrected_error"] = dec["corrected"] - dec["actual"]

    # Second pass: band from corrected errors of past days only (same rule as above).
    lo, hi = {}, {}
    for d in days:
        hist = dec[
            (dec["delivery_day"] <= d - timedelta(days=2))
            & (dec["delivery_day"] > d - timedelta(days=2 + window_days))
            & dec["has_history"]
        ]
        if len(hist) >= MIN_HISTORY_HOURS:
            q10, q90 = np.quantile(hist["corrected_error"], [0.1, 0.9])
            lo[d], hi[d] = q90, q10  # over-forecast error lowers the floor
        else:
            lo[d] = hi[d] = np.nan
    dec["p10"] = (dec["corrected"] - dec["delivery_day"].map(lo)).clip(lower=0)
    dec["p90"] = dec["corrected"] - dec["delivery_day"].map(hi)
    return dec


def band_coverage(dec: pd.DataFrame) -> dict:
    """How often the actual fell inside / below the band (should be about 80% / 10%)."""
    b = dec.dropna(subset=["p10", "p90"])
    if b.empty:
        return {"n": 0}
    inside = ((b["actual"] >= b["p10"]) & (b["actual"] <= b["p90"])).mean()
    below = (b["actual"] < b["p10"]).mean()
    return {
        "n": int(len(b)),
        "inside_pct": round(100 * float(inside), 1),
        "below_p10_pct": round(100 * float(below), 1),
        "above_p90_pct": round(100 * float(1 - inside - below), 1),
    }
