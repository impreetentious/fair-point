import { analyze, enumerateDeals, evaluatePackage, valueOnTable } from './bargain'
import { BeliefsSchema, type BargainResult } from './schema'
import type {
  Beliefs,
  CapTable,
  ConvertibleNote,
  DealPoint,
  DealSpace,
  Disagreement,
  Discounting,
  Safe,
  TermPackage,
} from './schema'

/**
 * The belief tornado.
 *
 * Every number this instrument prints rests on four guesses about the exit: the chance the
 * company is worth nothing, and three points on the distribution if it is not. The frontier,
 * the fair points, and the value left on the table are all downstream of those four. This
 * asks the obvious next question — *which of the four is actually carrying the answer?* — by
 * moving one at a time and leaving the rest where they are.
 *
 * The output is a ranked list rather than a chart legend: the first row is the diligence
 * question worth asking first, because it is the one whose answer moves the deal most. Where
 * a perturbed belief is not a coherent belief (a p50 pushed above p90, say) the row says so
 * rather than clamping quietly into a number that means something else.
 */

type BeliefField = 'p0' | 'p10' | 'p50' | 'p90'
type BeliefParty = 'founder' | 'investor'

interface TornadoBar {
  party: BeliefParty
  field: BeliefField
  /** The belief values probed, low and high. */
  low: number
  high: number
  /** The headline at the low and high ends; null where the perturbed belief is incoherent. */
  lowValue: number | null
  highValue: number | null
  baseValue: number
  /** Full swing across the two ends — the sort key, and the reason the row is on the list. */
  swing: number
  incoherent: string | null
}

export type TornadoHeadline =
  | 'founderEv'
  | 'investorEv'
  | 'valueOnTable'
  | 'nashFounderEv'
  | 'nashInvestorEv'

export interface BeliefTornado {
  headline: TornadoHeadline
  baseValue: number
  bars: TornadoBar[]
  /** Belief fields in descending swing — the order to pressure-test them in. */
  ranking: Array<{ party: BeliefParty; field: BeliefField; swing: number }>
}

export interface TornadoInput {
  pre: CapTable
  safes: Safe[]
  space: DealSpace
  /** The offer on the table; its own EV is one of the available headlines. */
  pinned: TermPackage
  founderBeliefs: Beliefs
  investorBeliefs: Beliefs
  disagreement: Disagreement
  risk?: { gamma: 0.5 | 1; w0F: number; w0I: number } | null
  notes?: ConvertibleNote[]
  discounting?: Discounting | null
  yearsToExit?: number
  /** Relative move applied to each belief, either side of its stated value. Default ±20%. */
  spread?: number
}

const DEFAULT_SPREAD = 0.2

function perturb(
  beliefs: Beliefs,
  field: BeliefField,
  factor: number,
  spread: number,
): Beliefs | null {
  const next: Record<string, number | undefined> = { ...beliefs }
  if (field === 'p0') {
    // A probability moves in absolute points. Scaling it would make the low end meaningless
    // near zero and push it past one near the top, so the probe is ± half the spread.
    const move = Math.sign(factor - 1) * (spread / 2)
    next.p0 = Math.min(0.99, Math.max(0, beliefs.p0 + move))
  } else {
    const current = beliefs[field]
    if (current === undefined) return null
    next[field] = current * factor
  }
  const parsed = BeliefsSchema.safeParse(next)
  return parsed.success ? parsed.data : null
}

interface Evaluated {
  points: DealPoint[]
  result: BargainResult
  pinnedPoint: DealPoint
}

function evaluateWorld(
  input: TornadoInput,
  founderBeliefs: Beliefs,
  investorBeliefs: Beliefs,
): Evaluated {
  const packages = enumerateDeals(input.space)
  const evaluateOne = (pkg: TermPackage): DealPoint =>
    evaluatePackage(
      input.pre,
      input.safes,
      pkg,
      founderBeliefs,
      investorBeliefs,
      input.risk ?? null,
      input.notes ?? [],
      input.discounting ?? null,
      input.yearsToExit ?? 0,
    )
  const points = packages.map(evaluateOne)
  return {
    points,
    result: analyze(points, input.disagreement),
    pinnedPoint: evaluateOne(input.pinned),
  }
}

