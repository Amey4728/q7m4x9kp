"""Response models: the public API contract.

These drive the OpenAPI spec, which in turn generates the front end's TypeScript types
(`frontend/src/api/schema.d.ts`). CI fails if the two drift apart.
Units: power in MW, energy in MWh, times as ISO-8601 UTC strings.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str = Field(examples=["validation_error"])
    message: str
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class Health(BaseModel):
    status: str
    version: str


class Summary(BaseModel):
    """Error statistics, error = forecast - actual (positive = shortfall)."""

    n: int
    mae: float | None = None
    rmse: float | None = None
    bias: float | None = None
    nmae_pct: float | None = None
    p10: float | None = None
    p50: float | None = None
    p90: float | None = None
    abs_p90: float | None = None
    max_shortfall: float | None = None
    max_surplus: float | None = None
    shortfall_share_pct: float | None = None
    mean_actual: float | None = None


class Meta(BaseModel):
    decision_days: list[str]
    default_cutoff: str
    delivery_window: list[str]
    forecast_runs: int
    forecast_rows: int
    actual_rows: int
    actuals_range: list[str]
    correction_window_days: int
    data_version: str


class DecisionPoint(BaseModel):
    time: str
    forecast: float | None
    corrected: float | None
    p10: float | None
    p90: float | None
    actual: float | None
    horizon_h: float | None


class ActualPoint(BaseModel):
    time: str
    actual: float | None


class DecisionKpis(BaseModel):
    forecast_mwh: float | None
    corrected_mwh: float | None
    firm_p10_mwh: float | None
    actual_mwh: float | None
    raw_error_mwh: float | None
    corrected_error_mwh: float | None
    raw_mae: float | None
    corrected_mae: float | None
    peak_forecast_mw: float | None
    min_forecast_mw: float | None
    scale: float | None


class Decision(BaseModel):
    decision_day: str
    delivery_day: str
    cutoff: str
    publish_times: list[str]
    has_history: bool
    kpis: DecisionKpis
    series: list[DecisionPoint]
    actuals_halfhourly: list[ActualPoint]


class HorizonRow(Summary):
    horizon_h: int


class HourRow(Summary):
    hour: int


class LevelRow(Summary):
    level_mw: int


class HistogramBin(BaseModel):
    bin: int
    count: int


class DailyRow(BaseModel):
    day: str
    forecast_mwh: float | None
    actual_mwh: float | None
    error_mwh: float | None


class Comparison(BaseModel):
    days: int
    raw: Summary
    corrected: Summary


class Significance(BaseModel):
    """Day-block bootstrap of the MAE reduction from the adjusted forecast."""

    improvement_pct: float | None
    ci_low_pct: float | None
    ci_high_pct: float | None
    days_better: int
    days: int
    n_boot: int


class BandCoverage(BaseModel):
    n: int
    inside_pct: float | None = None
    below_p10_pct: float | None = None
    above_p90_pct: float | None = None


class HeatmapCell(BaseModel):
    day: str
    hour: int
    error: float


class Accuracy(BaseModel):
    cutoff: str
    raw: Summary
    comparison: Comparison
    significance: Significance
    band_coverage: BandCoverage
    by_horizon: list[HorizonRow]
    by_hour: list[HourRow]
    by_level: list[LevelRow]
    histogram: list[HistogramBin]
    daily: list[DailyRow]
    heatmap: list[HeatmapCell]
    insights: list[str]


class ExplorerPoint(BaseModel):
    time: str
    forecast: float | None
    publish_time: str
    horizon_h: float | None


class Explorer(BaseModel):
    horizon_h: float
    forecast: list[ExplorerPoint]
    actual: list[ActualPoint]
    summary: Summary


class RunPoint(BaseModel):
    time: str
    forecast: float | None


class Run(BaseModel):
    publish_time: str
    mwh: float | None
    hours: int
    points: list[RunPoint]


class Evolution(BaseModel):
    delivery_day: str
    runs: list[Run]
    actual: list[ActualPoint]
