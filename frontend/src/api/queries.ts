// Server state lives in React Query: one cache shared by every component, request de-duplication,
// abort on unmount, and previous data kept on screen while the next request is in flight.
// The data is an immutable snapshot, so nothing ever goes stale within a session.
import { keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiGet } from './client'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: false } },
})

export const keys = {
  meta: ['meta'] as const,
  decision: (day: string, cutoff: string) => ['decision', day, cutoff] as const,
  evolution: (day: string) => ['evolution', day] as const,
  accuracy: (cutoff: string) => ['accuracy', cutoff] as const,
  explorer: (start: string, end: string, h: number) => ['explorer', start, end, h] as const,
}

const decisionQuery = (day: string, cutoff: string) => ({
  queryKey: keys.decision(day, cutoff),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiGet('/api/v1/decision', { decision_date: day, cutoff }, signal),
})

export const useMeta = () =>
  useQuery({ queryKey: keys.meta, queryFn: ({ signal }) => apiGet('/api/v1/meta', undefined, signal) })

export const useDecision = (day: string, cutoff: string) =>
  useQuery({ ...decisionQuery(day, cutoff), placeholderData: keepPreviousData })

/** Warm the cache for the neighbouring days so stepping with ←/→ is instant. */
export function usePrefetchDecisions(days: string[], cutoff: string) {
  const qc = useQueryClient()
  const key = days.join(',')
  useEffect(() => {
    for (const d of days) void qc.prefetchQuery(decisionQuery(d, cutoff))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cutoff, qc])
}

export const useEvolution = (deliveryDay: string | undefined) =>
  useQuery({
    queryKey: keys.evolution(deliveryDay ?? ''),
    queryFn: ({ signal }) => apiGet('/api/v1/evolution', { delivery_date: deliveryDay! }, signal),
    enabled: !!deliveryDay,
    placeholderData: keepPreviousData,
  })

export const useAccuracy = (cutoff: string) =>
  useQuery({
    queryKey: keys.accuracy(cutoff),
    queryFn: ({ signal }) => apiGet('/api/v1/accuracy', { cutoff }, signal),
    placeholderData: keepPreviousData,
  })

export const useExplorer = (start: string, end: string, horizon: number, enabled: boolean) =>
  useQuery({
    queryKey: keys.explorer(start, end, horizon),
    queryFn: ({ signal }) => apiGet('/api/v1/forecast', { start, end, horizon_h: horizon }, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
