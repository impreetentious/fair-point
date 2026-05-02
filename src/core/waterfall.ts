import { EPS_DECISION, type CapTable, type Payouts, type ShareClassPreferred } from './schema'
import { preferenceClaim } from './accruals'

type DirectSettlement = Payouts & { exercised: Set<string> }

/** Test-only control for deterministically exercising the equilibrium enumeration fallback. */
export type SettlementDevOptions = { equilibriumPassLimit?: number }

function preferredClasses(post: CapTable): ShareClassPreferred[] {
  return post.classes
    .filter((cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED')
    .sort(
      (left, right) => left.seniorityTier - right.seniorityTier || left.id.localeCompare(right.id),
    )
}

function preferenceAmount(cls: ShareClassPreferred): number {
  return preferenceClaim(cls)
}

function capAmount(cls: ShareClassPreferred): number {
  return (cls.participationCapMultiple ?? Infinity) * cls.invested
}

function makeEmptyPayouts(post: CapTable): Payouts {
  return {
    byClass: Object.fromEntries(post.classes.map((cls) => [cls.id, 0])),
    byGrant: Object.fromEntries(post.grants.map((grant) => [grant.id, 0])),
    perCommonShareProceeds: 0,
    strikeCashPaid: 0,
    pathTaken: Object.fromEntries(
      post.classes.map((cls) => [cls.id, cls.kind === 'COMMON' ? 'COMMON' : 'PREFERENCE']),
    ) as Payouts['pathTaken'],
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
  const preferred = preferredClasses(post)
  let remaining = distributable
  const preferenceReceived = new Map<string, number>()

  for (const tier of [...new Set(preferred.map((cls) => cls.seniorityTier))]) {
    const claimants = preferred.filter(
      (cls) => cls.seniorityTier === tier && !converted.has(cls.id),
    )
    const totalClaim = claimants.reduce((sum, cls) => sum + preferenceAmount(cls), 0)
    if (totalClaim === 0 || remaining <= 0) continue
    const paid = Math.min(remaining, totalClaim)
    for (const cls of claimants) {
      const amount = (paid * preferenceAmount(cls)) / totalClaim
      result.byClass[cls.id] += amount
      preferenceReceived.set(cls.id, amount)
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

function compareAction(
  post: CapTable,
  distributable: number,
  exercised: Set<string>,
  converted: Set<string>,
  cls: ShareClassPreferred,
): boolean {
  const without = new Set(converted)
  without.delete(cls.id)
  const withConversion = new Set(converted)
  withConversion.add(cls.id)
  const preferencePath = settleDirect(post, distributable, exercised, without).byClass[cls.id]
  const convertedPath = settleDirect(post, distributable, exercised, withConversion).byClass[cls.id]
  return convertedPath > preferencePath + EPS_DECISION
}

function directWithEquilibrium(
  post: CapTable,
  distributable: number,
  exercised: Set<string>,
  passLimit: number,
): DirectSettlement {
  const preferred = preferredClasses(post)
  const converted = new Set<string>()
  const changedSnapshots: Set<string>[] = []
  for (let pass = 0; pass < passLimit; pass += 1) {
    let changed = false
    const changedThisPass = new Set<string>()
    for (const cls of preferred) {
      const wantConversion = compareAction(post, distributable, exercised, converted, cls)
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
      return compareAction(post, distributable, exercised, chosen, cls) === chosen.has(id)
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
      const prefersConversion = compareAction(post, distributable, exercised, chosen, cls)
      const assignedConversion = chosen.has(id)
      if (prefersConversion === assignedConversion) return sum
      const current = settleDirect(post, distributable, exercised, chosen).byClass[id]
      const alternative = new Set(chosen)
      if (assignedConversion) alternative.delete(id)
      else alternative.add(id)
      return (
        sum +
        Math.max(0, settleDirect(post, distributable, exercised, alternative).byClass[id] - current)
      )
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

/** Exact deterministic exit settlement with prefix-based option exercise and conversion equilibrium. */

/** Unit in the last place of a finite IEEE-754 number. */
function unitInLastPlace(value: number): number {
  if (!Number.isFinite(value) || value === 0) return Number.EPSILON
  return 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52)
}

/**
 * Fold a few-ULP conservation residue into the largest class after settlement.
 * Conversion, preference, cap and refusal already ran.
 */
function classResidualHeadroom(
  post: {
    classes: Array<{
      id: string
      kind: string
      participation?: string
      invested?: number
      participationCapMultiple?: number
    }>
  },
  result: { byClass: Record<string, number>; pathTaken?: Record<string, string> },
  id: string,
): number {
  const paid = result.byClass[id]
  if (paid === undefined) return 0
  const cls = post.classes.find((entry) => entry.id === id)
  if (cls === undefined) return 0
  if (cls.kind === 'COMMON' || result.pathTaken?.[id] === 'CONVERTED') {
    return Number.POSITIVE_INFINITY
  }
  if (
    cls.kind === 'PREFERRED' &&
    cls.participation === 'CAPPED' &&
    typeof cls.participationCapMultiple === 'number' &&
    typeof cls.invested === 'number'
  ) {
    const cap = cls.participationCapMultiple * cls.invested
    if (Number.isFinite(cap)) return Math.max(0, cap - paid)
  }
  return Number.POSITIVE_INFINITY
}

function absorbRoundingResidual(
  result: {
    byClass: Record<string, number>
    byGrant: Record<string, number>
    pathTaken?: Record<string, string>
  },
  exitValue: number,
  total: number,
  post: {
    classes: Array<{
      id: string
      kind: string
      participation?: string
      invested?: number
      participationCapMultiple?: number
    }>
  },
): void {
  const residual = exitValue - total
  if (residual === 0) return
  const bound = 8 * Math.max(unitInLastPlace(exitValue), unitInLastPlace(total), Number.EPSILON)
  if (Math.abs(residual) > bound) return
  const classIds = Object.keys(result.byClass)
  const eligible = classIds.filter(
    (id) => residual <= 0 || classResidualHeadroom(post, result, id) >= residual,
  )
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
  for (const [strike, ids] of orderedGroups) {
    const trial = new Set([...exercised, ...ids])
    const trialResult = distribute(post, exitValue, trial, passLimit)
    if (strike < trialResult.perCommonShareProceeds - EPS_DECISION) exercised = trial
    else break
  }
  let result = distribute(post, exitValue, exercised, passLimit)
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
