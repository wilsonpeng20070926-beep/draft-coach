# 03 — Target Architecture

**Purpose:** Define the redesigned recommendation core. This is the "how it will be shaped" document. Phase docs (05–10) implement slices of this; when a phase doc and this document disagree, this document is the intent and the phase doc is the cut.

All TypeScript below is **contract sketch**, not implementation. Field names and signatures are normative; bodies are illustrative.

---

## 1. The four moving parts

The redesign changes four things and leaves everything else alone:

```
            ┌─────────────────────────────────────────────────────┐
            │  DraftState (allies, enemies, bans, role, opponent)   │
            └───────────────┬─────────────────────────────────────┘
                            │
                ┌───────────▼────────────┐
   NEW (P6)     │   TeamContext builder    │  what the team IS and NEEDS
                └───────────┬────────────┘
                            │
        ┌───────────────────▼────────────────────┐
NEW(P10)│        Candidate Generator v2            │  meta ∪ synergy-fit ∪ counter-fit
        └───────────────────┬────────────────────┘
                            │  (small candidate set)
        ┌───────────────────▼────────────────────────────────────┐
        │  Factor modules (each returns a signed DELTA + reasons)  │
        │  meta(base) · laneCounter · teamCounter · synergy · comp │  P7 changes the contract; P8/P9 add factors
        └───────────────────┬────────────────────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
 NEW(P7)│   Combinator: metaBase + Σ weighted Δ     │  replaces weighted-average
        └───────────────────┬────────────────────┘
                            │
            ┌───────────────▼────────────────┐
            │  Recommendation (total, deltas,   │
NEW(P11)    │  reasons, comp readout)           │ → richer UI
            └─────────────────────────────────┘
```

Unchanged: LCU adapter, Data Dragon catalog, role inference, the `MetaDataSource` interface boundary, the cache, the IPC/process model, the safety posture.

---

## 2. The TeamContext model (Phase 6)

A pure, derived description of both teams, computed from the `DraftState` plus a champion-attribute lookup. No scoring lives here — it is the shared substrate that comp-fit and team-counter both read.

### 2.1 Champion attributes

```ts
// New: src/shared/championAttributes.ts (types) + src/main/catalog/championAttributes.ts (provider)

export type DamageStyle = "ad" | "ap" | "hybrid" | "true" | "unknown";

export interface ChampionAttributes {
  championId: number;
  damageStyle: DamageStyle;       // from OP.GG data.damage_type, fallback from tags
  // 0..1 "how much of this does the champion provide", derived, not binary:
  engage: number;                 // hard initiation / gap-close-onto-enemy
  peel: number;                   // protects allies (CC on divers, shields)
  frontline: number;              // tankiness / can sit in front
  poke: number;                   // sustained ranged pressure
  waveclear: number;              // pushing / disengage zone
  cc: number;                     // crowd-control weight
  mobility: number;               // dashes / blinks (for "escapes dives")
  range: "melee" | "ranged" | "mixed" | "unknown";
  powerCurve: "early" | "mid" | "late" | "flat" | "unknown";
  carryPotential: number;         // primary damage threat likelihood
  primaryClass: string;           // normalized from tags (Marksman, Mage, ...)
}
```

**Derivation order (mirrors `roleInference.ts` fallback discipline):**
1. **OP.GG-provided** where available: `damage_type` → `damageStyle`. (Probe + fixture first.)
2. **Data Dragon tags** → coarse priors for engage/frontline/poke/etc. (e.g. `Tank`→frontline+cc, `Marksman`→ranged+carry, `Mage`→poke+ap, `Assassin`→mobility+carry, `Support`→peel).
3. **Small curated override table** for the cases tags get wrong (e.g. Senna is a Marksman who plays support; Amumu is a Tank but is pure engage). Keep this table *small and auditable*; it is the only hand-maintained data and the only thing that needs touching when a champion's identity is misclassified.
4. **Unknown champion** (e.g. a brand-new release like Zaahen) → tag prior only, `*: unknown` where nothing applies. Never throw.

The provider should expose the same memoized, one-shot-table shape as `getChampionRoleFit` so it's cheap.

### 2.2 The team-level rollup

```ts
export interface TeamComposition {
  // normalized 0..1 aggregate signals across the team's locked champions
  adWeight: number;
  apWeight: number;
  engage: number;
  peel: number;
  frontline: number;
  poke: number;
  cc: number;
  rangedCount: number;
  powerCurve: { early: number; mid: number; late: number };
  championCount: number;          // how many are locked (confidence scales with this)
}

export interface TeamContext {
  ally: TeamComposition;
  enemy: TeamComposition;         // built from inferred enemy roles; confidence-aware
  // derived "needs": what would most improve the ally team if added
  allyNeeds: CompNeed[];          // e.g. [{ kind: "ap", severity: 0.8 }, { kind: "frontline", severity: 0.6 }]
  enemyThreats: CompThreat[];     // e.g. [{ kind: "dive", severity: 0.7 }, { kind: "burst-ap", severity: 0.5 }]
  confidence: number;             // overall, lowered by unknown roles / few locks / fallback attrs
}

export type CompNeedKind = "ap" | "ad" | "frontline" | "engage" | "peel" | "cc" | "waveclear" | "range";
export interface CompNeed   { kind: CompNeedKind;  severity: number; }   // 0..1
export type CompThreatKind = "dive" | "burst-ap" | "burst-ad" | "poke" | "hard-engage" | "scaling-carry";
export interface CompThreat { kind: CompThreatKind; severity: number; }
```

