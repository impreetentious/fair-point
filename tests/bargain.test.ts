import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  analyze,
  enumerateDeals,
  enumerateDealsWithReasons,
  evaluatePackage,
  valueOnTable,
} from '../src/core/bargain'
import { analyzeN } from '../src/core/bargain-n'
import { DealFileSchema, type DealPoint, type MultiPartyDealPoint } from '../src/core/schema'

function point(index: number, uF: number, uI: number): DealPoint {
  return {
    pkg: {
      index,
      terms: {
        preMoney: 1,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      },
    },
    uF,
    uI,
    uF_underI: uF,
    uI_underF: uI,
    metric: 'EV',
    diagnostics: { pps: 1, investorPct: 0.5, poolIncrease: 0 },
  }
}

function multiPoint(index: number, utilities: Record<string, number>): MultiPartyDealPoint {
  return {
    pkg: {
      index,
      terms: {
        preMoney: 1,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      },
    },
    utilities,
    metric: 'EV',
    diagnostics: { pps: 1, investorPct: 0.5, poolIncrease: 0 },
  }
}

const pointSets = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 })), {
    minLength: 2,
    maxLength: 16,
  })
  .map((pairs) => pairs.map(([uF, uI], index) => point(index, uF, uI)))

const multiPointSets = fc
  .array(
    fc.tuple(
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 500 }),
    ),
    { minLength: 2, maxLength: 16 },
  )
  .map((triples) => triples.map(([a, b, c], index) => multiPoint(index, { A: a, B: b, C: c })))

const disagreement = { dF: 0, dI: 0 }
const multiDisagreement = { A: 0, B: 0, C: 0 }
const parties = ['A', 'B', 'C'] as const

function seriesADeal() {
  return DealFileSchema.parse({
    schemaVersion: '1.0.0',
    name: 'Series A clean',
    pre: {
      classes: [
        { id: 'common', name: 'Common', kind: 'COMMON', shares: 8_000_000, holder: 'FOUNDER' },
      ],
      grants: [],
      poolAvailable: 0,
      promisedOptions: 0,
    },
    safes: [],
    terms: {
      preMoney: 20_000_000,
      investment: 5_000_000,
      poolTargetPost: 0.15,
      prefMultiple: 1,
      participation: 'NONE',
      seniority: 'PARI',
    },
    founderBeliefs: { p0: 0.35, p50: 80_000_000, p90: 600_000_000 },
    investorBeliefs: { p0: 0.35, p50: 80_000_000, p90: 600_000_000 },
    sharedBeliefs: true,
    disagreement: { dF: 5_000_000, dI: 2_500_000 },
    space: {
      preMoneyRange: [10_000_000, 40_000_000],
      preMoneySteps: 9,
      pools: [0.1, 0.125, 0.15, 0.175, 0.2],
      multiples: [1, 1.5, 2, 3],
      participations: ['NONE', 'CAP2', 'CAP3', 'FULL'],
      seniority: 'PARI',
    },
  })
}

