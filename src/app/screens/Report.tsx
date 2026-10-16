import { useMemo } from 'react'
import { branchesForDeal, shadowForDeal } from '../../core/next-round'
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
import { ChartFrame } from '../components/ChartFrame'
import { dollars, percent, shares } from '../components/format'
import { AllExplainers, ExplainDrawer } from '../components/ExplainDrawer'
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
  const shadow = useMemo(() => {
    try {
      return { branches: branchesForDeal(deal), result: shadowForDeal(deal), error: null }
    } catch (error) {
      return {
        branches: deal.nextRoundBranches ?? [],
        result: null,
        error: error instanceof Error ? error.message : 'Follow-on calculation unavailable.',
      }
    }
  }, [deal])
  const round = waterfall.round
  const settledPost = waterfall.settledPost
  const regimes = waterfall.postRegimes
  const finiteBreaks = regimes
    .map((regime) => regime.from)
    .filter((value) => Number.isFinite(value))
  const chartRows: Array<{ exit: number } & Record<string, number>> =
    settledPost === null
      ? []
      : [...new Set([0, ...finiteBreaks, exitValue])]
          .sort((a, b) => a - b)
          .map((exit) => {
            const payouts = payoutsAt(settledPost, exit)
            return { exit, ...payouts.byClass, ...payouts.byGrant }
          })
  const payoutIds =
    settledPost === null
      ? []
      : [
          ...settledPost.classes.map((cls) => cls.id),
          ...settledPost.grants.map((grant) => grant.id),
        ]
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
          <ExplainDrawer screen="report" />
          <button type="button" className="quiet-button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="quiet-button" onClick={() => exportDeal(deal)}>
            Export deal JSON
          </button>
        </div>
      </div>
      <section>
        <h3>Follow-On Assumptions</h3>
        <p>
          {deal.nextRoundBranches ? 'Saved assumptions' : 'Illustrative branches'}. The ordinary
          frontier evaluates one round; this separate shadow weights follow-on outcomes. CRRA
          combines weighted utilities before certainty equivalents.
        </p>
        <table>
          <thead>
            <tr>
              <th>ID / Label</th>
              <th>Probability / Pro-Rata</th>
              <th>Exact Round Terms</th>
            </tr>
          </thead>
          <tbody>
            {shadow.branches.map((branch) => (
              <tr key={branch.id}>
                <td>
                  {branch.id} / {branch.label}
                </td>
                <td>
                  {branch.probability} / {branch.proRata ? 'yes' : 'no'}
                </td>
                <td>{JSON.stringify(branch.terms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shadow.result ? (
          <>
            <p>
              One round: founder {dollars(shadow.result.singleRound.uF)}, investor{' '}
              {dollars(shadow.result.singleRound.uI)}. Branch weighted:{' '}
              {shadow.result.point
                ? `founder ${dollars(shadow.result.point.uF)}, investor ${dollars(shadow.result.point.uI)}`
                : 'Unavailable until every named branch constructs.'}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Branch / ID</th>
                  <th>Accepted Weight</th>
                  <th>Founder</th>
                  <th>Investor</th>
                  <th>Ownership Before / After</th>
                  <th>Pro-Rata Investment</th>
                </tr>
              </thead>
              <tbody>
                {shadow.result.branches.map((branch) => (
                  <tr key={branch.branchId}>
                    <th>
                      {branch.label} / {branch.branchId}
                    </th>
                    <td>
                      {shadow.branches.find((item) => item.id === branch.branchId)?.probability}
                    </td>
                    {branch.failed ? (
                      <td colSpan={4}>Invalid: {branch.failed}</td>
                    ) : (
                      <>
                        <td>{dollars(branch.founderValue)}</td>
                        <td>{dollars(branch.investorValue)}</td>
                        <td>
                          {percent(branch.investorOwnershipBefore)} /{' '}
                          {percent(branch.investorOwnershipAfter)}
                        </td>
                        <td>{dollars(branch.proRataInvestment)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p role="status">{shadow.error}</p>
        )}
      </section>
      <section>
        <h3>1. Deal summary header</h3>
        <p>
          <strong>{deal.name}</strong> ·{' '}
          {deal.terms.preMoney === undefined
            ? `direct PPS ${dollars(deal.terms.pricedPerShare ?? 0)}`
            : `pre-money ${dollars(deal.terms.preMoney)}`}{' '}
          · investment {dollars(deal.terms.investment)} · pool {percent(deal.terms.poolTargetPost)}{' '}
          · {deal.terms.prefMultiple}x · {deal.terms.participation} · {deal.terms.seniority}
        </p>
        {deal.yearsToExit > 0 && <p>Exit accrual clock: {deal.yearsToExit} years.</p>}
        {deal.discounting !== null && (
          <p>
            Frontier values are present-valued at {percent(deal.discounting.annualRate)} for{' '}
            {deal.discounting.yearsToExit} years.
          </p>
        )}
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
        {settledPost !== null && (
          <ChartFrame
            title="Waterfall payout profile"
            chart={
              <div className="report-chart">
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chartRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="exit" hide />
                    <YAxis hide />
                    {finiteBreaks.map((value) => (
                      <ReferenceLine key={value} x={value} stroke="#D55E00" strokeDasharray="4 3" />
                    ))}
                    {payoutIds.map((id, index) => (
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
            }
            table={
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Exit</th>
                      {payoutIds.map((id) => (
                        <th key={id}>{id}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {chartRows.map((row) => (
                      <tr key={row.exit}>
                        <td>{dollars(row.exit)}</td>
                        {payoutIds.map((id) => (
                          <td key={id}>{dollars(row[id] ?? 0)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
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
          <ChartFrame
            title="Utility frontier"
            chart={
              <div className="report-chart">
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart>
                    <CartesianGrid />
                    <XAxis type="number" dataKey="uF" domain={[0, maxF]} hide />
                    <YAxis type="number" dataKey="uI" domain={[0, maxI]} hide />
                    <Tooltip formatter={(value) => dollars(Number(value))} />
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
            }
            table={
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Founder utility</th>
                      <th>Investor utility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.points.map((point) => (
                      <tr key={point.pkg.index}>
                        <td>#{point.pkg.index}</td>
                        <td>{dollars(point.uF)}</td>
                        <td>{dollars(point.uI)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
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
                  <td>{(point as DealPoint | null)?.pkg.index ?? 'current offer'}</td>
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
