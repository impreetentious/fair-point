import { useEffect, useMemo, useRef, useState } from 'react'
import { regimes } from '../../core/breakpoints'
import { accrueForExit } from '../../core/accruals'
import { payoutsAt } from '../../core/waterfall'
import { constructRound } from '../../core/round'
import type { DealFile } from '../../core/schema'

export function useRoundAnalysis(deal: DealFile) {
  return useMemo(() => {
    try {
      const round = constructRound(deal.pre, deal.safes, deal.terms, deal.notes)
      return { round, error: null as string | null }
    } catch (error) {
      return {
        round: null,
        error: error instanceof Error ? error.message : 'Round construction failed',
      }
    }
  }, [deal])
}

export function useWaterfallAnalysis(deal: DealFile, exitValue: number) {
  const round = useRoundAnalysis(deal)
  return useMemo(() => {
    if (round.round === null) return { ...round, settledPost: null, postRegimes: [], payout: null }
    try {
      const settled = accrueForExit(round.round.post, deal.yearsToExit)
      return {
        ...round,
        settledPost: settled,
        postRegimes: regimes(settled),
        payout: payoutsAt(settled, exitValue),
      }
    } catch (error) {
      return {
        ...round,
        settledPost: null,
        postRegimes: [],
        payout: null,
        error: error instanceof Error ? error.message : 'Waterfall settlement failed',
      }
    }
  }, [deal.yearsToExit, exitValue, round])
}

export function useFrontierAnalysis(deal: DealFile) {
  const identity = frontierIdentity(deal)
  const generation = useRef(0)
  const owner = useRef<(() => void) | null>(null)
  const snapshot = useRef(deal)
  useEffect(() => {
    snapshot.current = deal
  }, [deal])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    identity: string
    status: 'computing' | 'cancelled' | 'error' | 'ready'
    data: FrontierComputation | null
    error: string | null
  }>({ identity: '', status: 'computing', data: null, error: null })
  useEffect(() => {
    const token = ++generation.current
    setState({ identity, status: 'computing', data: null, error: null })
    const close = startFrontierRequest(
      snapshot.current,
      identity,
      token,
      (data) => {
        if (generation.current !== token) return
        owner.current = null
        setState({ identity, status: data.error ? 'error' : 'ready', data, error: data.error })
      },
      (error) => {
        if (generation.current !== token) return
        owner.current = null
        setState({ identity, status: 'error', data: null, error })
      },
      () => {
        if (typeof Worker === 'undefined')
          throw new Error(
            'Frontier computation unavailable: this browser does not support Workers.',
          )
        return new Worker(new URL('../workers/frontier.worker.ts', import.meta.url), {
          type: 'module',
        })
      },
    )
    owner.current = close
    return () => {
      generation.current++
      close()
      if (owner.current === close) owner.current = null
    }
  }, [identity, attempt])
  const current = state.identity === identity ? state : null
  return {
    result: current?.data?.result ?? null,
    current: current?.data?.current ?? null,
    value: current?.data?.value ?? null,
    skipped: current?.data?.skipped ?? [],
    elapsed: current?.data?.elapsed ?? 0,
    mcInspector: current?.data?.mcInspector ?? null,
    error: current?.error ?? null,
    status: current?.status ?? 'computing',
    identity,
    cancel: () => {
      generation.current++
      owner.current?.()
      owner.current = null
      setState({ identity, status: 'cancelled', data: null, error: null })
    },
    retry: () => setAttempt((value) => value + 1),
  }
}

import { frontierIdentity, type FrontierComputation } from '../workers/frontier-analysis'

import { startFrontierRequest } from '../workers/frontier-client'
