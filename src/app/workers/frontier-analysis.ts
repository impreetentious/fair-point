import {
  analyze,
  enumerateDealsWithReasons,
  evaluatePackage,
  valueOnTable,
} from '../../core/bargain'
import { constructRound } from '../../core/round'
import { accrueForExit } from '../../core/accruals'
import { presentValue } from '../../core/discounting'
import { crraUtility } from '../../core/mc'
import type { DealFile, DealPoint } from '../../core/schema'
export const MC_N = 100_000
export const MC_SEED = 0xc0ffee
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}
export function frontierIdentity(deal: DealFile): string {
  const {
    pre,
    safes,
    notes,
    terms,
    founderBeliefs,
    investorBeliefs,
    disagreement,
    space,
    risk,
    discounting,
    yearsToExit,
  } = deal
  return JSON.stringify(
    canonical({
      pre,
      safes,
      notes,
      terms,
      founderBeliefs,
      investorBeliefs,
      disagreement,
      space,
      risk,
      discounting,
      yearsToExit,
      seed: MC_SEED,
      samples: MC_N,
    }),
  )
}
function crossCheck(deal: DealFile, current: DealPoint) {
  if (!deal.risk) return null
  const { gamma, w0F, w0I } = deal.risk
  const post = accrueForExit(
    constructRound(deal.pre, deal.safes, current.pkg.terms, deal.notes).post,
    deal.yearsToExit,
  )
  const propagate = (sample: { se: number; ce: number }, w0: number) => ({
    ce: presentValue(sample.ce, deal.discounting),
    seCe: presentValue(sample.se * Math.pow(sample.ce + w0, gamma), deal.discounting),
  })
  return {
    founder: propagate(
      crraUtility(post, 'FOUNDER', deal.founderBeliefs, gamma, w0F, MC_N, MC_SEED),
      w0F,
    ),
    investor: propagate(
      crraUtility(post, 'INVESTOR', deal.investorBeliefs, gamma, w0I, MC_N, MC_SEED),
      w0I,
    ),
  }
}
export function computeFrontier(deal: DealFile) {
  const start = performance.now()
  try {
    const enumeration = enumerateDealsWithReasons(deal.space)
    const packages = enumeration.packages
    const points = packages.map((pkg) =>
      evaluatePackage(
        deal.pre,
        deal.safes,
        pkg,
        deal.founderBeliefs,
        deal.investorBeliefs,
        deal.risk,
        deal.notes,
        deal.discounting,
        deal.yearsToExit,
      ),
    )
    const result = analyze(points, deal.disagreement)
    const current = evaluatePackage(
      deal.pre,
      deal.safes,
      { index: -1, terms: deal.terms },
      deal.founderBeliefs,
      deal.investorBeliefs,
      deal.risk,
      deal.notes,
      deal.discounting,
      deal.yearsToExit,
    )
    const mcInspector = crossCheck(deal, current)
    return {
      mcInspector,
      result,
      current,
      value: valueOnTable(result, current),
      skipped: enumeration.skipped,
      elapsed: performance.now() - start,
      error: null as string | null,
    }
  } catch (error) {
    return {
      mcInspector: null,
      result: null,
      current: null,
      value: null,
      skipped: [],
      elapsed: performance.now() - start,
      error: error instanceof Error ? error.message : 'Frontier analysis failed',
    }
  }
}
export type FrontierComputation = ReturnType<typeof computeFrontier>
