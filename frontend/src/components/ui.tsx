import { useState, type ReactNode } from 'react'

export function Kpi(props: { label: string; value: string; sub?: ReactNode; tone?: 'accent' | 'plain' }) {
  return (
    <div className={`kpi ${props.tone === 'accent' ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">{props.label}</div>
      <div className="kpi-value">{props.value}</div>
      {props.sub && <div className="kpi-sub">{props.sub}</div>}
    </div>
  )
}

export interface Column<R> {
  key: string
  label: string
  render: (row: R) => ReactNode
}

/** Card holding a chart, with a "Show table" toggle so no value is only reachable by hover. */
export function ChartCard<R>(props: {
  title: string
  subtitle?: ReactNode
  legend?: { label: string; color: string; kind?: 'line' | 'area' | 'bar' }[]
  rows?: R[]
  columns?: Column<R>[]
  children: ReactNode
  loading?: boolean
}) {
  const [table, setTable] = useState(false)
  return (
    <section className={`card ${props.loading ? 'is-loading' : ''}`}>
      <header className="card-head">
        <div>
          <h3>{props.title}</h3>
          {props.subtitle && <p className="card-sub">{props.subtitle}</p>}
        </div>
        {props.rows && props.columns && (
          <button className="ghost" onClick={() => setTable(!table)} aria-pressed={table}>
            {table ? 'Show chart' : 'Show table'}
          </button>
        )}
      </header>
      {props.legend && !table && (
        <ul className="legend">
          {props.legend.map((l) => (
            <li key={l.label}>
              <span className={`swatch swatch-${l.kind ?? 'line'}`} style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {table && props.rows && props.columns ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {props.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r, i) => (
                <tr key={i}>
                  {props.columns!.map((c) => (
                    <td key={c.key}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        props.children
      )}
    </section>
  )
}

/** Shared tooltip: label on top, one row per series with a colour key. */
export function Tip(props: {
  active?: boolean
  label?: string | number
  payload?: { name?: string; value?: number | number[]; color?: string; dataKey?: string }[]
  labelFormat?: (l: string | number) => string
  valueFormat?: (v: number) => string
}) {
  if (!props.active || !props.payload?.length) return null
  const vf = props.valueFormat ?? ((v: number) => v.toLocaleString('en-GB'))
  return (
    <div className="tip">
      <div className="tip-label">{props.labelFormat ? props.labelFormat(props.label ?? '') : props.label}</div>
      {props.payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div className="tip-row" key={String(p.dataKey)}>
            <span className="swatch swatch-line" style={{ background: p.color }} />
            <span className="tip-name">{p.name}</span>
            <span className="tip-val">
              {Array.isArray(p.value) ? `${vf(p.value[0])} – ${vf(p.value[1])}` : vf(p.value as number)}
            </span>
          </div>
        ))}
    </div>
  )
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="state">{error ? `Could not load data: ${error}` : 'Loading…'}</div>
}
