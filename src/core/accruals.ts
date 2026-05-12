import type { CapTable, ShareClass, ShareClassPreferred } from './schema'

/** Simple interest: principal × rate × years. Compound (annual): principal × ((1+rate)^years − 1). */
export function accruedInterest(
  principal: number,
  rate: number,
  years: number,
  kind: 'SIMPLE' | 'COMPOUND',
): number {
  if (years <= 0 || rate <= 0) return 0
  if (kind === 'SIMPLE') return principal * rate * years
  return principal * (Math.pow(1 + rate, years) - 1)
}

function dividendAccrual(cls: ShareClassPreferred, years: number): number {
  if (cls.dividendKind === 'NONE' || (cls.dividendRate ?? 0) <= 0 || years <= 0) return 0
  if (cls.dividendKind === 'SIMPLE') return cls.invested * (cls.dividendRate ?? 0) * years
  return cls.invested * (Math.pow(1 + (cls.dividendRate ?? 0), years) - 1)
}

function redemptionClaim(cls: ShareClassPreferred, years: number): number {
  if (cls.redemptionMultiple === undefined || cls.redemptionEligibleYears === undefined) return 0
  if (years + 1e-12 < cls.redemptionEligibleYears) return 0
  return cls.redemptionMultiple * cls.invested
}

/**
 * Stamp accruedDividends and redemptionClaim onto preferred classes for a given exit clock.
 * Preference claim at settlement becomes max(prefMultiple×invested + accruedDividends, redemptionClaim).
 * See §6.13 / §6.14.
 */
export function accrueForExit(post: CapTable, yearsToExit: number): CapTable {
  if (!Number.isFinite(yearsToExit) || yearsToExit < 0) {
    throw new RangeError('yearsToExit must be finite and nonnegative')
  }
  return {
    ...post,
    classes: post.classes.map((cls: ShareClass) => {
      if (cls.kind !== 'PREFERRED') return cls
      const accruedDividends = dividendAccrual(cls, yearsToExit)
      const claim = redemptionClaim(cls, yearsToExit)
      if (!Number.isFinite(accruedDividends) || !Number.isFinite(claim)) {
        throw new RangeError(`Accrual exceeds the numeric range for class '${cls.id}'`)
      }
      return {
        ...cls,
        accruedDividends,
        redemptionClaim: claim,
      }
    }),
  }
}

/** Liquidation preference dollars for a preferred class after accruals are stamped. */
export function preferenceClaim(cls: ShareClassPreferred): number {
  const stacked = cls.prefMultiple * cls.invested + (cls.accruedDividends ?? 0)
  const claim = Math.max(stacked, cls.redemptionClaim ?? 0)
  if (!Number.isFinite(claim)) {
    throw new RangeError(`Preference claim exceeds the numeric range for class '${cls.id}'`)
  }
  return claim
}
