# Fairpoint — Math Specification (LOCKED)

The normative mathematics for this repository: the round-construction pipeline, SAFE conversion as
a single global solve, the pool shuffle and PPS closed form, anti-dilution, the exit waterfall,
numerics and distributions, closed-form outcome statistics, utilities and BATNAs, the bargaining
layer, the employee-offer analyzer, warrants, pay-to-play, dividends, redemption, convertible
notes, MFN, secondary sales, IRR/time-discounting, multi-party syndicate bargaining, and 409A.

**This document is authoritative and permanent.** Source comments cite it by section number as
`docs/MATH-SPEC.md §X`; where a source comment and this document disagree, this document wins until an
owner ruling says otherwise. Section numbering is contract — renumbering a section breaks every
citation that points at it.

---

Conventions: dollars and shares are float64; `ln 0 = −∞`, `Φ(−∞)=0`, `Φ(+∞)=1`; comparisons in this section use `EPS_DECISION = 1e-6` absolute on dollars unless stated. Fixture-assertion tolerance is D16's separate policy (do not conflate — see D16).

### 6.1 Round construction pipeline (`constructRound`) — locked order, single global solve

Given pre-round `CapTable`, `Safe[]`, `RoundTerms {V_pre or pricedPerShare, I, t, prefMultiple, participation, seniority}`, compute the following as ONE coupled fixed point (§6.2 gives the closed form; §6.4.2 layers anti-dilution around it):

1. **BaseCap** = all outstanding common shares + existing preferred as-converted (`shares × conversionRatio`) + issued option shares (all grants, regardless of strike) + `poolAvailable` (pre-existing) + `promisedOptions`. _(New-round pool increase `P` and new-money investor shares `N` are excluded — they are what §6.2/§6.3 solve for.)_
2. **Global SAFE + pool + PPS solve** (§6.2). Every SAFE's route (cap / discount / round-price) is chosen jointly with total SAFE shares `T`, pool increase `P`, and PPS. Pre-money and post-money SAFEs are solved together; new-round pool increase `P` and `T` co-determine the ownership base (see §6.2 addendum: post-money base includes ALL converting securities). Converted SAFEs become new preferred classes per §6.2.4.
3. Given the solved `T` and `P`, `A = BaseCap + T`. (Same identity as before, now applied to the solved `T`.)
4. **PPS** = `V_pre / (A + P)` in `preMoney` mode, or the supplied `pricedPerShare` in direct-PPS mode (V12; pool step is skipped in direct-PPS mode per §6.3 addendum). **New investor shares** `N = I / PPS`. **New round class:** PREFERRED, holder=INVESTOR, invested = I, OIP = PPS, multiple/participation from terms, `seniorityTier` = 1 if `seniority='SENIOR'` (existing tiers shift +1); else PARI, meaning "join the most junior existing preferred tier" (i.e., `seniorityTier = max(existing tiers, 1)`) — T-23. The new class's tier is computed **here** (from `seniority` and existing tiers), before §6.2.4 needs to stamp it onto converted SAFEs.
5. **Anti-dilution** (§6.4) for protected existing preferred if `PPS < currentConversionPrice` — may trigger the fixed-point re-solve. The anti-dilution loop wraps steps 2–4: any BWA/FULL_RATCHET adjustment updates existing preferred `conversionRatio`, which changes BaseCap, which re-enters §6.2/§6.3. `CP1` is frozen at its pre-round value across all iterations (T-05).
6. Emit post-round `CapTable` + diagnostics `{pps, investorPct = N/FD_post, poolIncrease = P, safeShares}` + invariant check: **in `preMoney` mode**, with no SAFEs and no anti-dilution, `investorPct` must equal `I/(V_pre+I)` to 1e-9 relative. **Under the fixed-point identity** (see T-05), `investorPct = I/V_post` also holds in `preMoney` mode _with_ anti-dilution — because `PPS = V_pre/(A+P)` and `N = I/PPS` give `N/(A+P+N) = I/(V_pre+I)` identically. In `pricedPerShare` mode this V_pre-derived invariant is skipped (V_pre is not an input); `investorPct` is `N/FD_post` on the supplied PPS.

### 6.2 SAFE conversion (`safes.ts`) — global solve, no two-pass

**6.2.0 Route menu (per SAFE, LOCKED).** Post-money SAFEs convert into shares at the route giving **max shares** among:

