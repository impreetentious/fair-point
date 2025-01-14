import type { CapTable, Payouts, Regime } from './schema'
import { payoutsAt } from './waterfall'

type Coefficients = Record<string, { m: number; c: number }>

const regimeCache = new WeakMap<CapTable, Regime[]>()

function simpleTwoClassRegimes(post: CapTable): Regime[] | null {
  if (post.grants.length !== 0 || post.classes.length !== 2) return null
  const common = post.classes.find((cls) => cls.kind === 'COMMON')
  const preferred = post.classes.find((cls) => cls.kind === 'PREFERRED')
  if (common === undefined || preferred === undefined) return null
  const convertedShares = preferred.shares * preferred.conversionRatio
  const totalShares = common.shares + convertedShares
  if (!(convertedShares > 0 && totalShares > 0)) return null
  const preferredFraction = convertedShares / totalShares
  const commonFraction = common.shares / totalShares
  const preference = preferred.prefMultiple * preferred.invested
  const base: Regime = {
    from: 0,
    to: preference,
    event: '',
    coeffs: {
      [common.id]: { m: 0, c: 0 },
      [preferred.id]: { m: 1, c: 0 },
    },
  }
  if (preferred.participation === 'NONE') {
    const conversion = preference / preferredFraction
    return [
      base,
      {
        from: preference,
        to: conversion,
        event: `${preferred.name} preference fills`,
        coeffs: {
          [common.id]: { m: 1, c: -preference },
          [preferred.id]: { m: 0, c: preference },
        },
      },
      {
        from: conversion,
        to: Infinity,
        event: `${preferred.name} converts`,
        coeffs: {
          [common.id]: { m: commonFraction, c: 0 },
          [preferred.id]: { m: preferredFraction, c: 0 },
        },
      },
    ]
  }
  if (preferred.participation === 'FULL') {
    return [
      base,
      {
        from: preference,
        to: Infinity,
        event: `${preferred.name} preference fills`,
        coeffs: {
          [common.id]: { m: commonFraction, c: -commonFraction * preference },
          [preferred.id]: { m: preferredFraction, c: commonFraction * preference },
        },
      },
    ]
  }
  const cap = (preferred.participationCapMultiple ?? Infinity) * preferred.invested
  const capBinds = preference + (cap - preference) / preferredFraction
  const conversion = cap / preferredFraction
  return [
    base,
    {
      from: preference,
      to: capBinds,
      event: `${preferred.name} preference fills`,
      coeffs: {
        [common.id]: { m: commonFraction, c: -commonFraction * preference },
        [preferred.id]: { m: preferredFraction, c: commonFraction * preference },
      },
    },
    {
      from: capBinds,
      to: conversion,
      event: `${preferred.name} participation cap binds`,
      coeffs: {
        [common.id]: { m: 1, c: -cap },
        [preferred.id]: { m: 0, c: cap },
      },
    },
    {
      from: conversion,
      to: Infinity,
      event: `${preferred.name} converts`,
      coeffs: {
        [common.id]: { m: commonFraction, c: 0 },
        [preferred.id]: { m: preferredFraction, c: 0 },
      },
    },
  ]
}

function outputValues(payouts: Payouts): Record<string, number> {
  return { ...payouts.byClass, ...payouts.byGrant }
}

function lineTolerance(value: number): number {
  // Regime discovery needs a much tighter discriminator than fixture comparison tolerance.
  return Math.max(0.001, 1e-12 * Math.abs(value))
}

function coefficientsAt(post: CapTable, from: number): Coefficients {
  let delta = Math.max(1, Math.abs(from) * 1e-8)
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const firstAt = from + delta
    const secondAt = from + 2 * delta
    const thirdAt = from + 3 * delta
    const first = outputValues(payoutsAt(post, firstAt))
    const second = outputValues(payoutsAt(post, secondAt))
    const third = outputValues(payoutsAt(post, thirdAt))
    const coeffs = Object.fromEntries(
      Object.keys(first).map((id) => {
        const m = (second[id] - first[id]) / delta
        return [id, { m, c: first[id] - m * firstAt }]
      }),
    ) as Coefficients
    const consistent = Object.entries(third).every(([id, value]) => Math.abs(value - (coeffs[id].m * thirdAt + coeffs[id].c)) <= lineTolerance(value))
    if (consistent) return coeffs
    delta /= 2
  }
  const first = outputValues(payoutsAt(post, from + delta))
  const second = outputValues(payoutsAt(post, from + 2 * delta))
  return Object.fromEntries(
    Object.keys(first).map((id) => {
      const m = (second[id] - first[id]) / delta
      return [id, { m, c: first[id] - m * (from + delta) }]
    }),
  ) as Coefficients
}

function localSlope(post: CapTable, exitValue: number, delta: number): Record<string, number> {
  const left = outputValues(payoutsAt(post, exitValue))
  const right = outputValues(payoutsAt(post, exitValue + delta))
  return Object.fromEntries(Object.keys(left).map((id) => [id, (right[id] - left[id]) / delta]))
}

