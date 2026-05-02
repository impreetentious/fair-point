import fc from 'fast-check'
import { CapTableSchema, type CapTable } from '../src/core/schema'

const positiveShares = fc.integer({ min: 1, max: 20_000 })
const invested = fc.integer({ min: 1, max: 2_000_000 })
const conversionRatio = fc.double({ min: 0.5, max: 2, noNaN: true, noDefaultInfinity: true })

/** §7.4 settlement family: common + 1–5 preferred, tiers, caps, and 0–3 grants. */
export const arbitraryCapTable: fc.Arbitrary<CapTable> = fc
  .record({
    commonShares: positiveShares,
    preferred: fc.array(
      fc.record({
        shares: positiveShares,
        invested,
        prefMultiple: fc.constantFrom(1, 2),
        participation: fc.constantFrom<'NONE' | 'FULL' | 'CAPPED'>('NONE', 'FULL', 'CAPPED'),
        capExtra: fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),
        tier: fc.integer({ min: 1, max: 3 }),
        conversionRatio,
      }),
      { minLength: 1, maxLength: 5 },
    ),
    grants: fc.array(
      fc.record({
        options: positiveShares,
        strike: fc.integer({ min: 0, max: 500 }),
        holder: fc.constantFrom<'FOUNDER' | 'OTHER'>('FOUNDER', 'OTHER'),
        instrument: fc.constantFrom<'OPTION' | 'WARRANT'>('OPTION', 'WARRANT'),
      }),
      { minLength: 0, maxLength: 3 },
    ),
  })
  .map(({ commonShares, preferred, grants }) =>
    CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: commonShares, holder: 'FOUNDER' },
        ...preferred.map((item, index) => ({
          id: `preferred-${index}`,
          name: `Preferred ${index + 1}`,
          kind: 'PREFERRED' as const,
          shares: item.shares,
          holder: index === 0 ? ('INVESTOR' as const) : ('OTHER' as const),
          invested: item.invested,
          originalIssuePrice: item.invested / item.shares,
          prefMultiple: item.prefMultiple,
          participation: item.participation,
          participationCapMultiple:
            item.participation === 'CAPPED' ? item.prefMultiple + item.capExtra : undefined,
          seniorityTier: item.tier,
          conversionRatio: item.conversionRatio,
          antiDilution: 'NONE' as const,
        })),
      ],
      grants: grants.map((grant, index) => ({ id: `grant-${index}`, ...grant })),
      poolAvailable: 0,
    }),
  )

export const arbitrarySettlementCase = arbitraryCapTable.chain((post) => {
  const investedTotal = post.classes.reduce(
    (sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.invested : 0),
    0,
  )
  return fc.integer({ min: 0, max: Math.max(1, 20 * investedTotal) }).map((exitValue) => ({
    post,
    exitValue,
  }))
})

/** T-03 family: 40–60 grants with repeated strikes and a conventional preferred stack. */
export const arbitraryGrantExerciseCapTable: fc.Arbitrary<CapTable> = fc
  .record({
    commonShares: fc.integer({ min: 100, max: 20_000 }),
    preferredShares: fc.integer({ min: 100, max: 20_000 }),
    invested: fc.integer({ min: 1_000, max: 2_000_000 }),
    strikes: fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 20, maxLength: 30 }),
    options: fc.array(fc.integer({ min: 1, max: 5_000 }), { minLength: 40, maxLength: 60 }),
  })
  .map(({ commonShares, preferredShares, invested: amount, strikes, options }) =>
    CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: commonShares, holder: 'FOUNDER' },
        {
          id: 'preferred',
          name: 'Preferred',
          kind: 'PREFERRED',
          shares: preferredShares,
          holder: 'INVESTOR',
          invested: amount,
          originalIssuePrice: amount / preferredShares,
          prefMultiple: 1,
          participation: 'NONE',
          seniorityTier: 1,
          conversionRatio: 1,
          antiDilution: 'NONE',
        },
      ],
      grants: options.map((grantOptions, index) => ({
        id: `grant-${index}`,
        options: grantOptions,
        strike: strikes[index % strikes.length]!,
        holder: index % 2 === 0 ? ('FOUNDER' as const) : ('OTHER' as const),
        instrument: index % 3 === 0 ? ('WARRANT' as const) : ('OPTION' as const),
      })),
      poolAvailable: 0,
    }),
  )

/** T-18 family: 2–4 equal-priority capped preferred classes with interacting caps. */
export const arbitraryCappedCapTable: fc.Arbitrary<CapTable> = fc
  .record({
    commonShares: fc.integer({ min: 1, max: 20_000 }),
    preferred: fc.array(
      fc.record({
        shares: positiveShares,
        invested,
        prefMultiple: fc.constantFrom(1, 2),
        capExtra: fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),
        tier: fc.integer({ min: 1, max: 3 }),
        conversionRatio,
      }),
      { minLength: 2, maxLength: 4 },
    ),
  })
  .map(({ commonShares, preferred }) =>
    CapTableSchema.parse({
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: commonShares, holder: 'FOUNDER' },
        ...preferred.map((item, index) => ({
          id: `capped-${index}`,
          name: `Capped ${index + 1}`,
          kind: 'PREFERRED' as const,
          shares: item.shares,
          holder: index === 0 ? ('INVESTOR' as const) : ('OTHER' as const),
          invested: item.invested,
          originalIssuePrice: item.invested / item.shares,
          prefMultiple: item.prefMultiple,
          participation: 'CAPPED' as const,
          participationCapMultiple: item.prefMultiple + item.capExtra,
          seniorityTier: item.tier,
          conversionRatio: item.conversionRatio,
          antiDilution: 'NONE' as const,
        })),
      ],
      grants: [],
      poolAvailable: 0,
    }),
  )

/** Down-round BWA / full-ratchet cases with PPS below the original $1 conversion price. */
export const arbitraryDownRoundCase = fc
  .record({
    commonShares: fc.integer({ min: 2_000_000, max: 5_000_000 }),
    preferredFraction: fc.double({ min: 0.05, max: 0.4, noNaN: true, noDefaultInfinity: true }),
    investment: fc.integer({ min: 100_000, max: 1_000_000 }),
    antiDilution: fc.constantFrom<'BWA' | 'FULL_RATCHET'>('BWA', 'FULL_RATCHET'),
  })
  .map(({ commonShares, preferredFraction, investment, antiDilution }) => {
    const preferredShares = Math.floor(commonShares * preferredFraction)
    return {
      pre: CapTableSchema.parse({
        classes: [
          { id: 'common', name: 'Common', kind: 'COMMON', shares: commonShares, holder: 'FOUNDER' },
          {
            id: 'legacy',
            name: 'Legacy Preferred',
            kind: 'PREFERRED',
            shares: preferredShares,
            holder: 'INVESTOR',
            invested: preferredShares,
            originalIssuePrice: 1,
            prefMultiple: 1,
            participation: 'NONE',
            seniorityTier: 1,
            conversionRatio: 1,
            antiDilution,
          },
        ],
        grants: [],
        poolAvailable: 0,
      }),
      terms: {
        // V lies between P and C+P: a finite full-ratchet fixed point while
        // still making the initial priced-round PPS strictly below $1.
        preMoney: (commonShares + preferredShares) / 2,
        investment,
        poolTargetPost: 0,
        prefMultiple: 1 as const,
        participation: 'NONE' as const,
        seniority: 'PARI' as const,
      },
    }
  })
