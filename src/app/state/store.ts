import { create } from 'zustand'
import { EXAMPLE_DECKS } from '../data/examples'
import {
  DealFileSchema,
  humanizeZodError,
  type Beliefs,
  type DealFile,
  type RoundTerms,
} from '../../core/schema'
import { deriveDealSpace, refreshDerivedSpace } from '../deal-space'

export const SCREEN_IDS = [
  'cap-table',
  'round',
  'waterfall',
  'beliefs',
  'frontier',
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
  toggleCompare: (index: number) => void
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
          : undefined,
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
  setScreen: (activeScreen) => set({ activeScreen }),
  replaceDeal: (raw, source) => parseAndUpdate(set, raw, source),
  patchDeal: (patch) => parseAndUpdate(set, patch(get().deal)),
  setTerms: (terms) => parseAndUpdate(set, refreshDerivedSpace(get().deal, terms)),
  setBeliefs: (party, beliefs) => {
    const deal = get().deal
    return parseAndUpdate(set, {
      ...deal,
      founderBeliefs: party === 'founder' || deal.sharedBeliefs ? beliefs : deal.founderBeliefs,
      investorBeliefs: party === 'investor' || deal.sharedBeliefs ? beliefs : deal.investorBeliefs,
    })
  },
  setExitValue: (exitValue) => set({ exitValue: Math.max(0, exitValue) }),
  toggleCompare: (index) => {
    const current = get().compare
    if (current.includes(index)) {
      set({ compare: current.filter((candidate) => candidate !== index) })
      return
    }
    set({ compare: [...current, index].slice(-3) })
  },
  loadExample: (id) => {
    const example = EXAMPLE_DECKS.find((candidate) => candidate.id === id)
    if (example !== undefined) parseAndUpdate(set, example.deal, 'example')
  },
  setDealSpace: (space, pins = {}) => {
    const deal = get().deal
    return parseAndUpdate(set, {
      ...deal,
      space,
      ui: {
        ...deal.ui,
        dealSpaceManual: true,
        dealSpacePins: { ...deal.ui.dealSpacePins, ...pins },
      },
    })
  },
}))
