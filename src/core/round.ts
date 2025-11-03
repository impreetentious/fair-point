import { adjustedConversionRatio, conversionPrice } from './antidilution'
import { applyMfn } from './mfn'
import { noteAsPreMoneySafe } from './notes'
import { solveSafes, type SafeRoute } from './safes'
import type {
  CapTable,
  ConvertibleNote,
  RoundResult,
  RoundTerms,
  Safe,
  ShareClass,
  ShareClassCommon,
  ShareClassPreferred,
} from './schema'

function asConvertedShares(table: CapTable): number {
  return (
    table.classes.reduce(
      (sum, cls) =>
        sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares),
      0,
    ) +
    table.grants.reduce((sum, grant) => sum + grant.options, 0) +
    table.poolAvailable +
    table.promisedOptions
  )
}

function participationFields(
  terms: RoundTerms,
): Pick<ShareClassPreferred, 'participation' | 'participationCapMultiple'> {
  if (terms.participation === 'FULL')
    return { participation: 'FULL', participationCapMultiple: undefined }
  if (terms.participation === 'CAP2')
    return { participation: 'CAPPED', participationCapMultiple: 2 }
  if (terms.participation === 'CAP3')
    return { participation: 'CAPPED', participationCapMultiple: 3 }
  return { participation: 'NONE', participationCapMultiple: undefined }
}

function preRoundBroadBase(pre: CapTable, totalSafeShares: number): number {
  return (
    pre.classes.reduce(
      (sum, cls) =>
        sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares),
      0,
    ) +
    pre.grants.reduce((sum, grant) => sum + grant.options, 0) +
    totalSafeShares
  )
}

function cloneClasses(classes: ShareClass[]): ShareClass[] {
  return classes.map((cls) => ({ ...cls }))
}

/**
 * Pay-to-play (§6.12): preferred with payToPlay=TO_COMMON that are not listed in
 * terms.payToPlayParticipants convert into common (same share count × conversionRatio)
 * before the priced round is constructed.
 */
function applyPayToPlay(classes: ShareClass[], terms: RoundTerms): ShareClass[] {
  const participants = new Set(terms.payToPlayParticipants ?? [])
  const result: ShareClass[] = []
  for (const cls of classes) {
    if (cls.kind !== 'PREFERRED' || cls.payToPlay !== 'TO_COMMON' || participants.has(cls.id)) {
      result.push(cls)
      continue
    }
    const converted: ShareClassCommon = {
      id: `${cls.id}-converted`,
      name: `${cls.name} (pay-to-play common)`,
      kind: 'COMMON',
      shares: cls.shares * cls.conversionRatio,
      holder: cls.holder,
    }
    result.push(converted)
  }
  return result
}

function safeShadowClass(
  safe: Safe,
  shares: number,
  terms: RoundTerms,
  tier: number,
): ShareClassPreferred {
  return {
    id: `safe-${safe.id}`,
    name: `SAFE: ${safe.name}`,
    kind: 'PREFERRED',
    shares,
    holder: safe.holder,
    invested: safe.amount,
    originalIssuePrice: safe.amount / shares,
    prefMultiple: terms.prefMultiple,
    ...participationFields(terms),
    seniorityTier: tier,
    conversionRatio: 1,
    antiDilution: 'NONE',
    dividendRate: 0,
    dividendKind: 'NONE',
    payToPlay: 'NONE',
    accruedDividends: 0,
    redemptionClaim: 0,
  }
}

