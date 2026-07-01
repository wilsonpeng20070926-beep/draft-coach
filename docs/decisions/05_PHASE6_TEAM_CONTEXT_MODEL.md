# Phase 6 — Team Context Model

**Goal:** Introduce a pure, well-tested model of *what each team is and what the ally team needs*, derived from the draft plus a champion-attribute provider. **No scoring behavior changes in this phase** — this is foundation. The model is exercised by tests only until Phases 8/9 consume it.

**Depends on:** nothing (can be built in parallel with Phase 7).
**Blocks:** Phase 8 (comp-fit), Phase 9 (team-counter), Phase 12 (derived factors).

---

## 1. Why this phase exists

There is currently no way to ask "does this pick fit the team?" The codebase has champion `tags` and `RoleFit`, but nothing that rolls a set of champions up into damage mix / engage / frontline / threats. Comp-fit and team-counter both need that substrate. Build it once, here, as a pure function.

This phase deliberately imitates the shape of `roleInference.ts`: derive a structured judgment from champion identity, with a graceful tag-based fallback when richer data is missing.

---

## 2. Scope

### New files
- `src/shared/championAttributes.ts` — types (`ChampionAttributes`, `DamageStyle`, `TeamComposition`, `TeamContext`, `CompNeed`, `CompThreat` and their `*Kind` unions). See `03_TARGET_ARCHITECTURE.md` §2 for the normative shapes.
- `src/main/catalog/championAttributes.ts` — the attribute **provider**: given a `ChampionRef` (+ optional OP.GG `damageStyle`), returns `ChampionAttributes`.
- `src/main/catalog/championAttributeOverrides.ts` — the **small curated override table** (data, not logic).
- `src/main/draft/teamContext.ts` — `buildTeamContext(draft, getAttributes)` (pure).
- Tests: `test/teamContext.test.ts`, `test/championAttributes.test.ts`.

### Modified files
- `src/main/data/metaDataSource.ts` — add optional `getChampionAnalysis(...)` returning at least `damageStyle` (full bundle can be deferred to P8, but define the type now). If you defer the network method, still define `DamageStyle` plumbing so P8 doesn't reshape the interface.
- `scripts/opgg-probe.ts` — add a probe that fetches `data.damage_type` for a few champions; commit a fixture.

