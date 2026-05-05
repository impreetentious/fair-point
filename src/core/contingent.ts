import { evaluatePackage } from './bargain'
import { presentValue } from './discounting'
import { fitLognormal, intervalProb, partialExpectation } from './distributions'
import type {
  Beliefs,
  CapTable,
  ConvertibleNote,
  DealPoint,
  Discounting,
  Safe,
  TermPackage,
} from './schema'

/**
 * Disagreement, decomposed — and then traded.
 *
 * The instrument already elicits both parties' beliefs and uses them separately. It has never
 * asked the obvious next question: the two sides disagree about the exit, so *what is the
 * disagreement worth?* Two things can make one package worth more to a founder than to an
 * investor, and they call for opposite responses:
 *
 * - **Preference.** The parties value the same distribution differently because they are
 *   differently exposed to risk. That gap is a cost of doing business; it cannot be traded away.
 * - **Belief.** The parties disagree about the distribution itself. That gap is *tradeable* —
 *   it is the one thing both sides can profitably bet on.
 *
 * The split is computed from quantities the package evaluation already produces. Each deal
 * point carries each party's payout under both parties' beliefs, so evaluating a party's own
 * payout function under the *other* party's beliefs isolates the belief channel exactly, and
 * whatever is left is preference.
 *
 * Then the constructive half. Where beliefs differ, a contingent term creates joint value by
 * construction: it pays in the region one side thinks is likely and the other does not, so it
 * costs the sceptic less than it is worth to the optimist. This module prices the canonical
 * one — a milestone ratchet that hands the founder back equity if the exit clears a stated
 * threshold — under each party's own beliefs, and reports whether it is a Pareto improvement
 * on the package it modifies.
 *
 * Bazerman & Gillespie, "Betting on the Future: The Virtues of Contingent Contracts" (HBR
 * 1999) is the argument; this is the arithmetic under it.
 */

export interface DisagreementSplit {
  /** The package the split is computed for. */
  index: number
  /**
   * How much more the founder thinks their own claim is worth than the investor thinks it is.
   * Same payout function, two distributions — so in expected-value mode this is pure belief.
   */
  founderBeliefGap: number
  /** The mirror image on the investor's claim. */
  investorBeliefGap: number
  /**
   * The two together: the total amount by which each side, valuing its own claim under its own
   * beliefs, exceeds what the counterparty thinks that claim is worth. This is the tradeable
   * material — where it is zero there is nothing to bet on.
   */
  disagreementSurplus: number
  /**
   * The risk premium each side is paying: the gap between the risk-neutral expected value of
   * their own claim and the certainty equivalent they actually price it at. Exactly zero
   * without a risk model, which is the honest answer — an expected-value reading has no
   * preference channel to report.
   */
  founderRiskPremium: number
  investorRiskPremium: number
  /** Each side's cross-valuation, kept so the split can be checked rather than trusted. */
  founderUnderInvestorBeliefs: number
  investorUnderFounderBeliefs: number
  /** True when the two parties' beliefs are the same object — nothing to bet on. */
  beliefsAgree: boolean
}

/**
 * A milestone ratchet: if the exit clears `threshold`, `ratchetPoints` of ownership move from
 * the investor to the founder. It is modelled as a state-dependent transfer on top of the
 * package's own waterfall, which is exactly what it is.
 */
export interface MilestoneRatchet {
  threshold: number
  /** Fraction of the company that moves, e.g. 0.03 for three points. */
  ratchetPoints: number
}

export interface ContingentQuote {
  ratchet: MilestoneRatchet
  /** Probability the milestone is hit, under each party's own beliefs. */
  founderProbability: number
  investorProbability: number
  /** Expected transfer under each party's own beliefs. Founder gains; investor pays. */
  founderValue: number
  investorCost: number
  /** Founder's gain minus investor's cost — positive means the bet creates value. */
  jointValue: number
  /** True when both parties end up better off than under the flat package. */
  paretoImprovement: boolean
  /** Why it works, or why it does not. */
  verdict: string
}

export interface ContingentInput {
  pre: CapTable
  safes: Safe[]
  pkg: TermPackage
  founderBeliefs: Beliefs
  investorBeliefs: Beliefs
  risk?: { gamma: 0.5 | 1; w0F: number; w0I: number } | null
  notes?: ConvertibleNote[]
  discounting?: Discounting | null
}

function evaluate(input: ContingentInput): DealPoint {
  return evaluatePackage(
    input.pre,
    input.safes,
    input.pkg,
    input.founderBeliefs,
    input.investorBeliefs,
    input.risk ?? null,
    input.notes ?? [],
    input.discounting ?? null,
  )
}

