# Phase 7 Prompt — Evaluation, Calibration, and Release Gates

Prove Draft Intelligence v2 is trustworthy before release. Read `MASTER_SPEC.md` first.

## Scope

1. Build deterministic draft-scenario fixtures covering lane, synergy, ranked meta, enemy answer, allied need, pro priority, international weight, favorite-team evidence, flex, off-meta, Avoid, hover, and anticipated threats.
2. Build an offline historical replay harness that reveals held-out professional drafts one action at a time. Report top-1/top-3/top-5 continuation recall, reciprocal rank, category coverage, risk calibration, and latency. Do not claim the actual pro pick was uniquely correct.
3. Prevent data leakage: evaluation games cannot contribute to the aggregates used to predict themselves. Split chronologically or rebuild training snapshots per evaluation window.
4. Compare ranked-only, current engine, blended default, and pro-forward configurations. Record motivated wins, regressions, and confidence calibration rather than optimizing a single vanity metric.
5. Add a structured expert-review worksheet for real live drafts and a privacy-preserving feedback process. Do not add automatic telemetry without a new explicit product decision.
6. Tune constants only with documented before/after evidence. Preserve the confirmed qualitative priority and one-game suppression.
7. Stress stale, corrupt, missing, rate-limited, and schema-changed pro data. Verify last-known-good and ranked-only fallback.
8. Measure cold/warm recommendation latency and memory. Refresh must remain off the champ-select critical path.
9. Complete public-release review: Riot registration/policies, attribution, Leaguepedia/API and snapshot redistribution permission, Oracle noncommercial restriction, privacy, checksums, and source freshness wording.
10. Before any monetization, create an explicit blocker requiring legal/data-license review and replacement of noncommercial-only dependencies.

## Final acceptance

- all master-spec acceptance criteria pass;
- no local-player coupling remains in recommendation factors;
- the simulator and live mode cannot contaminate each other;
- the blended default beats or meaningfully complements ranked-only across documented scenarios without confidence inflation;
- unsupported novelty and one-game pro picks remain quiet;
- every visible recommendation and warning is traceable;
- offline and failure modes work;
- `npm run typecheck`, `npm test`, `npm run build`, security scan, Electron smoke test, and release checks pass where applicable;
- final documentation states remaining limitations honestly.

Produce a concise calibration report and release recommendation: ready, beta-only, or blocked, with evidence.
