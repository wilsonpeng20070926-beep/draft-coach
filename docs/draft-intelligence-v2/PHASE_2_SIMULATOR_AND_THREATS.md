# Phase 2 Prompt — Simulator and Anticipated Threats

Implement hypothetical drafting on top of the explicit target model from Phase 1. Read `MASTER_SPEC.md` first.

## Scope

1. Add a pure, serializable simulation state separate from live LCU state. Support reset, undo, role assignment, bans, ally/enemy picks, hovers, locks, and target selection.
2. Do not let simulation mutate or impersonate the League client. It is an offline/manual planning surface.
3. Add enemy targets with purpose `anticipate`. Their result answers “what pick should we prepare to counter?” rather than pretending to recommend for a real opponent.
4. Add `AnticipatedThreat` with forecast/manual/simulation source and confidence. Users can pin or remove threats.
5. Forecast likely enemy threats using available ranked role presence, enemy locked-pick synergy, answers into allied locked picks, enemy composition needs, and current bans. Keep this provider interface-ready for Phase 4 pro evidence.
6. Feed pinned/forecast threats into allied team-counter scoring at reduced, visible confidence. Manual threats rank above forecasts but remain labeled hypothetical.
7. For unpicked enemies whose role is not available from LCU, infer remaining roles where possible and allow manual selection. Never claim certainty.
8. Add basic navigation between Live and Simulator. Full visual design belongs to Phase 6.

## Required tests

- simulation undo/reset and no leakage into live state;
- enemy target role selection/inference;
- threat forecast determinism;
- manual Dr. Mundo threat raises suitable anti-health/team-counter candidates and explains why;
- hypothetical evidence is confidence-dampened;
- pinned threat removal restores the original ranking;
- bans and locked picks are excluded correctly.

Run `npm run typecheck`, `npm test`, and `npm run build`. Do not add professional network access in this phase.