### Explicitly NOT in scope
- Wiring TeamContext into the engine or any factor (that's P8/P9).
- Any change to recommendations the user sees.

---

## 3. Champion attribute derivation

Implement the derivation order from `03_TARGET_ARCHITECTURE.md` §2.1:

1. **OP.GG `damage_type`** (`AD`/`AP`/`BOTH`) → `damageStyle` (`ad`/`ap`/`hybrid`). Probe + fixture first. If not yet fetching per-champion analysis, accept `damageStyle` as an optional input and default `unknown`.
2. **Data Dragon tag priors** → coarse 0..1 values. Suggested starting priors (tune with tests, keep auditable):

   | Tag | engage | peel | frontline | poke | cc | mobility | carry | damageStyle prior | range |
   |---|---|---|---|---|---|---|---|---|---|
   | Tank | 0.6 | 0.5 | 0.9 | 0.1 | 0.8 | 0.2 | 0.2 | ad | melee |
   | Fighter | 0.5 | 0.3 | 0.6 | 0.2 | 0.4 | 0.4 | 0.5 | ad | melee |
   | Marksman | 0.1 | 0.1 | 0.1 | 0.5 | 0.2 | 0.4 | 0.9 | ad | ranged |
   | Mage | 0.2 | 0.3 | 0.1 | 0.7 | 0.6 | 0.3 | 0.7 | ap | ranged |
   | Assassin | 0.5 | 0.1 | 0.1 | 0.2 | 0.3 | 0.8 | 0.8 | (mixed) | melee |
   | Support | 0.4 | 0.8 | 0.3 | 0.4 | 0.7 | 0.3 | 0.2 | ap | ranged |

   Multi-tag champions combine priors (take max per signal, or a documented blend — pick one and test it). These numbers are a *starting point*; the test suite is what locks them.
3. **Curated overrides** in `championAttributeOverrides.ts` for known tag-misclassifications. Keep it to the clear cases (a few dozen at most). Each entry should be a partial override merged over the tag prior. Examples to seed: Amumu (engage↑, ap), Senna (range ranged, plays support/adc — note this is identity not role), Pyke (assassin support, engage↑), Malphite (engage↑ despite Tank). Document each override with a one-line "why".
4. **Unknown champion** → tag prior; if no tags, all-`unknown`/low. Never throw. Add an explicit test with a synthetic unknown champion (reuse the "Zaahen" anchor idea from prior phases).

**Provider shape:** memoized table built once (like `getChampionRoleFit`), keyed by champion id + patch. Pure given inputs.

---

## 4. Team rollup & needs/threats

`buildTeamContext(draft, getAttributes)`:

1. Collect locked ally champions and (inferred) enemy champions with their `roleConfidence`.
2. Build `TeamComposition` for each side: normalized aggregates (adWeight/apWeight from damageStyle mix, engage/peel/frontline/poke/cc means, rangedCount, powerCurve histogram). `championCount` records how many are locked.
3. Derive `allyNeeds` — the gaps. Rules (start simple, test-driven):
   - **`ap`/`ad` need** when damage mix is lopsided (e.g. adWeight ≫ apWeight → AP need, severity ∝ imbalance).
   - **`frontline` need** when summed frontline is low and team has ranged carries to protect.
   - **`engage` need** when no ally provides hard initiation.
   - **`peel` need** when there's a high-`carry` ally and low team peel.
   - **`cc`/`waveclear`/`range`** similarly. Keep each rule a small pure function; severity in 0..1.
4. Derive `enemyThreats` from the enemy composition (dive = enemy engage+mobility high; burst-ap/ad = enemy carry + damageStyle; poke; hard-engage; scaling-carry). **Scale each threat's severity by the contributing enemies' `roleConfidence`** so a guessed enemy comp yields softer threats.
5. Set `TeamContext.confidence` from: how many allies are locked, how many enemy roles are *assigned* vs *inferred*, and how many champions fell back to tag-only attributes. Low information → low confidence. Downstream factors multiply their deltas by this.

**Monotonicity requirement:** with zero allies locked, `allyNeeds` is empty (comp-fit will contribute nothing). With zero/low-confidence enemy info, `enemyThreats` are empty or weak. Test both.

---

## 5. Probe step (mandatory before parsing `damage_type`)

Extend `scripts/opgg-probe.ts` to call `lol_get_champion_analysis` with `desired_output_fields` including `data.{damage_type,mythic_items}` for ~3 champions spanning AD/AP/hybrid (e.g. JINX, ORIANNA, JAYCE). Save the raw response as a fixture under `scripts/fixtures/` (and a trimmed copy under `test/fixtures/` if needed). Confirm the exact text shape (`damage_type` value casing) before writing the parse. Only then add parsing to `opggMcpSource.ts`.

---

## 6. Acceptance criteria

- [ ] `buildTeamContext` is pure and deterministic; same inputs → same output. No network, no clock, no globals.
- [ ] Given a fixture draft with, say, 3 AD allies locked, `allyNeeds` contains an `ap` need with severity > 0.5; with a balanced comp it does not.
- [ ] Given an enemy comp with two high-mobility/engage champions (assigned roles), `enemyThreats` contains a `dive` threat; with inferred low-confidence roles the same comp yields a *weaker* dive severity.
- [ ] An unknown/synthetic champion produces a valid `ChampionAttributes` via tag prior (or all-`unknown`) without throwing.
- [ ] `championAttributeOverrides.ts` is data-only, each entry has a "why" comment, and the table is small (≤ ~40 entries).
- [ ] `damage_type` probe fixture committed; parsing covered by a fixture test.
- [ ] No existing test regresses; no user-visible behavior change (engine still ignores TeamContext this phase).

---

## 7. Handoff notes for the next phase

- Phase 8 will call `buildTeamContext` once per recommendation run and pass it into `contribute(...)`. Make sure it's cheap enough to call per-run (the attribute table is memoized; the rollup is O(10 champions)).
- Keep `allyNeeds`/`enemyThreats` *kinds* stable — Phases 8/9 and the UI (P11) will switch on them. If you rename a kind later, it's a breaking change across three phases.
