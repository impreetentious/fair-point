import seedWithSafes from '../../../examples/seed-with-safes.json'
import seriesAClean from '../../../examples/series-a-clean.json'
import seriesBStackedDownRound from '../../../examples/series-b-stacked-down-round.json'
import { DealFileSchema, type DealFile } from '../../core/schema'

export type ExampleDeck = { id: string; label: string; deal: DealFile }

export const EXAMPLE_DECKS: ExampleDeck[] = [
  { id: 'seed-with-safes', label: 'Seed with SAFEs', deal: DealFileSchema.parse(seedWithSafes) },
  { id: 'series-a-clean', label: 'Series A clean', deal: DealFileSchema.parse(seriesAClean) },
  { id: 'series-b-stacked-down-round', label: 'Series B stacked + down round', deal: DealFileSchema.parse(seriesBStackedDownRound) },
]
