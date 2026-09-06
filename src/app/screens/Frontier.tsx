import { useMemo, useState } from 'react'
import {
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
import { ChartFrame } from '../components/ChartFrame'
import { CommitNumber } from '../components/CommitField'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { dollars, percent } from '../components/format'
import { deriveDealSpace } from '../deal-space'
import { constructRound } from '../../core/round'
import { accrueForExit } from '../../core/accruals'
import { presentValue } from '../../core/discounting'
import { crraUtility } from '../../core/mc'
import { payoutQuantile } from '../../core/outcomes'
import { useFrontierAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'
import type { DealPoint, DealSpace, RoundTerms } from '../../core/schema'

const poolChoices = [0.1, 0.125, 0.15, 0.175, 0.2]
const multipleChoices: RoundTerms['prefMultiple'][] = [1, 1.5, 2, 3]
const participationChoices: RoundTerms['participation'][] = ['NONE', 'CAP2', 'CAP3', 'FULL']
const solutionSpecs = [
  ['nash', 'Nash ◆', '#D55E00'] as const,
  ['ks', 'KS ●', '#0072B2'] as const,
  ['egalitarian', 'Egalitarian ▲', '#009E73'] as const,
  ['utilitarian', 'Utilitarian ■', '#CC79A7'] as const,
]
const MC_N = 100_000
const MC_SEED = 0xc0ffee

function termLine(point: DealPoint): string {
  return `${dollars(point.pkg.terms.preMoney ?? 0)} pre · ${percent(point.pkg.terms.poolTargetPost)} pool · ${point.pkg.terms.prefMultiple}x · ${point.pkg.terms.participation}`
}

function termDelta(current: RoundTerms, target: RoundTerms): string {
  const pre = (target.preMoney ?? 0) - (current.preMoney ?? 0)
  const pool = target.poolTargetPost - current.poolTargetPost
  const pieces = [
    `pre ${pre >= 0 ? '+' : ''}${dollars(pre)}`,
    `pool ${pool >= 0 ? '+' : ''}${percent(pool)}`,
  ]
  if (target.prefMultiple !== current.prefMultiple)
    pieces.push(`${current.prefMultiple}x -> ${target.prefMultiple}x`)
  if (target.participation !== current.participation)
    pieces.push(`${current.participation} -> ${target.participation}`)
  return pieces.join(' · ')
}

function pointByIndex(points: DealPoint[], index: number | null): DealPoint | null {
  return index === null ? null : (points.find((point) => point.pkg.index === index) ?? null)
}

function SpaceEditor({ space }: { space: DealSpace }) {
  const deal = useDealStore((state) => state.deal)
  const setDealSpace = useDealStore((state) => state.setDealSpace)
  const pins = deal.ui.dealSpacePins
  const setSpace = (next: DealSpace, pinPatch?: Partial<typeof pins>) =>
    setDealSpace(next, pinPatch)
  const pin = (dimension: keyof typeof pins) => {
    const nextPins = { ...pins, [dimension]: !pins[dimension] }
    setSpace(deriveDealSpace(deal.terms, pins[dimension] ? null : space, nextPins), nextPins)
  }
  const toggleArray = <T,>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
  return (
    <section className="deal-space-editor" aria-label="Deal space editor">
      <div className="section-heading">
        <h3>Deal space</h3>
        <span className="muted">
          {deal.ui.dealSpaceManual ? 'Manually edited' : 'Derived from current offer'}
        </span>
      </div>
      <div className="field-grid">
        <label>
          Pre-money low
          <CommitNumber
            label="Pre-money low"
            value={space.preMoneyRange[0]}
            min={1}
            step={1000}
            onCommit={(value) =>
              value !== undefined &&
              setSpace({ ...space, preMoneyRange: [value, space.preMoneyRange[1]] })
            }
          />
        </label>
        <label>
          Pre-money high
          <CommitNumber
            label="Pre-money high"
            value={space.preMoneyRange[1]}
            min={1}
            step={1000}
            onCommit={(value) =>
              value !== undefined &&
              setSpace({ ...space, preMoneyRange: [space.preMoneyRange[0], value] })
            }
          />
        </label>
        <label>
          Steps
          <CommitNumber
            label="Pre-money steps"
            value={space.preMoneySteps}
            min={1}
            step={1}
            onCommit={(value) =>
              value !== undefined && setSpace({ ...space, preMoneySteps: Math.round(value) })
            }
          />
        </label>
        <button
          type="button"
          className={pins.preMoney ? 'quiet-button selected-inline' : 'quiet-button'}
          onClick={() => pin('preMoney')}
          aria-pressed={pins.preMoney}
        >
          Pin pre-money
        </button>
      </div>
      <fieldset>
        <legend>
          Pools{' '}
          <button
            type="button"
            className={pins.pools ? 'quiet-button selected-inline' : 'quiet-button'}
            onClick={() => pin('pools')}
            aria-pressed={pins.pools}
          >
            Pin
          </button>
        </legend>
        {poolChoices.map((pool) => (
          <label key={pool} className="toggle">
            <input
              type="checkbox"
              checked={space.pools.includes(pool)}
              onChange={() => setSpace({ ...space, pools: toggleArray(space.pools, pool) })}
            />
            {percent(pool)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>
          Multiples{' '}
          <button
            type="button"
            className={pins.multiples ? 'quiet-button selected-inline' : 'quiet-button'}
            onClick={() => pin('multiples')}
            aria-pressed={pins.multiples}
          >
            Pin
          </button>
        </legend>
        {multipleChoices.map((multiple) => (
          <label key={multiple} className="toggle">
            <input
              type="checkbox"
              checked={space.multiples.includes(multiple)}
              onChange={() =>
                setSpace({ ...space, multiples: toggleArray(space.multiples, multiple) })
              }
            />
            {multiple}x
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>
          Participation{' '}
          <button
            type="button"
            className={pins.participations ? 'quiet-button selected-inline' : 'quiet-button'}
            onClick={() => pin('participations')}
            aria-pressed={pins.participations}
          >
            Pin
          </button>
        </legend>
        {participationChoices.map((participation) => (
          <label key={participation} className="toggle">
            <input
              type="checkbox"
              checked={space.participations.includes(participation)}
              onChange={() =>
                setSpace({
                  ...space,
                  participations: toggleArray(space.participations, participation),
                })
              }
            />
            {participation}
          </label>
        ))}
      </fieldset>
      <label>
        Seniority
        <select
          aria-label="Deal-space seniority"
          value={space.seniority}
          onChange={(event) =>
            setSpace({ ...space, seniority: event.target.value as RoundTerms['seniority'] })
          }
        >
          <option>PARI</option>
          <option>SENIOR</option>
        </select>
      </label>
      <button
        type="button"
        className={pins.seniority ? 'quiet-button selected-inline' : 'quiet-button'}
        onClick={() => pin('seniority')}
        aria-pressed={pins.seniority}
      >
        Pin seniority
      </button>
    </section>
  )
}

export function FrontierScreen() {
  const deal = useDealStore((state) => state.deal)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const toggleCompare = useDealStore((state) => state.toggleCompare)
  const compare = useDealStore((state) => state.compare)
  const [sort, setSort] = useState<'index' | 'uF' | 'uI' | 'pps'>('index')
  const analysis = useFrontierAnalysis(deal)
  const mcInspector = useMemo(() => {
    if (analysis.current === null || deal.risk === null) return null
    const { gamma, w0F, w0I } = deal.risk
    const round = constructRound(deal.pre, deal.safes, analysis.current.pkg.terms, deal.notes)
    const post = accrueForExit(round.post, deal.yearsToExit)
    const founder = crraUtility(post, 'FOUNDER', deal.founderBeliefs, gamma, w0F, MC_N, MC_SEED)
    const investor = crraUtility(post, 'INVESTOR', deal.investorBeliefs, gamma, w0I, MC_N, MC_SEED)
    // The simulation's standard error is in utility units. §6.8 propagates it onto the
    // certainty equivalent with se_CE = se_U × (CE + w0)^γ before it is shown, so the
    // badge quotes an error in the same dollars as the number it qualifies.
    const propagate = (sample: { se: number; ce: number }, w0: number) => ({
      ce: presentValue(sample.ce, deal.discounting),
      seCe: presentValue(sample.se * Math.pow(sample.ce + w0, gamma), deal.discounting),
    })
    return { founder: propagate(founder, w0F), investor: propagate(investor, w0I) }
  }, [analysis.current, deal])
  if (
    analysis.error !== null ||
    analysis.result === null ||
    analysis.current === null ||
    analysis.value === null
  ) {
    return (
      <section className="main-panel">
        <h2>Frontier</h2>
        <p className="validation invalid">{analysis.error}</p>
      </section>
    )
  }
  const { result, value, current } = analysis
  const ceMode = deal.risk !== null
  const risk = deal.risk
  const selected = new Set(compare)
  const frontierSet = new Set(result.frontier)
  const frontierPoints = result.points
    .filter((point) => frontierSet.has(point.pkg.index))
    .sort((left, right) => left.uF - right.uF)
  const showCrossBeliefs = !deal.sharedBeliefs
  const maxF = Math.max(...result.points.map((point) => point.uF), current.uF)
  const maxI = Math.max(...result.points.map((point) => point.uI), current.uI)
  const sorted = [...result.points].sort((left, right) => {
    if (sort === 'uF') return right.uF - left.uF
    if (sort === 'uI') return right.uI - left.uI
    if (sort === 'pps') return right.diagnostics.pps - left.diagnostics.pps
    return left.pkg.index - right.pkg.index
  })
  const solutionPoints = solutionSpecs.map(([key, label, color]) => ({
    key,
    label,
    color,
    point: pointByIndex(result.points, result[key]),
  }))
  const comparePoints = result.points.filter((point) => selected.has(point.pkg.index))
  return (
    <section className="main-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Bargaining</p>
          <h2>Frontier</h2>
        </div>
        <ExplainDrawer screen="frontier" />
      </div>
      <SpaceEditor space={deal.space} />
      <div className="field-grid">
        <label>
          {ceMode ? 'Founder CE BATNA' : 'Founder BATNA'}
          <CommitNumber
            label={ceMode ? 'Founder certainty-equivalent BATNA' : 'Founder BATNA'}
            value={deal.disagreement.dF}
            min={0}
            step={1000}
            onCommit={(value) =>
              value !== undefined &&
              patchDeal((candidate) => ({
                ...candidate,
                disagreement: { ...candidate.disagreement, dF: value },
              }))
            }
          />
          <span className="helper-copy">
            {ceMode
              ? 'Certainty-equivalent personal proceeds from your best alternative, using your CRRA baseline.'
              : 'Expected personal proceeds from your best alternative: another offer, bootstrapping, or winding down.'}
          </span>
        </label>
        <label>
          {ceMode ? 'Investor CE BATNA' : 'Investor BATNA'}
          <CommitNumber
            label={ceMode ? 'Investor certainty-equivalent BATNA' : 'Investor BATNA'}
            value={deal.disagreement.dI}
            min={0}
            step={1000}
            onCommit={(value) =>
              value !== undefined &&
              patchDeal((candidate) => ({
                ...candidate,
                disagreement: { ...candidate.disagreement, dI: value },
              }))
            }
          />
          <span className="helper-copy">
            {ceMode
              ? 'Certainty-equivalent dollars from the next-best deployment, using the investor CRRA baseline.'
              : 'Expected dollars from deploying this capital in your next-best opportunity (e.g., amount x expected net multiple).'}
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={deal.risk !== null}
            onChange={(event) =>
              patchDeal((candidate) => ({
                ...candidate,
                risk: event.target.checked ? { gamma: 0.5, w0F: 250000, w0I: 250000 } : null,
              }))
            }
          />
          CRRA mode
        </label>
        {risk !== null && (
          <div aria-label="CRRA risk aversion" role="group">
            <span className="helper-copy">Risk aversion γ</span>
            {([0.5, 1] as const).map((gamma) => (
              <button
                className={risk.gamma === gamma ? 'segmented selected' : 'segmented'}
                key={gamma}
                onClick={() =>
                  patchDeal((candidate) => ({
                    ...candidate,
                    risk: candidate.risk === null ? null : { ...candidate.risk, gamma },
                  }))
                }
                type="button"
              >
                γ {gamma}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="muted">
        Recomputed {result.points.length} valid packages in {analysis.elapsed.toFixed(1)} ms.{' '}
        {analysis.skipped.filter((cell) => cell.reason === 'V3').length > 0 && (
          <>{analysis.skipped.filter((cell) => cell.reason === 'V3').length} cells skipped (V3). </>
        )}
        {result.metric === 'CE'
          ? 'Coordinates are certainty-equivalent dollars.'
          : 'Coordinates are expected dollars.'}
      </p>
      {deal.risk !== null && mcInspector !== null && (
        <p className="callout">
          Monte Carlo inspector · n {MC_N.toLocaleString()} · seed 0x{MC_SEED.toString(16)} ·
          current founder CE {dollars(mcInspector.founder.ce)} (±{' '}
          {dollars(mcInspector.founder.seCe)} MC error) · investor CE{' '}
          {dollars(mcInspector.investor.ce)} (± {dollars(mcInspector.investor.seCe)} MC error)
        </p>
      )}
      {!result.zopa ? (
        <p className="empty-state">
          No zone of agreement at these BATNAs — lower a BATNA or widen the deal space.
        </p>
      ) : (
        <>
          <div className="value-card">
            <strong>This offer leaves {dollars(value.headline)} on the table jointly.</strong>
            <span>
              Best case for you {dollars(value.gainF)}; best case for them {dollars(value.gainI)}.
              These can be different packages.
            </span>
          </div>
          <ChartFrame
            title="All evaluated packages"
            chart={
              <div className="chart">
                <ResponsiveContainer width="100%" height={360}>
                  <ComposedChart>
                    <CartesianGrid />
                    <XAxis
                      type="number"
                      dataKey="uF"
                      name="Founder"
                      domain={[0, maxF]}
                      tickFormatter={dollars}
                    />
                    <YAxis
                      type="number"
                      dataKey="uI"
                      name="Investor"
                      domain={[0, maxI]}
                      tickFormatter={dollars}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as DealPoint | undefined
                        return active && point !== undefined ? (
                          <div className="hover-card">
                            <strong>Package #{point.pkg.index}</strong>
                            <span>{termLine(point)}</span>
                            <span>
                              PPS {dollars(point.diagnostics.pps)} · investor{' '}
                              {percent(point.diagnostics.investorPct)}
                            </span>
                            <span>
                              {dollars(point.uF)} / {dollars(point.uI)}
                            </span>
                          </div>
                        ) : null
                      }}
                    />
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
                      name="Pareto frontier"
                      isAnimationActive={false}
                    />{' '}
                    <Scatter
                      data={result.points}
                      fill="#56B4E9"
                      onClick={(data: unknown) => {
                        const point = (data as { payload?: DealPoint }).payload
                        if (point !== undefined) toggleCompare(point.pkg.index)
                      }}
                    />
                    {solutionPoints.map(({ key, label, color, point }) =>
                      point === null ? null : (
                        <Scatter key={key} name={label} data={[point]} fill={color} />
                      ),
                    )}
                    <Scatter name="Current offer ★" data={[current]} fill="#000000" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            }
            table={
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort"
                          onClick={() => setSort('index')}
                        >
                          #
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => setSort('uF')}>
                          Founder
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => setSort('uI')}>
                          Investor
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => setSort('pps')}>
                          PPS
                        </button>
                      </th>
                      {showCrossBeliefs && (
                        <>
                          <th>Founder under investor beliefs</th>
                          <th>Investor under founder beliefs</th>
                        </>
                      )}
                      <th>Frontier</th>
                      <th>Pin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((point) => (
                      <tr key={point.pkg.index}>
                        <td>{point.pkg.index}</td>
                        <td>{dollars(point.uF)}</td>
                        <td>{dollars(point.uI)}</td>
                        <td>{dollars(point.diagnostics.pps)}</td>
                        {showCrossBeliefs && (
                          <>
                            <td>{dollars(point.uF_underI)}</td>
                            <td>{dollars(point.uI_underF)}</td>
                          </>
                        )}
                        <td>{frontierSet.has(point.pkg.index) ? 'yes' : ''}</td>
                        <td>
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={() => toggleCompare(point.pkg.index)}
                          >
                            {selected.has(point.pkg.index) ? 'Unpin' : 'Pin'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
          <div className="marker-row">
            {solutionPoints.map(({ key, label, point }) => (
              <span key={key}>
                {label} #{point?.pkg.index ?? '—'}
              </span>
            ))}
            <span>
              Current ★ {dollars(current.uF)} / {dollars(current.uI)}
            </span>
          </div>
          <h3>Top dominating packages</h3>
          <div className="compare-tray">
            {value.dominating.length === 0 ? (
              <span className="muted">
                No package weakly improves both sides from the current offer.
              </span>
            ) : (
              value.dominating
                .map((index) => pointByIndex(result.points, index))
                .filter((point): point is DealPoint => point !== null)
                .map((point) => (
                  <article key={point.pkg.index}>
                    <strong>Package #{point.pkg.index}</strong>
                    <span>{termDelta(current.pkg.terms, point.pkg.terms)}</span>
                    <span>
                      ΔuF {dollars(point.uF - current.uF)} · ΔuI {dollars(point.uI - current.uI)}
                    </span>
                  </article>
                ))
            )}
          </div>
          <h3>Compare tray</h3>
          <div className="compare-tray">
            {comparePoints.length === 0 ? (
              <span className="muted">
                Pin up to three packages to compare terms, utilities, and quantiles.
              </span>
            ) : (
              comparePoints.map((point) => {
                const round = constructRound(deal.pre, deal.safes, point.pkg.terms, deal.notes)
                const post = accrueForExit(round.post, deal.yearsToExit)
                return (
                  <article key={point.pkg.index}>
                    <strong>Package #{point.pkg.index}</strong>
                    <span>{termLine(point)}</span>
                    <span>
                      {dollars(point.uF)} / {dollars(point.uI)}
                    </span>
                    <span>
                      Founder P50{' '}
                      {dollars(
                        presentValue(
                          payoutQuantile(post, 'FOUNDER', deal.founderBeliefs, 0.5),
                          deal.discounting,
                        ),
                      )}
                    </span>
                    <span>
                      Investor P50{' '}
                      {dollars(
                        presentValue(
                          payoutQuantile(post, 'INVESTOR', deal.investorBeliefs, 0.5),
                          deal.discounting,
                        ),
                      )}
                    </span>
                    <span>
                      PPS {dollars(point.diagnostics.pps)} · investor{' '}
                      {percent(point.diagnostics.investorPct)}
                    </span>
                  </article>
                )
              })
            )}
          </div>
        </>
      )}
    </section>
  )
}
