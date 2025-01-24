# Benchmark Record

## Phase 2 — `payoutsAt` micro-benchmark

- Measurement: 2025-01-13 local builder run, 3 samples after 200-call warm-up, 5,000 settlements
  per sample; median selected.
- Table: the Series-A-shaped capped-participation table used by `tests/bench.test.ts`.
- Result: **4.805 µs median per `payoutsAt` call**, under the Phase 2 budget of 50 µs.
- Load protocol: the budget passed on its first measurement; no retry/median-of-three remediation was
  required. The test itself still takes a three-sample median to remain stable under concurrent work.

## Phase 5 — Full bargaining pipeline

- Measurement: 2025-01-13 local builder run after a warm pipeline pass, using the locked Series A
  clean deck, its two belief profiles, all 585 valid raw-grid packages, and `analyze`.
- Result: **9.849 ms EV** and **19.524 ms CRRA** on the warm run, both below the 400 ms CI budget
  and the 150 ms local target.
- Load protocol: both budgets passed on the first measured run; no three-run remediation was needed.
