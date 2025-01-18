/*
 * Deliberately naive independent settlement oracle. It does direct subset enumeration for every
 * conversion combination and a separate cap waterline; it intentionally imports no waterfall code.
 */
import type { CapTable, Payouts, ShareClassPreferred } from '../src/core/schema'

const EPS = 1e-6

function preferred(post: CapTable): ShareClassPreferred[] {
  return post.classes
    .filter((cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED')
    .sort((a, b) => a.seniorityTier - b.seniorityTier || a.id.localeCompare(b.id))
}

function rawSettlement(post: CapTable, distributable: number, exercised: Set<string>, converted: Set<string>): Payouts {
  const byClass = Object.fromEntries(post.classes.map((cls) => [cls.id, 0])) as Record<string, number>
  const byGrant = Object.fromEntries(post.grants.map((grant) => [grant.id, 0])) as Record<string, number>
  const pathTaken = Object.fromEntries(post.classes.map((cls) => [cls.id, cls.kind === 'COMMON' ? 'COMMON' : 'PREFERENCE'])) as Payouts['pathTaken']
  let remaining = distributable
  const classes = preferred(post)

  for (const tier of [...new Set(classes.map((cls) => cls.seniorityTier))]) {
    const claims = classes.filter((cls) => cls.seniorityTier === tier && !converted.has(cls.id))
    const total = claims.reduce((sum, cls) => sum + cls.prefMultiple * cls.invested, 0)
    if (total === 0) continue
    const paid = Math.min(remaining, total)
    for (const cls of claims) byClass[cls.id] += (paid * cls.prefMultiple * cls.invested) / total
    remaining -= paid
  }

  type Bucket = { id: string; units: number; class?: ShareClassPreferred }
  const buckets: Bucket[] = []
  for (const cls of post.classes) {
    if (cls.kind === 'COMMON') buckets.push({ id: cls.id, units: cls.shares })
    else if (converted.has(cls.id)) {
      buckets.push({ id: cls.id, units: cls.shares * cls.conversionRatio })
      pathTaken[cls.id] = 'CONVERTED'
    } else if (cls.participation !== 'NONE') {
      buckets.push({ id: cls.id, units: cls.shares * cls.conversionRatio, class: cls })
      pathTaken[cls.id] = cls.participation === 'FULL' ? 'PARTICIPATING' : 'CAPPED'
    }
  }
  for (const grant of post.grants) if (exercised.has(grant.id)) buckets.push({ id: grant.id, units: grant.options })

  let remainingBuckets = buckets
  while (remaining > EPS && remainingBuckets.length > 0) {
    const totalUnits = remainingBuckets.reduce((sum, bucket) => sum + bucket.units, 0)
    const provisional = remainingBuckets.map((bucket) => ({ bucket, dollars: (remaining * bucket.units) / totalUnits }))
    const caps = provisional.filter(({ bucket, dollars }) => {
      if (bucket.class?.participation !== 'CAPPED') return false
      return byClass[bucket.id] + dollars > (bucket.class.participationCapMultiple ?? Infinity) * bucket.class.invested + EPS
    })
    if (caps.length === 0) {
      for (const { bucket, dollars } of provisional) if (bucket.class !== undefined || post.classes.some((cls) => cls.id === bucket.id)) byClass[bucket.id] += dollars
      remaining = 0
    } else {
      let consumed = 0
      for (const { bucket } of caps) {
        const cap = (bucket.class!.participationCapMultiple ?? Infinity) * bucket.class!.invested
        const amount = Math.max(0, cap - byClass[bucket.id])
        byClass[bucket.id] += amount
        consumed += amount
      }
      remaining -= consumed
      const capped = new Set(caps.map(({ bucket }) => bucket.id))
      remainingBuckets = remainingBuckets.filter((bucket) => !capped.has(bucket.id))
    }
  }

  const common = post.classes.find((cls) => cls.kind === 'COMMON')!
  const perCommonShareProceeds = byClass[common.id] / common.shares
  let strikeCashPaid = 0
  for (const grant of post.grants) {
    if (!exercised.has(grant.id)) continue
    byGrant[grant.id] = Math.max(0, perCommonShareProceeds - grant.strike) * grant.options
    strikeCashPaid += grant.strike * grant.options
  }
  return { byClass, byGrant, perCommonShareProceeds, strikeCashPaid, pathTaken, warnings: [] }
}

function powerSet(ids: string[]): Set<string>[] {
  return Array.from({ length: 2 ** ids.length }, (_, mask) => new Set(ids.filter((_, index) => (mask & 2 ** index) !== 0)))
}

function selectConversions(post: CapTable, distributable: number, exercised: Set<string>): Set<string> {
  const classes = preferred(post)
  const candidates = powerSet(classes.map((cls) => cls.id))
  const consistent = candidates.filter((choice) =>
    classes.every((cls) => {
      const assigned = rawSettlement(post, distributable, exercised, choice).byClass[cls.id]
      const alternative = new Set(choice)
      if (alternative.has(cls.id)) alternative.delete(cls.id)
      else alternative.add(cls.id)
      const other = rawSettlement(post, distributable, exercised, alternative).byClass[cls.id]
      return assigned + EPS >= other
    }),
  )
  const sort = (left: Set<string>, right: Set<string>) => left.size - right.size || [...left].sort().join('|').localeCompare([...right].sort().join('|'))
  if (consistent.length > 0) return consistent.sort(sort)[0]
  return candidates
    .map((choice) => {
      const settled = rawSettlement(post, distributable, exercised, choice)
      const regret = classes.reduce((sum, cls) => {
        const alternate = new Set(choice)
        if (alternate.has(cls.id)) alternate.delete(cls.id)
        else alternate.add(cls.id)
        return sum + Math.max(0, rawSettlement(post, distributable, exercised, alternate).byClass[cls.id] - settled.byClass[cls.id])
      }, 0)
      return { choice, regret }
    })
    .sort((left, right) => left.regret - right.regret || sort(left.choice, right.choice))[0].choice
}

export function referencePayouts(post: CapTable, exitValue: number): Payouts {
  const grouped = new Map<number, string[]>()
  for (const grant of [...post.grants].sort((a, b) => a.strike - b.strike || a.id.localeCompare(b.id))) {
    grouped.set(grant.strike, [...(grouped.get(grant.strike) ?? []), grant.id])
  }
  const groups = [...grouped.entries()]
  for (let count = groups.length; count >= 0; count -= 1) {
    const exercised = new Set(groups.slice(0, count).flatMap(([, ids]) => ids))
    const strikeCash = post.grants.filter((grant) => exercised.has(grant.id)).reduce((sum, grant) => sum + grant.strike * grant.options, 0)
    const result = rawSettlement(post, exitValue + strikeCash, exercised, selectConversions(post, exitValue + strikeCash, exercised))
    const optionConsistent = post.grants.every((grant) =>
      exercised.has(grant.id) ? grant.strike < result.perCommonShareProceeds - EPS : grant.strike >= result.perCommonShareProceeds - EPS,
    )
    if (optionConsistent) return result
  }
  throw new Error('Reference settlement could not find a consistent option prefix')
}