describe('bargaining engine', () => {
  it('enumerates the locked 585-valid / 720-raw package grid with stable holes', () => {
    const deal = seriesADeal()
    const packages = enumerateDeals(deal.space)
    expect(packages).toHaveLength(585)
    expect(packages[0].index).toBe(0)
    expect(packages.at(-1)?.index).toBe(719)
    expect(packages.some((pkg) => pkg.index === 9)).toBe(false)
    expect(packages.some((pkg) => pkg.index === 13)).toBe(false)
    expect(packages.some((pkg) => pkg.index === 14)).toBe(false)
  })

  it('records V3-infeasible frontier cells without changing raw package indices', () => {
    const deal = seriesADeal()
    const enumeration = enumerateDealsWithReasons({
      ...deal.space,
      preMoneyRange: [2_000_000, 2_000_000],
      preMoneySteps: 1,
      pinnedInvestment: 8_000_000,
      pools: [0.2],
      multiples: [1],
      participations: ['NONE'],
    })

    expect(enumeration.packages).toEqual([])
    expect(enumeration.skipped).toEqual([{ index: 0, reason: 'V3' }])
    expect(analyze([], deal.disagreement)).toMatchObject({
      zopa: false,
      points: [],
    })
  })

  it('evaluates EV and CE coordinates through the core pipeline', () => {
    const deal = seriesADeal()
    const pkg = enumerateDeals(deal.space)[0]
    const ev = evaluatePackage(deal.pre, deal.safes, pkg, deal.founderBeliefs, deal.investorBeliefs)
    const ce = evaluatePackage(
      deal.pre,
      deal.safes,
      pkg,
      deal.founderBeliefs,
      deal.investorBeliefs,
      { gamma: 0.5, w0F: 250_000, w0I: 250_000 },
    )
    expect(ev.metric).toBe('EV')
    expect(ce.metric).toBe('CE')
    expect(ev.uF).toBeGreaterThan(0)
    expect(ev.uI).toBeGreaterThan(0)
    expect(ce.uF).toBeGreaterThan(0)
  })

  it('satisfies Nash and KS affine invariance over 300 randomized clouds', () => {
    fc.assert(
      fc.property(
        pointSets,
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (points, scaleF, scaleI, offsetF, offsetI) => {
          const original = analyze(points, disagreement)
          const transformed = points.map((candidate) =>
            point(
              candidate.pkg.index,
              candidate.uF * scaleF + offsetF,
              candidate.uI * scaleI + offsetI,
            ),
          )
          const transformedResult = analyze(transformed, { dF: offsetF, dI: offsetI })
          expect(transformedResult.nash).toBe(original.nash)
          expect(transformedResult.ks).toBe(original.ks)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('satisfies Nash discrete IIA over 200 randomized point deletions', () => {
    fc.assert(
      fc.property(
        pointSets,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
        (points, keepFlags) => {
          const original = analyze(points, disagreement)
          if (original.nash === null) return
          const reduced = points.filter(
            (candidate, index) =>
              candidate.pkg.index === original.nash || keepFlags[index % keepFlags.length],
          )
          expect(analyze(reduced, disagreement).nash).toBe(original.nash)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('commutes with the two-party symmetry transform and keeps all solutions on the frontier', () => {
    fc.assert(
      fc.property(pointSets, (points) => {
        const result = analyze(points, disagreement)
        const mirrored = analyze(
          points.map((candidate) => point(candidate.pkg.index, candidate.uI, candidate.uF)),
          disagreement,
        )
        for (const selection of [result.nash, result.ks, result.egalitarian, result.utilitarian]) {
          expect(selection).not.toBeNull()
          expect(result.frontier).toContain(selection)
        }
        expect(mirrored.nash).toBe(result.nash)
        expect(mirrored.ks).toBe(result.ks)
      }),
      { numRuns: 200 },
    )
  })

  it('returns the exact single-package value-on-table result', () => {
    const points = [
      point(0, 5, 5),
      point(1, 7, 7),
      point(2, 10, 5),
      point(3, 5, 12),
      point(4, 8, 8),
    ]
    expect(valueOnTable(analyze(points, disagreement), points[0])).toEqual({
      headline: 7,
      gainF: 5,
      gainI: 7,
      dominating: [4, 1, 3],
    })
  })
})

describe('n-party bargaining (§6.19 defining axioms)', () => {
  it('satisfies n-party Nash and KS affine invariance over 300 randomized 3-party clouds', () => {
    fc.assert(
      fc.property(
        multiPointSets,
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (points, scaleA, scaleB, scaleC, offsetA, offsetB, offsetC) => {
          const original = analyzeN(points, multiDisagreement, [...parties])
          const transformed = points.map((candidate) =>
            multiPoint(candidate.pkg.index, {
              A: candidate.utilities.A * scaleA + offsetA,
              B: candidate.utilities.B * scaleB + offsetB,
              C: candidate.utilities.C * scaleC + offsetC,
            }),
          )
          const transformedResult = analyzeN(transformed, { A: offsetA, B: offsetB, C: offsetC }, [
            ...parties,
          ])
          expect(transformedResult.nash).toBe(original.nash)
          expect(transformedResult.ks).toBe(original.ks)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('satisfies n-party Nash discrete IIA over 200 randomized point deletions', () => {
    fc.assert(
      fc.property(
        multiPointSets,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
        (points, keepFlags) => {
          const original = analyzeN(points, multiDisagreement, [...parties])
          if (original.nash === null) return
          const reduced = points.filter(
            (candidate, index) =>
              candidate.pkg.index === original.nash || keepFlags[index % keepFlags.length],
          )
          expect(analyzeN(reduced, multiDisagreement, [...parties]).nash).toBe(original.nash)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('keeps egalitarian and utilitarian selections inside IR and on the discrete frontier', () => {
    fc.assert(
      fc.property(multiPointSets, (points) => {
        const result = analyzeN(points, multiDisagreement, [...parties])
        for (const selection of [result.nash, result.ks, result.egalitarian, result.utilitarian]) {
          if (selection === null) {
            expect(result.zopa).toBe(false)
            continue
          }
          expect(result.ir).toContain(selection)
          expect(result.frontier).toContain(selection)
        }
      }),
      { numRuns: 200 },
    )
  })
})
