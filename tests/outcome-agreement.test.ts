import { describe, expect, it } from 'vitest'
import { CapTableSchema, type Beliefs } from '../src/core/schema'
import { mcPayouts } from '../src/core/mc'
import { expectedPayouts } from '../src/core/outcomes'
import { loadFixtures } from './fixture-harness'

const beliefPresets: Beliefs[] = [
  { p0: 0.5, p50: 40_000_000, p90: 400_000_000 },
  { p0: 0.35, p50: 80_000_000, p90: 600_000_000 },
]

describe('locked dual-engine agreement battery', () => {
  for (const { fixture } of loadFixtures().filter((entry) => entry.fixture.kind === 'waterfall')) {
    it(
      `${fixture.id} matches the closed-form integration with the locked 200,000-sample MC twin`,
      () => {
      const input = fixture.input as { capTable: unknown }
      const post = CapTableSchema.parse(input.capTable)
      for (const beliefs of beliefPresets) {
        const closed = expectedPayouts(post, beliefs)
        const sampled = mcPayouts(post, beliefs, 200_000, 42)
        for (const id of Object.keys(closed.ev)) {
          expect(Math.abs(closed.ev[id] - sampled.mean[id]), `${fixture.id} / ${id}`).toBeLessThanOrEqual(4 * sampled.se[id] + 1)
        }
      }
      },
      15_000,
    )
  }
})
