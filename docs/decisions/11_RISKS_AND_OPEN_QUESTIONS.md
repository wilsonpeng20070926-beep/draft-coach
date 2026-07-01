# 11 — Risks, Trade-offs & Open Questions

**Purpose:** The CTO's honest ledger. What could go wrong, what we're deliberately trading, and the decisions that are the product owner's to make — not the engineer's.

---

## 1. Decisions owed by the product owner (resolve before/at the relevant phase)

These change *what gets built*, so they shouldn't be silently defaulted by the executor.

| # | Question | Why it's a product call | Default if unanswered | Needed by |
|---|---|---|---|---|
| Q1 | **Should the new default preset be "Coach" (synergy/counter-forward) or stay meta-forward?** | Changing a default changes every user's experience. The whole iteration argues for Coach, but it's a posture decision. | Ship "Coach" as default; keep "Trust the meta" one click away. | Phase 7 (presets) / Phase 11 (wire default) |
| Q2 | **How much should a *bad* pick be pushed *down*?** I.e., should negative deltas (risky matchup, redundant comp, vulnerable into enemy) be as strong as positive ones, or gentler? | Affects whether the tool ever says "avoid this," which is a tone choice. | Symmetric but bounded; revisit after live use. | Phase 7 calibration |
| Q3 | **Curated override table ownership** — who maintains `championAttributeOverrides.ts` as new champions release? | It's the one hand-maintained dataset; needs an owner or it rots. | Engineer seeds it; flag new-champion review as a recurring task. | Phase 6 |
| Q4 | **Is surfacing off-meta picks desirable even when they look "weird"?** | Phase 10's whole point is discovery, but some users want only safe meta picks. | Yes, but always with a visible reason; the "Trust the meta" preset is the escape hatch. | Phase 10 |
| Q5 | **Rank/region scope for the new signals** — synergy tiers and comp data vary by elo. Use the user's configured rank, or a fixed high-elo reference? | Affects accuracy vs stability of recommendations. | Use the existing configured rank/region (no new behavior). | Phase 8/9 |

If the executor reaches a phase and the answer isn't recorded, it should use the default above and note the assumption in the handoff — not block.

---

## 2. Technical risks & mitigations

### R1 — Calibration produces hype instead of signal (highest risk)
*If the delta scales are too large, synergy/counter will reorder things they shouldn't and the tool becomes a random-pick generator with confident reasons.*
- **Mitigation:** The Phase 7 calibration harness is the gate. It must prove (a) meta-forward ≈ today, (b) reordering only on motivated fixtures, (c) totals in a believable band. Treat a failing calibration test as a hard stop, not a tuning nuisance.
- **Mitigation:** Bounded deltas (`DELTA_CAP`) + confidence scaling mean even a miscalibrated factor can't fully dominate.

### R2 — OP.GG latency / call volume from more factors + bigger pool
*Phase 10 enlarges the pool; more factors read more data.*
- **Mitigation:** One shared `getChampionAnalysis` per candidate (synergies + counters + damage_type in one call), cached by the existing patch-keyed `CachedMetaDataSource`. Bounded pool (≤ ~40). `rerankLatest` does zero network. Document the per-draft call budget in Phase 10.
- **Watch:** if live latency regresses, lower `N_*` and the fit-pass presence floor before touching architecture.

### R3 — Curated attribute table rot / new-champion breakage
*A new release (the recurring "Zaahen" scenario) with no override and odd tags could be misclassified.*
- **Mitigation:** Graceful tag-prior fallback (Phase 6) so unknowns never crash, only degrade. Confidence scaling means a low-information champion contributes gently. Keep the override table small and auditable. Q3 assigns an owner.

### R4 — Enemy-comp inference is uncertain, and comp-fit/team-counter lean on it
*Team-counter especially depends on inferred enemy roles, which are sometimes wrong (acknowledged in `PROJECT_STATUS.md` §6).*
- **Mitigation:** Everything derived from enemy comp is scaled by `roleConfidence` and `TeamContext.confidence`. Uncertain reads produce gentle deltas and hedged chips. This reuses the exact honesty pattern already proven in `counterModule.ts:37-39`. The "honest not-sure" is a feature.

### R5 — Fragile OP.GG text parser meets new fields
*The Python-repr parser is field-order-sensitive; `damage_type` and tier parsing are new surfaces.*
- **Mitigation:** Probe-first discipline (mandatory in Phases 6 & 8): extend `scripts/opgg-probe.ts`, commit a fixture, confirm the shape, then parse. Offline fixture tests for every new field. This is the same discipline that root-caused the original CSV misparse.

### R6 — Scoring model churn breaks the renderer mid-migration
*Phase 7 changes the contribution shape; the UI reads it.*
- **Mitigation:** `ReasonChip[]` flattens to `string[]` for back-compat so Phase 7 doesn't force a renderer rewrite. The rich UI lands in Phase 11. Each phase keeps the app shippable.

### R7 — Five sliders overwhelm the small window
*More factors = more knobs in a 360px UI.*
- **Mitigation:** Group into "Meta anchor" vs "Draft-aware factors"; lead with presets so most users never touch individual sliders. Phase 11 acceptance includes a live-window legibility check.

---

## 3. Deliberate trade-offs (chosen, not accidental)

- **More compute per draft for better recommendations.** Accepted, bounded by caching + pool caps. A draft coach that's correct is worth a few hundred ms.
- **A small hand-maintained dataset** (`championAttributeOverrides.ts`). We accept this maintenance cost because tags alone misclassify enough champions to matter, and the alternative (pure-data derivation) isn't reliable for engage/peel/etc. We *minimize* it (overrides only, not a full table) and degrade gracefully without it.
- **Surfacing off-meta picks** (Phase 10). We accept occasional "weird" suggestions as the price of being a coach rather than a tier list — guarded by always showing the reason and keeping a meta-only preset.
- **Keeping the fragile OP.GG parser** rather than rewriting it. We extend it carefully (probe-first) because a rewrite is risk with no user-facing payoff.

---

## 4. What this plan explicitly does NOT solve (future iterations)

- **Player skill / champion mastery** ("you're better on X, pick it even if fit is worse"). Needs per-summoner data we don't read. Strong candidate for the iteration *after* this one — TeamContext + the delta model would accept a "mastery" factor cleanly.
- **Ban-phase advice** ("ban their best counter to your comp"). The TeamContext + counter machinery built here is most of what a ban advisor needs; it's a natural follow-on, not in scope now.
- **Multi-pick / pick-order planning** ("hold this flex pick, you can answer last"). Genuinely hard; out of scope.
- **A second data vendor.** Out of scope (Direction §4). The `MetaDataSource` seam keeps the door open.
- **Rune/item/build suggestions.** Different product surface; out of scope.

---

## 5. The one thing to get right

If only one principle survives contact with implementation, make it this: **amplify the discriminating, well-sampled signal; keep shrinking the thin stuff; and never let the combinator flatten what survives.** That single sentence is the difference between this iteration making the product meaningful and making it loud. Every calibration decision should be checked against it.
