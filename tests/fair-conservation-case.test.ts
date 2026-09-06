import { expect, it } from 'vitest'
import { payoutsAt } from '../src/core/waterfall'

/**
 * B10 recorded this minimized conservation input (seed 2000994391). The
 * unchanged `toBeCloseTo(..., 7)` gate fails on the inherited waterfall
 * arithmetic: summed payouts exceed the exit by 5.960464477539063e-8.
 */
const CONSERVATION_COUNTEREXAMPLE = {
  post: {
    classes: [
      {
        id: 'common',
        name: 'Common',
        kind: 'COMMON' as const,
        shares: 1237,
        holder: 'FOUNDER' as const,
      },
      {
        id: 'preferred-0',
        name: 'Preferred 1',
        kind: 'PREFERRED' as const,
        shares: 4869,
        holder: 'INVESTOR' as const,
        invested: 1631679,
        originalIssuePrice: 335.1158348736907,
        prefMultiple: 1,
        participation: 'NONE' as const,
        participationCapMultiple: undefined,
        seniorityTier: 1,
        conversionRatio: 1.5165226309821753,
        antiDilution: 'NONE' as const,
        dividendRate: 0,
        dividendKind: 'NONE' as const,
        payToPlay: 'NONE' as const,
        accruedDividends: 0,
        redemptionClaim: 0,
      },
      {
        id: 'preferred-1',
        name: 'Preferred 2',
        kind: 'PREFERRED' as const,
        shares: 1474,
        holder: 'OTHER' as const,
        invested: 1978106,
        originalIssuePrice: 1341.998643147897,
        prefMultiple: 1,
        participation: 'NONE' as const,
        participationCapMultiple: undefined,
        seniorityTier: 1,
        conversionRatio: 1.6908834342430452,
        antiDilution: 'NONE' as const,
        dividendRate: 0,
        dividendKind: 'NONE' as const,
        payToPlay: 'NONE' as const,
        accruedDividends: 0,
        redemptionClaim: 0,
      },
      {
        id: 'preferred-2',
        name: 'Preferred 3',
        kind: 'PREFERRED' as const,
        shares: 10538,
        holder: 'OTHER' as const,
        invested: 1804763,
        originalIssuePrice: 171.262383754033,
        prefMultiple: 1,
        participation: 'NONE' as const,
        participationCapMultiple: undefined,
        seniorityTier: 1,
        conversionRatio: 0.5,
        antiDilution: 'NONE' as const,
        dividendRate: 0,
        dividendKind: 'NONE' as const,
        payToPlay: 'NONE' as const,
        accruedDividends: 0,
        redemptionClaim: 0,
      },
      {
        id: 'preferred-3',
        name: 'Preferred 4',
        kind: 'PREFERRED' as const,
        shares: 1,
        holder: 'OTHER' as const,
        invested: 1821299,
        originalIssuePrice: 1821299,
        prefMultiple: 2,
        participation: 'FULL' as const,
        participationCapMultiple: undefined,
        seniorityTier: 1,
        conversionRatio: 1.9416534146198374,
        antiDilution: 'NONE' as const,
        dividendRate: 0,
        dividendKind: 'NONE' as const,
        payToPlay: 'NONE' as const,
        accruedDividends: 0,
        redemptionClaim: 0,
      },
      {
        id: 'preferred-4',
        name: 'Preferred 5',
        kind: 'PREFERRED' as const,
        shares: 1,
        holder: 'OTHER' as const,
        invested: 1665474,
        originalIssuePrice: 1665474,
        prefMultiple: 1,
        participation: 'NONE' as const,
        participationCapMultiple: undefined,
        seniorityTier: 1,
        conversionRatio: 0.5,
        antiDilution: 'NONE' as const,
        dividendRate: 0,
        dividendKind: 'NONE' as const,
        payToPlay: 'NONE' as const,
        accruedDividends: 0,
        redemptionClaim: 0,
      },
    ],
    grants: [],
    poolAvailable: 0,
    promisedOptions: 0,
  },
  exitValue: 176805405,
}

it('replays B10 conservation counterexample', () => {
  const q = payoutsAt(CONSERVATION_COUNTEREXAMPLE.post, CONSERVATION_COUNTEREXAMPLE.exitValue)
  const total =
    Object.values(q.byClass).reduce((sum, value) => sum + value, 0) +
    Object.values(q.byGrant).reduce((sum, value) => sum + value, 0)
  expect(total).toBeCloseTo(CONSERVATION_COUNTEREXAMPLE.exitValue, 7)
})
