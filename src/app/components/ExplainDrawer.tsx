import { useState } from 'react'

type Explainer = { id: number; title: string; screens: string[]; bullets: string[]; body: string }

export const EXPLAINERS: Explainer[] = [
  {
    id: 1,
    title: 'Why the waterfall is piecewise-linear',
    screens: ['waterfall'],
    body: 'A liquidation waterfall is affine while the same preferences, participation caps, conversion choices, and option-exercise decisions apply. A preference filling, a cap binding, a class conversion, or an option crossing its common-price strike creates a kink and starts a new affine segment. Between those kinks, exact slopes and intercepts replace interpolation. That structure lets the model integrate each segment against a lognormal exit distribution with closed-form partial moments.',
    bullets: [
      'Payouts are affine while the same preferences, caps, conversion choices, and option exercises apply.',
      'A preference filling creates a kink.',
      'A participating cap binding creates a kink.',
      'A class conversion creates a kink.',
      'An option crossing its common-price strike creates a kink.',
      'Between kinks, the exact slope and intercept need no interpolation.',
      'Lognormal expected payout is therefore a closed-form sum of partial moments.',
    ],
  },
  {
    id: 2,
    title: 'Preferences, participation, and caps',
    screens: ['round', 'cap-table'],
    body: 'A 1× non-participating preferred holder receives whichever is better: its preference or its common conversion value. Participation adds a residual share after the preference, sometimes called a second bite. CAP2 and CAP3 limit total proceeds at the stated multiple of invested capital, so the cap matters in the dollar region between the participation and preference paths. The basis is cap multiple × original issue price × shares, which is cap multiple × invested capital. A cap can therefore change economics without changing the preference multiple.',
    bullets: [
      'A 1× non-participating holder takes the better of preference and common conversion.',
      'Participation adds a residual share after preference: a second bite.',
      'CAP2 and CAP3 cap total proceeds at the stated multiple of invested capital.',
      'The cap matters in the dollar area between participation and preference paths.',
      'Cap times OIP times shares is cap times invested capital.',
      'Caps are a participation term that can change without changing the preference multiple.',
    ],
  },
  {
    id: 3,
    title: 'The pool shuffle',
    screens: ['round', 'cap-table'],
    body: 'The financing targets a post-round option-pool fraction of fully diluted shares. New pool shares are created before new money, so existing holders absorb that dilution: this is the pool shuffle. The model solves the locked closed-form pool increase jointly with price per share. A larger target lowers PPS and raises new-money shares, while investor percentage remains tied to round value. With no existing reserve, common bears the shuffle; if the existing reserve already exceeds target, the increase clamps to zero and the model reports a warning.',
    bullets: [
      'The financing targets a post-round pool fraction of fully diluted shares.',
      'New pool shares are created before money, so existing holders absorb dilution.',
      'The solved pool increase uses the locked closed-form expression.',
      'A larger pool lowers PPS and raises new-money shares while investor percentage stays tied to round value.',
      'With no existing reserve, common bears the shuffle.',
      'If the existing reserve already exceeds target, the increase clamps to zero with a warning.',
    ],
  },
  {
    id: 4,
    title: 'SAFEs: pre vs post-money',
    screens: ['round', 'cap-table'],
    body: 'Pre-money SAFEs price at conversion and dilute the pre-money capitalization. Post-money SAFEs instead lock an ownership fraction before new money; their Company Capitalization includes other converting SAFEs. For each eligible post-money SAFE, cap, discount, and round-price routes compete for the most shares. A low-priced round can make the round-price route win even when a cap exists. Before a round, adding amount-to-cap fractions is a useful ownership sanity check, but the full solve still accounts for every interacting conversion route.',
    bullets: [
      'Pre-money SAFEs price at conversion and dilute the pre-money capitalization.',
      'Post-money SAFEs lock an ownership fraction before new money.',
      'Post-money Company Capitalization includes other converting SAFEs.',
      'Cap, discount, and round-price routes compete for the most shares.',
      'A low-priced round can make the round-price route win.',
      'Adding amount/cap fractions is a useful pre-round ownership check.',
    ],
  },
  {
    id: 5,
    title: 'From beliefs to distributions',
    screens: ['beliefs'],
    body: 'Each party’s exit model combines a point mass at zero with a lognormal success distribution. P50 fixes the lognormal location and P90 fixes its spread; P10 is optional consistency evidence. Success percentiles shown in the interface are conditional on a nonzero exit, while a failure probability of one half or more makes the overall median zero. Expected payouts are closed-form partial moments summed across waterfall regimes. Simulation is reserved for validation and the optional CRRA inspection, not for the primary expected-value calculation.',
    bullets: [
      'The model combines a point mass at zero with a lognormal success distribution.',
      'P50 fixes lognormal location and P90 fixes spread; P10 is optional consistency evidence.',
      'Displayed success percentiles are conditional on a nonzero exit.',
      'A failure probability of at least one half makes the overall median zero.',
      'Expected values use closed-form partial moments across regimes.',
      'Simulation is reserved for validation and optional CRRA inspection.',
    ],
  },
  {
    id: 6,
    title: 'ZOPA, BATNAs, and the disagreement point',
    screens: ['frontier', 'report'],
    body: 'Fairness concepts need a no-deal baseline. A founder BATNA is expected personal proceeds from the best alternative, while an investor BATNA is expected value from the next-best deployment. Together they form the disagreement point. The zone of possible agreement contains packages both parties weakly prefer to those baselines. An empty ZOPA means no package currently clears both stated alternatives. BATNAs are inputs supplied by the negotiating parties; this tool does not recommend them.',
    bullets: [
      'Fairness concepts require a no-deal baseline.',
      'A founder BATNA is expected personal proceeds from the best alternative.',
      'An investor BATNA is expected value from the next-best deployment.',
      'ZOPA contains packages both parties weakly prefer to those baselines.',
      'An empty ZOPA means no package currently clears both stated baselines.',
      'BATNAs are inputs, not recommendations from this tool.',
    ],
  },
  {
    id: 7,
    title: 'Nash, Kalai–Smorodinsky (discrete), and belief bets',
    screens: ['frontier', 'report'],
    body: 'The Nash marker maximizes the product of gains over disagreement and is affine-invariant. The discrete Kalai–Smorodinsky marker equalizes normalized gain fractions over the enumerated package grid, so it is explicitly labeled discrete rather than the continuous classical solution. Egalitarian and utilitarian rules compare dollar coordinates, including certainty-equivalent dollars in risk mode. Certainty equivalents are comparable only when each party’s w0 baseline is meaningful for that party; do not read cross-party CE differences as welfare comparisons. Different beliefs can make caps and participation mutually attractive bets, so perceived total surplus is labeled as a combination of each party’s own belief measure.',
    bullets: [
      'Nash maximizes the product of gains over disagreement and is affine-invariant.',
      'Kalai–Smorodinsky equalizes normalized gain fractions.',
      'This application uses a discrete grid, so the KS marker is explicitly discrete.',
      'Egalitarian and utilitarian rules compare dollar coordinates, including CE dollars when risk mode is active.',
      'Different beliefs can make caps and participation mutually attractive bets.',
      'Perceived total surplus is labeled because it combines each party’s own belief measure.',
    ],
  },
  {
    id: 8,
    title: 'Value left on the table',
    screens: ['frontier', 'report'],
    body: 'A dominated offer has another attainable package that makes both parties weakly better off. The headline value left on the table is the joint gain from one such package, while each party’s maximum gain can occur at a different package. The displayed alternatives are ranked by their balanced win first. Win-win moves often trade terms that each side prices differently under its beliefs. Every result remains conditional on those beliefs and carries the same educational, non-advice disclaimer as the rest of the model.',
    bullets: [
      'A dominated offer has an alternative that makes both parties weakly better off.',
      'The headline is the joint gain from one attainable package.',
      'Per-party ceilings can occur at different packages.',
      'Top alternatives are ranked by their balanced win first.',
      'Win-win moves often trade terms each party prices differently.',
      'The result is conditional on beliefs and carries the same educational disclaimer.',
    ],
  },
]

export function ExplainDrawer({ screen }: { screen: string }) {
  const [open, setOpen] = useState(false)
  const visible = EXPLAINERS.filter((explainer) => explainer.screens.includes(screen))
  if (visible.length === 0) return null
  return (
    <div className="explain">
      <button
        type="button"
        className="quiet-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Explain this
      </button>
      {open && (
        <div className="explain-drawer">
          {visible.map((explainer) => (
            <article key={explainer.id}>
              <h3>{explainer.title}</h3>
              <p>{explainer.body}</p>
              <ul>
                {explainer.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export function AllExplainers() {
  return (
    <section className="all-explainers">
      <h3>How the analysis works</h3>
      {EXPLAINERS.map((explainer) => (
        <details id={`explainer-${explainer.id}`} key={explainer.id}>
          <summary>
            {explainer.id}. {explainer.title}
          </summary>
          <p>{explainer.body}</p>
          <ul>
            {explainer.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  )
}
