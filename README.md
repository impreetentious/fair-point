# Fairpoint

**The term-sheet bargaining studio.** Deterministic liquidation-waterfall physics. Real Pareto frontiers. Your cap table never leaves your browser.

## What it is

Model any priced venture round with a deterministic cap-table and liquidation-waterfall engine, then negotiate it as a formal two-party bargain: ZOPA, Pareto frontier, Nash and Kalai–Smorodinsky fair points, and dollar-denominated "value left on the table" — computed entirely client-side from each party's own beliefs about exit outcomes.

## The problem

Founders negotiate term sheets by anchoring on headline valuation, while the economic terms that actually move outcome distributions — preference multiple, participation, pool shuffle, seniority, anti-dilution — are traded by folklore. Investors run this playbook weekly; founders run it twice per decade. The result is systematically inefficient deals: packages exist that both parties would prefer, and nobody can see them, because nobody computes utilities. The cost is real dollars transferred by ignorance, and deals that die over terms a frontier plot would show are cheap to concede.

This product closes the gap with one structural insight: **a term package plus each party's exit-value beliefs yields per-stakeholder dollar distributions through deterministic settlement and analytic integration.** Utilities are computed, not elicited with sliders — which makes the Pareto frontier real rather than decorative.

## What it does

1. **See the physics.** Load a deal, drag the exit slider, and watch the waterfall chart kink at deterministic, labeled breakpoints: "Series A converts above $21.3M."
2. **See the frontier.** Enter both parties' beliefs (P10/P50/P90 plus a failure probability) and hundreds of candidate term packages appear as a cloud in (founder EV, investor EV) space — the Pareto frontier lit up, Nash and Kalai–Smorodinsky (discrete) fair points flagged.
3. **See the money on the table.** Pin the offer you actually received and read its joint surplus and ranked win-win alternatives. The bundled "Series A clean" example is already efficient under shared beliefs ($0 on the table); changing either party's beliefs, or pinning an offer that isn't on the candidate grid, makes the comparison live.
4. **See what to say about it.** The frontier answers _which package_; the Leverage screen answers what you say in the room. Every term is priced one step at a time in expected dollars for both sides, with the pre-money that would undo each concession solved for and checked. A tornado ranks the four exit beliefs by how far each one alone moves the answer, so you know which diligence question is worth asking first. And where the two sides disagree about the exit, the disagreement is priced as tradeable material: a milestone ratchet pays in the states one side believes in and the other does not, so it can be worth more to you than it costs them.
5. **See past this round.** Several of the terms on a sheet are worth exactly nothing in a one-round model — anti-dilution cannot bite unless a later round prices lower, seniority has nothing to sit above. Attach two or three discrete follow-on branches and those terms acquire a price, with today's investor's dilution and pro-rata election shown branch by branch. The frontier and fair-point machinery run unchanged on the branch-weighted numbers.

## Who it's for

1. **Founders** with a live or imminent term sheet (seed → Series B). The primary user.
2. **Angels and VC associates** pressure-testing packages and explaining terms to founders.
3. **Startup lawyers and educators** demonstrating waterfall and bargaining mechanics — the built-in example decks double as teaching material.

## Principles

- **Deterministic, not simulation-driven.** Waterfall payouts are piecewise-linear; round mechanics and expected values use deterministic algebra and numerical root recovery at settlement transitions. The engine is verified to cent-per-million precision (max($0.01, 1e-8 × |expected|)); deterministic quadrature handles risk aversion, while Monte Carlo remains an independent test oracle and inspector readout.
- **Deterministic.** Same inputs, bit-identical outputs. All randomness flows from a seeded PRNG.
- **Verified against published sources.** Fixtures are hand-re-derived from published worked examples (Venture Deals, the YC post-money SAFE user guide, NVCA model documents); the closed-form expectation-integration layer is checked against a Monte Carlo twin in CI; the settlement layer is checked against an independent naive reference implementation on the full waterfall battery; bargaining solutions are property-tested against their own defining axioms (Nash affine invariance, Nash discrete IIA, KS discrete affine invariance, Pareto membership).
- **Local-first, private by construction.** A static site with no application server, no accounts, no telemetry, and no off-origin requests in the product code. A cap table is among the most sensitive documents a founder has; it never leaves the browser.
- **Educational, not advisory.** The app names packages both parties' _stated beliefs_ prefer. It never says "you should accept." It is an educational instrument — not legal, financial, or investment advice.

## What's included

