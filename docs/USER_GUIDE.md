# User Guide

Draft Coach is designed to stay beside the League client during champion select.

## Basic Flow

1. Start the League client and log in.
2. Start Draft Coach.
3. Enter champ select.
4. Wait for Draft Coach to show `In champ select`.
5. Review recommendations once your role is known.
6. Expand `Why` to see score details.
7. Open settings to tune the ranking style.

## Reading Recommendations

Each recommendation has:

- champion name and icon
- total score
- reason chips for the most useful signals
- `Why` details with factor-level scoring

Positive chips indicate a candidate is helped by the draft state. Negative chips indicate risk, such as a difficult lane matchup or vulnerability into enemy threats.

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

## Limitations

- Recommendations depend on external data availability and response shape.
- Role inference can be wrong when League or data-source role signals are thin.
- Draft Coach cannot account for player mastery, planned swaps, voice comms, or matchup-specific game plans.
- The app is read-only. It does not lock champions, automate gameplay, or inject into the game process.
