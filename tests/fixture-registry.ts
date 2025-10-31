import { expect } from 'vitest'
import { fitLognormal, intervalProb, mixtureQuantile, partialExpectation } from '../src/core/distributions'
import { mulberry32 } from '../src/core/numerics'
import {
  BeliefsSchema,
  CapTableSchema,
  ConvertibleNoteSchema,
  DealFileSchema,
  DiscountingSchema,
  RoundTermsSchema,
  SafeSchema,
  SecondarySaleSchema,
} from '../src/core/schema'
import { regimes } from '../src/core/breakpoints'
import { constructRound } from '../src/core/round'
import { convertSafes } from '../src/core/safes'
import { analyze, valueOnTable } from '../src/core/bargain'
import { analyzeN } from '../src/core/bargain-n'
import { accrueForExit, preferenceClaim } from '../src/core/accruals'
import { analyzeEmployeeOffer } from '../src/core/employee-offer'
import { noteAccruedAmount } from '../src/core/notes'
import { applyMfn } from '../src/core/mfn'
import { applySecondary } from '../src/core/secondary'
import { discountFactor, presentValue } from '../src/core/discounting'
import { estimate409A } from '../src/core/fairvalue'
import { crraQuadrature, crraUtility } from '../src/core/mc'
import { payoutsAt } from '../src/core/waterfall'
import { registerFixtureHandler } from './fixture-harness'

function d16Precision(tolerance: number | undefined): number {
  return Math.max(0, Math.floor(-Math.log10(tolerance ?? 0.01)))
}

type DistFixtureInput =
  | { operation: 'fit'; values: { p10?: number; p50: number; p90: number } }
  | { operation: 'partialExpectation' | 'intervalProb'; mu: number; sigma: number; a: number; b: number }
  | { operation: 'mixtureQuantile'; beliefs: unknown; p: number }
  | { operation: 'mulberry32'; seed: number; count: number }

type DistFixtureExpect = { value?: number; mu?: number; sigma?: number; warnings?: string[]; values?: number[] }

function asInput(value: unknown): DistFixtureInput {
  return value as DistFixtureInput
}

function asExpect(value: unknown): DistFixtureExpect {
  return value as DistFixtureExpect
}

registerFixtureHandler('dist', (fixture) => {
  const input = asInput(fixture.input)
  const expected = asExpect(fixture.expect)
  const tolerance = fixture.tolerance ?? 1e-9
  if (input.operation === 'fit') {
    const result = fitLognormal(input.values)
    expect(result.mu).toBeCloseTo(expected.mu ?? Number.NaN, 12)
    expect(result.sigma).toBeCloseTo(expected.sigma ?? Number.NaN, 12)
    expect(result.warnings).toEqual(expected.warnings ?? [])
    return
  }
  if (input.operation === 'partialExpectation') {
    expect(partialExpectation(input.mu, input.sigma, input.a, input.b)).toBeCloseTo(expected.value ?? Number.NaN, Math.max(0, Math.floor(-Math.log10(tolerance))))
    return
  }
  if (input.operation === 'intervalProb') {
    expect(intervalProb(input.mu, input.sigma, input.a, input.b)).toBeCloseTo(expected.value ?? Number.NaN, Math.max(0, Math.floor(-Math.log10(tolerance))))
    return
  }
  if (input.operation === 'mixtureQuantile') {
    const beliefs = BeliefsSchema.parse(input.beliefs)
    expect(mixtureQuantile(beliefs, input.p)).toBeCloseTo(expected.value ?? Number.NaN, Math.max(0, Math.floor(-Math.log10(tolerance))))
    return
  }
  if (input.operation === 'mulberry32') {
    const uniform = mulberry32(input.seed)
    expect(Array.from({ length: input.count }, () => uniform())).toEqual(expected.values)
    return
  }
  throw new Error(`Unsupported distribution fixture operation: ${(input as { operation: string }).operation}`)
})

type WaterfallFixtureInput = { capTable: unknown; exitValue: number }
type WaterfallFixtureExpect = {
  payouts: Record<string, number>
  breakpoints?: number[]
  pathTaken?: Record<string, string>
  strikeCashPaid?: number
}

