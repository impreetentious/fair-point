import { crraQuadrature } from './mc'
import { expectedPayouts } from './outcomes'
import { constructRound } from './round'
import { accrueForExit } from './accruals'
import { presentValue } from './discounting'
import {
  poolFeasible,
  RoundTermsSchema,
  type BargainResult,
  type Beliefs,
  type CapTable,
  type ConvertibleNote,
  type DealPoint,
  type DealSpace,
  type Disagreement,
  type Discounting,
  type RoundTerms,
  type Safe,
  type TermPackage,
} from './schema'

function linspace([lower, upper]: DealSpace['preMoneyRange'], steps: number): number[] {
  if (steps === 1) return [lower]
  return Array.from(
    { length: steps },
    (_, index) => lower + ((upper - lower) * index) / (steps - 1),
  )
}

type DealSkip = { index: number; reason: 'V1' | 'V3' }
export type EnumeratedDeals = { packages: TermPackage[]; skipped: DealSkip[] }

function validPair(
  multiple: RoundTerms['prefMultiple'],
  participation: RoundTerms['participation'],
): boolean {
  return !(
    (participation === 'CAP2' && multiple >= 2) ||
    (participation === 'CAP3' && multiple >= 3)
  )
}

/**
 * Enumerate the stable row-major grid, retaining raw indices and invalid-cell reasons.
 * V1-invalid preference pairs and V3-infeasible pool cells are omitted before round construction.
 */
export function enumerateDealsWithReasons(space: DealSpace): EnumeratedDeals {
  const packages: TermPackage[] = []
  const skipped: DealSkip[] = []
  let index = 0
  for (const preMoney of linspace(space.preMoneyRange, space.preMoneySteps)) {
    for (const poolTargetPost of space.pools) {
      for (const prefMultiple of space.multiples) {
        for (const participation of space.participations) {
          const terms: RoundTerms = {
            preMoney,
            investment: space.pinnedInvestment,
            poolTargetPost,
            prefMultiple,
            participation,
            seniority: space.seniority,
          }
          const rawIndex = index
          index += 1
          if (
            !validPair(prefMultiple, participation) ||
            !RoundTermsSchema.safeParse(terms).success
          ) {
            skipped.push({ index: rawIndex, reason: 'V1' })
            continue
          }
          if (!poolFeasible(terms)) {
            skipped.push({ index: rawIndex, reason: 'V3' })
            continue
          }
          packages.push({ index: rawIndex, terms })
        }
      }
    }
  }
  return { packages, skipped }
}

/** Enumerate the stable row-major grid, retaining raw indices across invalid holes. */
export function enumerateDeals(space: DealSpace): TermPackage[] {
  return enumerateDealsWithReasons(space).packages
}

/** Evaluate a concrete package with each party's own beliefs (or deterministic CE under CRRA). */
export function evaluatePackage(
  pre: CapTable,
  safes: Safe[],
  pkg: TermPackage,
  founderBeliefs: Beliefs,
  investorBeliefs: Beliefs,
  risk: { gamma: 0.5 | 1; w0F: number; w0I: number } | null = null,
  notes: ConvertibleNote[] = [],
  discounting: Discounting | null = null,
  yearsToExit = 0,
): DealPoint {
  const round = constructRound(pre, safes, pkg.terms, notes)
  const post = accrueForExit(round.post, yearsToExit)
  if (risk !== null) {
    return {
      pkg,
      uF: presentValue(
        crraQuadrature(post, 'FOUNDER', founderBeliefs, risk.gamma, risk.w0F).ce,
        discounting,
      ),
      uI: presentValue(
        crraQuadrature(post, 'INVESTOR', investorBeliefs, risk.gamma, risk.w0I).ce,
        discounting,
      ),
      uF_underI: presentValue(
        crraQuadrature(post, 'FOUNDER', investorBeliefs, risk.gamma, risk.w0F).ce,
        discounting,
      ),
      uI_underF: presentValue(
        crraQuadrature(post, 'INVESTOR', founderBeliefs, risk.gamma, risk.w0I).ce,
        discounting,
      ),
      metric: 'CE',
      diagnostics: round.diagnostics,
    }
  }
  const founder = expectedPayouts(post, founderBeliefs)
  const investor = expectedPayouts(post, investorBeliefs)
  return {
    pkg,
    uF: presentValue(founder.party.founder, discounting),
    uI: presentValue(investor.party.investor, discounting),
    uF_underI: presentValue(investor.party.founder, discounting),
    uI_underF: presentValue(founder.party.investor, discounting),
    metric: 'EV',
    diagnostics: round.diagnostics,
  }
}

function byIndex(points: DealPoint[]): DealPoint[] {
  return [...points].sort((left, right) => left.pkg.index - right.pkg.index)
}

function frontier(points: DealPoint[]): number[] {
  const sorted = [...points].sort(
    (left, right) => right.uF - left.uF || right.uI - left.uI || left.pkg.index - right.pkg.index,
  )
  let highestInvestor = -Infinity
  const result: number[] = []
  for (const point of sorted) {
    if (point.uI > highestInvestor) {
      result.push(point.pkg.index)
      highestInvestor = point.uI
    }
  }
  return result
}

function gain(
  point: DealPoint,
  disagreement: Disagreement,
): { f: number; i: number; product: number; sum: number } {
  const f = point.uF - disagreement.dF
  const i = point.uI - disagreement.dI
  return { f, i, product: f * i, sum: f + i }
}

function choose(
  candidates: DealPoint[],
  compare: (left: DealPoint, right: DealPoint) => number,
): DealPoint | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, candidate) => (compare(candidate, best) < 0 ? candidate : best))
}

