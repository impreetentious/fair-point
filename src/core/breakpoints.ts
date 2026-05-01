import type { CapTable, Payouts, Regime } from './schema'
import { preferenceClaim } from './accruals'
import { payoutsAt } from './waterfall'

type Coefficients = Record<string, { m: number; c: number }>

const regimeCache = new WeakMap<CapTable, Regime[]>()

export function simpleTwoClassRegimes(post: CapTable): Regime[] | null {
  if (post.grants.length !== 0 || post.classes.length !== 2) return null
  const common = post.classes.find((cls) => cls.kind === 'COMMON')
  const preferred = post.classes.find((cls) => cls.kind === 'PREFERRED')
  if (common === undefined || preferred === undefined) return null
  const convertedShares = preferred.shares * preferred.conversionRatio
  const totalShares = common.shares + convertedShares
  if (!(convertedShares > 0 && totalShares > 0)) return null
  const preferredFraction = convertedShares / totalShares
  const commonFraction = common.shares / totalShares
  const preference = preferenceClaim(preferred)
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
  // Accrued dividends or an eligible redemption right can lift the preference
  // above the contractual participation cap. Let the generic settlement walk
  // handle that shape instead of emitting reversed or negative-width regimes.
  if (cap <= preference) return null
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

function lineTolerance(value: number, exitValue: number): number {
  // Settlement choices are exact in principle but their floating-point equilibrium probes are not.
  // This discriminator must stay materially below the public $0.01 fixture tolerance: a class
  // with a tiny ownership fraction can have a real slope change whose first-dollar effect is
  // much smaller than a cent. Every payout is carved out of the exit value, though, so its
  // rounding floor follows the exit's magnitude rather than its own: a small class read off a
  // multi-billion exit carries that exit's last bits, and a tolerance below them would split
  // one affine segment into rounding-sized regimes until the walk's backstop throws.
  return Math.max(1e-7, 5e-12 * Math.abs(value), 64 * Number.EPSILON * Math.abs(exitValue))
}

function coefficientsAt(post: CapTable, from: number): Coefficients {
  // Derive the line immediately to the right of the current breakpoint.  Grow
  // the finite-difference span only while a half-step and a third step verify
  // it.  This avoids straddling a small claim (whose samples can coincidentally
  // be collinear) while retaining enough distance for stable large-dollar math.
  const samples = new Map<number, Record<string, number>>()
  const sample = (exitValue: number) => {
    const cached = samples.get(exitValue)
    if (cached !== undefined) return cached
    const values = outputValues(payoutsAt(post, exitValue))
    samples.set(exitValue, values)
    return values
  }
  // Zero is an exact settlement anchor. A positive epsilon at the origin can
  // still lie inside the settlement engine's no-distribution decision band.
  const anchorAt = from === 0 ? 0 : from + localProbeDistance(from)
  const anchor = sample(anchorAt)
  let delta = probeDistance(from)
  let accepted: Coefficients | null = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const halfAt = from + delta / 2
    const firstAt = from + delta
    const secondAt = from + 2 * delta
    const thirdAt = from + 3 * delta
    const half = sample(halfAt)
    const first = sample(firstAt)
    const second = sample(secondAt)
    const third = sample(thirdAt)
    const coeffs = Object.fromEntries(
      Object.keys(first).map((id) => {
        const m = (second[id] - first[id]) / delta
        return [id, { m, c: first[id] - m * firstAt }]
      }),
    ) as Coefficients
    const follows = (values: Record<string, number>, exitValue: number) =>
      Object.entries(values).every(
        ([id, value]) =>
          Math.abs(value - (coeffs[id].m * exitValue + coeffs[id].c)) <=
          lineTolerance(value, exitValue),
      )
    const consistent = follows(anchor, anchorAt) && follows(half, halfAt) && follows(third, thirdAt)
    if (consistent) {
      accepted = coeffs
      delta *= 2
      continue
    }
    if (accepted !== null) return accepted
    delta /= 2
  }
  if (accepted !== null) return accepted
  const first = sample(from + delta)
  const second = sample(from + 2 * delta)
  return Object.fromEntries(
    Object.keys(first).map((id) => {
      const m = (second[id] - first[id]) / delta
      return [id, { m, c: first[id] - m * (from + delta) }]
    }),
  ) as Coefficients
}

