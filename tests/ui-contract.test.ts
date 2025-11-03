import { describe, expect, it } from 'vitest'
import pkg from '../package.json'
import { deriveDealSpace } from '../src/app/deal-space'
import { screenReadiness } from '../src/app/readiness'
import { EXAMPLE_DECKS } from '../src/app/data/examples'
import { constructRound } from '../src/core/round'
import { DealFileSchema } from '../src/core/schema'

describe('UI contract support', () => {
  it('keeps direct dependency versions frozen exactly', () => {
    const direct = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name, version] of Object.entries(direct)) {
      expect(version, name).not.toMatch(/^[~^]/)
    }
  })

  it('normalizes SAFE provenance count and exposes per-SAFE conversion routes', () => {
    const raw = JSON.parse(JSON.stringify(EXAMPLE_DECKS[0].deal))
    delete raw.safes[0].count
    const deal = DealFileSchema.parse(raw)
    expect(deal.safes[0].count).toBe(1)
    const round = constructRound(deal.pre, deal.safes, deal.terms, deal.notes)
    expect(round.diagnostics.routeBySafe.safe1).toBeDefined()
    expect(round.diagnostics.sharesBySafe.safe1).toBeGreaterThan(0)
  })

  it('derives the locked default deal space and supports pinning dimensions', () => {
    const deal = EXAMPLE_DECKS[1].deal
    const derived = deriveDealSpace(deal.terms)
    expect(derived.preMoneyRange).toEqual([10_000_000, 40_000_000])
    expect(derived.preMoneySteps).toBe(9)
    expect(derived.pinnedInvestment).toBe(5_000_000)
    const pinned = deriveDealSpace(deal.terms, derived, {
      preMoney: true,
      pools: true,
      multiples: false,
      participations: false,
      seniority: false,
    })
    expect(pinned.preMoneyRange).toEqual([20_000_000, 20_000_000])
    expect(pinned.preMoneySteps).toBe(1)
    expect(pinned.pools).toEqual([0.15])
  })

  it('computes independent readiness states and report aggregation', () => {
    const ready = screenReadiness(EXAMPLE_DECKS[1].deal)
    expect(ready['cap-table'].state).toBe('green')
    expect(ready.round.state).toBe('green')
    expect(ready.frontier.state).toBe('green')
    expect(ready.report.state).toBe('green')

    const disputed = DealFileSchema.parse({
      ...EXAMPLE_DECKS[1].deal,
      founderBeliefs: { p0: 0.35, p10: 20_000_000, p50: 80_000_000, p90: 600_000_000 },
    })
    const amber = screenReadiness(disputed)
    expect(amber.beliefs.state).toBe('amber')
    expect(amber.report.state).toBe('red')
  })
})
