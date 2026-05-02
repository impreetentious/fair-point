import { describe, expect, it } from 'vitest'
import { analyze, enumerateDeals, evaluatePackage } from '../src/core/bargain'
import { regimes } from '../src/core/breakpoints'
import { constructRound } from '../src/core/round'
import { payoutsAt } from '../src/core/waterfall'
import { EXAMPLE_DECKS } from '../src/app/data/examples'

describe('shipped example decks', () => {
  for (const example of EXAMPLE_DECKS) {
    it(`loads and analyzes ${example.label}`, () => {
      const deal = example.deal
      const round = constructRound(deal.pre, deal.safes, deal.terms)
      const allRegimes = regimes(round.post)
      expect(allRegimes.length).toBeGreaterThan(0)
      expect(() => payoutsAt(round.post, 0)).not.toThrow()
      const packages = enumerateDeals(deal.space)
      const points = packages.map((pkg) =>
        evaluatePackage(
          deal.pre,
          deal.safes,
          pkg,
          deal.founderBeliefs,
          deal.investorBeliefs,
          deal.risk,
        ),
      )
      const result = analyze(points, deal.disagreement)
      expect(points).toHaveLength(585)
      expect(result.points).toHaveLength(585)
      expect({ zopa: result.zopa, nash: result.nash }).toMatchSnapshot()
    }, 30_000)
  }

  it('reproduces the Series A clean diagnostics and waterfall breakpoints', () => {
    const deal = EXAMPLE_DECKS.find((example) => example.id === 'series-a-clean')!.deal
    const round = constructRound(deal.pre, deal.safes, deal.terms)
    expect(round.diagnostics.pps).toBeCloseTo(2.03125, 9)
    const breaks = regimes(round.post).map((regime) => regime.from)
    expect(breaks.some((value) => Math.abs(value - 5_000_000) < 0.01)).toBe(true)
    expect(breaks.some((value) => Math.abs(value - 21_250_000) < 0.01)).toBe(true)
  })
})
