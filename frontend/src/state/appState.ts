// Every piece of view state that a user might want to share or come back to, with validation.
import { useSyncExternalStore } from 'react'
import { parsers, useUrlParam } from './urlState'

export const TABS = ['decision', 'accuracy', 'explorer'] as const
export type Tab = (typeof TABS)[number]
export const CUTOFFS = ['08:00', '09:00', '10:00', '11:00', '12:00', '14:00'] as const
export type Cutoff = (typeof CUTOFFS)[number]

export const useTab = () => useUrlParam<Tab>({ key: 'tab', fallback: 'decision', parse: parsers.oneOf(TABS) }, { push: true })
export const useCutoff = () => useUrlParam<Cutoff>({ key: 'cutoff', fallback: '11:00', parse: parsers.oneOf(CUTOFFS) })
export const useDecisionDay = () => useUrlParam<string>({ key: 'day', fallback: '2026-01-15', parse: parsers.isoDate })
export const useExplorerStart = () => useUrlParam<string>({ key: 'from', fallback: '2026-01-12', parse: parsers.isoDate })
export const useExplorerEnd = () => useUrlParam<string>({ key: 'to', fallback: '2026-01-18', parse: parsers.isoDate })
export const useHorizon = () => useUrlParam<number>({ key: 'h', fallback: 24, parse: parsers.intInRange(0, 48) })

const mq = () => window.matchMedia('(prefers-color-scheme: dark)')
/** Follows the OS theme live; used where colours are computed in JS (the heatmap). */
export function useColorMode(): 'light' | 'dark' {
  return useSyncExternalStore(
    (cb) => {
      const m = mq()
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => (mq().matches ? 'dark' : 'light'),
    () => 'light',
  )
}
