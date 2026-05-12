import { fitLognormal, intervalProb, mixtureQuantile, partialExpectation } from './distributions'
import type { Beliefs, CapTable, HolderStats, Regime } from './schema'
import { payoutsAt } from './waterfall'
import { regimes } from './breakpoints'

type Attribution = 'FOUNDER' | 'INVESTOR' | 'OTHER'

function idsForHolder(post: CapTable, holderId: string): string[] {
  if (holderId === 'FOUNDER' || holderId === 'INVESTOR' || holderId === 'OTHER') {
    const holder = holderId as Attribution
    return [
      ...post.classes.filter((cls) => cls.holder === holder).map((cls) => cls.id),
      ...post.grants.filter((grant) => grant.holder === holder).map((grant) => grant.id),
    ]
  }
  const known = [...post.classes.map((cls) => cls.id), ...post.grants.map((grant) => grant.id)]
  if (!known.includes(holderId)) throw new RangeError(`Unknown holder or payout id '${holderId}'`)
  return [holderId]
}

function valueAt(payout: ReturnType<typeof payoutsAt>, ids: string[]): number {
  return ids.reduce((sum, id) => sum + (payout.byClass[id] ?? 0) + (payout.byGrant[id] ?? 0), 0)
}

function expectedFromRegimes(allRegimes: Regime[], ids: string[], beliefs: Beliefs): number {
  const { mu, sigma } = fitLognormal(beliefs)
  const conditional = allRegimes.reduce((sum, regime) => {
    const coefficient = ids.reduce(
      (total, id) => ({
        m: total.m + (regime.coeffs[id]?.m ?? 0),
        c: total.c + (regime.coeffs[id]?.c ?? 0),
      }),
      { m: 0, c: 0 },
    )
    return (
      sum +
      coefficient.m * partialExpectation(mu, sigma, regime.from, regime.to) +
      coefficient.c * intervalProb(mu, sigma, regime.from, regime.to)
    )
  }, 0)
  return (1 - beliefs.p0) * conditional
}

/** Analytic expected payout statistics over the recovered piecewise-linear waterfall regimes. */
export function expectedPayouts(post: CapTable, beliefs: Beliefs): HolderStats {
  const allRegimes = regimes(post)
  const entries = [...post.classes.map((cls) => cls.id), ...post.grants.map((grant) => grant.id)]
  const ev = Object.fromEntries(
    entries.map((id) => [id, expectedFromRegimes(allRegimes, [id], beliefs)]),
  )
  return {
    ev,
    party: {
      founder: expectedFromRegimes(allRegimes, idsForHolder(post, 'FOUNDER'), beliefs),
      investor: expectedFromRegimes(allRegimes, idsForHolder(post, 'INVESTOR'), beliefs),
      other: expectedFromRegimes(allRegimes, idsForHolder(post, 'OTHER'), beliefs),
    },
  }
}

/** The payout quantile follows the exit quantile because all holder payouts are comonotonic. */
export function payoutQuantile(
  post: CapTable,
  holderId: string,
  beliefs: Beliefs,
  p: number,
): number {
  if (!(p >= 0 && p < 1)) throw new RangeError('payoutQuantile requires p in [0, 1)')
  if (p <= beliefs.p0) return 0
  return valueAt(payoutsAt(post, mixtureQuantile(beliefs, p)), idsForHolder(post, holderId))
}

export function payoutValue(post: CapTable, holderId: string, exitValue: number): number {
  return valueAt(payoutsAt(post, exitValue), idsForHolder(post, holderId))
}

export function regimeCoefficients(post: CapTable, holderId: string): Regime[] {
  const ids = idsForHolder(post, holderId)
  return regimes(post).map((regime) => ({
    ...regime,
    coeffs: {
      [holderId]: ids.reduce(
        (sum, id) => ({
          m: sum.m + (regime.coeffs[id]?.m ?? 0),
          c: sum.c + (regime.coeffs[id]?.c ?? 0),
        }),
        { m: 0, c: 0 },
      ),
    },
  }))
}
