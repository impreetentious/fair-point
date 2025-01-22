import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CapTableSchema, RoundTermsSchema, SafeSchema } from '../src/core/schema'
import { constructRound } from '../src/core/round'
import { convertSafes, solveSafes } from '../src/core/safes'

describe('SAFE conversion and round construction', () => {
  it('uses the simultaneous post-money cap closed form', () => {
    const safes = [
      SafeSchema.parse({ id: 'one', name: 'One', amount: 500_000, kind: 'POST_MONEY', valuationCap: 5_000_000 }),
      SafeSchema.parse({ id: 'two', name: 'Two', amount: 250_000, kind: 'POST_MONEY', valuationCap: 10_000_000 }),
    ]
    const result = convertSafes(10_000_000, safes, 1)
    expect(result.sharesBySafe.one).toBeCloseTo(1_142_857.1429, 4)
    expect(result.sharesBySafe.two).toBeCloseTo(285_714.2857, 4)
  })

  it('reproduces the locked pool shuffle PPS', () => {
    const pre = CapTableSchema.parse({
      classes: [{ id: 'common', name: 'Common', kind: 'COMMON', shares: 8_500_000, holder: 'FOUNDER' }],
      grants: [{ id: 'options', options: 500_000, strike: 0, holder: 'FOUNDER' }],
      poolAvailable: 0,
    })
    const terms = RoundTermsSchema.parse({ preMoney: 8_000_000, investment: 2_000_000, poolTargetPost: 0.1, prefMultiple: 1, participation: 'NONE', seniority: 'PARI' })
    const result = constructRound(pre, [], terms)
    expect(result.diagnostics.pps).toBeCloseTo(7 / 9, 9)
    expect(result.diagnostics.investorPct).toBeCloseTo(0.2, 9)
  })

  it('bounds SAFE route switching at #SAFEs + 1 passes', () => {
    const safes = [
      SafeSchema.parse({ id: 'a', name: 'A', amount: 1_000_000, kind: 'POST_MONEY', valuationCap: 10_000_000, discount: 0.5 }),
      SafeSchema.parse({ id: 'b', name: 'B', amount: 500_000, kind: 'POST_MONEY', valuationCap: 20_000_000, discount: 0.2 }),
    ]
    const solved = solveSafes({
      baseCap: 10_000_000,
      safes,
      investment: 1_000_000,
      preMoney: 10_000_000,
      poolTargetPost: 0,
      poolAvailable: 0,
    })
    expect(solved.iterations).toBeLessThanOrEqual(safes.length + 1)
  })

  it('preserves round and SAFE identities across randomized valid inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 20_000_000 }),
        fc.integer({ min: 100_000, max: 3_000_000 }),
        fc.double({ min: 0.05, max: 0.2, noNaN: true }),
        (commonShares, investment, poolTargetPost) => {
          const preMoney = commonShares
          const pre = CapTableSchema.parse({
            classes: [{ id: 'common', name: 'Common', kind: 'COMMON', shares: commonShares, holder: 'FOUNDER' }],
            grants: [],
            poolAvailable: 0,
          })
          const terms = RoundTermsSchema.parse({ preMoney, investment, poolTargetPost, prefMultiple: 1, participation: 'NONE', seniority: 'PARI' })
          const round = constructRound(pre, [], terms)
          expect(round.diagnostics.investorPct).toBeCloseTo(investment / (preMoney + investment), 9)

          const safes = [SafeSchema.parse({ id: 'cap', name: 'Cap', amount: 100_000, kind: 'POST_MONEY', valuationCap: 2_000_000 })]
          const converted = convertSafes(commonShares, safes, 10)
          const f = 100_000 / 2_000_000
          expect(converted.sharesBySafe.cap / (commonShares + converted.totalSafeShares)).toBeCloseTo(f, 12)
        },
      ),
      { numRuns: 300 },
    )
  })
})