function probeDistance(value: number): number {
  return Math.max(0.001, Math.abs(value) * 1e-9)
}

/** A state probe must remain inside an arbitrarily narrow current regime. */
function localProbeDistance(value: number): number {
  return Math.max(1e-6, Math.abs(value) * 1e-12)
}

function verificationDistance(from: number, candidate: number): number {
  return Math.max(0.1, Math.min(1, (candidate - from) * 1e-4))
}

function followsLine(post: CapTable, coeffs: Coefficients, exitValue: number): boolean {
  const values = outputValues(payoutsAt(post, exitValue))
  return Object.entries(values).every(([id, value]) => {
    const coefficient = coeffs[id]
    return (
      coefficient !== undefined &&
      Math.abs(value - (coefficient.m * exitValue + coefficient.c)) <=
        lineTolerance(value, exitValue)
    )
  })
}

/**
 * The last regime is extrapolated without bound, so a slope taken from a short local
 * difference turns its rounding into an error that grows with every dollar past the
 * breakpoint. Refit that line across a wide span, where the same rounding is divided by a
 * span thousands of times longer. Keep the local fit when the wide line misses its own
 * midpoint: then the segment is not affine that far and the wide fit would be the lie.
 */
function unboundedCoefficients(post: CapTable, from: number, local: Coefficients): Coefficients {
  const nearAt = from + probeDistance(from)
  const farAt = Math.max(nearAt * 1024, nearAt + 1e6)
  const near = outputValues(payoutsAt(post, nearAt))
  const far = outputValues(payoutsAt(post, farAt))
  const coeffs = Object.fromEntries(
    Object.keys(near).map((id) => {
      const m = (far[id] - near[id]) / (farAt - nearAt)
      return [id, { m, c: near[id] - m * nearAt }]
    }),
  ) as Coefficients
  return followsLine(post, coeffs, (nearAt + farAt) / 2) ? coeffs : local
}

/** Binary-recover the first payout that leaves the current affine segment. */
function firstLineDeviation(
  post: CapTable,
  from: number,
  coeffs: Coefficients,
  high: number,
): number | null {
  let low = from + localProbeDistance(from)
  if (low >= high) return null
  if (!followsLine(post, coeffs, low)) return low
  if (followsLine(post, coeffs, high)) return null
  for (let iteration = 0; iteration < 80 && high - low > 0.001; iteration += 1) {
    const middle = (low + high) / 2
    if (followsLine(post, coeffs, middle)) low = middle
    else high = middle
  }
  return high
}

type SettlementState = { paths: string; exercisedGrants: string }

function settlementState(post: CapTable, exitValue: number): SettlementState {
  const payout = payoutsAt(post, exitValue)
  return {
    paths: post.classes.map((cls) => `${cls.id}:${payout.pathTaken[cls.id]}`).join('|'),
    exercisedGrants: post.grants
      // Exercise is a discrete settlement state; use the engine's decision
      // scale rather than the much coarser line-fit tolerance.  Otherwise a
      // zero-strike grant appears to change state again once it earns $0.01.
      .filter((grant) => payout.byGrant[grant.id] > 1e-9)
      .map((grant) => grant.id)
      .join('|'),
  }
}

function sameState(left: SettlementState, right: SettlementState): boolean {
  return left.paths === right.paths && left.exercisedGrants === right.exercisedGrants
}

