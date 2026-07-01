# Phase 10 — Candidate Generation v2 (break the meta gate)

**Goal:** Replace the meta-only top-30 candidate pool with a **union** of meta-strong, synergy-fit, and counter-fit candidates, so the engine can *discover* the off-meta-but-correct pick instead of only re-ranking meta elites. This is the structural change that makes the whole rebalance real.

**Depends on:** Phase 8 (synergy + comp-fit scorers), Phase 9 (counter scorers), Phase 7 (delta model). Must come after them — it reuses their fit scorers.
**Blocks:** nothing (Phase 11 surfaces it but doesn't depend on its internals).

---

## 1. Why this phase exists

`01_ARCHITECTURE_REVIEW.md` §2.1 — the single most important finding. Candidate selection is `laneMeta.filter(...).sort(byMeta).slice(0, 30)` (`engine.ts:76-80`). **Synergy and counter never see a champion that isn't a top-30 meta pick for the role.** A mediocre-meta / perfect-fit champion — exactly the pick a coach calls out — is filtered before any factor runs. No slider can fix this; only candidate generation can.

---

## 2. The union pool

Implement `03_TARGET_ARCHITECTURE.md` §4:

```
candidatePool = dedupe(
  topByMeta(role, N_meta)                        // the meta backbone — keep it
  ∪ topSynergyFits(role, allies, ctx, N_syn)     // best pairings with locked allies
  ∪ topCompFits(role, ctx.allyNeeds, N_fit)      // best fills for team gaps
  ∪ topCounterFits(role, ctx, N_ctr)             // best answers to enemy comp/laner
) minus excluded(bans, allyPicks, enemyPicks)
```

- Each contributor list is drawn from the **role's pickable roster** (the lane-meta list already loaded), **not** pre-truncated to meta top-30. Apply only a *low* presence floor (reuse `isRoleCandidate`, `engine.ts:244-257`, with a lower `metaRolePresenceFloor`) so genuinely-unplayed champions are excluded but viable off-meta picks are not.
- `topSynergyFits` / `topCompFits` / `topCounterFits` reuse the **callable scorers** exposed in P8/P9 (their handoff notes require these entry points). They rank the broader roster cheaply and return their top few.
- **Dedupe** by champion id; if a champion is surfaced by multiple contributors, that's a signal it's a strong pick (it'll score well anyway — no need to boost, just don't double-count).
- The union is then **fully scored** by the base+delta model exactly as before. Candidate generation only decides *who gets considered*; scoring decides *the order*.

---

## 3. Cost control (the main risk)

More candidates × per-candidate analysis calls = more OP.GG load. Keep it bounded:

- **Target pool size ≤ ~40** after dedupe. Tune `N_meta` (~20), `N_syn`/`N_fit`/`N_ctr` (~6–8 each). The union of overlapping sets is typically well under the sum.
- **Reuse the shared `getChampionAnalysis` cache** (`03_TARGET_ARCHITECTURE.md` §6). The fit scorers and the full scorer read the *same* cached per-candidate analysis, so adding a champion to the pool costs at most one analysis fetch, cached for the patch TTL.
- **The fit ranking itself should be cheap** — ideally it ranks using data already in the role's lane-meta list plus the candidate's cached analysis, not a fresh per-pair network call for every roster champion. If a fit scorer would require a network call per roster champion, restrict its input set first (e.g. only rank champions above a higher presence floor for the *fit* pass, then fully score the survivors). Document the exact call budget in the handoff.
- **`rerankLatest` (slider moves) must not regenerate the pool or refetch** — pool generation happens on draft change only; slider moves recompute the combinator over the already-scored union (preserve the P7 property).

---

## 4. Files
- `src/main/engine/engine.ts` — replace the candidate selection block (`engine.ts:76-80`) with the union builder; thread `TeamContext` in (built once per run, passed to scorers).
- `src/main/index.ts` — `buildTeamContext` is computed in the recommendation run and passed down (it already infers enemy roles at `maybeInferEnemyRoles`, `index.ts:190-205` — build TeamContext right after, same place).
- Possibly a new `src/main/engine/candidatePool.ts` to keep `engine.ts` readable.
- Tests: extend `recommendationEngine.test.ts` with a fixture proving an off-meta champion enters the pool via synergy/counter fit.

---

## 5. Acceptance criteria

- [ ] On a fixture draft, a champion **outside the meta top-N** but with strong synergy/comp/counter fit appears in the candidate pool (and, if it scores well, in the top 5) — impossible under the old pool. This is the headline proof.
- [ ] The meta backbone is preserved: strong meta picks still appear (we add candidates, we don't drop the meta ones).
- [ ] Pool size stays within the documented bound (≤ ~40) across fixtures; assert it in a test.
- [ ] Per-draft OP.GG call budget is documented and bounded; `rerankLatest` makes **zero** network calls (regression guard).
- [ ] Excluded champions (bans, picked by either team) never appear (reuse `collectExcludedChampionIds`, `engine.ts:232-242`).
- [ ] No regression; latency in-client feels unchanged (live smoke test).

---

## 6. Handoff notes
- This is the phase most likely to surface a "weird" recommendation in live testing (an off-meta pick the user doesn't expect). That's the feature — but make sure the *reason* is shown (P11) so the user can judge it. A surfaced off-meta pick with no visible justification is a bug in trust, even if the math is right.
- If live testing shows the pool surfacing too much noise, the lever is the per-contributor presence floor and `N_*` caps — not removing the union. Tune, don't revert.
