import { expect, it } from 'vitest'
import { analyze, enumerateDeals, evaluatePackage, valueOnTable } from '../src/core/bargain'
import { EXAMPLE_DECKS } from '../src/app/data/examples'

it('reproduces the deck-2 hero snapshot from the shipped engine', () => {
  const deal = EXAMPLE_DECKS.find((example) => example.id === 'series-a-clean')!.deal
  const points = enumerateDeals(deal.space).map((pkg) =>
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
  const current = evaluatePackage(
    deal.pre,
    deal.safes,
    { index: -1, terms: deal.terms },
    deal.founderBeliefs,
    deal.investorBeliefs,
    deal.risk,
  )
  const value = valueOnTable(result, current)
  expect(current.diagnostics.pps).toBeCloseTo(2.03125, 12)
  expect(current.diagnostics.investorPct).toBeCloseTo(0.2, 12)
  expect(current.diagnostics.poolIncrease).toBeCloseTo(1846153.8461538462, 8)
  expect(value).toEqual({ headline: 0, gainF: 0, gainI: 0, dominating: [] })
})
