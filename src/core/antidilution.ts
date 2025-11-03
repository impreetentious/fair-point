import type { ShareClassPreferred } from './schema'

export function conversionPrice(cls: ShareClassPreferred): number {
  return cls.originalIssuePrice / cls.conversionRatio
}

export function adjustedConversionRatio(
  cls: ShareClassPreferred,
  pps: number,
  investment: number,
  broadBase: number,
  frozenConversionPrice: number,
): number {
  if (pps >= frozenConversionPrice) return cls.conversionRatio
  const nextPrice =
    cls.antiDilution === 'FULL_RATCHET'
      ? pps
      : (frozenConversionPrice * (broadBase + investment / frozenConversionPrice)) /
        (broadBase + investment / pps)
  return cls.originalIssuePrice / nextPrice
}
