import { useMemo, useState } from 'react'
import { dollars, percent } from '../components/format'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { beliefTornado, tornadoSummary, type TornadoHeadline } from '../../core/belief-tornado'
import { bestContingentTerm, decomposeDisagreement, defaultThresholds } from '../../core/contingent'
import { exchangeRateTable } from '../../core/exchange-rate'
import { defaultBranches, evaluateShadow } from '../../core/next-round'
import { useDealStore } from '../state/store'
import type { TermPackage } from '../../core/schema'

const HEADLINES: Array<{ id: TornadoHeadline; label: string }> = [
  { id: 'founderEv', label: 'Your expected dollars' },
  { id: 'investorEv', label: "The investor's expected dollars" },
  { id: 'valueOnTable', label: 'Value left on the table' },
  { id: 'nashFounderEv', label: 'Nash point — your side' },
]

function signed(value: number): string {
  if (Math.abs(value) < 1) return dollars(0)
  return `${value > 0 ? '+' : '−'}${dollars(Math.abs(value))}`
}

/**
 * Leverage: the four readouts that answer "what do I say in the room", rather than "which
 * package". Prices per term, the belief carrying the answer, the bet worth proposing, and what
 * today's terms are worth once a next round exists.
 */
export function LeverageScreen() {
  const deal = useDealStore((state) => state.deal)
  const [headline, setHeadline] = useState<TornadoHeadline>('founderEv')
  const [ratchetPoints, setRatchetPoints] = useState(0.03)
  // The tornado re-prices the whole deal space once per belief probe — seventeen passes over
  // the grid, by a distance the most expensive thing the product can do. So it runs when it is
  // asked for rather than on arrival, and the request is bound to the exact deal and read-out it
  // was made for. Editing the deal or switching the read-out retires it and asks again, which is
  // what keeps a dropdown from quietly starting the whole run a second time.
  const [tornadoRequest, setTornadoRequest] = useState<{
    deal: typeof deal
    headline: TornadoHeadline
  } | null>(null)
  const tornadoRequested = tornadoRequest?.deal === deal && tornadoRequest?.headline === headline

  const pinned: TermPackage = useMemo(() => ({ index: 0, terms: deal.terms }), [deal.terms])

  const table = useMemo(() => {
    try {
      return exchangeRateTable({
        pre: deal.pre,
        safes: deal.safes,
        terms: deal.terms,
        founderBeliefs: deal.founderBeliefs,
        investorBeliefs: deal.investorBeliefs,
        risk: deal.risk,
        notes: deal.notes,
        discounting: deal.discounting,
        yearsToExit: deal.yearsToExit,
      })
    } catch {
      return null
    }
  }, [deal])

  const tornado = useMemo(() => {
    if (!tornadoRequested) return null
    try {
      return beliefTornado(
        {
          pre: deal.pre,
          safes: deal.safes,
          space: { ...deal.space, preMoneySteps: Math.min(deal.space.preMoneySteps, 5) },
          pinned,
          founderBeliefs: deal.founderBeliefs,
          investorBeliefs: deal.investorBeliefs,
          disagreement: deal.disagreement,
          risk: deal.risk,
          notes: deal.notes,
          discounting: deal.discounting,
          yearsToExit: deal.yearsToExit,
        },
        headline,
      )
    } catch {
      return null
    }
  }, [deal, headline, pinned, tornadoRequested])

  const contingent = useMemo(() => {
    const input = {
      pre: deal.pre,
      safes: deal.safes,
      pkg: pinned,
      founderBeliefs: deal.founderBeliefs,
      investorBeliefs: deal.investorBeliefs,
      risk: deal.risk,
      notes: deal.notes,
      discounting: deal.discounting,
      yearsToExit: deal.yearsToExit,
    }
    try {
      const split = decomposeDisagreement(input)
      const thresholds = defaultThresholds(deal.founderBeliefs, deal.investorBeliefs)
      return { split, best: bestContingentTerm(input, thresholds, ratchetPoints) }
    } catch {
      return null
    }
  }, [deal, pinned, ratchetPoints])

  const shadow = useMemo(() => {
    try {
      const postMoney = (deal.terms.preMoney ?? 0) + deal.terms.investment
      return evaluateShadow({
        pre: deal.pre,
        safes: deal.safes,
        pkg: pinned,
        branches: defaultBranches(deal.terms, postMoney),
        founderBeliefs: deal.founderBeliefs,
        investorBeliefs: deal.investorBeliefs,
        risk: deal.risk,
        notes: deal.notes,
        discounting: deal.discounting,
        yearsToExit: deal.yearsToExit,
      })
    } catch {
      return null
    }
  }, [deal, pinned])

  return (
    <section className="screen" aria-labelledby="leverage-title">
      <header>
        <h2 id="leverage-title">Leverage</h2>
        <p className="screen-lede">
          The frontier answers which package. These answer what to say about it: what each term
          costs, which belief is carrying the number, what is worth betting on, and what
          today&rsquo;s terms are actually worth once there is a next round.
        </p>
      </header>

      <article className="panel">
        <h3>Exchange rates</h3>
        <p className="panel-lede">
          One term at a time, priced in expected dollars for both sides. The trade column solves for
          the pre-money that undoes a concession, and says whether the investor is still ahead at
          that price — which is when a swap creates value rather than moving it.
        </p>
        {table === null ? (
          <p className="empty">This round does not construct; fix it on Round first.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>You</th>
                  <th>Them</th>
                  <th>Joint</th>
                  <th>Trade it for</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={`${row.term}:${row.step}`}>
                    <th scope="row">{row.step}</th>
                    {row.infeasible === null ? (
                      <>
                        <td>{signed(row.deltaFounder)}</td>
                        <td>{signed(row.deltaInvestor)}</td>
                        <td>{signed(row.deltaJoint)}</td>
                        <td>
                          {row.trade === null
                            ? '—'
                            : `+${dollars(row.trade.preMoneyDelta)} pre-money${
                                row.trade.investorStillAhead
                                  ? ` — and they are still ${dollars(row.trade.deltaInvestorAfterTrade)} ahead`
                                  : ' — but that leaves them behind'
                              }`}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4}>{row.infeasible}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="panel">
        <h3>Which belief is carrying this?</h3>
        <label>
          <span>Read-out</span>
          <select
            value={headline}
            onChange={(event) => setHeadline(event.target.value as TornadoHeadline)}
          >
            {HEADLINES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {!tornadoRequested ? (
          <>
            <p className="panel-lede">
              Ranking the beliefs re-prices the deal space once for each end of each belief, so it
              is the slowest read-out here and it runs on request. The answer is the diligence
              question worth asking first.
            </p>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setTornadoRequest({ deal, headline })}
            >
              Rank the beliefs
            </button>
          </>
        ) : tornado === null ? (
          <p className="empty">The deal space does not analyse; fix it on Frontier first.</p>
        ) : (
          <>
            <p className="panel-lede">{tornadoSummary(tornado)}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Belief</th>
                    <th>Low</th>
                    <th>High</th>
                    <th>Swing</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tornado.bars]
                    .sort((left, right) => right.swing - left.swing)
                    .map((bar) => (
                      <tr key={`${bar.party}:${bar.field}`}>
                        <th scope="row">
                          {bar.party === 'founder' ? 'Your' : 'Their'} {bar.field}
                        </th>
                        {bar.incoherent === null ? (
                          <>
                            <td>{bar.lowValue === null ? '—' : dollars(bar.lowValue)}</td>
                            <td>{bar.highValue === null ? '—' : dollars(bar.highValue)}</td>
                            <td>{dollars(bar.swing)}</td>
                          </>
                        ) : (
                          <td colSpan={3}>{bar.incoherent}</td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>

      <article className="panel">
        <h3>What the disagreement is worth</h3>
        {contingent === null ? (
          <p className="empty">This package does not evaluate.</p>
        ) : (
          <>
            <dl className="stat-grid">
              <div>
                <dt>You value your claim above their read of it by</dt>
                <dd>{signed(contingent.split.founderBeliefGap)}</dd>
              </div>
              <div>
                <dt>They value theirs above your read of it by</dt>
                <dd>{signed(contingent.split.investorBeliefGap)}</dd>
              </div>
              <div>
                <dt>Risk premium you are paying</dt>
                <dd>{dollars(contingent.split.founderRiskPremium)}</dd>
              </div>
              <div>
                <dt>Risk premium they are paying</dt>
                <dd>{dollars(contingent.split.investorRiskPremium)}</dd>
              </div>
            </dl>
            <label>
              <span>Ratchet size (points of the company)</span>
              <input
                type="range"
                min={0.005}
                max={0.1}
                step={0.005}
                value={ratchetPoints}
                onChange={(event) => setRatchetPoints(Number(event.target.value))}
              />
              <span>{percent(ratchetPoints)}</span>
            </label>
            {contingent.best === null ? (
              <p className="panel-lede">
                {contingent.split.beliefsAgree
                  ? 'You and the investor hold the same beliefs, so there is nothing here to bet on. A contingent term would move money without creating any.'
                  : 'No milestone among the two sides’ own medians and upper quantiles creates joint value at this ratchet size. The disagreement is real but it does not point in a direction a ratchet can exploit.'}
              </p>
            ) : (
              <p className="panel-lede">
                <strong>
                  A {percent(contingent.best.ratchet.ratchetPoints)} ratchet at{' '}
                  {dollars(contingent.best.ratchet.threshold)}
                </strong>{' '}
                is worth {dollars(contingent.best.founderValue)} to you and costs them{' '}
                {dollars(contingent.best.investorCost)} — {dollars(contingent.best.jointValue)} of
                value created out of nothing but the gap between your beliefs.{' '}
                {contingent.best.verdict}
              </p>
            )}
          </>
        )}
      </article>

      <article className="panel">
        <h3>The next round&rsquo;s shadow</h3>
        <p className="panel-lede">
          Several of the terms on this sheet are worth nothing in a one-round model — anti-dilution
          cannot bite unless a later round prices lower, and seniority has nothing to sit above.
          These three branches put a next round behind today&rsquo;s, and the expected dollars below
          are weighted across them.
        </p>
        {shadow === null ? (
          <p className="empty">This round does not construct.</p>
        ) : (
          <>
            <dl className="stat-grid">
              <div>
                <dt>Your expected dollars, this round only</dt>
                <dd>{dollars(shadow.singleRound.uF)}</dd>
              </div>
              <div>
                <dt>Through the next round</dt>
                <dd>{shadow.point === null ? 'Unavailable' : dollars(shadow.point.uF)}</dd>
              </div>
              <div>
                <dt>Theirs, this round only</dt>
                <dd>{dollars(shadow.singleRound.uI)}</dd>
              </div>
              <div>
                <dt>Through the next round</dt>
                <dd>{shadow.point === null ? 'Unavailable' : dollars(shadow.point.uI)}</dd>
              </div>
            </dl>
            {shadow.point === null ? (
              <p className="panel-lede">
                Branch-weighted totals are unavailable until every branch constructs.
              </p>
            ) : null}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Weight</th>
                    <th>You</th>
                    <th>Them</th>
                    <th>Their ownership</th>
                    <th>Pro-rata</th>
                  </tr>
                </thead>
                <tbody>
                  {shadow.branches.map((branch) => (
                    <tr key={branch.branchId}>
                      <th scope="row">{branch.label}</th>
                      <td>{percent(branch.probability)}</td>
                      {branch.failed === null ? (
                        <>
                          <td>{dollars(branch.founderValue)}</td>
                          <td>{dollars(branch.investorValue)}</td>
                          <td>
                            {percent(branch.investorOwnershipBefore)} →{' '}
                            {percent(branch.investorOwnershipAfter)}
                          </td>
                          <td>
                            {branch.proRataInvestment > 0
                              ? dollars(branch.proRataInvestment)
                              : 'declined'}
                          </td>
                        </>
                      ) : (
                        <td colSpan={4}>{branch.failed}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shadow.normalised ? (
              <p className="panel-lede">
                The branch probabilities did not sum to one and were rescaled to do so.
              </p>
            ) : null}
          </>
        )}
      </article>

      <ExplainDrawer screen="leverage" />
    </section>
  )
}
