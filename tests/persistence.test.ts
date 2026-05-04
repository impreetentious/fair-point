import { describe, expect, it } from 'vitest'
import seedWithSafes from '../examples/seed-with-safes.json'
import seriesAClean from '../examples/series-a-clean.json'
import seriesBStackedDownRound from '../examples/series-b-stacked-down-round.json'
import { EXPLAINERS } from '../src/app/components/ExplainDrawer'
import { DealFileSchema } from '../src/core/schema'

describe('deal-file persistence', () => {
  for (const [label, raw] of [
    ['Seed with SAFEs', seedWithSafes],
    ['Series A clean', seriesAClean],
    ['Series B stacked + down round', seriesBStackedDownRound],
  ] as const) {
    it(`preserves ${label} through export and import`, () => {
      const exported = DealFileSchema.parse(raw)
      const imported = DealFileSchema.parse(JSON.parse(JSON.stringify(exported)))
      expect(imported).toEqual(exported)
    })
  }

  it('normalizes an omitted pinned investment before serializing', () => {
    const raw = JSON.parse(JSON.stringify(seriesAClean)) as Record<string, unknown>
    delete (raw.space as Record<string, unknown>).pinnedInvestment
    const normalized = DealFileSchema.parse(raw)
    expect(normalized.space.pinnedInvestment).toBe(normalized.terms.investment)
    expect(DealFileSchema.parse(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized)
  })
})

describe('explainers', () => {
  it('ships all eight explainers and gives each a reachable screen', () => {
    expect(EXPLAINERS).toHaveLength(8)
    expect(
      EXPLAINERS.every(
        (explainer) =>
          explainer.screens.length > 0 &&
          explainer.bullets.length >= 5 &&
          explainer.bullets.length <= 8 &&
          explainer.body.trim().split(/\s+/).length <= 400,
      ),
    ).toBe(true)
  })
})