**Key properties:**
- It is **confidence-aware**. Enemy comp is built on *inferred* roles; `TeamContext.confidence` and per-threat severity must be scaled by `roleConfidence` exactly as the counter factor already does (`counterModule.ts:37-39`). Comp-fit and team-counter deltas are then dampened by this confidence — uncertain comps produce gentle nudges, not loud claims.
- It is **monotone in information**: with zero allies locked, `allyNeeds` is empty and comp-fit contributes nothing; needs sharpen as picks lock in. This matches how a human reads a draft.
- It is **pure and offline-testable**: `buildTeamContext(draft, attributes)` is a deterministic function of its inputs. Phase 6 ships it with fixture-based tests and *no* scoring wired in yet.

---

## 3. The scoring model: base + bounded deltas (Phase 7)

### 3.1 Why change the combinator

See `01_ARCHITECTURE_REVIEW.md` §2.2: a weighted average of ~0.5-centered scores mathematically cannot let a narrow-band factor (synergy) reorder results. The fix is to stop averaging absolute scores and start **summing signed deviations from a baseline**.

### 3.2 New `FactorModule` contract

```ts
export interface FactorContribution {
  factor: string;
  delta: number;        // signed, already normalized to a common scale (see §3.3). 0 = neutral.
  confidence: number;   // 0..1, how much to trust this delta (role inference, sample size)
  reasons: ReasonChip[]; // structured, not just strings — see §5
}

export interface FactorModule {
  key: string;
  enabled: boolean;
  // meta stays special: it produces the BASE, not a delta (see 3.3)
  contribute(candidate: ChampionRef, draft: DraftState, ctx: TeamContext): Promise<FactorContribution>;
}
```

Note `contribute` now also receives `TeamContext`. Existing modules that don't need it ignore the argument.

### 3.3 The combinator

```
metaBase            = calibrated baseline for the candidate in [BASE_LO, BASE_HI]   // e.g. [0.35, 0.65]
                      derived from the existing meta score (engine.ts:316-330), recentered.

effectiveDelta(f)   = clamp(f.delta, -DELTA_CAP, +DELTA_CAP) * weight[f.key] * f.confidence

total               = clamp01( metaBase + Σ_f effectiveDelta(f) )
```

- **Meta is the base, not a term in the sum.** It answers "how good is this champion in a vacuum." The `metaWeight` slider scales how *spread out* the bases are (high meta weight → bases span a wide range and dominate; low meta weight → bases compress toward the middle and deltas decide). This is how meta stays meaningful *and* demotable without being a gate.
- **Each delta is bounded** (`DELTA_CAP`) so no single factor can run away, and **scaled by its own confidence** so uncertain factors self-limit. This preserves the honesty principle while letting confident synergy/counter signals actually move the total.
- **Deltas are signed.** A bad lane matchup or a redundant pick (5th AD champion) produces a *negative* delta and pushes the pick down — something the current all-positive averaging cannot express.
- The displayed 0–100 number is still `total`; the UI additionally shows the decomposition (base + each delta) per Phase 11.

### 3.4 Calibration is a first-class task

The constants (`BASE_LO/HI`, `DELTA_CAP`, default weights, the meta-weight→base-spread mapping) must be tuned so that: (a) totals stay in a believable spread, (b) under the default preset synergy/counter can flip the #1 in motivated cases, (c) meta-forward preset reproduces today's ordering. Phase 7 ships with a calibration harness (a fixture draft + a table of resulting orderings under each preset) so this is verifiable, not vibes.

---

## 4. Candidate generation v2 (Phase 10)

Replace the single meta-sorted top-30 (`engine.ts:76-80`) with a **union pool**:

```
candidatePool = dedupe(
  topByMeta(role, N_meta)                      // keep the meta backbone
  ∪ topSynergyFits(role, allies, ctx, N_syn)   // champions that pair best with locked allies
  ∪ topCounterFits(role, enemy, ctx, N_ctr)    // champions that best answer the enemy comp/laner
) minus excluded(bans, picks)
```