- **Cap route:** the simultaneous closed form of §6.2.2.
- **Discount route:** `amount_i / ((1 − discount_i) × PPS)` (only when the SAFE has a discount).
- **Round-price route:** `amount_i / PPS` (participates for **every** post-money SAFE — cap-only, discount-only, cap-and-discount — because the YC guide's low-priced-round conversion always beats cap or discount when the round prices below the SAFE price; T-01(c)).

Pre-money SAFEs (§6.2.1) use their own price rule (cap vs. discount), not this three-way max.

**6.2.1 Pre-money SAFE** (note-like): conversion price = `min(capPrice, discountPrice)` where **`capPrice = valuationCap / (BaseCap + P)`** (cap taken over the pre-money capitalization _including_ the new round's pool increase — the original pre-money safe's Company Capitalization is defined to include that increase; T-01 fix 4) and `discountPrice = (1 − discount) × PPS`. Missing term ⇒ the other governs (V14). Shares = `amount / price`. Pre-money SAFE shares are included in `T` (§6.1 step 2), and their entry into `A`, `P`, and PPS is solved jointly with the post-money SAFE route selection (§6.2.3).

**6.2.2 YC post-money SAFE — simultaneous closed form (cap route).** Each post-money SAFE `i` has locked ownership fraction `f_i = amount_i / valuationCap_i` of the post-SAFE, pre-new-money capitalization. Let `s = Σ_{i ∈ CAP_ROUTE} f_i` (validation V2 requires `Σ_all f_i ≤ 0.95`) and let `T_other` = the sum of shares from every non-cap-route converting security in this financing (pre-money SAFEs, discount-route post-money SAFEs, round-price-route post-money SAFEs). The cap-route shares satisfy

```
shares_i        = f_i × (BaseCap + T_other + Σ_{j∈CAP_ROUTE} shares_j)
```

which yields

```
Σ_{cap-route} shares = s × (BaseCap + T_other) / (1 − s)
shares_i             = f_i × (BaseCap + T_other) / (1 − s)
```

_(This closed form generalizes the "pure post-money" case where `T_other = 0`: same denominator `1 − s`, base is `BaseCap + T_other` instead of `BaseCap`. Ownership identity holds exactly: `shares_i / (BaseCap + T_other + Σ_{cap-route} shares) = f_i`.)_

**6.2.3 Global solve — routes, total SAFE shares `T`, pool increase `P`, PPS (replaces the old two-pass rule).**

The old two-pass rule is deleted. Under any fixed route assignment, `T`, `P`, and PPS are the solution to a **linear system**:

- Cap-route shares (as above) are affine in `(BaseCap + T_other)`; `T_other` is the sum of pre-money-SAFE shares + discount-route + round-price-route shares.
- Discount-route shares `s_i^{disc} = amount_i / ((1 − discount_i) × PPS)` are affine in `1/PPS`.
- Round-price-route shares `s_i^{rp} = amount_i / PPS` are affine in `1/PPS`.
- Pre-money-SAFE shares depend on `PPS` (via `discountPrice`) and on `P` (via `capPrice`).
- `P = (t·r·A − poolAvail) / (1 − t·r)` with `A = BaseCap + T` (§6.3).
- `PPS = V_pre / (A + P)` in `preMoney` mode; supplied directly in `pricedPerShare` mode.

Solve procedure:

1. **Initialize** every post-money SAFE to its cap route; every pre-money SAFE to whichever price rule is defined; solve the resulting linear system for `T`, `P`, PPS (closed form). _(In `pricedPerShare` mode, skip `P` per §6.3 addendum: use `P = 0` in the solve; PPS is the input; `T` still solves the SAFE linear system.)_
2. **Re-evaluate route optimality at the solved PPS.** For each post-money SAFE, compute the three-way max (§6.2.0). If any SAFE's optimal route ≠ its current route, **switch it** (route switches are monotone toward _more_ shares, hence lower PPS, hence never revert) and re-solve.
3. Repeat until no route switches; bound iterations at `#SAFEs + 1` (guaranteed by the monotonicity). Assert `iterations ≤ #SAFEs + 1` in dev mode.

_(Independent no-pool counterexample validating the deletion of the "two passes suffice" rule: BaseCap 10M, V_pre $10M, no pool, one $1M SAFE @ $20M post cap + 20% discount. Two-pass: pass 1 gives 526,315.79 sh, PPS 0.95; pass 2 gives 1,315,789.47 sh, PPS 0.883721; a third pass would give 1,414,473.7 sh — the old dev assert fires on valid input. Global solve: **1,428,571.43 sh, PPS $0.875, discount route wins__. This is distinct from F-SAFE-04 below, which adds a $2.5M round and a 10% target pool.)_

**6.2.4 Converted SAFE class (D12) — shadow-series rule.** Cap-route and discount-route post-money SAFEs and pre-money SAFEs convert into a **shadow series**: `kind = PREFERRED`, `holder =` the SAFE's `holder` flag (default OTHER; INVESTOR when the user marks a SAFE as the lead investor's), `invested = amount`, `shares =` the solved-share count, `originalIssuePrice = amount / shares` (so `capMultiple × invested` is the correct participation cap basis per D9/V11), **`prefMultiple`, `participation`, `participationCapMultiple`, `seniorityTier` inherited from the new round's class** (the tier is the one §6.1 step 4 computed _before_ SAFE conversion completes — the tier is data of the round, not of the SAFE), `antiDilution = 'NONE'`, `conversionRatio = 1`.

**Round-price-route** post-money SAFEs (that is, whichever SAFEs came out of §6.2.0 with the round-price max — a low-priced round where cap and discount are both dominated) instead convert into the **new round's class directly** (Standard Preferred, per the guide: "using the new-money price per share, cap not applied"). Operationally that means merging their shares into the new investor class's `shares`, adding their `amount` into the new class's `invested`, and — for `holder` — leaving the SAFE's share of the merged class as OTHER unless the SAFE's `holder = INVESTOR`, in which case they simply join the same class as the lead. _(Merging is the guide-faithful behavior; splitting the round-price-route SAFEs into per-SAFE classes is equivalent for waterfall math but bloats V7's class count.)_

The old §6.2.4 clause "1× non-participating" is deleted.

### 6.3 Pool shuffle + PPS closed form

Let `A` = fully-diluted pre-round shares _excluding_ the new pool increase (i.e., `BaseCap + T` per §6.1 step 3, with `T` the total shares of all converting SAFEs from §6.2), `poolAvail` = pre-existing unissued pool (already inside A), `t` = target pool fraction of post-round FD, `r = V_post/V_pre = (V_pre + I)/V_pre`. The pool increase created pre-money is:

```
P = ( t·r·A − poolAvail ) / ( 1 − t·r )        [clamp P to 0 with warning V4 if negative]
PPS = V_pre / (A + P)
N   = I / PPS
FD_post = A + P + N
```

_Derivation:_ PPS = V_pre/(A+P); N = I(A+P)/V_pre so FD_post = (A+P)(1 + I/V_pre) = (A+P)·r. Pool condition (poolAvail + P)/FD_post = t ⇒ poolAvail + P = t·r·(A+P) ⇒ P as above. Validation V3 requires `1 − t·r ≥ 0.05`.

**Direct-PPS mode (`pricedPerShare`) addendum (T-05).** When `RoundTerms.pricedPerShare` is supplied instead of `preMoney`: skip the pool-shuffle solve entirely — set `P = 0` (or, equivalently, leave the existing pool at `poolAvail` and emit `poolIncrease = 0` in diagnostics). Rationale: the user is modeling a signed deal at a known per-share price, not solving for one. `V3` is skipped (no `V_pre`). Diagnostics: `pps = the supplied price`; `N = I/pps`; `investorPct = N/FD_post` with `FD_post = A + N`; `poolIncrease = 0`. All `V_pre`-derived invariants (§6.1 step 6) are skipped in this mode.

**Worked check (fixture F-RND-01):** A = 9,000,000 (common 8.5M + issued options 0.5M), poolAvail = 0, V_pre = $8,000,000, I = $2,000,000, t = 0.10 ⇒ r = 1.25; P = 1,125,000/0.875 = **1,285,714.2857**; PPS = 8,000,000/10,285,714.2857 = **7/9 ≈ 0.7777778**; N = **2,571,428.5714**; FD_post = **12,857,142.857**; pool% = 10.0000%; investor% = 20.0000% = I/V_post. ✓

