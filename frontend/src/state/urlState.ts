// App state that should survive reloads and be shareable (tab, day, cut-off, explorer range) lives in
// the URL query string. Components subscribe with useSyncExternalStore, so back/forward just works.
import { useCallback, useSyncExternalStore } from 'react'

const EVENT = 'urlstatechange'

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVENT, cb)
  }
}

const snapshot = () => window.location.search

export interface Param<T> {
  key: string
  fallback: T
  parse: (raw: string) => T | undefined // undefined = invalid -> fallback
  serialize?: (v: T) => string
}

/** Read and update one URL query parameter, validated, with a default. */
export function useUrlParam<T>(p: Param<T>, opts: { push?: boolean } = {}): [T, (v: T) => void] {
  const search = useSyncExternalStore(subscribe, snapshot, () => '')
  const raw = new URLSearchParams(search).get(p.key)
  const value = raw == null ? p.fallback : (p.parse(raw) ?? p.fallback)
  const { key, fallback, serialize } = p
  const set = useCallback(
    (v: T) => {
      const params = new URLSearchParams(window.location.search)
      const s = serialize ? serialize(v) : String(v)
      if (s === (serialize ? serialize(fallback) : String(fallback))) params.delete(key)
      else params.set(key, s)
      const url = `${window.location.pathname}${params.size ? `?${params}` : ''}`
      window.history[opts.push ? 'pushState' : 'replaceState'](null, '', url)
      window.dispatchEvent(new Event(EVENT))
    },
    [key, fallback, serialize, opts.push],
  )
  return [value, set]
}

export const parsers = {
  oneOf:
    <T extends string>(allowed: readonly T[]) =>
    (raw: string) =>
      (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined,
  isoDate: (raw: string) => (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined),
  intInRange: (lo: number, hi: number) => (raw: string) => {
    const n = Number(raw)
    return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined
  },
}
