import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Meta } from '../api/client'
import { useExplorer } from '../api/queries'
import { ChartCard, Kpi, Loading, Tip } from '../components/ui'
import { axisProps, COLORS, fmt } from '../lib'
import { useExplorerEnd, useExplorerStart, useHorizon } from '../state/appState'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ExplorerPage({ meta }: { meta: Meta }) {
  const minDay = meta.delivery_window[0].slice(0, 10)
  const maxDay = '2026-02-01'
  const [start, setStart] = useExplorerStart()
  const [end, setEnd] = useExplorerEnd()
  const [committed, setCommitted] = useHorizon() // in the URL; only updated on slider release
  const [draft, setDraft] = useState<number | null>(null) // live slider value while dragging
  const horizon = draft ?? committed
  const commit = () => {
    if (draft != null) setCommitted(draft)
    setDraft(null)
  }

  const valid = start <= end && start >= minDay && end <= maxDay
  const q = useExplorer(start, end, committed, valid)
  const data = q.data
  const error = valid ? q.error?.message : 'Pick a range between 2 Jan and 1 Feb, with From before To'
  const loading = q.isPlaceholderData || q.isFetching

  const rows = useMemo(() => {
    if (!data) return []
    const m = new Map<string, Record<string, number | string | null>>()
    for (const a of data.actual) m.set(a.time, { time: a.time, actual: a.actual })
    for (const f of data.forecast) {
      const r = m.get(f.time) ?? { time: f.time }
      Object.assign(r, { forecast: f.forecast, publish_time: f.publish_time })
      m.set(f.time, r)
    }
    return [...m.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  }, [data])

  const s = data?.summary
  const dayTicks = rows.map((r) => String(r.time)).filter((t) => t.slice(11, 16) === '00:00')

  return (
    <div className="page">
      <div className="toolbar">
        <label>
          From <input type="date" value={start} min={minDay} max={maxDay} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={end} min={minDay} max={maxDay} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="slider">
          Forecast made at least <b>{horizon} h</b> ahead
          <input
            type="range"
            min={0}
            max={48}
            step={1}
            value={horizon}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
        </label>
      </div>
      <p className="lede">
        For every hour, this shows the latest Elexon forecast that was published at least {committed} hours before
        that hour. Move the slider to see how forecasts get closer to reality as delivery approaches.
      </p>

      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Typical miss (MAE)" value={fmt.gw(s?.mae)} sub={`${fmt.pct(s?.nmae_pct)} of average output`} />
            <Kpi label="Bias" value={fmt.gw(s?.bias)} sub={`Forecast too high in ${fmt.pct(s?.shortfall_share_pct)} of hours`} />
            <Kpi label="9 in 10 hours within" value={fmt.gw(s?.abs_p90)} />
            <Kpi label="Hours compared" value={fmt.num(s?.n)} />
          </div>
          <ChartCard
            title="Forecast vs actual"
            subtitle="MW, UK time. Forecast is hourly, actual half-hourly."
            loading={loading}
            legend={[
              { label: `Forecast (≥ ${committed} h ahead)`, color: COLORS.forecast },
              { label: 'Actual', color: COLORS.actual },
            ]}
            rows={data.forecast}
            columns={[
              { key: 't', label: 'Target hour', render: (r) => fmt.dayTime(r.time) },
              { key: 'f', label: 'Forecast (MW)', render: (r) => fmt.num(r.forecast) },
              { key: 'p', label: 'Published', render: (r) => fmt.dayTime(r.publish_time) },
              { key: 'h', label: 'Hours ahead', render: (r) => r.horizon_h },
            ]}
          >
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="time" ticks={dayTicks} tickFormatter={(t: string) => `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]}`} interval="preserveStartEnd" minTickGap={16} {...axisProps} />
                <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} />
                <Tooltip content={<Tip labelFormat={(l) => fmt.dayTime(String(l))} valueFormat={fmt.mw} />} />
                <Line dataKey="forecast" name="Forecast" stroke={COLORS.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="actual" name="Actual" stroke={COLORS.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  )
}
