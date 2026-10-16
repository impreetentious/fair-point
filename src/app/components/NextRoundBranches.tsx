import { useState } from 'react'
import {
  NextRoundBranchesSchema,
  RoundTermsSchema,
  poolFeasible,
  humanizeZodError,
  type DealFile,
  type RoundTerms,
} from '../../core/schema'
import { branchesForDeal } from '../../core/next-round'
import { useDealStore } from '../state/store'

export function NextRoundBranches({
  deal,
  onDirty,
}: {
  deal: DealFile
  onDirty: (dirty: boolean) => void
}) {
  const [initial] = useState(() => {
    try {
      return { branches: structuredClone(branchesForDeal(deal)), error: null }
    } catch (error) {
      return {
        branches: [],
        error: error instanceof Error ? error.message : 'Follow-on assumptions unavailable.',
      }
    }
  })
  const [draft, setDraft] = useState(initial.branches)
  const [error, setError] = useState<string | null>(null)
  const change = (index: number, patch: Partial<(typeof draft)[number]>) => {
    setDraft((current) =>
      current.map((branch, i) => (i === index ? { ...branch, ...patch } : branch)),
    )
    setError(null)
    onDirty(true)
  }
  const term = (index: number, patch: Partial<RoundTerms>) =>
    change(index, { terms: { ...draft[index]!.terms, ...patch } })
  const save = () => {
    const parsed = NextRoundBranchesSchema.safeParse(draft)
    if (!parsed.success) {
      setError(humanizeZodError(parsed.error).join(' '))
      return
    }
    if (
      useDealStore
        .getState()
        .patchDeal((current) => ({ ...current, nextRoundBranches: parsed.data }))
    ) {
      setError(null)
      onDirty(false)
    }
  }
  return (
    <section aria-label="Follow-on branch editor">
      {initial.error && <p role="status">{initial.error}</p>}
      <p>
        {deal.nextRoundBranches
          ? 'Saved follow-on assumptions.'
          : 'Illustrative branches until you save your assumptions.'}{' '}
        Branch-weighted values are separate from the ordinary one-round frontier. CRRA combines
        weighted utilities before computing certainty equivalents.
      </p>
      {draft.map((branch, index) => (
        <fieldset key={branch.id}>
          <legend>
            {branch.label} ({branch.id})
          </legend>
          <label>
            Branch ID
            <input aria-label={`Branch ${index + 1} ID`} value={branch.id} readOnly />
          </label>
          <label>
            Label
            <input
              aria-label={`Branch ${index + 1} label`}
              value={branch.label}
              onChange={(event) => change(index, { label: event.target.value })}
            />
          </label>
          <label>
            Probability
            <input
              aria-label={`Branch ${index + 1} probability`}
              type="number"
              min="0"
              step="0.01"
              value={Number.isFinite(branch.probability) ? branch.probability : ''}
              onChange={(event) => change(index, { probability: event.target.valueAsNumber })}
            />
          </label>
          <label>
            Pro-rata
            <input
              aria-label={`Branch ${index + 1} pro-rata`}
              type="checkbox"
              checked={branch.proRata}
              onChange={(event) => change(index, { proRata: event.target.checked })}
            />
          </label>
          <label>
            Pricing basis
            <select
              aria-label={`Branch ${index + 1} pricing basis`}
              value={branch.terms.preMoney === undefined ? 'pricedPerShare' : 'preMoney'}
              onChange={(event) => {
                const terms = { ...branch.terms }
                if (event.target.value === 'preMoney') {
                  delete terms.pricedPerShare
                  terms.preMoney = deal.terms.preMoney ?? 1_000_000
                } else {
                  delete terms.preMoney
                  terms.pricedPerShare = deal.terms.pricedPerShare ?? 1
                }
                change(index, { terms })
              }}
            >
              <option value="preMoney">Pre-money</option>
              <option value="pricedPerShare">Price per share</option>
            </select>
          </label>
          {(
            [
              'investment',
              'poolTargetPost',
              branch.terms.preMoney === undefined ? 'pricedPerShare' : 'preMoney',
            ] as const
          ).map((field) => (
            <label key={field}>
              {field}
              <input
                aria-label={`Branch ${index + 1} ${field}`}
                type="number"
                step="any"
                value={Number.isFinite(branch.terms[field]) ? branch.terms[field] : ''}
                onChange={(event) => term(index, { [field]: event.target.valueAsNumber })}
              />
            </label>
          ))}
          <label>
            Preference multiple
            <select
              aria-label={`Branch ${index + 1} preference multiple`}
              value={branch.terms.prefMultiple}
              onChange={(event) =>
                term(index, {
                  prefMultiple: Number(event.target.value) as RoundTerms['prefMultiple'],
                })
              }
            >
              {[1, 1.5, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {value}x
                </option>
              ))}
            </select>
          </label>
          <label>
            Participation
            <select
              aria-label={`Branch ${index + 1} participation`}
              value={branch.terms.participation}
              onChange={(event) =>
                term(index, { participation: event.target.value as RoundTerms['participation'] })
              }
            >
              {['NONE', 'CAP2', 'CAP3', 'FULL'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Seniority
            <select
              aria-label={`Branch ${index + 1} seniority`}
              value={branch.terms.seniority}
              onChange={(event) =>
                term(index, { seniority: event.target.value as RoundTerms['seniority'] })
              }
            >
              {['PARI', 'SENIOR'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Pay-to-play participant IDs (comma separated)
            <input
              aria-label={`Branch ${index + 1} pay-to-play participants`}
              value={branch.terms.payToPlayParticipants?.join(', ') ?? ''}
              onChange={(event) =>
                term(index, {
                  payToPlayParticipants: event.target.value
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <button
            type="button"
            disabled={draft.length === 2}
            onClick={() => {
              setDraft(draft.filter((_, i) => i !== index))
              onDirty(true)
            }}
          >
            Remove {branch.label}
          </button>
          {draft.length === 2 && (
            <button
              type="button"
              onClick={() => {
                const validated = RoundTermsSchema.safeParse(branch.terms)
                if (!validated.success || !poolFeasible(branch.terms)) {
                  setError("Correct this branch's round terms before duplicating it.")
                  return
                }
                setDraft([
                  ...draft,
                  {
                    ...structuredClone(branch),
                    id: crypto.randomUUID(),
                    label: `${branch.label} copy`,
                    probability: 0,
                  },
                ])
                onDirty(true)
              }}
            >
              Duplicate {branch.label} at zero weight
            </button>
          )}
        </fieldset>
      ))}
      <p>
        Applicable pay-to-play IDs:{' '}
        {deal.pre.classes
          .filter(
            (cls) =>
              cls.kind === 'PREFERRED' &&
              cls.payToPlay === 'TO_COMMON' &&
              deal.terms.payToPlayParticipants?.includes(cls.id),
          )
          .map((cls) => cls.id)
          .join(', ') || 'none'}
        . Unknown or ineligible IDs produce a named invalid branch.
      </p>
      <p>
        Two or three branches. Duplicating retains valid terms with a separate stable ID and zero
        weight. Removing a branch does not redistribute its weight. Probabilities must total one
        before saving; invalid drafts do not change the saved deal.
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={save}>
        Save follow-on assumptions
      </button>
      <button
        type="button"
        onClick={() => {
          useDealStore.getState().patchDeal((current) => {
            const next = { ...current }
            delete next.nextRoundBranches
            return next
          })
          onDirty(false)
        }}
      >
        Reset to illustrative branches
      </button>
    </section>
  )
}
