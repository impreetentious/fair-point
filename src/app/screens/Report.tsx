import { PRODUCT_NAME } from '../branding'
import { dollars, percent, shares } from '../components/format'
import { AllExplainers } from '../components/ExplainDrawer'
import { useFrontierAnalysis, useWaterfallAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'

const NON_CASH = [
  ['Board composition', 'Who controls the board after this round, and which decisions need the investor director’s consent?'],
  ['Founder vesting', 'Does the deal reset vesting; is acceleration single or double trigger on acquisition?'],
  ['No-shop', 'How long are you barred from talking to others, and when does the clock start?'],
  ['Pro-rata rights', 'Who may buy into the next round, and how much is pre-committed?'],
  ['Information rights', 'What reporting are you promising, how often, and to whom?'],
  ['Drag-along and protective provisions', 'Which sale or financing decisions can be forced, and which vetoed?'],
]

export function ReportScreen() {
  const deal = useDealStore((state) => state.deal)
  const exitValue = useDealStore((state) => state.exitValue)
  const waterfall = useWaterfallAnalysis(deal, exitValue)
  const frontier = useFrontierAnalysis(deal)
  const round = waterfall.round
  return <section className="report"><div className="section-heading"><div><p className="eyebrow">Printable summary</p><h2>Report</h2></div><button type="button" className="quiet-button" onClick={() => window.print()}>Print</button></div><section><h3>1. Deal summary</h3><p><strong>{deal.name}</strong> · pre-money {dollars(deal.terms.preMoney ?? 0)} · investment {dollars(deal.terms.investment)} · pool {percent(deal.terms.poolTargetPost)} · {deal.terms.prefMultiple}× · {deal.terms.participation} · {deal.terms.seniority}</p>{round !== null && <p>PPS {dollars(round.diagnostics.pps)} · investor ownership {percent(round.diagnostics.investorPct)} · new pool {shares(round.diagnostics.poolIncrease)} shares</p>}</section><section><h3>2. Waterfall snapshot</h3><p>Selected exit: {dollars(exitValue)}. {waterfall.payout === null ? 'No settlement available.' : 'Settlement is conserved to the selected exit value.'}</p>{waterfall.payout !== null && <ul>{Object.entries(waterfall.payout.byClass).map(([id, value]) => <li key={id}>{id}: {dollars(value)}</li>)}</ul>}</section><section><h3>3. Frontier snapshot</h3>{frontier.result === null ? <p>Frontier unavailable.</p> : <p>{frontier.result.points.length} packages evaluated; {frontier.result.frontier.length} are on the frontier; ZOPA is {frontier.result.zopa ? 'present' : 'empty'}.</p>}</section><section><h3>4. Offer vs. fair points</h3>{frontier.result === null ? null : <table><thead><tr><th>Point</th><th>Package</th></tr></thead><tbody><tr><td>Current</td><td>Exact current terms</td></tr><tr><td>Nash</td><td>#{frontier.result.nash ?? '—'}</td></tr><tr><td>Kalai–Smorodinsky (discrete)</td><td>#{frontier.result.ks ?? '—'}</td></tr></tbody></table>}</section><section><h3>5. Value on the table</h3>{frontier.value === null ? <p>Unavailable.</p> : <p>{dollars(frontier.value.headline)} jointly; founder ceiling {dollars(frontier.value.gainF)}, investor ceiling {dollars(frontier.value.gainI)}. Top packages: {frontier.value.dominating.join(', ') || 'none'}.</p>}</section><section><h3>6. Non-cash terms checklist</h3><ul>{NON_CASH.map(([title, detail]) => <li key={title}><strong>{title}</strong> — {detail}</li>)}</ul></section><section><h3>7. Educational disclaimer</h3><p className="disclaimer">{PRODUCT_NAME} is an educational instrument. It is not legal, financial, or investment advice.</p></section><AllExplainers /></section>
}
