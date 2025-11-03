import type { MultiPartyBargainResult, MultiPartyDealPoint, MultiPartyDisagreement } from './schema'

function byIndex(points: MultiPartyDealPoint[]): MultiPartyDealPoint[] {
  return [...points].sort((left, right) => left.pkg.index - right.pkg.index)
}

function descending(left: number, right: number): number {
  return right - left
}

function gains(
  point: MultiPartyDealPoint,
  parties: string[],
  d0: MultiPartyDisagreement,
): number[] {
  return parties.map((party) => (point.utilities[party] ?? 0) - (d0[party] ?? 0))
}

function product(values: number[]): number {
  return values.reduce((acc, value) => acc * value, 1)
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

/**
 * Pareto frontier in R^n for a discrete cloud (§6.19.4).
 * Sort by descending utilities in party order then index; keep a point iff it is not
 * weakly dominated by any already-kept point under the running orthant filter:
 * a point is kept when it strictly improves at least one coordinate relative to the
 * undominated envelope. For n=2 this recovers §6.9.4's descending-uF / running-max-uI rule
 * when parties = [founder, investor].
 *
 * Implementation: sort by first utility desc, then sweep keeping points that are not
 * dominated by any previously kept point.
 */
function frontierN(points: MultiPartyDealPoint[], parties: string[]): number[] {
  const sorted = [...points].sort((left, right) => {
    for (const party of parties) {
      const delta = (right.utilities[party] ?? 0) - (left.utilities[party] ?? 0)
      if (delta !== 0) return delta
    }
    return left.pkg.index - right.pkg.index
  })
  const kept: MultiPartyDealPoint[] = []
  for (const point of sorted) {
    const dominated = kept.some(
      (prior) =>
        parties.every(
          (party) => (prior.utilities[party] ?? 0) >= (point.utilities[party] ?? 0) - 1e-12,
        ) &&
        parties.some(
          (party) => (prior.utilities[party] ?? 0) > (point.utilities[party] ?? 0) + 1e-12,
        ),
    )
    if (!dominated) kept.push(point)
  }
  // Collapse exact duplicates to lowest index (already sorted by index on ties of utilities via sort).
  return kept.map((point) => point.pkg.index)
}

function choose(
  candidates: MultiPartyDealPoint[],
  compare: (left: MultiPartyDealPoint, right: MultiPartyDealPoint) => number,
): MultiPartyDealPoint | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, candidate) => (compare(candidate, best) < 0 ? candidate : best))
}

/**
 * N-party discrete bargaining solutions (§6.19).
 *
 * The discrete cloud supports n≥2 directly:
 * - IR: u_i ≥ d_i for all parties
 * - Nash: argmax ∏(u_i − d_i) over IR (Nash 1950 n-person product)
 * - KS (discrete): argmax min_i (u_i−d_i)/(I_i−d_i) with I_i = max IR u_i
 * - Egalitarian: argmax min_i (u_i − d_i)
 * - Utilitarian: argmax Σ(u_i − d_i)
 *
 * Tie-breaks generalize D23: primary axiom key → gain-product → lowest package index
 * (egalitarian uses sum of gains as secondary). Affine invariance of Nash/KS keys holds
 * under per-axis positive affine transforms exactly as in the two-party case.
 *
 * Classical KS on a compact convex set lives on the ideal-line segment; this remains the
 * discrete maximin-normalized-gain surrogate and must be labeled "Kalai–Smorodinsky (discrete)".
 */
export function analyzeN(
  points: MultiPartyDealPoint[],
  disagreement: MultiPartyDisagreement,
  partyOrder?: string[],
): MultiPartyBargainResult {
  const ordered = byIndex(points)
  const parties =
    partyOrder ?? Object.keys(disagreement).sort((left, right) => left.localeCompare(right))
  if (parties.length < 2) throw new RangeError('analyzeN requires at least two parties')
  for (const party of parties) {
    if (!(party in disagreement)) throw new RangeError(`Missing disagreement for party '${party}'`)
  }

  const irPoints = ordered.filter((point) =>
    parties.every((party) => (point.utilities[party] ?? 0) >= (disagreement[party] ?? 0)),
  )
  const notes: string[] = []

  const irFrontierIdx = new Set(frontierN(irPoints, parties))
  const selectable = irPoints.filter((point) => irFrontierIdx.has(point.pkg.index))
  const nashPoint = choose(selectable, (left, right) => {
    const leftG = gains(left, parties, disagreement)
    const rightG = gains(right, parties, disagreement)
    return descending(product(leftG), product(rightG)) || left.pkg.index - right.pkg.index
  })

  let ksPoint: MultiPartyDealPoint | null = null
  if (irPoints.length > 0) {
    const ideals = Object.fromEntries(
      parties.map((party) => [
        party,
        Math.max(...irPoints.map((point) => point.utilities[party] ?? 0)),
      ]),
    )
    const denominators = parties.map((party) => ideals[party] - (disagreement[party] ?? 0))
    if (denominators.some((value) => value === 0)) {
      ksPoint = nashPoint
      notes.push('KS fell back to Nash because an ideal gain denominator is zero.')
    } else {
      ksPoint = choose(selectable, (left, right) => {
        const leftG = gains(left, parties, disagreement)
        const rightG = gains(right, parties, disagreement)
        const leftMin = Math.min(...leftG.map((gain, index) => gain / denominators[index]))
        const rightMin = Math.min(...rightG.map((gain, index) => gain / denominators[index]))
        return (
          descending(leftMin, rightMin) ||
          descending(product(leftG), product(rightG)) ||
          left.pkg.index - right.pkg.index
        )
      })
    }
  }

  const egalitarianPoint = choose(selectable, (left, right) => {
    const leftG = gains(left, parties, disagreement)
    const rightG = gains(right, parties, disagreement)
    return (
      descending(Math.min(...leftG), Math.min(...rightG)) ||
      descending(sum(leftG), sum(rightG)) ||
      left.pkg.index - right.pkg.index
    )
  })

  const utilitarianPoint = choose(selectable, (left, right) => {
    const leftG = gains(left, parties, disagreement)
    const rightG = gains(right, parties, disagreement)
    return (
      descending(sum(leftG), sum(rightG)) ||
      descending(product(leftG), product(rightG)) ||
      left.pkg.index - right.pkg.index
    )
  })

  return {
    parties,
    zopa: irPoints.length > 0,
    ir: irPoints.map((point) => point.pkg.index),
    frontier: frontierN(ordered, parties),
    nash: nashPoint?.pkg.index ?? null,
    ks: ksPoint?.pkg.index ?? null,
    egalitarian: egalitarianPoint?.pkg.index ?? null,
    utilitarian: utilitarianPoint?.pkg.index ?? null,
    points: ordered,
    metric: ordered[0]?.metric ?? 'EV',
    notes,
  }
}
