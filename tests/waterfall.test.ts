import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CapTableSchema } from '../src/core/schema'
import { regimes } from '../src/core/breakpoints'
import { payoutsAt } from '../src/core/waterfall'

const capTable = CapTableSchema.parse({
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
      participation: 'CAPPED',
      participationCapMultiple: 3,
    },
  ],
  grants: [],
  poolAvailable: 0,
})

describe('waterfall', () => {
  it('reproduces the locked capped-participation regime table', () => {
    expect(payoutsAt(capTable, 20_000_000).byClass).toMatchObject({
      'series-a': 5_600_000,
      common: 14_400_000,
    })
    expect(payoutsAt(capTable, 25_000_000).byClass).toMatchObject({
      'series-a': 6_000_000,
      common: 19_000_000,
    })
    expect(payoutsAt(capTable, 40_000_000).byClass).toMatchObject({
      'series-a': 8_000_000,
      common: 32_000_000,
    })
    const boundaries = regimes(capTable).map((regime) => regime.from)
    for (const expected of [2_000_000, 22_000_000, 30_000_000]) {
      expect(boundaries.some((actual) => Math.abs(actual - expected) <= 0.01)).toBe(true)
    }
  })

  it('conserves value over 500 randomized cap tables', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (commonShares, preferredShares, exitValue) => {
          const post = CapTableSchema.parse({
            classes: [
              {
                id: 'common',
                name: 'Common',
                kind: 'COMMON',
                shares: commonShares,
                holder: 'FOUNDER',
              },
              {
                id: 'preferred',
                name: 'Preferred',
                kind: 'PREFERRED',
                shares: preferredShares,
                holder: 'INVESTOR',
                invested: 100,
                prefMultiple: 1,
                participation: 'NONE',
              },
            ],
            grants: [],
            poolAvailable: 0,
          })
          const current = payoutsAt(post, exitValue)
          const total =
            Object.values(current.byClass).reduce((sum, value) => sum + value, 0) +
            Object.values(current.byGrant).reduce((sum, value) => sum + value, 0)
          expect(total).toBeCloseTo(exitValue, 7)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('keeps holder payouts monotonic over 300 randomized cap tables', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (commonShares, preferredShares, exitValue) => {
          const post = CapTableSchema.parse({
            classes: [
              {
                id: 'common',
                name: 'Common',
                kind: 'COMMON',
                shares: commonShares,
                holder: 'FOUNDER',
              },
              {
                id: 'preferred',
                name: 'Preferred',
                kind: 'PREFERRED',
                shares: preferredShares,
                holder: 'INVESTOR',
                invested: 100,
                prefMultiple: 1,
                participation: 'NONE',
              },
            ],
            grants: [],
            poolAvailable: 0,
          })
          const current = payoutsAt(post, exitValue)
          const later = payoutsAt(post, exitValue + 1)
          for (const id of Object.keys(current.byClass))
            expect(later.byClass[id]).toBeGreaterThanOrEqual(current.byClass[id] - 1e-8)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('matches regime interpolation across the locked dense grid', () => {
    const allRegimes = regimes(capTable)
    for (let index = 0; index <= 2000; index += 1) {
      const exitValue = (40_000_000 * index) / 2000
      const regime =
        allRegimes.find((candidate) => exitValue >= candidate.from && exitValue < candidate.to) ??
        allRegimes.at(-1)!
      const actual = payoutsAt(capTable, exitValue)
      for (const [id, value] of Object.entries({ ...actual.byClass, ...actual.byGrant })) {
        const estimate = regime.coeffs[id].m * exitValue + regime.coeffs[id].c
        expect(Math.abs(value - estimate)).toBeLessThanOrEqual(
          Math.max(0.01, 1e-8 * Math.abs(value)),
        )
      }
    }
  })
})
