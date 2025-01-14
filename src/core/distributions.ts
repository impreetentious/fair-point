import type { Beliefs, LognormalFit } from './schema'
import { phi, phiInv } from './numerics'

export const Z90 = 1.2815515655446004

export function fitLognormal(q: { p10?: number; p50: number; p90?: number }): LognormalFit {
  if (!(q.p50 > 0) || !(q.p90 !== undefined && q.p90 > q.p50)) {
    throw new RangeError('fitLognormal requires p50 > 0 and p90 > p50')
  }
  if (q.p10 !== undefined && !(q.p10 > 0 && q.p10 < q.p50)) {
    throw new RangeError('fitLognormal requires p10 < p50 when p10 is supplied')
  }
  const mu = Math.log(q.p50)
  const sigma =
    q.p10 === undefined
      ? (Math.log(q.p90) - Math.log(q.p50)) / Z90
      : (Math.log(q.p90) - Math.log(q.p10)) / (2 * Z90)
  if (!(sigma > 0) || !Number.isFinite(sigma)) throw new RangeError('lognormal sigma must be positive')
  const warnings: string[] = []
  if (q.p10 !== undefined) {
    const impliedMedian = Math.exp((Math.log(q.p10) + Math.log(q.p90)) / 2)
    if (Math.abs(impliedMedian - q.p50) > 0.1 * q.p50) warnings.push('beliefs not lognormal-consistent')
  }
  return { mu, sigma, warnings }
}

function bounds(mu: number, sigma: number, a: number, b: number): [number, number] {
  if (!(sigma > 0) || !Number.isFinite(mu) || a < 0 || !(b > a)) {
    throw new RangeError('interval bounds require finite mu, positive sigma, and 0 <= a < b')
  }
  return [a === 0 ? -Infinity : (Math.log(a) - mu) / sigma, b === Infinity ? Infinity : (Math.log(b) - mu) / sigma]
}

export function intervalProb(mu: number, sigma: number, a: number, b: number): number {
  const [alpha, beta] = bounds(mu, sigma, a, b)
  return phi(beta) - phi(alpha)
}

export function partialExpectation(mu: number, sigma: number, a: number, b: number): number {
  const [alpha, beta] = bounds(mu, sigma, a, b)
  return Math.exp(mu + (sigma * sigma) / 2) * (phi(beta - sigma) - phi(alpha - sigma))
}

export function mixtureQuantile(beliefs: Beliefs, p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError('mixtureQuantile requires p between 0 and 1')
  if (p <= beliefs.p0) return 0
  if (p === 1) return Infinity
  const { mu, sigma } = fitLognormal(beliefs)
  return Math.exp(mu + sigma * phiInv((p - beliefs.p0) / (1 - beliefs.p0)))
}
