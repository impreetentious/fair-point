import { dollars, percent, shares } from '../components/format'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { useRoundAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'

export function RoundScreen() {
  const deal = useDealStore((state) => state.deal)
  const setTerms = useDealStore((state) => state.setTerms)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const { round, error } = useRoundAnalysis(deal)
  const terms = deal.terms
  const setNumber = (field: 'preMoney' | 'investment') => (event: React.ChangeEvent<HTMLInputElement>) => setTerms({ ...terms, [field]: Number(event.target.value) })
  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading"><div><p className="eyebrow">Terms</p><h2>Round</h2></div><ExplainDrawer screen="round" /></div>
        <div className="field-grid"><label>Pre-money valuation<input type="number" min="1" value={terms.preMoney ?? ''} onChange={setNumber('preMoney')} /></label><label>Investment<input type="number" min="1" value={terms.investment} onChange={setNumber('investment')} /></label><label>Post-round pool target<input type="number" min="0" max="0.4" step="0.005" value={terms.poolTargetPost} onChange={(event) => setTerms({ ...terms, poolTargetPost: Number(event.target.value) })} /></label></div>
        <fieldset><legend>Preference multiple</legend>{[1, 1.5, 2, 3].map((multiple) => <button key={multiple} type="button" className={terms.prefMultiple === multiple ? 'segmented selected' : 'segmented'} onClick={() => setTerms({ ...terms, prefMultiple: multiple as 1 | 1.5 | 2 | 3 })}>{multiple}×</button>)}</fieldset>
        <fieldset><legend>Participation</legend>{(['NONE', 'CAP2', 'CAP3', 'FULL'] as const).map((participation) => { const disabled = (participation === 'CAP2' && terms.prefMultiple >= 2) || (participation === 'CAP3' && terms.prefMultiple >= 3); return <button key={participation} type="button" disabled={disabled} className={terms.participation === participation ? 'segmented selected' : 'segmented'} onClick={() => setTerms({ ...terms, participation })}>{participation}</button> })}</fieldset>
        <fieldset><legend>Seniority</legend>{(['PARI', 'SENIOR'] as const).map((seniority) => <button key={seniority} type="button" className={terms.seniority === seniority ? 'segmented selected' : 'segmented'} onClick={() => setTerms({ ...terms, seniority })}>{seniority === 'PARI' ? 'PARI (join most junior)' : 'SENIOR (new tier 1)'}</button>)}</fieldset>
        <div className="section-heading"><h3>SAFEs</h3><button type="button" className="quiet-button" onClick={() => patchDeal((current) => ({ ...current, safes: [...current.safes, { id: `safe-${current.safes.length + 1}`, name: `SAFE ${current.safes.length + 1}`, amount: 100000, kind: 'POST_MONEY', valuationCap: 1000000, holder: 'OTHER', mfn: false }] }))}>Add SAFE</button></div>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Form</th><th>Amount</th><th>Cap</th><th /></tr></thead><tbody>{deal.safes.length === 0 ? <tr><td colSpan={5} className="muted">No SAFEs in this deal.</td></tr> : deal.safes.map((safe) => <tr key={safe.id}><td>{safe.name}</td><td>{safe.kind}</td><td>{dollars(safe.amount)}</td><td>{safe.valuationCap === undefined ? '—' : dollars(safe.valuationCap)}</td><td><button type="button" className="quiet-button" onClick={() => patchDeal((current) => ({ ...current, safes: current.safes.filter((candidate) => candidate.id !== safe.id) }))}>Remove</button></td></tr>)}</tbody></table></div>
      </div>
      <aside className="side-panel"><h3>Live diagnostics</h3>{error !== null ? <p className="validation invalid">{error}</p> : round !== null && <><dl className="metric-list"><dt>Price per share</dt><dd>{dollars(round.diagnostics.pps)}</dd><dt>Investor ownership</dt><dd>{percent(round.diagnostics.investorPct)}</dd><dt>New pool shares</dt><dd>{shares(round.diagnostics.poolIncrease)}</dd><dt>SAFE shares</dt><dd>{shares(round.diagnostics.safeShares)}</dd></dl><h4>Post-round classes</h4><ul className="plain-list">{round.post.classes.map((cls) => <li key={cls.id}>{cls.name}: {shares(cls.shares)} shares</li>)}</ul></>}</aside>
    </section>
  )
}
