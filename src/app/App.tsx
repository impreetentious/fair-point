'use client'

import { useEffect, useMemo, useRef } from 'react'
import { PRODUCT_NAME, PRODUCT_SLUG, PRODUCT_VERSION } from './branding'
import { CapTableScreen } from './screens/CapTable'
import { RoundScreen } from './screens/Round'
import { WaterfallScreen } from './screens/Waterfall'
import { BeliefsScreen } from './screens/Beliefs'
import { FrontierScreen } from './screens/Frontier'
import { LeverageScreen } from './screens/Leverage'
import { ReportScreen } from './screens/Report'
import { screenReadiness } from './readiness'
import { SCREEN_IDS, type ScreenId, useDealStore } from './state/store'

const LABELS: Record<ScreenId, string> = {
  'cap-table': 'Cap Table',
  round: 'Round',
  waterfall: 'Waterfall',
  beliefs: 'Beliefs',
  frontier: 'Frontier',
  leverage: 'Leverage',
  report: 'Report',
}

function ActiveScreen({ screen }: { screen: ScreenId }) {
  if (screen === 'cap-table') return <CapTableScreen />
  if (screen === 'round') return <RoundScreen />
  if (screen === 'waterfall') return <WaterfallScreen />
  if (screen === 'beliefs') return <BeliefsScreen />
  if (screen === 'frontier') return <FrontierScreen />
  if (screen === 'leverage') return <LeverageScreen />
  return <ReportScreen />
}

export function App() {
  const deal = useDealStore((state) => state.deal)
  const screen = useDealStore((state) => state.activeScreen)
  const setScreen = useDealStore((state) => state.setScreen)
  const replaceDeal = useDealStore((state) => state.replaceDeal)
  const importStatus = useDealStore((state) => state.importStatus)
  const readiness = useMemo(() => screenReadiness(deal), [deal])
  const importRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${PRODUCT_SLUG}:v1:autosave`)
      if (saved !== null) {
        replaceDeal(JSON.parse(saved), 'autosave')
      }
    } catch {
      /* Unavailable or invalid local data remains non-authoritative. */
    }
  }, [replaceDeal])
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(`${PRODUCT_SLUG}:v1:autosave`, JSON.stringify(deal))
      } catch {
        /* The in-memory deal remains usable when persistence is unavailable. */
      }
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [deal])
  const exportDeal = () => {
    const blob = new Blob([JSON.stringify(useDealStore.getState().exportSnapshot(), null, 2)], {
      type: 'application/json',
    })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${PRODUCT_SLUG}-deal.json`
    anchor.click()
    URL.revokeObjectURL(href)
  }
  const importDeal = async (file: File | undefined) => {
    if (file === undefined) return
    try {
      const raw = JSON.parse(await file.text()) as unknown
      if (
        raw === null ||
        typeof raw !== 'object' ||
        !('schemaVersion' in raw) ||
        (raw as { schemaVersion?: unknown }).schemaVersion !== '1.0.0'
      ) {
        replaceDeal(
          { schemaVersion: (raw as { schemaVersion?: unknown } | null)?.schemaVersion },
          'import',
        )
        return
      }
      replaceDeal(raw, 'import')
    } catch {
      replaceDeal({ schemaVersion: 'malformed-json' }, 'import')
    }
  }
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>{PRODUCT_NAME}</h1>
          <p>The term-sheet bargaining studio</p>
        </div>
        <div className="header-actions">
          <button type="button" className="quiet-button" onClick={exportDeal}>
            Export deal
          </button>
          <button type="button" className="quiet-button" onClick={() => importRef.current?.click()}>
            Import deal
          </button>
          <input
            ref={importRef}
            aria-label="Import deal file"
            className="visually-hidden"
            type="file"
            accept="application/json"
            onChange={(event) => {
              void importDeal(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </div>
      </header>
      {importStatus !== null && (
        <p className={`import-status ${importStatus.kind}`} role="status">
          {importStatus.message}
        </p>
      )}
      <nav aria-label="Workspace screens">
        {SCREEN_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-screen={id}
            className={screen === id ? 'nav-item active' : 'nav-item'}
            onClick={() => setScreen(id)}
          >
            <span
              className={`readiness-dot ${readiness[id].state}`}
              role="img"
              aria-label={readiness[id].label}
            />
            {LABELS[id]}
          </button>
        ))}
      </nav>
      <ActiveScreen screen={screen} />
      <footer className="disclaimer">
        {PRODUCT_NAME} v{PRODUCT_VERSION} is an educational instrument. It is not legal, financial,
        or investment advice.
      </footer>
    </main>
  )
}
