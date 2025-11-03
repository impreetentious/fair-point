/* eslint-disable no-loss-of-precision -- Cody and Acklam coefficients must retain published digits. */

const SQRT_TWO = Math.SQRT2
const INV_SQRT_PI = 0.5641895835477563
const ERFC_THRESHOLD = 0.46875

// W. J. Cody, Math. Comp. 23 (1969), Table II. Keep the published ordering.
const A = [
  3.1611237438705656, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3,
  1.85777706184603153e-1,
]
const B = [
  2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3,
]
const C = [
  5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2,
  8.8195222124176909e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
  2.15311535474403846e-8,
]
const D = [
  1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
  3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3,
]
const P = [
  3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2,
  6.58749161529837803e-4, 1.63153871373020978e-2,
]
const Q = [
  2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1, 6.05183413124413191e-2,
  2.33520497626869185e-3,
]

/** Cody's unscaled complementary error function, accurate over finite doubles. */
function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x === Infinity) return 0
  if (x === -Infinity) return 2

  const y = Math.abs(x)
  let result: number
  if (y <= ERFC_THRESHOLD) {
    const ysq = y > Number.EPSILON ? y * y : 0
    let numerator = A[4] * ysq
    let denominator = ysq
    for (let index = 0; index < 3; index += 1) {
      numerator = (numerator + A[index]) * ysq
      denominator = (denominator + B[index]) * ysq
    }
    result = 1 - (y * (numerator + A[3])) / (denominator + B[3])
  } else if (y <= 4) {
    let numerator = C[8] * y
    let denominator = y
    for (let index = 0; index < 7; index += 1) {
      numerator = (numerator + C[index]) * y
      denominator = (denominator + D[index]) * y
    }
    result = ((numerator + C[7]) / (denominator + D[7])) * Math.exp(-y * y)
  } else if (y < 26.543) {
    const ysq = 1 / (y * y)
    let numerator = P[5] * ysq
    let denominator = ysq
    for (let index = 0; index < 4; index += 1) {
      numerator = (numerator + P[index]) * ysq
      denominator = (denominator + Q[index]) * ysq
    }
    result =
      ((INV_SQRT_PI - (ysq * (numerator + P[4])) / (denominator + Q[4])) / y) * Math.exp(-y * y)
  } else {
    result = 0
  }
  return x < 0 ? 2 - result : result
}

/** Standard-normal CDF. The negative branch is deliberately complementary for stable symmetry. */
export function phi(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x === Infinity) return 1
  if (x === -Infinity) return 0
  if (x === 0) return 0.5
  if (x < 0) return 1 - phi(-x)
  return 1 - 0.5 * erfc(x / SQRT_TWO)
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
]
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
]
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
]
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

/** Peter John Acklam's inverse standard-normal approximation. */
export function phiInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('phiInv requires p strictly between 0 and 1')
  const low = 0.02425
  const high = 1 - low
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    )
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1)
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
    (q *
      (((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r + ACKLAM_A[4]) *
        r +
        ACKLAM_A[5])) /
    (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r + ACKLAM_B[4]) *
      r +
      1)
  )
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function normals(seed: number): () => number {
  const uniform = mulberry32(seed)
  let spare: number | undefined
  return () => {
    if (spare !== undefined) {
      const value = spare
      spare = undefined
      return value
    }
    const u1 = Math.max(uniform(), 1e-12)
    const u2 = uniform()
    const radius = Math.sqrt(-2 * Math.log(u1))
    const angle = 2 * Math.PI * u2
    spare = radius * Math.sin(angle)
    return radius * Math.cos(angle)
  }
}

export function near(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance
}
