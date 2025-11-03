import { describe, expect, it } from 'vitest'
import { CapTableSchema, DealFileSchema, RoundTermsSchema, SafeSchema } from '../src/core/schema'

type RawRecord = Record<string, unknown>
type RawDeal = {
  schemaVersion: string
  name: string
  pre: {
    classes: RawRecord[]
    grants: RawRecord[]
    poolAvailable: number
    promisedOptions?: number
  }
  safes: RawRecord[]
  terms: RawRecord
  founderBeliefs: RawRecord
  investorBeliefs: RawRecord
  sharedBeliefs: boolean
  disagreement: RawRecord
  space: RawRecord
}

function validDeal(): RawDeal {
  return {
    schemaVersion: '1.0.0',
    name: 'Validation baseline',
    pre: {
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 10_000_000, holder: 'FOUNDER' },
        {
          id: 'series-a',
          name: 'Series A',
          kind: 'PREFERRED',
          shares: 1_000_000,
          holder: 'INVESTOR',
          invested: 1_000_000,
          prefMultiple: 1,
          participation: 'NONE',
        },
      ],
      grants: [],
      poolAvailable: 0,
    },
    safes: [],
    terms: {
      preMoney: 10_000_000,
      investment: 1_000_000,
      poolTargetPost: 0.1,
      prefMultiple: 1,
      participation: 'NONE',
      seniority: 'PARI',
    },
    founderBeliefs: { p0: 0.2, p50: 20_000_000, p90: 60_000_000 },
    investorBeliefs: { p0: 0.2, p50: 20_000_000, p90: 60_000_000 },
    sharedBeliefs: true,
    disagreement: { dF: 0, dI: 0 },
    space: {
      preMoneyRange: [5_000_000, 20_000_000],
      preMoneySteps: 9,
      pools: [0.1],
      multiples: [1],
      participations: ['NONE'],
      seniority: 'PARI',
    },
  }
}

function invalid(mutator: (deal: RawDeal) => void): void {
  const deal = validDeal()
  mutator(deal)
  expect(DealFileSchema.safeParse(deal).success).toBe(false)
}

describe('V1–V16 schema contract', () => {
  it('normalizes every V16 default and the documented pinned investment assumption', () => {
    const parsed = DealFileSchema.parse(validDeal())
    const preferred = parsed.pre.classes.find((candidate) => candidate.id === 'series-a')
    expect(parsed.pre.promisedOptions).toBe(0)
    expect(parsed.space.pinnedInvestment).toBe(parsed.terms.investment)
    expect(preferred).toMatchObject({
      originalIssuePrice: 1,
      seniorityTier: 1,
      conversionRatio: 1,
      antiDilution: 'NONE',
    })
    expect(
      SafeSchema.parse({
        id: 'safe',
        name: 'Safe',
        amount: 1,
        kind: 'PRE_MONEY',
        valuationCap: 10,
      }),
    ).toMatchObject({ holder: 'OTHER' })
  })

  it('enforces V1, V2, V3, V5, V7, V9, V10, V11, V12, V13, V14 and V15', () => {
    invalid((deal) => {
      deal.terms.participation = 'CAP2'
      deal.terms.prefMultiple = 2
    })
    invalid((deal) => {
      deal.safes = [
        { id: 'one', name: 'One', amount: 600_000, kind: 'POST_MONEY', valuationCap: 1_000_000 },
        { id: 'two', name: 'Two', amount: 400_001, kind: 'POST_MONEY', valuationCap: 1_000_000 },
      ]
    })
    invalid((deal) => {
      deal.terms = {
        preMoney: 100,
        investment: 10_000,
        poolTargetPost: 0.4,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      }
    })
    invalid((deal) => {
      deal.founderBeliefs = { p0: 0.2, p10: 25, p50: 20, p90: 60 }
    })
    invalid((deal) => {
      deal.pre.classes = [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 1, holder: 'FOUNDER' },
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `pref-${index}`,
          name: `Pref ${index}`,
          kind: 'PREFERRED',
          shares: 1,
          holder: 'OTHER',
          invested: 1,
          prefMultiple: 1,
          participation: 'NONE',
        })),
      ]
    })
    invalid((deal) => {
      deal.pre.grants = [{ id: 'common', options: 1, strike: 0, holder: 'FOUNDER' }]
    })
    invalid((deal) => {
      deal.pre.classes = [
        {
          id: 'preferred',
          name: 'Preferred',
          kind: 'PREFERRED',
          shares: 1,
          holder: 'OTHER',
          invested: 1,
          prefMultiple: 1,
          participation: 'NONE',
        },
      ]
    })
    invalid((deal) => {
      deal.pre.classes[1].originalIssuePrice = 9
    })
    invalid((deal) => {
      deal.terms.pricedPerShare = 1
    })
    invalid((deal) => {
      deal.space = { ...deal.space, preMoneyRange: [20, 10] }
    })
    invalid((deal) => {
      deal.safes = [{ id: 'empty', name: 'Empty', amount: 1, kind: 'POST_MONEY' }]
    })
    invalid((deal) => {
      deal.pre.promisedOptions = -1
    })
  })

  it('enforces V4 as a non-fatal computed warning and V6/V8 field constraints', () => {
    const poolAboveTarget = validDeal()
    poolAboveTarget.pre.poolAvailable = 9_000_000
    expect(DealFileSchema.safeParse(poolAboveTarget).success).toBe(true)
    expect(
      CapTableSchema.safeParse({
        classes: [
          {
            id: 'common',
            name: 'Common',
            kind: 'COMMON',
            shares: 1,
            holder: 'FOUNDER',
            invested: 1,
          },
        ],
        grants: [],
        poolAvailable: 0,
      }).success,
    ).toBe(false)
    expect(
      RoundTermsSchema.safeParse({
        preMoney: 1,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      }).success,
    ).toBe(true)
    expect(
      RoundTermsSchema.safeParse({
        preMoney: 0,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      }).success,
    ).toBe(false)
    expect(
      SafeSchema.safeParse({ id: 'bad', name: 'Bad', amount: 1, kind: 'PRE_MONEY', discount: 1 })
        .success,
    ).toBe(false)
  })
})
