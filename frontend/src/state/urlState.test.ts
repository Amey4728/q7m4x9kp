import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parsers, useUrlParam } from './urlState'

const horizon = { key: 'h', fallback: 24, parse: parsers.intInRange(0, 48) }

describe('useUrlParam', () => {
  it('falls back to the default when the param is missing or invalid', () => {
    window.history.replaceState(null, '', '/?h=999')
    const { result } = renderHook(() => useUrlParam(horizon))
    expect(result.current[0]).toBe(24)
  })

  it('writes to the URL and re-renders every subscriber', () => {
    const a = renderHook(() => useUrlParam(horizon))
    const b = renderHook(() => useUrlParam(horizon))
    act(() => a.result.current[1](6))
    expect(window.location.search).toBe('?h=6')
    expect(b.result.current[0]).toBe(6)
  })

  it('removes the param when set back to the default, keeping others', () => {
    window.history.replaceState(null, '', '/?h=6&tab=accuracy')
    const { result } = renderHook(() => useUrlParam(horizon))
    act(() => result.current[1](24))
    expect(window.location.search).toBe('?tab=accuracy')
  })

  it('follows browser back/forward', () => {
    const { result } = renderHook(() => useUrlParam(horizon, { push: true }))
    act(() => result.current[1](3))
    act(() => {
      window.history.replaceState(null, '', '/?h=12')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current[0]).toBe(12)
  })
})

describe('parsers', () => {
  it.each([
    ['2026-01-15', '2026-01-15'],
    ['2026-13-45', undefined],
    ['15/01/2026', undefined],
    ['', undefined],
  ])('isoDate(%j)', (raw, expected) => expect(parsers.isoDate(raw)).toBe(expected))

  it('intInRange rejects fractions and out-of-range', () => {
    const p = parsers.intInRange(0, 48)
    expect([p('0'), p('48'), p('49'), p('2.5'), p('x')]).toEqual([0, 48, undefined, undefined, undefined])
  })

  it('oneOf only accepts listed values', () => {
    const p = parsers.oneOf(['a', 'b'] as const)
    expect([p('a'), p('c')]).toEqual(['a', undefined])
  })
})
