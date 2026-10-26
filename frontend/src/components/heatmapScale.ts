import { interpolateRgbBasis } from 'd3-interpolate'
import { scaleDiverging } from 'd3-scale'

export interface Cell {
  day: string
  hour: number
  error: number
}

export const RAMPS = {
  // surplus (blue) -> neutral -> shortfall (red); same poles as the rest of the app
  light: ['#1c5cab', '#86b6ef', '#f0efec', '#f19a99', '#c62f2f'],
  dark: ['#3987e5', '#1c4a80', '#383835', '#8a3434', '#e66767'],
}

export function buildScale(cells: Cell[], mode: 'light' | 'dark') {
  // Symmetric domain at the 98th percentile of |error| so one outlier can't wash out the map.
  const abs = cells.map((c) => Math.abs(c.error)).sort((a, b) => a - b)
  const max = abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.98))] || 1 : 1
  return {
    max,
    color: scaleDiverging(interpolateRgbBasis(RAMPS[mode])).domain([-max, 0, max]).clamp(true),
  }
}