- `topSynergyFits` and `topCounterFits` reuse the factor scorers built in Phases 8/9 over a *broader* role roster (not just meta top-30), so a strong-synergy / strong-counter champion outside the meta elite can enter the pool. To bound cost, draw these from the role's pickable roster filtered by a *low* presence floor (so we don't surface literally-unplayed champions), and cap each contributor list.
- Every candidate in the union is then fully scored by the base+delta model. The pool is small (target ≤ ~40 after dedupe), so cost is bounded; combined with the single-analysis-call reuse in §6, OP.GG load stays controlled.
- This is the change that lets the tool **discover** the off-meta-but-correct pick — the core product promise (Direction §1). It is sequenced last among the engine changes because it depends on the fit scorers existing and on the base+delta model rewarding them correctly.

---

## 5. Structured reasons (threaded through Phases 7–11)

Reasons today are bare strings (`ScoreContribution.reasons: string[]`). To support the explainability requirement they become structured so the UI can style, group, and prioritize them:

```ts
export type ReasonKind = "meta" | "lane-counter" | "team-counter" | "synergy" | "comp-fit" | "warning";
export interface ReasonChip {
  kind: ReasonKind;
  text: string;        // plain-language, one line: "Adds AP to an AD-heavy team"
  polarity: "positive" | "negative" | "neutral";
  strength: number;    // 0..1, for sorting/emphasis
  confidence: number;  // 0..1, drives hedging language ("Likely", "Possibly")
}
```

The existing hedging logic (`counterModule.ts:64-89`) becomes a function of `confidence` + `polarity` on the chip. Backward compat: a `ReasonChip[]` can be flattened to `string[]` for any code not yet upgraded, so Phase 7 doesn't have to touch the renderer in the same cut.

---

## 6. Efficiency: one analysis call feeds many factors

`lol_get_champion_analysis` returns, in a **single** response: `data.summary` (meta), `data.synergies.{pos}[]`, `data.weak_counters`, `data.strong_counters`, and `data.damage_type` (tool schema in `scripts/fixtures/list-tools.json`).

Today the source makes separate calls for matchup vs synergy and never fetches `damage_type`. The redesign should add a **per-candidate analysis fetch** to `MetaDataSource` (cached, keyed by champion+position+patch) that all factors read from:

```ts
// extend MetaDataSource
getChampionAnalysis(champion: ChampionRef, role: Role, region: string, rank: string): Promise<ChampionAnalysis>;
// ChampionAnalysis bundles: meta summary, synergies[], weakCounters[], strongCounters[], damageStyle
```

- Comp-fit reads `damageStyle` + synergies from it; team-counter reads weak/strong counters from it; synergy reads synergies from it. **One network round-trip per candidate** instead of several, all cached by the existing `CachedMetaDataSource` (just add the new method).
- Lane matchup can still prefer the richer `lol_get_lane_matchup_guide` when a precise pairwise number is wanted, falling back to the analysis counters (the existing two-tier approach in `opggMcpSource.ts:110-140` — keep it).
- This is what keeps "more factors" from meaning "slower board" (Direction principle 6).

---

## 7. Weight schema & config evolution

`FactorWeights` grows from 3 keys to the factor set, via the existing versioned config + `migrateConfig` hook (`config.ts:115-125`):

```ts
export interface FactorWeights {
  meta: number;         // now scales base spread, not a sum term
  laneCounter: number;  // was "counter"
  teamCounter: number;  // NEW
  synergy: number;
  compFit: number;      // NEW
}
```

- **Migration:** old configs with `{meta, counter, synergy}` map `counter → laneCounter`, default `teamCounter` and `compFit` to sensible values, bump `version` to 2. The migration must be covered by a test (the config store already has `appConfigStore.test.ts`).
- The settings UI (`SettingsPanel.tsx`) grows two sliders and the presets are re-expressed per Direction §5. Group them visually ("Meta anchor" vs "Draft-aware factors") so the five sliders don't read as clutter.

---

## 8. What each phase delivers against this architecture

| Phase | Delivers | Architecture section |
|---|---|---|
| 6 | TeamContext + champion attributes (pure, tested, not yet wired to scoring) | §2 |
| 7 | base+delta combinator + new FactorModule contract + structured reasons + config v2 migration; existing counter/synergy ported | §3, §5, §7 |
| 8 | synergy uses tier; new comp-fit factor reads TeamContext; per-ally breakdown; analysis-call reuse | §2, §6 |
| 9 | team-counter factor reads TeamContext enemyThreats; lane counter retained; threat callouts | §2, §6 |
| 10 | candidate generation v2 (union pool) | §4 |
| 11 | composition readout + structured-reason UI + regrouped sliders/presets | §5, §7 |

Phases 6 and 7 are independent of each other and can be built in either order, but **both must land before 8/9** (8/9 need TeamContext *and* the delta contract). 10 needs 8/9. 11 can start once 7 lands (reasons) and finishes after 8/9/10 (it surfaces their output). The dependency graph is drawn in `04_ROADMAP.md`.
