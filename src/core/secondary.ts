import type { CapTable, SecondarySale, ShareClass } from './schema'

/**
 * Apply a secondary share sale (§6.17).
 * Cash goes to the seller, not the company. Company capitalization is unchanged in total
 * shares; ownership attribution moves from seller to buyer.
 *
 * If `buyerClassId` is omitted, a new COMMON class is created for the buyer.
 * Throws if the seller class lacks sufficient shares.
 */
export function applySecondary(pre: CapTable, sale: SecondarySale): { post: CapTable; proceeds: number } {
  const seller = pre.classes.find((cls) => cls.id === sale.sellerClassId)
  if (seller === undefined) throw new Error(`Unknown seller class '${sale.sellerClassId}'`)
  if (seller.shares + 1e-12 < sale.shares) throw new Error(`Seller '${sale.sellerClassId}' lacks ${sale.shares} shares`)

  const proceeds = sale.shares * sale.pricePerShare
  const classes: ShareClass[] = []
  let buyerFound = false
  for (const cls of pre.classes) {
    if (cls.id === sale.sellerClassId) {
      const remaining = cls.shares - sale.shares
      if (remaining > 1e-12) classes.push({ ...cls, shares: remaining })
      continue
    }
    if (sale.buyerClassId !== undefined && cls.id === sale.buyerClassId) {
      if (cls.kind !== 'COMMON') throw new Error('Secondary buyer class must be COMMON')
      classes.push({ ...cls, shares: cls.shares + sale.shares, holder: sale.buyerHolder })
      buyerFound = true
      continue
    }
    classes.push(cls)
  }
  if (sale.buyerClassId === undefined) {
    classes.push({
      id: `secondary-${sale.id}`,
      name: `Secondary ${sale.id}`,
      kind: 'COMMON',
      shares: sale.shares,
      holder: sale.buyerHolder,
    })
  } else if (!buyerFound) {
    classes.push({
      id: sale.buyerClassId,
      name: `Secondary ${sale.id}`,
      kind: 'COMMON',
      shares: sale.shares,
      holder: sale.buyerHolder,
    })
  }
  return {
    post: { ...pre, classes },
    proceeds,
  }
}
