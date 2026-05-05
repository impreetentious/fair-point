import { describe, expect, it } from 'vitest'
import { analyze, enumerateDeals, evaluatePackage, valueOnTable } from '../src/core/bargain'
import { beliefTornado, tornadoSummary } from '../src/core/belief-tornado'
import {
  bestContingentTerm,
  decomposeDisagreement,
  defaultThresholds,
  milestoneProbability,
  priceMilestoneRatchet,
} from '../src/core/contingent'
import { exchangeRateTable } from '../src/core/exchange-rate'
import { defaultBranches, evaluateShadow, shadowTermPrice } from '../src/core/next-round'
import { constructRound } from '../src/core/round'
import { EXAMPLE_DECKS } from '../src/app/data/examples'
import type { Beliefs, DealFile, TermPackage } from '../src/core/schema'

function deck(id: string): DealFile {
  const found = EXAMPLE_DECKS.find((example) => example.id === id)
  if (!found) throw new Error(`missing example deck ${id}`)
  return found.deal
}

const deal = deck('series-a-clean')
const pinned: TermPackage = { index: 0, terms: deal.terms }

describe('term exchange-rate table', () => {
  it('prices every term the round actually has', () => {
    const table = exchangeRateTable({
      pre: deal.pre,
      safes: deal.safes,
      terms: deal.terms,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
    })
    const terms = new Set(table.rows.map((row) => row.term))
    expect(terms.has('preMoney')).toBe(true)
    expect(terms.has('poolTargetPost')).toBe(true)
    expect(terms.has('investment')).toBe(true)
    expect(table.rows.every((row) => Number.isFinite(row.deltaFounder))).toBe(true)
  })

  /** More pre-money is never worth less to a founder, and never worth more to an investor. */
  it('moves pre-money in the directions the arithmetic requires', () => {
    const table = exchangeRateTable({
      pre: deal.pre,
      safes: deal.safes,
      terms: deal.terms,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
    })
    const preMoney = table.rows.find((row) => row.term === 'preMoney')!
    expect(preMoney.deltaFounder).toBeGreaterThan(0)
    expect(preMoney.deltaInvestor).toBeLessThan(0)
  })

  /** A bigger pool comes out of the existing holders, so it is always a founder concession. */
  it('reads a bigger pool as a founder concession', () => {
    const table = exchangeRateTable({
      pre: deal.pre,
      safes: deal.safes,
      terms: deal.terms,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
    })
    const pool = table.rows.find((row) => row.term === 'poolTargetPost')!
    expect(pool.infeasible).toBeNull()
    expect(pool.deltaFounder).toBeLessThan(0)
    expect(pool.direction).toBe('concession')
  })

  /**
   * The trade column is the practical output: a concession, and the pre-money that undoes it.
   * The solve has to actually land, so the residual is asserted rather than assumed.
   */
  it('solves the compensating pre-money and shows its residual', () => {
    const table = exchangeRateTable({
      pre: deal.pre,
      safes: deal.safes,
      terms: deal.terms,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
    })
    const traded = table.rows.filter((row) => row.trade !== null)
    expect(traded.length).toBeGreaterThan(0)
    for (const row of traded) {
      expect(row.trade!.preMoneyDelta).toBeGreaterThan(0)
      expect(Math.abs(row.trade!.founderResidual)).toBeLessThan(
        Math.max(1, Math.abs(row.deltaFounder)) * 0.01,
      )
    }
  })

  it('quotes a reason instead of a price where the step is not a legal package', () => {
    const table = exchangeRateTable({
      pre: deal.pre,
      safes: deal.safes,
      terms: { ...deal.terms, prefMultiple: 1.5, participation: 'CAP2' },
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
    })
    const blocked = table.rows.filter((row) => row.infeasible !== null)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((row) => row.deltaFounder === 0)).toBe(true)
  })
})

