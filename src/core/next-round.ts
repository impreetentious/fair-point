import { evaluatePackage } from './bargain'
import { presentValue } from './discounting'
import { crraQuadrature } from './mc'
import { expectedPayouts } from './outcomes'
import { asConvertedShares, constructRound } from './round'
import type {
  Beliefs,
  CapTable,
  ConvertibleNote,
  DealPoint,
  Discounting,
  RoundTerms,
  Safe,
  ShareClassPreferred,
  TermPackage,
} from './schema'

/**
 * The next-round shadow.
 *
 * This instrument negotiates one round, exactly — and several of the terms it negotiates are
 * *worthless* in a one-round model. Anti-dilution cannot bite unless a down round can happen.
 * Seniority only matters when a future preferred stacks on top. The pool trade is really an
 * argument about whose shares fund the *next* pool. A single-round engine computes the
 * mechanics of these terms correctly and then prices them at nothing, which is the wrong
 * answer stated precisely.
 *
 * So: attach a small set of discrete follow-on branches to the round on the table, run each
 * one on top of the round's own post cap table, and take the exit under the existing beliefs
 * in each. Discrete branches are what keep this exact — every branch composes closed-form
 * round mechanics with the piecewise-linear waterfall, so the expectation is a finite weighted
 * sum of quantities the engine already computes exactly. No simulation is introduced.
 *
 * The output is deliberately a `DealPoint`, the same shape a single-round evaluation produces,
 * so the frontier, the Nash and Kalai–Smorodinsky selections, and the value-on-table readout
 * all run on branch-weighted numbers without knowing anything changed.
 *
 * **Who is who across rounds.** The follow-on money is not the investor on the other side of
 * today's table, so the next round's new class is booked to `OTHER` — except for the slice the
 * current investor takes under a pro-rata election, which stays `INVESTOR`. Getting this wrong
 * in the other direction would quietly credit today's investor with tomorrow's returns and
 * make every term look better than it is.
 */

export interface NextRoundBranch {
  id: string
  label: string
  /** Probability of this branch. The set is normalised, and the normalisation is reported. */
  probability: number
  terms: RoundTerms
  /** Whether today's investor exercises pro-rata in this branch. */
  proRata: boolean
}

export interface BranchOutcome {
  branchId: string
  label: string
  probability: number
  /** Founder and investor expected dollars in this branch, under their own beliefs. */
  founderValue: number
  investorValue: number
  /** The same payouts read under the *other* party's beliefs, for the disagreement split. */
  founderUnderInvestorBeliefs: number
  investorUnderFounderBeliefs: number
  /** Today's investor's ownership just before the follow-on priced — the pro-rata basis. */
  investorOwnershipBefore: number
  /** Their ownership after it, so dilution is visible rather than inferred. */
  investorOwnershipAfter: number
  proRataInvestment: number
  warnings: string[]
  failed: string | null
}

export interface ShadowResult {
  point: DealPoint
  branches: BranchOutcome[]
  /** True when the supplied probabilities did not sum to one and were rescaled. */
  normalised: boolean
  /** The single-round evaluation, kept so the shadow's effect on each term is legible. */
  singleRound: DealPoint
}

export interface ShadowInput {
  pre: CapTable
  safes: Safe[]
  pkg: TermPackage
  branches: readonly NextRoundBranch[]
  founderBeliefs: Beliefs
  investorBeliefs: Beliefs
  risk?: { gamma: 0.5 | 1; w0F: number; w0I: number } | null
  notes?: ConvertibleNote[]
  discounting?: Discounting | null
}

/**
 * Round one's new class is called `new-round`, and so is round two's. Renaming the first keeps
 * the second from colliding with it, and keeps the seniority stack readable in the output.
 */
function relabelCurrentRound(post: CapTable, suffix: string): CapTable {
  return {
    ...post,
    classes: post.classes.map((cls) =>
      cls.id === 'new-round' || cls.id === 'new-round-other'
        ? { ...cls, id: `${cls.id}-${suffix}`, name: `${cls.name} (this round)` }
        : cls,
    ),
  }
}

function investorOwnership(table: CapTable): number {
  const total = asConvertedShares(table)
  if (total <= 0) return 0
  const held = table.classes.reduce(
    (sum, cls) =>
      cls.holder === 'INVESTOR'
        ? sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares)
        : sum,
    0,
  )
  return held / total
}