### 6.4 Anti-dilution (`antidilution.ts`)

**6.4.1 Broad-based weighted average (NVCA Model COI, 2020 revision, §4.4.4 — T-22):** for each protected class with pre-round conversion price `CP1` when the new round's `PPS < CP1`:

```
CP2 = CP1 × (A_bb + B) / (A_bb + C)
B = I / CP1          (shares that would have been issued at the old price)
C = I / PPS          (shares actually issued)

A_bb = "Common Stock Deemed Outstanding immediately prior to the new issue" per the NVCA Model COI:
     = common outstanding
     + all preferred as-converted at PRE-ROUND conversion ratios
     + shares issuable on issued option grants
     + as-converted shares of converting securities in this financing (SAFE shares, from §6.2)

     EXCLUDES: poolAvailable (unissued options are not outstanding), promisedOptions,
               and the new-round pool increase P.

newConversionRatio = originalIssuePrice / CP2
```

`CP1` is **frozen** at its pre-round value across every fixed-point iteration (T-05); it is `originalIssuePrice / conversionRatio_pre-round` for the protected class, computed once and cached. Adjusted ratios change as-converted shares in the waterfall and in FD. FULL_RATCHET: `CP2 = PPS`, same ratio update.

_(Note: some negotiated variants include the reserved pool inside the base; those are out of scope — the engine implements the NVCA base as specified above.)_

**6.4.2 Self-consistent PPS — layered around §6.2's global solve (T-01, T-05).** When the price is derived from V_pre and a protected class adjusts, its `conversionRatio` grows, which grows `BaseCap`, which triggers a full re-entry into the §6.2 global solve — SAFE shares, pool `P`, PPS all re-solve consistently. Outer iteration:

1. Compute BaseCap with current preferred `conversionRatio`s.
2. Run §6.2 global solve → `T`, `P`, PPS.
3. For each protected class with BWA / FULL_RATCHET and `PPS < CP1`, compute `CP2` and update `conversionRatio = OIP / CP2` (using frozen `CP1`).
4. If any `conversionRatio` changed by more than `1e-9` relative, go to 1.

Convergence: `|PPS_{k+1} − PPS_k| < 1e-9 × PPS_k` (or, equivalently, all `conversionRatio`s stable at 1e-9 relative), max **50 iterations**; throw `NonConvergence` after — surfaced as a validation error; property test §7.4 asserts convergence across the random battery.

When the user supplies PPS directly (`pricedPerShare` mode), apply §6.4.1 **once** and skip the outer loop — the direct-PPS mode is not self-consistent, matching what the legal document does; fixture F-RND-03's `pricedPerShare` variant uses this path. Diagnostics semantics in `pricedPerShare` mode are as §6.3's direct-PPS addendum specifies.

