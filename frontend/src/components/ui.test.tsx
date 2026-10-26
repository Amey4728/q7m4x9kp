import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fmt } from '../lib'
import { ChartCard } from './ui'

describe('ChartCard', () => {
  it('toggles between the chart and an accessible table of the same data', async () => {
    render(
      <ChartCard
        title="T"
        rows={[{ a: 1 }, { a: 2 }]}
        columns={[{ key: 'a', label: 'A', render: (r: { a: number }) => r.a }]}
      >
        <div>chart</div>
      </ChartCard>,
    )
    expect(screen.getByText('chart')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }))
    expect(screen.queryByText('chart')).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show chart' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('fmt', () => {
  it('formats units and handles missing values', () => {
    expect(fmt.gw(1728)).toBe('1.7 GW')
    expect(fmt.gwh(191402)).toBe('191 GWh')
    expect(fmt.signedGwh(9444)).toBe('+9.4 GWh')
    expect(fmt.signedGwh(-14560)).toBe('-14.6 GWh')
    expect(fmt.mw(null)).toBe('–')
    expect(fmt.day('2026-01-15')).toBe('Thu 15 Jan')
    expect(fmt.hhmm('2026-01-15T09:30:00Z')).toBe('09:30')
  })
})
