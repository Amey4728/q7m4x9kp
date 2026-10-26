import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Meta } from '../api/client'
import { useDecision, useEvolution, usePrefetchDecisions } from '../api/queries'
import { ChartCard, Kpi, Loading, Tip } from '../components/ui'
import { axisProps, COLORS, fmt } from '../lib'
import { useDecisionDay } from '../state/appState'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))

export default function DecisionPage({ meta, cutoff }: { meta: Meta; cutoff: string }) {
  const days = meta.decision_days
  const [rawDay, setDay] = useDecisionDay()
  const day = days.includes(rawDay) ? rawDay : days[Math.floor(days.length / 2)]
  const idx = days.indexOf(day)
  const [reveal, setReveal] = useState(true)

  const decision = useDecision(day, cutoff)
  const data = decision.data
  const delivery = data?.delivery_day
  const evo = useEvolution(delivery)
  usePrefetchDecisions([days[idx - 1], days[idx + 1]].filter(Boolean), cutoff)

  // Keyboard: ←/→ step days, R toggles the outturn (ignored while typing in a control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' && idx > 0) setDay(days[idx - 1])
      else if (e.key === 'ArrowRight' && idx < days.length - 1) setDay(days[idx + 1])
      else if (e.key.toLowerCase() === 'r') setReveal((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, days, setDay])

  // Merge hourly forecast points with half-hourly actuals onto one time axis.
  const rows = useMemo(() => {
    if (!data) return []
    const byTime = new Map<string, Record<string, number | string | number[] | null>>()
    for (const a of data.actuals_halfhourly) byTime.set(a.time, { time: a.time, actual: a.actual })
    for (const p of data.series) {
      const r = byTime.get(p.time) ?? { time: p.time }
      Object.assign(r, {
        forecast: p.forecast,
        corrected: p.corrected,
        band: p.p10 != null && p.p90 != null ? [p.p10, p.p90] : null,
      })
      byTime.set(p.time, r)
    }
    return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  }, [data])

  const evoRows = useMemo(() => {
    if (!evo.data || !data) return { rows: [], runs: [] as string[] }
    const m = new Map<string, Record<string, number | string | null>>()
    for (const run of evo.data.runs)
      for (const p of run.points) {
        const r = m.get(p.time) ?? { time: p.time }
        r[run.publish_time] = p.forecast
        m.set(p.time, r)
      }
    for (const a of evo.data.actual) if (m.has(a.time)) m.get(a.time)!.actual = a.actual
    return {
      rows: [...m.values()].sort((a, b) => String(a.time).localeCompare(String(b.time))),
      runs: evo.data.runs.map((r) => r.publish_time),
    }
  }, [evo.data, data])

  if (!data) return <Loading error={decision.error?.message} />
  const loading = decision.isPlaceholderData
  const k = data.kpis
  const run = data.publish_times[0]
  const decisionRun = data.publish_times[data.publish_times.length - 1]
  const leadMin = run ? (Date.parse(data.cutoff) - Date.parse(decisionRun)) / 60000 : 0

  return (
    <div className="page">
      <div className="toolbar">
        <div className="stepper">
          <button className="ghost" disabled={idx <= 0} onClick={() => setDay(days[idx - 1])} aria-label="Previous day">
            ←
          </button>
          <label>
            <span className="sr-only">Decision day</span>
            <select value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => (
                <option key={d} value={d}>
                  Decide on {fmt.day(d)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost"
            disabled={idx >= days.length - 1}
            onClick={() => setDay(days[idx + 1])}
            aria-label="Next day"
          >
            →
          </button>
        </div>
        <span className="hint" aria-hidden>
          <kbd>←</kbd> <kbd>→</kbd> change day · <kbd>R</kbd> show/hide outturn
        </span>
        <label className="switch">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Show what actually happened
        </label>
      </div>

      <p className="lede">
        Buying on <b>{fmt.day(data.decision_day)}</b> before <b>{fmt.hhmm(data.cutoff)}</b> for delivery on{' '}
        <b>{fmt.day(data.delivery_day)}</b>. Latest wind forecast available:{' '}
        <b>{decisionRun ? `${fmt.hhmm(decisionRun)} run` : 'none'}</b>
        {decisionRun && ` (published ${Math.round(leadMin)} min before the cut-off)`}.
      </p>

      <div className="kpis">
        <Kpi label="Elexon forecast" value={fmt.gwh(k.forecast_mwh)} sub={`Peak ${fmt.gw(k.peak_forecast_mw)}, low ${fmt.gw(k.min_forecast_mw)}`} />
        <Kpi
          label="Adjusted forecast"
          tone="accent"
          value={fmt.gwh(k.corrected_mwh)}
          sub={
            data.has_history
              ? `Elexon × ${k.scale?.toFixed(2)}, learned from the last ${meta.correction_window_days} settled days`
              : 'Not enough settled history yet: Elexon forecast used as is'
          }
        />
        <Kpi
          label="Firm wind (P10)"
          value={fmt.gwh(k.firm_p10_mwh)}
          sub="Hour by hour, wind beat this level 9 times out of 10 in past days"
        />
        {reveal ? (
          <Kpi
            label="Actual wind"
            value={fmt.gwh(k.actual_mwh)}
            sub={
              <>
                Elexon off by <b>{fmt.signedGwh(k.raw_error_mwh)}</b>, adjusted off by{' '}
                <b>{fmt.signedGwh(k.corrected_error_mwh)}</b>
              </>
            }
          />
        ) : (
          <Kpi label="Actual wind" value="Hidden" sub="Turn on “Show what actually happened”" />
        )}
      </div>

      <ChartCard
        title={`Wind generation for ${fmt.day(data.delivery_day)}`}
        subtitle="MW, UK time. Shaded band: range wind landed in 8 times out of 10 on past days (P10–P90)."
        loading={loading}
        legend={[
          { label: 'Elexon forecast', color: COLORS.forecast },
          { label: 'Adjusted forecast', color: COLORS.corrected },
          { label: 'Uncertainty band', color: COLORS.band, kind: 'area' },
          ...(reveal ? [{ label: 'Actual (half-hourly)', color: COLORS.actual }] : []),
        ]}
        rows={data.series}
        columns={[
          { key: 't', label: 'Hour', render: (r) => fmt.hhmm(r.time) },
          { key: 'f', label: 'Elexon (MW)', render: (r) => fmt.num(r.forecast) },
          { key: 'c', label: 'Adjusted (MW)', render: (r) => fmt.num(r.corrected) },
          { key: 'p10', label: 'P10 (MW)', render: (r) => fmt.num(r.p10) },
          { key: 'p90', label: 'P90 (MW)', render: (r) => fmt.num(r.p90) },
          { key: 'a', label: 'Actual (MW)', render: (r) => (reveal ? fmt.num(r.actual) : 'hidden') },
          { key: 'h', label: 'Hours ahead', render: (r) => r.horizon_h },
        ]}
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="time" tickFormatter={fmt.hhmm} interval="preserveStartEnd" minTickGap={28} {...axisProps} />
            <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} />
            <Tooltip content={<Tip labelFormat={(l) => fmt.dayTime(String(l))} valueFormat={(v) => fmt.mw(v)} />} />
            <Area dataKey="band" name="P10–P90" fill={COLORS.band} stroke="none" connectNulls isAnimationActive={false} />
            <Line dataKey="forecast" name="Elexon forecast" stroke={COLORS.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="corrected" name="Adjusted forecast" stroke={COLORS.corrected} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            {reveal && (
              <Line dataKey="actual" name="Actual" stroke={COLORS.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="How the forecast for this day changed"
        subtitle="Every Elexon run covering the delivery day. Grey: other runs (later runs are only available after the decision). Blue: the run used for the decision."
        loading={evo.isPlaceholderData}
        legend={[
          { label: 'Run used at decision', color: COLORS.forecast },
          { label: 'Other runs', color: 'var(--muted)' },
          ...(reveal ? [{ label: 'Actual', color: COLORS.actual }] : []),
        ]}
        rows={evo.data?.runs ?? []}
        columns={[
          { key: 'p', label: 'Published', render: (r) => fmt.dayTime(r.publish_time) },
          { key: 'e', label: 'Forecast energy', render: (r) => fmt.gwh(r.mwh) },
          { key: 'h', label: 'Hours covered', render: (r) => r.hours },
          { key: 'u', label: 'Status', render: (r) => (r.publish_time <= data.cutoff ? (r.publish_time === decisionRun ? 'Used for decision' : 'Older') : 'After cut-off') },
        ]}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={evoRows.rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="time" tickFormatter={fmt.hhmm} interval="preserveStartEnd" minTickGap={28} {...axisProps} />
            <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} />
            {evoRows.runs
              .filter((r) => r !== decisionRun)
              .map((r) => (
                <Line key={r} dataKey={r} stroke="var(--muted)" strokeOpacity={0.45} strokeWidth={1} dot={false} isAnimationActive={false} />
              ))}
            {decisionRun && (
              <Line dataKey={decisionRun} stroke={COLORS.forecast} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            )}
            {reveal && <Line dataKey="actual" stroke={COLORS.actual} strokeWidth={2.5} dot={false} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
