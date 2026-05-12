import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fitLognormal, intervalProb, partialExpectation } from '../src/core/distributions'
import { mulberry32, normals, phi, phiInv } from '../src/core/numerics'

describe('numerics', () => {
  it.each([
    [0, 0.5],
    [0.5, 0.6914624612740131],
    [1, 0.8413447460685429],
    [2, 0.9772498680518208],
    [3, 0.9986501019683699],
  ])('matches the phi micro-oracle at %f', (x, expected) => {
    expect(phi(x)).toBeCloseTo(expected, 12)
  })

  it('matches the locked z table in both directions', () => {
    const table = [
      [0.05, -1.6448536269514722],
      [0.1, -1.2815515655446004],
      [0.25, -0.6744897501960817],
      [0.5, 0],
      [0.75, 0.6744897501960817],
      [0.9, 1.2815515655446004],
      [0.95, 1.6448536269514722],
    ]
    for (const [p, z] of table) {
      expect(phiInv(p)).toBeCloseTo(z, 8)
      expect(phi(z)).toBeCloseTo(p, 12)
    }
  })

  it('obeys phi symmetry to 1e-15', () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (z) => {
        expect(Math.abs(phi(-z) - (1 - phi(z)))).toBeLessThanOrEqual(1e-15)
      }),
      { numRuns: 300 },
    )
  })

  it('has the locked mulberry32 snapshot and deterministic Box-Muller stream', () => {
    const uniform = mulberry32(1)
    expect(Array.from({ length: 5 }, () => uniform())).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849,
    ])
    const first = normals(42)
    const second = normals(42)
    expect(Array.from({ length: 8 }, () => first())).toEqual(
      Array.from({ length: 8 }, () => second()),
    )
  })

  it('integrates the entire lognormal mean exactly enough for fixture tolerance', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -4, max: 4, noNaN: true }),
        fc.double({ min: 0.05, max: 2.5, noNaN: true }),
        (mu, sigma) => {
          const expected = Math.exp(mu + (sigma * sigma) / 2)
          expect(partialExpectation(mu, sigma, 0, Infinity)).toBeCloseTo(expected, 10)
          expect(intervalProb(mu, sigma, 0, Infinity)).toBeCloseTo(1, 12)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects finite quantiles whose fitted mean would overflow', () => {
    expect(() => fitLognormal({ p50: 1, p90: Number.MAX_VALUE })).toThrow(
      'lognormal mean exceeds the numeric range',
    )
  })
})