function sameSlope(left: Record<string, number>, right: Record<string, number>): boolean {
  return Object.keys(left).every((id) => Math.abs(left[id] - right[id]) <= Math.max(1e-7, 1e-7 * Math.abs(left[id])))
}

function conservativeUpperBound(post: CapTable): number {
  const preferred = post.classes.filter((cls) => cls.kind === 'PREFERRED')
  const shareCount =
    post.classes.reduce((sum, cls) => sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares), 0) +
    post.grants.reduce((sum, grant) => sum + grant.options, 0)
  const smallestPreferred = Math.min(...preferred.map((cls) => cls.shares * cls.conversionRatio), Infinity)
  const preferenceOrCap = preferred.reduce(
    (sum, cls) => sum + Math.max(cls.prefMultiple, cls.participationCapMultiple ?? cls.prefMultiple) * cls.invested,
    0,
  )
  const maxStrike = Math.max(...post.grants.map((grant) => grant.strike), 0)
  const ratio = Number.isFinite(smallestPreferred) ? Math.max(1, shareCount / smallestPreferred) : 1
  return Math.max(1, (preferenceOrCap + maxStrike * shareCount + 1) * (ratio + 1) * 64)
}

function eventLabel(post: CapTable, before: number, after: number): string {
  const left = payoutsAt(post, Math.max(0, before - 1e-5))
  const right = payoutsAt(post, after + 1e-5)
  for (const cls of post.classes) {
    if (cls.kind !== 'PREFERRED') continue
    if (left.pathTaken[cls.id] !== right.pathTaken[cls.id]) {
      if (right.pathTaken[cls.id] === 'CONVERTED') return `${cls.name} converts`
      if (right.pathTaken[cls.id] === 'CAPPED') return `${cls.name} participation cap binds`
    }
  }
  for (const grant of post.grants) {
    if (left.byGrant[grant.id] === 0 && right.byGrant[grant.id] > 0) return `${grant.id} becomes exercisable`
  }
  return 'regime change (unclassified)'
}

function hasReachedTerminalState(post: CapTable, from: number): boolean {
  const sample = payoutsAt(post, from + 1)
  const preferencesAreFilled =
    from >=
    post.classes
      .filter((cls) => cls.kind === 'PREFERRED')
      .reduce((sum, cls) => sum + cls.prefMultiple * cls.invested, 0)
  const preferredAreTerminal = post.classes
    .filter((cls) => cls.kind === 'PREFERRED')
    .every((cls) => sample.pathTaken[cls.id] === 'CONVERTED' || cls.participation === 'FULL')
  const grantsAreTerminal = post.grants.every((grant) => sample.perCommonShareProceeds > grant.strike)
  return preferencesAreFilled && preferredAreTerminal && grantsAreTerminal
}

/**
 * Regime walk for the piecewise-affine settlement. It uses the settlement itself as the oracle and
 * binary-recovers every observed kink, including an unclassified equilibrium fallback boundary.
 */
function computeRegimes(post: CapTable): Regime[] {
  const simple = simpleTwoClassRegimes(post)
  if (simple !== null) return simple
  const upperBound = conservativeUpperBound(post)
  const result: Regime[] = []
  let from = 0
  for (let count = 0; count < 4 * (post.classes.length + post.grants.length) + 8; count += 1) {
    const coeffs = coefficientsAt(post, from)
    if (hasReachedTerminalState(post, from)) {
      result.push({ from, to: Infinity, event: result.length === 0 ? '' : 'regime change (unclassified)', coeffs })
      return result
    }
    const slopeDelta = 1
    const baseline = localSlope(post, from + slopeDelta, slopeDelta)
    let previous = from + 2 * slopeDelta
    let next: number | null = null
    const scans = 512
    for (let step = 1; step <= scans; step += 1) {
      const probe = from + ((upperBound - from) * step) / scans
      if (!sameSlope(baseline, localSlope(post, probe, slopeDelta))) {
        let low = previous
        let high = probe
        for (let iteration = 0; iteration < 80 && high - low > 1e-5; iteration += 1) {
          const middle = (low + high) / 2
          if (sameSlope(baseline, localSlope(post, middle, slopeDelta))) low = middle
          else high = middle
        }
        next = Math.min(upperBound, high + slopeDelta)
        break
      }
      previous = probe
    }
    if (next === null || next <= from + 1e-6) {
      result.push({ from, to: Infinity, event: result.length === 0 ? '' : 'regime change (unclassified)', coeffs })
      return result
    }
    result.push({ from, to: next, event: result.length === 0 ? '' : eventLabel(post, next - 1e-4, next + 1e-4), coeffs })
    from = next
  }
  throw new Error('Regime walk exceeded its deterministic backstop')
}

/** Exact piecewise-affine regime list, memoized by the immutable post-round table reference. */
export function regimes(post: CapTable): Regime[] {
  const cached = regimeCache.get(post)
  if (cached !== undefined) return cached
  const calculated = computeRegimes(post)
  regimeCache.set(post, calculated)
  return calculated
}
