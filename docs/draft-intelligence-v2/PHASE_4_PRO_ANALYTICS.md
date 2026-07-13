# Phase 4 Prompt — Patch-Aware Pro Analytics

Turn the validated snapshot into explainable professional evidence. Read `MASTER_SPEC.md` first.

## Scope

1. Implement effective weights: current patch `1.0`, previous `0.45`, two back `0.20`, older `0`; international multiplier `1.5`; competition tier multiplier; team-quality clamp `0.85–1.15`.
2. Derive confidence-shrunk signals for:
   - pick/ban priority per opportunity, with bans discounted;
   - role presence and flex value;
   - allied role-pair synergy lift;
   - same-role matchup and broader enemy-response evidence;
   - composition/archetype patterns;
   - success with stronger shrinkage than presence;
   - team-specific tendencies.
3. Require repeated evidence before material score impact. Start with three effective appearances and calibrate later. One game may appear only as a low-confidence observation.
4. Add favorite-team config with no default. Favorite evidence has modest overall strength and stronger Pro-inspired strength. Support multiple favorites and migrations.
5. Produce structured evidence records containing concise text, exact expandable statistics, patches, competitions, teams, effective sample, confidence, and age.
6. Extend enemy forecasting with professional role priority, pairings, responses, and team-specific strategy only in simulator/favorite-team contexts.
7. Keep analytics pure and offline after snapshot load. Cache aggregate queries and avoid candidate-by-candidate scans of raw games.

## Required tests

- patch and international weighting;
- bounded team-quality weighting;
- one-game suppression and repeated-evidence activation;
- ban discount and flex detection;
- shrunk pair/matchup estimates;
- no favorite by default and multiple favorites;
- exact concise evidence formatting;
- excluded leagues and old patches contribute zero;
- identical input produces deterministic evidence.

Run `npm run typecheck`, `npm test`, and `npm run build`. Do not finalize category UI in this phase.
