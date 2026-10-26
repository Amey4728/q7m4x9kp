import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorHeatmap } from './ErrorHeatmap'
import { buildScale, type Cell } from './heatmapScale'

const cells: Cell[] = ['2026-01-02', '2026-01-03'].flatMap((day, i) =>
  Array.from({ length: 24 }, (_, hour) => ({ day, hour, error: (i ? 1 : -1) * hour * 100 })),
)

describe('buildScale', () => {
  it('is symmetric around zero so colour means direction', () => {
    const { color, max } = buildScale(cells, 'light')
    expect(max).toBeGreaterThan(0)
    expect(color(0)).toBe(buildScale(cells, 'light').color(0))
    expect(color(max)).not.toBe(color(-max))
  })

  it('ignores a single extreme outlier when setting the range', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ day: 'd', hour: i % 24, error: 1000 }))
    const { max } = buildScale([...many, { day: 'd', hour: 0, error: 1e6 }], 'light')
    expect(max).toBe(1000)
  })

  it('handles empty input', () => {
    expect(buildScale([], 'dark').max).toBe(1)
  })
})

describe('ErrorHeatmap', () => {
  it('renders one cell per day-hour', () => {
    const { container } = render(<ErrorHeatmap cells={cells} mode="light" />)
    expect(container.querySelectorAll('rect:not(.heatmap-focus)')).toHaveLength(48)
  })

  it('supports keyboard navigation and Enter to open a day', () => {
    const onOpenDay = vi.fn()
    render(<ErrorHeatmap cells={cells} mode="light" onOpenDay={onOpenDay} />)
    const grid = screen.getByRole('grid')
    fireEvent.focus(grid)
    expect(screen.getByText(/00:00/, { selector: 'b' })).toBeInTheDocument()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(screen.getByText(/Sat 3 Jan 02:00/)).toBeInTheDocument()
    expect(screen.getByText(/too high by 200 MW/)).toBeInTheDocument()
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onOpenDay).toHaveBeenCalledWith('2026-01-03')
  })

  it('clamps navigation at the edges', () => {
    render(<ErrorHeatmap cells={cells} mode="light" />)
    const grid = screen.getByRole('grid')
    fireEvent.focus(grid)
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    expect(screen.getByText(/Fri 2 Jan 00:00/)).toBeInTheDocument()
  })
})