/** Locate the next conversion or exercise transition with exponential bracketing. */
function nextStateChange(post: CapTable, from: number, upperBound: number): number | null {
  const initialAt = from + localProbeDistance(from)
  if (initialAt >= upperBound) return null
  const initial = settlementState(post, initialAt)
  let low = initialAt
  let high = from + Math.max(1, probeDistance(from))
  while (high < upperBound) {
    if (!sameState(initial, settlementState(post, high))) {
      for (let iteration = 0; iteration < 80 && high - low > 0.001; iteration += 1) {
        const middle = (low + high) / 2
        if (sameState(initial, settlementState(post, middle))) low = middle
        else high = middle
      }
      return high
    }
    low = high
    high = from + (high - from) * 2
  }
  if (sameState(initial, settlementState(post, upperBound))) return null
  high = upperBound
  for (let iteration = 0; iteration < 80 && high - low > 0.001; iteration += 1) {
    const middle = (low + high) / 2
    if (sameState(initial, settlementState(post, middle))) low = middle
    else high = middle
  }
  return high
}

function affineRoot(
  coefficient: { m: number; c: number } | undefined,
  target: number,
  from: number,
  upperBound: number,
): number | null {
  if (coefficient === undefined || coefficient.m <= 1e-12) return null
  const value = (target - coefficient.c) / coefficient.m
  return value > from + 0.0005 && value <= upperBound ? value : null
}

function ppsCoefficient(post: CapTable, from: number): { m: number; c: number } {
  const delta = probeDistance(from)
  const x1 = from + delta
  const x2 = from + 2 * delta
  const p1 = payoutsAt(post, x1).perCommonShareProceeds
  const p2 = payoutsAt(post, x2).perCommonShareProceeds
  const m = (p2 - p1) / delta
  return { m, c: p1 - m * x1 }
}

function conservativeUpperBound(post: CapTable): number {
  const preferred = post.classes.filter((cls) => cls.kind === 'PREFERRED')
  const shareCount =
    post.classes.reduce(
      (sum, cls) =>
        sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares),
      0,
    ) + post.grants.reduce((sum, grant) => sum + grant.options, 0)
  const smallestPreferred = Math.min(
    ...preferred.map((cls) => cls.shares * cls.conversionRatio),
    Infinity,
  )
  const preferenceOrCap = preferred.reduce((sum, cls) => {
    const cap = (cls.participationCapMultiple ?? cls.prefMultiple) * cls.invested
    return sum + Math.max(preferenceClaim(cls), cap)
  }, 0)
  const maxStrike = Math.max(...post.grants.map((grant) => grant.strike), 0)
  const ratio = Number.isFinite(smallestPreferred) ? Math.max(1, shareCount / smallestPreferred) : 1
  return Math.max(1, (preferenceOrCap + maxStrike * shareCount + 1) * (ratio + 1) * 64)
}

