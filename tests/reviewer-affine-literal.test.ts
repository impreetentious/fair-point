import { it, expect } from 'vitest'
import { CapTableSchema } from '../src/core/schema'
import { regimes } from '../src/core/breakpoints'
import { payoutsAt } from '../src/core/waterfall'
const post = CapTableSchema.parse({
  classes: [
    { id: 'common', name: 'Common', kind: 'COMMON', shares: 14, holder: 'FOUNDER' },
    {
      id: 'preferred-0',
      name: 'Preferred 1',
      kind: 'PREFERRED',
      shares: 1,
      holder: 'INVESTOR',
      invested: 1999989,
      originalIssuePrice: 1999989,
      prefMultiple: 2,
      participation: 'NONE',
      seniorityTier: 3,
      conversionRatio: 1.9999999999999996,
      antiDilution: 'NONE',
      dividendRate: 0,
      dividendKind: 'NONE',
      payToPlay: 'NONE',
      accruedDividends: 0,
      redemptionClaim: 0,
    },
  ],
  grants: [
    { id: 'grant-0', options: 19990, strike: 160, holder: 'FOUNDER', instrument: 'OPTION' },
    { id: 'grant-1', options: 10566, strike: 493, holder: 'FOUNDER', instrument: 'OPTION' },
  ],
  poolAvailable: 0,
  promisedOptions: 0,
})
it('replays B13 saved affine property literal under its existing contract', () => {
  const last = regimes(post).at(-1)!
  const exitValue = Math.max(1, last.from * 10)
  const actual = payoutsAt(post, exitValue)
  for (const [id, value] of Object.entries({ ...actual.byClass, ...actual.byGrant })) {
    const estimate = last.coeffs[id]!.m * exitValue + last.coeffs[id]!.c
    expect(Math.abs(value - estimate)).toBeLessThanOrEqual(Math.max(0.05, 1e-8 * Math.abs(value)))
  }
})
