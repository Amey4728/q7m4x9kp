// Day × hour heatmap of forecast error, drawn as plain SVG with a D3 diverging scale.
// Interaction: hover or arrow keys move a single "active" cell (one tab stop, not 744);
// Enter/click opens that delivery day in the decision view.
import { memo, useMemo, useState, type KeyboardEvent } from 'react'
import { fmt } from '../lib'
import { buildScale, RAMPS, type Cell } from './heatmapScale'

const CELL_W = 30
const CELL_H = 12
const LEFT = 34
const TOP = 6
const BOTTOM = 22

export const ErrorHeatmap = memo(function ErrorHeatmap(props: {
  cells: Cell[]
  mode: 'light' | 'dark'
  onOpenDay?: (deliveryDay: string) => void
}) {
  const { cells, mode, onOpenDay } = props
  const days = useMemo(() => [...new Set(cells.map((c) => c.day))].sort(), [cells])
  const grid = useMemo(() => new Map(cells.map((c) => [`${c.day}|${c.hour}`, c])), [cells])
  const { color, max } = useMemo(() => buildScale(cells, mode), [cells, mode])
  const [active, setActive] = useState<{ d: number; h: number } | null>(null)

  const width = LEFT + days.length * CELL_W
  const height = TOP + 24 * CELL_H + BOTTOM
  const activeCell = active ? grid.get(`${days[active.d]}|${active.h}`) : undefined

  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? { d: 0, h: 0 }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (moves[e.key]) {
      e.preventDefault()
      const [dd, dh] = moves[e.key]
      setActive({
        d: Math.max(0, Math.min(days.length - 1, cur.d + dd)),
        h: Math.max(0, Math.min(23, cur.h + dh)),
      })
    } else if (e.key === 'Enter' && active) {
      onOpenDay?.(days[active.d])
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <div className="heatmap">
      <div className="heatmap-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="grid"
          aria-label="Forecast error by delivery day and hour. Arrow keys to move, Enter to open the day."
          tabIndex={0}
          onKeyDown={onKey}
          onMouseLeave={() => setActive(null)}
          onFocus={() => !active && setActive({ d: 0, h: 0 })}
          style={{ minWidth: 560 }}
        >
          {days.map((day, di) =>
            Array.from({ length: 24 }, (_, h) => {
              const c = grid.get(`${day}|${h}`)
              return (
                <rect
                  key={`${day}|${h}`}
                  x={LEFT + di * CELL_W + 1}
                  y={TOP + h * CELL_H + 1}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={c ? color(c.error) : 'var(--grid)'}
                  onMouseEnter={() => setActive({ d: di, h })}
                  onClick={() => onOpenDay?.(day)}
                  style={{ cursor: onOpenDay ? 'pointer' : undefined }}
                />
              )
            }),
          )}
          {active && (
            <rect
              className="heatmap-focus"
              x={LEFT + active.d * CELL_W}
              y={TOP + active.h * CELL_H}
              width={CELL_W}
              height={CELL_H}
              rx={3}
            />
          )}
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} x={LEFT - 6} y={TOP + h * CELL_H + CELL_H / 2} className="heatmap-label" textAnchor="end" dominantBaseline="middle">
              {String(h).padStart(2, '0')}:00
            </text>
          ))}
          {days.map((d, i) =>
            i % 2 === 0 ? (
              <text key={d} x={LEFT + i * CELL_W + CELL_W / 2} y={height - 6} className="heatmap-label" textAnchor="middle">
                {Number(d.slice(8))}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <div className="heatmap-foot">
        <div className="heatmap-legend" aria-hidden>
          <span>{fmt.gw(-max)} surplus</span>
          <span
            className="heatmap-ramp"
            style={{ background: `linear-gradient(90deg, ${RAMPS[mode].join(',')})` }}
          />
          <span>{fmt.gw(max)} shortfall</span>
        </div>
        <div className="heatmap-readout" aria-live="polite">
          {activeCell ? (
            <>
              <b>
                {fmt.day(activeCell.day)} {String(activeCell.hour).padStart(2, '0')}:00
              </b>{' '}
              forecast {activeCell.error > 0 ? 'too high' : 'too low'} by {fmt.mw(Math.abs(activeCell.error))}
              {onOpenDay && <span className="muted"> · click or Enter to open the day</span>}
            </>
          ) : (
            <span className="muted">Hover a cell, or focus the map and use the arrow keys</span>
          )}
        </div>
      </div>
    </div>
  )
})