/**
 * Splits the follow-on round's new class between today's investor (their pro-rata slice) and
 * whoever else funds it. Both halves keep the follow-on's terms, because they bought the same
 * security — only the holder differs.
 */
function allocateFollowOn(post: CapTable, proRataShare: number): CapTable {
  const classes = post.classes.flatMap((cls) => {
    if (cls.id !== 'new-round' || cls.kind !== 'PREFERRED') return [cls]
    const preferred = cls as ShareClassPreferred
    const investorShares = preferred.shares * proRataShare
    const otherShares = preferred.shares - investorShares
    const investorInvested = preferred.invested * proRataShare
    const result: ShareClassPreferred[] = []
    if (investorShares > 0) {
      result.push({
        ...preferred,
        id: 'next-round-prorata',
        name: 'Next round (your pro-rata)',
        holder: 'INVESTOR',
        shares: investorShares,
        invested: investorInvested,
      })
    }
    if (otherShares > 0) {
      result.push({
        ...preferred,
        id: 'next-round',
        name: 'Next round (new money)',
        holder: 'OTHER',
        shares: otherShares,
        invested: preferred.invested - investorInvested,
      })
    }
    return result
  })
  return { ...post, classes }
}

function partyValues(
  post: CapTable,
  founderBeliefs: Beliefs,
  investorBeliefs: Beliefs,
  risk: ShadowInput['risk'],
  discounting: Discounting | null,
): Pick<
  BranchOutcome,
  'founderValue' | 'investorValue' | 'founderUnderInvestorBeliefs' | 'investorUnderFounderBeliefs'
> {
  if (risk) {
    return {
      founderValue: presentValue(
        crraQuadrature(post, 'FOUNDER', founderBeliefs, risk.gamma, risk.w0F).ce,
        discounting,
      ),
      investorValue: presentValue(
        crraQuadrature(post, 'INVESTOR', investorBeliefs, risk.gamma, risk.w0I).ce,
        discounting,
      ),
      founderUnderInvestorBeliefs: presentValue(
        crraQuadrature(post, 'FOUNDER', investorBeliefs, risk.gamma, risk.w0F).ce,
        discounting,
      ),
      investorUnderFounderBeliefs: presentValue(
        crraQuadrature(post, 'INVESTOR', founderBeliefs, risk.gamma, risk.w0I).ce,
        discounting,
      ),
    }
  }
  const founder = expectedPayouts(post, founderBeliefs)
  const investor = expectedPayouts(post, investorBeliefs)
  return {
    founderValue: presentValue(founder.party.founder, discounting),
    investorValue: presentValue(investor.party.investor, discounting),
    founderUnderInvestorBeliefs: presentValue(investor.party.founder, discounting),
    investorUnderFounderBeliefs: presentValue(founder.party.investor, discounting),
  }
}

