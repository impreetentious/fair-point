import { dollarsPrecise, percent, shares } from '../components/format'
import { CommitNumber, CommitText } from '../components/CommitField'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { useRoundAnalysis } from '../hooks/useAnalysis'
import { useDealStore } from '../state/store'
import type { RoundTerms, Safe, ShareClassPreferred } from '../../core/schema'

const multiples: RoundTerms['prefMultiple'][] = [1, 1.5, 2, 3]
const participations: RoundTerms['participation'][] = ['NONE', 'CAP2', 'CAP3', 'FULL']
const antiDilution = ['NONE', 'BWA', 'FULL_RATCHET'] as const

function newSafe(index: number): Safe {
  return {
    id: `safe-${index}`,
    name: `SAFE ${index}`,
    amount: 100_000,
    kind: 'POST_MONEY',
    valuationCap: 1_000_000,
    discount: undefined,
    holder: 'OTHER',
    count: 1,
    mfn: false,
  }
}

function fdPreByClass(deal: ReturnType<typeof useDealStore.getState>['deal']) {
  const total =
    deal.pre.classes.reduce(
      (sum, cls) =>
        sum + (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares),
      0,
    ) +
    deal.pre.grants.reduce((sum, grant) => sum + grant.options, 0) +
    deal.pre.poolAvailable +
    deal.pre.promisedOptions
  return Object.fromEntries(
    deal.pre.classes.map((cls) => [
      cls.id,
      total === 0
        ? 0
        : (cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares) / total,
    ]),
  )
}

