import { EXAMPLE_DECKS } from '../data/examples'
import { shares } from '../components/format'
import { ValidationPanel } from '../components/ValidationPanel'
import { useDealStore } from '../state/store'

export function CapTableScreen() {
  const deal = useDealStore((state) => state.deal)
  const validation = useDealStore((state) => state.validation)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const loadExample = useDealStore((state) => state.loadExample)
  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading"><div><p className="eyebrow">Inputs</p><h2>Cap table</h2></div><label>Example deck<select aria-label="Load example deck" value="" onChange={(event) => loadExample(event.target.value)}><option value="" disabled>Load an example</option>{EXAMPLE_DECKS.map((example) => <option key={example.id} value={example.id}>{example.label}</option>)}</select></label></div>
        <p className="muted">Classes and issued grants are the pre-round ownership record. All changes are schema-checked before they become the active analysis.</p>
        <div className="table-wrap"><table><thead><tr><th>Class</th><th>Kind</th><th>Holder</th><th>Shares</th><th>Invested</th><th>Tier</th></tr></thead><tbody>{deal.pre.classes.map((cls) => <tr key={cls.id}><td>{cls.name}</td><td>{cls.kind}</td><td>{cls.holder}</td><td><input aria-label={`${cls.name} shares`} type="number" min="0" value={cls.shares} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, classes: current.pre.classes.map((candidate) => candidate.id === cls.id ? { ...candidate, shares: Number(event.target.value) } : candidate) } }))} /></td><td>{cls.kind === 'PREFERRED' ? shares(cls.invested) : '—'}</td><td>{cls.kind === 'PREFERRED' ? cls.seniorityTier : '—'}</td></tr>)}</tbody></table></div>
        <div className="table-wrap"><table><thead><tr><th>Issued grant</th><th>Options</th><th>Strike</th><th>Holder</th></tr></thead><tbody>{deal.pre.grants.length === 0 ? <tr><td colSpan={4} className="muted">No issued option grants.</td></tr> : deal.pre.grants.map((grant) => <tr key={grant.id}><td>{grant.id}</td><td>{shares(grant.options)}</td><td>{grant.strike}</td><td>{grant.holder}</td></tr>)}</tbody></table></div>
        <div className="field-grid"><label>Unissued pool<input type="number" min="0" value={deal.pre.poolAvailable} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, poolAvailable: Number(event.target.value) } }))} /></label><label>Promised options<input type="number" min="0" value={deal.pre.promisedOptions} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, promisedOptions: Number(event.target.value) } }))} /></label></div>
      </div>
      <div className="side-panel"><ValidationPanel messages={validation} /><p className="callout">Unissued pool and promised options count for pricing, but receive no exit payout.</p></div>
    </section>
  )
}
