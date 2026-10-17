import { create } from 'zustand'
import { EXAMPLE_DECKS } from '../data/examples'
import {
  DealFileSchema,
  roundTermsIdentity,
  type DealPoint,
  humanizeZodError,
  type Beliefs,
  type DealFile,
  type RoundTerms,
} from '../../core/schema'
import { frontierIdentity } from '../workers/frontier-analysis'
import { deriveDealSpace, refreshDerivedSpace } from '../deal-space'

export const SCREEN_IDS = [
  'cap-table',
  'round',
  'waterfall',
  'beliefs',
  'frontier',
  'leverage',
  'report',
] as const
export type ScreenId = (typeof SCREEN_IDS)[number]

type Store = {
  deal: DealFile
  activeScreen: ScreenId
  validation: string[]
  importStatus: { kind: 'success' | 'error'; message: string } | null
  exitValue: number
  compare: number[]
  setScreen: (screen: ScreenId) => void
  replaceDeal: (raw: unknown, source?: 'import' | 'autosave' | 'example') => boolean
  patchDeal: (patch: (deal: DealFile) => DealFile) => boolean
  setTerms: (terms: RoundTerms) => boolean
  setBeliefs: (party: 'founder' | 'investor', beliefs: Beliefs) => boolean
  setExitValue: (value: number) => void
  toggleCompare: (index: number, terms?: RoundTerms, identity?: string) => void
  resolveComparisons: (points: DealPoint[], identity: string) => void
  unavailableComparisons: number
  exportSnapshot: () => DealFile
  loadExample: (id: string) => void
  setDealSpace: (
    space: DealFile['space'],
    pins?: Partial<DealFile['ui']['dealSpacePins']>,
  ) => boolean
}

function isNewerSchemaVersion(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) return false
  const actual = version.split('.').map(Number)
  const current = [1, 0, 0]
  for (let index = 0; index < current.length; index += 1) {
    if (actual[index] !== current[index]) return actual[index] > current[index]
  }
  return false
}

function parseAndUpdate(
  set: (partial: Partial<Store>) => void,
  raw: unknown,
  source?: 'import' | 'autosave' | 'example',
): boolean {
  const parsed = DealFileSchema.safeParse(raw)
  if (!parsed.success) {
    if (source === 'autosave') return false
    const messages = humanizeZodError(parsed.error)
    set({
      validation: messages,
      importStatus:
        source === 'import'
          ? {
              kind: 'error',
              message: isNewerSchemaVersion(raw)
                ? 'This deal file was written by a newer version of Fairpoint.'
                : (messages[0] ?? 'Deal file is invalid.'),
            }
          : null,
    })
    return false
  }
  const deal = parsed.data.ui.dealSpaceManual
    ? parsed.data
    : {
        ...parsed.data,
        space: deriveDealSpace(parsed.data.terms, null, parsed.data.ui.dealSpacePins),
      }
  set({
    deal,
    validation: [],
    compare: [],
    unavailableComparisons: 0,
    ...(deal.ui.reportView ? { exitValue: deal.ui.reportView.exitValue } : {}),
    importStatus: source === 'import' ? { kind: 'success', message: 'Deal file imported.' } : null,
  })
  return true
}

export const useDealStore = create<Store>((set, get) => ({
  deal: EXAMPLE_DECKS[1].deal,
  activeScreen: 'cap-table',
  validation: [],
  importStatus: null,
  exitValue: 21_250_000,
  compare: [],
  unavailableComparisons: 0,
  exportSnapshot: () => {
    const state = get()
    return structuredClone({
      ...state.deal,
      ui: {
        ...state.deal.ui,
        reportView: {
          exitValue: state.exitValue,
          comparisons: state.deal.ui.reportView?.comparisons ?? [],
        },
      },
    })
  },
  resolveComparisons: (points, identity) => {
    if (frontierIdentity(get().deal) !== identity) return
    const terms = get().deal.ui.reportView?.comparisons ?? []
    const matched = terms.map(
      (term) =>
        points.find((point) => roundTermsIdentity(point.pkg.terms) === roundTermsIdentity(term))
          ?.pkg.index,
    )
    set({
      compare: matched.filter((index): index is number => index !== undefined),
      unavailableComparisons: matched.filter((index) => index === undefined).length,
    })
  },
  setScreen: (activeScreen) => set({ activeScreen }),
  replaceDeal: (raw, source) => parseAndUpdate(set, raw, source),
  patchDeal: (patch) => {
    const before = get().deal
    const candidate = patch(before)
    if (frontierIdentity(before) !== frontierIdentity(candidate) && candidate.ui.reportView)
      candidate.ui = {
        ...candidate.ui,
        reportView: { ...candidate.ui.reportView, comparisons: [] },
      }
    const previous = get()
    const changed = parseAndUpdate(set, candidate)
    if (changed && frontierIdentity(before) === frontierIdentity(get().deal))
      set({ compare: previous.compare, unavailableComparisons: previous.unavailableComparisons })
    return changed
  },
  setTerms: (terms) => get().patchDeal((deal) => refreshDerivedSpace(deal, terms)),
  setBeliefs: (party, beliefs) => {
    const deal = get().deal
    return get().patchDeal(() => ({
      ...deal,
      founderBeliefs: party === 'founder' || deal.sharedBeliefs ? beliefs : deal.founderBeliefs,
      investorBeliefs: party === 'investor' || deal.sharedBeliefs ? beliefs : deal.investorBeliefs,
    }))
  },
  setExitValue: (exitValue) => {
    const value = Number.isFinite(exitValue) ? Math.max(0, exitValue) : 0
    const deal = get().deal
    set({
      exitValue: value,
      deal: {
        ...deal,
        ui: {
          ...deal.ui,
          reportView: { exitValue: value, comparisons: deal.ui.reportView?.comparisons ?? [] },
        },
      },
    })
  },
  toggleCompare: (index, terms, identity) => {
    const state = get()
    if (identity && frontierIdentity(state.deal) !== identity) return
    const current = state.compare
    const next = current.includes(index)
      ? current.filter((candidate) => candidate !== index)
      : [...current, index].slice(-3)
    const existing = state.deal.ui.reportView?.comparisons ?? []
    const selectedTerms = terms
      ? current.includes(index)
        ? existing.filter(
            (candidate) => roundTermsIdentity(candidate) !== roundTermsIdentity(terms),
          )
        : [
            ...existing.filter(
              (candidate) => roundTermsIdentity(candidate) !== roundTermsIdentity(terms),
            ),
            structuredClone(terms),
          ].slice(-3)
      : existing
    set({
      compare: next,
      deal: {
        ...state.deal,
        ui: {
          ...state.deal.ui,
          reportView: { exitValue: state.exitValue, comparisons: selectedTerms },
        },
      },
    })
  },
  loadExample: (id) => {
    const example = EXAMPLE_DECKS.find((candidate) => candidate.id === id)
    if (example !== undefined) parseAndUpdate(set, example.deal, 'example')
  },
  setDealSpace: (space, pins = {}) => {
    const deal = get().deal
    return get().patchDeal(() => ({
      ...deal,
      space,
      ui: {
        ...deal.ui,
        dealSpaceManual: true,
        dealSpacePins: { ...deal.ui.dealSpacePins, ...pins },
      },
    }))
  },
}))
