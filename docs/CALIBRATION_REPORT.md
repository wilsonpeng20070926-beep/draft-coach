# Draft Intelligence v2 Calibration Report

Review date: 2026-07-11

Release recommendation: **blocked for public release; suitable for controlled local beta evaluation**.

The implementation gates are green. Public distribution remains blocked until the machine-readable policy status records Riot product registration plus Leaguepedia and OP.GG public-use/redistribution reviews. This is an external approval boundary, not an engine failure.

## Evidence summary

| Area | Result | Evidence |
|---|---|---|
| Deterministic signal coverage | Pass | 13 required signal kinds in `scenarioEvaluation.test.ts`; focused production tests mapped in `docs/EVALUATION.md` |
| Four-configuration comparison | Pass | `configurationComparisonEngine.test.ts` runs ranked-only, current ranked engine, blended default, and pro-forward through the production engine |
| One-game suppression | Pass | `proAnalytics.test.ts` and `blendedProScoring.test.ts` keep a single observation non-material |
| Off-meta discovery | Pass | Candidate-pool and blended-scoring fixtures surface a supported off-meta candidate |
| Avoid traceability | Pass | Risk projection requires confidence, negative magnitude, and material professional evidence |
| Replay leakage controls | Pass | Strictly earlier windows, duplicate-game rejection, and same-timestamp exclusion in `draftReplayEvaluation.test.ts` |
| Failure modes | Pass | Missing, stale, corrupt, schema-changed, and HTTP 429 cases retain last-known-good or degrade to ranked-only |
| Live/simulator isolation | Pass | Simulator command tests preserve the serialized live draft unchanged |
| Local-player independence | Pass | `targetIndependence.test.ts` and explicit-target engine tests |
| Traceability | Pass | Renderer and production-engine comparison require visible evidence/reasons |

## Configuration interpretation

- Ranked-only is the conservative meta reference, not the product target.
- Current ranked engine adds lane, team-counter, synergy, and comp-fit without professional evidence.
- Blended default adds bounded, confidence-shrunk pro evidence. It complements the ranked baseline in motivated fixtures without dropping the baseline candidate.
- Pro-forward is a sensitivity analysis. It stays inside supported configuration bounds by compressing ranked weights rather than inventing a multiplier above the product maximum.

The exact numeric weights were not retuned in Phase 7. Existing constants remain protected by the motivated calibration fixtures. Future changes require a before/after replay and scenario report; a single aggregate metric is insufficient.

## Local performance sample

Command:

```bash
EVALUATION_REPORT=1 npx vitest run test/recommendationPerformance.test.ts --reporter=verbose
```

Observed on the 2026-07-11 local offline fixture:

- cold recommendation: 8.57 ms;
- warm cached rerank mean: 0.64 ms;
- warm cached rerank p95: 1.09 ms;
- peak heap growth: 372,128 bytes (0.36 MiB);
- resident-set growth: 638,976 bytes (0.61 MiB).

This sample is not a hardware-independent promise. The executable limits are intentionally much looser: cold <1,000 ms, warm p95 <100 ms, peak heap growth <50 MiB.

## Historical replay status

The replay harness and leakage rules are implemented and tested with minimized synthetic normalized drafts. A real held-out Leaguepedia replay has not been recorded in this repository because the project does not have documented snapshot redistribution approval and deliberately does not check in an unreviewed historical archive.

Before changing the recommendation from blocked to public-beta-ready:

1. resolve the public policy gates in `docs/RELEASE_POLICY_STATUS.json`;
2. run the replay harness on an approved local dataset and record coverage plus all four configurations;
3. complete structured expert review on real drafts;
4. rerun the complete quality, security, smoke, and packaging matrix.

## Remaining limitations

- Professional continuation recall measures resemblance to observed drafts, not unique strategic correctness.
- Match loss is only a proxy for risk calibration and is confounded by team strength and execution.
- Expert review has not yet supplied enough real-draft samples to justify tuning constants.
- OP.GG, Leaguepedia, and Riot policies can change; review dates must remain visible.
- Signed/negative advice is evidence-gated but cannot account for player mastery, swaps, comms, or planned compositions.
