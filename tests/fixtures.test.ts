import { describe, expect, it } from 'vitest'
import './fixture-registry'
import {
  discoverFixtureFiles,
  dispatchFixture,
  loadFixtures,
  runFixtureHarness,
} from './fixture-harness'

describe('fixture harness', () => {
  it('discovers, validates, dispatches, and reports every fixture', async () => {
    const files = discoverFixtureFiles()
    const result = await runFixtureHarness()
    expect(result).toHaveLength(files.length)
    console.table(result)
  })
})

for (const { fixture } of loadFixtures().filter(
  (entry) => (entry.fixture as { disputed?: boolean }).disputed === true,
)) {
  it.fails(`${fixture.id} remains an explicit owner-review fixture`, async () => {
    await dispatchFixture(fixture)
  })
}