function descending(left: number, right: number): number {
  return right - left
}

function descendingStable(left: number, right: number): number {
  const delta = right - left
  const tolerance = 1e-10 * Math.max(1, Math.abs(left), Math.abs(right))
  return Math.abs(delta) <= tolerance ? 0 : delta
}

function sameTerms(left: RoundTerms, right: RoundTerms): boolean {
  const participants = (terms: RoundTerms) =>
    [...new Set(terms.payToPlayParticipants ?? [])].sort((a, b) => a.localeCompare(b)).join('\0')
  return (
    left.preMoney === right.preMoney &&
    left.pricedPerShare === right.pricedPerShare &&
    left.investment === right.investment &&
    left.poolTargetPost === right.poolTargetPost &&
    left.prefMultiple === right.prefMultiple &&
    left.participation === right.participation &&
    left.seniority === right.seniority &&
    participants(left) === participants(right)
  )
}

/** Analyze IR, frontier, and the four deterministic discrete bargaining selections. */
export function analyze(points: DealPoint[], disagreement: Disagreement): BargainResult {
  const ordered = byIndex(points)
  const irPoints = ordered.filter(
    (point) => point.uF >= disagreement.dF && point.uI >= disagreement.dI,
  )
  const frontierIdx = new Set(frontier(irPoints))
  const selectable = irPoints.filter((point) => frontierIdx.has(point.pkg.index))
  const nashPoint = choose(
    selectable,
    (left, right) =>
      descendingStable(gain(left, disagreement).product, gain(right, disagreement).product) ||
      left.pkg.index - right.pkg.index,
  )
  const notes: string[] = []
  let ksPoint: DealPoint | null = null
  if (irPoints.length > 0) {
    const idealF = Math.max(...irPoints.map((point) => point.uF))
    const idealI = Math.max(...irPoints.map((point) => point.uI))
    const denominatorF = idealF - disagreement.dF
    const denominatorI = idealI - disagreement.dI
    if (denominatorF === 0 || denominatorI === 0) {
      ksPoint = nashPoint
      notes.push('KS fell back to Nash because an ideal gain denominator is zero.')
    } else {
      ksPoint = choose(selectable, (left, right) => {
        const leftGain = gain(left, disagreement)
        const rightGain = gain(right, disagreement)
        const leftMinimum = Math.min(leftGain.f / denominatorF, leftGain.i / denominatorI)
        const rightMinimum = Math.min(rightGain.f / denominatorF, rightGain.i / denominatorI)
        return (
          descendingStable(leftMinimum, rightMinimum) ||
          descendingStable(leftGain.product, rightGain.product) ||
          left.pkg.index - right.pkg.index
        )
      })
    }
  }
  const egalitarianPoint = choose(selectable, (left, right) => {
    const leftGain = gain(left, disagreement)
    const rightGain = gain(right, disagreement)
    return (
      descending(Math.min(leftGain.f, leftGain.i), Math.min(rightGain.f, rightGain.i)) ||
      descending(leftGain.sum, rightGain.sum) ||
      left.pkg.index - right.pkg.index
    )
  })
  const utilitarianPoint = choose(selectable, (left, right) => {
    const leftGain = gain(left, disagreement)
    const rightGain = gain(right, disagreement)
    return (
      descending(leftGain.sum, rightGain.sum) ||
      descending(leftGain.product, rightGain.product) ||
      left.pkg.index - right.pkg.index
    )
  })
  return {
    zopa: irPoints.length > 0,
    ir: irPoints.map((point) => point.pkg.index),
    frontier: frontier(ordered),
    nash: nashPoint?.pkg.index ?? null,
    ks: ksPoint?.pkg.index ?? null,
    egalitarian: egalitarianPoint?.pkg.index ?? null,
    utilitarian: utilitarianPoint?.pkg.index ?? null,
    points: ordered,
    metric: ordered[0]?.metric ?? 'EV',
    notes,
  }
}

/** Compute the defined single-package and per-party value-on-table measures. */
export function valueOnTable(
  result: BargainResult,
  current: DealPoint,
): { headline: number; gainF: number; gainI: number; dominating: number[] } {
  const ir = new Set(result.ir)
  const eligible = result.points.filter((point) => {
    const isCurrentAlias =
      sameTerms(point.pkg.terms, current.pkg.terms) &&
      Math.abs(point.uF - current.uF) <= 1e-9 &&
      Math.abs(point.uI - current.uI) <= 1e-9
    return (
      ir.has(point.pkg.index) &&
      point.pkg.index !== current.pkg.index &&
      !isCurrentAlias &&
      point.uF >= current.uF - 1 &&
      point.uI >= current.uI - 1
    )
  })
  if (eligible.length === 0) return { headline: 0, gainF: 0, gainI: 0, dominating: [] }
  const deltas = eligible.map((point) => ({
    point,
    f: point.uF - current.uF,
    i: point.uI - current.uI,
  }))
  const headline = Math.max(0, ...deltas.map((delta) => delta.f + delta.i))
  const gainF = Math.max(
    0,
    ...deltas.filter((delta) => delta.point.uI >= current.uI).map((delta) => delta.f),
  )
  const gainI = Math.max(
    0,
    ...deltas.filter((delta) => delta.point.uF >= current.uF).map((delta) => delta.i),
  )
  const dominating = [...deltas]
    .sort(
      (left, right) =>
        descending(Math.min(left.f, left.i), Math.min(right.f, right.i)) ||
        descending(left.f + left.i, right.f + right.i) ||
        left.point.pkg.index - right.point.pkg.index,
    )
    .slice(0, 3)
    .map((delta) => delta.point.pkg.index)
  return { headline, gainF, gainI, dominating }
}