/**
 * The split.
 *
 * The naive gap to reach for is `uF − uI`, and it means nothing: those are two *different*
 * claims on the same waterfall, so their difference is mostly just who owns what. The
 * meaningful comparison holds the claim fixed and moves the beliefs. `uF` is the founder's
 * claim under founder beliefs; `uF_underI` is that same claim under the investor's. The
 * difference is disagreement about the exit and nothing else.
 *
 * Preference is separated the other way, by holding beliefs fixed and moving the utility
 * function: the risk premium is the gap between the risk-neutral expected value of a claim
 * and the certainty equivalent the party actually prices it at. With no risk model declared
 * the two coincide and the premium is exactly zero.
 */
export function decomposeDisagreement(input: ContingentInput): DisagreementSplit {
  const point = evaluate(input)
  const riskNeutral = input.risk ? evaluate({ ...input, risk: null }) : point
  const founderBeliefGap = point.uF - point.uF_underI
  const investorBeliefGap = point.uI - point.uI_underF
  return {
    index: point.pkg.index,
    founderBeliefGap,
    investorBeliefGap,
    disagreementSurplus: founderBeliefGap + investorBeliefGap,
    founderRiskPremium: riskNeutral.uF - point.uF,
    investorRiskPremium: riskNeutral.uI - point.uI,
    founderUnderInvestorBeliefs: point.uF_underI,
    investorUnderFounderBeliefs: point.uI_underF,
    beliefsAgree:
      input.founderBeliefs.p0 === input.investorBeliefs.p0 &&
      input.founderBeliefs.p10 === input.investorBeliefs.p10 &&
      input.founderBeliefs.p50 === input.investorBeliefs.p50 &&
      input.founderBeliefs.p90 === input.investorBeliefs.p90,
  }
}

/** P(exit > threshold) under a party's own beliefs, including the mass at zero. */
export function milestoneProbability(beliefs: Beliefs, threshold: number): number {
  if (threshold <= 0) return 1 - beliefs.p0
  const fit = fitLognormal(beliefs)
  return (1 - beliefs.p0) * intervalProb(fit.mu, fit.sigma, threshold, Infinity)
}

/**
 * Prices a milestone ratchet against the flat package it would modify. The transfer is
 * `ratchetPoints × exit value` in the states above the threshold, so its expected value under
 * a party's beliefs is the partial expectation of the exit over that tail — computed from the
 * same lognormal fit and the same partial-moment helpers the waterfall payouts use, so the two
 * readouts cannot drift apart.
 */
export function priceMilestoneRatchet(
  input: ContingentInput,
  ratchet: MilestoneRatchet,
): ContingentQuote {
  const tailValue = (beliefs: Beliefs): number => {
    const fit = fitLognormal(beliefs)
    const lower = ratchet.threshold <= 0 ? 0 : ratchet.threshold
    return (1 - beliefs.p0) * partialExpectation(fit.mu, fit.sigma, lower, Infinity)
  }

  const founderProbability = milestoneProbability(input.founderBeliefs, ratchet.threshold)
  const investorProbability = milestoneProbability(input.investorBeliefs, ratchet.threshold)
  const founderValue = presentValue(
    ratchet.ratchetPoints * tailValue(input.founderBeliefs),
    input.discounting ?? null,
  )
  const investorCost = presentValue(
    ratchet.ratchetPoints * tailValue(input.investorBeliefs),
    input.discounting ?? null,
  )
  const jointValue = founderValue - investorCost
  const paretoImprovement = jointValue > 0

  return {
    ratchet,
    founderProbability,
    investorProbability,
    founderValue,
    investorCost,
    jointValue,
    paretoImprovement,
    verdict: paretoImprovement
      ? `You put the odds of clearing this milestone at ${(founderProbability * 100).toFixed(0)}%; they put it at ${(investorProbability * 100).toFixed(0)}%. The ratchet is worth more to you than it costs them by that difference — the gap between your beliefs is the whole source of the gain.`
      : investorProbability > founderProbability
        ? 'They are more optimistic about this milestone than you are, so this ratchet costs them more than it is worth to you. Point it the other way — a term that pays them in the states they believe in.'
        : 'Your beliefs are close enough here that there is nothing to bet on; this term moves money without creating any.',
  }
}

/**
 * Searches the stated candidate thresholds and returns the best value-creating ratchet, or
 * null when none of them creates value. The search is over thresholds the caller names, never
 * an optimiser — the point is to price the structures a negotiator would actually propose.
 */
export function bestContingentTerm(
  input: ContingentInput,
  thresholds: readonly number[],
  ratchetPoints: number,
): ContingentQuote | null {
  const quotes = thresholds
    .map((threshold) => priceMilestoneRatchet(input, { threshold, ratchetPoints }))
    .filter((quote) => quote.paretoImprovement)
  if (quotes.length === 0) return null
  return quotes.reduce((best, quote) => (quote.jointValue > best.jointValue ? quote : best))
}

/** Threshold candidates worth quoting: the two parties' own medians and upper quantiles. */
export function defaultThresholds(founder: Beliefs, investor: Beliefs): number[] {
  const raw = [founder.p50, founder.p90, investor.p50, investor.p90].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
  return [...new Set(raw)].sort((left, right) => left - right)
}
