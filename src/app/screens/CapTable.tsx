import { useMemo, useState } from 'react'
import { EXAMPLE_DECKS } from '../data/examples'
import { dollars, percent, shares } from '../components/format'
import { CommitNumber, CommitText } from '../components/CommitField'
import { ExplainDrawer } from '../components/ExplainDrawer'
import { ValidationPanel } from '../components/ValidationPanel'
import { analyzeEmployeeOffer } from '../../core/employee-offer'
import { useDealStore } from '../state/store'
import type { CapTable, OptionGrant, ShareClass, ShareClassPreferred } from '../../core/schema'

const holders = ['FOUNDER', 'INVESTOR', 'OTHER'] as const
const grantHolders = ['FOUNDER', 'OTHER'] as const
const antiDilution = ['NONE', 'BWA', 'FULL_RATCHET'] as const
const participation = ['NONE', 'FULL', 'CAPPED'] as const

function asConverted(cls: ShareClass): number {
  return cls.kind === 'PREFERRED' ? cls.shares * cls.conversionRatio : cls.shares
}

function preferredDefaults(base: ShareClass): ShareClassPreferred {
  return {
    id: base.id,
    name: base.name,
    kind: 'PREFERRED',
    shares: base.shares,
    holder: base.holder,
    invested: base.shares,
    originalIssuePrice: 1,
    prefMultiple: 1,
    participation: 'NONE',
    participationCapMultiple: undefined,
    seniorityTier: 1,
    conversionRatio: 1,
    antiDilution: 'NONE',
    dividendRate: 0,
    dividendKind: 'NONE',
    payToPlay: 'NONE',
    accruedDividends: 0,
    redemptionClaim: 0,
  }
}

