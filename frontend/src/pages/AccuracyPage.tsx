import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { exportUrl, type Summary } from '../api/client'
import { useAccuracy } from '../api/queries'
import { ErrorHeatmap } from '../components/ErrorHeatmap'
import { ChartCard, Kpi, Loading, Tip } from '../components/ui'
import { addDays, axisProps, COLORS, fmt } from '../lib'
import { useColorMode, useDecisionDay, useTab } from '../state/appState'

const summaryCols = [
  { key: 'mae', label: 'MAE', render: (r: Summary) => fmt.mw(r.mae) },
  { key: 'bias', label: 'Bias', render: (r: Summary) => fmt.mw(r.bias) },
  { key: 'rmse', label: 'RMSE', render: (r: Summary) => fmt.mw(r.rmse) },
  { key: 'n', label: 'Hours', render: (r: Summary) => r.n },
]

export default function AccuracyPage({ cutoff }: { cutoff: string }) {
  const q = useAccuracy(cutoff)
  const mode = useColorMode()
  const [, setTab] = useTab()
  const [, setDay] = useDecisionDay()
  const data = q.data
  if (!data) return <Loading error={q.error?.message} />
  const loading = q.isPlaceholderData
  const r = data.raw
  const c = data.comparison
  const sig = data.significance
  // Heatmap cells are delivery days; the decision view is keyed by the decision day (D-1).
  const openDay = (deliveryDay: string) => {
    setDay(addDays(deliveryDay, -1))
    setTab('decision')
  }

  return (
    <div className="page">
      <section className="card insights">
        <h3>What January 2026 tells us</h3>
        <ul>
          {data.insights.map((s) => (
            <li key={s}>{s}</li>
          ))}
          {sig.improvement_pct != null && (
            <li>
              Scaling the forecast by recent outturn (using only data available at decision time) cut the typical
              hourly miss from <b>{fmt.gw(c.raw.mae)}</b> to <b>{fmt.gw(c.corrected.mae)}</b> (
              <b>{fmt.pct(sig.improvement_pct)} lower</b>, 95% interval {fmt.pct(sig.ci_low_pct)} to{' '}
              {fmt.pct(sig.ci_high_pct)}). It was better on {sig.days_better} of {sig.days} days.
            </li>
          )}
        </ul>
        <a className="button" href={exportUrl(cutoff)}>
          Download hourly data (CSV)
        </a>
      </section>

      <div className="kpis">
        <Kpi label="Typical miss (MAE)" value={fmt.gw(r.mae)} sub={`${fmt.pct(r.nmae_pct)} of average wind output`} />
        <Kpi label="Bias" value={fmt.gw(r.bias)} sub={`Forecast too high in ${fmt.pct(r.shortfall_share_pct)} of hours`} />
        <Kpi label="9 in 10 hours within" value={fmt.gw(r.abs_p90)} sub={`RMSE ${fmt.gw(r.rmse)}`} />
        <Kpi
          label="Adjusted forecast MAE"
          tone="accent"
          value={fmt.gw(c.corrected.mae)}
          sub={`Bias ${fmt.gw(c.corrected.bias)} · band held ${fmt.pct(data.band_coverage.inside_pct)} of hours (target 80%)`}
        />
      </div>

      <ChartCard
        title="Where and when the forecast missed"
        subtitle="Decision-time forecast error for every hour of every January delivery day. Red: less wind than forecast. Click a cell to open that day."
        loading={loading}
        rows={data.heatmap}
        columns={[
          { key: 'd', label: 'Delivery day', render: (x) => fmt.day(x.day) },
          { key: 'h', label: 'Hour', render: (x) => `${String(x.hour).padStart(2, '0')}:00` },
          { key: 'e', label: 'Error (forecast − actual)', render: (x) => fmt.mw(x.error) },
        ]}
      >
        <ErrorHeatmap cells={data.heatmap} mode={mode} onOpenDay={openDay} />
      </ChartCard>

      <div className="grid-2">
        <ChartCard
          title="Accuracy drops the further ahead you look"
          subtitle="All Elexon runs for January deliveries. Shaded: horizons used for day-ahead decisions (14.5–37.5 h with an 11:00 cut-off)."
          loading={loading}
          legend={[
            { label: 'Typical miss (MAE)', color: COLORS.forecast },
            { label: 'Bias (forecast − actual)', color: COLORS.actual },
          ]}
          rows={data.by_horizon}
          columns={[{ key: 'h', label: 'Hours ahead', render: (x) => `${x.horizon_h}–${x.horizon_h + 3}` }, ...summaryCols]}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.by_horizon} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <ReferenceArea x1={12} x2={36} fill="var(--highlight)" />
              <XAxis dataKey="horizon_h" unit="h" {...axisProps} label={{ value: 'Hours between publish and delivery', position: 'insideBottom', offset: -10, fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} ticks={[0, 500, 1000, 1500, 2000, 2500]} />
              <Tooltip content={<Tip labelFormat={(l) => `${l}–${Number(l) + 3} h ahead`} valueFormat={fmt.mw} />} />
              <Line dataKey="mae" name="MAE" stroke={COLORS.forecast} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line dataKey="bias" name="Bias" stroke={COLORS.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Daily energy error"
          subtitle="Forecast at decision time minus actual, per delivery day. Red: less wind than forecast (shortfall to buy)."
          loading={loading}
          legend={[
            { label: 'Shortfall', color: COLORS.shortfall, kind: 'bar' },
            { label: 'Surplus', color: COLORS.surplus, kind: 'bar' },
          ]}
          rows={data.daily}
          columns={[
            { key: 'd', label: 'Delivery day', render: (x) => fmt.day(x.day) },
            { key: 'f', label: 'Forecast', render: (x) => fmt.gwh(x.forecast_mwh) },
            { key: 'a', label: 'Actual', render: (x) => fmt.gwh(x.actual_mwh) },
            { key: 'e', label: 'Error', render: (x) => fmt.signedGwh(x.error_mwh) },
          ]}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d) => String(Number(d.slice(8)))} interval={2} {...axisProps} />
              <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}`} unit=" GWh" width={68} {...axisProps} />
              <ReferenceLine y={0} stroke="var(--baseline)" />
              <Tooltip
                cursor={{ fill: 'var(--highlight)' }}
                content={<Tip labelFormat={(l) => fmt.day(String(l))} valueFormat={fmt.signedGwh} />}
              />
              <Bar dataKey="error_mwh" name="Error" radius={[4, 4, 4, 4]} isAnimationActive={false}>
                {data.daily.map((d) => (
                  <Cell key={d.day} fill={(d.error_mwh ?? 0) > 0 ? COLORS.shortfall : COLORS.surplus} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Error by hour of day"
          subtitle="Decision-time forecast, all January delivery days."
          loading={loading}
          legend={[
            { label: 'Typical miss (MAE)', color: COLORS.forecast, kind: 'bar' },
            { label: 'Bias', color: COLORS.actual },
          ]}
          rows={data.by_hour}
          columns={[{ key: 'h', label: 'Hour', render: (x) => `${String(x.hour).padStart(2, '0')}:00` }, ...summaryCols]}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.by_hour} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, '0')}`} interval={2} {...axisProps} />
              <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} />
              <Tooltip cursor={{ fill: 'var(--highlight)' }} content={<Tip labelFormat={(l) => `${String(l).padStart(2, '0')}:00`} valueFormat={fmt.mw} />} />
              <Bar dataKey="mae" name="MAE" fill={COLORS.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="bias" name="Bias" stroke={COLORS.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Bigger forecasts, bigger misses"
          subtitle="Error grouped by how much wind was forecast. This is why the adjustment is a percentage, not a fixed MW."
          loading={loading}
          legend={[
            { label: 'Typical miss (MAE)', color: COLORS.forecast, kind: 'bar' },
            { label: 'Bias', color: COLORS.actual },
          ]}
          rows={data.by_level}
          columns={[{ key: 'l', label: 'Forecast level', render: (x) => `${fmt.gw(x.level_mw)}–${fmt.gw(x.level_mw + 2500)}` }, ...summaryCols]}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.by_level} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="level_mw" tickFormatter={(v) => `${v / 1000}–${(v + 2500) / 1000}`} unit=" GW" {...axisProps} />
              <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" width={56} {...axisProps} />
              <Tooltip cursor={{ fill: 'var(--highlight)' }} content={<Tip labelFormat={(l) => `Forecast ${Number(l) / 1000}–${(Number(l) + 2500) / 1000} GW`} valueFormat={fmt.mw} />} />
              <Bar dataKey="mae" name="MAE" fill={COLORS.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="bias" name="Bias" stroke={COLORS.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="How often each size of error happened"
        subtitle="Hourly error at decision time (forecast − actual), 500 MW bins. Most of the mass sits right of zero: the forecast tends to be too high."
        loading={loading}
        rows={data.histogram}
        columns={[
          { key: 'b', label: 'Error range', render: (x) => `${fmt.num(x.bin)} to ${fmt.num(x.bin + 500)} MW` },
          { key: 'c', label: 'Hours', render: (x) => x.count },
        ]}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.histogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="bin" tickFormatter={(v) => `${v / 1000}`} unit=" GW" {...axisProps} />
            <YAxis width={40} {...axisProps} />
            <Tooltip cursor={{ fill: 'var(--highlight)' }} content={<Tip labelFormat={(l) => `${fmt.num(Number(l))} to ${fmt.num(Number(l) + 500)} MW`} valueFormat={(v) => `${v} hours`} />} />
            <ReferenceLine x={0} stroke="var(--secondary)" />
            <Bar dataKey="count" name="Hours" fill={COLORS.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="card">
        <h3>Elexon vs adjusted forecast, same {c.days} days</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>Bias</th>
                <th>9 in 10 within</th>
                <th>Worst shortfall</th>
                <th>Too high in</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Elexon forecast', c.raw],
                  ['Adjusted forecast', c.corrected],
                ] as const
              ).map(([name, s]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td>{fmt.mw(s.mae)}</td>
                  <td>{fmt.mw(s.rmse)}</td>
                  <td>{fmt.mw(s.bias)}</td>
                  <td>{fmt.mw(s.abs_p90)}</td>
                  <td>{fmt.mw(s.max_shortfall)}</td>
                  <td>{fmt.pct(s.shortfall_share_pct)} of hours</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Uncertainty band check: actual wind fell inside the P10–P90 band in {fmt.pct(data.band_coverage.inside_pct)} of
          hours (target 80%), below P10 in {fmt.pct(data.band_coverage.below_p10_pct)} (target 10%) and above P90 in{' '}
          {fmt.pct(data.band_coverage.above_p90_pct)}. The low side is slightly under-covered, so treat P10 as a
          floor with some caution. Improvement interval: day-block bootstrap ({sig.n_boot.toLocaleString('en-GB')}{' '}
          resamples of whole days, since errors within a day move together).
        </p>
      </section>
    </div>
  )
}
