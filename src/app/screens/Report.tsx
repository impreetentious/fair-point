import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PRODUCT_NAME, PRODUCT_SLUG } from '../branding'
import { dollars, percent, shares } from '../components/format'
import { AllExplainers } from '../components/ExplainDrawer'
import { payoutsAt } from '../../core/waterfall'
import { useFrontierAnalysis, useWaterfallAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'
import type { DealPoint, RoundTerms } from '../../core/schema'

const NON_CASH = [
  [
    'Board composition',
    "Who controls the board after this round, and which decisions need the investor director's consent?",
  ],
  ['Founder vesting', 'Does the deal reset your vesting; single or double trigger on acquisition?'],
  ['No-shop', 'How long are you barred from talking to others, and when does the clock start?'],
  ['Pro-rata rights', 'Who may buy into the next round, and how much of it is pre-committed?'],
  ['Information rights', 'What reporting are you promising, how often, and to whom?'],
  [
    'Drag-along & protective provisions',
    'Which sale or financing decisions can be forced, and which vetoed?',
  ],
]

function termDelta(current: RoundTerms, target: RoundTerms): string {
  const pre = (target.preMoney ?? 0) - (current.preMoney ?? 0)
  const pool = target.poolTargetPost - current.poolTargetPost
  return [
    `pre ${pre >= 0 ? '+' : ''}${dollars(pre)}`,
    `pool ${pool >= 0 ? '+' : ''}${percent(pool)}`,
    `${current.prefMultiple}x -> ${target.prefMultiple}x`,
    `${current.participation} -> ${target.participation}`,
  ].join(' · ')
}

function pointByIndex(points: DealPoint[], index: number | null): DealPoint | null {
  return index === null ? null : (points.find((point) => point.pkg.index === index) ?? null)
}

function exportDeal(deal: ReturnType<typeof useDealStore.getState>['deal']) {
  const blob = new Blob([JSON.stringify(deal, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${PRODUCT_SLUG}-deal.json`
  anchor.click()
  URL.revokeObjectURL(href)
}

export function ReportScreen() {
  const deal = useDealStore((state) => state.deal)
  const exitValue = useDealStore((state) => state.exitValue)
  const waterfall = useWaterfallAnalysis(deal, exitValue)
  const frontier = useFrontierAnalysis(deal)
  const round = waterfall.round
  const regimes = waterfall.postRegimes
  const finiteBreaks = regimes
    .map((regime) => regime.from)
    .filter((value) => Number.isFinite(value))
  const chartRows =
    round === null
      ? []
      : [...new Set([0, ...finiteBreaks, exitValue])]
          .sort((a, b) => a - b)
          .map((exit) => ({ exit, ...payoutsAt(round.post, exit).byClass }))
  const classIds = round?.post.classes.map((cls) => cls.id) ?? []
  const result = frontier.result
  const current = frontier.current
  const frontierSet = new Set(result?.frontier ?? [])
  const frontierPoints =
    result?.points
      .filter((point) => frontierSet.has(point.pkg.index))
      .sort((left, right) => left.uF - right.uF) ?? []
  const maxF = Math.max(1, ...(result?.points.map((point) => point.uF) ?? []), current?.uF ?? 0)
  const maxI = Math.max(1, ...(result?.points.map((point) => point.uI) ?? []), current?.uI ?? 0)
  const nash = result === null ? null : pointByIndex(result.points, result.nash)
  const ks = result === null ? null : pointByIndex(result.points, result.ks)
  const topDominating =
    result === null || frontier.value === null
      ? []
      : frontier.value.dominating
          .map((index) => pointByIndex(result.points, index))
          .filter((point): point is DealPoint => point !== null)
  return (
    <section className="report">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Printable summary</p>
          <h2>Report</h2>
        </div>
        <div className="header-actions">
          <button type="button" className="quiet-button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="quiet-button" onClick={() => exportDeal(deal)}>
            Export deal JSON
          </button>
        </div>
      </div>
      <section>
        <h3>1. Deal summary header</h3>
        <p>
          <strong>{deal.name}</strong> · pre-money {dollars(deal.terms.preMoney ?? 0)} · investment{' '}
          {dollars(deal.terms.investment)} · pool {percent(deal.terms.poolTargetPost)} ·{' '}
          {deal.terms.prefMultiple}x · {deal.terms.participation} · {deal.terms.seniority}
        </p>
        {round !== null && (
          <p>
            PPS {dollars(round.diagnostics.pps)} · investor ownership{' '}
            {percent(round.diagnostics.investorPct)} · pool increase{' '}
            {shares(round.diagnostics.poolIncrease)} shares
          </p>
        )}
      </section>
      <section>
        <h3>2. Waterfall snapshot</h3>
        {round !== null && (
          <div className="report-chart">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="exit" hide />
                <YAxis hide />
                {finiteBreaks.map((value) => (
                  <ReferenceLine key={value} x={value} stroke="#D55E00" strokeDasharray="4 3" />
                ))}
                {classIds.map((id, index) => (
                  <Area
                    key={id}
                    dataKey={id}
                    stackId="payout"
                    fill={['#0072B2', '#E69F00', '#009E73', '#CC79A7'][index % 4]}
                    stroke="none"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="badge-list">
          {regimes.map((regime) => (
            <span key={`${regime.from}-${regime.event}`}>
              {Number.isFinite(regime.from) ? dollars(regime.from) : '∞'} {regime.event || 'start'}
            </span>
          ))}
        </div>
        {waterfall.payout !== null && (
          <table>
            <thead>
              <tr>
                <th>Holder</th>
                <th>Path</th>
                <th>$</th>
                <th>% of E</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(waterfall.payout.byClass).map(([id, value]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{waterfall.payout?.pathTaken[id]}</td>
                  <td>{dollars(value)}</td>
                  <td>{exitValue === 0 ? '—' : percent(value / exitValue)}</td>
                </tr>
              ))}
              {Object.entries(waterfall.payout.byGrant).map(([id, value]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>GRANT</td>
                  <td>{dollars(value)}</td>
                  <td>{exitValue === 0 ? '—' : percent(value / exitValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3>3. Frontier snapshot</h3>
        {result === null || current === null ? (
          <p>Frontier unavailable.</p>
        ) : (
          <div className="report-chart">
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart>
                <CartesianGrid />
                <XAxis type="number" dataKey="uF" domain={[0, maxF]} hide />
                <YAxis type="number" dataKey="uI" domain={[0, maxI]} hide />
                <Tooltip formatter={(value: number) => dollars(value)} />
                <ReferenceArea
                  x1={deal.disagreement.dF}
                  x2={maxF}
                  y1={deal.disagreement.dI}
                  y2={maxI}
                  fill="#009E73"
                  fillOpacity={0.08}
                />
                <ReferenceLine x={deal.disagreement.dF} stroke="#555" strokeDasharray="4 3" />
                <ReferenceLine y={deal.disagreement.dI} stroke="#555" strokeDasharray="4 3" />
                <Line
                  data={frontierPoints}
                  type="linear"
                  dataKey="uI"
                  stroke="#000"
                  dot={false}
                  isAnimationActive={false}
                />
                <Scatter data={result.points} fill="#56B4E9" />
                <Scatter data={nash === null ? [] : [nash]} fill="#D55E00" />
                <Scatter data={ks === null ? [] : [ks]} fill="#0072B2" />
                <Scatter
                  data={
                    pointByIndex(result.points, result.egalitarian) === null
                      ? []
                      : [pointByIndex(result.points, result.egalitarian)!]
                  }
                  fill="#009E73"
                />
                <Scatter
                  data={
                    pointByIndex(result.points, result.utilitarian) === null
                      ? []
                      : [pointByIndex(result.points, result.utilitarian)!]
                  }
                  fill="#CC79A7"
                />
                <Scatter data={[current]} fill="#000" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p>
          {result === null
            ? ''
            : `${result.points.length} packages; ${result.frontier.length} frontier; ZOPA ${result.zopa ? 'present' : 'empty'}. Nash ◆ KS ● Egalitarian ▲ Utilitarian ■ Current ★.`}
        </p>
      </section>
      <section>
        <h3>4. Offer vs. fair points</h3>
        {current !== null && (
          <table>
            <thead>
              <tr>
                <th>Point</th>
                <th>Package</th>
                <th>Term deltas</th>
                <th>ΔuF</th>
                <th>ΔuI</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Current', current],
                ['Nash', nash],
                ['KS', ks],
              ].map(([label, point]) => (
                <tr key={label as string}>
                  <td>{label as string}</td>
                  <td>{(point as DealPoint | null)?.pkg.index ?? 'exact current'}</td>
                  <td>
                    {point === current || point === null
                      ? '—'
                      : termDelta(current.pkg.terms, (point as DealPoint).pkg.terms)}
                  </td>
                  <td>{point === null ? '—' : dollars((point as DealPoint).uF - current.uF)}</td>
                  <td>{point === null ? '—' : dollars((point as DealPoint).uI - current.uI)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3>5. Value-on-table callout</h3>
        {frontier.value === null || current === null ? (
          <p>Unavailable.</p>
        ) : (
          <>
            <p>
              {dollars(frontier.value.headline)} jointly; founder ceiling{' '}
              {dollars(frontier.value.gainF)}, investor ceiling {dollars(frontier.value.gainI)}.
            </p>
            <div className="compare-tray">
              {topDominating.length === 0 ? (
                <span className="muted">No dominating package from the current offer.</span>
              ) : (
                topDominating.map((point) => (
                  <article key={point.pkg.index}>
                    <strong>#{point.pkg.index}</strong>
                    <span>{termDelta(current.pkg.terms, point.pkg.terms)}</span>
                    <span>
                      ΔuF {dollars(point.uF - current.uF)} · ΔuI {dollars(point.uI - current.uI)}
                    </span>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </section>
      <section>
        <h3>6. Non-cash terms checklist annex</h3>
        <ul>
          {NON_CASH.map(([title, detail]) => (
            <li key={title}>
              <strong>{title}</strong> — {detail}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>7. Disclaimer</h3>
        <p className="disclaimer">
          {PRODUCT_NAME} is an educational instrument. It is not legal, financial, or investment
          advice.
        </p>
      </section>
      <AllExplainers />
    </section>
  )
}
