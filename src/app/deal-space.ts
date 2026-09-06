import type { DealFile, DealSpace, RoundTerms } from '../core/schema'

const DEFAULT_POOLS = [0.1, 0.125, 0.15, 0.175, 0.2]
const DEFAULT_MULTIPLES: RoundTerms['prefMultiple'][] = [1, 1.5, 2, 3]
const DEFAULT_PARTICIPATIONS: RoundTerms['participation'][] = ['NONE', 'CAP2', 'CAP3', 'FULL']

export function deriveDealSpace(
  terms: RoundTerms,
  current: DealSpace | null = null,
  pins = emptyPins(),
): DealSpace {
  const preMoney =
    terms.preMoney ??
    (terms.pricedPerShare === undefined ? 1_000_000 : terms.pricedPerShare * 10_000_000)
  const pinnedInvestment = terms.investment
  return {
    preMoneyRange: pins.preMoney
      ? [preMoney, preMoney]
      : (current?.preMoneyRange ?? [preMoney * 0.5, preMoney * 2]),
    preMoneySteps: pins.preMoney ? 1 : (current?.preMoneySteps ?? 9),
    pinnedInvestment,
    // A 0% pool target is a legal round term but not a legal deal-space pool, which
    // must be a positive fraction. Fall back to the ladder rather than derive a space
    // the deal schema rejects — the store would otherwise hold, and export, a deal
    // that cannot be imported again.
    pools:
      pins.pools && terms.poolTargetPost > 0
        ? [terms.poolTargetPost]
        : (current?.pools ?? DEFAULT_POOLS),
    multiples: pins.multiples ? [terms.prefMultiple] : (current?.multiples ?? DEFAULT_MULTIPLES),
    participations: pins.participations
      ? [terms.participation]
      : (current?.participations ?? DEFAULT_PARTICIPATIONS),
    seniority: pins.seniority ? terms.seniority : (current?.seniority ?? terms.seniority),
  }
}

function emptyPins(): DealFile['ui']['dealSpacePins'] {
  return {
    preMoney: false,
    pools: false,
    multiples: false,
    participations: false,
    seniority: false,
  }
}

export function refreshDerivedSpace(deal: DealFile, terms: RoundTerms = deal.terms): DealFile {
  if (deal.ui.dealSpaceManual) {
    return { ...deal, terms, space: { ...deal.space, pinnedInvestment: terms.investment } }
  }
  return { ...deal, terms, space: deriveDealSpace(terms, null, deal.ui.dealSpacePins) }
}
