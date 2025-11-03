import { useMemo } from 'react'
import { analyze, enumerateDeals, evaluatePackage, valueOnTable } from '../../core/bargain'
import { regimes } from '../../core/breakpoints'
import { accrueForExit } from '../../core/accruals'
import { payoutsAt } from '../../core/waterfall'
import { constructRound } from '../../core/round'
import type { DealFile } from '../../core/schema'

export function useRoundAnalysis(deal: DealFile) {
  return useMemo(() => {
    try {
      const round = constructRound(deal.pre, deal.safes, deal.terms, deal.notes)
      return { round, postRegimes: regimes(round.post), error: null as string | null }
    } catch (error) {
      return {
        round: null,
        postRegimes: [],
        error: error instanceof Error ? error.message : 'Round construction failed',
      }
    }
  }, [deal])
}

export function useWaterfallAnalysis(deal: DealFile, exitValue: number) {
  const round = useRoundAnalysis(deal)
  return useMemo(() => {
    if (round.round === null) return { ...round, payout: null }
    try {
      const settled = accrueForExit(round.round.post, deal.yearsToExit)
      return { ...round, payout: payoutsAt(settled, exitValue) }
    } catch (error) {
      return {
        ...round,
        payout: null,
        error: error instanceof Error ? error.message : 'Waterfall settlement failed',
      }
    }
  }, [deal.yearsToExit, exitValue, round])
}

export function useFrontierAnalysis(deal: DealFile) {
  return useMemo(() => {
    const start = performance.now()
    try {
      const packages = enumerateDeals(deal.space)
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
      )
      return {
        result,
        current,
        value: valueOnTable(result, current),
        elapsed: performance.now() - start,
        error: null as string | null,
      }
    } catch (error) {
      return {
        result: null,
        current: null,
        value: null,
        elapsed: performance.now() - start,
        error: error instanceof Error ? error.message : 'Frontier analysis failed',
      }
    }
  }, [deal])
}