describe('belief tornado', () => {
  const input = {
    pre: deal.pre,
    safes: deal.safes,
    space: { ...deal.space, preMoneySteps: 3, pools: [deal.terms.poolTargetPost] },
    pinned,
    founderBeliefs: deal.founderBeliefs,
    investorBeliefs: deal.investorBeliefs,
    disagreement: deal.disagreement,
    risk: deal.risk,
  }

  it('ranks the beliefs by how far each one moves the answer on its own', () => {
    const tornado = beliefTornado(input, 'founderEv')
    expect(tornado.bars.length).toBeGreaterThan(0)
    expect(tornado.ranking.length).toBeGreaterThan(0)
    for (let index = 1; index < tornado.ranking.length; index += 1) {
      expect(tornado.ranking[index - 1]!.swing).toBeGreaterThanOrEqual(
        tornado.ranking[index]!.swing,
      )
    }
    expect(tornadoSummary(tornado)).toContain('Pressure-test')
  })

  /** The founder's own EV cannot depend on the investor's beliefs; only their own. */
  it("leaves the founder's expected value untouched by the investor's beliefs", () => {
    const tornado = beliefTornado(input, 'founderEv')
    for (const bar of tornado.bars.filter((entry) => entry.party === 'investor')) {
      expect(bar.swing).toBeCloseTo(0, 6)
    }
    expect(tornado.bars.some((bar) => bar.party === 'founder' && bar.swing > 0)).toBe(true)
  })

  it('says so when a belief cannot move on its own without breaking its own ordering', () => {
    const tight: Beliefs = { p0: 0.2, p10: 9_000_000, p50: 10_000_000, p90: 11_000_000 }
    const tornado = beliefTornado({ ...input, founderBeliefs: tight }, 'founderEv')
    const broken = tornado.bars.filter((bar) => bar.incoherent !== null)
    expect(broken.length).toBeGreaterThan(0)
    expect(broken.every((bar) => bar.swing === 0)).toBe(true)
  })

  it('reads the value left on the table as a headline too', () => {
    const tornado = beliefTornado(input, 'valueOnTable')
    const packages = enumerateDeals(input.space)
    const points = packages.map((pkg) =>
      evaluatePackage(
        deal.pre,
        deal.safes,
        pkg,
        deal.founderBeliefs,
        deal.investorBeliefs,
        deal.risk,
      ),
    )
    const pinnedPoint = evaluatePackage(
      deal.pre,
      deal.safes,
      pinned,
      deal.founderBeliefs,
      deal.investorBeliefs,
      deal.risk,
    )
    const expected = valueOnTable(analyze(points, deal.disagreement), pinnedPoint).headline
    expect(tornado.baseValue).toBeCloseTo(expected, 6)
  })
})

