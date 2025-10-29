import { accruedInterest } from './accruals'
import type { ConvertibleNote, Safe } from './schema'

/**
 * Accrued conversion amount for a convertible note (§6.15).
 * At maturity or at a qualified financing, the note converts on its accrued principal.
 * Interest compounds annually when interestKind = COMPOUND; otherwise simple.
 */
export function noteAccruedAmount(note: ConvertibleNote): number {
  return note.principal + accruedInterest(note.principal, note.interestRate, note.accrualYears, note.interestKind)
}

/**
 * Project a convertible note into a pre-money SAFE-shaped instrument whose `amount`
 * is the accrued principal. Cap/discount routes then follow §6.2.1 pre-money SAFE math.
 */
export function noteAsPreMoneySafe(note: ConvertibleNote): Safe {
  return {
    id: note.id,
    name: note.name,
    amount: noteAccruedAmount(note),
    kind: 'PRE_MONEY',
    valuationCap: note.valuationCap,
    discount: note.discount,
    holder: note.holder,
    mfn: false,
  }
}
