/**
 * Educational 409A / common-stock fair-value estimate (§6.20).
 *
 * This is NOT an appraisal. It exposes the common teaching heuristic that early-stage
 * common FMV is often set as a fraction of the latest preferred PPS. Default fraction
 * 0.30 is a classroom convention, not a valuation opinion.
 *
 * Citation framing: IRS IRC §409A and the AICPA *Valuation of Privately-Held-Company
 * Equity Securities Issued as Compensation* (2013 guide) discuss option pricing and
 * backsolve methods; this product ships only the transparent percent-of-PPS teaching
 * shortcut. Retrieved 2025-01-14 reference:
 * https://www.irs.gov/businesses/corporations/nonqualified-deferred-compensation-audit-technique-guide
 */
export type FairValueEstimate = {
  fairValuePerShare: number
  method: 'PERCENT_OF_PREFERRED_PPS'
  preferredPps: number
  percentOfPreferred: number
  disclaimer: string
}

export function estimate409A(
  preferredPps: number,
  percentOfPreferred = 0.3,
): FairValueEstimate {
  if (!(preferredPps > 0) || !Number.isFinite(preferredPps)) {
    throw new RangeError('preferredPps must be a positive finite number')
  }
  if (!(percentOfPreferred > 0) || percentOfPreferred > 1) {
    throw new RangeError('percentOfPreferred must be in (0, 1]')
  }
  return {
    fairValuePerShare: preferredPps * percentOfPreferred,
    method: 'PERCENT_OF_PREFERRED_PPS',
    preferredPps,
    percentOfPreferred,
    disclaimer:
      'Educational estimate only — not a 409A appraisal, legal opinion, or tax advice.',
  }
}
