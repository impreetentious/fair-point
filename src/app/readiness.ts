import { fitLognormal } from '../core/distributions'
import { analyze, enumerateDeals, evaluatePackage } from '../core/bargain'
import { regimes } from '../core/breakpoints'
import { accrueForExit } from '../core/accruals'
import { constructRound } from '../core/round'
import { exchangeRateTable } from '../core/exchange-rate'
import { decomposeDisagreement } from '../core/contingent'
import { defaultBranches, evaluateShadow } from '../core/next-round'
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
      const allRegimes = regimes(accrueForExit(post.post, deal.yearsToExit))
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
        deal.yearsToExit,
      ),
    )
    analyze(points, deal.disagreement)
    frontier = green('Frontier ready: ZOPA state is known.')
  } catch (error) {
    frontier = red(error instanceof Error ? error.message : 'Frontier analysis failed.')
  }

  let leverage = red('Leverage waits for a frontier it can price against.')
  if (frontier.state === 'green') {
    const pkg = { index: 0, terms: deal.terms }
    const common = {
      pre: deal.pre,
      safes: deal.safes,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
      notes: deal.notes,
      discounting: deal.discounting,
      yearsToExit: deal.yearsToExit,
    }
    try {
      exchangeRateTable({ ...common, terms: deal.terms })
      decomposeDisagreement({ ...common, pkg })
      const postMoney = (deal.terms.preMoney ?? 0) + deal.terms.investment
      const shadow = evaluateShadow({
        ...common,
        pkg,
        branches: defaultBranches(deal.terms, postMoney),
      })
      leverage =
        shadow.point === null
          ? red('Leverage needs every default next-round branch to construct.')
          : green('Leverage ready: term prices, disagreement split, and next-round shadow run.')
    } catch (error) {
      leverage = red(error instanceof Error ? error.message : 'Leverage analysis failed.')
    }
  }

  const prior = [cap, round, waterfall, beliefs, frontier, leverage]
  const report = prior.every((item) => item.state === 'green')
    ? green('Report ready: all prior screens are green.')
    : red('Report waits for every prior screen to be green.')

  return { 'cap-table': cap, round, waterfall, beliefs, frontier, leverage, report }
}