registerFixtureHandler('waterfall', (fixture) => {
  const input = fixture.input as WaterfallFixtureInput
  const expected = fixture.expect as WaterfallFixtureExpect
  const post = CapTableSchema.parse(input.capTable)
  const result = payoutsAt(post, input.exitValue)
  const values = { ...result.byClass, ...result.byGrant }
  const precision = Math.max(0, Math.floor(-Math.log10(fixture.tolerance ?? 0.01)))
  for (const [id, value] of Object.entries(expected.payouts)) expect(values[id]).toBeCloseTo(value, precision)
  if (expected.strikeCashPaid !== undefined) expect(result.strikeCashPaid).toBeCloseTo(expected.strikeCashPaid, precision)
  if (expected.pathTaken !== undefined) {
    for (const [id, path] of Object.entries(expected.pathTaken)) expect(result.pathTaken[id]).toBe(path)
  }
  if (expected.breakpoints !== undefined) {
    const actual = regimes(post).map((regime) => regime.from).filter((value) => value > 0)
    for (const breakpoint of expected.breakpoints) {
      expect(actual.some((value) => Math.abs(value - breakpoint) <= 0.01)).toBe(true)
    }
  }
})

type SafeFixtureInput = { baseCap: number; safes: unknown[]; roundPps: number }
type SafeFixtureExpect = { sharesBySafe: Record<string, number>; routeBySafe?: Record<string, string>; totalCapitalization?: number }

registerFixtureHandler('safe', (fixture) => {
  const input = fixture.input as SafeFixtureInput
  const expected = fixture.expect as SafeFixtureExpect
  const result = convertSafes(input.baseCap, input.safes.map((safe) => SafeSchema.parse(safe)), input.roundPps)
  const precision = Math.max(0, Math.floor(-Math.log10(fixture.tolerance ?? 0.01)))
  for (const [id, shares] of Object.entries(expected.sharesBySafe)) expect(result.sharesBySafe[id]).toBeCloseTo(shares, precision)
  if (expected.totalCapitalization !== undefined) {
    expect(input.baseCap + result.totalSafeShares).toBeCloseTo(expected.totalCapitalization, precision)
  }
  if (expected.routeBySafe !== undefined) {
    for (const [id, route] of Object.entries(expected.routeBySafe)) expect(result.routeBySafe[id]).toBe(route)
  }
})

type RoundFixtureInput = { capTable: unknown; safes: unknown[]; terms: unknown }
type RoundFixtureExpect = {
  pps?: number
  investorPct?: number
  poolIncrease?: number
  safeShares?: number
  classes?: Record<string, { shares?: number; seniorityTier?: number; conversionRatio?: number }>
}

registerFixtureHandler('round', (fixture) => {
  const input = fixture.input as RoundFixtureInput
  const expected = fixture.expect as RoundFixtureExpect
  const result = constructRound(
    CapTableSchema.parse(input.capTable),
    input.safes.map((safe) => SafeSchema.parse(safe)),
    RoundTermsSchema.parse(input.terms),
  )
  const precision = Math.max(0, Math.floor(-Math.log10(fixture.tolerance ?? 0.01)))
  if (expected.pps !== undefined) expect(result.diagnostics.pps).toBeCloseTo(expected.pps, precision)
  if (expected.investorPct !== undefined) expect(result.diagnostics.investorPct).toBeCloseTo(expected.investorPct, precision)
  if (expected.poolIncrease !== undefined) expect(result.diagnostics.poolIncrease).toBeCloseTo(expected.poolIncrease, precision)
  if (expected.safeShares !== undefined) expect(result.diagnostics.safeShares).toBeCloseTo(expected.safeShares, precision)
  for (const [id, values] of Object.entries(expected.classes ?? {})) {
    const cls = result.post.classes.find((candidate) => candidate.id === id)
    expect(cls).toBeDefined()
    if (values.shares !== undefined) expect(cls!.shares).toBeCloseTo(values.shares, precision)
    if (values.seniorityTier !== undefined && cls?.kind === 'PREFERRED') expect(cls.seniorityTier).toBe(values.seniorityTier)
    if (values.conversionRatio !== undefined && cls?.kind === 'PREFERRED') expect(cls.conversionRatio).toBeCloseTo(values.conversionRatio, precision)
  }
})

registerFixtureHandler('validation', (fixture) => {
  const expected = fixture.expect as { valid: boolean; message?: string }
  const parsed = DealFileSchema.safeParse(fixture.input)
  expect(parsed.success).toBe(expected.valid)
  if (!expected.valid && expected.message !== undefined && !parsed.success) {
    expect(parsed.error.issues.map((issue) => issue.message).join(' | ')).toContain(expected.message)
  }
})

