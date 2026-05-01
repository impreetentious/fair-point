import { z } from 'zod'

export const EPS_DECISION = 1e-6

const finite = z.number().finite()
const positive = finite.positive()
const nonNegative = finite.nonnegative()
const holder = z.enum(['FOUNDER', 'INVESTOR', 'OTHER'])

const CommonClassInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('COMMON'),
    shares: positive,
    holder,
  })
  .strict()

const PreferredClassInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('PREFERRED'),
    shares: positive,
    holder,
    invested: positive,
    originalIssuePrice: positive.optional(),
    prefMultiple: finite.min(1),
    participation: z.enum(['NONE', 'FULL', 'CAPPED']),
    participationCapMultiple: positive.optional(),
    seniorityTier: finite.int().min(1).optional(),
    conversionRatio: positive.optional(),
    antiDilution: z.enum(['NONE', 'BWA', 'FULL_RATCHET']).optional(),
    /** Annual dividend rate as a decimal (0.08 = 8%). Default none. §6.13 */
    dividendRate: nonNegative.optional(),
    dividendKind: z.enum(['NONE', 'SIMPLE', 'CUMULATIVE']).optional(),
    /** Pay-to-play: non-participating preferred convert to common on a down round. §6.12 */
    payToPlay: z.enum(['NONE', 'TO_COMMON']).optional(),
    /** Redemption right: multiple of invested, eligible after eligibleYears. §6.14 */
    redemptionMultiple: positive.optional(),
    redemptionEligibleYears: nonNegative.optional(),
    /** Settlement accruals — set by accrueForExit, not authored in deal files. */
    accruedDividends: nonNegative.optional(),
    redemptionClaim: nonNegative.optional(),
  })
  .strict()

const ShareClassInputSchema = z.discriminatedUnion('kind', [
  CommonClassInputSchema,
  PreferredClassInputSchema,
])

type ShareClassInput = z.output<typeof ShareClassInputSchema>

function checkPreferredClass(
  cls: ShareClassInput,
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  if (cls.kind !== 'PREFERRED') return
  if (cls.participation === 'CAPPED' && cls.participationCapMultiple === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'participationCapMultiple'],
      message: 'V1: participationCapMultiple required for CAPPED participation',
    })
  }
  if (
    cls.participation === 'CAPPED' &&
    cls.participationCapMultiple !== undefined &&
    cls.participationCapMultiple <= cls.prefMultiple
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'participationCapMultiple'],
      message: 'V1: participationCapMultiple must exceed prefMultiple',
    })
  }
  if (cls.participation !== 'CAPPED' && cls.participationCapMultiple !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'participationCapMultiple'],
      message: 'V1: participationCapMultiple is allowed only for CAPPED participation',
    })
  }
  if (cls.originalIssuePrice !== undefined) {
    const implied = cls.invested / cls.shares
    const tolerance = 1e-6 * Math.max(1, Math.abs(cls.originalIssuePrice))
    if (Math.abs(cls.originalIssuePrice - implied) > tolerance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'originalIssuePrice'],
        message: 'V11: OIP inconsistent with invested/shares',
      })
    }
  }
}

const CapTableInputSchema = z
  .object({
    classes: z.array(ShareClassInputSchema).min(1),
    grants: z
      .array(
        z
          .object({
            id: z.string().min(1),
            options: positive,
            strike: nonNegative,
            holder: z.enum(['FOUNDER', 'OTHER']),
            /** Warrants settle identically to options (cash-exercise treasury method). §6.11 */
            instrument: z.enum(['OPTION', 'WARRANT']).default('OPTION'),
          })
          .strict(),
      )
      .default([]),
    poolAvailable: nonNegative,
    promisedOptions: nonNegative.default(0),
  })
  .strict()
  .superRefine((table, ctx) => {
    const ids = new Set<string>()
    for (let index = 0; index < table.classes.length; index += 1) {
      const cls = table.classes[index]
      checkPreferredClass(cls, ctx, ['classes', index])
      if (ids.has(cls.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['classes', index, 'id'],
          message: `V9: duplicate id '${cls.id}'`,
        })
      }
      ids.add(cls.id)
    }
    for (let index = 0; index < table.grants.length; index += 1) {
      const grant = table.grants[index]
      if (ids.has(grant.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['grants', index, 'id'],
          message: `V9: duplicate id '${grant.id}'`,
        })
      }
      ids.add(grant.id)
    }
    if (!table.classes.some((cls) => cls.kind === 'COMMON' && cls.shares > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['classes'],
        message: 'V10: at least one COMMON class with shares is required',
      })
    }
  })
  .transform((table) => ({
    ...table,
    classes: table.classes.map((cls) =>
      cls.kind === 'PREFERRED'
        ? {
            ...cls,
            originalIssuePrice: cls.originalIssuePrice ?? cls.invested / cls.shares,
            seniorityTier: cls.seniorityTier ?? 1,
            conversionRatio: cls.conversionRatio ?? 1,
            antiDilution: cls.antiDilution ?? 'NONE',
            dividendRate: cls.dividendRate ?? 0,
            dividendKind: cls.dividendKind ?? 'NONE',
            payToPlay: cls.payToPlay ?? 'NONE',
            accruedDividends: cls.accruedDividends ?? 0,
            redemptionClaim: cls.redemptionClaim ?? 0,
          }
        : cls,
    ),
  }))

