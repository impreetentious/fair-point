import type { Safe } from './schema'

/**
 * Apply Most-Favored-Nation clauses among SAFEs (§6.16).
 *
 * For every SAFE with `mfn: true`, adopt the peer cohort's most favorable terms before
 * the §6.2 route solve:
 * - valuationCap: the minimum defined peer cap (lower cap ⇒ more shares)
 * - discount: the maximum defined peer discount (higher discount ⇒ more shares)
 *
 * Non-MFN SAFEs are unchanged. The cohort is all converting SAFEs in the round.
 * Citation framing: YC Post-Money Safe User Guide MFN side letter practice
 * (https://www.ycombinator.com/documents, retrieved 2025-01-14) — modeled here as a
 * deterministic pre-solve rewrite, not a post-hoc true-up.
 */
export function applyMfn(safes: Safe[]): Safe[] {
  const caps = safes.map((safe) => safe.valuationCap).filter((value): value is number => value !== undefined)
  const discounts = safes.map((safe) => safe.discount).filter((value): value is number => value !== undefined)
  const bestCap = caps.length > 0 ? Math.min(...caps) : undefined
  const bestDiscount = discounts.length > 0 ? Math.max(...discounts) : undefined
  return safes.map((safe) => {
    if (!safe.mfn) return safe
    return {
      ...safe,
      valuationCap: bestCap ?? safe.valuationCap,
      discount: bestDiscount ?? safe.discount,
    }
  })
}