type BargainPointInput = { index: number; uF: number; uI: number }
type BargainFixtureInput =
  | { operation: 'divideDollar'; max: number }
  | { operation?: 'points'; points: BargainPointInput[]; disagreement: { dF: number; dI: number }; currentIndex?: number }
  | { operation: 'crra'; capTable: unknown; beliefs: unknown; gamma: 0.5 | 1; w0: number; n: number; seed: number }
type BargainFixtureExpect = {
  nash?: number | null
  ks?: number | null
  egalitarian?: number | null
  utilitarian?: number | null
  zopa?: boolean
  frontier?: number[]
  valueOnTable?: { headline: number; gainF: number; gainI: number; dominating: number[] }
  ce?: number
  withinSe?: number
}

function fixturePoint(point: BargainPointInput) {
  return {
    pkg: {
      index: point.index,
      terms: RoundTermsSchema.parse({ preMoney: 1, investment: 1, poolTargetPost: 0, prefMultiple: 1, participation: 'NONE', seniority: 'PARI' }),
    },
    uF: point.uF,
    uI: point.uI,
    uF_underI: point.uF,
    uI_underF: point.uI,
    metric: 'EV' as const,
    diagnostics: { pps: 1, investorPct: 0.5, poolIncrease: 0 },
  }
}

registerFixtureHandler('bargain', (fixture) => {
  const input = fixture.input as BargainFixtureInput
  const expected = fixture.expect as BargainFixtureExpect
  if (input.operation === 'crra') {
    const post = CapTableSchema.parse(input.capTable)
    const beliefs = BeliefsSchema.parse(input.beliefs)
    const quadrature = crraQuadrature(post, 'FOUNDER', beliefs, input.gamma, input.w0)
    const sampled = crraUtility(post, 'FOUNDER', beliefs, input.gamma, input.w0, input.n, input.seed)
    const seCe = sampled.se * Math.pow(sampled.ce + input.w0, input.gamma)
    if (expected.ce !== undefined) expect(quadrature.ce).toBeCloseTo(expected.ce, Math.max(0, Math.floor(-Math.log10(fixture.tolerance ?? 0.01))))
    expect(Math.abs(quadrature.ce - sampled.ce)).toBeLessThanOrEqual((expected.withinSe ?? 4) * seCe + 1)
    return
  }
  const pointInputs =
    input.operation === 'divideDollar'
      ? Array.from({ length: input.max + 1 }, (_, index) => ({ index, uF: Math.sqrt(index), uI: input.max - index }))
      : input.points
  const disagreement = input.operation === 'divideDollar' ? { dF: 0, dI: 0 } : input.disagreement
  const points = pointInputs.map(fixturePoint)
  const result = analyze(points, disagreement)
  if (expected.nash !== undefined) expect(result.nash).toBe(expected.nash)
  if (expected.ks !== undefined) expect(result.ks).toBe(expected.ks)
  if (expected.egalitarian !== undefined) expect(result.egalitarian).toBe(expected.egalitarian)
  if (expected.utilitarian !== undefined) expect(result.utilitarian).toBe(expected.utilitarian)
  if (expected.zopa !== undefined) expect(result.zopa).toBe(expected.zopa)
  if (expected.frontier !== undefined) expect(result.frontier).toEqual(expected.frontier)
  if (expected.valueOnTable !== undefined && input.operation !== 'divideDollar') {
    const current = points.find((point) => point.pkg.index === input.currentIndex)!
    expect(valueOnTable(result, current)).toEqual(expected.valueOnTable)
  }
})

registerFixtureHandler('employee', (fixture) => {
  const input = fixture.input as {
    pre: unknown
    safes: unknown[]
    terms: unknown
    grant: { id: string; options: number; strike: number; holder: 'FOUNDER' | 'OTHER'; instrument?: 'OPTION' | 'WARRANT' }
    beliefs: unknown
    cashAlternative?: number
    exitValue: number
  }
  const expected = fixture.expect as { payoutAtExit: number }
  const result = analyzeEmployeeOffer({
    pre: CapTableSchema.parse(input.pre),
    safes: input.safes.map((safe) => SafeSchema.parse(safe)),
    terms: RoundTermsSchema.parse(input.terms),
    grant: { instrument: 'OPTION', ...input.grant },
    beliefs: BeliefsSchema.parse(input.beliefs),
    cashAlternative: input.cashAlternative,
  })
  expect(result.payoutAt(input.exitValue)).toBeCloseTo(expected.payoutAtExit, d16Precision(fixture.tolerance))
})

