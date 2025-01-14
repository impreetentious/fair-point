import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartFrame } from '../components/ChartFrame'
import { dollars } from '../components/format'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { payoutsAt } from '../../core/waterfall'
import { useWaterfallAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'

export function WaterfallScreen() {
  const deal = useDealStore((state) => state.deal)
  const exitValue = useDealStore((state) => state.exitValue)
  const setExitValue = useDealStore((state) => state.setExitValue)
  const { round, postRegimes, payout, error } = useWaterfallAnalysis(deal, exitValue)
  const ids = round?.post.classes.map((cls) => cls.id) ?? []
  const chartRows = round === null ? [] : postRegimes.filter((regime) => Number.isFinite(regime.from)).map((regime) => ({ exit: regime.from, ...payoutsAt(round.post, regime.from).byClass }))
  return (
    <section className="screen-grid">
      <div className="main-panel"><div className="section-heading"><div><p className="eyebrow">Exit physics</p><h2>Waterfall</h2></div><ExplainDrawer screen="waterfall" /></div>
        <div className="field-grid"><label>Exit value<input type="number" min="0" value={exitValue} onChange={(event) => setExitValue(Number(event.target.value))} /></label><label>Exit slider<input type="range" min="0" max="500000000" step="100000" value={Math.min(exitValue, 500000000)} onChange={(event) => setExitValue(Number(event.target.value))} /></label><button type="button" className="quiet-button" onClick={() => setExitValue(0)}>Set exit to 0</button></div>
        {error !== null ? <p className="validation invalid">{error}</p> : <>
          {round !== null && <ChartFrame title="Payout regimes" chart={<div className="chart"><ResponsiveContainer width="100%" height={280}><AreaChart data={chartRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="exit" tickFormatter={dollars} /><YAxis tickFormatter={dollars} /><Tooltip formatter={(value: number) => dollars(value)} labelFormatter={(value) => dollars(Number(value))} /><Legend />{ids.map((id, index) => <Area key={id} dataKey={id} stackId="payout" fill={['#0072B2', '#E69F00', '#009E73', '#CC79A7'][index % 4]} stroke="none" />)}</AreaChart></ResponsiveContainer></div>} table={<div className="table-wrap"><table><thead><tr><th>Breakpoint</th><th>Event</th></tr></thead><tbody>{postRegimes.map((regime) => <tr key={regime.from}><td>{Number.isFinite(regime.from) ? dollars(regime.from) : '∞'}</td><td>{regime.event || 'Initial regime'}</td></tr>)}</tbody></table></div>} />}
          {payout !== null && <><h3>Payout at {dollars(exitValue)}</h3><p className="conservation">Σ payouts = {dollars(exitValue)} ✓</p><div className="table-wrap"><table><thead><tr><th>Holder class</th><th>Path</th><th>Payout</th></tr></thead><tbody>{Object.entries(payout.byClass).map(([id, value]) => <tr key={id}><td>{id}</td><td>{payout.pathTaken[id]}</td><td>{dollars(value)}</td></tr>)}</tbody></table></div><p className="muted">Strike cash paid: {dollars(payout.strikeCashPaid)}. Grant payouts are net of strike.</p></>}
        </>}</div>
      <aside className="side-panel"><h3>Breakpoints</h3><ol className="plain-list">{postRegimes.map((regime) => <li key={`${regime.from}-${regime.event}`}>{Number.isFinite(regime.from) ? dollars(regime.from) : '∞'} — {regime.event || 'start'}</li>)}</ol></aside>
    </section>
  )
}
