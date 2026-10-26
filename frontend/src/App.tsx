import { lazy, Suspense } from 'react'
import { useMeta } from './api/queries'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Loading } from './components/ui'
import { CUTOFFS, TABS, useCutoff, useTab, type Tab } from './state/appState'

// Pages are code-split: the first paint only downloads the shell and the page being viewed.
const DecisionPage = lazy(() => import('./pages/DecisionPage'))
const AccuracyPage = lazy(() => import('./pages/AccuracyPage'))
const ExplorerPage = lazy(() => import('./pages/ExplorerPage'))

const LABELS: Record<Tab, string> = {
  decision: 'Day-ahead decision',
  accuracy: 'Forecast accuracy',
  explorer: 'Forecast explorer',
}

export default function App() {
  const [tab, setTab] = useTab()
  const [cutoff, setCutoff] = useCutoff()
  const meta = useMeta()

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <div className="brand-name">Wind Forecast Monitor</div>
            <div className="brand-sub">GB national wind · day-ahead procurement · January 2026</div>
          </div>
        </div>
        <label className="cutoff">
          Decision cut-off (day before)
          <select value={cutoff} onChange={(e) => setCutoff(e.target.value as typeof cutoff)}>
            {CUTOFFS.map((c) => (
              <option key={c} value={c}>
                {c}
                {c === '11:00' ? ' (auction gate closure)' : ''}
              </option>
            ))}
          </select>
        </label>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {LABELS[t]}
          </button>
        ))}
      </nav>

      <main>
        <ErrorBoundary key={tab}>
          {!meta.data ? (
            <Loading error={meta.error?.message} />
          ) : (
            <Suspense fallback={<Loading />}>
              {tab === 'decision' && <DecisionPage meta={meta.data} cutoff={cutoff} />}
              {tab === 'accuracy' && <AccuracyPage cutoff={cutoff} />}
              {tab === 'explorer' && <ExplorerPage meta={meta.data} />}
            </Suspense>
          )}
        </ErrorBoundary>
      </main>

      <footer>
        Data: Elexon BMRS: FUELHH (actual wind, half-hourly) and WINDFOR (wind forecast, hourly). Times are UK
        time (GMT in January). Snapshot of {meta.data?.forecast_runs ?? '…'} forecast runs · data version{' '}
        {meta.data?.data_version ?? '…'}.
      </footer>
    </div>
  )
}
