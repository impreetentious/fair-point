import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CapTableSchema } from '../src/core/schema'
import { loadFixtures } from './fixture-harness'
import { referencePayouts } from './reference-settlement'
import { payoutsAt } from '../src/core/waterfall'
import { arbitrarySettlementCase } from './generators'

describe('independent reference settlement', () => {
  it('matches the engine across the full waterfall fixture battery', () => {
    const fixtures = loadFixtures().filter((entry) => entry.fixture.kind === 'waterfall')
    for (const { fixture } of fixtures) {
      const input = fixture.input as { capTable: unknown; exitValue: number }
      const post = CapTableSchema.parse(input.capTable)
      const actual = payoutsAt(post, input.exitValue)
      const reference = referencePayouts(post, input.exitValue)
      for (const id of Object.keys(actual.byClass))
        expect(actual.byClass[id]).toBeCloseTo(reference.byClass[id], 2)
      for (const id of Object.keys(actual.byGrant))
        expect(actual.byGrant[id]).toBeCloseTo(reference.byGrant[id], 2)
    }
  })

  it('matches the independent enumerator across 500 randomized settlement tables', () => {
    fc.assert(
      fc.property(arbitrarySettlementCase, ({ post, exitValue }) => {
        const actual = payoutsAt(post, exitValue)
        const reference = referencePayouts(post, exitValue)
        for (const id of Object.keys(actual.byClass))
          expect(actual.byClass[id]).toBeCloseTo(reference.byClass[id], 2)
        for (const id of Object.keys(actual.byGrant))
          expect(actual.byGrant[id]).toBeCloseTo(reference.byGrant[id], 2)
      }),
      { numRuns: 500 },
    )
  })
})