export function evaluateShadow(input: ShadowInput): ShadowResult {
  const discounting = input.discounting ?? null
  const singleRound = evaluatePackage(
    input.pre,
    input.safes,
    input.pkg,
    input.founderBeliefs,
    input.investorBeliefs,
    input.risk ?? null,
    input.notes ?? [],
    discounting,
  )
  const current = constructRound(input.pre, input.safes, input.pkg.terms, input.notes ?? [])
  const thisRoundPost = relabelCurrentRound(current.post, 'current')
  const ownershipBefore = investorOwnership(thisRoundPost)

  const rawTotal = input.branches.reduce((sum, branch) => sum + branch.probability, 0)
  const normalised = Math.abs(rawTotal - 1) > 1e-9
  const weightOf = (branch: NextRoundBranch): number =>
    rawTotal <= 0 ? 0 : branch.probability / rawTotal

  const outcomes: BranchOutcome[] = input.branches.map((branch) => {
    const weight = weightOf(branch)
    try {
      const follow = constructRound(thisRoundPost, [], branch.terms, [])
      const proRataShare = branch.proRata ? Math.min(1, Math.max(0, ownershipBefore)) : 0
      const post = allocateFollowOn(follow.post, proRataShare)
      return {
        branchId: branch.id,
        label: branch.label,
        probability: weight,
        ...partyValues(
          post,
          input.founderBeliefs,
          input.investorBeliefs,
          input.risk ?? null,
          discounting,
        ),
        investorOwnershipBefore: ownershipBefore,
        investorOwnershipAfter: investorOwnership(post),
        proRataInvestment: branch.terms.investment * proRataShare,
        warnings: follow.warnings,
        failed: null,
      }
    } catch (error) {
      return {
        branchId: branch.id,
        label: branch.label,
        probability: weight,
        founderValue: 0,
        investorValue: 0,
        founderUnderInvestorBeliefs: 0,
        investorUnderFounderBeliefs: 0,
        investorOwnershipBefore: ownershipBefore,
        investorOwnershipAfter: ownershipBefore,
        proRataInvestment: 0,
        warnings: [],
        failed:
          error instanceof Error ? error.message : 'This branch is not a constructible round.',
      }
    }
  })

  const usable = outcomes.filter((outcome) => outcome.failed === null)
  const usableWeight = usable.reduce((sum, outcome) => sum + outcome.probability, 0)
  const weighted = (pick: (outcome: BranchOutcome) => number): number =>
    usableWeight <= 0
      ? 0
      : usable.reduce(
          (sum, outcome) => sum + (outcome.probability / usableWeight) * pick(outcome),
          0,
        )

  const point: DealPoint = {
    pkg: input.pkg,
    uF: weighted((outcome) => outcome.founderValue),
    uI: weighted((outcome) => outcome.investorValue),
    uF_underI: weighted((outcome) => outcome.founderUnderInvestorBeliefs),
    uI_underF: weighted((outcome) => outcome.investorUnderFounderBeliefs),
    metric: singleRound.metric,
    diagnostics: current.diagnostics,
  }

  return { point, branches: outcomes, normalised, singleRound }
}

/** The whole point of the shadow: what a term is worth once a next round exists. */
export interface ShadowTermComparison {
  label: string
  /** Value under the single-round reading, where several terms are structurally worthless. */
  singleRound: { founder: number; investor: number }
  /** Value once the follow-on branches exist. */
  withShadow: { founder: number; investor: number }
  founderDelta: number
  investorDelta: number
}

/**
 * Prices one term change twice — once in the one-round world, once through the branches — so
 * the difference between the two readings *is* the value of the next round to that term. This
 * is where anti-dilution stops being worth exactly zero.
 */
export function shadowTermPrice(
  input: ShadowInput,
  variant: { label: string; pre?: CapTable; terms?: RoundTerms },
): ShadowTermComparison {
  const variantInput: ShadowInput = {
    ...input,
    pre: variant.pre ?? input.pre,
    pkg: variant.terms ? { ...input.pkg, terms: variant.terms } : input.pkg,
  }
  const base = evaluateShadow(input)
  const changed = evaluateShadow(variantInput)
  return {
    label: variant.label,
    singleRound: {
      founder: changed.singleRound.uF - base.singleRound.uF,
      investor: changed.singleRound.uI - base.singleRound.uI,
    },
    withShadow: {
      founder: changed.point.uF - base.point.uF,
      investor: changed.point.uI - base.point.uI,
    },
    founderDelta: changed.point.uF - base.point.uF - (changed.singleRound.uF - base.singleRound.uF),
    investorDelta:
      changed.point.uI - base.point.uI - (changed.singleRound.uI - base.singleRound.uI),
  }
}

/** Up / flat / down at plausible bands, the shape a founder actually sketches on a whiteboard. */
export function defaultBranches(terms: RoundTerms, postMoney: number): NextRoundBranch[] {
  const base = Math.max(postMoney, terms.investment)
  const nextInvestment = terms.investment * 2
  const branch = (
    id: string,
    label: string,
    probability: number,
    multiple: number,
    proRata: boolean,
  ): NextRoundBranch => ({
    id,
    label,
    probability,
    proRata,
    terms: {
      preMoney: base * multiple,
      investment: nextInvestment,
      poolTargetPost: terms.poolTargetPost,
      prefMultiple: 1,
      participation: 'NONE',
      seniority: 'SENIOR',
    },
  })
  return [
    branch('up', 'Up round at 2.5×', 0.45, 2.5, true),
    branch('flat', 'Flat round', 0.35, 1, true),
    branch('down', 'Down round at 0.6×', 0.2, 0.6, false),
  ]
}
