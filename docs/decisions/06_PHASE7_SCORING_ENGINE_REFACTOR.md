# Phase 7 — Scoring Engine Refactor (base + bounded deltas)

**Goal:** Replace the dilutive weighted-average combinator with a **calibrated meta baseline adjusted by signed, bounded, confidence-scaled deltas**, so synergy and counters can actually reorder results. Introduce the new `FactorModule.contribute` contract and structured `ReasonChip`. Migrate config to v2. Port the existing counter and synergy modules to the new contract **without changing their data**, so this phase is behavior-preserving under a meta-forward preset.

**Depends on:** nothing hard (can be built before or after Phase 6). It does *not* need TeamContext yet — `contribute` accepts a `TeamContext` argument that ported modules ignore for now.
**Blocks:** Phases 8, 9, 11.

---

## 1. Why this phase exists

`01_ARCHITECTURE_REVIEW.md` §2.2: a weighted average of ~0.5-centered scores cannot let a narrow-band factor reorder results. This phase changes the *shape* of the combinator so a confident synergy/counter signal produces a real, bounded movement — and so a *bad* matchup or *redundant* pick can push a champion **down** (signed deltas), which the current all-positive average cannot express.

This is the highest-leverage and highest-risk phase. Its calibration harness is the gate.

---

## 2. Scope

