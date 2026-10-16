import { describe, expect, it, vi } from 'vitest'
import { EXAMPLE_DECKS } from '../src/app/data/examples'
import { computeFrontier, frontierIdentity } from '../src/app/workers/frontier-analysis'
import { startFrontierRequest } from '../src/app/workers/frontier-client'
import { analyze, enumerateDealsWithReasons, evaluatePackage } from '../src/core/bargain'
const deal = structuredClone(EXAMPLE_DECKS[1]!.deal)
deal.space = {
  ...deal.space,
  preMoneySteps: 1,
  pools: [0.1],
  multiples: [1],
  participations: ['NONE'],
}
function fake() {
  return {
    onerror: null as Worker['onerror'],
    onmessageerror: null as Worker['onmessageerror'],
    onmessage: null as Worker['onmessage'],
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
}
it('keeps core indices, bargaining and payouts identical across structured cloning', () => {
  const expected = analyze(
    enumerateDealsWithReasons(deal.space).packages.map((pkg) =>
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
    ),
    deal.disagreement,
  )
  expect(computeFrontier(structuredClone(deal)).result).toEqual(expected)
  const view = {
    ...deal,
    name: 'Presentation',
    ui: { ...deal.ui, reportView: { exitValue: 0, comparisons: [deal.terms] } },
  }
  expect(frontierIdentity(view)).toBe(frontierIdentity(deal))
  expect(
    frontierIdentity({
      ...deal,
      space: Object.fromEntries(Object.entries(deal.space).reverse()) as typeof deal.space,
    }),
  ).toBe(frontierIdentity(deal))
  expect(frontierIdentity({ ...deal, terms: { ...deal.terms, investment: 123 } })).not.toBe(
    frontierIdentity(deal),
  )
})
describe('native worker lifetime', () => {
  it('terminates cancellation, suppresses late success/error and accepts a fresh request', () => {
    const first = fake(),
      second = fake(),
      result = vi.fn(),
      error = vi.fn()
    const identity = frontierIdentity(deal)
    const cancel = startFrontierRequest(deal, identity, 1, result, error, () => first)
    cancel()
    cancel()
    first.onmessage?.call(
      first as unknown as Worker,
      { data: { generation: 1, identity, result: computeFrontier(deal) } } as MessageEvent,
    )
    first.onerror?.call(first as unknown as Worker, {} as ErrorEvent)
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(result).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    startFrontierRequest(deal, identity, 2, result, error, () => second)
    second.onmessage?.call(
      second as unknown as Worker,
      { data: { generation: 2, identity, result: computeFrontier(deal) } } as MessageEvent,
    )
    expect(result).toHaveBeenCalledTimes(1)
    expect(second.terminate).toHaveBeenCalledTimes(1)
  })
  it('refuses constructor, dispatch, runtime, messageerror and invalid payload failures', () => {
    const result = vi.fn(),
      error = vi.fn(),
      identity = frontierIdentity(deal)
    startFrontierRequest(deal, identity, 1, result, error, () => {
      throw new Error('constructor failed')
    })
    for (const kind of ['dispatch', 'runtime', 'messageerror', 'payload']) {
      const worker = fake()
      if (kind === 'dispatch')
        worker.postMessage.mockImplementation(() => {
          throw new Error('dispatch failed')
        })
      startFrontierRequest(deal, identity, 1, result, error, () => worker)
      if (kind === 'runtime') worker.onerror?.call(worker as unknown as Worker, {} as ErrorEvent)
      if (kind === 'messageerror')
        worker.onmessageerror?.call(worker as unknown as Worker, {} as MessageEvent)
      if (kind === 'payload')
        worker.onmessage?.call(
          worker as unknown as Worker,
          { data: { generation: 1, identity, result: { elapsed: NaN } } } as MessageEvent,
        )
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    }
    expect(error).toHaveBeenCalledTimes(5)
    expect(result).not.toHaveBeenCalled()
  })
})