function nextId(prefix: string, ids: Iterable<string>): string {
  const used = new Set(ids)
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function tableIds(table: Pick<CapTable, 'classes' | 'grants'>): string[] {
  return [...table.classes.map((cls) => cls.id), ...table.grants.map((grant) => grant.id)]
}

function newClass(table: Pick<CapTable, 'classes' | 'grants'>): ShareClass {
  const id = nextId('class', tableIds(table))
  return {
    id,
    name: `Class ${id.slice('class-'.length)}`,
    kind: 'COMMON',
    shares: 1_000_000,
    holder: 'FOUNDER',
  }
}

function newGrant(table: Pick<CapTable, 'classes' | 'grants'>): OptionGrant {
  const id = nextId('grant', tableIds(table))
  return {
    id,
    options: 100_000,
    strike: 0.01,
    holder: 'OTHER',
    instrument: 'OPTION',
  }
}

export function CapTableScreen() {
  const deal = useDealStore((state) => state.deal)
  const validation = useDealStore((state) => state.validation)
  const patchDeal = useDealStore((state) => state.patchDeal)
  const loadExample = useDealStore((state) => state.loadExample)
  const [options, setOptions] = useState(100_000)
  const [strike, setStrike] = useState(0.01)
  const [cash, setCash] = useState(150_000)
  const offer = useMemo(() => {
    const grantId = nextId('offer-preview', tableIds(deal.pre))
    try {
      return {
        result: analyzeEmployeeOffer({
          pre: deal.pre,
          safes: deal.safes,
          notes: deal.notes,
          terms: deal.terms,
          grant: { id: grantId, options, strike, holder: 'OTHER', instrument: 'OPTION' },
          beliefs: deal.founderBeliefs,
          cashAlternative: cash,
          yearsToExit: deal.yearsToExit,
          discounting: deal.discounting,
        }),
        error: null as string | null,
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'Offer analysis failed',
      }
    }
  }, [cash, deal, options, strike])
  const fd = useMemo(() => {
    const classShares = deal.pre.classes.reduce((sum, cls) => sum + asConverted(cls), 0)
    const grants = deal.pre.grants.reduce((sum, grant) => sum + grant.options, 0)
    const total = classShares + grants + deal.pre.poolAvailable + deal.pre.promisedOptions
    return {
      classShares,
      grants,
      total,
      byHolder: holders.map((holder) => ({
        holder,
        shares: deal.pre.classes
          .filter((cls) => cls.holder === holder)
          .reduce((sum, cls) => sum + asConverted(cls), 0),
      })),
    }
  }, [deal.pre])
  const updateClass = (id: string, patch: (cls: ShareClass) => ShareClass) =>
    patchDeal((current) => ({
      ...current,
      pre: {
        ...current.pre,
        classes: current.pre.classes.map((candidate) =>
          candidate.id === id ? patch(candidate) : candidate,
        ),
      },
    }))
  const updateGrant = (id: string, patch: (grant: OptionGrant) => OptionGrant) =>
    patchDeal((current) => ({
      ...current,
      pre: {
        ...current.pre,
        grants: current.pre.grants.map((candidate) =>
          candidate.id === id ? patch(candidate) : candidate,
        ),
      },
    }))

  return (
    <section className="screen-grid">
      <div className="main-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Inputs</p>
            <h2>Cap table</h2>
          </div>
          <div className="header-actions">
            <ExplainDrawer screen="cap-table" />
            <label>
              Example deck
              <select
                aria-label="Load example deck"
                value=""
                onChange={(event) => loadExample(event.target.value)}
              >
                <option value="" disabled>
                  Load an example
                </option>
                {EXAMPLE_DECKS.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {deal.pre.classes.length === 0 && (
          <p className="empty-state">Start from an example deck or add your first share class.</p>
        )}
        <div className="section-heading">
          <h3>Share classes</h3>
          <button
            type="button"
            className="quiet-button"
            onClick={() =>
              patchDeal((current) => ({
                ...current,
                pre: {
                  ...current.pre,
                  classes: [...current.pre.classes, newClass(current.pre)],
                },
              }))
            }
          >
            Add class
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Kind</th>
                <th>Holder</th>
                <th>Shares</th>
                <th>Invested</th>
                <th>OIP</th>
                <th>Pref</th>
                <th>Participation</th>
                <th>Tier</th>
                <th>CR</th>
                <th>Anti-dilution</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deal.pre.classes.map((cls) => (
                <tr key={cls.id}>
                  <td>
                    <CommitText
                      label={`${cls.name} name`}
                      value={cls.name}
                      onCommit={(name) =>
                        updateClass(cls.id, (candidate) => ({ ...candidate, name }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`${cls.name} kind`}
                      value={cls.kind}
                      onChange={(event) =>
                        updateClass(cls.id, (candidate) =>
                          event.target.value === 'COMMON'
                            ? {
                                id: candidate.id,
                                name: candidate.name,
                                kind: 'COMMON',
                                shares: candidate.shares,
                                holder: candidate.holder,
                              }
                            : preferredDefaults(candidate),
                        )
                      }
                    >
                      <option>COMMON</option>
                      <option>PREFERRED</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${cls.name} holder`}
                      value={cls.holder}
                      onChange={(event) =>
                        updateClass(cls.id, (candidate) => ({
                          ...candidate,
                          holder: event.target.value as ShareClass['holder'],
                        }))
                      }
                    >
                      {holders.map((holder) => (
                        <option key={holder}>{holder}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <CommitNumber
                      label={`${cls.name} shares`}
                      value={cls.shares}
                      min={1}
                      onCommit={(value) =>
                        value !== undefined &&
                        updateClass(cls.id, (candidate) =>
                          candidate.kind === 'PREFERRED'
                            ? {
                                ...candidate,
                                shares: value,
                                originalIssuePrice: candidate.invested / value,
                              }
                            : { ...candidate, shares: value },
                        )
                      }
                    />
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <CommitNumber
                        label={`${cls.name} invested`}
                        value={cls.invested}
                        min={1}
                        step={1000}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? {
                                  ...candidate,
                                  invested: value,
                                  originalIssuePrice: value / candidate.shares,
                                }
                              : candidate,
                          )
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <CommitNumber
                        label={`${cls.name} original issue price`}
                        value={cls.originalIssuePrice}
                        min={0.0001}
                        step={0.0001}
                        decimals={4}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? {
                                  ...candidate,
                                  originalIssuePrice: value,
                                  invested: value * candidate.shares,
                                }
                              : candidate,
                          )
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <CommitNumber
                        label={`${cls.name} preference multiple`}
                        value={cls.prefMultiple}
                        min={1}
                        step={0.5}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? { ...candidate, prefMultiple: value }
                              : candidate,
                          )
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <select
                        aria-label={`${cls.name} participation`}
                        value={cls.participation}
                        onChange={(event) =>
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? {
                                  ...candidate,
                                  participation: event.target
                                    .value as ShareClassPreferred['participation'],
                                  participationCapMultiple:
                                    event.target.value === 'CAPPED'
                                      ? Math.max(2, candidate.prefMultiple + 0.5)
                                      : undefined,
                                }
                              : candidate,
                          )
                        }
                      >
                        {participation.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    ) : (
                      '—'
                    )}
                    {cls.kind === 'PREFERRED' && cls.participation === 'CAPPED' ? (
                      <CommitNumber
                        label={`${cls.name} cap multiple`}
                        value={cls.participationCapMultiple}
                        min={cls.prefMultiple + 0.1}
                        step={0.5}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? { ...candidate, participationCapMultiple: value }
                              : candidate,
                          )
                        }
                      />
                    ) : null}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <CommitNumber
                        label={`${cls.name} seniority tier`}
                        value={cls.seniorityTier}
                        min={1}
                        step={1}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? { ...candidate, seniorityTier: Math.round(value) }
                              : candidate,
                          )
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <CommitNumber
                        label={`${cls.name} conversion ratio`}
                        value={cls.conversionRatio}
                        min={0.0001}
                        step={0.0001}
                        decimals={4}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? { ...candidate, conversionRatio: value }
                              : candidate,
                          )
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {cls.kind === 'PREFERRED' ? (
                      <select
                        aria-label={`${cls.name} anti-dilution`}
                        value={cls.antiDilution}
                        onChange={(event) =>
                          updateClass(cls.id, (candidate) =>
                            candidate.kind === 'PREFERRED'
                              ? {
                                  ...candidate,
                                  antiDilution: event.target
                                    .value as ShareClassPreferred['antiDilution'],
                                }
                              : candidate,
                          )
                        }
                      >
                        {antiDilution.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() =>
                        patchDeal((current) => ({
                          ...current,
                          pre: {
                            ...current.pre,
                            classes: current.pre.classes.filter(
                              (candidate) => candidate.id !== cls.id,
                            ),
                          },
                        }))
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section-heading">
          <h3>Issued grants</h3>
          <button
            type="button"
            className="quiet-button"
            onClick={() =>
              patchDeal((current) => ({
                ...current,
                pre: {
                  ...current.pre,
                  grants: [...current.pre.grants, newGrant(current.pre)],
                },
              }))
            }
          >
            Add grant
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Instrument</th>
                <th>Options</th>
                <th>Strike</th>
                <th>Holder</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deal.pre.grants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No issued option grants.
                  </td>
                </tr>
              ) : (
                deal.pre.grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <CommitText
                        label={`${grant.id} id`}
                        value={grant.id}
                        onCommit={(id) =>
                          updateGrant(grant.id, (candidate) => ({ ...candidate, id }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${grant.id} instrument`}
                        value={grant.instrument}
                        onChange={(event) =>
                          updateGrant(grant.id, (candidate) => ({
                            ...candidate,
                            instrument: event.target.value as OptionGrant['instrument'],
                          }))
                        }
                      >
                        <option>OPTION</option>
                        <option>WARRANT</option>
                      </select>
                    </td>
                    <td>
                      <CommitNumber
                        label={`${grant.id} options`}
                        value={grant.options}
                        min={1}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateGrant(grant.id, (candidate) => ({ ...candidate, options: value }))
                        }
                      />
                    </td>
                    <td>
                      <CommitNumber
                        label={`${grant.id} strike`}
                        value={grant.strike}
                        min={0}
                        step={0.0001}
                        decimals={4}
                        onCommit={(value) =>
                          value !== undefined &&
                          updateGrant(grant.id, (candidate) => ({ ...candidate, strike: value }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${grant.id} holder`}
                        value={grant.holder}
                        onChange={(event) =>
                          updateGrant(grant.id, (candidate) => ({
                            ...candidate,
                            holder: event.target.value as OptionGrant['holder'],
                          }))
                        }
                      >
                        {grantHolders.map((holder) => (
                          <option key={holder}>{holder}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() =>
                          patchDeal((current) => ({
                            ...current,
                            pre: {
                              ...current.pre,
                              grants: current.pre.grants.filter(
                                (candidate) => candidate.id !== grant.id,
                              ),
                            },
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
        <div className="field-grid">
          <label>
            Unissued pool
            <CommitNumber
              label="Unissued pool"
              value={deal.pre.poolAvailable}
              min={0}
              onCommit={(value) =>
                value !== undefined &&
                patchDeal((current) => ({
                  ...current,
                  pre: { ...current.pre, poolAvailable: value },
                }))
              }
            />
          </label>
          <label>
            Promised options
            <CommitNumber
              label="Promised options"
              value={deal.pre.promisedOptions}
              min={0}
              onCommit={(value) =>
                value !== undefined &&
                patchDeal((current) => ({
                  ...current,
                  pre: { ...current.pre, promisedOptions: value },
                }))
              }
            />
          </label>
        </div>

        <div className="section-heading" style={{ marginTop: '1.5rem' }}>
          <div>
            <p className="eyebrow">Extension</p>
            <h3>Employee offer analyzer</h3>
          </div>
        </div>
        <div className="field-grid">
          <label>
            Options
            <input
              aria-label="Offer options"
              type="number"
              min="0"
              value={options}
              onChange={(event) => setOptions(Number(event.target.value))}
            />
          </label>
          <label>
            Strike
            <input
              aria-label="Offer strike"
              type="number"
              min="0"
              step="0.01"
              value={strike}
              onChange={(event) => setStrike(Number(event.target.value))}
            />
          </label>
          <label>
            Cash alternative
            <input
              aria-label="Cash alternative"
              type="number"
              min="0"
              value={cash}
              onChange={(event) => setCash(Number(event.target.value))}
            />
          </label>
        </div>
        {offer.error !== null ? (
          <p className="validation invalid">{offer.error}</p>
        ) : (
          offer.result !== null && (
            <dl className="metric-list">
              <dt>Expected value</dt>
              <dd>{dollars(offer.result.expectedValue)}</dd>
              <dt>P50 payout</dt>
              <dd>{dollars(offer.result.p50)}</dd>
              <dt>Surplus vs cash</dt>
              <dd>{dollars(offer.result.surplusVsCash)}</dd>
            </dl>
          )
        )}
      </div>
      <div className="side-panel">
        <ValidationPanel messages={validation} />
        <h3>FD / as-converted</h3>
        <dl className="metric-list">
          <dt>Class shares</dt>
          <dd>{shares(fd.classShares)}</dd>
          <dt>Issued grants</dt>
          <dd>{shares(fd.grants)}</dd>
          <dt>Unissued + promised</dt>
          <dd>{shares(deal.pre.poolAvailable + deal.pre.promisedOptions)}</dd>
          <dt>FD total</dt>
          <dd>{shares(fd.total)}</dd>
        </dl>
        <div className="ownership-pie" aria-label="Ownership pie">
          {fd.byHolder.map((row) => (
            <span
              key={row.holder}
              style={{ flexGrow: fd.total === 0 ? 1 : Math.max(row.shares / fd.total, 0.03) }}
              title={`${row.holder}: ${percent(fd.total === 0 ? 0 : row.shares / fd.total)}`}
            >
              {row.holder[0]}
            </span>
          ))}
        </div>
        <p className="callout">
          Unissued pool and promised options count for pricing, but receive no exit payout. SAFEs
          may be aggregated: the Round screen stores a per-row count annotation for provenance.
        </p>
      </div>
    </section>
  )
}
