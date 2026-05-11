import { evaluatePackage } from './bargain'
import {
  poolFeasible,
  RoundTermsSchema,
  type Beliefs,
  type CapTable,
  type ConvertibleNote,
  type DealPoint,
  type Discounting,
  type RoundTerms,
  type Safe,
} from './schema'

/**
 * The term exchange-rate table.
 *
 * The frontier answers "which package". This answers the other question, the one that is
 * actually asked out loud in the room: *what does this one term cost me, and what does it buy
 * them?* Concessions are made one term at a time, so the useful object is a price list — each
 * term's marginal effect on both sides' expected dollars, in the units the term is negotiated
 * in: per unit of pre-money, per half-turn of preference, per step up the participation
 * ladder, per point of option pool.
 *
 * Nothing new is computed. Each row is the existing package evaluation run on a package that
 * differs in exactly one term, so the prices are as exact as the waterfall is. Where a step
 * would produce a package the schema rejects — a 2× preference with a 2× participation cap,
 * a pool the round cannot fund — the row says that instead of quoting a number.
 *
 * The trade column is the part worth having. When a term move costs the founder, the engine
 * solves for the pre-money that puts them back where they started, then checks whether the
 * investor is *still* ahead at that price. When both are, the trade creates value rather than
 * moving it, and the table says so with the number attached.
 */

export type ExchangeTermId =
  'preMoney' | 'prefMultiple' | 'participation' | 'poolTargetPost' | 'investment'

export interface ExchangeRateRow {
  term: ExchangeTermId
  /** How the step reads in negotiation language, e.g. "1× → 1.5× preference". */
  step: string
  /** The direction the step moves, from the founder's point of view. */
  direction: 'concession' | 'gain'
  /** Change in the founder's expected dollars. Negative is a cost to the founder. */
  deltaFounder: number
  /** Change in the investor's expected dollars. */
  deltaInvestor: number
  /** Sum of the two — positive means the step creates value rather than moving it. */
  deltaJoint: number
  /**
   * The pre-money that would restore the founder's baseline after this step, and whether the
   * investor is still ahead there. Null when the term is pre-money itself, when the step is
   * not a founder concession, or when no pre-money inside the searched band compensates it.
   */
  trade: {
    preMoney: number
    preMoneyDelta: number
    /** Residual founder gap after the trade — the proof the solve landed. */
    founderResidual: number
    investorStillAhead: boolean
    deltaInvestorAfterTrade: number
  } | null
  /** Present when the step is not a legal package; the row quotes this instead of a price. */
  infeasible: string | null
}

export interface ExchangeRateTable {
  baseline: DealPoint
  /** The units each price is quoted in, for the table header. */
  units: { preMoney: number; pool: number }
  rows: ExchangeRateRow[]
  metric: DealPoint['metric']
}

export interface ExchangeRateInput {
  pre: CapTable
  safes: Safe[]
  terms: RoundTerms
  founderBeliefs: Beliefs
  investorBeliefs: Beliefs
  risk?: { gamma: 0.5 | 1; w0F: number; w0I: number } | null
  notes?: ConvertibleNote[]
  discounting?: Discounting | null
  /** Quote pre-money prices per this much valuation. Default $1M. */
  preMoneyUnit?: number
  /** Quote pool prices per this much pool. Default one point. */
  poolUnit?: number
}

const MULTIPLE_LADDER: RoundTerms['prefMultiple'][] = [1, 1.5, 2, 3]
const PARTICIPATION_LADDER: RoundTerms['participation'][] = ['NONE', 'CAP2', 'CAP3', 'FULL']
const TRADE_BISECTIONS = 60

function validPair(
  multiple: RoundTerms['prefMultiple'],
  participation: RoundTerms['participation'],
): boolean {
  return !(
    (participation === 'CAP2' && multiple >= 2) ||
    (participation === 'CAP3' && multiple >= 3)
  )
}

function legality(terms: RoundTerms): string | null {
  if (!validPair(terms.prefMultiple, terms.participation)) {
    return 'A participation cap below the preference multiple is not a coherent term.'
  }
  if (!RoundTermsSchema.safeParse(terms).success) return 'Outside the schema bounds for a round.'
  if (!poolFeasible(terms)) return 'The round cannot fund a pool this large at this valuation.'
  return null
}

function evaluate(input: ExchangeRateInput, terms: RoundTerms, index: number): DealPoint {
  return evaluatePackage(
    input.pre,
    input.safes,
    { index, terms },
    input.founderBeliefs,
    input.investorBeliefs,
    input.risk ?? null,
    input.notes ?? [],
    input.discounting ?? null,
  )
}

/**
 * The pre-money that restores the founder's baseline, found by bisection on the founder's own
 * expected value. It is monotone in pre-money — more valuation is never worth less — so the
 * bracket is sound, and the residual is reported so the caller can see the solve land rather
 * than take it on faith.
 */
