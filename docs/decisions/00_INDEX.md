# Draft Coach — Synergy & Counter Re-Architecture (CTO Decision Set)

**Author:** Acting CTO (design only — no code in this set)
**Date:** 2026-06-13
**Status of project at time of writing:** Core v1 complete (Phases 0–4 done, Phase 5 packaging optional/not started). See the repo's `PROJECT_STATUS.md`.

---

## Why this folder exists

The product owner wants the **next major iteration** to shift Draft Coach's center of gravity:

> "More emphasis on champion **synergy** and **lane counters** instead of being over-focused on OP.GG win rates. Meta scores still matter — but the crucial, meaningful part is analyzing and explaining synergy while picking."

This is not a tuning request (the weight sliders already exist). It is a **framework** request. After reviewing the whole codebase, my conclusion is that the current architecture is **meta-first by construction** in three places that no slider can overcome:

1. The **candidate pool is selected and sorted by meta** before any synergy/counter logic runs.
2. The **scoring combinator is a weighted average of ~0.5-centered scores**, which mathematically suppresses synergy (whose real signal lives in a narrow 0.48–0.53 band).
3. **Synergy and counter are thin, single-signal re-rankers** — synergy ignores OP.GG's own curated tier, and counter only looks at one lane opponent, never the enemy composition.

So this set of documents is a CTO-level plan to **re-architect the recommendation core** so synergy and counters become first-class, explainable drivers — while keeping meta as a calibrated, honest baseline rather than the gatekeeper.

These are **decision and specification documents for an executing agent** (the same one-phase-per-prompt Codex workflow used so far). They contain interface contracts and acceptance criteria, **not** finished implementation code.

---

## Reading order

| # | File | Audience | Purpose |
|---|------|----------|---------|
| 00 | `00_INDEX.md` | everyone | This file. Navigation + how to execute. |
| 01 | `01_ARCHITECTURE_REVIEW.md` | CTO/reviewer | Grounded review of the current framework: what's strong, what structurally blocks the pivot. |
| 02 | `02_PRODUCT_DIRECTION.md` | product + eng | The vision, scoring philosophy, and success criteria for the rebalance. |
| 03 | `03_TARGET_ARCHITECTURE.md` | eng lead | The redesigned recommendation core: TeamContext, base+delta scoring, candidate generation v2, interfaces, data flow, efficiency. |
| 04 | `04_ROADMAP.md` | eng lead + executor | Phase table (6–12), dependencies, sequencing, and the working agreement. |
| 05 | `05_PHASE6_TEAM_CONTEXT_MODEL.md` | executor | Build the team-composition model (foundation). |
| 06 | `06_PHASE7_SCORING_ENGINE_REFACTOR.md` | executor | Replace weighted-average with base + bounded deltas. |
| 07 | `07_PHASE8_SYNERGY_AND_COMPFIT.md` | executor | Synergy overhaul (use tier) + comp-fit factor. |
| 08 | `08_PHASE9_COUNTER_OVERHAUL.md` | executor | Lane counter + team-counter factor. |
| 09 | `09_PHASE10_CANDIDATE_GENERATION_V2.md` | executor | Break the meta gate: union candidate pool. |
| 10 | `10_PHASE11_EXPLAINABILITY_UI.md` | executor | Composition panel + "why this pick" UI. |
| 11 | `11_RISKS_AND_OPEN_QUESTIONS.md` | CTO/reviewer | Trade-offs, risks, mitigations, decisions still owed by the product owner. |

If you only read three: **01** (what's wrong and why), **03** (the new shape), **04** (how it's sequenced).

---

## How an executing agent should use this set

1. **Do not execute out of order.** The phases have hard dependencies (see `04_ROADMAP.md`). Phase 6 (TeamContext) and Phase 7 (scoring refactor) are foundations; everything else builds on them.
2. **One phase per prompt**, matching the existing working agreement: each phase ends with explicit acceptance criteria; stop and verify before moving on.
3. **Probe before parsing.** Any phase that reads a *new* OP.GG field (e.g. `damage_type`, `synergy_tier_data.tier` used as a primary signal) must first run a discovery probe against the live server (extend `scripts/opgg-probe.ts`) and save a fixture, before writing parsing code. This is the same discipline that prevented the earlier CSV-misparse class of bugs.
4. **Tests stay offline.** Every phase adds Vitest coverage against saved fixtures; no network in tests. Live behavior is verified by in-client screenshots, as today.
5. **Preserve the safety posture.** Read-only. Never auto-pick, never touch the game process. Nothing in this plan changes that.
6. **Keep the `FactorModule` seam.** The growth seam (every factor is a module that auto-gets a weight slider) is the best part of the current design. The redesign *extends* it, it does not replace it.

---

## One-paragraph summary of the decision

Introduce a **TeamContext** model that reads the locked allies and (inferred) enemy comp and computes what the team *is* and *needs* (damage profile, engage/peel/frontline, CC, range, power curve). Refactor the engine from a dilutive weighted average into a **calibrated meta baseline adjusted by signed, bounded deltas** so that synergy and counters can visibly move a pick up or down and the reason is legible. Rework **synergy** to lead with OP.GG's curated synergy *tier* plus a new **comp-fit** factor driven by TeamContext, and rework **counter** to add a **team-counter** signal on top of the existing lane matchup. Finally, replace the **meta-gated candidate pool** with a union of meta-strong, synergy-fit, and counter-fit candidates so the tool can surface the off-meta-but-correct pick — which is the whole point of a draft *coach* rather than a tier list. Ship it in dependency order, one shippable phase at a time, with explainability woven through so the user sees *why*.