export const CapTableSchema = CapTableInputSchema
export type CapTable = z.output<typeof CapTableSchema>
export type ShareClass = CapTable['classes'][number]
export type ShareClassCommon = Extract<ShareClass, { kind: 'COMMON' }>
export type ShareClassPreferred = Extract<ShareClass, { kind: 'PREFERRED' }>
export type OptionGrant = CapTable['grants'][number]

const SafeInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    amount: positive,
    kind: z.enum(['PRE_MONEY', 'POST_MONEY']),
    valuationCap: positive.optional(),
    discount: finite.gt(0).lt(1).optional(),
    holder: z.enum(['INVESTOR', 'OTHER']).default('OTHER'),
    count: finite.int().min(1).default(1),
    /** Most-favored-nation: adopt the best peer SAFE terms before conversion. §6.16 */
    mfn: z.boolean().default(false),
  })
  .strict()
  .superRefine((safe, ctx) => {
    if (safe.valuationCap === undefined && safe.discount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valuationCap'],
        message: 'V14: a SAFE requires a valuationCap or discount',
      })
    }
  })

export const SafeSchema = SafeInputSchema
export type Safe = z.output<typeof SafeSchema>

/** Convertible note — distinct from SAFEs: principal accrues interest to an amount that then converts. §6.15 */
export const ConvertibleNoteSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    principal: positive,
    interestRate: nonNegative,
    interestKind: z.enum(['SIMPLE', 'COMPOUND']),
    accrualYears: nonNegative,
    valuationCap: positive.optional(),
    discount: finite.gt(0).lt(1).optional(),
    maturityYears: positive.optional(),
    holder: z.enum(['INVESTOR', 'OTHER']).default('OTHER'),
  })
  .strict()
  .superRefine((note, ctx) => {
    if (note.valuationCap === undefined && note.discount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valuationCap'],
        message: 'V17: a convertible note requires a valuationCap or discount',
      })
    }
  })
export type ConvertibleNote = z.output<typeof ConvertibleNoteSchema>

/** Secondary share sale — cash to the seller, not the company. §6.17 */
export const SecondarySaleSchema = z
  .object({
    id: z.string().min(1),
    sellerClassId: z.string().min(1),
    shares: positive,
    pricePerShare: positive,
    buyerHolder: holder,
    buyerClassId: z.string().min(1).optional(),
  })
  .strict()
export type SecondarySale = z.output<typeof SecondarySaleSchema>

export const RoundTermsSchema = z
  .object({
    preMoney: positive.optional(),
    pricedPerShare: positive.optional(),
    investment: positive,
    poolTargetPost: finite.min(0).max(0.4),
    prefMultiple: z.union([z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)]),
    participation: z.enum(['NONE', 'CAP2', 'CAP3', 'FULL']),
    seniority: z.enum(['PARI', 'SENIOR']),
    /**
     * Class ids that are meeting their pay-to-play obligation in this round.
     * Preferred with payToPlay=TO_COMMON that are NOT listed convert to common. §6.12
     */
    payToPlayParticipants: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((terms, ctx) => {
    if ((terms.preMoney === undefined) === (terms.pricedPerShare === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preMoney'],
        message: 'V12: supply exactly one of preMoney or pricedPerShare',
      })
    }
    if (
      (terms.participation === 'CAP2' && terms.prefMultiple >= 2) ||
      (terms.participation === 'CAP3' && terms.prefMultiple >= 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participation'],
        message: 'V1: this preference multiple and participation cap combination is invalid',
      })
    }
  })
export type RoundTerms = z.output<typeof RoundTermsSchema>

/** V3: the post-money option-pool target must leave at least 5% for existing holders. */
export function poolFeasible(
  terms: Pick<RoundTerms, 'preMoney' | 'investment' | 'poolTargetPost'>,
): boolean {
  if (terms.preMoney === undefined) return true
  const r = (terms.preMoney + terms.investment) / terms.preMoney
  return 1 - terms.poolTargetPost * r >= 0.05 - EPS_DECISION
}

