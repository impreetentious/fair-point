import { useEffect, useState } from 'react'

type NumberProps = {
  label: string
  value: number | undefined
  onCommit: (value: number | undefined) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  allowEmpty?: boolean
}

export function CommitNumber({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  decimals,
  allowEmpty = false,
}: NumberProps) {
  const format = (next: number | undefined) =>
    next === undefined ? '' : String(decimals === undefined ? next : Number(next.toFixed(decimals)))
  const [draft, setDraft] = useState(format(value))
  useEffect(() => setDraft(format(value)), [value])
  const commit = () => {
    if (draft.trim() === '' && allowEmpty) {
      onCommit(undefined)
      return
    }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(format(value))
      return
    }
    onCommit(parsed)
  }
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(format(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

type TextProps = {
  label: string
  value: string
  onCommit: (value: string) => void
}

export function CommitText({ label, value, onCommit }: TextProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => onCommit(draft.trim() === '' ? value : draft)
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