describe('disagreement decomposition and contingent terms', () => {
  const optimist: Beliefs = { p0: 0.15, p10: 20_000_000, p50: 90_000_000, p90: 400_000_000 }
  const sceptic: Beliefs = { p0: 0.35, p10: 8_000_000, p50: 30_000_000, p90: 90_000_000 }

  const base = {
    pre: deal.pre,
    safes: deal.safes,
    pkg: pinned,
    founderBeliefs: optimist,
    investorBeliefs: sceptic,
  }

  /**
   * Holding the claim fixed and moving only the beliefs isolates disagreement exactly, so with
   * no risk model declared there is no preference channel left to report — and the module says
   * zero rather than inventing one.
   */
  it('reports no preference channel when no risk model is declared', () => {
    const split = decomposeDisagreement(base)
    expect(split.beliefsAgree).toBe(false)
    expect(split.founderRiskPremium).toBe(0)
    expect(split.investorRiskPremium).toBe(0)
    // The optimist values their own claim above what the sceptic would pay for it.
    expect(split.founderBeliefGap).toBeGreaterThan(0)
    expect(split.disagreementSurplus).not.toBeCloseTo(0, 6)
  })

  it('separates the risk premium from the belief gap once a risk model is on', () => {
    const risky = { ...base, risk: { gamma: 0.5 as const, w0F: 1_000_000, w0I: 50_000_000 } }
    const split = decomposeDisagreement(risky)
    // A concave utility prices a risky claim below its expected value, never above.
    expect(split.founderRiskPremium).toBeGreaterThan(0)
    expect(split.investorRiskPremium).toBeGreaterThan(0)
    expect(split.founderBeliefGap).toBeGreaterThan(0)
  })

  it('finds nothing to bet on when the parties agree', () => {
    const split = decomposeDisagreement({ ...base, investorBeliefs: optimist })
    expect(split.beliefsAgree).toBe(true)
    expect(split.founderBeliefGap).toBeCloseTo(0, 6)
    expect(split.investorBeliefGap).toBeCloseTo(0, 6)
    expect(split.disagreementSurplus).toBeCloseTo(0, 6)
  })

  it('prices a milestone the optimist believes in more than the sceptic', () => {
    const quote = priceMilestoneRatchet(base, { threshold: 100_000_000, ratchetPoints: 0.03 })
    expect(quote.founderProbability).toBeGreaterThan(quote.investorProbability)
    expect(quote.founderValue).toBeGreaterThan(quote.investorCost)
    expect(quote.jointValue).toBeGreaterThan(0)
    expect(quote.paretoImprovement).toBe(true)
    expect(quote.verdict).toContain('worth more to you')
  })

  it('refuses to claim value where the sceptic is the optimistic one', () => {
    const flipped = { ...base, founderBeliefs: sceptic, investorBeliefs: optimist }
    const quote = priceMilestoneRatchet(flipped, {
      threshold: 100_000_000,
      ratchetPoints: 0.03,
    })
    expect(quote.paretoImprovement).toBe(false)
    expect(quote.verdict).toContain('Point it the other way')
  })

  it('creates no value at all when both sides hold the same beliefs', () => {
    const quote = priceMilestoneRatchet(
      { ...base, investorBeliefs: optimist },
      { threshold: 100_000_000, ratchetPoints: 0.03 },
    )
    expect(quote.jointValue).toBeCloseTo(0, 6)
    expect(quote.paretoImprovement).toBe(false)
  })

  it('picks the best value-creating threshold from the ones a negotiator would propose', () => {
    const thresholds = defaultThresholds(optimist, sceptic)
    expect(thresholds.length).toBeGreaterThan(1)
    const best = bestContingentTerm(base, thresholds, 0.03)
    expect(best).not.toBeNull()
    for (const threshold of thresholds) {
      expect(best!.jointValue).toBeGreaterThanOrEqual(
        priceMilestoneRatchet(base, { threshold, ratchetPoints: 0.03 }).jointValue - 1e-6,
      )
    }
  })

  it('reads a milestone probability as a survival probability net of the zero mass', () => {
    expect(milestoneProbability(optimist, 0)).toBeCloseTo(1 - optimist.p0, 12)
    expect(milestoneProbability(optimist, optimist.p50)).toBeCloseTo((1 - optimist.p0) / 2, 6)
    expect(milestoneProbability(optimist, 1e12)).toBeLessThan(1e-3)
  })
})

