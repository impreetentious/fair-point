import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BeliefsSchema, CapTableSchema, RoundTermsSchema, SafeSchema } from '../src/core/schema'
import { expectedPayouts } from '../src/core/outcomes'
import { constructRound } from '../src/core/round'
import { convertSafes, solveSafes } from '../src/core/safes'
import { conversionPrice } from '../src/core/antidilution'
import { arbitraryDownRoundCase } from './generators'

describe('SAFE conversion and round construction', () => {
  it('uses the simultaneous post-money cap closed form', () => {
    const safes = [
      SafeSchema.parse({
        id: 'one',
        name: 'One',
        amount: 500_000,
        kind: 'POST_MONEY',
        valuationCap: 5_000_000,
      }),
      SafeSchema.parse({
        id: 'two',
        name: 'Two',
        amount: 250_000,
        kind: 'POST_MONEY',
        valuationCap: 10_000_000,
      }),
    ]
    const result = convertSafes(10_000_000, safes, 1)
    expect(result.sharesBySafe.one).toBeCloseTo(1_142_857.1429, 4)
    expect(result.sharesBySafe.two).toBeCloseTo(285_714.2857, 4)
  })

  it('reproduces the locked pool shuffle PPS', () => {
    const pre = CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 8_500_000, holder: 'FOUNDER' },
      ],
      grants: [{ id: 'options', options: 500_000, strike: 0, holder: 'FOUNDER' }],
      poolAvailable: 0,
    })
    const terms = RoundTermsSchema.parse({
      preMoney: 8_000_000,
      investment: 2_000_000,
      poolTargetPost: 0.1,
      prefMultiple: 1,
      participation: 'NONE',
      seniority: 'PARI',
    })
    const result = constructRound(pre, [], terms)
    expect(result.diagnostics.pps).toBeCloseTo(7 / 9, 9)
    expect(result.diagnostics.investorPct).toBeCloseTo(0.2, 9)
  })

  it('bounds SAFE route switching at #SAFEs + 1 passes', () => {
    const safes = [
      SafeSchema.parse({
        id: 'a',
        name: 'A',
        amount: 1_000_000,
        kind: 'POST_MONEY',
        valuationCap: 10_000_000,
        discount: 0.5,
      }),
      SafeSchema.parse({
        id: 'b',
        name: 'B',
        amount: 500_000,
        kind: 'POST_MONEY',
        valuationCap: 20_000_000,
        discount: 0.2,
      }),
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

  it('attributes a round-price SAFE to OTHER rather than the new investor', () => {
    const pre = CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 10_000_000, holder: 'FOUNDER' },
      ],
      grants: [],
      poolAvailable: 0,
    })
    const terms = RoundTermsSchema.parse({
      pricedPerShare: 1,
      investment: 2_000_000,
      poolTargetPost: 0,
      prefMultiple: 1,
      participation: 'NONE',
      seniority: 'PARI',
    })
    const safe = SafeSchema.parse({
      id: 'third-party-safe',
      name: 'Third-party SAFE',
      amount: 1_000_000,
      kind: 'POST_MONEY',
      valuationCap: 100_000_000,
      holder: 'OTHER',
    })
    const round = constructRound(pre, [safe], terms)

    expect(round.diagnostics.routeBySafe['third-party-safe']).toBe('ROUND_PRICE')
    expect(round.post.classes.find((cls) => cls.id === 'new-round')).toMatchObject({
      holder: 'INVESTOR',
      shares: 2_000_000,
      invested: 2_000_000,
    })
    expect(round.post.classes.find((cls) => cls.id === 'new-round-other')).toMatchObject({
      holder: 'OTHER',
      shares: 1_000_000,
      invested: 1_000_000,
    })
    const party = expectedPayouts(
      round.post,
      BeliefsSchema.parse({ p0: 0, p50: 50_000_000, p90: 100_000_000 }),
    ).party
    expect(party.other).toBeGreaterThan(0)
    expect(party.investor).toBeCloseTo(party.other * 2, 8)
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
            classes: [
              {
                id: 'common',
                name: 'Common',
                kind: 'COMMON',
                shares: commonShares,
                holder: 'FOUNDER',
              },
            ],
            grants: [],
            poolAvailable: 0,
          })
          const terms = RoundTermsSchema.parse({
            preMoney,
            investment,
            poolTargetPost,
            prefMultiple: 1,
            participation: 'NONE',
            seniority: 'PARI',
          })
          const round = constructRound(pre, [], terms)
          expect(round.diagnostics.investorPct).toBeCloseTo(investment / (preMoney + investment), 9)

          const safes = [
            SafeSchema.parse({
              id: 'cap',
              name: 'Cap',
              amount: 100_000,
              kind: 'POST_MONEY',
              valuationCap: 2_000_000,
            }),
          ]
          const converted = convertSafes(commonShares, safes, 10)
          const f = 100_000 / 2_000_000
          expect(
            converted.sharesBySafe.cap / (commonShares + converted.totalSafeShares),
          ).toBeCloseTo(f, 12)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('never worsens an anti-dilution holder’s conversion price across 200 down rounds', () => {
    fc.assert(
      fc.property(arbitraryDownRoundCase, ({ pre, terms }) => {
        const before = pre.classes.find((cls) => cls.id === 'legacy')!
        if (before.kind !== 'PREFERRED') throw new Error('generator must create legacy preferred')
        const result = constructRound(pre, [], RoundTermsSchema.parse(terms))
        const after = result.post.classes.find((cls) => cls.id === 'legacy')!
        if (after.kind !== 'PREFERRED') throw new Error('legacy preferred must remain preferred')
        expect(result.diagnostics.pps).toBeLessThan(conversionPrice(before))
        expect(after.conversionRatio).toBeGreaterThanOrEqual(before.conversionRatio)
        expect(conversionPrice(after)).toBeLessThanOrEqual(conversionPrice(before))
      }),
      { numRuns: 200, endOnFailure: true },
    )
  })

  it('converges the coupled anti-dilution PPS solve across 200 down rounds', () => {
    fc.assert(
      fc.property(arbitraryDownRoundCase, ({ pre, terms }) => {
        const result = constructRound(pre, [], RoundTermsSchema.parse(terms))
        expect(result.diagnostics.pps).toBeGreaterThan(0)
        expect(Number.isFinite(result.diagnostics.pps)).toBe(true)
      }),
      { numRuns: 200, endOnFailure: true },
    )
  })
})