**Identity under the fixed point (T-05, worth remembering):** `PPS = V_pre/(A+P)` and `N = I/PPS` give `N/(A+P+N) = I/(V_pre+I) = I/V_post` _identically_, regardless of how much anti-dilution inflates the as-converted count of protected preferred classes. In `preMoney` mode, self-consistent anti-dilution therefore transfers value from **common** (whose per-share stake is diluted by the protected class's growing conversion ratio) to the **protected preferred**, and leaves the new investor's percentage untouched at `I/V_post`. This is a feature and is the correct behavior of self-consistent pricing; see explainer 6/7.

### 6.5 Waterfall at exit (`payoutsAt`) — exact, deterministic

Inputs: post-round `CapTable`, exit value `E ≥ 0`. Output: `$` per class and per option grant. Unissued pool receives $0 (D11).

**6.5.1 Structure — ascending-strike prefix option-exercise (T-03).** The old "add every ITM grant simultaneously, never un-exercise" loop is replaced. The new algorithm preserves the invariant **`pps_common > every exercised strike`** — hence net grant payouts `(pps_common − strike) × options ≥ 0` by construction, per the locked net-payout convention (§6.5.3 note).

```
payoutsAt(post, E):
  # Group grants by strike; group order = strike ascending, then id ascending (stable, deterministic).
  strikeGroups = groupByStrike(post.grants)
  exercised = ∅
  for k = 0, 1, 2, ...:                              # add one strike-group at a time
    g = cheapest remaining strike-group not in exercised
    if g is None: break
    trial = exercised ∪ g
    Edist_trial = E + Σ_{γ ∈ trial} γ.options · γ.strike
    result_trial = settleWithConversion(post, Edist_trial, trial)
    pps_trial = result_trial.perCommonShareProceeds
    if g.strike < pps_trial − EPS_DECISION:
      exercised = trial                              # commit; monotone increase in pps_common preserved
    else:
      break                                          # cheapest remaining group is not ITM at the new pps
  # Final settle at the committed exercised set.
  Edist = E + Σ_{γ ∈ exercised} γ.options · γ.strike
  result = settleWithConversion(post, Edist, exercised)

  # Final consistency check (LOCKED — this is the invariant, not a smell test):
  pps_final = result.perCommonShareProceeds
  assert every γ ∈ exercised has γ.strike < pps_final − EPS_DECISION
  assert every γ ∉ exercised has γ.strike ≥ pps_final − EPS_DECISION
  # If either assertion fails (a conversion interaction shifted pps_common in an unexpected direction),
  # fall back to enumerating prefixes k = |strikeGroups| ... 0 in decreasing order and select the largest
  # prefix that satisfies both consistency conditions. Deterministic; documented; a property test asserts
  # the primary loop suffices on the random battery.
  return result
```

Iteration bound = `#strikeGroups + 1` (each iteration commits at most one group; the last iteration verifies "no more ITM"), not the old `32`. Property test §7.4: over ≥ 40-grant tables with duplicate strikes, the consistency conditions hold, net payouts are ≥ 0, and conservation holds.

**Counterexample validating the change (fixture F-WF, T-03):** 1 common share; E = $100; grant g1 = 1 option @ $90 (holder OTHER); grant g2 = 100 options @ $0 (holder FOUNDER). The old algorithm would exercise both simultaneously (both "ITM" at initial `pps = $100`), giving `Edist = 190 / 102 shares = $1.8627/sh`, and g1's net payout `(1.8627 − 90) × 1 < 0` — a violation. The new algorithm exercises **only g2** (cheapest strike, $0 < the resulting `pps`); adding g1 next would require `$90 < pps`, which fails, so g1 stays unexercised. Result: `pps = 100/101 = $0.9900990`, `common = $0.9900990`, `g2 net = $99.0099`, `g1 net = 0`.

**6.5.2 Conversion equilibrium (D24, T-18, T-21).** The Gauss–Seidel loop unchanged; the fallback and its scope are tightened.

```
settleWithConversion(post, Edist, exercised):
  conv = ∅
  history = []                                       # last-2 pass decisions per class
  repeat ≤ 64 passes:                                # Gauss–Seidel in (tier asc, id asc) order
    changed = false
    for cls in preferredClasses:
      a = settle(conv \ {cls}).payout[cls]           # value on preferred path
      b = settle(conv ∪ {cls}).payout[cls]           # value converted
      want = (b > a + EPS_DECISION)
      if want ≠ (cls ∈ conv): toggle cls in conv; changed = true
    push snapshot of conv to history (keep last 2)
    if !changed: return settle(conv)

  # FALLBACK — scoped to the OSCILLATING SET (T-21):
  oscillating = { cls : cls's decision changed across the last two snapshots }
  frozen      = preferredClasses \ oscillating       # their action = their last-pass decision
  if |oscillating| > 8: throw NonConvergence         # V7 in its scoped form
  candidates = all subsets S of oscillating          # ≤ 2^8 = 256
  consistent = { S ∈ candidates : given (S ∪ (frozen ∩ conv)), every class in oscillating
                                  weakly prefers its assigned action (∈ S or ∉ S) }
  if consistent ≠ ∅:
    pick S* = argmin |S| over consistent; ties → lexicographically smallest id set
    return settle(S* ∪ (frozen ∩ conv))

  # No consistent subset — apply the min-regret rule (T-18):
  #   regret(S) = Σ_{cls ∈ oscillating} max(0, payout_other_action(cls | S) − payout_assigned(cls | S))
  # Pick S* = argmin regret; ties → smaller |S| → lexicographically smallest id set.
  S* = argmin regret over all subsets of oscillating
  result = settle(S* ∪ (frozen ∩ conv))
  result.warnings.push("conversion equilibrium: no consistent subset — used min-regret fallback")
  return result
```

Property test §7.4 [200 runs] over adversarial 2–4-class capped tables asserts `settleWithConversion` always returns and conservation holds under both fallback branches. Payout continuity in `E` is **not** guaranteed at min-regret boundaries; the regime walk's midpoint bisection recovery (§6.5.6 step 3, T-19) is what handles the resulting kink.

**6.5.3 `settle(conv)` — the deterministic split:**

```
remaining = Edist
# Preferences, by tier (D10):
for tier in ascending order:
  claims = { c : PREFERRED, c ∉ conv, c.tier = tier → prefAmount_c = prefMultiple_c × invested_c }
  paid   = min(remaining, Σ prefAmount)
  each c gets paid × prefAmount_c / Σ prefAmount     # pari passu pro-rata by preference
  remaining −= paid
# Residual pool (as-converted shares):
members = commonShares(all COMMON classes)
        ∪ convertedPreferred(c ∈ conv: shares_c × conversionRatio_c)
        ∪ exercisedOptionShares
        ∪ participants { c ∉ conv : participation = FULL or CAPPED, as-converted shares }
# Cap water-filling (D9 / V11: cap on TOTAL return, basis = capMultiple × invested per class):
active = members
loop ≤ |members|+1:
  allocate remaining pro-rata by shares among active
  newlyCapped = { c ∈ active, CAPPED : prefReceived_c + alloc_c > capMultiple_c × invested_c }  # V11
  if newlyCapped = ∅: commit allocations; break
  for c ∈ newlyCapped: pay exactly (capMultiple_c × invested_c − prefReceived_c);
                       remove c from active; remaining reduces only by the capped payments; re-loop
perCommonShareProceeds = residual allocation per as-converted share (0 if remaining = 0)
CONSERVATION (assert): | Σ all gross payouts − Edist | < max($0.01, 1e-8 × |Edist|)   # D16
strikeCashPaid = Σ_{γ ∈ exercised} γ.options × γ.strike                                 # T-16
```

**Cap basis (LOCKED per V11, T-12 #6).** The participation cap is **`capMultiple × invested`** per class (per-class total, inclusive of preference — D9). D9's "×OIP per share" wording has been superseded by V11; `OIP = invested/shares` when both are supplied (V11 refinement), so `capMultiple × invested = capMultiple × OIP × shares`, and the two descriptions coincide on well-formed input — but `capMultiple × invested` is the primary reference the engine uses.

**Option payout convention (LOCKED).** The _gross_ allocation to an exercised grant is `perCommonShareProceeds × options`; the _reported_ per-grant payout (in `Payouts.byGrant`, regimes, and all expected values) is **net of strike**: `(perCommonShareProceeds − strike) × options ≥ 0`. By construction of §6.5.1's prefix loop, `perCommonShareProceeds > strike` for every exercised grant, so the net payout is `≥ 0` as a **guaranteed invariant** (not an assumption). The conservation assertion above uses **gross** allocations against `Edist`, which includes the strike cash the grants paid in. Under this convention:

- `Σ Payouts.byClass + Σ Payouts.byGrant = E` (i.e., `Σ (net payouts as reported) = E`), because `Σ gross = Σ byClass + (Σ byGrant + strikeCashPaid) = Edist = E + strikeCashPaid`.
- `Payouts.strikeCashPaid` (new field, T-16) surfaces the gross-vs-net gap for the UI, so the Waterfall screen's conservation readout is **"Σ payouts = E ✓"** in the net convention, and a secondary line optionally shows the gross reconciliation `Σ gross = E + strike cash paid`.

Net payouts remain piecewise-linear in E, so regimes and closed forms apply unchanged.

**6.5.4 Conversion values:** a converted class forfeits preference and participates as common with `shares × conversionRatio`. The Gauss–Seidel comparison in 6.5.2 uses full recomputes of `settle` — no shortcuts.

**6.5.5 Known regimes worked example (fixture F-WF-02):** Common 8,000,000 sh (FOUNDER); Series A 2,000,000 sh, invested $2,000,000, OIP $1.00, 1×, PARTICIPATING CAPPED 3× (cap = $6,000,000 total), tier 1 (INVESTOR). No options, no pool.

| E range    | Series A       | Common    | Event at right edge                             |
| ---------- | -------------- | --------- | ----------------------------------------------- |
| [0, 2M]    | E              | 0         | preference filled at E = 2,000,000              |
| [2M, 22M]  | 2M + 0.2(E−2M) | 0.8(E−2M) | cap binds: 2M + 0.2(E−2M) = 6M ⇒ E = 22,000,000 |
| [22M, 30M] | 6M             | E − 6M    | conversion parity: 0.2E = 6M ⇒ E = 30,000,000   |
| [30M, ∞)   | 0.2E           | 0.8E      | —                                               |

Spot values (assert within D16 tolerance): E=20M → A 5.6M, C 14.4M; E=25M → A 6.0M, C 19.0M; E=40M → A 8.0M, C 32.0M. Breakpoints {2,000,000; 22,000,000; 30,000,000}.

**6.5.6 Exact breakpoints (`regimes`) — the regime walk:**

Payouts are exactly piecewise-linear in E. `regimes(post: CapTable)` takes only the cap table — beliefs, `V_post`, and any display-only exit ceiling are **not** inputs (T-02 removed the belief-dependent termination). Walk from E = 0:

1. At current regime start `E0`, probe `payoutsAt` at `E0 + Δ` and `E0 + 2Δ` (Δ = $1). If the two probes imply different slopes, bisect Δ until consistent (a kink sat inside Δ). Two consistent probes give **exact** per-holder coefficients `(m, c)` — linear interpolation inside a linear regime is exact, not approximate.
2. Build candidate next-event values of E, each a linear equation using current-regime state: (a) next tier fill: `E = (Σ prefAmounts of tiers ≤ k) − strikeCash`; (b) each CAPPED class: `m_c·E + c_c = cap_c` when `m_c > 0`; (c) each unconverted class: parity `payoutConverted_c(E) = payoutPreferred_c(E)` using probed coefficients of the flipped-set hypothetical (probe `settleWithConversion` with the class's conversion forced, at the same two points); (d) each unexercised grant: `perCommonShareProceeds(E) = strike`.
3. Next breakpoint candidate `B` = smallest candidate > `E0 + $0.001`. **Verify with midpoint bisection recovery (T-19):** before committing the regime `[E0, B)`, probe `payoutsAt` at the midpoint `(E0 + B)/2`. If the midpoint payout differs from the fitted line `m · E + c` (from step 1) by more than D16's tolerance (`max($0.01, 1e-8 × |expected|)`), an unclassified kink sits inside `[E0, B)` — bisect `[E0, B)` to locate it to within $0.001, insert it as a breakpoint with event label **"regime change (unclassified)"**, and continue the walk from there. Otherwise, verify the tentative `B` by probing just past it (coefficients must change; if not, discard candidate and take the next). Append regime `[E0, B)`, set `E0 = B`, repeat. Assert (dev mode) total _unclassified_ breakpoints per walk ≤ 2 (they should be rare; the label makes them visible rather than fatal — they arise from unenumerated event classes like T-18's min-regret boundaries).
4. **Termination — every event type is one-shot per object (T-02).** A tier fills once, a cap binds once, a class converts once, a grant exercises once — so the set of finite candidates is finite and monotonically shrinks. Walk **until no finite verified candidate remains**; the final regime is `[E0, ∞)`. Assert regime count ≤ `4·(#classes + #grants) + #tiers + 8` (backstop). _(There is no belief-dependent `E_max` in the engine any more — the display-only exit ceiling used by the Waterfall slider lives in §8.3.)_
5. **Cross-check test (Phase 2):** dense grid of 2,001 points over `[0, max(E_max_display, 2 × largest breakpoint)]` — piecewise evaluation from regimes vs direct `payoutsAt`, max abs diff ≤ D16 tolerance. (`E_max_display` is defined in §8.3.)
6. **Property test — final-regime slope (T-02 counterexample as a locked fixture).** For a cap table with `common = 100,000,000 sh` + `preferred = 1,000,000 sh, invested = $1,000,000, prefMultiple 1×, participation NONE, CR = 1, tier 1`, `regimes` must contain a regime boundary at **E = 101,000,000**, and the final regime's slope for the preferred class = **1/101 per preferred share** (i.e., the conversion parity kink is not truncated). A property test asserts, on random tables, that the last regime's coefficients equal the slopes of `payoutsAt` probed at `10 × (last breakpoint)`.

### 6.6 Numerics & distributions

**6.6.1 Lognormal fit** (`fitLognormal`): `μ = ln p50`. If both p10, p90: `σ = (ln p90 − ln p10)/(2·z90)`; push warning "beliefs not lognormal-consistent" if `|exp((ln p10 + ln p90)/2) − p50| > 0.10·p50`. If only p90: `σ = (ln p90 − ln p50)/z90`. `z90 = 1.2815515655446004`. Require σ > 0.

**6.6.2 Partial moments** for X ~ LN(μ,σ), with `α = (ln a − μ)/σ`, `β = (ln b − μ)/σ`:

```
intervalProb(a,b)       = Φ(β) − Φ(α)
partialExpectation(a,b) = exp(μ + σ²/2) · [ Φ(β − σ) − Φ(α − σ) ]      # = E[X·1{a<X≤b}]
```

**6.6.3 Φ (erfc-based double-precision rational, Cody 1969, |ε| ≤ 1e-13 absolute).** Compute `Φ(x) = 0.5 · erfc(−x / √2)` using a hand-rolled double-precision `erfc` implementation. Reference: W. J. Cody, "Rational Chebyshev approximations for the error function," _Math. Comp._ 23 (1969), pp. 631–637 — the canonical piecewise rational approximation used by libm and NAG. Layout (region boundaries and coefficient counts as published in Cody's Table II):

- For `|x| ≤ 0.46875`: use the rational for `erf(x)` and set `erfc(x) = 1 − erf(x)`.
- For `0.46875 < |x| ≤ 4.0`: use the rational for `erfc(x)` directly.
- For `|x| > 4.0`: use the asymptotic rational `erfc(x) ≈ (exp(−x²)/(x√π)) · R(1/x²)` with the coefficient set for the tail.

Symmetry: `Φ(−x) = 1 − Φ(x)`, applied after the erfc evaluation (so the identity holds to `≤ 1e-15` absolute). `numerics.ts` must use these Cody coefficients verbatim (all published digits; arrays retain the source's order):

```ts
const A = [
  3.1611237438705656, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3,
  1.85777706184603153e-1,
]
const B = [
  2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3,
]
const C = [
  5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2,
  8.8195222124176909e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
  2.15311535474403846e-8,
]
const D = [
  1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
  3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3,
]
const P = [
  3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2,
  6.58749161529837803e-4, 1.63153871373020978e-2,
]
const Q = [
  2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1, 6.05183413124413191e-2,
  2.33520497626869185e-3,
]
```

Achieved accuracy target: `|Φ_impl(x) − Φ_true(x)| ≤ 1e-13` for `|x| ≤ 40`.

**Micro-oracles (unit tests on `phi`, absolute tolerance 1e-12):**

| x   | Φ(x)               |
| --- | ------------------ |
| 0   | 0.5                |
| 0.5 | 0.6914624612740131 |
| 1   | 0.8413447460685429 |
| 2   | 0.9772498680518208 |
| 3   | 0.9986501019683699 |

Plus the symmetry property `Φ(−z) = 1 − Φ(z)` to `≤ 1e-15` on random `z ∈ [−10, 10]` (property test).

**Φ⁻¹ (Acklam, |rel ε| < 1.15e-9):** with `p_low = 0.02425`, `p_high = 1 − p_low`:
central region (p_low ≤ p ≤ p_high): `q = p − 0.5, r = q²`, `x = q·(((((a₁r+a₂)r+a₃)r+a₄)r+a₅)r+a₆) / (((((b₁r+b₂)r+b₃)r+b₄)r+b₅)r+1)`;
lower tail (p < p_low): `q = √(−2 ln p)`, `x = (((((c₁q+c₂)q+c₃)q+c₄)q+c₅)q+c₆) / ((((d₁q+d₂)q+d₃)q+d₄)q+1)`; upper tail symmetric (negate with `q = √(−2 ln(1−p))`).

```
a = [-3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00]
b = [-5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01]
c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
     -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00]
d = [ 7.784695709041462e-03,  3.224671290700398e-01,  2.445134137142996e+00,
      3.754408661907416e+00]
```

**Hardcoded z-table (unit tests for both functions):** p ∈ {.05, .10, .25, .50, .75, .90, .95} → z ∈ {−1.6448536269514722, −1.2815515655446004, −0.6744897501960817, 0, 0.6744897501960817, 1.2815515655446004, 1.6448536269514722}. Assert `|phiInv(p) − z| < 1e-8` (Acklam's 1.15e-9 relative bound; T-24 note: Φ⁻¹ feeds only quantile display and `Q_E(p)`, not fixture-asserted expectations) and `|phi(z) − p| < 1e-12` (Cody-erfc; tightened from 1e-7 per T-24 so the z-table is not a false-positive filter for the tolerance policy).

**6.6.4 PRNG:** mulberry32 (implement verbatim):

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

Normals via Box–Muller on consecutive uniforms `u1 = max(u, 1e-12)`, `u2`; emit `√(−2 ln u1)·cos(2πu2)` then `√(−2 ln u1)·sin(2πu2)`, in that order. Determinism test: seed 1, first 5 uniforms snapshot-asserted.

### 6.7 Closed-form outcome statistics (`outcomes.ts`)

For holder h with regimes `{(B_k, B_{k+1}, m_k, c_k)}` and beliefs `{p0, μ, σ}` (mixture D4):

```
E[payout_h] = p0·0 + (1−p0) · Σ_k [ m_k·partialExpectation(B_k, B_{k+1}) + c_k·intervalProb(B_k, B_{k+1}) ]
```

Payout quantile (payouts are monotone nondecreasing in E — property-tested): `Q_h(p) = payoutsAt(post, Q_E(p))[h]` where `Q_E(p) = 0` if `p ≤ p0`, else `exp(μ + σ·phiInv((p − p0)/(1 − p0)))`. Party-level quantiles sum the party's classes and grants at the same `Q_E(p)` (comonotonicity — §4.3 holder-id semantics).

**Party attribution (LOCKED):** `uF` = Σ E[payout] over classes and grants with `holder = FOUNDER`; `uI` = Σ over `holder = INVESTOR`. `OTHER` holders (prior investors, converted SAFEs by default, employee options) are fully modeled in the waterfall but excluded from both bargaining utilities.

### 6.8 Utilities, BATNAs, optional risk mode

Default utility = expected dollars under the party's **own** belief profile (D5, D6). Cross-belief columns `uF_underI`, `uI_underF` are computed by swapping profiles (used by the Frontier table's bet columns — §8.5). BATNAs are user scalars (D7) in the active metric — dollars in EV mode, **certainty-equivalent dollars in CE (CRRA) mode** so `uF/dF/uI/dI` share units; the Frontier BATNA inputs are labeled accordingly. Helper copy locked: founder — "Expected personal proceeds from your best alternative: another offer, bootstrapping, or winding down."; investor — "Expected dollars from deploying this capital in your next-best opportunity (e.g., amount × expected net multiple)."

**CRRA mode (off by default) — bargaining coordinates and computation (T-09).**

- **Coordinates.** `uF` and `uI` on `DealPoint` are the party's **certainty equivalent in dollars** under the CRRA(γ, w0) preference over `(payout + w0)`. Nash and KS are affine-invariant so they select the same argmax whether ranked on `U` or `CE`; egalitarian and utilitarian are not scale-invariant, and they are ranked on **CE dollars** so their comparisons are dollar-vs-dollar across parties. One explainer sentence (explainer 7) notes the `w0` dependence caveat: egalitarian/utilitarian comparisons across parties presume both parties chose comparable `w0`.
- **Computation — deterministic quadrature, not MC (LOCKED for the frontier).** For each package and party, given regimes `{(B_k, B_{k+1}, m_k, c_k)}` and beliefs `{p0, μ, σ}`: per regime `[B_k, B_{k+1})`, evaluate `∫_{q ∈ [q_k, q_{k+1}]} u(m_k · Q_LN(q) + c_k + w0) dq` by fixed **64-node Gauss–Legendre** in probability space, where `q_k = Φ_LN(B_k)` and `Q_LN` is the lognormal quantile. The `p0` mass is handled only by the outer mixture: `(1 − p0) · Σ_k ∫ + p0 · u(w0)`. Invert `U` to `CE` via the standard CRRA transform (below). Budget: ~ 585 packages × 2 parties × (avg regimes ≈ 5–8) × 64 evaluations ≈ ~750k `u` evaluations per recompute — fits the § 4.4 CRRA-on budget.
- **MC survives only as (i) the dual-engine test check (§7.3) and (ii) the per-package "± SE" inspector badge that surfaces when the user opens a package.** `crraUtility(...)` still returns `{ u, se, ce }` (see §4.3), with `u/se` from MC at D17's CRRA sample count `n = 100,000, seed = 0xC0FFEE`, and `ce` derived either from MC (the badge path) or from the quadrature `U` (the frontier path); the two ce values must agree within `4 · se_ce` in the CRRA fixture below.

**CRRA transform (LOCKED):** `U = E[((x + w0)^{1−γ} − 1)/(1−γ)]` (γ = 0.5) or `E[ln(x + w0)]` (γ = 1); certainty equivalent `CE = (U · (1−γ) + 1)^{1/(1−γ)} − w0` (γ ≠ 1) or `CE = exp(U) − w0` (γ = 1); MC-error propagation `se_CE ≈ se_U · (CE + w0)^γ`. The Frontier CRRA badge shows "± $x MC error" only when MC is what backed the computation (the inspector); the frontier itself is deterministic and displays no ± band.

**Fixture (T-09).** F-BRG-CRRA-01: one specified package + one belief profile + γ = 0.5, w0 = $250k; the CE computed by 64-node quadrature and the CE computed by MC at n = 200,000 (seed 42) must agree within `4 · se_CE`.

### 6.9 Bargaining layer (`bargain.ts`)

#### 6.9.1 Enumeration & indexing (LOCKED — reproducible package IDs, T-06)

1. **Loop order (outer→inner):** `preMoney` → _(investment = `space.pinnedInvestment`, copied from the current offer per D2/T-04; no loop dimension)_ → `pools` → `multiples` → `participations`. Every emitted `TermPackage.terms.investment` is this pinned value. This is the row-major dimension order the grid `index` is assigned over.
2. **Ranges are inclusive linspace.** `preMoneySteps = 1` → the range's **lower bound** (this convention also applies for any future single-step range).
3. **Indices are assigned over the RAW grid**, including holes from V1-invalid `(multiple, participation)` pairs. This makes indices stable, hole-tolerant, and reproducible across sessions and dev-space edits.
4. **V1-invalid combinations** (see D3 validity table) are **skipped with a recorded reason** and no `DealPoint` emitted; their raw index is preserved so subsequent packages keep their expected numbers. **V3 failures** are also skipped with a recorded reason. **V4** (existing pool exceeds target) _clamps `P` to 0 with a warning_ and the package **stays in the grid** — V4 is a warning, not a skip reason, per §5 V4.
5. Default raw grid = `9 × 5 × 4 × 4 = 720`; 3 of 16 `(multiple, participation)` pairs are V1-invalid, so **valid = 585**. All package-count claims elsewhere in this document reference 585 (or the number the shipped default produces, if the team ever changes D3).

#### 6.9.2 Evaluate

Each valid package: `constructRound` → `regimes` → `expectedPayouts` under each profile → `DealPoint`. Under CRRA (§6.8), the closed-form step is replaced by the 64-node Gauss–Legendre quadrature (§6.8); `DealPoint.metric = 'CE'` in that case, `'EV'` otherwise.

#### 6.9.3 IR set

`uF ≥ dF ∧ uI ≥ dI`. Empty ⇒ `zopa = false`; report and skip solutions.

#### 6.9.4 Pareto frontier

Sort by `(uF desc, uI desc, index asc)`; keep a point iff its `uI` strictly exceeds the running max; exact-duplicate utility pairs collapse to lowest index. **The frontier is computed over ALL evaluated points, not IR-only** (the IR filter enters solutions via §6.9.5–6.9.7); §6.9.8 intersects the frontier with IR when defining value-on-table.

#### 6.9.5 Nash

Argmax over IR of `(uF − dF)(uI − dI)`. **Tie-break (D23):** max gain-product → lowest package index. _(Both keys are invariant under per-axis positive affine maps.)_

#### 6.9.6 Kalai–Smorodinsky (discrete)

Discrete surrogate for the classical Kalai–Smorodinsky (1975): ideal `I_F = max uF`, `I_I = max uI` over IR; maximize `min((uF−dF)/(I_F−dF), (uI−dI)/(I_I−dI))` over the discrete cloud. This is _not_ the classical KS solution (which lives on the ideal-line segment for compact convex sets) — it's the maximin-normalized-gain point on a finite non-convex set, labeled **"Kalai–Smorodinsky (discrete)"** everywhere the user sees it (see glossary, explainer 7, F-BRG). If either denominator is 0, fall back to Nash with a note. **Tie-break (D23):** max min-normalized-gain → max gain-product → lowest index. Both keys are invariant under per-axis positive affine maps.

#### 6.9.7 Egalitarian & utilitarian

**Egalitarian:** argmax `min(uF − dF, uI − dI)`. **Tie-break (D23):** max sum of gains → lowest index. (The sum tie-break guarantees the Pareto-membership property picks a frontier member: if two points tie on `min`, the one with higher sum lies on the frontier or below it, and the tie ordering plus §6.9.4's collapse handles equal pairs.)

**Utilitarian:** argmax `(uF−dF) + (uI−dI)`. **Tie-break (D23):** max gain-product → lowest index. When profiles differ, the sum is labeled **"perceived total surplus"** in the UI (it sums across different measures; explainer 7 covers why that is a bet, not a free lunch).

_(The F-BRG divide-the-dollar utilitarian answer `x = 1` from x=0/x=1 tie is what the "max gain-product" tie-break resolves: `(0·100) = 0` vs `(√1)·(100−1) = 99`; F-BRG-04 cites this D23 rule.)_

#### 6.9.8 Value on the table (T-10)

For a current offer `c` (evaluated at its exact terms — even off-grid — into a `DealPoint`), define the **eligible dominating set**

```
D = { d ∈ points ∩ IR : uF(d) ≥ uF(c) − ε ∧ uI(d) ≥ uI(c) − ε ∧ d ≠ c },   ε = $1.
```

Return:

- **`headline`** (the hero scalar, single-package joint surplus): `headline = max_{d ∈ D} [ (uF(d) − uF(c)) + (uI(d) − uI(c)) ]` (0 if `D = ∅`). This is a scalar attainable by one package, so the hero copy "$X on the table" is a statement about a specific package — not a sum of two different-package maxima.
- **`gainF` / `gainI`** (per-party ceilings, labeled "best case for you / for them (usually different packages)"): `gainF = max(0, max_{d ∈ D, uI(d) ≥ uI(c)} uF(d) − uF(c))`, symmetric for `gainI`.
- **`dominating`** (up to 3 package indices): `D` ranked by `min(ΔuF, ΔuI) desc → (ΔuF + ΔuI) desc → index asc`, top 3.

Requires `DealPoint`-level access to compute utility deltas; `BargainResult.points` (see §4.3) carries the evaluated set in index order.

### 6.10 Employee offer analyzer (`employee-offer.ts`)

Given pre-round `CapTable`, optional `Safe[]`, `RoundTerms`, a candidate `OptionGrant`, and `Beliefs`:

1. `constructRound` → post-round table.
2. Issue the grant from `poolAvailable` (hard error if `options > poolAvailable`).
3. Optionally `accrueForExit(yearsToExit)`.
4. Reuse `expectedPayouts` / `payoutQuantile` / `payoutValue` for the grant id.
5. `surplusVsCash = presentValue(EV) − cashAlternative` under optional `discounting`.

No new settlement physics — the grant is an ordinary cash-exercise instrument (D11).

### 6.11 Warrants

`OptionGrant.instrument ∈ {OPTION, WARRANT}` (default `OPTION`). Settlement is identical: cash-exercise treasury method (§6.5.3). The flag exists for labeling and FD attribution only.

### 6.12 Pay-to-play

Preferred may carry `payToPlay: 'NONE' | 'TO_COMMON'`. `RoundTerms.payToPlayParticipants` lists class ids meeting their obligation. Before the priced round, any `TO_COMMON` preferred **not** listed converts to a COMMON class with `shares × conversionRatio` and loses preference rights.

### 6.13 Dividends

Preferred may carry `dividendRate` (annual decimal) and `dividendKind ∈ {NONE, SIMPLE, CUMULATIVE}`.
Given `yearsToExit = T ≥ 0`:

- SIMPLE: `accrued = invested × rate × T`
- CUMULATIVE: `accrued = invested × ((1+rate)^T − 1)`
- NONE or rate=0 or T=0: `accrued = 0`

`accrueForExit` stamps `accruedDividends`. Preference claim = `prefMultiple × invested + accruedDividends` (before redemption max — §6.14).

### 6.14 Redemption rights

Preferred may carry `redemptionMultiple` and `redemptionEligibleYears`. When `yearsToExit ≥ redemptionEligibleYears`, `redemptionClaim = redemptionMultiple × invested`; else 0.
**Preference claim** = `max(prefMultiple × invested + accruedDividends, redemptionClaim)`.

### 6.15 Convertible notes (`notes.ts`)

`ConvertibleNote = { principal, interestRate, interestKind ∈ {SIMPLE, COMPOUND}, accrualYears, valuationCap?, discount?, … }`.
Accrued amount = `principal + accruedInterest(...)` (same simple/compound formulas as §6.13).
Notes project to **pre-money SAFE**-shaped instruments with `amount = accrued` and convert under §6.2.1 (cap vs discount only — never the post-money three-way max). Passed into `constructRound(..., notes)`.

### 6.16 MFN on SAFEs (`mfn.ts`)

Before `solveSafes`, `applyMfn(safes)`: for each SAFE with `mfn: true`, set `valuationCap = min(cohort caps)` (when any defined) and `discount = max(cohort discounts)` (when any defined). Non-MFN SAFEs unchanged. Citation framing: YC SAFE MFN side-letter practice (`https://www.ycombinator.com/documents`, retrieved 2025-01-14).

### 6.17 Secondary sales (`secondary.ts`)

`applySecondary(pre, sale)` moves `shares` from `sellerClassId` to a buyer COMMON class. Proceeds = `shares × pricePerShare` go to the seller — **not** the company. Total share count is conserved.

### 6.18 IRR / time-discounting (`discounting.ts`)

Opt-in only. `DealFile.discounting: { annualRate, yearsToExit } | null`.
`DF = 1 / (1 + annualRate)^yearsToExit` (DF = 1 if null, rate=0, or years=0).
`evaluatePackage` and the employee analyzer multiply dollar utilities by DF when set. **Default remains undiscounted exit proceeds (D15).**

### 6.19 Multi-party syndicate bargaining (`bargain-n.ts`)

The discrete cloud **does** support n≥2. `analyzeN(points, disagreement, partyOrder)`:

- IR: `u_i ≥ d_i` ∀i
- Nash: argmax `∏(u_i − d_i)` (Nash 1950 n-person product)
- KS (discrete): argmax `min_i (u_i−d_i)/(I_i−d_i)` with `I_i = max_IR u_i`
- Egalitarian: argmax `min_i (u_i − d_i)`; Utilitarian: argmax `Σ(u_i − d_i)`
  Tie-breaks generalize D23 (axiom key → gain-product → lowest index; egalitarian uses sum as secondary).
  Two-party `analyze` is unchanged (D1 UI default). Label KS as **"Kalai–Smorodinsky (discrete)"**.

### 6.20 409A / fair-value (`fairvalue.ts`)

Educational estimate only: `fairValuePerShare = preferredPps × percentOfPreferred` (default 0.30). Method `PERCENT_OF_PREFERRED_PPS`. Not an appraisal. Citation framing: IRS IRC §409A audit technique guide (`https://www.irs.gov/businesses/corporations/nonqualified-deferred-compensation-audit-technique-guide`, retrieved 2025-01-14).

---
