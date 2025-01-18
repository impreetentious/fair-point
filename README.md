# Fairpoint

**The term-sheet bargaining studio.** Exact liquidation-waterfall physics. Real Pareto frontiers. Your cap table never leaves your browser.

---

## What it is

Model any priced venture round as an exact cap-table and liquidation-waterfall engine, then negotiate it as a formal two-party bargain: ZOPA, Pareto frontier, Nash and Kalai–Smorodinsky fair points, and dollar-denominated "value left on the table" — computed entirely client-side from each party's own beliefs about exit outcomes.

## The problem

Founders negotiate term sheets by anchoring on headline valuation, while the economic terms that actually move outcome distributions — preference multiple, participation, pool shuffle, seniority, anti-dilution — are traded by folklore. Investors run this playbook weekly; founders run it twice per decade. The result is systematically inefficient deals: packages exist that both parties would prefer, and nobody can see them, because nobody computes utilities. The cost is real dollars transferred by ignorance, and deals that die over terms a frontier plot would show are cheap to concede.

This product closes the gap with one structural insight: **a term package plus each party's exit-value beliefs yields exact per-stakeholder dollar distributions through deterministic algebra.** Utilities are computed, not elicited with sliders — which makes the Pareto frontier real rather than decorative.

## What it does (the three hero moments)

*(Illustrative numbers below are placeholders that will be regenerated from the shipped example decks at build time.)*

1. **See the physics.** Load a deal, drag the exit slider, and watch the waterfall chart kink at exact, labeled breakpoints: "Series A converts above $21.3M."
2. **See the frontier.** Enter both parties' beliefs (P10/P50/P90 plus a failure probability) and hundreds of candidate term packages appear as a cloud in (founder EV, investor EV) space — the Pareto frontier lit up, Nash and Kalai–Smorodinsky (discrete) fair points flagged.
3. **See the money on the table.** Pin the offer you actually received and read: "This offer leaves $X on the table jointly. A package with higher pre-money, 2×-capped participation, and a smaller pool gives you +$A and them +$B."

## Who it's for

1. **Founders** with a live or imminent term sheet (seed → Series B). The hero user.
2. **Angels and VC associates** pressure-testing packages and explaining terms to founders.
3. **Startup lawyers and educators** demonstrating waterfall and bargaining mechanics — the built-in example decks double as teaching material.

## Principles

- **Exact, not simulated.** Waterfall payouts are piecewise-linear with closed-form breakpoints; round mechanics and expected values have closed forms. The engine is verified to cent-per-million precision (max($0.01, 1e-8 × |expected|)); Monte Carlo exists only as an independent cross-check and for the optional risk-aversion mode.
- **Deterministic.** Same inputs, bit-identical outputs. All randomness flows from a seeded PRNG.
- **Verified against published oracles.** Fixtures are hand-re-derived from published worked examples (Venture Deals, the YC post-money SAFE user guide, NVCA model documents); the closed-form expectation-integration layer is checked against a Monte Carlo twin in CI; the settlement layer is checked against an independent naive reference implementation on the full waterfall battery; bargaining solutions are property-tested against their own defining axioms (Nash affine invariance, Nash discrete IIA, KS discrete affine invariance, Pareto membership).
- **Local-first, private by construction.** A static site with no server, no accounts, no telemetry, and zero network calls after load. A cap table is among the most sensitive documents a founder has; it never leaves the browser.
- **Educational, not advisory.** The app names packages both parties' *stated beliefs* prefer. It never says "you should accept." It is an educational instrument — not legal, financial, or investment advice.

## What v1 ships

- An exact engine: round construction (pool shuffle, SAFE conversion, anti-dilution), liquidation waterfall with conversion equilibria, exact breakpoints, closed-form expected payouts, and the bargaining layer (ZOPA, frontier, Nash, Kalai–Smorodinsky, egalitarian, utilitarian, value-on-table).
- Six screens: Cap Table, Round, Waterfall, Beliefs, Frontier (hero), and a printable one-page Report.
- Three worked example decks, eight in-app explainers, a fixture suite of 40+ hand-derived tests, and export/import of deal files as versioned JSON.
- A static, offline-capable build (service-worker-precached; survives a hard reload with the network offline) deployable on any static host (relative asset paths, no URL-path assumptions).

## What v1 deliberately excludes

Multi-party syndicate bargaining, employee-offer analysis, dividends, convertible notes with interest/maturity, secondaries, 409A, IRR/time-discounting, warrants, and any backend or telemetry. Non-cash terms (board seats, vesting, no-shop) appear as a qualitative checklist on the Report screen, never in the math.

## Repository

| File | Role |
|---|---|
| `README.md` | This brief — what the product is and why. |

**Status:** v0.3.x — Phases 0–1 complete on `main` (scaffold, schema, numerics, distributions); Phase 2 (waterfall engine) is next.

---

*Fairpoint is an educational instrument. It is not legal, financial, or investment advice.*

## AI Agent Instructions

Before making any new commits, update the **Product Version** string below in this file with the current IST time of commit (`Asia/Kolkata`). Keep the same numeric release version in `package.json` and the root package entries of `package-lock.json` (once `package.json` exists — from P0 on).

This IST timestamp rule is permanent for all future workflows, commits, and AI agents working in this repository.

Follow this format for version control:

* **Base Format Version:** 0.0.0 — the version of the version-block schema itself (the shape of these lines); it is bumped only when this block's structure changes, not on every commit.
* **Product Version:** `v0.3.2_2025-01-18_22:18:36` (IST)