export const BeliefsSchema = z
  .object({
    p0: finite.min(0).max(0.99),
    p10: positive.optional(),
    p50: positive,
    p90: z.number({ required_error: 'V5: p90 required' }).finite().positive(),
  })
  .strict()
  .superRefine((beliefs, ctx) => {
    if (beliefs.p50 >= beliefs.p90) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p90'],
        message: 'V5: p50 must be less than p90',
      })
    }
    if (beliefs.p10 !== undefined && !(beliefs.p10 < beliefs.p50 && beliefs.p50 < beliefs.p90)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p10'],
        message: 'V5: p10 must be less than p50, which must be less than p90',
      })
    }
  })
export type Beliefs = z.output<typeof BeliefsSchema>

const validPackagePair = (multiple: number, participation: RoundTerms['participation']) =>
  !((participation === 'CAP2' && multiple >= 2) || (participation === 'CAP3' && multiple >= 3))

const DealSpaceInputSchema = z
  .object({
    preMoneyRange: z.tuple([positive, positive]),
    preMoneySteps: finite.int().min(1),
    pinnedInvestment: positive.optional(),
    pools: z.array(finite.gt(0).max(0.4)).min(1),
    multiples: z.array(z.union([z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)])).min(1),
    participations: z.array(z.enum(['NONE', 'CAP2', 'CAP3', 'FULL'])).min(1),
    seniority: z.enum(['PARI', 'SENIOR']),
  })
  .strict()
  .superRefine((space, ctx) => {
    if (space.preMoneyRange[0] > space.preMoneyRange[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preMoneyRange'],
        message: 'V13: preMoneyRange lower bound must not exceed upper bound',
      })
    }
    if (
      !space.multiples.some((multiple) =>
        space.participations.some((p) => validPackagePair(multiple, p)),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participations'],
        message: 'V13: the deal space must contain at least one valid multiple/participation pair',
      })
    }
  })

export const DisagreementSchema = z.object({ dF: nonNegative, dI: nonNegative }).strict()
export type Disagreement = z.output<typeof DisagreementSchema>

const RiskSchema = z
  .object({
    gamma: z.union([z.literal(0.5), z.literal(1)]),
    w0F: positive,
    w0I: positive,
  })
  .strict()

const DealUiSchema = z
  .object({
    dealSpaceManual: z.boolean().default(false),
    dealSpacePins: z
      .object({
        preMoney: z.boolean().default(false),
        pools: z.boolean().default(false),
        multiples: z.boolean().default(false),
        participations: z.boolean().default(false),
        seniority: z.boolean().default(false),
      })
      .default({}),
  })
  .default({})

/** Opt-in time-discounting. Absent/null ⇒ undiscounted exit proceeds (D15 default). §6.18 */
export const DiscountingSchema = z
  .object({
    annualRate: nonNegative,
    yearsToExit: nonNegative,
  })
  .strict()
export type Discounting = z.output<typeof DiscountingSchema>

const DealFileBaseSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    name: z.string().min(1),
    pre: CapTableSchema,
    safes: z.array(SafeSchema),
    notes: z.array(ConvertibleNoteSchema).default([]),
    terms: RoundTermsSchema,
    founderBeliefs: BeliefsSchema,
    investorBeliefs: BeliefsSchema,
    sharedBeliefs: z.boolean(),
    disagreement: DisagreementSchema,
    space: DealSpaceInputSchema,
    risk: RiskSchema.nullable().optional(),
    ui: DealUiSchema,
    /** Clock used for dividend accrual, note interest, redemption eligibility, and optional IRR. */
    yearsToExit: nonNegative.default(0),
    discounting: DiscountingSchema.nullable().optional(),
  })
  .strict()
  .superRefine((deal, ctx) => {
    const postMoneySafes = deal.safes.filter((safe) => safe.kind === 'POST_MONEY')
    const fractionSum = postMoneySafes.reduce(
      (sum, safe) => sum + (safe.valuationCap === undefined ? 0 : safe.amount / safe.valuationCap),
      0,
    )
    if (fractionSum > 0.95 + EPS_DECISION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['safes'],
        message: 'V2: SAFE caps too low — conversion exceeds 95% of the company.',
      })
    }
    if (deal.terms.preMoney !== undefined) {
      const r = (deal.terms.preMoney + deal.terms.investment) / deal.terms.preMoney
      if (1 - deal.terms.poolTargetPost * r < 0.05 - EPS_DECISION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['terms', 'poolTargetPost'],
          message: 'V3: pool target is infeasible at this pre-money valuation and investment.',
        })
      }
    }
    const preferredCount = deal.pre.classes.filter((cls) => cls.kind === 'PREFERRED').length
    if (preferredCount + deal.safes.length + deal.notes.length + 1 > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pre', 'classes'],
        message: 'V7: the post-round preferred class limit is 20.',
      })
    }
  })