registerFixtureHandler('note', (fixture) => {
  const input = fixture.input as { note: unknown; capTable: unknown; terms: unknown }
  const expected = fixture.expect as { accruedAmount: number; shares: number }
  const note = ConvertibleNoteSchema.parse(input.note)
  expect(noteAccruedAmount(note)).toBeCloseTo(expected.accruedAmount, d16Precision(fixture.tolerance))
  const round = constructRound(CapTableSchema.parse(input.capTable), [], RoundTermsSchema.parse(input.terms), [note])
  const shadow = round.post.classes.find((cls) => cls.id === `safe-${note.id}`)
  expect(shadow).toBeDefined()
  expect(shadow!.shares).toBeCloseTo(expected.shares, d16Precision(fixture.tolerance))
})

registerFixtureHandler('dividend', (fixture) => {
  const input = fixture.input as { capTable: unknown; yearsToExit: number; exitValue: number }
  const expected = fixture.expect as {
    accruedDividends: number
    preferenceClaim: number
    payouts: Record<string, number>
  }
  const settled = accrueForExit(CapTableSchema.parse(input.capTable), input.yearsToExit)
  const preferred = settled.classes.find((cls) => cls.kind === 'PREFERRED')!
  expect(preferred.kind).toBe('PREFERRED')
  if (preferred.kind === 'PREFERRED') {
    expect(preferred.accruedDividends).toBeCloseTo(expected.accruedDividends, d16Precision(fixture.tolerance))
    expect(preferenceClaim(preferred)).toBeCloseTo(expected.preferenceClaim, d16Precision(fixture.tolerance))
  }
  const payout = payoutsAt(settled, input.exitValue)
  for (const [id, value] of Object.entries(expected.payouts)) {
    expect(payout.byClass[id]).toBeCloseTo(value, d16Precision(fixture.tolerance))
  }
})

registerFixtureHandler('redemption', (fixture) => {
  const input = fixture.input as { capTable: unknown; yearsToExit: number; exitValue: number }
  const expected = fixture.expect as {
    redemptionClaim: number
    preferenceClaim: number
    payouts: Record<string, number>
  }
  const settled = accrueForExit(CapTableSchema.parse(input.capTable), input.yearsToExit)
  const preferred = settled.classes.find((cls) => cls.kind === 'PREFERRED')!
  if (preferred.kind === 'PREFERRED') {
    expect(preferred.redemptionClaim).toBeCloseTo(expected.redemptionClaim, d16Precision(fixture.tolerance))
    expect(preferenceClaim(preferred)).toBeCloseTo(expected.preferenceClaim, d16Precision(fixture.tolerance))
  }
  const payout = payoutsAt(settled, input.exitValue)
  for (const [id, value] of Object.entries(expected.payouts)) {
    expect(payout.byClass[id]).toBeCloseTo(value, d16Precision(fixture.tolerance))
  }
})

registerFixtureHandler('paytoplay', (fixture) => {
  const input = fixture.input as { capTable: unknown; safes: unknown[]; terms: unknown }
  const expected = fixture.expect as {
    classKinds: Record<string, string>
    classShares: Record<string, number>
  }
  const result = constructRound(
    CapTableSchema.parse(input.capTable),
    input.safes.map((safe) => SafeSchema.parse(safe)),
    RoundTermsSchema.parse(input.terms),
  )
  for (const [id, kind] of Object.entries(expected.classKinds)) {
    const cls = result.post.classes.find((candidate) => candidate.id === id)
    expect(cls?.kind).toBe(kind)
  }
  for (const [id, shares] of Object.entries(expected.classShares)) {
    const cls = result.post.classes.find((candidate) => candidate.id === id)
    expect(cls?.shares).toBeCloseTo(shares, d16Precision(fixture.tolerance))
  }
})

