import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CapTableSchema, type Beliefs } from '../src/core/schema'
import { mixtureQuantile } from '../src/core/distributions'
import { crraQuadrature, crraUtility, mcPayouts } from '../src/core/mc'
import { expectedPayouts, payoutQuantile } from '../src/core/outcomes'
import { payoutsAt } from '../src/core/waterfall'

const post = CapTableSchema.parse({
  classes: [
    { id: 'common', name: 'Common', kind: 'COMMON', shares: 8_000_000, holder: 'FOUNDER' },
    {
      id: 'series-a',
      name: 'Series A',
      kind: 'PREFERRED',
      shares: 2_000_000,
      holder: 'INVESTOR',
      invested: 2_000_000,
      prefMultiple: 1,
      participation: 'NONE',
    },
  ],
  grants: [],
  poolAvailable: 0,
})

const beliefs: Beliefs = { p0: 0.2, p50: 15_000_000, p90: 45_000_000 }

describe('outcomes and Monte Carlo twin', () => {
  it('integrates closed-form expected payouts within the seeded MC confidence band', () => {
    const exact = expectedPayouts(post, beliefs)
    const simulated = mcPayouts(post, beliefs, 200_000, 42)
    for (const id of Object.keys(exact.ev)) {
      expect(Math.abs(exact.ev[id] - simulated.mean[id])).toBeLessThanOrEqual(4 * simulated.se[id] + 1)
    }
    expect(exact.party.founder).toBeCloseTo(exact.ev.common, 6)
    expect(exact.party.investor).toBeCloseTo(exact.ev['series-a'], 6)
  })

  it('maps payout quantiles directly through the locked exit quantile', () => {
    for (const p of [0, beliefs.p0, 0.25, 0.5, 0.9]) {
      const expected = p <= beliefs.p0 ? 0 : payoutsAt(post, mixtureQuantile(beliefs, p)).byClass['series-a']
      expect(payoutQuantile(post, 'series-a', beliefs, p)).toBeCloseTo(expected, 10)
    }
    const values = [0.21, 0.4, 0.7, 0.95].map((p) => payoutQuantile(post, 'FOUNDER', beliefs, p))
    expect(values).toEqual([...values].sort((left, right) => left - right))
  })

  it('keeps payout quantiles monotone over randomized percentile pairs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (left, right) => {
          const low = Math.min(left, right)
          const high = Math.max(left, right)
          expect(payoutQuantile(post, 'FOUNDER', beliefs, high)).toBeGreaterThanOrEqual(payoutQuantile(post, 'FOUNDER', beliefs, low) - 1e-8)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('returns deterministic seeded CRRA results and agrees with deterministic quadrature', () => {
    const first = crraUtility(post, 'FOUNDER', beliefs, 0.5, 250_000, 200_000, 42)
    const second = crraUtility(post, 'FOUNDER', beliefs, 0.5, 250_000, 200_000, 42)
    const quadrature = crraQuadrature(post, 'FOUNDER', beliefs, 0.5, 250_000)
    const seCe = first.se * Math.pow(first.ce + 250_000, 0.5)
    expect(second).toEqual(first)
    expect(Math.abs(quadrature.ce - first.ce)).toBeLessThanOrEqual(4 * seCe + 1)
  })
})