export function RoundScreen() {
  const deal = useDealStore((state) => state.deal)
  const setTerms = useDealStore((state) => state.setTerms)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const { round, error } = useRoundAnalysis(deal)
  const terms = deal.terms
  const prePct = fdPreByClass(deal)
  const setSafe = (id: string, patch: (safe: Safe) => Safe) =>
    patchDeal((current) => ({
      ...current,
      safes: current.safes.map((safe) => (safe.id === id ? patch(safe) : safe)),
    }))
  const existingPreferred = deal.pre.classes.filter(
    (cls): cls is ShareClassPreferred => cls.kind === 'PREFERRED',
  )
  const usePreMoney = terms.preMoney !== undefined
  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Terms</p>
            <h2>Round</h2>
          </div>
          <ExplainDrawer screen="round" />
        </div>
        <div className="field-grid">
          <label>
            Pre-money valuation
            <CommitNumber
              label="Pre-money valuation"
              value={terms.preMoney}
              allowEmpty
              min={1}
              step={1000}
              onCommit={(value) =>
                setTerms({
                  ...terms,
                  preMoney: value,
                  pricedPerShare: value === undefined ? (terms.pricedPerShare ?? 1) : undefined,
                })
              }
            />
          </label>
          <label>
            Investment
            <CommitNumber
              label="Investment"
              value={terms.investment}
              min={1}
              step={1000}
              onCommit={(value) => value !== undefined && setTerms({ ...terms, investment: value })}
            />
          </label>
          <label>
            Post-round pool target
            <CommitNumber
              label="Post-round pool target"
              value={terms.poolTargetPost}
              min={0}
              max={0.4}
              step={0.001}
              decimals={3}
              onCommit={(value) =>
                value !== undefined && setTerms({ ...terms, poolTargetPost: value })
              }
            />
          </label>
        </div>
        <details className="advanced">
          <summary>Advanced direct PPS mode</summary>
          <label>
            Priced per share
            <CommitNumber
              label="Priced per share"
              value={terms.pricedPerShare}
              allowEmpty
              min={0.0001}
              step={0.0001}
              decimals={4}
              onCommit={(value) =>
                setTerms({
                  ...terms,
                  pricedPerShare: value,
                  preMoney: value === undefined ? (terms.preMoney ?? 1_000_000) : undefined,
                })
              }
            />
          </label>
          <p className="muted">
            {usePreMoney
              ? 'Pre-money mode is active; direct PPS is empty.'
              : 'Direct PPS mode is active; pre-money diagnostics are hidden and pool increase is zero.'}
          </p>
        </details>
        <fieldset>
          <legend>Preference multiple</legend>
          {multiples.map((multiple) => (
            <button
              key={multiple}
              type="button"
              className={terms.prefMultiple === multiple ? 'segmented selected' : 'segmented'}
              onClick={() =>
                setTerms({
                  ...terms,
                  prefMultiple: multiple,
                  participation:
                    terms.participation === 'CAP2' && multiple >= 2
                      ? 'NONE'
                      : terms.participation === 'CAP3' && multiple >= 3
                        ? 'NONE'
                        : terms.participation,
                })
              }
            >
              {multiple}×
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Participation</legend>
          {participations.map((participation) => {
            const disabled =
              (participation === 'CAP2' && terms.prefMultiple >= 2) ||
              (participation === 'CAP3' && terms.prefMultiple >= 3)
            return (
              <button
                key={participation}
                type="button"
                disabled={disabled}
                className={
                  terms.participation === participation ? 'segmented selected' : 'segmented'
                }
                onClick={() => setTerms({ ...terms, participation })}
              >
                {participation}
              </button>
            )
          })}
        </fieldset>
        <fieldset>
          <legend>Seniority</legend>
          {(['PARI', 'SENIOR'] as const).map((seniority) => (
            <button
              key={seniority}
              type="button"
              className={terms.seniority === seniority ? 'segmented selected' : 'segmented'}
              onClick={() => setTerms({ ...terms, seniority })}
            >
              {seniority === 'PARI'
                ? 'PARI (join most junior existing preferred tier)'
                : 'SENIOR (new tier 1)'}
            </button>
          ))}
        </fieldset>

        <div className="section-heading">
          <h3>Existing preferred anti-dilution</h3>
        </div>
        {existingPreferred.length === 0 ? (
          <p className="muted">No existing preferred classes.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Anti-dilution</th>
                </tr>
              </thead>
              <tbody>
                {existingPreferred.map((cls) => (
                  <tr key={cls.id}>
                    <td>{cls.name}</td>
                    <td>
                      <select
                        aria-label={`${cls.name} anti-dilution`}
                        value={cls.antiDilution}
                        onChange={(event) =>
                          patchDeal((current) => ({
                            ...current,
                            pre: {
                              ...current.pre,
                              classes: current.pre.classes.map((candidate) =>
                                candidate.id === cls.id && candidate.kind === 'PREFERRED'
                                  ? {
                                      ...candidate,
                                      antiDilution: event.target
                                        .value as ShareClassPreferred['antiDilution'],
                                    }
                                  : candidate,
                              ),
                            },
                          }))
                        }
                      >
                        {antiDilution.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="section-heading">
          <h3>SAFEs</h3>
          <button
            type="button"
            className="quiet-button"
            onClick={() =>
              patchDeal((current) => ({
                ...current,
                safes: [...current.safes, newSafe(current.safes.length + 1)],
              }))
            }
          >
            Add SAFE
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Form</th>
                <th>Amount</th>
                <th>Cap</th>
                <th>Discount</th>
                <th>Holder</th>
                <th>Count</th>
                <th>MFN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deal.safes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No SAFEs in this deal.
                  </td>
                </tr>
              ) : (
                deal.safes.map((safe) => (
                  <tr key={safe.id}>
                    <td>
                      <CommitText
                        label={`${safe.name} name`}
                        value={safe.name}
                        onCommit={(name) =>
                          setSafe(safe.id, (candidate) => ({ ...candidate, name }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${safe.name} kind`}
                        value={safe.kind}
                        onChange={(event) =>
                          setSafe(safe.id, (candidate) => ({
                            ...candidate,
                            kind: event.target.value as Safe['kind'],
                          }))
                        }
                      >
                        <option>PRE_MONEY</option>
                        <option>POST_MONEY</option>
                      </select>
                    </td>
                    <td>
                      <CommitNumber
                        label={`${safe.name} amount`}
                        value={safe.amount}
                        min={1}
                        step={1000}
                        onCommit={(value) =>
                          value !== undefined &&
                          setSafe(safe.id, (candidate) => ({ ...candidate, amount: value }))
                        }
                      />
                    </td>
                    <td>
                      <CommitNumber
                        label={`${safe.name} valuation cap`}
                        value={safe.valuationCap}
                        allowEmpty
                        min={1}
                        step={1000}
                        onCommit={(value) =>
                          setSafe(safe.id, (candidate) => ({ ...candidate, valuationCap: value }))
                        }
                      />
                    </td>
                    <td>
                      <CommitNumber
                        label={`${safe.name} discount`}
                        value={safe.discount}
                        allowEmpty
                        min={0.001}
                        max={0.999}
                        step={0.01}
                        decimals={3}
                        onCommit={(value) =>
                          setSafe(safe.id, (candidate) => ({ ...candidate, discount: value }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${safe.name} holder`}
                        value={safe.holder}
                        onChange={(event) =>
                          setSafe(safe.id, (candidate) => ({
                            ...candidate,
                            holder: event.target.value as Safe['holder'],
                          }))
                        }
                      >
                        <option>INVESTOR</option>
                        <option>OTHER</option>
                      </select>
                    </td>
                    <td>
                      <CommitNumber
                        label={`${safe.name} provenance count`}
                        value={safe.count}
                        min={1}
                        step={1}
                        onCommit={(value) =>
                          value !== undefined &&
                          setSafe(safe.id, (candidate) => ({
                            ...candidate,
                            count: Math.round(value),
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${safe.name} MFN`}
                        type="checkbox"
                        checked={safe.mfn}
                        onChange={(event) =>
                          setSafe(safe.id, (candidate) => ({
                            ...candidate,
                            mfn: event.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() =>
                          patchDeal((current) => ({
                            ...current,
                            safes: current.safes.filter((candidate) => candidate.id !== safe.id),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="side-panel">
        <h3>Live diagnostics</h3>
        {error !== null ? (
          <p className="validation invalid">{error}</p>
        ) : (
          round !== null && (
            <>
              <dl className="metric-list">
                <dt>Price per share</dt>
                <dd>{dollarsPrecise(round.diagnostics.pps)}</dd>
                <dt>Investor ownership</dt>
                <dd>{percent(round.diagnostics.investorPct)}</dd>
                <dt>New pool shares</dt>
                <dd>{shares(round.diagnostics.poolIncrease)}</dd>
                <dt>SAFE shares</dt>
                <dd>{shares(round.diagnostics.safeShares)}</dd>
              </dl>
              <h4>SAFE conversion routes</h4>
              <ul className="plain-list">
                {deal.safes.length === 0 ? (
                  <li>No converting SAFEs.</li>
                ) : (
                  deal.safes.map((safe) => (
                    <li key={safe.id}>
                      {safe.name} ({safe.count}×): {round.diagnostics.routeBySafe[safe.id] ?? '—'} ·{' '}
                      {shares(round.diagnostics.sharesBySafe[safe.id] ?? 0)} shares
                    </li>
                  ))
                )}
              </ul>
              <h4>Pre → post dilution</h4>
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Pre</th>
                      <th>Post</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.post.classes.map((cls) => {
                      const total =
                        round.post.classes.reduce(
                          (sum, item) =>
                            sum +
                            (item.kind === 'PREFERRED'
                              ? item.shares * item.conversionRatio
                              : item.shares),
                          0,
                        ) +
                        round.post.grants.reduce((sum, grant) => sum + grant.options, 0) +
                        round.post.poolAvailable +
                        round.post.promisedOptions
                      const postPct =
                        total === 0
                          ? 0
                          : (cls.kind === 'PREFERRED'
                              ? cls.shares * cls.conversionRatio
                              : cls.shares) / total
                      return (
                        <tr key={cls.id}>
                          <td>{cls.name}</td>
                          <td>{percent(prePct[cls.id] ?? 0)}</td>
                          <td>{percent(postPct)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </aside>
    </section>
  )
}
