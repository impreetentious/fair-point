import type { Discounting } from './schema'

/**
 * Present-value discount factor (§6.18). Opt-in only — the default reading of every
 * fixture and UI surface remains undiscounted exit proceeds.
 *
 * Discrete annual compounding: DF = 1 / (1 + annualRate)^yearsToExit.
 * annualRate = 0 or yearsToExit = 0 ⇒ DF = 1.
 */
export function discountFactor(discounting: Discounting | null | undefined): number {
  if (discounting === null || discounting === undefined) return 1
  if (discounting.annualRate <= 0 || discounting.yearsToExit <= 0) return 1
  return 1 / Math.pow(1 + discounting.annualRate, discounting.yearsToExit)
}

/** Apply the opt-in discount factor to a dollar amount. */
export function presentValue(amount: number, discounting: Discounting | null | undefined): number {
  return amount * discountFactor(discounting)
}
