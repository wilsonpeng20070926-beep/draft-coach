# Scoring and Category Calibration

Draft Coach keeps ranked and professional evidence separate through scoring. Ranked contributions are labeled `ranked`; professional contributions retain their structured snapshot evidence and are labeled `pro`. The displayed ranked/pro balance is calculated from the absolute confidence-adjusted deltas actually used by the displayed recommendations, not from settings.

## Default evidence order

The default qualitative order is:

1. Lane matchup
2. Ally synergy
3. Ranked meta anchor
4. Enemy-team answer
5. Allied composition need
6. Professional priority and flex evidence
7. Recent professional success

New-install ranked factor weights are lane `0.75`, synergy `0.55`, meta `0.55`, enemy answer `0.35`, and composition fit `0.30`. Existing user values migrate unchanged. Professional enrichment has smaller bounded delta scales: lane `0.075`, synergy `0.065`, enemy response `0.055`, composition pattern `0.045`, priority/flex `0.040`, and success `0.025`. All deltas remain subject to the engine's signed `±0.16` cap and confidence multiplication.

These numbers are calibration constants guarded by motivated fixtures. They are not claims that one source or factor has a universal objective value.

## Professional safeguards

- A signal needs at least three effective appearances before its delta can affect ordering.
- One-game evidence remains inspectable as an observation with a zero scoring delta.
- Professional candidate expansion requires material priority plus material role-presence or flex evidence.
- Disabling professional evidence, or having no valid snapshot, preserves ranked-only behavior.
- Professional refresh and query aggregation are not part of reranking; reranking uses cached scored candidates only.

## Category projection

Candidates are scored once and then projected without additional data calls:

- Best overall: up to 5.
- Best lane matchup: up to 3, with an overall score floor of `0.40`.
- Best synergy: up to 3, with confidence of at least `0.45`.
- Best composition answer: up to 3.
- Pro-inspired: up to 3, requiring material evidence with at least 3 effective appearances.
- Avoid / High risk: up to 3 candidates with traceable negative or poor-fit evidence.

Categories may overlap and unsupported categories are omitted.

## Risk language

`Avoid` requires a traceable negative effective delta of at least `0.075` in magnitude with confidence of at least `0.75`. Lower-confidence evidence uses `High risk` at confidence `0.55` or above, otherwise `Poor fit`. Weak role evidence and unmet allied composition needs can produce the softer labels. A non-material professional observation cannot produce a risk label by itself.
