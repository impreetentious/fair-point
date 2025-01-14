import { useState, type ReactNode } from 'react'

type Props = { title: string; chart: ReactNode; table: ReactNode }

export function ChartFrame({ title, chart, table }: Props) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="chart-frame" aria-label={title}>
      <div className="section-heading">
        <h3>{title}</h3>
        <button type="button" className="quiet-button" onClick={() => setAsTable((value) => !value)} aria-pressed={asTable}>
          {asTable ? 'View chart' : 'View as table'}
        </button>
      </div>
      {asTable ? table : chart}
    </section>
  )
}
