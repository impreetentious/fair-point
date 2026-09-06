import { EPS_DECISION, type CapTable, type Payouts, type ShareClassPreferred } from './schema'
import { preferenceClaim } from './accruals'

type DirectSettlement = Payouts & { exercised: Set<string> }

/** Test-only control for deterministically exercising the equilibrium enumeration fallback. */
export type SettlementDevOptions = { equilibriumPassLimit?: number }

/**
 * Everything a settlement needs that depends only on the cap table: the seniority-ordered
 * preferred list, the tiers to pay in order, and the payout skeleton's keys. A single regime
 * walk settles the same immutable table thousands of times, so deriving these once per table
 * rather than once per settlement is pure bookkeeping — no computed value depends on it.
 * Keyed weakly by table identity, exactly as the regime cache is.
 */
type SettlementPlan = {
  preferred: ShareClassPreferred[]
  tiers: number[]
  classIds: string[]
  commonIds: Set<string>
  /** Position of each preferred id in `preferred`, so a conversion set has an exact integer key. */
  preferredIndex: Map<string, number>
}

const planCache = new WeakMap<CapTable, SettlementPlan>()

function settlementPlan(post: CapTable): SettlementPlan {
  const cached = planCache.get(post)
  if (cached !== undefined) return cached
  const preferred = post.classes
    .filter((cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED')
    .sort(
      (left, right) => left.seniorityTier - right.seniorityTier || left.id.localeCompare(right.id),
    )
  const plan: SettlementPlan = {
    preferred,
    tiers: [...new Set(preferred.map((cls) => cls.seniorityTier))],
    classIds: post.classes.map((cls) => cls.id),
    commonIds: new Set(post.classes.filter((cls) => cls.kind === 'COMMON').map((cls) => cls.id)),
    preferredIndex: new Map(preferred.map((cls, index) => [cls.id, index])),
  }
  planCache.set(post, plan)
  return plan
}

function preferredClasses(post: CapTable): ShareClassPreferred[] {
  return settlementPlan(post).preferred
}

function preferenceAmount(cls: ShareClassPreferred): number {
  return preferenceClaim(cls)
}

function capAmount(cls: ShareClassPreferred): number {
  return (cls.participationCapMultiple ?? Infinity) * cls.invested
}

/** Unit in the last place of a finite IEEE-754 number. */
function unitInLastPlace(value: number): number {
  if (!Number.isFinite(value) || value === 0) return Number.EPSILON
  return 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52)
}

/**
 * The recorded conservation failure is a 1-ULP residue of summing payouts at
 * the exit magnitude (2^-24 for ~1.77e8). Conversion, preference, cap and
 * refusal already ran; folding that residue into the largest class that still
 * has cap/common headroom keeps those identities and makes Σpayouts === exitValue
 * for the 7-decimal gate. Residues larger than a few ULPs are left untouched so
 * a real leak still fails. A capped class already at its participation cap is
 * never the sink (D18 / N06).
 */
function classResidualHeadroom(post: CapTable, result: Payouts, id: string): number {
  const paid = result.byClass[id]
  if (paid === undefined) return 0
  const cls = post.classes.find((entry) => entry.id === id)
  if (cls === undefined) return 0
  if (cls.kind === 'COMMON' || result.pathTaken[id] === 'CONVERTED') {
    return Number.POSITIVE_INFINITY
  }
  if (cls.kind === 'PREFERRED' && cls.participation === 'CAPPED') {
    const cap = capAmount(cls)
    if (Number.isFinite(cap)) return Math.max(0, cap - paid)
  }
  return Number.POSITIVE_INFINITY
}

function absorbRoundingResidual(
  result: Payouts,
  exitValue: number,
  total: number,
  post: CapTable,
): void {
  const residual = exitValue - total
  if (residual === 0) return
  const bound = 8 * Math.max(unitInLastPlace(exitValue), unitInLastPlace(total), Number.EPSILON)
  if (Math.abs(residual) > bound) return
  const classIds = Object.keys(result.byClass)
  const eligible = classIds.filter((id) => {
    if (residual <= 0) return true
    return classResidualHeadroom(post, result, id) >= residual
  })
  if (eligible.length > 0) {
    let target = eligible[0]!
    for (const id of eligible) {
      if (Math.abs(result.byClass[id]!) > Math.abs(result.byClass[target]!)) target = id
    }
    result.byClass[target]! += residual
    return
  }
  const grantIds = Object.keys(result.byGrant)
  if (grantIds.length === 0) return
  let target = grantIds[0]!
  for (const id of grantIds) {
    if (Math.abs(result.byGrant[id]!) > Math.abs(result.byGrant[target]!)) target = id
  }
  result.byGrant[target]! += residual
}

function makeEmptyPayouts(post: CapTable): Payouts {
  const plan = settlementPlan(post)
  const byClass: Record<string, number> = {}
  const pathTaken: Payouts['pathTaken'] = {}
  for (const id of plan.classIds) {
    byClass[id] = 0
    pathTaken[id] = plan.commonIds.has(id) ? 'COMMON' : 'PREFERENCE'
  }
  const byGrant: Record<string, number> = {}
  for (const grant of post.grants) byGrant[grant.id] = 0
  return {
    byClass,
    byGrant,
    perCommonShareProceeds: 0,
    strikeCashPaid: 0,
    pathTaken,
    warnings: [],
  }
}

function settleDirect(
  post: CapTable,
  distributable: number,
  exercised: Set<string>,
  converted: Set<string>,
): DirectSettlement {
  const result: DirectSettlement = { ...makeEmptyPayouts(post), exercised }
  const plan = settlementPlan(post)
  const preferred = plan.preferred
  let remaining = distributable

  for (const tier of plan.tiers) {
    const claimants = preferred.filter(
      (cls) => cls.seniorityTier === tier && !converted.has(cls.id),
    )
    const totalClaim = claimants.reduce((sum, cls) => sum + preferenceAmount(cls), 0)
    if (totalClaim === 0 || remaining <= 0) continue
    const paid = Math.min(remaining, totalClaim)
    for (const cls of claimants) {
      const amount = (paid * preferenceAmount(cls)) / totalClaim
      result.byClass[cls.id] += amount
    }
    remaining -= paid
  }

  type Member = {
    id: string
    shares: number
    kind: 'class' | 'grant'
    capped?: ShareClassPreferred
  }
  const members: Member[] = []
  for (const cls of post.classes) {
    if (cls.kind === 'COMMON') {
      members.push({ id: cls.id, shares: cls.shares, kind: 'class' })
      continue
    }
    if (converted.has(cls.id)) {
      members.push({ id: cls.id, shares: cls.shares * cls.conversionRatio, kind: 'class' })
      result.pathTaken[cls.id] = 'CONVERTED'
      continue
    }
    if (cls.participation === 'FULL' || cls.participation === 'CAPPED') {
      members.push({
        id: cls.id,
        shares: cls.shares * cls.conversionRatio,
        kind: 'class',
        capped: cls.participation === 'CAPPED' ? cls : undefined,
      })
      result.pathTaken[cls.id] = cls.participation === 'CAPPED' ? 'CAPPED' : 'PARTICIPATING'
    }
  }
  for (const grant of post.grants) {
    if (exercised.has(grant.id))
      members.push({ id: grant.id, shares: grant.options, kind: 'grant' })
  }

  let active = members
  while (remaining > EPS_DECISION && active.length > 0) {
    const totalShares = active.reduce((sum, member) => sum + member.shares, 0)
    if (totalShares <= 0) break
    const allocations = active.map((member) => ({
      member,
      amount: (remaining * member.shares) / totalShares,
    }))
    const newlyCapped = allocations.filter(({ member, amount }) => {
      if (member.capped === undefined) return false
      const current = result.byClass[member.id]
      return current + amount > capAmount(member.capped) + EPS_DECISION
    })
    if (newlyCapped.length === 0) {
      for (const { member, amount } of allocations) {
        if (member.kind === 'class') result.byClass[member.id] += amount
      }
      remaining = 0
      break
    }
    let paidToCaps = 0
    for (const { member } of newlyCapped) {
      const cap = capAmount(member.capped!)
      const headroom = Math.max(0, cap - result.byClass[member.id])
      result.byClass[member.id] += headroom
      paidToCaps += headroom
      result.pathTaken[member.id] = 'CAPPED'
    }
    remaining = Math.max(0, remaining - paidToCaps)
    const cappedIds = new Set(newlyCapped.map(({ member }) => member.id))
    active = active.filter((member) => !cappedIds.has(member.id))
  }

  const common = post.classes.find((cls) => cls.kind === 'COMMON')
  if (common !== undefined)
    result.perCommonShareProceeds = result.byClass[common.id] / common.shares
  for (const grant of post.grants) {
    if (!exercised.has(grant.id)) continue
    result.byGrant[grant.id] =
      Math.max(0, result.perCommonShareProceeds - grant.strike) * grant.options
  }
  result.strikeCashPaid = [...exercised].reduce(
    (sum, id) =>
      sum +
      (post.grants.find((grant) => grant.id === id)?.options ?? 0) *
        (post.grants.find((grant) => grant.id === id)?.strike ?? 0),
    0,
  )
  return result
}

/**
 * `settleDirect` is a pure function of the conversion set once `post`, `distributable`, and
 * `exercised` are fixed — which they are for the whole of one `directWithEquilibrium` call. The
 * Gauss–Seidel passes and the enumeration fallback revisit the same sets many times over, so a
 * per-call memo removes repeated work without changing a single computed value. Only settlements
 * that stay inside the solver are served from it; every result that escapes is built fresh,
 * because callers push warnings onto the object they receive.
 */
type Settle = (converted: Set<string>) => DirectSettlement

/** Beyond this many preferred classes a bitmask key stops being an exact integer. */
const MAX_MEMOIZED_CLASSES = 30

function memoizedSettle(post: CapTable, distributable: number, exercised: Set<string>): Settle {
  const { preferredIndex } = settlementPlan(post)
  const cache = new Map<number, DirectSettlement>()
  const memoizable = preferredIndex.size <= MAX_MEMOIZED_CLASSES
  return (converted) => {
    // A conversion set is always a subset of the preferred classes, so its members map onto
    // fixed bit positions: an exact key with no string delimiter an id could itself contain,
    // and no serialization cost in the hottest loop the engine has. Anything that would make
    // the key inexact — too many classes, or an id outside the plan — skips the cache and
    // settles directly, so a wrong key can never return a wrong settlement.
    if (!memoizable) return settleDirect(post, distributable, exercised, converted)
    let key = 0
    for (const id of converted) {
      const bit = preferredIndex.get(id)
      if (bit === undefined) return settleDirect(post, distributable, exercised, converted)
      key += 2 ** bit
    }
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const settled = settleDirect(post, distributable, exercised, converted)
    cache.set(key, settled)
    return settled
  }
}

function compareAction(settle: Settle, converted: Set<string>, cls: ShareClassPreferred): boolean {
  const without = new Set(converted)
  without.delete(cls.id)
  const withConversion = new Set(converted)
  withConversion.add(cls.id)
  const preferencePath = settle(without).byClass[cls.id]
  const convertedPath = settle(withConversion).byClass[cls.id]
  return convertedPath > preferencePath + EPS_DECISION
}

function directWithEquilibrium(
  post: CapTable,
  distributable: number,
  exercised: Set<string>,
  passLimit: number,
): DirectSettlement {
  const settle = memoizedSettle(post, distributable, exercised)
  const preferred = preferredClasses(post)
  const converted = new Set<string>()
  const changedSnapshots: Set<string>[] = []
  for (let pass = 0; pass < passLimit; pass += 1) {
    let changed = false
    const changedThisPass = new Set<string>()
    for (const cls of preferred) {
      const wantConversion = compareAction(settle, converted, cls)
      if (wantConversion !== converted.has(cls.id)) {
        if (wantConversion) converted.add(cls.id)
        else converted.delete(cls.id)
        changed = true
        changedThisPass.add(cls.id)
      }
    }
    changedSnapshots.push(changedThisPass)
    if (changedSnapshots.length > 2) changedSnapshots.shift()
    if (!changed) return settleDirect(post, distributable, exercised, converted)
  }

  const oscillating = new Set<string>(changedSnapshots.flatMap((snapshot) => [...snapshot]))
  if (oscillating.size > 8)
    throw new Error('NonConvergence: conversion oscillating set exceeds 8 classes')
  const allIds = preferred.map((cls) => cls.id)
  const frozen = new Set(allIds.filter((id) => !oscillating.has(id) && converted.has(id)))
  const candidates: Set<string>[] = []
  const ids = [...oscillating].sort()
  for (let mask = 0; mask < 2 ** ids.length; mask += 1) {
    candidates.push(new Set(ids.filter((_, index) => (mask & (2 ** index)) !== 0)))
  }
  const assignment = (candidate: Set<string>) => new Set([...frozen, ...candidate])
  const isConsistent = (candidate: Set<string>) => {
    const chosen = assignment(candidate)
    return ids.every((id) => {
      const cls = preferred.find((entry) => entry.id === id)!
      return compareAction(settle, chosen, cls) === chosen.has(id)
    })
  }
  const lexicographic = (candidate: Set<string>) => [...candidate].sort().join('|')
  const consistent = candidates
    .filter(isConsistent)
    .sort(
      (left, right) =>
        left.size - right.size || lexicographic(left).localeCompare(lexicographic(right)),
    )
  if (consistent.length > 0) {
    const result = settleDirect(post, distributable, exercised, assignment(consistent[0]))
    if (passLimit < 64)
      result.warnings.push('conversion equilibrium: dev pass cap forced enumeration fallback')
    return result
  }

  const regret = (candidate: Set<string>) => {
    const chosen = assignment(candidate)
    return ids.reduce((sum, id) => {
      const cls = preferred.find((entry) => entry.id === id)!
      const prefersConversion = compareAction(settle, chosen, cls)
      const assignedConversion = chosen.has(id)
      if (prefersConversion === assignedConversion) return sum
      const current = settle(chosen).byClass[id]
      const alternative = new Set(chosen)
      if (assignedConversion) alternative.delete(id)
      else alternative.add(id)
      return sum + Math.max(0, settle(alternative).byClass[id] - current)
    }, 0)
  }
  const selected = candidates.sort(
    (left, right) =>
      regret(left) - regret(right) ||
      left.size - right.size ||
      lexicographic(left).localeCompare(lexicographic(right)),
  )[0]
  const result = settleDirect(post, distributable, exercised, assignment(selected))
  result.warnings.push('conversion equilibrium: no consistent subset — used min-regret fallback')
  return result
}

function distribute(
  post: CapTable,
  exitValue: number,
  exercised: Set<string>,
  passLimit: number,
): DirectSettlement {
  const strikeCash = post.grants
    .filter((grant) => exercised.has(grant.id))
    .reduce((sum, grant) => sum + grant.options * grant.strike, 0)
  return directWithEquilibrium(post, exitValue + strikeCash, exercised, passLimit)
}

function isConsistentOptionPrefix(
  post: CapTable,
  result: DirectSettlement,
  exercised: Set<string>,
): boolean {
  return post.grants.every((grant) =>
    exercised.has(grant.id)
      ? grant.strike < result.perCommonShareProceeds - EPS_DECISION
      : grant.strike >= result.perCommonShareProceeds - EPS_DECISION,
  )
}

function effectivePassLimit(options: SettlementDevOptions | undefined): number {
  if (options?.equilibriumPassLimit === undefined || process.env.NODE_ENV === 'production')
    return 64
  if (
    !Number.isInteger(options.equilibriumPassLimit) ||
    options.equilibriumPassLimit < 1 ||
    options.equilibriumPassLimit >= 64
  )
    throw new RangeError('equilibriumPassLimit must be an integer from 1 through 63')
  return options.equilibriumPassLimit
}

/** Deterministic exit settlement with prefix-based option exercise and conversion equilibrium. */
export function payoutsAt(
  post: CapTable,
  exitValue: number,
  options?: SettlementDevOptions,
): Payouts {
  if (!(exitValue >= 0) || !Number.isFinite(exitValue))
    throw new RangeError('exitValue must be finite and nonnegative')
  const passLimit = effectivePassLimit(options)
  const groups = new Map<number, string[]>()
  for (const grant of [...post.grants].sort(
    (left, right) => left.strike - right.strike || left.id.localeCompare(right.id),
  )) {
    groups.set(grant.strike, [...(groups.get(grant.strike) ?? []), grant.id])
  }
  const orderedGroups = [...groups.entries()]
  let exercised = new Set<string>()
  // `distribute` is deterministic in its arguments, so the settlement for the last accepted
  // prefix is the settlement the final commit would recompute. Carry it forward instead: on a
  // table whose grants are in the money this halves the equilibrium solves per settlement.
  let accepted: DirectSettlement | null = null
  for (const [strike, ids] of orderedGroups) {
    const trial = new Set([...exercised, ...ids])
    const trialResult = distribute(post, exitValue, trial, passLimit)
    if (strike < trialResult.perCommonShareProceeds - EPS_DECISION) {
      exercised = trial
      accepted = trialResult
    } else break
  }
  let result = accepted ?? distribute(post, exitValue, exercised, passLimit)
  if (!isConsistentOptionPrefix(post, result, exercised)) {
    for (let count = orderedGroups.length; count >= 0; count -= 1) {
      const candidate = new Set(orderedGroups.slice(0, count).flatMap(([, ids]) => ids))
      const candidateResult = distribute(post, exitValue, candidate, passLimit)
      if (isConsistentOptionPrefix(post, candidateResult, candidate)) {
        result = candidateResult
        break
      }
    }
  }
  const total =
    Object.values(result.byClass).reduce((sum, value) => sum + value, 0) +
    Object.values(result.byGrant).reduce((sum, value) => sum + value, 0)
  const tolerance = Math.max(0.01, 1e-8 * Math.abs(exitValue))
  if (Math.abs(total - exitValue) > tolerance) {
    throw new Error(`Waterfall conservation failed: expected ${exitValue}, received ${total}`)
  }
  absorbRoundingResidual(result, exitValue, total, post)
  return result
}
