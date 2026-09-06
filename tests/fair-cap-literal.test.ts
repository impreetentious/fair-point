import { expect, it } from 'vitest'
import { CapTableSchema, EPS_DECISION, type CapTable } from '../src/core/schema'
import { payoutsAt } from '../src/core/waterfall'
import fixture from './fair-cap-literal.fixture.json'

/**
 * B11 N06: scaling the independent residual-contract table by 1024 produces a
 * schema-valid exit 14897468416 whose largest capped class is already at
 * 4810464701.6922655. Absorbing a 1-ULP conservation residue into that class
 * exceeded EPS_DECISION=1e-6. Both the unscaled origin and the scaled table
 * must keep every CAPPED class at or under cap+EPS, and the sum must still
 * meet the inherited 7-decimal conservation gate.
 */
const ORIGIN = fixture as {
  post: CapTable
  exitValue: number
  id: string
}

function scaleCapTable(post: CapTable, scale: number): { post: CapTable; exitValue: number } {
  const input = structuredClone(post)
  for (const cls of input.classes) {
    if (cls.kind === 'PREFERRED') {
      for (const key of [
        'invested',
        'originalIssuePrice',
        'accruedDividends',
        'redemptionClaim',
      ] as const) {
        const value = cls[key]
        if (typeof value === 'number') cls[key] = value * scale
      }
    }
  }
  for (const grant of input.grants) grant.strike *= scale
  return { post: CapTableSchema.parse(input), exitValue: ORIGIN.exitValue * scale }
}

function assertCapsAndConservation(post: CapTable, exitValue: number) {
  const q = payoutsAt(post, exitValue)
  const total =
    Object.values(q.byClass).reduce((sum, value) => sum + value, 0) +
    Object.values(q.byGrant).reduce((sum, value) => sum + value, 0)
  expect(total).toBeCloseTo(exitValue, 7)
  for (const cls of post.classes) {
    if (cls.kind !== 'PREFERRED' || cls.participation !== 'CAPPED') continue
    const cap = cls.invested * (cls.participationCapMultiple as number)
    const paid = q.byClass[cls.id]!
    expect(paid).toBeLessThanOrEqual(cap + EPS_DECISION)
  }
  return q
}

it('preserves B11 N06 cap literal at scale 1024', () => {
  const { post, exitValue } = scaleCapTable(ORIGIN.post, 1024)
  expect(exitValue).toBe(14897468416)
  const cls = post.classes.find((entry) => entry.id === ORIGIN.id)
  if (cls?.kind !== 'PREFERRED') throw new Error('wrong class')
  const cap = cls.invested * cls.participationCapMultiple!
  expect(cap).toBe(4810464701.6922655)
  const q = assertCapsAndConservation(post, exitValue)
  expect(q.byClass[ORIGIN.id]! - cap).toBeLessThanOrEqual(0)
  expect(q.pathTaken[ORIGIN.id]).toBe('CAPPED')
})

it('preserves the unscaled residual-contract cap table', () => {
  const post = CapTableSchema.parse(structuredClone(ORIGIN.post))
  assertCapsAndConservation(post, ORIGIN.exitValue)
})

it('schema accepts the scaled N06 table inside the existing domain', () => {
  const { post } = scaleCapTable(ORIGIN.post, 1024)
  expect(post.grants[0]?.strike).toBe(ORIGIN.post.grants[0]!.strike * 1024)
  expect(
    post.classes.filter((cls) => cls.kind === 'PREFERRED').every((cls) => cls.seniorityTier === 3),
  ).toBe(true)
})
