export function dollars(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function dollarsPrecise(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(value)
}

export function percent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

export function compactMillions(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `$${(value / 1_000_000).toFixed(Math.abs(value) >= 10_000_000 ? 1 : 2)}M`
}

export function shares(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}
