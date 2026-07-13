# Draft Intelligence Evaluation

Draft Intelligence uses three complementary forms of evidence. A professional continuation is a useful reference outcome, not proof that it was the only correct pick.

## Deterministic scenarios

Run the executable scenario, replay, performance, and resilience gates with:

```bash
npm run evaluation:test
```

The scenario manifest covers every Phase 7 signal. Production behavior is pinned by the listed focused tests:

| Signal | Primary executable proof |
|---|---|
| Lane matchup | `test/counterModule.test.ts`, `test/scoringCalibration.test.ts` |
| Ally synergy | `test/synergyModule.test.ts`, `test/scoringCalibration.test.ts` |
| Ranked meta | `test/recommendationEngine.test.ts`, `test/scoringCalibration.test.ts` |
| Enemy answer | `test/teamCounterModule.test.ts`, `test/blendedProScoring.test.ts` |
| Allied need | `test/compFitModule.test.ts` |
| Pro priority | `test/blendedProScoring.test.ts` |
| International weighting | `test/proAnalytics.test.ts` |
| Favorite-team evidence | `test/proAnalytics.test.ts` |
| Flex evidence | `test/proAnalytics.test.ts` |
| Off-meta candidate | `test/candidatePool.test.ts`, `test/blendedProScoring.test.ts` |
| Avoid / High risk | `test/categoryProjection.test.ts` |
| Hover evaluation | `test/recommendationEngine.test.ts`, `test/rendererExperience.test.tsx` |
| Anticipated threat | `test/threatForecast.test.ts`, `test/blendedProScoring.test.ts` |

The comparison configurations are defined in `src/main/evaluation/evaluationConfigurations.ts`:

- `ranked-only`: pure ranked meta anchor.
- `current-engine`: production ranked draft factors, professional evidence disabled.
- `blended-default`: production ranked factors plus confidence-shrunk professional evidence.
- `pro-forward`: sensitivity profile with compressed ranked weights and the maximum supported professional influence.

`test/configurationComparisonEngine.test.ts` runs all four through the production recommendation engine. It records motivated improvements without removing the ranked baseline from the candidate list and requires visible recommendations to remain traceable.

## Historical replay

`src/main/evaluation/draftReplay.ts` is the offline replay core. It:

1. sorts normalized professional games chronologically;
2. trains each held-out window only on games with a strictly earlier `playedAt` value;
3. reveals the held-out picks in action order;
4. asks a supplied predictor for each configuration at every continuation step;
5. reports top-1/top-3/top-5 continuation recall, reciprocal rank, category coverage, top-1 confidence calibration, risk-outcome calibration, traceability, and latency.

`src/main/evaluation/engineReplayAdapter.ts` binds those steps to the production `RecommendationEngine`. It rebuilds the aggregate snapshot from the training window only, normalizes either historical side as the allied recommendation side, reconstructs locked revealed picks and bans, and converts production categories, warnings, and evidence into replay metrics. The caller supplies the approved local dataset, champion catalog, and production engine factory.

The harness rejects duplicate game identifiers and throws if a held-out game can enter its own training set. Games sharing the held-out timestamp are excluded from training, which is deliberately stricter than ordering them by identifier.

The repository does not check in a historical Leaguepedia archive. Run real held-out replay only against a locally fetched, validated dataset whose use has been approved. This avoids turning an evaluation fixture into an unreviewed redistribution channel. The synthetic replay fixture proves the harness and leakage invariants; it is not presented as a production-quality metric.

## Metric interpretation

- Top-k recall asks whether the observed next pick appeared in the recommendation set.
- Reciprocal rank rewards a correct continuation near the top without treating lower ranks as total failures.
- Category coverage asks whether any projected category contained the continuation.
- Top-1 Brier score checks confidence inflation against whether rank one matched.
- Risk Brier score uses match loss as a noisy outcome proxy. It does not establish that a warning caused or uniquely predicted the result.
- Traceability is the share of visible top-five recommendations carrying at least one non-empty evidence explanation.
- Latency is measured around the predictor call only.

Always report dataset dates, leagues, patches, split rule, skipped games, and evaluated step count beside replay metrics. Do not compare reports whose coverage differs without calling out the difference.

## Performance

`src/main/evaluation/resourceBenchmark.ts` separates the first cold recommendation from warm cached operations and records p95 latency, heap growth, and resident-set change. `test/recommendationPerformance.test.ts` exercises the production engine and requires:

- cold recommendation below 1,000 ms on the offline fixture;
- warm cached rerank p95 below 100 ms;
- peak heap growth below 50 MiB.

These are regression gates, not universal hardware guarantees. Record a fresh sample in the calibration report for each release candidate.
