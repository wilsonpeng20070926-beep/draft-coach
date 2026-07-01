# 01 — Architecture Review (Current State)

**Scope:** A grounded review of the Draft Coach codebase as it stands at commit `bc205ed` ("Implement phase 4 tuning settings"). File/line references are to the repo at that commit. This document is the evidence base for the redesign; the redesign itself lives in `03_TARGET_ARCHITECTURE.md`.

---

## 1. What is genuinely well built (keep these)

These are strengths the redesign must preserve, not disturb.

- **Clean process model.** All network/secret work in main; renderer is UI over typed IPC (`src/main/preload.ts`, `src/main/ipc.ts`). Correct and safe.
- **The `FactorModule` growth seam.** `engine.ts:5-9` defines a factor as `{ key, enabled, score(candidate, draft) }`. New factors slot in and (via the weights map) get a slider. **This is the single best architectural decision in the project** and the redesign leans on it heavily.
- **`MetaDataSource` interface isolates OP.GG** (`src/main/data/metaDataSource.ts`). The data vendor can be swapped or supplemented without touching the engine. Essential for what comes next.
- **Caching + patch-versioned keys** (`src/main/data/cache.ts`). TTL cache keyed by `[patchVersion, ...]`. Solid; we will lean on it more, not less.
- **Honesty mechanisms.** Empirical-Bayes shrinkage toward 50% (`engine.ts:332-340`), pick-rate confidence (`engine.ts:356-366`), role-inference confidence dampening the counter (`counterModule.ts:37-39`), and the "Likely vs / Possibly vs" hedged chips (`counterModule.ts:64-89`). The product's instinct to never overclaim is right and must survive the rebalance.
- **Role inference as a model to imitate.** `roleInference.ts` already does the thing we need more of: derive a structured judgment (role + confidence) from champion identity, with a graceful tag-based fallback (`createTagPrior`, `roleInference.ts:87-126`) when data is missing. The TeamContext model in Phase 6 is deliberately built in this same shape.

---

## 2. The core finding: the pipeline is meta-first *by construction*

The product owner's complaint ("over-focused on OP.GG win rates") is not a tuning artifact. It is structural. There are **three independent places** where meta wins before synergy/counter can speak, and no combination of slider values fixes any of them.

### 2.1 The candidate pool is selected and ranked by meta (the meta gate)

`engine.ts:76-80`:

```
const candidates = laneMeta
  .filter((entry) => isRoleCandidate(entry, options))
  .filter((entry) => !excludedChampionIds.has(entry.champion.id))
  .sort((a, b) => compareLaneMeta(a, b, options))   // sort by META score
  .slice(0, options.candidateCap);                  // keep top 30 by META
```

`candidateCap` is 30 (`config.ts:45`). **Synergy and counter never see a champion that isn't already a top-30 meta pick for the role.** A champion who is a mediocre meta pick but a *perfect* synergy partner for the locked allies — exactly the pick a human coach would call out — is filtered out before the synergy module runs. The factors are re-rankers inside a meta-chosen set, not discoverers.

This is the most important finding in this document. **Emphasizing synergy/counter is impossible while candidate generation is meta-only.** (Addressed in Phase 10.)

### 2.2 The combinator is a weighted average of ~0.5-centered scores (the dilution)

`engine.ts:201-210` computes the final score as `Σ(score·weight) / Σweight`. Every factor returns a value in `[0,1]` centered near 0.5:

- Meta is normalized into roughly `[0.47, 0.54]` win rate → score band (`engine.ts:324`).
- Counter maps a 42–58% matchup into `[0,1]` (`counterModule.ts:52-54`) but is then pulled back toward 0.5 by role-confidence (`counterModule.ts:39`).
- **Synergy is the worst case:** the real OP.GG pairwise win-rate signal lives in ~0.48–0.53, and the module averages it across allies (`synergyModule.ts:74-75`), so it arrives at the combinator as a number a hair away from 0.5.

In a weighted average, a factor that is always ≈0.5 **cannot move the ranking regardless of its weight** — multiplying a near-zero deviation by a larger weight is still near-zero. `PROJECT_STATUS.md` §6 records this as a "known characteristic" ("synergy nudges rather than reorders... intentionally not amplified"). It is more accurately described as a *structural ceiling*: the combinator shape, not the data, is what flattens synergy. (Addressed in Phase 7.)

### 2.3 Synergy and counter are thin, single-signal re-rankers