- A deterministic engine: round construction (pool shuffle, SAFE conversion, anti-dilution), liquidation waterfall with conversion equilibria, numerically recovered breakpoints, analytic expected payouts, and the bargaining layer (ZOPA, frontier, Nash, Kalai–Smorodinsky, egalitarian, utilitarian, value-on-table).
- Core and deal-file extensions beyond the two-party screen flow: multi-party syndicate bargaining, employee-offer analysis, dividends and accruals, convertible notes, secondaries, 409A fair value, IRR/time-discounting, MFN clauses, and warrants.
- Seven screens: Cap Table, Round, Waterfall, Beliefs, Frontier (where the negotiation happens), Leverage (term prices, belief ranking, contingent terms, and the next-round shadow), and a printable one-page Report.
- Three worked example decks, eleven in-app explainers, a fixture suite of 80+ hand-derived tests, and export/import of deal files as versioned JSON.
- A static, offline-capable build (service-worker-precached; survives a hard reload with the network offline) deployable on any static host (relative asset paths, no URL-path assumptions).

## Limitations

- **Non-cash terms are never in the math.** Board seats, vesting, no-shop, information rights and similar terms appear as a qualitative checklist on the Report screen only.
- **Two parties in the product UI.** The interactive frontier, fair points, and value-on-table are presented for a founder/investor pair. The core library also exposes an n-party discrete bargaining analyzer, but the app does not yet provide a syndicate UI.
- **KS monotonicity is not verified.** Bargaining solutions are property-tested against the axioms listed above; monotonicity is not meaningful on discrete point sets and is not claimed. Nash and KS solutions are labeled "discrete" in the UI for that reason.
- **Beliefs are yours.** The engine is deterministic given the inputs. It has no market data, no comparables, and no opinion about whether your P50 exit is realistic.
- **The next round is a sketch, not a forecast.** Follow-on branches are discrete states you name, with probabilities you set. Each branch reuses the same deterministic round and waterfall calculations, but the branches themselves are assumptions, and the screen prices them rather than predicting them.
- **A contingent term is priced, not drafted.** The ratchet is modelled as a state-dependent transfer above a threshold. Whether that structure survives contact with a lawyer, and how it interacts with the rest of the document, is outside the engine.

## Stack

Next.js (App Router, static export) · TypeScript strict · React · Zustand · Recharts · Zod · Vitest · fast-check.

## Run locally

Requires Node `22.22.x` (see `.nvmrc`; `engine-strict` makes `npm ci` fail on a different version).

```bash
npm ci
npm run dev
```

The dev server binds `127.0.0.1:4174`; preview serves the static export on `127.0.0.1:4173`.

## Verify

```bash
npm audit --audit-level=high
npm run verify # version/docs checks, typecheck, lint, formatting, unit/property/fixture tests
npm run build  # static export and service worker
npm run gates  # bundle/CSP budgets, Playwright, offline contract, Lighthouse accessibility
```

## Build and deploy

```bash
npm run build      # static export to out/, plus the service worker
npm run preview    # serves out/ at http://127.0.0.1:4173
```

`out/` uses relative asset paths and assumes nothing about its URL path, so it serves from any static host, including a subdirectory.

Whatever host you use should send the response headers documented in [docs/STATIC-HOST-HEADERS.md](docs/STATIC-HOST-HEADERS.md). `vercel.json` applies them on Vercel and `serve.json` applies the same policy to `npm run preview` and to the Playwright web server, so the offline contract is tested under the real policy. `npm run check:csp` fails if the two host configs and the document ever disagree.

## Status and contributing

Pre-1.0, and versioned as such: screens, internals, and the set of analyses on offer can still change between releases. What is stable is the deal file — `schemaVersion` is `1.0.0`, every bundled example parses under it, and the app refuses a file written by a newer schema rather than guessing at it. The package is not published to a registry; the deliverable is the static export in `out/`.

Bugs and questions go to [GitHub issues](https://github.com/ItsMonarch04/fair-point/issues). The Verify workflow runs on every pull request, so a change is expected to leave `npm run verify`, `npm run build`, and `npm run gates` green on Node `22.22.x`. Two conventions matter beyond that:

- **An engine change is a spec change.** [docs/MATH-SPEC.md](docs/MATH-SPEC.md) is normative, source comments cite it by section, and `npm run check:citations` fails on a citation that no longer resolves. Change the section and the code together.
- **New behaviour arrives with a fixture.** The battery under `fixtures/` is hand-derived rather than captured from the engine's own output, which is what makes it an oracle instead of a snapshot.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

_Fairpoint is an educational instrument. It is not legal, financial, or investment advice._

**Version:** v0.18.0