### Modified files
- `src/main/engine/engine.ts` — the combinator (`createRecommendation`, `combineScoredCandidates`, `weightedAverage`, `getFactorWeight`). This is the heart of the change.
- `src/shared/types.ts` — add `FactorContribution`, `ReasonChip`, `ReasonKind`; keep `ScoreContribution`/`Recommendation` available (extend, don't break, or migrate carefully with the renderer).
- `src/shared/config.ts` — `FactorWeights` v2 (`meta`, `laneCounter`, `teamCounter`, `synergy`, `compFit`); `migrateConfig` v1→v2; new defaults/presets; bump `APP_CONFIG_VERSION` to 2.
- `src/main/engine/factors/counterModule.ts` — implement `contribute` returning a signed delta + `ReasonChip[]`. Same underlying matchup data.
- `src/main/engine/factors/synergyModule.ts` — implement `contribute` returning a signed delta + `ReasonChip[]`. Same underlying synergy data (tier comes in P8).
- `src/main/index.ts` — wire weights for the (currently two) factors under the new schema; register `teamCounter`/`compFit` weights as inert until P8/P9 add their modules.
- Tests: extend `recommendationEngine.test.ts`, `counterModule.test.ts`, `synergyModule.test.ts`, `appConfigStore.test.ts`; add `test/scoringCalibration.test.ts`.

### NOT in scope
- TeamContext consumption (P8/P9). `contribute` receives `ctx` but ported modules may ignore it.
- New factors' logic (P8/P9). Their *weights* and slider slots may be added now (inert), or in their own phases — either is fine; document the choice.
- Rich reason rendering (P11). This phase only needs reasons to *exist* as structured data; the renderer can keep flattening `ReasonChip[]` → `string[]`.

---

## 3. The new combinator (normative)

Implement exactly the model in `03_TARGET_ARCHITECTURE.md` §3.3:

```
metaBase(candidate)     ∈ [BASE_LO, BASE_HI]      // recenter existing meta score (engine.ts:316-330)
effectiveDelta(f)       = clamp(f.delta, -DELTA_CAP, +DELTA_CAP) * weight[f.key] * f.confidence
total                   = clamp01( metaBase + Σ_f effectiveDelta(f) )
```

Design rules:
- **Meta is the base, not a summed factor.** Remove meta from the weighted list. The `meta` weight now controls **base spread**: define `metaBase = 0.5 + (metaScore − 0.5) * spread(metaWeight)`, where `spread` maps `metaWeight∈[0,1]` to a multiplier (e.g. 0→bases compress toward 0.5, 1→bases use full `[BASE_LO,BASE_HI]`). Pick a concrete mapping and pin it with the calibration test.
- **Each factor delta is signed and bounded**, then scaled by `weight[f.key]` and by `f.confidence`. Confidence is the home for all hedging/uncertainty (role inference, sample size). A factor that can't speak returns `{ delta: 0, confidence: 0, reasons: [] }` and is a no-op.
- **`rerankLatest` still works without refetching**: keep caching the raw `FactorContribution`s per candidate (as today with `latestScoredCandidates`, `engine.ts:40`) and only recompute the combinator when weights change. The current `rerankLatest` path (`engine.ts:90-100`) must keep its "no network on slider move" property.
- **Limited-data note** logic (`engine.ts:224-230`) ports over: if all weights are zero, fall back to ordering by `metaBase` alone and note it.

### Porting the existing factors to deltas (behavior-preserving)
- **Counter:** today maps matchup WR via `mapMatchupWinRate` to `[0,1]` then confidence-pulls toward 0.5 (`counterModule.ts:38-39`). New: `delta = (mappedScore − 0.5) * 2 * DELTA_SCALE_counter`, `confidence = roleConfidence`. Keep the hedged-chip wording, now emitted as a `ReasonChip` whose `polarity`/`confidence` drive the "Likely/Possibly/Favored/Risky" language.
- **Synergy:** today averages per-ally scores to a ~0.5 scalar (`synergyModule.ts:74-75`). New: `delta = (avgScore − synergyNeutral) * DELTA_SCALE_synergy`, where `synergyNeutral` is the empirical center of the synergy score distribution (≈0.5 or the source's `NO_NOTABLE_SYNERGY_SCORE` baseline — pick and document). Crucially, **do not re-flatten**: the delta is allowed to be small now, but P8 will widen it by switching to tier; this phase just makes the *plumbing* delta-shaped. Emit per-ally chips as before (P8 enriches).

The point of porting now: after P7, ordering under **"Trust the meta"** must match today (deltas tiny relative to wide base spread), proving no regression; under a **synergy/counter-forward** preset, the *plumbing* already lets deltas move things (even if synergy's magnitude only becomes dramatic in P8).

---

## 4. Calibration harness (the gate for this phase)

Add `test/scoringCalibration.test.ts` that:
1. Loads 2–3 fixture drafts (a clean lane matchup; a draft with strong/weak synergy partners locked; an all-AD ally comp once P6 lands — or a stub TeamContext here).
2. For each of the named presets (meta-forward, coach, lane-bully, team-comp), computes the resulting top-5 ordering.
3. Asserts:
   - **Meta-forward ≈ today's ordering** on a draft with no strong synergy/counter signal (regression guard).
   - **Coach/synergy-forward preset reorders** the top 5 vs meta-forward in at least one motivated fixture (proves deltas bite).
   - **Totals stay in a believable band** (e.g. all in `[0.2, 0.85]`), no clamping pileups at 0 or 1.
   - **A bad matchup produces a lower total than the same champion with an even matchup** (signed delta works).

This test is the definition of "calibrated." If it can't be satisfied, the constants (`BASE_LO/HI`, `DELTA_CAP`, `DELTA_SCALE_*`, the `spread` mapping) are wrong — fix them, don't relax the test.

---

## 5. Config migration (v1 → v2)

- Map old `weights.counter` → `weights.laneCounter`. Default new `teamCounter` and `compFit` to chosen baseline values.
- Bump `APP_CONFIG_VERSION` to 2; extend `migrateConfig` (`config.ts:115-125`); cover with a test in `appConfigStore.test.ts` that loads a v1 config blob and asserts the v2 shape + correct `laneCounter` carry-over.
- Re-express presets per `02_PRODUCT_DIRECTION.md` §5. Whether the new default is "Coach" or stays meta-forward is a product decision (see `11_RISKS_AND_OPEN_QUESTIONS.md`); ship the presets, and set the default per the product owner's answer.

---

## 6. Acceptance criteria

- [ ] Combinator implements `metaBase + Σ clamp(delta)·weight·confidence`; meta is the base, not a sum term.
- [ ] Under "Trust the meta" preset, top-5 ordering on a neutral fixture matches the pre-refactor engine (regression guard in calibration test).
- [ ] Under a synergy/counter-forward preset, the top-5 reorders on at least one motivated fixture.
- [ ] A worse lane matchup yields a strictly lower total than an even one for the same candidate (signed delta).
- [ ] `rerankLatest` recomputes ordering on weight change with **no** network calls (cached contributions).
- [ ] Config migrates v1→v2 with `counter→laneCounter`; covered by test.
- [ ] `FactorContribution` + `ReasonChip` exist and are emitted by both ported modules; renderer still works (flatten to strings is fine).
- [ ] All existing tests pass; honesty (confidence-dampening, shrinkage) preserved.

---

## 7. Handoff notes

- P8/P9 implement new modules against `contribute(candidate, draft, ctx)` and return deltas — the contract is frozen here. If you discover the contract needs another field (e.g. a `breakdown` for per-ally synergy), add it **now** as optional so P8/P9 don't reshape it.
- Keep the `DELTA_SCALE_*` constants in one named place (a `scoringConstants.ts` or top of `engine.ts`) so calibration is one file to reason about.
- Leave a clear TODO where ported synergy computes its delta noting "P8 replaces avgScore with tier-led score" so the next executor finds the seam.
