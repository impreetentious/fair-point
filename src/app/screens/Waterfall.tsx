import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartFrame } from '../components/ChartFrame'
import { dollars, percent } from '../components/format'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { mixtureQuantile } from '../../core/distributions'
import { payoutsAt } from '../../core/waterfall'
import { useWaterfallAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'

function investedCapital(
  post: NonNullable<ReturnType<typeof useWaterfallAnalysis>['round']>['post'],
): number {
  return post.classes.reduce((sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.invested : 0), 0)
}

function postMoneyValue(deal: ReturnType<typeof useDealStore.getState>['deal']): number {
  if (deal.terms.preMoney !== undefined) return deal.terms.preMoney + deal.terms.investment
  return deal.terms.investment
}

function sliderValue(exitValue: number, min: number, max: number): number {
  if (exitValue <= 0) return 0
  return ((Math.log(exitValue) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100
}

function exitFromSlider(value: number, min: number, max: number): number {
  return Math.exp(Math.log(min) + (Number(value) / 100) * (Math.log(max) - Math.log(min)))
}

function badge(event: string, value: number): string {
  if (event.includes('converts')) return `${event} above ${dollars(value)}`
  if (event.includes('cap binds')) return `${event} at ${dollars(value)}`
  if (event.includes('preference fills')) return `${event} at ${dollars(value)}`
  if (event.includes('exercisable')) return `${event} above ${dollars(value)}`
  return event || 'regime change (unclassified)'
}

export function WaterfallScreen() {
  const deal = useDealStore((state) => state.deal)
  const exitValue = useDealStore((state) => state.exitValue)
  const setExitValue = useDealStore((state) => state.setExitValue)
  const { round, postRegimes, payout, error } = useWaterfallAnalysis(deal, exitValue)
  const ids = round?.post.classes.map((cls) => cls.id) ?? []
  const finiteBreaks = postRegimes
    .map((regime) => regime.from)
    .filter((value) => Number.isFinite(value) && value > 0)
  const smallestBreakpoint = Math.min(...finiteBreaks, Infinity)
  const eMin = Math.max(
    100_000,
    Number.isFinite(smallestBreakpoint) ? smallestBreakpoint / 10 : 100_000,
  )
  const beliefCeiling = Math.max(
    mixtureQuantile(deal.founderBeliefs, 0.9),
    mixtureQuantile(deal.investorBeliefs, 0.9),
  )
  const eMax =
    round === null
      ? 500_000_000
      : 10 * Math.max(beliefCeiling, investedCapital(round.post), postMoneyValue(deal), eMin)
  const chartPoints =
    round === null ? [] : [...new Set([0, eMin, ...finiteBreaks, eMax])].sort((a, b) => a - b)
  const chartRows =
    round === null
      ? []
      : chartPoints.map((exit) => ({ exit, ...payoutsAt(round.post, exit).byClass }))
  const totalPayout =
    payout === null
      ? 0
      : Object.values(payout.byClass).reduce((sum, value) => sum + value, 0) +
        Object.values(payout.byGrant).reduce((sum, value) => sum + value, 0)
  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Exit physics</p>
            <h2>Waterfall</h2>
          </div>
          <ExplainDrawer screen="waterfall" />
        </div>
        <div className="field-grid">
          <label>
            Exit value
            <input
              type="number"
              min="0"
              value={exitValue}
              onChange={(event) => setExitValue(Number(event.target.value))}
            />
          </label>
          <label>
            Log exit slider
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={sliderValue(exitValue, eMin, eMax)}
              onChange={(event) =>
                setExitValue(exitFromSlider(Number(event.target.value), eMin, eMax))
              }
            />
          </label>
          <button type="button" className="quiet-button" onClick={() => setExitValue(0)}>
            0
          </button>
        </div>
        <p className="muted">
          Slider range: {dollars(eMin)} to {dollars(eMax)}. The numeric input accepts any
          nonnegative exit.
        </p>
        {error !== null ? (
          <p className="validation invalid">{error}</p>
        ) : (
          <>
            {round !== null && (
              <ChartFrame
                title="Payout regimes"
                chart={
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="exit" tickFormatter={dollars} />
                        <YAxis tickFormatter={dollars} />
                        <Tooltip
                          formatter={(value) => dollars(Number(value))}
                          labelFormatter={(value) => dollars(Number(value))}
                        />
                        <Legend />
                        {finiteBreaks.map((value) => (
                          <ReferenceLine
                            key={value}
                            x={value}
                            stroke="#D55E00"
                            strokeDasharray="4 3"
                            label={{
                              value: badge(
                                postRegimes.find((regime) => regime.from === value)?.event ?? '',
                                value,
                              ),
                              angle: -90,
                              position: 'insideTop',
                            }}
                          />
                        ))}
                        {ids.map((id, index) => (
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
                          <th>Breakpoint</th>
                          <th>Badge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {postRegimes.map((regime) => (
                          <tr key={regime.from}>
                            <td>{Number.isFinite(regime.from) ? dollars(regime.from) : '∞'}</td>
                            <td>{badge(regime.event, regime.from)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}
            {payout !== null && (
              <>
                <h3>Payout at {dollars(exitValue)}</h3>
                <p className="conservation">Σ payouts = E ✓ ({dollars(totalPayout)})</p>
                {payout.strikeCashPaid > 0 && (
                  <p className="muted">
                    Σ gross = E + {dollars(payout.strikeCashPaid)} strike cash paid.
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Holder</th>
                        <th>Path</th>
                        <th>Payout</th>
                        <th>% of E</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(payout.byClass).map(([id, value]) => (
                        <tr key={id}>
                          <td>{id}</td>
                          <td>{payout.pathTaken[id]}</td>
                          <td>{dollars(value)}</td>
                          <td>{exitValue === 0 ? '—' : percent(value / exitValue)}</td>
                        </tr>
                      ))}
                      {Object.entries(payout.byGrant).map(([id, value]) => (
                        <tr key={id}>
                          <td>{id}</td>
                          <td>GRANT</td>
                          <td>{dollars(value)}</td>
                          <td>{exitValue === 0 ? '—' : percent(value / exitValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <aside className="side-panel">
        <h3>Breakpoint badges</h3>
        <ol className="plain-list">
          {postRegimes.map((regime) => (
            <li key={`${regime.from}-${regime.event}`}>
              {Number.isFinite(regime.from) ? dollars(regime.from) : '∞'} —{' '}
              {badge(regime.event, regime.from)}
            </li>
          ))}
        </ol>
      </aside>
    </section>
  )
}
