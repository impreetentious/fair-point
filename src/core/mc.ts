import { fitLognormal } from './distributions'
import { normals, phi, phiInv, mulberry32 } from './numerics'
import { payoutValue, regimeCoefficients } from './outcomes'
import type { Beliefs, CapTable, HolderMcStats } from './schema'
import { payoutsAt } from './waterfall'

type CrraResult = { u: number; se: number; ce: number }

const GL_NODES: number[] = []
const GL_WEIGHTS: number[] = []

function buildGaussLegendre(order: number): void {
  const epsilon = 1e-15
  const midpoint = Math.ceil(order / 2)
  for (let index = 0; index < midpoint; index += 1) {
    let root = Math.cos((Math.PI * (index + 0.75)) / (order + 0.5))
    let derivative = 0
    for (let iteration = 0; iteration < 100; iteration += 1) {
      let p1 = 1
      let p2 = 0
      for (let degree = 1; degree <= order; degree += 1) {
        const next = ((2 * degree - 1) * root * p1 - (degree - 1) * p2) / degree
        p2 = p1
        p1 = next
      }
      derivative = (order * (root * p1 - p2)) / (root * root - 1)
      const next = root - p1 / derivative
      if (Math.abs(next - root) <= epsilon) {
        root = next
        break
      }
      root = next
    }
    const weight = 2 / ((1 - root * root) * derivative * derivative)
    GL_NODES.push(-root, root)
    GL_WEIGHTS.push(weight, weight)
  }
}

buildGaussLegendre(64)

function utility(value: number, gamma: number, w0: number): number {
  const wealth = Math.max(w0, value + w0)
  return gamma === 1 ? Math.log(wealth) : (Math.pow(wealth, 1 - gamma) - 1) / (1 - gamma)
}

function certaintyEquivalent(u: number, gamma: number, w0: number): number {
  return gamma === 1 ? Math.exp(u) - w0 : Math.pow(u * (1 - gamma) + 1, 1 / (1 - gamma)) - w0
}

function sampleExit(beliefs: Beliefs, uniform: () => number, normal: () => number): number {
  if (uniform() < beliefs.p0) return 0
  const { mu, sigma } = fitLognormal(beliefs)
  return Math.exp(mu + sigma * normal())
}

function entries(post: CapTable): string[] {
  return [...post.classes.map((cls) => cls.id), ...post.grants.map((grant) => grant.id)]
}

/** Seeded Monte Carlo twin used only for agreement tests and the CRRA inspector. */
export function mcPayouts(post: CapTable, beliefs: Beliefs, n: number, seed: number): HolderMcStats {
  if (!Number.isInteger(n) || n < 2) throw new RangeError('mcPayouts requires an integer n >= 2')
  const ids = entries(post)
  const mean = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>
  const m2 = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>
  const uniform = mulberry32(seed)
  const normal = normals(seed ^ 0x9e3779b9)
  for (let sample = 1; sample <= n; sample += 1) {
    const payout = payoutSample(post, sampleExit(beliefs, uniform, normal))
    for (const id of ids) {
      const value = payout[id]
      const delta = value - mean[id]
      mean[id] += delta / sample
      m2[id] += delta * (value - mean[id])
    }
  }
  return { mean, se: Object.fromEntries(ids.map((id) => [id, Math.sqrt((m2[id] / (n - 1)) / n)])) }
}

function payoutSample(post: CapTable, exitValue: number): Record<string, number> {
  const result = payoutsAt(post, exitValue)
  return { ...result.byClass, ...result.byGrant }
}

/** Seeded CRRA utility for a holder, class, grant, or party attribution. */
export function crraUtility(post: CapTable, holderId: string, beliefs: Beliefs, gamma: number, w0: number, n: number, seed: number): CrraResult {
  if (!(gamma === 0.5 || gamma === 1) || !(w0 > 0)) throw new RangeError('CRRA supports gamma 0.5 or 1 with w0 > 0')
  if (!Number.isInteger(n) || n < 2) throw new RangeError('crraUtility requires an integer n >= 2')
  const uniform = mulberry32(seed)
  const normal = normals(seed ^ 0x9e3779b9)
  let mean = 0
  let m2 = 0
  for (let sample = 1; sample <= n; sample += 1) {
    const value = utility(payoutValue(post, holderId, sampleExit(beliefs, uniform, normal)), gamma, w0)
    const delta = value - mean
    mean += delta / sample
    m2 += delta * (value - mean)
  }
  return { u: mean, se: Math.sqrt((m2 / (n - 1)) / n), ce: certaintyEquivalent(mean, gamma, w0) }
}

function lognormalProbability(value: number, mu: number, sigma: number): number {
  if (value <= 0) return 0
  if (value === Infinity) return 1
  return phi((Math.log(value) - mu) / sigma)
}

/** Deterministic 64-node Gauss–Legendre CE used by the bargaining grid in CRRA mode. */
export function crraQuadrature(post: CapTable, holderId: string, beliefs: Beliefs, gamma: 0.5 | 1, w0: number): { u: number; ce: number } {
  if (!(w0 > 0)) throw new RangeError('crraQuadrature requires w0 > 0')
  const { mu, sigma } = fitLognormal(beliefs)
  let conditional = 0
  for (const regime of regimeCoefficients(post, holderId)) {
    const coefficient = regime.coeffs[holderId]
    const low = lognormalProbability(regime.from, mu, sigma)
    const high = lognormalProbability(regime.to, mu, sigma)
    if (high <= low) continue
    const half = (high - low) / 2
    const middle = (high + low) / 2
    for (let index = 0; index < GL_NODES.length; index += 1) {
      const q = Math.min(1 - 1e-15, Math.max(1e-15, middle + half * GL_NODES[index]))
      const exitValue = Math.exp(mu + sigma * phiInv(q))
      const payout = Math.max(0, coefficient.m * exitValue + coefficient.c)
      conditional += half * GL_WEIGHTS[index] * utility(payout, gamma, w0)
    }
  }
  const u = beliefs.p0 * utility(0, gamma, w0) + (1 - beliefs.p0) * conditional
  return { u, ce: certaintyEquivalent(u, gamma, w0) }
}
