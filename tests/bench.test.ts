import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { CapTableSchema } from '../src/core/schema'
import { payoutsAt } from '../src/core/waterfall'

const benchCapTable = CapTableSchema.parse({
  classes: [
    { id: 'common', name: 'Common', kind: 'COMMON', shares: 8_000_000, holder: 'FOUNDER' },
    {
      id: 'series-a',
      name: 'Series A',
      kind: 'PREFERRED',
      shares: 2_000_000,
      holder: 'INVESTOR',
      invested: 2_000_000,
      prefMultiple: 1,
      participation: 'CAPPED',
      participationCapMultiple: 3,
    },
  ],
  grants: [],
  poolAvailable: 0,
})

describe('waterfall performance', () => {
  it('keeps payoutsAt median below 50 microseconds on the example-shaped table', () => {
    const samples = Array.from({ length: 3 }, () => {
      for (let index = 0; index < 200; index += 1) payoutsAt(benchCapTable, 1_000_000 + index)
      const start = performance.now()
      for (let index = 0; index < 5000; index += 1)
        payoutsAt(benchCapTable, 1_000_000 + (index % 1000) * 10000)
      return ((performance.now() - start) * 1000) / 5000
    }).sort((left, right) => left - right)
    const medianMicroseconds = samples[1]
    console.log(`waterfall payoutsAt median: ${medianMicroseconds.toFixed(3)} µs`)
    expect(medianMicroseconds).toBeLessThan(50)
  })
})
