# Phase 8 — Synergy Overhaul + Comp-Fit Factor

**Goal:** Make synergy a real driver. Two parts:
1. **Synergy v2** — lead with OP.GG's curated `synergy_tier_data.tier` (the strong signal the current code dilutes), keep sample-aware shrinkage, and expose a per-ally breakdown.
2. **Comp-Fit (new factor)** — reward picks that fill the ally team's actual gaps (`TeamContext.allyNeeds`): missing damage type, missing frontline, missing engage, etc.

This is where "more emphasis on synergy through analyzing while picking" becomes concrete.

**Depends on:** Phase 6 (TeamContext), Phase 7 (delta contract).
**Blocks:** Phase 10 (uses the synergy/comp-fit scorers for candidate generation), Phase 11 (renders the breakdown).

---

## 1. Synergy v2

### 1.1 The core change: lead with tier
`01_ARCHITECTURE_REVIEW.md` §2.3 — `synergy_tier_data.tier` (0=OP, 1=S, 2=A, 3=B, 4=C) is OP.GG's curated ranking and far more discriminating than the 0.48–0.53 win-rate band. Today `normalizeSynergyScore` (`opggMcpSource.ts:882-921`) averages tier with noisier signals, flattening it.

**New ranking model:**
- Map tier → a base synergy strength with real spread, e.g. `tier 0 → 0.90, 1 → 0.78, 2 → 0.64, 3 → 0.52, 4 → 0.42` (tune with fixtures). This is the *primary* discriminator.
- Use win-rate only as a **tie-breaker / fine adjustment** within a tier (and only where `play` is high), not as a co-equal averaged signal.
- Keep **sample-aware shrinkage** toward neutral for thin samples (`sampleAdjustedSynergyScore`, `opggMcpSource.ts:923-929`) — trusting tier is not the same as trusting a 12-game pairing. A tier from a tiny sample is shrunk.
- `score_rank` remains a weak fallback when tier is absent.

**Probe first:** before trusting `tier`, run a probe (`scripts/opgg-probe.ts`) confirming `synergy_tier_data.tier` is populated and its scale across several champions/positions; commit a fixture. (The Ahri fixture in `scripts/fixtures/lol_get_champion_synergies.json` already shows `SynergyTierData(tier,...)` values 0–3 — confirm it generalizes.)

### 1.2 Aggregate across allies, keep the breakdown
- The synergy **delta** aggregates per-ally synergy strengths into one signed delta (weight by sample/confidence; a single OP-tier partner shouldn't be drowned by neutral ones — consider max-plus-mean rather than flat mean).
- **Expose the per-ally breakdown** on the contribution (e.g. `breakdown: { allyName, tier, strength, confidence }[]`) so P11 can render "S-tier with Amumu, A-tier with Jinx." This is the "analyzing while picking" payload.
- Emit `ReasonChip`s for the notable pairings (tier ≤ 1, sufficient sample), with hedged language when confidence is low.

### 1.3 Efficiency
Fetch synergy from the **shared per-candidate analysis call** (`getChampionAnalysis`, `03_TARGET_ARCHITECTURE.md` §6) rather than a dedicated synergy round-trip where possible, so comp-fit, synergy, and team-counter share one cached fetch per candidate.

---

## 2. Comp-Fit (new factor)

### 2.1 What it does
Reads `TeamContext.allyNeeds` and asks: *does this candidate fill a real gap?*

```
for each need in ctx.allyNeeds:
    contribution = candidateProvides(need.kind, candidateAttributes) * need.severity
delta = scaledSum(contributions) * ctx.confidence   // bounded per Phase 7 contract
```

- **Damage mix** is the headline case: an AP pick into an all-AD ally comp gets a positive comp-fit delta + chip "Adds AP to an AD-heavy team." A 5th AD pick into that comp gets ~0 (or slightly negative — redundancy).
- **Frontline / engage / peel / cc / range** handled the same way from `ChampionAttributes`.
- **Diminishing returns / redundancy:** filling a need the team already partly has yields less; piling onto a satisfied need yields ~0. This is what stops comp-fit from just rewarding the highest-tag-count champion.

### 2.2 Honesty
- Comp-fit delta is scaled by `TeamContext.confidence` — with one ally locked, needs are uncertain, so comp-fit nudges gently; as the comp fills in, it sharpens. (Matches the monotonicity from P6.)
- No chip claims a gap the data doesn't support. If `allyNeeds` is empty, comp-fit returns a zero delta and no chips.

### 2.3 Files
- New `src/main/engine/factors/compFitModule.ts` implementing `FactorModule.contribute`.
- `src/main/engine/factors/synergyModule.ts` — rework scoring to tier-led; add breakdown.
- `src/main/data/opggMcpSource.ts` — switch synergy normalization to tier-led (`normalizeSynergyScore`); add/extend `getChampionAnalysis` to expose synergies + `damageStyle` from one call. Probe + fixtures for tier and damage_type.
- `src/main/index.ts` — register `CompFitModule`; ensure `compFit` weight is live.
- `src/shared/championAttributes.ts` — `candidateProvides(needKind, attrs)` helper (or colocate in compFit module).
- Tests: `synergyModule.test.ts` (tier-led behavior), new `compFitModule.test.ts`, `opggMcpSourceFixtures.test.ts` (tier + damage_type parsing).

---

## 3. Acceptance criteria

- [ ] A tier-0/tier-1 synergy pairing produces a **clearly larger** synergy delta than a tier-3/4 pairing on the same candidate (the discriminator is no longer flattened).
- [ ] A thin-sample tier-0 pairing is shrunk toward neutral (honesty preserved).
- [ ] Synergy contribution carries a per-ally `breakdown` consumable by the UI.
- [ ] Comp-fit gives a positive delta + a plain-language chip when the pick fills a real gap (e.g. AP into all-AD), and ~0 when the gap is already filled or absent.
- [ ] Comp-fit and synergy read from a shared cached analysis call (no duplicate round-trips per candidate); verify via a call-count assertion against a mock source.
- [ ] `tier` and `damage_type` parsing covered by committed fixtures; probe scripts updated.
- [ ] Under the coach preset, a fixture draft shows a synergy- or comp-fit-justified champion rising above a pure-meta pick.
- [ ] No regression; honesty (shrinkage, confidence) preserved.

---

## 4. Handoff notes
- Phase 10 will call the synergy and comp-fit scorers over a *broader* roster to build the candidate pool. Make the scoring functions callable without a full draft re-score (i.e. expose a "score this candidate's synergy/comp-fit given ctx" entry point), so P10 can reuse them cheaply.
- Keep the tier→strength map and the `candidateProvides` weights in named constants so P11 (and future calibration) can reference them.
