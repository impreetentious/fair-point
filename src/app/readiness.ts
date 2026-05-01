import { fitLognormal } from '../core/distributions'
import { analyze, enumerateDeals, evaluatePackage } from '../core/bargain'
import { regimes } from '../core/breakpoints'
import { constructRound } from '../core/round'
import { CapTableSchema, RoundTermsSchema, type DealFile } from '../core/schema'
import type { ScreenId } from './state/store'

export type Readiness = { state: 'green' | 'amber' | 'red'; label: string }

function green(label: string): Readiness {
  return { state: 'green', label }
}

function amber(label: string): Readiness {
  return { state: 'amber', label }
}

function red(label: string): Readiness {
  return { state: 'red', label }
}

export function screenReadiness(deal: DealFile): Record<ScreenId, Readiness> {
  const cap = CapTableSchema.safeParse(deal.pre).success
    ? green('Cap Table ready: schema valid with common shares.')
    : red('Cap Table needs a valid class, grant, pool, and promised option record.')

  let round = red('Round needs valid priced-round terms.')
  let post: ReturnType<typeof constructRound> | null = null
  if (RoundTermsSchema.safeParse(deal.terms).success) {
    try {
      post = constructRound(deal.pre, deal.safes, deal.terms, deal.notes)
      round = green('Round ready: terms construct without hard errors.')
    } catch (error) {
      round = red(error instanceof Error ? error.message : 'Round construction failed.')
    }
  }

  let waterfall = red('Waterfall needs a valid post-round cap table.')
  if (post !== null) {
    try {
      const allRegimes = regimes(post.post)
      const hasWarnings =
        post.warnings.length > 0 ||
        allRegimes.some((regime) => regime.event.includes('unclassified'))
      waterfall = hasWarnings
        ? amber('Waterfall ready with warnings: one or more breakpoints are unclassified.')
        : green('Waterfall ready: regimes computed without warnings.')
    } catch (error) {
      waterfall = red(error instanceof Error ? error.message : 'Waterfall regimes failed.')
    }
  }

  let beliefs = green('Beliefs ready: both profiles fit cleanly.')
  try {
    const warnings = [
      ...fitLognormal(deal.founderBeliefs).warnings,
      ...fitLognormal(deal.investorBeliefs).warnings,
    ]
    if (warnings.length > 0) beliefs = amber(`Beliefs fit with warning: ${warnings[0]}`)
  } catch (error) {
    beliefs = red(error instanceof Error ? error.message : 'Belief profiles failed to fit.')
  }

  let frontier: Readiness
  try {
    const points = enumerateDeals(deal.space).map((pkg) =>
      evaluatePackage(
        deal.pre,
        deal.safes,
        pkg,
        deal.founderBeliefs,
        deal.investorBeliefs,
        deal.risk,
        deal.notes,
        deal.discounting,
      ),
    )
    analyze(points, deal.disagreement)
    frontier = green('Frontier ready: ZOPA state is known.')
  } catch (error) {
    frontier = red(error instanceof Error ? error.message : 'Frontier analysis failed.')
  }

  const prior = [cap, round, waterfall, beliefs, frontier]
  const report = prior.every((item) => item.state === 'green')
    ? green('Report ready: all prior screens are green.')
    : red('Report waits for every prior screen to be green.')

  return { 'cap-table': cap, round, waterfall, beliefs, frontier, report }
}