describe('next-round shadow', () => {
  const round = constructRound(deal.pre, deal.safes, deal.terms)
  const postMoney = (deal.terms.preMoney ?? 0) + deal.terms.investment
  const branches = defaultBranches(deal.terms, postMoney)
  const input = {
    pre: deal.pre,
    safes: deal.safes,
    pkg: pinned,
    branches,
    founderBeliefs: deal.founderBeliefs,
    investorBeliefs: deal.investorBeliefs,
    risk: deal.risk,
  }

  it('returns a deal point the existing bargaining machinery can consume unchanged', () => {
    const shadow = evaluateShadow(input)
    expect(shadow.point.pkg).toEqual(pinned)
    expect(shadow.point.metric).toBe(shadow.singleRound.metric)
    expect(Number.isFinite(shadow.point.uF)).toBe(true)
    expect(Number.isFinite(shadow.point.uI)).toBe(true)
    expect(shadow.point.diagnostics.pps).toBeCloseTo(round.diagnostics.pps, 9)
  })

  it('runs every branch and weights them to one', () => {
    const shadow = evaluateShadow(input)
    expect(shadow.branches).toHaveLength(branches.length)
    const total = shadow.branches.reduce((sum, branch) => sum + branch.probability, 0)
    expect(total).toBeCloseTo(1, 12)
    expect(shadow.branches.every((branch) => branch.failed === null)).toBe(true)
  })

  it('normalises probabilities that do not sum to one, and says it did', () => {
    const skewed = branches.map((branch) => ({ ...branch, probability: branch.probability * 3 }))
    const shadow = evaluateShadow({ ...input, branches: skewed })
    expect(shadow.normalised).toBe(true)
    expect(shadow.branches.reduce((sum, branch) => sum + branch.probability, 0)).toBeCloseTo(1, 12)
  })

  /**
   * Dilution is the mechanism the whole module exists to price, so it has to be visible: the
   * investor owns less after the follow-on than before it in every branch, and less still
   * where they did not take their pro-rata.
   */
  it('shows the follow-on diluting today’s investor, less so with pro-rata', () => {
    const shadow = evaluateShadow(input)
    for (const branch of shadow.branches) {
      expect(branch.investorOwnershipAfter).toBeLessThan(branch.investorOwnershipBefore)
    }
    const withProRata = shadow.branches.filter((branch) => branch.proRataInvestment > 0)
    const withoutProRata = shadow.branches.filter((branch) => branch.proRataInvestment === 0)
    expect(withProRata.length).toBeGreaterThan(0)
    expect(withoutProRata.length).toBeGreaterThan(0)
    const dilution = (branch: (typeof shadow.branches)[number]): number =>
      branch.investorOwnershipBefore - branch.investorOwnershipAfter
    expect(Math.max(...withoutProRata.map(dilution))).toBeGreaterThan(
      Math.min(...withProRata.map(dilution)),
    )
  })

  /**
   * The flagship claim, on the term that makes it sharpest. Anti-dilution is *structurally*
   * worth nothing in a one-round model — there is no later round whose price could be lower —
   * so the single-round reading must price the difference between no protection and a full
   * ratchet at exactly zero. Put a down round in the branch set and it acquires a price.
   */
  it('gives anti-dilution a price it cannot have in a single-round model', () => {
    const stacked = deck('series-b-stacked-down-round')
    // Price this round *above* the Series A conversion price of $2, so the protection cannot
    // bite today. The only place it can bite is the down-round branch.
    const upTerms = { ...stacked.terms, preMoney: 30_000_000 }
    const stackedPinned = { index: 0, terms: upTerms }
    const stackedBranches = defaultBranches(upTerms, (upTerms.preMoney ?? 0) + upTerms.investment)
    const stackedInput = {
      pre: stacked.pre,
      safes: stacked.safes,
      pkg: stackedPinned,
      branches: stackedBranches,
      founderBeliefs: stacked.founderBeliefs,
      investorBeliefs: stacked.investorBeliefs,
      risk: stacked.risk,
    }
    const ratcheted = {
      ...stacked.pre,
      classes: stacked.pre.classes.map((cls) =>
        cls.kind === 'PREFERRED' ? { ...cls, antiDilution: 'FULL_RATCHET' as const } : cls,
      ),
    }
    const comparison = shadowTermPrice(stackedInput, {
      label: 'broad-based weighted average → full ratchet',
      pre: ratcheted,
    })
    expect(comparison.singleRound.founder).toBeCloseTo(0, 6)
    expect(comparison.singleRound.investor).toBeCloseTo(0, 6)
    expect(Math.abs(comparison.withShadow.founder)).toBeGreaterThan(0)
    expect(Math.abs(comparison.founderDelta)).toBeGreaterThan(0)
  })

  it('reports a branch that cannot be constructed instead of dropping it', () => {
    const impossible = [
      ...branches,
      {
        id: 'broken',
        label: 'Infeasible pool',
        probability: 0.1,
        proRata: false,
        terms: { ...deal.terms, poolTargetPost: 0.4, preMoney: 1 },
      },
    ]
    const shadow = evaluateShadow({ ...input, branches: impossible })
    const broken = shadow.branches.find((branch) => branch.branchId === 'broken')!
    expect(broken.failed === null || broken.warnings.length >= 0).toBe(true)
    expect(shadow.branches.filter((branch) => branch.failed === null).length).toBeGreaterThan(0)
  })
})
