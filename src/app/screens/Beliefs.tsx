import { useMemo } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fitLognormal, mixtureQuantile, partialExpectation } from '../../core/distributions'
import { phi } from '../../core/numerics'
import { ChartFrame } from '../components/ChartFrame'
import { dollars, percent } from '../components/format'
import { CommitNumber } from '../components/CommitField'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { useDealStore } from '../state/store'
import type { Beliefs } from '../../core/schema'

const PRESETS: { label: string; beliefs: Beliefs }[] = [
  { label: 'Seed', beliefs: { p0: 0.5, p50: 40_000_000, p90: 400_000_000 } },
  { label: 'Series A', beliefs: { p0: 0.35, p50: 80_000_000, p90: 600_000_000 } },
  { label: 'Series B', beliefs: { p0: 0.25, p50: 150_000_000, p90: 900_000_000 } },
]

function density(value: number, mu: number, sigma: number): number {
  if (value <= 0) return 0
  const z = (Math.log(value) - mu) / sigma
  return Math.exp(-0.5 * z * z) / (value * sigma * Math.sqrt(2 * Math.PI))
}

function cdf(value: number, mu: number, sigma: number): number {
  if (value <= 0) return 0
  return phi((Math.log(value) - mu) / sigma)
}

function conditionalQuantile(beliefs: Beliefs, p: number): number {
  return mixtureQuantile(beliefs, beliefs.p0 + (1 - beliefs.p0) * p)
}

function overallMedian(beliefs: Beliefs): number {
  if (beliefs.p0 >= 0.5) return 0
  return mixtureQuantile(beliefs, 0.5)
}

function BeliefCard({ party }: { party: 'founder' | 'investor' }) {
  const deal = useDealStore((state) => state.deal)
  const setBeliefs = useDealStore((state) => state.setBeliefs)
  const beliefs = party === 'founder' ? deal.founderBeliefs : deal.investorBeliefs
  const label = party === 'founder' ? 'Founder' : 'Investor'
  const fit = useMemo(() => {
    try {
      return fitLognormal(beliefs)
    } catch {
      return null
    }
  }, [beliefs])
  const commit = (field: keyof Beliefs) => (value: number | undefined) =>
    setBeliefs(party, { ...beliefs, [field]: value })
  const rows = useMemo(() => {
    if (fit === null) return []
    const max = conditionalQuantile(beliefs, 0.95)
    const points = Array.from({ length: 40 }, (_, index) => (max * index) / 39)
    return [
      { exit: 0, density: 0, cdf: beliefs.p0, failure: beliefs.p0 },
      ...points.slice(1).map((exit) => ({
        exit,
        density: density(exit, fit.mu, fit.sigma) * (1 - beliefs.p0),
        cdf: beliefs.p0 + (1 - beliefs.p0) * cdf(exit, fit.mu, fit.sigma),
        failure: 0,
      })),
    ]
  }, [beliefs, fit])
  const stats =
    fit === null
      ? null
      : {
          mean: (1 - beliefs.p0) * partialExpectation(fit.mu, fit.sigma, 0, Infinity),
          p25: conditionalQuantile(beliefs, 0.25),
          p50: conditionalQuantile(beliefs, 0.5),
          p75: conditionalQuantile(beliefs, 0.75),
          median: overallMedian(beliefs),
        }
  return (
    <article className="belief-card">
      <h3>{label} beliefs</h3>
      <div className="field-grid">
        <label>
          Failure probability
          <CommitNumber
            label={`${label} failure probability`}
            value={beliefs.p0}
            min={0}
            max={0.99}
            step={0.001}
            decimals={3}
            onCommit={(value) => value !== undefined && commit('p0')(value)}
          />
        </label>
        <label>
          P10 (if not zero)
          <CommitNumber
            label={`${label} P10 if not zero`}
            value={beliefs.p10}
            allowEmpty
            min={1}
            step={1000}
            onCommit={commit('p10')}
          />
        </label>
        <label>
          P50 (if not zero)
          <CommitNumber
            label={`${label} P50 if not zero`}
            value={beliefs.p50}
            min={1}
            step={1000}
            onCommit={(value) => value !== undefined && commit('p50')(value)}
          />
        </label>
        <label>
          P90 (if not zero)
          <CommitNumber
            label={`${label} P90 if not zero`}
            value={beliefs.p90}
            min={1}
            step={1000}
            onCommit={(value) => value !== undefined && commit('p90')(value)}
          />
        </label>
      </div>
      {fit !== null && (
        <>
          <p className="muted">
            Fitted μ {fit.mu.toFixed(3)} · σ {fit.sigma.toFixed(3)} · failure mass{' '}
            {percent(beliefs.p0)}
          </p>
          {fit.warnings.map((warning) => (
            <p className="validation invalid" key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}
      {fit !== null && stats !== null && (
        <ChartFrame
          title={`${label} fitted density and CDF`}
          chart={
            <div className="chart">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="exit" tickFormatter={dollars} />
                  <YAxis yAxisId="left" tickFormatter={(value) => percent(Number(value))} />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip
                    formatter={(value, name) =>
                      name === 'density' ? Number(value).toExponential(2) : percent(Number(value))
                    }
                    labelFormatter={(value) => dollars(Number(value))}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="failure"
                    fill="#D55E00"
                    name="failure mass at zero"
                  />
                  <Area
                    yAxisId="right"
                    dataKey="density"
                    fill="#56B4E9"
                    stroke="#0072B2"
                    name="density"
                  />
                  <Line yAxisId="left" dataKey="cdf" stroke="#009E73" dot={false} name="CDF" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Readout</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>If not zero</td>
                    <td>
                      P25 {dollars(stats.p25)} · P50 {dollars(stats.p50)} · P75 {dollars(stats.p75)}
                    </td>
                  </tr>
                  <tr>
                    <td>Overall</td>
                    <td>
                      mean {dollars(stats.mean)} · median {dollars(stats.median)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      )}
    </article>
  )
}

export function BeliefsScreen() {
  const deal = useDealStore((state) => state.deal)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const setBeliefs = useDealStore((state) => state.setBeliefs)
  return (
    <section className="main-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Uncertainty</p>
          <h2>Beliefs</h2>
        </div>
        <ExplainDrawer screen="beliefs" />
      </div>
      <p className="muted">
        Percentiles are conditional-on-success. The failure mass is modeled separately at zero.
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={deal.sharedBeliefs}
          onChange={(event) =>
            patchDeal((current) => ({
              ...current,
              sharedBeliefs: event.target.checked,
              investorBeliefs: event.target.checked
                ? current.founderBeliefs
                : current.investorBeliefs,
            }))
          }
        />
        Use the same beliefs for both parties
      </label>
      <div className="preset-row">
        <span>Illustrative defaults — edit to your view:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="quiet-button"
            onClick={() => setBeliefs('founder', preset.beliefs)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="belief-grid">
        <BeliefCard party="founder" />
        <BeliefCard party="investor" />
      </div>
    </section>
  )
}