/** Closed-form candidates for the next locally affine settlement event. */
function candidateEvents(
  post: CapTable,
  from: number,
  coeffs: Coefficients,
  upperBound: number,
): number[] {
  const candidates = new Set<number>()
  const add = (value: number | null) => {
    if (value !== null && Number.isFinite(value) && value > from + 0.0005 && value <= upperBound)
      candidates.add(value)
  }
  const preferred = post.classes
    .filter((cls) => cls.kind === 'PREFERRED')
    .sort(
      (left, right) => left.seniorityTier - right.seniorityTier || left.id.localeCompare(right.id),
    )
  let cumulativePreference = 0
  const potentialShares =
    post.classes.reduce(
      (sum, cls) =>
        sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares),
      0,
    ) + post.grants.reduce((sum, grant) => sum + grant.options, 0)
  for (const cls of preferred) {
    const preference = preferenceClaim(cls)
    cumulativePreference += preference
    // A tier becomes eligible after all preceding preference claims fill.
    add(cumulativePreference)
    add(affineRoot(coeffs[cls.id], preference, from, upperBound))
    if (cls.participation === 'CAPPED') {
      const cap = (cls.participationCapMultiple ?? Infinity) * cls.invested
      add(affineRoot(coeffs[cls.id], cap, from, upperBound))
      const fraction = (cls.shares * cls.conversionRatio) / potentialShares
      if (fraction > 0) add(cap / fraction)
    }
    // This is the converted-share parity when the whole potential ownership set participates.
    const fraction = (cls.shares * cls.conversionRatio) / potentialShares
    if (fraction > 0) add(preference / fraction)
  }
  const pps = ppsCoefficient(post, from)
  for (const grant of post.grants) add(affineRoot(pps, grant.strike, from, upperBound))
  add(nextStateChange(post, from, upperBound))
  return [...candidates].sort((left, right) => left - right)
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
    const preference = preferenceClaim(cls)
    const eventTolerance = Math.max(1e-6, 1e-10 * preference)
    if (
      left.byClass[cls.id] < preference - eventTolerance &&
      right.byClass[cls.id] >= preference - eventTolerance
    )
      return `${cls.name} preference fills`
    if (cls.participation === 'CAPPED') {
      const cap = (cls.participationCapMultiple ?? Infinity) * cls.invested
      const eventTolerance = Math.max(1e-6, 1e-10 * cap)
      if (
        left.byClass[cls.id] < cap - eventTolerance &&
        right.byClass[cls.id] >= cap - eventTolerance
      )
        return `${cls.name} participation cap binds`
    }
  }
  for (const grant of post.grants) {
    if (left.byGrant[grant.id] === 0 && right.byGrant[grant.id] > 0)
      return `${grant.id} becomes exercisable`
  }
  return 'settlement transition'
}

function hasReachedTerminalState(post: CapTable, from: number): boolean {
  // Terminal means the locally sampled state has already settled, not merely
  // that an option would be valuable a dollar later.  A high-strike option can
  // switch on at a fixed-point threshold between those two observations.
  const sample = payoutsAt(post, from + localProbeDistance(from))
  const preferencesAreFilled =
    from >=
    post.classes
      .filter((cls) => cls.kind === 'PREFERRED')
      .reduce((sum, cls) => sum + preferenceClaim(cls), 0)
  const preferredAreTerminal = post.classes
    .filter((cls) => cls.kind === 'PREFERRED')
    .every((cls) => {
      const path = sample.pathTaken[cls.id]
      // Contract kind is not a settlement state. FULL leftover-fill is still
      // PREFERENCE; CAPPED classes still convert after the cap binds.
      if (cls.kind !== 'PREFERRED') return false
      if (cls.participation === 'NONE') return path === 'CONVERTED'
      if (cls.participation === 'FULL') {
        if (path === 'CONVERTED') return true
        if (path !== 'PARTICIPATING') return false
        // Labelled PARTICIPATING at the preference-sum leftover-fill still
        // pays only the preference. Wait until residual dollars actually move.
        return sample.byClass[cls.id] > preferenceClaim(cls) + 1e-9
      }
      return path === 'CONVERTED'
    })
  const grantsAreTerminal = post.grants.every((grant) => sample.byGrant[grant.id] > 1e-9)
  return preferencesAreFilled && preferredAreTerminal && grantsAreTerminal
}

