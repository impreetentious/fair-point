import { EXAMPLE_DECKS } from '../data/examples'
import { dollars, shares } from '../components/format'
import { ValidationPanel } from '../components/ValidationPanel'
import { analyzeEmployeeOffer } from '../../core/employee-offer'
import { useDealStore } from '../state/store'
import { useMemo, useState } from 'react'

export function CapTableScreen() {
  const deal = useDealStore((state) => state.deal)
  const validation = useDealStore((state) => state.validation)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const loadExample = useDealStore((state) => state.loadExample)
  const [options, setOptions] = useState(100_000)
  const [strike, setStrike] = useState(0.01)
  const [cash, setCash] = useState(150_000)
  const offer = useMemo(() => {
    try {
      return {
        result: analyzeEmployeeOffer({
          pre: deal.pre,
          safes: deal.safes,
          notes: deal.notes,
          terms: deal.terms,
          grant: { id: 'offer-preview', options, strike, holder: 'OTHER', instrument: 'OPTION' },
          beliefs: deal.founderBeliefs,
          cashAlternative: cash,
          yearsToExit: deal.yearsToExit,
          discounting: deal.discounting,
        }),
        error: null as string | null,
      }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : 'Offer analysis failed' }
    }
  }, [cash, deal, options, strike])
  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading"><div><p className="eyebrow">Inputs</p><h2>Cap table</h2></div><label>Example deck<select aria-label="Load example deck" value="" onChange={(event) => loadExample(event.target.value)}><option value="" disabled>Load an example</option>{EXAMPLE_DECKS.map((example) => <option key={example.id} value={example.id}>{example.label}</option>)}</select></label></div>
        <p className="muted">Classes and issued grants are the pre-round ownership record. All changes are schema-checked before they become the active analysis.</p>
        <div className="table-wrap"><table><thead><tr><th>Class</th><th>Kind</th><th>Holder</th><th>Shares</th><th>Invested</th><th>Tier</th></tr></thead><tbody>{deal.pre.classes.map((cls) => <tr key={cls.id}><td>{cls.name}</td><td>{cls.kind}</td><td>{cls.holder}</td><td><input aria-label={`${cls.name} shares`} type="number" min="0" value={cls.shares} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, classes: current.pre.classes.map((candidate) => candidate.id === cls.id ? { ...candidate, shares: Number(event.target.value) } : candidate) } }))} /></td><td>{cls.kind === 'PREFERRED' ? shares(cls.invested) : '—'}</td><td>{cls.kind === 'PREFERRED' ? cls.seniorityTier : '—'}</td></tr>)}</tbody></table></div>
        <div className="table-wrap"><table><thead><tr><th>Issued grant</th><th>Options</th><th>Strike</th><th>Holder</th></tr></thead><tbody>{deal.pre.grants.length === 0 ? <tr><td colSpan={4} className="muted">No issued option grants.</td></tr> : deal.pre.grants.map((grant) => <tr key={grant.id}><td>{grant.id}</td><td>{shares(grant.options)}</td><td>{grant.strike}</td><td>{grant.holder}</td></tr>)}</tbody></table></div>
        <div className="field-grid"><label>Unissued pool<input aria-label="Unissued pool" type="number" min="0" value={deal.pre.poolAvailable} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, poolAvailable: Number(event.target.value) } }))} /></label><label>Promised options<input aria-label="Promised options" type="number" min="0" value={deal.pre.promisedOptions} onChange={(event) => patchDeal((current) => ({ ...current, pre: { ...current.pre, promisedOptions: Number(event.target.value) } }))} /></label></div>
        <div className="section-heading" style={{ marginTop: '1.5rem' }}><div><p className="eyebrow">Extension</p><h3>Employee offer analyzer</h3></div></div>
        <p className="muted">Same waterfall engine — models a candidate grant from the post-round pool against founder beliefs and an optional cash alternative.</p>
        <div className="field-grid">
          <label>Options<input aria-label="Offer options" type="number" min="0" value={options} onChange={(event) => setOptions(Number(event.target.value))} /></label>
          <label>Strike<input aria-label="Offer strike" type="number" min="0" step="0.01" value={strike} onChange={(event) => setStrike(Number(event.target.value))} /></label>
          <label>Cash alternative<input aria-label="Cash alternative" type="number" min="0" value={cash} onChange={(event) => setCash(Number(event.target.value))} /></label>
        </div>
        {offer.error !== null ? <p className="validation invalid">{offer.error}</p> : offer.result !== null && (
          <dl className="metric-list">
            <dt>Expected value</dt><dd>{dollars(offer.result.expectedValue)}</dd>
            <dt>P50 payout</dt><dd>{dollars(offer.result.p50)}</dd>
            <dt>Surplus vs cash</dt><dd>{dollars(offer.result.surplusVsCash)}</dd>
          </dl>
        )}
      </div>
      <div className="side-panel"><ValidationPanel messages={validation} /><p className="callout">Unissued pool and promised options count for pricing, but receive no exit payout.</p></div>
    </section>
  )
}
