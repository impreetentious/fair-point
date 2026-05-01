import type { Safe, SafeConversion, ShareClass } from './schema'

export type SafeRoute = 'CAP' | 'DISCOUNT' | 'ROUND_PRICE'

export type SafeSolve = {
  pps: number
  poolIncrease: number
  sharesBySafe: Record<string, number>
  routeBySafe: Record<string, SafeRoute>
  totalSafeShares: number
  warnings: string[]
  iterations: number
}

type SafeSolveConfig = {
  baseCap: number
  safes: Safe[]
  investment: number
  preMoney?: number
  pricedPerShare?: number
  poolTargetPost: number
  poolAvailable: number
}

function initialRoute(safe: Safe): SafeRoute {
  if (safe.valuationCap !== undefined) return 'CAP'
  if (safe.discount !== undefined) return 'DISCOUNT'
  return 'ROUND_PRICE'
}

function poolIncrease(baseCap: number, totalSafeShares: number, config: SafeSolveConfig): number {
  if (config.preMoney === undefined) return 0
  const r = (config.preMoney + config.investment) / config.preMoney
  const denominator = 1 - config.poolTargetPost * r
  if (denominator < 0.05 - 1e-12) throw new Error('V3: pool target is infeasible')
  return Math.max(
    0,
    (config.poolTargetPost * r * (baseCap + totalSafeShares) - config.poolAvailable) / denominator,
  )
}

function solveFixedRoutes(
  config: SafeSolveConfig,
  routes: Record<string, SafeRoute>,
): Omit<SafeSolve, 'iterations'> {
  const directPps = config.pricedPerShare
  let pps = directPps ?? config.preMoney! / config.baseCap
  let pool = 0
  let sharesBySafe: Record<string, number>
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const preMoney = config.safes.filter((safe) => safe.kind === 'PRE_MONEY')
    const postMoney = config.safes.filter((safe) => safe.kind === 'POST_MONEY')
    const provisional: Record<string, number> = {}
    for (const safe of preMoney) {
      const capPrice =
        safe.valuationCap === undefined ? Infinity : safe.valuationCap / (config.baseCap + pool)
      const discountPrice = safe.discount === undefined ? Infinity : (1 - safe.discount) * pps
      provisional[safe.id] = safe.amount / Math.min(capPrice, discountPrice)
    }
    const capSafes = postMoney.filter(
      (safe) => routes[safe.id] === 'CAP' && safe.valuationCap !== undefined,
    )
    const nonCapSafes = postMoney.filter(
      (safe) => !capSafes.some((capSafe) => capSafe.id === safe.id),
    )
    for (const safe of nonCapSafes) {
      provisional[safe.id] =
        routes[safe.id] === 'DISCOUNT' && safe.discount !== undefined
          ? safe.amount / ((1 - safe.discount) * pps)
          : safe.amount / pps
    }
    const totalOther = Object.values(provisional).reduce((sum, shares) => sum + shares, 0)
    const capFraction = capSafes.reduce((sum, safe) => sum + safe.amount / safe.valuationCap!, 0)
    if (capFraction > 0.95 + 1e-12)
      throw new Error('V2: SAFE caps too low — conversion exceeds 95% of the company.')
    for (const safe of capSafes)
      provisional[safe.id] =
        ((safe.amount / safe.valuationCap!) * (config.baseCap + totalOther)) / (1 - capFraction)
    const total = Object.values(provisional).reduce((sum, shares) => sum + shares, 0)
    const nextPool = poolIncrease(config.baseCap, total, config)
    const nextPps = directPps ?? config.preMoney! / (config.baseCap + total + nextPool)
    const stable =
      Math.abs(nextPps - pps) <= 1e-10 * Math.max(1, Math.abs(pps)) &&
      Math.abs(nextPool - pool) <= 1e-8
    pps = nextPps
    pool = nextPool
    sharesBySafe = provisional
    if (stable) {
      return {
        pps,
        poolIncrease: pool,
        sharesBySafe,
        routeBySafe: routes,
        totalSafeShares: total,
        warnings:
          pool === 0 &&
          config.preMoney !== undefined &&
          config.poolTargetPost > 0 &&
          config.poolAvailable > 0
            ? ['existing pool already exceeds target']
            : [],
      }
    }
  }
  throw new Error('NonConvergence: SAFE, pool, and PPS solve did not converge')
}

