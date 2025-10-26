'use client'

import { useEffect, useRef } from 'react'
import { PRODUCT_NAME, PRODUCT_SLUG } from './branding'
import { CapTableScreen } from './screens/CapTable'
import { RoundScreen } from './screens/Round'
import { WaterfallScreen } from './screens/Waterfall'
import { BeliefsScreen } from './screens/Beliefs'
import { FrontierScreen } from './screens/Frontier'
import { ReportScreen } from './screens/Report'
import { SCREEN_IDS, type ScreenId, useDealStore } from './state/store'

const LABELS: Record<ScreenId, string> = {
  'cap-table': 'Cap Table', round: 'Round', waterfall: 'Waterfall', beliefs: 'Beliefs', frontier: 'Frontier', report: 'Report',
}

function ActiveScreen({ screen }: { screen: ScreenId }) {
  if (screen === 'cap-table') return <CapTableScreen />
  if (screen === 'round') return <RoundScreen />
  if (screen === 'waterfall') return <WaterfallScreen />
  if (screen === 'beliefs') return <BeliefsScreen />
  if (screen === 'frontier') return <FrontierScreen />
  return <ReportScreen />
}

export function App() {
  const deal = useDealStore((state) => state.deal)
  const screen = useDealStore((state) => state.activeScreen)
  const setScreen = useDealStore((state) => state.setScreen)
  const replaceDeal = useDealStore((state) => state.replaceDeal)
  const importRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const saved = window.localStorage.getItem(`${PRODUCT_SLUG}:v1:autosave`)
    if (saved !== null) {
      try { replaceDeal(JSON.parse(saved)) } catch { /* Invalid local data remains non-authoritative. */ }
    }
  }, [replaceDeal])
  useEffect(() => {
    const timeout = window.setTimeout(() => window.localStorage.setItem(`${PRODUCT_SLUG}:v1:autosave`, JSON.stringify(deal)), 500)
    return () => window.clearTimeout(timeout)
  }, [deal])
  const exportDeal = () => {
    const blob = new Blob([JSON.stringify(deal, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${PRODUCT_SLUG}-deal.json`
    anchor.click()
    URL.revokeObjectURL(href)
  }
  const importDeal = async (file: File | undefined) => {
    if (file === undefined) return
    replaceDeal(JSON.parse(await file.text()))
  }
  return (
    <main className="app-shell">
      <header className="app-header"><div><h1>{PRODUCT_NAME}</h1><p>The term-sheet bargaining studio</p></div><div className="header-actions"><button type="button" className="quiet-button" onClick={exportDeal}>Export deal</button><button type="button" className="quiet-button" onClick={() => importRef.current?.click()}>Import deal</button><input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => { void importDeal(event.target.files?.[0]); event.currentTarget.value = '' }} /></div></header>
      <nav aria-label="Workspace screens">{SCREEN_IDS.map((id) => <button key={id} type="button" className={screen === id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(id)}><span className="readiness-dot" aria-hidden="true" />{LABELS[id]}</button>)}</nav>
      <ActiveScreen screen={screen} />
      <footer className="disclaimer">{PRODUCT_NAME} is an educational instrument. It is not legal, financial, or investment advice.</footer>
    </main>
  )
}
