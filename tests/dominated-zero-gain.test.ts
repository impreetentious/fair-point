import { describe, expect, it } from 'vitest'
import { analyzeN } from '../src/core/bargain-n'

// Saved property-test counterexample. The witness below is the hand-derived
// literal: utilities (0,0,0) and (0,0,1), disagreement 0, frontier [1].
const savedSeed = '-679268660'
const savedPath = '119:0:0:0:1:0:0:0:0:0:0:0:0'

function point(index: number, utilities: Record<string, number>) {
  return {
    pkg: {
      index,
      terms: {
        preMoney: 1,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1 as const,
        participation: 'NONE' as const,
        seniority: 'PARI' as const,
      },
    },
    utilities,
    metric: 'EV' as const,
    diagnostics: { pps: 1, investorPct: 0.5, poolIncrease: 0 },
  }
}

describe('dominated zero-gain Nash and KS', () => {
  it('selects frontier index 1 for the saved literal', () => {
    expect(savedSeed).toBe('-679268660')
    expect(savedPath).toBe('119:0:0:0:1:0:0:0:0:0:0:0:0')
    const result = analyzeN(
      [point(0, { A: 0, B: 0, C: 0 }), point(1, { A: 0, B: 0, C: 1 })],
      { A: 0, B: 0, C: 0 },
      ['A', 'B', 'C'],
    )
    expect(result.frontier).toEqual([1])
    expect(result.nash).toBe(1)
    expect(result.ks).toBe(1)
  })
})
