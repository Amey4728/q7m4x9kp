const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export const fmt = {
  mw: (v: number | null | undefined) => (v == null ? '–' : `${nf0.format(v)} MW`),
  gw: (v: number | null | undefined) => (v == null ? '–' : `${nf1.format(v / 1000)} GW`),
  gwh: (v: number | null | undefined) => (v == null ? '–' : `${nf0.format(v / 1000)} GWh`),
  signedGwh: (v: number | null | undefined) =>
    v == null ? '–' : `${v > 0 ? '+' : ''}${nf1.format(v / 1000)} GWh`,
  pct: (v: number | null | undefined) => (v == null ? '–' : `${nf0.format(v)}%`),
  num: (v: number | null | undefined) => (v == null ? '–' : nf0.format(v)),
  /** "14:00" from an ISO string (UTC = UK time in January). */
  hhmm: (iso: string) => iso.slice(11, 16),
  /** "Thu 15 Jan" */
  day: (iso: string) =>
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
  dayTime: (iso: string) => `${fmt.day(iso)} ${iso.slice(11, 16)}`,
}

export const COLORS = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  corrected: 'var(--series-corrected)',
  band: 'var(--band)',
  shortfall: 'var(--diverge-pos)',
  surplus: 'var(--diverge-neg)',
  grid: 'var(--grid)',
  axis: 'var(--muted)',
}

/** Shift an ISO date (YYYY-MM-DD) by n days, in UTC. */
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const axisProps = {
  stroke: COLORS.axis,
  tick: { fill: 'var(--muted)', fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: 'var(--baseline)' },
} as const
