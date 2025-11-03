import { expectedPayouts, payoutQuantile, payoutValue } from './outcomes'
import { constructRound } from './round'
import { accrueForExit } from './accruals'
import { presentValue } from './discounting'
import type {
  Beliefs,
  CapTable,
  ConvertibleNote,
  Discounting,
  OptionGrant,
  RoundTerms,
  Safe,
} from './schema'

export type EmployeeOfferInput = {
  /** Pre-round table; the offer is modeled on the post-round table after `terms`. */
  pre: CapTable
  safes?: Safe[]
  notes?: ConvertibleNote[]
  terms: RoundTerms
  /** Candidate grant to analyze (issued from the post-round pool). */
  grant: OptionGrant
  beliefs: Beliefs
  /** Optional cash alternative the candidate is comparing against. */
  cashAlternative?: number
  yearsToExit?: number
  discounting?: Discounting | null
}

export type EmployeeOfferResult = {
  post: CapTable
  grantId: string
  /** Exact payout at the supplied exit value (when provided via payoutAtExit). */
  payoutAt: (exitValue: number) => number
  expectedValue: number
  p10: number
  p50: number
  p90: number
  cashAlternative: number
  /** EV(grant) − cashAlternative (present-valued when discounting is on). */
  surplusVsCash: number
  diagnostics: { pps: number; investorPct: number; poolIncrease: number }
}

/**
 * Employee offer analyzer (§6.10).
 * Reuses the round constructor, accruals, regime walk, and closed-form expectations
 * directly — the same physics as the founder/investor path.
 */
export function analyzeEmployeeOffer(input: EmployeeOfferInput): EmployeeOfferResult {
  const safes = input.safes ?? []
  const round = constructRound(input.pre, safes, input.terms, input.notes ?? [])
  if (round.post.grants.some((grant) => grant.id === input.grant.id)) {
    throw new Error(`Grant id '${input.grant.id}' already exists on the post-round table`)
  }
  if (input.grant.options > round.post.poolAvailable + 1e-9) {
    throw new Error('Offer exceeds available post-round option pool')
  }
  const withGrant: CapTable = {
    ...round.post,
    grants: [...round.post.grants, input.grant],
    poolAvailable: round.post.poolAvailable - input.grant.options,
  }
  const settled = accrueForExit(withGrant, input.yearsToExit ?? 0)
  const stats = expectedPayouts(settled, input.beliefs)
  const rawEv = stats.ev[input.grant.id] ?? 0
  const expectedValue = presentValue(rawEv, input.discounting)
  const cashAlternative = input.cashAlternative ?? 0
  return {
    post: settled,
    grantId: input.grant.id,
    payoutAt: (exitValue: number) => payoutValue(settled, input.grant.id, exitValue),
    expectedValue,
    p10: presentValue(
      payoutQuantile(settled, input.grant.id, input.beliefs, 0.1),
      input.discounting,
    ),
    p50: presentValue(
      payoutQuantile(settled, input.grant.id, input.beliefs, 0.5),
      input.discounting,
    ),
    p90: presentValue(
      payoutQuantile(settled, input.grant.id, input.beliefs, 0.9),
      input.discounting,
    ),
    cashAlternative,
    surplusVsCash: expectedValue - cashAlternative,
    diagnostics: round.diagnostics,
  }
}