**Counter** (`counterModule.ts:16-49`) only considers `draft.laneOpponent` — a single enemy champion. And `laneOpponent` is only resolved when *exactly one* enemy is known in the player's role (`draftManager.ts:198-200`); otherwise it's null and counter returns a flat 0.5. So counter contributes nothing about:
- the enemy *composition* (e.g. three dive threats, a hard-engage support, a fed-scaling carry to respect),
- which enemy carry this pick punishes,
- matchups in lanes other than the player's.

**Synergy** (`synergyModule.ts` + `opggMcpSource.ts:882-921`) does do per-candidate, per-ally lookups (good, fixed in Phase 3.7). But:
- It collapses everything to a single averaged scalar (`synergyModule.ts:74-75`), discarding the per-ally structure that would make a useful explanation.
- It under-uses the strongest available signal. OP.GG returns `synergy_tier_data.tier` (0=OP, 1=S, 2=A, 3=B, 4=C) — a curated ranking with far more discriminating power than the 0.48–0.53 win-rate band. In `normalizeSynergyScore` (`opggMcpSource.ts:882-921`) tier is just *one of several signals averaged together*, so a "tier 0 / OP synergy" pairing gets blended back down toward the mean. The curated discriminator is diluted by the noisy one.
- It is purely pairwise. It has no concept of whether the pick *completes the team* (adds missing AP, adds a frontline, adds engage). That "does this finish our comp" judgment is what users mean by synergy at least as much as pairwise win rate. (Addressed in Phases 7 + 8.)

---

## 3. Secondary findings

- **No team-composition model exists.** There is `RoleFit` (champion→role weights) and Data Dragon `tags` (`Marksman`, `Mage`, `Tank`…), but nothing computes team-level properties (damage mix, engage, frontline, peel, range, power curve). Every "does this fit the team" question is currently unanswerable. This is the missing foundation. (Phase 6.)
- **`damage_type` is available but unused.** `lol_get_champion_analysis` returns `data.damage_type` (AD/AP/BOTH) per the tool schema (`scripts/fixtures/list-tools.json`). It is never requested. This is free, high-value comp signal.
- **One analysis call already returns synergies + counters + damage_type together.** `lol_get_champion_analysis` bundles `data.synergies.*`, `data.weak_counters`, `data.strong_counters`, and `data.damage_type` in a single response. The current code makes *separate* calls for matchup vs synergy and never reuses the payload. The redesign can cut OP.GG round-trips substantially by fetching one analysis per candidate and reading all factors from it. (Efficiency note carried into Phase 8/9.)
- **The OP.GG response is a Python-repr text blob, hand-parsed.** `opggMcpSource.ts` parses `ClassName(args, ...)` constructor text with a custom tokenizer (`findConstructorArguments`, `splitTopLevel`). It works and is well-tested, but it is fragile and field-order-sensitive. Any new field we read needs a probe + fixture first (this is already the team's discipline; keep it).
- **`getChampionRoleFit` loads an all-positions meta table** (`opggMcpSource.ts:307-342`) and is memoized once. Good. The TeamContext model can piggy-back on a similar one-shot derived table.
- **Synergy position guessing is heuristic** (`opggMcpSource.ts:953-971`, `guessPosition`) and overlaps with the tag priors in `roleInference.ts`. There are now *two* tag→role heuristics. The redesign should unify champion-attribute derivation in one place (the TeamContext attribute table) so this logic stops being duplicated.
- **Weights are a flat 3-way map** (`config.ts:1-5`: `meta/counter/synergy`). The redesign adds factors (team-counter, comp-fit), so the weight schema and the settings UI both need to grow. The config already has a `migrateConfig` hook (`config.ts:115-125`) and version field — use it.

---

## 4. Risk in the current data path worth noting

- **Synergy sample sizes are small and the score is heavily shrunk.** `sampleAdjustedSynergyScore` (`opggMcpSource.ts:923-929`) pulls scores toward `NO_NOTABLE_SYNERGY_SCORE` (0.4) unless `play >= 500`. Combined with the dilution in §2.2, real synergy is doubly suppressed. The redesign must be careful: amplifying synergy and trusting thin samples are different things. We amplify the *discriminating, well-sampled* signal (tier, and win rate where `play` is high), and keep shrinking the thin stuff — but we stop letting the combinator flatten the part that survives.

---

## 5. Conclusion

The codebase is healthy, well-tested, and built on a good seam. It is not the wrong foundation — it is a foundation that was *tuned* meta-first and now needs its **candidate generation, scoring combinator, and factor depth** re-pointed toward synergy and counters. None of the three structural blockers can be addressed by sliders; each needs a deliberate change, and they have a natural dependency order. That order is the roadmap in `04_ROADMAP.md`; the shape they move toward is `03_TARGET_ARCHITECTURE.md`.