function headlineValue(evaluated: Evaluated, headline: TornadoHeadline): number {
  switch (headline) {
    case 'founderEv':
      return evaluated.pinnedPoint.uF
    case 'investorEv':
      return evaluated.pinnedPoint.uI
    case 'valueOnTable':
      return valueOnTable(evaluated.result, evaluated.pinnedPoint).headline
    case 'nashFounderEv':
      return evaluated.result.nash === null
        ? Number.NaN
        : (evaluated.points.find((point) => point.pkg.index === evaluated.result.nash)?.uF ??
            Number.NaN)
    case 'nashInvestorEv':
      return evaluated.result.nash === null
        ? Number.NaN
        : (evaluated.points.find((point) => point.pkg.index === evaluated.result.nash)?.uI ??
            Number.NaN)
  }
}

export function beliefTornado(input: TornadoInput, headline: TornadoHeadline): BeliefTornado {
  const spread = input.spread ?? DEFAULT_SPREAD
  if (!(spread > 0) || !Number.isFinite(spread)) {
    throw new RangeError('Belief-tornado spread must be finite and positive')
  }
  const base = evaluateWorld(input, input.founderBeliefs, input.investorBeliefs)
  const baseValue = headlineValue(base, headline)
  if (!Number.isFinite(baseValue)) {
    throw new Error('The selected tornado headline is unavailable for the baseline deal space')
  }

  const bars: TornadoBar[] = []
  const parties: Array<{ party: BeliefParty; beliefs: Beliefs }> = [
    { party: 'founder', beliefs: input.founderBeliefs },
    { party: 'investor', beliefs: input.investorBeliefs },
  ]

  for (const { party, beliefs } of parties) {
    for (const field of ['p0', 'p10', 'p50', 'p90'] as const) {
      if (field !== 'p0' && beliefs[field] === undefined) continue
      const lowBeliefs = perturb(beliefs, field, 1 - spread, spread)
      const highBeliefs = perturb(beliefs, field, 1 + spread, spread)
      const at = (moved: Beliefs | null): number | null => {
        if (!moved) return null
        const world = evaluateWorld(
          input,
          party === 'founder' ? moved : input.founderBeliefs,
          party === 'investor' ? moved : input.investorBeliefs,
        )
        const value = headlineValue(world, headline)
        return Number.isFinite(value) ? value : null
      }
      const lowValue = at(lowBeliefs)
      const highValue = at(highBeliefs)
      const incoherent =
        lowBeliefs === null || highBeliefs === null
          ? 'Moving this belief on its own would break the ordering p10 < p50 < p90.'
          : null
      bars.push({
        party,
        field,
        low: lowBeliefs?.[field] ?? Number.NaN,
        high: highBeliefs?.[field] ?? Number.NaN,
        lowValue,
        highValue,
        baseValue,
        swing: lowValue === null || highValue === null ? 0 : Math.abs(highValue - lowValue),
        incoherent,
      })
    }
  }

  const ranking = [...bars]
    .filter((bar) => bar.incoherent === null && bar.swing > 0)
    .sort((left, right) => right.swing - left.swing)
    .map((bar) => ({ party: bar.party, field: bar.field, swing: bar.swing }))

  return { headline, baseValue, bars, ranking }
}

/** The sentence the ranking is for. */
export function tornadoSummary(tornado: BeliefTornado): string {
  const first = tornado.ranking[0]
  if (!first) {
    return 'No single belief moves this number on its own — the answer is not resting on one guess.'
  }
  const label = first.party === 'founder' ? 'your' : "the investor's"
  return `Pressure-test ${label} ${first.field} first: moving it alone swings this number by ${Math.round(first.swing).toLocaleString()}.`
}
