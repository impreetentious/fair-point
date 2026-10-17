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

import { enumerateDealsWithReasons } from '../src/core/bargain'
import { frontierIdentity } from '../src/app/workers/frontier-analysis'
import { NextRoundBranchesSchema } from '../src/core/schema'
import { branchesForDeal } from '../src/core/next-round'
import { constructRound } from '../src/core/round'
import { payoutsAt } from '../src/core/waterfall'

describe('saved report evidence and branches', () => {
  it('restores zero/nondefault exit and exact comparison terms after export/import', () => {
    useDealStore.getState().replaceDeal(seriesAClean, 'import')
    const deal = useDealStore.getState().deal
    const packages = enumerateDealsWithReasons(deal.space).packages
    useDealStore.getState().setExitValue(3_000_000)
    useDealStore
      .getState()
      .toggleCompare(packages[0]!.index, packages[0]!.terms, frontierIdentity(deal))
    useDealStore
      .getState()
      .toggleCompare(packages[1]!.index, packages[1]!.terms, frontierIdentity(deal))
    const exported = useDealStore.getState().exportSnapshot()
    useDealStore.getState().replaceDeal(seedWithSafes, 'example')
    expect(
      useDealStore.getState().replaceDeal(JSON.parse(JSON.stringify(exported)), 'import'),
    ).toBe(true)
    expect(useDealStore.getState().exitValue).toBe(3_000_000)
    expect(useDealStore.getState().deal.ui.reportView?.comparisons).toEqual([
      packages[0]!.terms,
      packages[1]!.terms,
    ])
    // At $3m the new investor's $5m preference exhausts the exit; common receives zero.
    expect(
      payoutsAt(constructRound(exported.pre, exported.safes, exported.terms).post, 3_000_000)
        .byClass,
    ).toMatchObject({ common: 0, 'new-round': 3_000_000 })
    useDealStore.getState().setExitValue(0)
    expect(
      DealFileSchema.parse(useDealStore.getState().exportSnapshot()).ui.reportView?.exitValue,
    ).toBe(0)
  })
  it('rejects malformed views atomically and retains the legacy exit', () => {
    const baseline = useDealStore.getState().exportSnapshot()
    for (const view of [
      { exitValue: NaN, comparisons: [] },
      { exitValue: Infinity, comparisons: [] },
      { exitValue: -1, comparisons: [] },
      { exitValue: 0, comparisons: Array(4).fill(baseline.terms) },
      { exitValue: 0, comparisons: [baseline.terms, baseline.terms] },
    ]) {
      expect(
        useDealStore
          .getState()
          .replaceDeal({ ...baseline, ui: { ...baseline.ui, reportView: view } }, 'import'),
      ).toBe(false)
      expect(useDealStore.getState().deal).toEqual(baseline)
    }
    useDealStore.getState().setExitValue(123)
    expect(useDealStore.getState().replaceDeal(seriesAClean, 'import')).toBe(true)
    expect(useDealStore.getState().exitValue).toBe(123)
    expect(useDealStore.getState().compare).toEqual([])
  })
  it('discloses absent terms without selecting a nearby point and clears terms on mathematical edits', () => {
    const state = useDealStore.getState()
    state.toggleCompare(0, { ...state.deal.terms, preMoney: 12345 }, frontierIdentity(state.deal))
    useDealStore.getState().resolveComparisons([], frontierIdentity(useDealStore.getState().deal))
    expect(useDealStore.getState().compare).toEqual([])
    expect(useDealStore.getState().unavailableComparisons).toBe(1)
    useDealStore.getState().setTerms({ ...state.deal.terms, preMoney: 21_000_000 })
    expect(useDealStore.getState().deal.ui.reportView?.comparisons).toEqual([])
  })
  it('roundtrips nondefault branches with stable IDs and rejects malformed drafts', () => {
    const deal = DealFileSchema.parse(seriesAClean)
    const branches = branchesForDeal(deal)
      .slice(0, 2)
      .map((branch, index) => ({
        ...branch,
        probability: index === 0 ? 0.25 : 0.75,
        label: index === 0 ? 'Actual down round' : 'Actual up round',
        proRata: index === 0,
      }))
    const saved = DealFileSchema.parse({ ...deal, nextRoundBranches: branches })
    expect(DealFileSchema.parse(JSON.parse(JSON.stringify(saved))).nextRoundBranches).toEqual(
      branches,
    )
    expect(branchesForDeal(deal)).toHaveLength(3)
    for (const bad of [
      branches.slice(0, 1),
      [...branches, branches[0], branches[1]],
      branches.map((branch) => ({ ...branch, probability: 0.2 })),
      branches.map((branch) => ({ ...branch, id: 'same' })),
      branches.map((branch) => ({ ...branch, probability: NaN })),
      branches.map((branch) => ({ ...branch, probability: -1 })),
    ])
      expect(NextRoundBranchesSchema.safeParse(bad).success).toBe(false)
    expect(
      NextRoundBranchesSchema.safeParse([
        ...branches,
        { ...branches[0]!, id: 'zero', probability: 0 },
      ]).success,
    ).toBe(true)
  })
})
