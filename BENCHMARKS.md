# Benchmark Record

## Phase 2 — `payoutsAt` micro-benchmark

- Measurement: 2025-01-13 local builder run, 3 samples after 200-call warm-up, 5,000 settlements
  per sample; median selected.
- Table: the Series-A-shaped capped-participation table used by `tests/bench.test.ts`.
- Result: **4.805 µs median per `payoutsAt` call**, under the Phase 2 budget of 50 µs.
- Load protocol: the budget passed on its first measurement; no retry/median-of-three remediation was
  required. The test itself still takes a three-sample median to remain stable under concurrent work.
