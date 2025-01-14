import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartFrame } from '../components/ChartFrame'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { dollars } from '../components/format'
import { useFrontierAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'

export function FrontierScreen() {
  const deal = useDealStore((state) => state.deal)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const toggleCompare = useDealStore((state) => state.toggleCompare)
  const compare = useDealStore((state) => state.compare)
  const analysis = useFrontierAnalysis(deal)
  if (analysis.error !== null || analysis.result === null || analysis.current === null || analysis.value === null) {
    return <section className="main-panel"><h2>Frontier</h2><p className="validation invalid">{analysis.error}</p></section>
  }
  const { result, value, current } = analysis
  const selected = new Set(compare)
  const frontier = new Set(result.frontier)
  const markerPoints = [result.nash, result.ks, result.egalitarian, result.utilitarian]
    .filter((index): index is number => index !== null)
    .map((index) => result.points.find((point) => point.pkg.index === index))
    .filter((point): point is NonNullable<typeof point> => point !== undefined)
  const showCrossBeliefs = !deal.sharedBeliefs
  return (
    <section className="main-panel">
      <div className="section-heading"><div><p className="eyebrow">Bargaining</p><h2>Frontier</h2></div><ExplainDrawer screen="frontier" /></div>
      <div className="field-grid">
        <label>Founder BATNA<input type="number" min="0" value={deal.disagreement.dF} onChange={(event) => patchDeal((candidate) => ({ ...candidate, disagreement: { ...candidate.disagreement, dF: Number(event.target.value) } }))} /></label>
        <label>Investor BATNA<input type="number" min="0" value={deal.disagreement.dI} onChange={(event) => patchDeal((candidate) => ({ ...candidate, disagreement: { ...candidate.disagreement, dI: Number(event.target.value) } }))} /></label>
        <label className="toggle"><input type="checkbox" checked={deal.risk !== null} onChange={(event) => patchDeal((candidate) => ({ ...candidate, risk: event.target.checked ? { gamma: 0.5, w0F: 250000, w0I: 250000 } : null }))} />CRRA mode</label>
      </div>
      <p className="muted">Recomputed {result.points.length} valid packages in {analysis.elapsed.toFixed(1)} ms. {result.metric === 'CE' ? 'Coordinates are certainty-equivalent dollars.' : 'Coordinates are expected dollars.'}</p>
      {!result.zopa ? <p className="empty-state">No zone of agreement at these BATNAs — lower a BATNA or widen the deal space.</p> : <>
        <div className="value-card"><strong>This offer leaves {dollars(value.headline)} on the table jointly.</strong><span>Best case for you {dollars(value.gainF)}; best case for them {dollars(value.gainI)}. These can be different packages.</span></div>
        <ChartFrame
          title="All evaluated packages"
          chart={<div className="chart"><ResponsiveContainer width="100%" height={320}><ScatterChart><CartesianGrid /><XAxis type="number" dataKey="uF" name="Founder" tickFormatter={dollars} /><YAxis type="number" dataKey="uI" name="Investor" tickFormatter={dollars} /><Tooltip formatter={(value: number) => dollars(value)} /><Scatter data={result.points} fill="#56B4E9" /><Scatter data={markerPoints} fill="#D55E00" /><Scatter data={[current]} fill="#009E73" /></ScatterChart></ResponsiveContainer></div>}
          table={<div className="table-wrap"><table><thead><tr><th>#</th><th>Founder</th><th>Investor</th>{showCrossBeliefs && <><th>Founder under investor beliefs</th><th>Investor under founder beliefs</th></>}<th>Frontier</th><th>Pin</th></tr></thead><tbody>{result.points.map((point) => <tr key={point.pkg.index}><td>{point.pkg.index}</td><td>{dollars(point.uF)}</td><td>{dollars(point.uI)}</td>{showCrossBeliefs && <><td>{dollars(point.uF_underI)}</td><td>{dollars(point.uI_underF)}</td></>}<td>{frontier.has(point.pkg.index) ? '●' : ''}</td><td><button type="button" className="quiet-button" onClick={() => toggleCompare(point.pkg.index)}>{selected.has(point.pkg.index) ? 'Unpin' : 'Pin'}</button></td></tr>)}</tbody></table></div>}
        />
        <div className="marker-row"><span>Nash #{result.nash ?? '—'}</span><span>Kalai–Smorodinsky (discrete) #{result.ks ?? '—'}</span><span>Egalitarian #{result.egalitarian ?? '—'}</span><span>Utilitarian #{result.utilitarian ?? '—'}</span><span>Current offer {dollars(current.uF)} / {dollars(current.uI)}</span></div>
        <h3>Compare tray</h3>
        <div className="compare-tray">{compare.length === 0 ? <span className="muted">Pin up to three packages to compare terms and outcomes.</span> : result.points.filter((point) => selected.has(point.pkg.index)).map((point) => <article key={point.pkg.index}><strong>Package #{point.pkg.index}</strong><span>{dollars(point.uF)} / {dollars(point.uI)}</span><span>{dollars(point.pkg.terms.preMoney ?? 0)} pre-money · {point.pkg.terms.prefMultiple}× · {point.pkg.terms.participation}</span></article>)}</div>
      </>}
    </section>
  )
}