export const DealFileSchema = DealFileBaseSchema.transform((deal) => ({
  ...deal,
  risk: deal.risk ?? null,
  discounting: deal.discounting ?? null,
  ui: {
    dealSpaceManual: deal.ui.dealSpaceManual,
    dealSpacePins: {
      preMoney: deal.ui.dealSpacePins.preMoney ?? false,
      pools: deal.ui.dealSpacePins.pools ?? false,
      multiples: deal.ui.dealSpacePins.multiples ?? false,
      participations: deal.ui.dealSpacePins.participations ?? false,
      seniority: deal.ui.dealSpacePins.seniority ?? false,
    },
  },
  space: {
    ...deal.space,
    pinnedInvestment: deal.space.pinnedInvestment ?? deal.terms.investment,
  },
}))
export type DealFile = z.output<typeof DealFileSchema>
export type DealSpace = DealFile['space']

export type LognormalFit = { mu: number; sigma: number; warnings: string[] }

export type Payouts = {
  byClass: Record<string, number>
  byGrant: Record<string, number>
  perCommonShareProceeds: number
  strikeCashPaid: number
  pathTaken: Record<string, 'PREFERENCE' | 'PARTICIPATING' | 'CAPPED' | 'CONVERTED' | 'COMMON'>
  warnings: string[]
}

export type Regime = {
  from: number
  to: number
  event: string
  coeffs: Record<string, { m: number; c: number }>
}

export type SafeConversion = {
  newClasses: ShareClass[]
  totalSafeShares: number
  sharesBySafe: Record<string, number>
  routeBySafe: Record<string, 'CAP' | 'DISCOUNT' | 'ROUND_PRICE'>
  warnings: string[]
}

export type RoundResult = {
  post: CapTable
  diagnostics: {
    pps: number
    investorPct: number
    poolIncrease: number
    safeShares: number
    routeBySafe: Record<string, SafeConversion['routeBySafe'][string]>
    sharesBySafe: Record<string, number>
  }
  warnings: string[]
}

export type HolderStats = {
  ev: Record<string, number>
  party: { founder: number; investor: number; other: number }
}

export type HolderMcStats = { mean: Record<string, number>; se: Record<string, number> }

export type TermPackage = { index: number; terms: RoundTerms }

export type DealPoint = {
  pkg: TermPackage
  uF: number
  uI: number
  uF_underI: number
  uI_underF: number
  metric: 'EV' | 'CE'
  diagnostics: { pps: number; investorPct: number; poolIncrease: number }
}

export type BargainResult = {
  zopa: boolean
  ir: number[]
  frontier: number[]
  nash: number | null
  ks: number | null
  egalitarian: number | null
  utilitarian: number | null
  points: DealPoint[]
  metric: 'EV' | 'CE'
  notes: string[]
}

/** N-party deal point for syndicate bargaining (§6.19). Utilities keyed by party id. */
export type MultiPartyDealPoint = {
  pkg: TermPackage
  utilities: Record<string, number>
  metric: 'EV' | 'CE'
  diagnostics: { pps: number; investorPct: number; poolIncrease: number }
}

export type MultiPartyDisagreement = Record<string, number>

export type MultiPartyBargainResult = {
  parties: string[]
  zopa: boolean
  ir: number[]
  frontier: number[]
  nash: number | null
  ks: number | null
  egalitarian: number | null
  utilitarian: number | null
  points: MultiPartyDealPoint[]
  metric: 'EV' | 'CE'
  notes: string[]
}

export const FixtureSchema = z
  .object({
    id: z.string().regex(/^F-[A-Za-z0-9-]+$/),
    kind: z.enum([
      'waterfall',
      'round',
      'safe',
      'dist',
      'bargain',
      'validation',
      'employee',
      'note',
      'warrant',
      'dividend',
      'redemption',
      'paytoplay',
      'mfn',
      'secondary',
      'discount',
      'bargain-n',
      'fairvalue',
    ]),
    description: z.string().min(1),
    derivation: z.string().min(1),
    input: z.unknown(),
    expect: z.unknown(),
    tolerance: finite.positive().optional(),
  })
  .passthrough()
export type Fixture = z.output<typeof FixtureSchema>

export function humanizeZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
}