/** Candidate-driven regime walk using the settlement as a midpoint-verified oracle. */
function computeGenericRegimes(post: CapTable): Regime[] {
  const upperBound = conservativeUpperBound(post)
  const result: Regime[] = []
  let from = 0
  let event = ''
  // Exercise fixed points can expose a brief pre-/post-threshold interval for
  // each grant; retain a deterministic guard while allowing those genuine
  // segments alongside class conversion and cap events.
  for (let count = 0; count < 256 * (post.classes.length + post.grants.length) + 16; count += 1) {
    const coeffs = coefficientsAt(post, from)
    if (hasReachedTerminalState(post, from)) {
      result.push({
        from,
        to: Infinity,
        event,
        coeffs: unboundedCoefficients(post, from, coeffs),
      })
      return result
    }
    const candidates = candidateEvents(post, from, coeffs, upperBound)
    const stateBefore = settlementState(post, from + localProbeDistance(from))
    const recovered = candidates.filter((candidate) => {
      const probe = Math.min(upperBound, candidate + verificationDistance(from, candidate))
      return (
        !sameState(stateBefore, settlementState(post, probe)) || !followsLine(post, coeffs, probe)
      )
    })
    let next = recovered.length === 0 ? null : Math.min(...recovered)
    let recoveredByLineDeviation = false
    const numerical = firstLineDeviation(post, from, coeffs, upperBound)
    // A line mismatch immediately to the right means the binary state search
    // has landed on the floating-point edge of an event.  Step over that
    // sub-mill-cent ambiguity rather than manufacturing another zero-width
    // regime on every walk iteration.
    if (numerical !== null && numerical <= from + localProbeDistance(from) * 1.1) {
      from += probeDistance(from)
      continue
    }
    if (numerical !== null && (next === null || numerical < next)) {
      const probe = Math.min(upperBound, numerical + verificationDistance(from, numerical))
      next = numerical
      // Keep the split so each piece stays affine. Only treat it as an
      // unclassified *event* when settlement state itself changes.
      recoveredByLineDeviation = !sameState(stateBefore, settlementState(post, probe))
    }
    // A midpoint value check catches a discontinuity that retains its local slope.
    if (next !== null) {
      const midpointDeviation = firstLineDeviation(post, from, coeffs, (from + next) / 2)
      if (midpointDeviation !== null && midpointDeviation < next) {
        const probe = Math.min(
          upperBound,
          midpointDeviation + verificationDistance(from, midpointDeviation),
        )
        next = midpointDeviation
        recoveredByLineDeviation = !sameState(stateBefore, settlementState(post, probe))
      }
    }
    if (next === null || next <= from + 1e-6) {
      result.push({
        from,
        to: Infinity,
        event,
        coeffs: unboundedCoefficients(post, from, coeffs),
      })
      return result
    }
    result.push({
      from,
      to: next,
      event,
      coeffs,
    })
    // State searches resolve to a mill-cent bracket.  Give the human-facing
    // classifier a modest two-sided span so an option that becomes valuable
    // immediately after the threshold is still recognizable.
    const labelProbe = verificationDistance(from, next)
    const classifiedEvent = eventLabel(post, next - labelProbe, next + labelProbe)
    event =
      recoveredByLineDeviation && classifiedEvent === 'settlement transition'
        ? 'regime change (unclassified)'
        : classifiedEvent
    from = next
  }
  throw new Error('Regime walk exceeded its deterministic backstop')
}

/**
 * Test hook for proving that the narrow two-class shortcut remains equivalent
 * to the candidate-driven settlement walk.  Runtime callers use `regimes`.
 */
export function generalRegimesForTest(post: CapTable): Regime[] {
  return computeGenericRegimes(post)
}

function computeRegimes(post: CapTable): Regime[] {
  // A priced round with one common and one preferred class is by far the
  // hottest analysis shape.  Keep its closed-form table, but only as a narrow
  // optimization whose equality with the general walk is covered by regression tests.
  const simple = simpleTwoClassRegimes(post)
  if (simple !== null) return simple
  const generic = computeGenericRegimes(post)
  if (process.env.NODE_ENV !== 'production') {
    const unclassified = generic.filter((regime) => regime.event.includes('unclassified'))
    if (unclassified.length > 2)
      throw new Error('Regime walk recovered more than two unclassified breakpoints')
  }
  return generic
}

/** Recovered piecewise-affine regime list, memoized by the immutable post-round table reference. */
export function regimes(post: CapTable): Regime[] {
  const cached = regimeCache.get(post)
  if (cached !== undefined) return cached
  const calculated = computeRegimes(post)
  regimeCache.set(post, calculated)
  return calculated
}
