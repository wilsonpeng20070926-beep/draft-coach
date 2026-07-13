# Phase 5 Prompt — Blended Scoring, Categories, and Risk

Integrate professional evidence without turning it into an opaque bonus. Read `MASTER_SPEC.md` first.

## Scope

1. Keep ranked and professional evidence separately inspectable. Let pro evidence enrich lane matchup, synergy, team counter, composition patterns, and role priority; add a bounded pro-priority/flex factor where no ranked analogue exists.
2. Preserve the qualitative default order: lane, synergy, ranked meta, enemy answer, allied need, pro priority/flex, tournament success. Treat exact values as calibration constants with tests and documentation.
3. Preserve signed bounded deltas, confidence scaling, shrinkage, deterministic tie-breaking, candidate caps, and zero-network reranking.
4. Expand candidate generation so repeated pro-supported and flex/off-meta role-valid picks can enter without passing the ordinary OP.GG top-meta gate. Keep role validity and minimum-evidence safeguards.
5. Score each candidate once, then project:
   - Best overall: 5;
   - Best lane matchup: 3 with overall-safety floor;
   - Best synergy: 3 with confidence floor;
   - Best composition answer: 3;
   - Pro-inspired: 3 with sample safeguards;
   - Avoid / High risk: hover plus popular/likely candidates, up to 3.
6. Permit overlap. Omit unsupported categories rather than filling them with noise.
7. “Avoid” requires high-confidence, traceable negative evidence; use “High risk” or “Poor fit” below that threshold. Include lane danger, enemy vulnerability, redundant composition, and invalid/weak role fit. Never condemn a pick from one pro game.
8. Calculate displayed ranked/pro balance from absolute confidence-adjusted evidence actually used. Do not display configured weights as if they were observed evidence.
9. Ensure anticipated threats affect enemy-answer scoring at their reduced confidence and are clearly labeled hypothetical.

## Required tests

- motivated fixtures reflect the agreed factor order;
- repeated current-patch pro evidence can reorder Best overall;
- a single pro game cannot materially reorder it;
- supported off-meta candidate enters the pool;
- category projection, overlap, limits, floors, and omission;
- Avoid confidence/language thresholds;
- ranked-only parity when pro data is disabled/missing;
- ranked/pro balance math;
- anticipated threat reordering;
- reranking makes no data-source calls.

Run `npm run typecheck`, `npm test`, and `npm run build`.