registerFixtureHandler('mfn', (fixture) => {
  const input = fixture.input as { safes: unknown[] }
  const expected = fixture.expect as { safes: Record<string, { valuationCap?: number; discount?: number }> }
  const rewritten = applyMfn(input.safes.map((safe) => SafeSchema.parse(safe)))
  for (const [id, values] of Object.entries(expected.safes)) {
    const safe = rewritten.find((candidate) => candidate.id === id)!
    if (values.valuationCap !== undefined) expect(safe.valuationCap).toBeCloseTo(values.valuationCap, d16Precision(fixture.tolerance))
    if (values.discount !== undefined) expect(safe.discount).toBeCloseTo(values.discount, d16Precision(fixture.tolerance))
  }
})

registerFixtureHandler('secondary', (fixture) => {
  const input = fixture.input as { capTable: unknown; sale: unknown }
  const expected = fixture.expect as {
    proceeds: number
    classShares: Record<string, number>
    totalShares: number
  }
  const result = applySecondary(CapTableSchema.parse(input.capTable), SecondarySaleSchema.parse(input.sale))
  expect(result.proceeds).toBeCloseTo(expected.proceeds, d16Precision(fixture.tolerance))
  for (const [id, shares] of Object.entries(expected.classShares)) {
    const cls = result.post.classes.find((candidate) => candidate.id === id)
    expect(cls?.shares).toBeCloseTo(shares, d16Precision(fixture.tolerance))
  }
  const total = result.post.classes.reduce((sum, cls) => sum + cls.shares, 0)
  expect(total).toBeCloseTo(expected.totalShares, d16Precision(fixture.tolerance))
})

registerFixtureHandler('discount', (fixture) => {
  const input = fixture.input as { discounting: unknown; amount: number }
  const expected = fixture.expect as { factor: number; presentValue: number; undiscountedFactor: number }
  const discounting = DiscountingSchema.parse(input.discounting)
  expect(discountFactor(discounting)).toBeCloseTo(expected.factor, 12)
  expect(presentValue(input.amount, discounting)).toBeCloseTo(expected.presentValue, d16Precision(fixture.tolerance))
  expect(discountFactor(null)).toBeCloseTo(expected.undiscountedFactor, 12)
})

registerFixtureHandler('bargain-n', (fixture) => {
  const input = fixture.input as {
    parties: string[]
    disagreement: Record<string, number>
    points: { index: number; utilities: Record<string, number> }[]
  }
  const expected = fixture.expect as {
    nash?: number | null
    utilitarian?: number | null
    egalitarian?: number | null
    zopa?: boolean
  }
  const points = input.points.map((point) => ({
    pkg: {
      index: point.index,
      terms: RoundTermsSchema.parse({
        preMoney: 1,
        investment: 1,
        poolTargetPost: 0,
        prefMultiple: 1,
        participation: 'NONE',
        seniority: 'PARI',
      }),
    },
    utilities: point.utilities,
    metric: 'EV' as const,
    diagnostics: { pps: 1, investorPct: 0.5, poolIncrease: 0 },
  }))
  const result = analyzeN(points, input.disagreement, input.parties)
  if (expected.nash !== undefined) expect(result.nash).toBe(expected.nash)
  if (expected.utilitarian !== undefined) expect(result.utilitarian).toBe(expected.utilitarian)
  if (expected.egalitarian !== undefined) expect(result.egalitarian).toBe(expected.egalitarian)
  if (expected.zopa !== undefined) expect(result.zopa).toBe(expected.zopa)
})

registerFixtureHandler('fairvalue', (fixture) => {
  const input = fixture.input as { preferredPps: number; percentOfPreferred: number }
  const expected = fixture.expect as { fairValuePerShare: number; method: string }
  const result = estimate409A(input.preferredPps, input.percentOfPreferred)
  expect(result.fairValuePerShare).toBeCloseTo(expected.fairValuePerShare, d16Precision(fixture.tolerance))
  expect(result.method).toBe(expected.method)
})

registerFixtureHandler('warrant', (fixture) => {
  const input = fixture.input as { capTable: unknown; exitValue: number }
  const expected = fixture.expect as { payouts: Record<string, number>; strikeCashPaid?: number }
  const result = payoutsAt(CapTableSchema.parse(input.capTable), input.exitValue)
  const values = { ...result.byClass, ...result.byGrant }
  for (const [id, value] of Object.entries(expected.payouts)) {
    expect(values[id]).toBeCloseTo(value, d16Precision(fixture.tolerance))
  }
  if (expected.strikeCashPaid !== undefined) {
    expect(result.strikeCashPaid).toBeCloseTo(expected.strikeCashPaid, d16Precision(fixture.tolerance))
  }
})