function maxRoute(
  config: SafeSolveConfig,
  routes: Record<string, SafeRoute>,
  safe: Safe,
): SafeRoute {
  // Pre-money SAFEs (and notes projected as such) use cap-vs-discount only — §6.2.0 / §6.2.1.
  if (safe.kind === 'PRE_MONEY') {
    if (safe.valuationCap !== undefined && safe.discount !== undefined) {
      const solved = solveFixedRoutes(config, routes)
      const pool = solved.poolIncrease
      const capPrice = safe.valuationCap / (config.baseCap + pool)
      const discountPrice = (1 - safe.discount) * solved.pps
      return capPrice <= discountPrice ? 'CAP' : 'DISCOUNT'
    }
    if (safe.valuationCap !== undefined) return 'CAP'
    if (safe.discount !== undefined) return 'DISCOUNT'
    return 'ROUND_PRICE'
  }
  const candidates: SafeRoute[] = []
  if (safe.valuationCap !== undefined) candidates.push('CAP')
  if (safe.discount !== undefined) candidates.push('DISCOUNT')
  candidates.push('ROUND_PRICE')
  const evaluated = candidates.map((route) => {
    const nextRoutes = { ...routes, [safe.id]: route }
    const solved = solveFixedRoutes(config, nextRoutes)
    return { route, shares: solved.sharesBySafe[safe.id] }
  })
  const maxShares = Math.max(...evaluated.map((candidate) => candidate.shares))
  const current = evaluated.find((candidate) => candidate.route === routes[safe.id])
  if (
    current !== undefined &&
    Math.abs(current.shares - maxShares) <= 1e-8 * Math.max(1, maxShares)
  )
    return current.route
  return evaluated.find(
    (candidate) => Math.abs(candidate.shares - maxShares) <= 1e-8 * Math.max(1, maxShares),
  )!.route
}

/** Joint SAFE route + pool + PPS solve used by round construction. */
export function solveSafes(config: SafeSolveConfig): SafeSolve {
  const routes = Object.fromEntries(
    config.safes.map((safe) => [safe.id, initialRoute(safe)]),
  ) as Record<string, SafeRoute>
  // §6.2.3: each post-money SAFE can switch at most once toward a route with more
  // shares, so a stable route assignment must be found within #SAFEs + 1 passes.
  for (let iteration = 1; iteration <= config.safes.length + 1; iteration += 1) {
    const solved = solveFixedRoutes(config, routes)
    const updated = Object.fromEntries(
      config.safes.map((safe) => [safe.id, maxRoute(config, routes, safe)]),
    ) as Record<string, SafeRoute>
    if (config.safes.every((safe) => updated[safe.id] === routes[safe.id]))
      return { ...solved, iterations: iteration }
    for (const safe of config.safes) routes[safe.id] = updated[safe.id]
  }
  throw new Error('NonConvergence: SAFE route selection did not stabilize')
}

function basicSafeClass(safe: Safe, shares: number): ShareClass {
  return {
    id: `safe-${safe.id}`,
    name: `SAFE: ${safe.name}`,
    kind: 'PREFERRED',
    shares,
    holder: safe.holder,
    invested: safe.amount,
    originalIssuePrice: safe.amount / shares,
    prefMultiple: 1,
    participation: 'NONE',
    seniorityTier: 1,
    conversionRatio: 1,
    antiDilution: 'NONE',
    dividendRate: 0,
    dividendKind: 'NONE',
    payToPlay: 'NONE',
    accruedDividends: 0,
    redemptionClaim: 0,
  }
}

/**
 * Fixed-price public SAFE converter. Full round construction uses solveSafes so that P, PPS, and
 * route selection are coupled; this public function is intentionally useful for standalone checks.
 */
export function convertSafes(baseCap: number, safes: Safe[], roundPps: number): SafeConversion {
  const solved = solveSafes({
    baseCap,
    safes,
    investment: 0,
    pricedPerShare: roundPps,
    poolTargetPost: 0,
    poolAvailable: 0,
  })
  return {
    newClasses: safes.map((safe) => basicSafeClass(safe, solved.sharesBySafe[safe.id])),
    totalSafeShares: solved.totalSafeShares,
    sharesBySafe: solved.sharesBySafe,
    routeBySafe: solved.routeBySafe,
    warnings: solved.warnings,
  }
}