function compensatingPreMoney(
  input: ExchangeRateInput,
  stepped: RoundTerms,
  targetFounder: number,
  baselinePre: number,
): ExchangeRateRow['trade'] {
  const evaluateAt = (preMoney: number): DealPoint | null => {
    const candidate: RoundTerms = { ...stepped, preMoney }
    if (legality(candidate) !== null) return null
    return evaluate(input, candidate, -1)
  }
  let lower = baselinePre
  let upper = baselinePre * 4
  const upperPoint = evaluateAt(upper)
  if (!upperPoint || upperPoint.uF < targetFounder) return null
  for (let step = 0; step < TRADE_BISECTIONS; step += 1) {
    const middle = (lower + upper) / 2
    const point = evaluateAt(middle)
    if (!point) {
      lower = middle
      continue
    }
    if (point.uF >= targetFounder) upper = middle
    else lower = middle
  }
  const settled = evaluateAt(upper)
  if (!settled) return null
  const baseline = evaluateAt(baselinePre)
  return {
    preMoney: upper,
    preMoneyDelta: upper - baselinePre,
    founderResidual: settled.uF - targetFounder,
    investorStillAhead: baseline !== null && settled.uI > baseline.uI,
    deltaInvestorAfterTrade: baseline === null ? 0 : settled.uI - baseline.uI,
  }
}

function row(
  input: ExchangeRateInput,
  baseline: DealPoint,
  term: ExchangeTermId,
  step: string,
  stepped: RoundTerms,
  index: number,
): ExchangeRateRow {
  const infeasible = legality(stepped)
  if (infeasible !== null) {
    return {
      term,
      step,
      direction: 'concession',
      deltaFounder: 0,
      deltaInvestor: 0,
      deltaJoint: 0,
      trade: null,
      infeasible,
    }
  }
  const point = evaluate(input, stepped, index)
  const deltaFounder = point.uF - baseline.uF
  const deltaInvestor = point.uI - baseline.uI
  const direction: ExchangeRateRow['direction'] = deltaFounder < 0 ? 'concession' : 'gain'
  const trade =
    term === 'preMoney' || deltaFounder >= 0 || stepped.preMoney === undefined
      ? null
      : compensatingPreMoney(input, stepped, baseline.uF, stepped.preMoney)
  return {
    term,
    step,
    direction,
    deltaFounder,
    deltaInvestor,
    deltaJoint: deltaFounder + deltaInvestor,
    trade,
    infeasible: null,
  }
}

export function exchangeRateTable(input: ExchangeRateInput): ExchangeRateTable {
  const { terms } = input
  const preMoneyUnit = input.preMoneyUnit ?? 1_000_000
  const poolUnit = input.poolUnit ?? 0.01
  const baseline = evaluate(input, terms, 0)
  const rows: ExchangeRateRow[] = []
  let index = 1

  if (terms.preMoney !== undefined) {
    rows.push(
      row(
        input,
        baseline,
        'preMoney',
        `+${formatMoney(preMoneyUnit)} pre-money`,
        { ...terms, preMoney: terms.preMoney + preMoneyUnit },
        index++,
      ),
    )
  }

  const multipleIndex = MULTIPLE_LADDER.indexOf(terms.prefMultiple)
  const nextMultiple = MULTIPLE_LADDER[multipleIndex + 1]
  if (nextMultiple !== undefined) {
    rows.push(
      row(
        input,
        baseline,
        'prefMultiple',
        `${terms.prefMultiple}× → ${nextMultiple}× preference`,
        { ...terms, prefMultiple: nextMultiple },
        index++,
      ),
    )
  }
  const previousMultiple = MULTIPLE_LADDER[multipleIndex - 1]
  if (previousMultiple !== undefined) {
    rows.push(
      row(
        input,
        baseline,
        'prefMultiple',
        `${terms.prefMultiple}× → ${previousMultiple}× preference`,
        { ...terms, prefMultiple: previousMultiple },
        index++,
      ),
    )
  }

  const participationIndex = PARTICIPATION_LADDER.indexOf(terms.participation)
  const nextParticipation = PARTICIPATION_LADDER[participationIndex + 1]
  if (nextParticipation !== undefined) {
    rows.push(
      row(
        input,
        baseline,
        'participation',
        `${terms.participation} → ${nextParticipation} participation`,
        { ...terms, participation: nextParticipation },
        index++,
      ),
    )
  }
  const previousParticipation = PARTICIPATION_LADDER[participationIndex - 1]
  if (previousParticipation !== undefined) {
    rows.push(
      row(
        input,
        baseline,
        'participation',
        `${terms.participation} → ${previousParticipation} participation`,
        { ...terms, participation: previousParticipation },
        index++,
      ),
    )
  }

  rows.push(
    row(
      input,
      baseline,
      'poolTargetPost',
      `+${(poolUnit * 100).toFixed(1)} pool point${poolUnit === 0.01 ? '' : 's'}`,
      { ...terms, poolTargetPost: terms.poolTargetPost + poolUnit },
      index++,
    ),
  )

  rows.push(
    row(
      input,
      baseline,
      'investment',
      `+${formatMoney(preMoneyUnit)} investment`,
      { ...terms, investment: terms.investment + preMoneyUnit },
      index,
    ),
  )

  return {
    baseline,
    units: { preMoney: preMoneyUnit, pool: poolUnit },
    rows,
    metric: baseline.metric,
  }
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}
