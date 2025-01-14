import { useMemo } from 'react'
import { fitLognormal, mixtureQuantile } from '../../core/distributions'
import { ChartFrame } from '../components/ChartFrame'
import { dollars, percent } from '../components/format'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { useDealStore } from '../state/store'
import type { Beliefs } from '../../core/schema'

const PRESETS: { label: string; beliefs: Beliefs }[] = [
  { label: 'Seed', beliefs: { p0: 0.5, p50: 40_000_000, p90: 400_000_000 } },
  { label: 'Series A', beliefs: { p0: 0.35, p50: 80_000_000, p90: 600_000_000 } },
  { label: 'Series B', beliefs: { p0: 0.25, p50: 150_000_000, p90: 900_000_000 } },
]

function BeliefCard({ party }: { party: 'founder' | 'investor' }) {
  const deal = useDealStore((state) => state.deal)
  const setBeliefs = useDealStore((state) => state.setBeliefs)
  const beliefs = party === 'founder' ? deal.founderBeliefs : deal.investorBeliefs
  const label = party === 'founder' ? 'Founder' : 'Investor'
  const fit = useMemo(() => { try { return fitLognormal(beliefs) } catch { return null } }, [beliefs])
  const edit = (field: keyof Beliefs) => (event: React.ChangeEvent<HTMLInputElement>) => setBeliefs(party, { ...beliefs, [field]: Number(event.target.value) })
  const chartRows = [0.25, 0.5, 0.75].map((p) => ({ percentile: `P${p * 100} (if not zero)`, value: mixtureQuantile(beliefs, beliefs.p0 + (1 - beliefs.p0) * p) }))
  return <article className="belief-card"><h3>{label} beliefs</h3><div className="field-grid"><label>Failure probability<input type="number" min="0" max="0.99" step="0.01" value={beliefs.p0} onChange={edit('p0')} /></label><label>P50 (if not zero)<input type="number" min="1" value={beliefs.p50} onChange={edit('p50')} /></label><label>P90 (if not zero)<input type="number" min="1" value={beliefs.p90} onChange={edit('p90')} /></label></div>{fit !== null && <><p className="muted">Fitted μ {fit.mu.toFixed(3)} · σ {fit.sigma.toFixed(3)} · failure mass {percent(beliefs.p0)}</p>{fit.warnings.map((warning) => <p className="validation invalid" key={warning}>{warning}</p>)}</>}<ChartFrame title={`${label} conditional percentiles`} chart={<div className="stat-row">{chartRows.map((row) => <div key={row.percentile}><strong>{row.percentile}</strong><span>{dollars(row.value)}</span></div>)}</div>} table={<table><thead><tr><th>Conditional percentile</th><th>Exit</th></tr></thead><tbody>{chartRows.map((row) => <tr key={row.percentile}><td>{row.percentile}</td><td>{dollars(row.value)}</td></tr>)}</tbody></table>} /></article>
}

export function BeliefsScreen() {
  const deal = useDealStore((state) => state.deal)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const setBeliefs = useDealStore((state) => state.setBeliefs)
  return <section className="main-panel"><div className="section-heading"><div><p className="eyebrow">Uncertainty</p><h2>Beliefs</h2></div><ExplainDrawer screen="beliefs" /></div><p className="muted">Percentiles describe successful outcomes only; the failure mass is modeled separately at zero.</p><label className="toggle"><input type="checkbox" checked={deal.sharedBeliefs} onChange={(event) => patchDeal((current) => ({ ...current, sharedBeliefs: event.target.checked, investorBeliefs: event.target.checked ? current.founderBeliefs : current.investorBeliefs }))} />Use the same beliefs for both parties</label><div className="preset-row"><span>Illustrative defaults — edit to your view:</span>{PRESETS.map((preset) => <button key={preset.label} type="button" className="quiet-button" onClick={() => setBeliefs('founder', preset.beliefs)}>{preset.label}</button>)}</div><div className="belief-grid"><BeliefCard party="founder" /><BeliefCard party="investor" /></div></section>
}
