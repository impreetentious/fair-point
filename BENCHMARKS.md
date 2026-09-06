# Performance budgets

Fairpoint keeps performance assertions executable instead of publishing machine-specific snapshots
as permanent results. A number without its machine and workload is not a result.

## Runtime benchmarks

Run:

```bash
npm run bench
```

The suite enforces two budgets:

- `payoutsAt`: median below 50 µs on the Series-A-shaped capped-participation table, measured from
  three samples of 5,000 settlements after a 200-call warm-up.
- Full bargaining pipeline: below 400 ms for both EV and CRRA modes across the 585-package default
  grid after one warm pipeline pass.

The command prints the measurements from the current machine. CI applies the same limits.

## Bundle budget

Run:

```bash
npm run build
npm run budget:bundle
```

Every exported route must remain at or below 360 KiB of gzip-compressed JavaScript — the sum over
every `.js` file that route's HTML references. The budget script reports the largest route and fails
when any route exceeds the limit. Override the ceiling for a one-off measurement with
`BUNDLE_BUDGET_KIB`.
