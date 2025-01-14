import { create } from 'zustand'
import { EXAMPLE_DECKS } from '../data/examples'
import { DealFileSchema, humanizeZodError, type Beliefs, type DealFile, type RoundTerms } from '../../core/schema'

export const SCREEN_IDS = ['cap-table', 'round', 'waterfall', 'beliefs', 'frontier', 'report'] as const
export type ScreenId = (typeof SCREEN_IDS)[number]

type Store = {
  deal: DealFile
  activeScreen: ScreenId
  validation: string[]
  exitValue: number
  compare: number[]
  setScreen: (screen: ScreenId) => void
  replaceDeal: (raw: unknown) => boolean
  patchDeal: (patch: (deal: DealFile) => DealFile) => boolean
  setTerms: (terms: RoundTerms) => boolean
  setBeliefs: (party: 'founder' | 'investor', beliefs: Beliefs) => boolean
  setExitValue: (value: number) => void
  toggleCompare: (index: number) => void
  loadExample: (id: string) => void
}

function parseAndUpdate(set: (partial: Partial<Store>) => void, raw: unknown): boolean {
  const parsed = DealFileSchema.safeParse(raw)
  if (!parsed.success) {
    set({ validation: humanizeZodError(parsed.error) })
    return false
  }
  set({ deal: parsed.data, validation: [] })
  return true
}

export const useDealStore = create<Store>((set, get) => ({
  deal: EXAMPLE_DECKS[1].deal,
  activeScreen: 'cap-table',
  validation: [],
  exitValue: 21_250_000,
  compare: [],
  setScreen: (activeScreen) => set({ activeScreen }),
  replaceDeal: (raw) => parseAndUpdate(set, raw),
  patchDeal: (patch) => parseAndUpdate(set, patch(get().deal)),
  setTerms: (terms) => parseAndUpdate(set, { ...get().deal, terms }),
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
    if (example !== undefined) set({ deal: example.deal, validation: [], compare: [], exitValue: 21_250_000 })
  },
}))
