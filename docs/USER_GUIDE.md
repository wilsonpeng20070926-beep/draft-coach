# User Guide

Draft Coach is designed to stay beside the League client during champion select.

## Basic Flow

1. Start the League client and log in.
2. Start Draft Coach.
3. Enter champ select.
4. Wait for Draft Coach to show `In champ select`.
5. Review recommendations once your role is known.
6. Use the category chips to compare overall, lane, synergy, composition, pro-inspired, and risk views.
7. Expand `Why` or `Show evidence` to inspect exact score and professional evidence.
8. Open settings to tune ranked factors, professional influence, favorite teams, and data refresh.

## Live And Simulator Modes

`Live` follows League champ select. Simultaneous allied pick turns appear as separate target tabs, with the local player first. Clicking an allied slot temporarily overrides automatic focus until the active turn changes. Clicking an enemy slot opens the hypothetical `Prepare to counter` workflow.

`Simulator` is offline planning state. It supports roles, hovers, locks, picks, bans, target selection, anticipated threats, undo, and reset without changing the live draft. Favorite teams add a visible strategy context; no favorite is selected by default.

## Reading Recommendations

Each recommendation has:

- champion name and icon
- total score
- reason chips for the most useful signals
- `Why` details with factor-level scoring
- a specific risk label when traceable negative evidence exists
- concise professional evidence when enabled, with exact sample/confidence detail on expansion

Positive chips indicate a candidate is helped by the draft state. Negative chips indicate risk, such as a difficult lane matchup or vulnerability into enemy threats.

`Avoid` is reserved for high-confidence negative evidence. Softer cases appear as `High risk` or `Poor fit`. Hypothetical enemy forecasts are labeled and can be pinned or removed; they are never presented as known picks.

## Composition Panel

The composition panel summarizes:

- allied physical and magic damage balance
- team needs that are currently missing or satisfied
- enemy threat pressure that can punish certain picks

Use it as context, not as an automatic answer. Draft Coach does not know your champion mastery, duo plans, voice comms, or team strategy.

## Settings

Presets:

- `Coach`: balanced draft-aware recommendations.
- `Trust the meta`: mostly meta strength.
- `Lane bully`: lane matchup and enemy pressure.
- `Team comp`: ally synergy and composition needs.

Advanced controls:

- `Meta`: role meta strength.
- `Lane`: direct lane matchup value.
- `Team`: how enemy team threats affect the pick.
- `Synergy`: known ally pair value.
- `Comp fit`: whether the pick fills team needs.
- `Top N`: number of cards shown.
- `Pick floor`: filters very low-sample picks.
- `Shrink K`: reduces overreaction to small samples.
- `Chip confidence`: minimum confidence for visible chips.
- `Professional evidence`: turns the pro snapshot contribution on or off.
- `Pro influence`: adjusts the bounded professional contribution.
- `Favorite teams`: accepts multiple comma-separated teams for Pro-inspired and simulator context.
- `Refresh professional data`: checks for a new snapshot without blocking live recommendations.

The lightweight professional-data details surface shows source and age. Stale, unavailable, disabled, and ranked-only states remain visibly labeled.

## Limitations

- Recommendations depend on external data availability and response shape.
- Historical professional continuation is evidence, not proof of a uniquely correct pick.
- Professional evidence is confidence-shrunk and cannot remove uncertainty caused by team strength, limited samples, or draft context.
- Role inference can be wrong when League or data-source role signals are thin.
- Draft Coach cannot account for player mastery, planned swaps, voice comms, or matchup-specific game plans.
- The app is read-only. It does not lock champions, automate gameplay, or inject into the game process.
- The app does not collect automatic recommendation telemetry. Feedback is manual and opt-in.