function buildPost(
  current: ShareClass[],
  pre: CapTable,
  safes: Safe[],
  terms: RoundTerms,
  pps: number,
  poolIncrease: number,
  sharesBySafe: Record<string, number>,
  routeBySafe: Record<string, SafeRoute>,
): { post: CapTable; investorShares: number } {
  const preferred = current.filter((cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED')
  const tier =
    terms.seniority === 'SENIOR' ? 1 : Math.max(1, ...preferred.map((cls) => cls.seniorityTier), 1)
  const existing = current.map((cls) =>
    cls.kind === 'PREFERRED' && terms.seniority === 'SENIOR'
      ? { ...cls, seniorityTier: cls.seniorityTier + 1 }
      : cls,
  )
  const shadowClasses = safes
    .filter((safe) => routeBySafe[safe.id] !== 'ROUND_PRICE')
    .map((safe) => safeShadowClass(safe, sharesBySafe[safe.id], terms, tier))
  const roundPriceSafes = safes.filter((safe) => routeBySafe[safe.id] === 'ROUND_PRICE')
  const roundPriceAmount = roundPriceSafes.reduce((sum, safe) => sum + safe.amount, 0)
  const roundPriceShares = roundPriceSafes.reduce((sum, safe) => sum + sharesBySafe[safe.id], 0)
  const investorShares = terms.investment / pps
  const newRound: ShareClassPreferred = {
    id: 'new-round',
    name: 'New Round',
    kind: 'PREFERRED',
    shares: investorShares + roundPriceShares,
    holder: 'INVESTOR',
    invested: terms.investment + roundPriceAmount,
    originalIssuePrice: pps,
    prefMultiple: terms.prefMultiple,
    ...participationFields(terms),
    seniorityTier: tier,
    conversionRatio: 1,
    antiDilution: 'NONE',
    dividendRate: 0,
    dividendKind: 'NONE',
    payToPlay: 'NONE',
    accruedDividends: 0,
    redemptionClaim: 0,
  }
  return {
    post: {
      classes: [...existing, ...shadowClasses, newRound],
      grants: pre.grants.map((grant) => ({ ...grant })),
      poolAvailable: pre.poolAvailable + poolIncrease,
      promisedOptions: pre.promisedOptions,
    },
    investorShares,
  }
}

/** Construct a priced round with coupled SAFE/note, pool, PPS, and anti-dilution solving. */
export function constructRound(
  pre: CapTable,
  safes: Safe[],
  terms: RoundTerms,
  notes: ConvertibleNote[] = [],
): RoundResult {
  const noteSafes = notes.map(noteAsPreMoneySafe)
  const converting = applyMfn([...safes, ...noteSafes])
  let current = applyPayToPlay(cloneClasses(pre.classes), terms)
  const frozenConversionPrices = new Map(
    current
      .filter((cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED')
      .map((cls) => [cls.id, conversionPrice(cls)]),
  )
  const maxIterations = terms.pricedPerShare === undefined ? 50 : 1
  let lastPps = terms.pricedPerShare ?? 0
  let lastSolve: ReturnType<typeof solveSafes> | undefined

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const working: CapTable = { ...pre, classes: current }
    const baseCap = asConvertedShares(working)
    const solve = solveSafes({
      baseCap,
      safes: converting,
      investment: terms.investment,
      preMoney: terms.preMoney,
      pricedPerShare: terms.pricedPerShare,
      poolTargetPost: terms.poolTargetPost,
      poolAvailable: pre.poolAvailable,
    })
    lastSolve = solve
    lastPps = solve.pps
    let changed = false
    const broadBase = preRoundBroadBase({ ...pre, classes: current }, solve.totalSafeShares)
    const next = current.map((cls) => {
      if (cls.kind !== 'PREFERRED' || cls.antiDilution === 'NONE') return cls
      const frozen = frozenConversionPrices.get(cls.id)!
      const ratio = adjustedConversionRatio(cls, solve.pps, terms.investment, broadBase, frozen)
      if (
        Math.abs(ratio - cls.conversionRatio) <=
        1e-9 * Math.max(1, Math.abs(cls.conversionRatio))
      )
        return cls
      changed = true
      return { ...cls, conversionRatio: ratio }
    })
    if (!changed || terms.pricedPerShare !== undefined) {
      const settledClasses = terms.pricedPerShare !== undefined && changed ? next : current
      const { post, investorShares } = buildPost(
        settledClasses,
        pre,
        converting,
        terms,
        solve.pps,
        solve.poolIncrease,
        solve.sharesBySafe,
        solve.routeBySafe,
      )
      const fdPost = asConvertedShares(post)
      return {
        post,
        diagnostics: {
          pps: solve.pps,
          investorPct: investorShares / fdPost,
          poolIncrease: solve.poolIncrease,
          safeShares: solve.totalSafeShares,
          routeBySafe: solve.routeBySafe,
          sharesBySafe: solve.sharesBySafe,
        },
        warnings: solve.warnings,
      }
    }
    current = next
  }
  if (lastSolve === undefined) throw new Error('NonConvergence: no round solution produced')
  throw new Error(`NonConvergence: anti-dilution PPS did not converge from ${lastPps}`)
}
