import { describe, expect, it } from 'vitest'
import './fixture-registry'
import { discoverFixtureFiles, runFixtureHarness } from './fixture-harness'

describe('fixture harness', () => {
  it('discovers, validates, dispatches, and reports every fixture', async () => {
    const files = discoverFixtureFiles()
    const result = await runFixtureHarness()
    expect(result).toHaveLength(files.length)
    console.table(result)
  })
})
