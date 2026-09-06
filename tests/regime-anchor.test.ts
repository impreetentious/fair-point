import { expect, test } from 'vitest'
import { generalRegimesForTest } from '../src/core/breakpoints'
import { payoutsAt } from '../src/core/waterfall'

test('fits the initial common-only segment from its exact zero payout', () => {
  const post = {
    classes: [
      {
        id: 'common',
        name: 'Common',
        kind: 'COMMON' as const,
        shares: 1,
        holder: 'FOUNDER' as const,
      },
    ],
    grants: [],
    poolAvailable: 100,
    promisedOptions: 0,
  }
  const all = generalRegimesForTest(post)
  expect(all).toHaveLength(1)
  expect(all[0]!.from).toBe(0)
  expect(all[0]!.to).toBe(Infinity)
  expect(all[0]!.coeffs.common!.m).toBe(1)
  expect(all[0]!.coeffs.common!.c).toBe(0)
})

const leftoverFillPost = {
  classes: [
    {
      id: 'common',
      name: 'Common',
      kind: 'COMMON' as const,
      shares: 2849,
      holder: 'FOUNDER' as const,
    },
    {
      id: 'preferred-0',
      name: 'Preferred 1',
      kind: 'PREFERRED' as const,
      shares: 7,
      holder: 'INVESTOR' as const,
      invested: 2,
      originalIssuePrice: 0.2857142857142857,
      prefMultiple: 2,
      participation: 'FULL' as const,
      seniorityTier: 2,
      conversionRatio: 1.9109790005687624,
      antiDilution: 'NONE' as const,
      dividendRate: 0,
      dividendKind: 'NONE' as const,
      payToPlay: 'NONE' as const,
      accruedDividends: 0,
      redemptionClaim: 0,
    },
    {
      id: 'preferred-1',
      name: 'Preferred 2',
      kind: 'PREFERRED' as const,
      shares: 8790,
      holder: 'OTHER' as const,
      invested: 5,
      originalIssuePrice: 0.0005688282138794084,
      prefMultiple: 1,
      participation: 'FULL' as const,
      seniorityTier: 3,
      conversionRatio: 0.9550694057047112,
      antiDilution: 'NONE' as const,
      dividendRate: 0,
      dividendKind: 'NONE' as const,
      payToPlay: 'NONE' as const,
      accruedDividends: 0,
      redemptionClaim: 0,
    },
  ],
  grants: [],
  poolAvailable: 0,
  promisedOptions: 0,
}

test('FULL leftover-fill at preference sum is not the infinite last regime', () => {
  const regimes = generalRegimesForTest(leftoverFillPost)
  const last = regimes.at(-1)!
  expect(last.to).toBe(Infinity)
  const x = 18
  const actual = payoutsAt(leftoverFillPost, x).byClass
  for (const [id, c] of Object.entries(last.coeffs)) {
    expect(Math.abs(actual[id]! - (c.m * x + c.c))).toBeLessThanOrEqual(
      Math.max(0.05, Math.abs(actual[id]!) * 5e-9),
    )
  }
})
