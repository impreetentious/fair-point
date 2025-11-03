import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { analyze, enumerateDeals, evaluatePackage } from '../src/core/bargain'
import { DealFileSchema } from '../src/core/schema'

const deck = DealFileSchema.parse({
  schemaVersion: '1.0.0',
  name: 'Series A clean benchmark',
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

function pipeline(risk: { gamma: 0.5 | 1; w0F: number; w0I: number } | null = null) {
  const packages = enumerateDeals(deck.space)
  const points = packages.map((pkg) =>
    evaluatePackage(deck.pre, deck.safes, pkg, deck.founderBeliefs, deck.investorBeliefs, risk),
  )
  return analyze(points, deck.disagreement)
}

it('keeps the warm full 585-package EV and CRRA pipelines below the CI budget', () => {
  pipeline()
  pipeline({ gamma: 0.5, w0F: 250_000, w0I: 250_000 })
  const evStart = performance.now()
  const ev = pipeline()
  const evElapsed = performance.now() - evStart
  const crraStart = performance.now()
  const crra = pipeline({ gamma: 0.5, w0F: 250_000, w0I: 250_000 })
  const crraElapsed = performance.now() - crraStart
  console.log(`full pipeline EV: ${evElapsed.toFixed(3)} ms; CRRA: ${crraElapsed.toFixed(3)} ms`)
  expect(ev.points).toHaveLength(585)
  expect(crra.points).toHaveLength(585)
  expect(evElapsed).toBeLessThan(400)
  expect(crraElapsed).toBeLessThan(400)
}, 15_000)
