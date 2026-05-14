import { describe, expect, it } from 'vitest'
import seedWithSafes from '../examples/seed-with-safes.json'
import seriesAClean from '../examples/series-a-clean.json'
import seriesBStackedDownRound from '../examples/series-b-stacked-down-round.json'
import { EXPLAINERS } from '../src/app/components/ExplainDrawer'
import { DealFileSchema } from '../src/core/schema'
import { useDealStore } from '../src/app/state/store'

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

  it('clears import-only status when an ordinary edit is invalid', () => {
    useDealStore.setState({ importStatus: { kind: 'success', message: 'Imported.' } })
    const changed = useDealStore.getState().patchDeal((deal) => ({ ...deal, name: '' }))
    expect(changed).toBe(false)
    expect(useDealStore.getState().importStatus).toBeNull()
  })

  it('ignores corrupt autosaves without marking the displayed deal invalid', () => {
    useDealStore.setState({ validation: [], importStatus: null })
    expect(useDealStore.getState().replaceDeal({ schemaVersion: '1.0.0' }, 'autosave')).toBe(false)
    expect(useDealStore.getState().validation).toEqual([])
    expect(useDealStore.getState().importStatus).toBeNull()
  })

  it('keeps the shared exit value finite and nonnegative', () => {
    useDealStore.getState().setExitValue(Number.POSITIVE_INFINITY)
    expect(useDealStore.getState().exitValue).toBe(0)
    useDealStore.getState().setExitValue(-1)
    expect(useDealStore.getState().exitValue).toBe(0)
  })
})

describe('explainers', () => {
  it('ships every explainer and gives each a reachable screen', () => {
    expect(EXPLAINERS).toHaveLength(11)
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
