# 04 — Roadmap & Phasing

**Purpose:** The execution plan. Phase numbers continue from the existing `PROJECT_STATUS.md` (Phases 0–4 done; Phase 5 packaging is optional and orthogonal — it can ship before, after, or interleaved with this work). The synergy/counter re-architecture is **Phases 6–11**, with an optional **Phase 12**.

---

## 1. Dependency graph

```
  P6 TeamContext ──────────┐
  (foundation)             ├──> P8 Synergy + CompFit ──┐
  P7 Scoring (base+delta) ─┤                           ├──> P10 Candidate Gen v2
  (foundation)             ├──> P9 Counter overhaul ───┘
                           │
                           └──> P11 Explainability UI (starts after P7, completes after P8/P9/P10)
```

- **P6 and P7 are independent** of each other; build in either order. Both are prerequisites for P8 and P9.
- **P8 and P9 are independent** of each other; build in either order after P6+P7. Both feed P10.
- **P10 requires P8+P9** (it reuses their fit scorers).
- **P11 can begin once P7 lands** (structured reasons exist) and is *completed* after P8/P9/P10 so it can surface their output.

Recommended linear order for a single executor: **6 → 7 → 8 → 9 → 10 → 11**, with P11 polish revisited after each of 8/9/10.

---

## 2. Phase table

| Phase | Name | Goal | Ships independently? | Key acceptance |
|---|---|---|---|---|
| **6** | Team Context Model | A pure `buildTeamContext(draft, attrs)` producing ally/enemy comp + needs + threats, plus a champion-attribute provider. No scoring change. | ✅ (dead code until P8/9, but fully tested) | Deterministic output on fixtures; graceful unknown-champion fallback; confidence scales with locks & role certainty. |
| **7** | Scoring Engine Refactor | Replace weighted-average with `metaBase + Σ bounded·confidence-scaled deltas`. New `FactorModule.contribute` contract + structured `ReasonChip`. Config v2 migration. Port existing counter/synergy to deltas. | ✅ (behavior-preserving under "Trust the meta" preset; synergy can now move order) | Calibration harness shows meta-forward preset ≈ today's order; a fixture draft shows synergy/counter flipping #1 under the coach preset; config migration test passes. |
| **8** | Synergy + Comp-Fit | Synergy leads with `synergy_tier_data.tier`; new **comp-fit** factor reads `TeamContext.allyNeeds`; per-ally synergy breakdown; reuse single analysis call. | ✅ | Tier-0/S pairings produce clearly larger synergy deltas than B/C; comp-fit gives a positive delta + reason when the pick fills a real gap and ~0 when it doesn't; offline fixtures cover tier + damage_style. |
| **9** | Counter Overhaul | Keep lane matchup; add **team-counter** factor from `TeamContext.enemyThreats`; threat/answer callouts ("punishes their immobile mid", "risky into 3 dive"). | ✅ | Team-counter delta responds to enemy comp shape; lane counter unchanged in behavior; confidence dampening preserved for inferred roles. |
| **10** | Candidate Generation v2 | Union pool: meta-top ∪ synergy-fit ∪ counter-fit; full scoring over the union. | ✅ | A fixture draft surfaces an off-meta-but-strong-fit champion that the old top-30-by-meta pool excluded; pool size bounded; latency within budget. |
| **11** | Explainability UI | Composition readout panel; structured reason chips (grouped/colored by kind & polarity); "why this pick" decomposition (base + deltas); regrouped sliders + new presets. | ✅ | Every top-5 card shows ≥1 draft-tied reason; comp panel reflects locked picks; sliders/presets match new weight schema; hedged language preserved. |
| **12** *(optional)* | Derived factors | Power-spike balance + damage-profile gaps as comp-fit sub-signals (the previously-deferred factors, now natural on TeamContext). | ✅ | Flags a curve/damage imbalance with a reason; off by default or low weight until validated in real use. |

---

## 3. Per-phase definition of done (shared checklist)

Every phase must satisfy all of these before it is considered complete (this mirrors the existing working agreement):

- [ ] **Probe-first** for any new OP.GG field: extend `scripts/opgg-probe.ts`, run against the live server, commit a fixture, *then* write parsing. (Applies to P6 `damage_type`, P8 synergy `tier`.)
- [ ] **Offline Vitest coverage** added, using saved fixtures; the whole suite runs with no network.
- [ ] **No regression** in existing tests (`recommendationEngine.test.ts`, `synergyModule.test.ts`, `counterModule.test.ts`, `roleInference.test.ts`, `appConfigStore.test.ts`, `opggMcpSourceFixtures.test.ts`).
- [ ] **Honesty preserved:** thin samples still shrunk, inferred-role reads still confidence-dampened, no chip claims more than the data supports.
- [ ] **Seam preserved:** new logic is a `FactorModule` or a service behind `MetaDataSource`; renderer stays UI-only over IPC.
- [ ] **Safety preserved:** read-only; no game-process contact; no auto-pick.
- [ ] **Live smoke test:** in-client screenshot(s) of the board behaving, attached to the phase handoff (as done in prior phases).
- [ ] **Acceptance criteria** in the phase doc explicitly checked off in the handoff note.

---

## 4. Sequencing rationale (CTO note)

- **Foundations first (6, 7) because they de-risk everything.** TeamContext is the data both new factors need; the delta model is what makes synergy/counter *able* to matter. Building factors before either would mean building them twice.
- **Factors before candidate-gen (8/9 before 10)** because the union pool *reuses the fit scorers*. Building candidate-gen first would require throwaway scoring.
- **UI threaded last but reasons defined early.** Structured `ReasonChip` is introduced in P7 so factors emit it from day one; the *rich rendering* lands in P11 once there's something worth rendering. This avoids a UI rewrite mid-stream.
- **Each phase is independently shippable.** If the iteration is paused after any phase, the app is in a coherent, better state — not a half-migrated one. P7 in particular must be behavior-preserving under the meta-forward preset so it can ship without surprising existing users.

---

## 5. Estimated relative effort (for planning, not commitment)

| Phase | Relative size | Riskiest part |
|---|---|---|
| 6 | M | Getting the curated attribute layer small but correct; `damage_type` probe. |
| 7 | L | Calibration so totals stay believable and presets behave; config migration. |
| 8 | M | Trusting tier without over-amplifying thin samples; comp-need mapping. |
| 9 | M | Threat taxonomy that's useful without being noisy; confidence dampening. |
| 10 | M | Bounding pool size / OP.GG load; avoiding surfacing unplayable picks. |
| 11 | M | Making 5 sliders + decomposition legible in a 360px always-on-top window. |
| 12 | S–M | Validating the heuristics are real signal before defaulting them on. |

Largest single risk across the program is **P7 calibration** — it's where "emphasize synergy" either becomes real or becomes hype. Treat its calibration harness as the gate.
