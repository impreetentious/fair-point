import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CapTableSchema, EPS_DECISION } from '../src/core/schema'
import { generalRegimesForTest, regimes, simpleTwoClassRegimes } from '../src/core/breakpoints'
import { payoutsAt } from '../src/core/waterfall'
import { accrueForExit, preferenceClaim } from '../src/core/accruals'
import {
  arbitraryCapTable,
  arbitraryCappedCapTable,
  arbitraryGrantExerciseCapTable,
  arbitrarySettlementCase,
} from './generators'

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
  it('keeps the two-class fast path equal to the general regime walk', () => {
    const fast = simpleTwoClassRegimes(capTable)!
    const general = generalRegimesForTest(capTable)
    expect(general).toHaveLength(fast.length)
    for (const [index, regime] of fast.entries()) {
      const actual = general[index]!
      expect(actual.event).toBe(regime.event)
      expect(actual.from).toBeCloseTo(regime.from, 2)
      expect(actual.to).toBeCloseTo(regime.to, 2)
      for (const id of Object.keys(regime.coeffs)) {
        expect(actual.coeffs[id]!.m).toBeCloseTo(regime.coeffs[id]!.m, 8)
        expect(actual.coeffs[id]!.c).toBeCloseTo(regime.coeffs[id]!.c, 2)
      }
    }
  })

  it('uses accrued dividends in the two-class preference breakpoint', () => {
    const accrued = CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 8_000_000, holder: 'FOUNDER' },
        {
          id: 'preferred',
          name: 'Preferred',
          kind: 'PREFERRED',
          shares: 2_000_000,
          holder: 'INVESTOR',
          invested: 2_000_000,
          prefMultiple: 1,
          participation: 'NONE',
          accruedDividends: 1_000_000,
        },
      ],
      grants: [],
      poolAvailable: 0,
    })
    const fast = simpleTwoClassRegimes(accrued)!
    expect(fast[0]!.to).toBe(3_000_000)
    expect(fast[1]!.from).toBe(3_000_000)
    expect(fast[2]!.from).toBe(15_000_000)
    expect(payoutsAt(accrued, 3_000_000).byClass.preferred).toBe(3_000_000)
  })

  it('rejects accrual and preference claims that overflow finite inputs', () => {
    const oversized = CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 1, holder: 'FOUNDER' },
        {
          id: 'preferred',
          name: 'Preferred',
          kind: 'PREFERRED',
          shares: 1,
          holder: 'INVESTOR',
          invested: Number.MAX_VALUE / 2,
          prefMultiple: 3,
          participation: 'NONE',
          dividendRate: 3,
          dividendKind: 'CUMULATIVE',
        },
      ],
      grants: [],
      poolAvailable: 0,
    })
    const preferred = oversized.classes.find((cls) => cls.kind === 'PREFERRED')!
    expect(() => preferenceClaim(preferred)).toThrow('Preference claim exceeds')
    expect(() => accrueForExit(oversized, 2)).toThrow('Accrual exceeds')
    expect(() => accrueForExit(capTable, -1)).toThrow('yearsToExit must be finite and nonnegative')
  })

  it('falls back to the general walk when accrual exceeds a participation cap', () => {
    const accrued = CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 8, holder: 'FOUNDER' },
        {
          id: 'preferred',
          name: 'Preferred',
          kind: 'PREFERRED',
          shares: 2,
          holder: 'INVESTOR',
          invested: 1,
          prefMultiple: 1,
          participation: 'CAPPED',
          participationCapMultiple: 2,
          redemptionClaim: 3,
        },
      ],
      grants: [],
      poolAvailable: 0,
    })
    expect(simpleTwoClassRegimes(accrued)).toBeNull()
    expect(regimes(accrued).at(-1)!.to).toBe(Infinity)
  })

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
      fc.property(arbitrarySettlementCase, ({ post, exitValue }) => {
        const current = payoutsAt(post, exitValue)
        const total =
          Object.values(current.byClass).reduce((sum, value) => sum + value, 0) +
          Object.values(current.byGrant).reduce((sum, value) => sum + value, 0)
        expect(total).toBeCloseTo(exitValue, 7)
      }),
      { numRuns: 500 },
    )
  })

  it('keeps holder payouts monotonic over 300 randomized cap tables', () => {
    fc.assert(
      fc.property(arbitrarySettlementCase, ({ post, exitValue }) => {
        const current = payoutsAt(post, exitValue)
        const later = payoutsAt(post, exitValue + 1)
        for (const id of [...Object.keys(current.byClass), ...Object.keys(current.byGrant)])
          expect(later.byClass[id] ?? later.byGrant[id] ?? 0).toBeGreaterThanOrEqual(
            (current.byClass[id] ?? current.byGrant[id] ?? 0) - 1e-8,
          )
      }),
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

  it('matches generated regime lines across 50 general cap tables', () => {
    fc.assert(
      fc.property(arbitraryCapTable, (post) => {
        const allRegimes = regimes(post)
        const invested = post.classes.reduce(
          (sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.invested : 0),
          0,
        )
        for (let index = 0; index <= 24; index += 1) {
          const exitValue = (20 * invested * index) / 24
          const regime =
            allRegimes.find(
              (candidate) => exitValue >= candidate.from && exitValue < candidate.to,
            ) ?? allRegimes.at(-1)!
          const actual = payoutsAt(post, exitValue)
          for (const [id, value] of Object.entries({ ...actual.byClass, ...actual.byGrant })) {
            const estimate = regime.coeffs[id]!.m * exitValue + regime.coeffs[id]!.c
            expect(Math.abs(value - estimate)).toBeLessThanOrEqual(
              Math.max(0.05, 1e-8 * Math.abs(value)),
            )
          }
        }
      }),
      { numRuns: 50, endOnFailure: true },
    )
  }, 30_000)

  it('keeps the final regime affine across 200 general cap tables', () => {
    fc.assert(
      fc.property(arbitraryCapTable, (post) => {
        const last = regimes(post).at(-1)!
        const exitValue = Math.max(1, last.from * 10)
        const actual = payoutsAt(post, exitValue)
        for (const [id, value] of Object.entries({ ...actual.byClass, ...actual.byGrant })) {
          const estimate = last.coeffs[id]!.m * exitValue + last.coeffs[id]!.c
          expect(Math.abs(value - estimate)).toBeLessThanOrEqual(
            Math.max(0.05, 1e-8 * Math.abs(value)),
          )
        }
      }),
      { numRuns: 200, endOnFailure: true },
    )
  }, 30_000)

  it('keeps 40+ duplicate-strike grants exercise-consistent across 200 tables', () => {
    fc.assert(
      fc.property(
        arbitraryGrantExerciseCapTable,
        fc.integer({ min: 0, max: 20 }),
        (post, multiple) => {
          const invested = post.classes.reduce(
            (sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.invested : 0),
            0,
          )
          const actual = payoutsAt(post, invested * multiple)
          expect(new Set(post.grants.map((grant) => grant.strike)).size).toBeLessThan(
            post.grants.length,
          )
          for (const grant of post.grants) {
            const shouldExercise = grant.strike < actual.perCommonShareProceeds - EPS_DECISION
            expect(actual.byGrant[grant.id] > EPS_DECISION).toBe(shouldExercise)
          }
        },
      ),
      { numRuns: 200, endOnFailure: true },
    )
  })

  it('settles every adversarial 2–4-class capped table across 200 cases', () => {
    fc.assert(
      fc.property(arbitraryCappedCapTable, fc.integer({ min: 0, max: 20 }), (post, multiple) => {
        const invested = post.classes.reduce(
          (sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.invested : 0),
          0,
        )
        const exitValue = invested * multiple
        const actual = payoutsAt(post, exitValue)
        const total = Object.values(actual.byClass).reduce((sum, value) => sum + value, 0)
        expect(total).toBeCloseTo(exitValue, 7)
        expect(actual.warnings.some((warning) => warning.includes('NonConvergence'))).toBe(false)
      }),
      { numRuns: 200, endOnFailure: true },
    )
  })
})
