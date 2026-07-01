# Phase 11 — Explainability UI & Composition Readout

**Goal:** Surface the *why*. Render structured reasons grouped by kind and polarity, add a team-composition readout so the user sees what the engine sees, expose a per-pick "why" decomposition (base + deltas), and regroup the settings sliders/presets to the new weight schema. This is the phase that makes the synergy/counter work *legible* — the "crucial part that makes the project meaningful."

**Depends on:** Phase 7 (structured `ReasonChip`, delta decomposition). *Completed* after Phases 8/9/10 so it can render their output.
**Blocks:** nothing.

---

## 1. Why this phase exists

`02_PRODUCT_DIRECTION.md` principle 3: every number must be explainable in one line. Today the card shows up to 3 flat reason strings (`RecommendationCard.tsx:13`, `:32-40`) and a single percent. A pick that rises because of synergy/comp-fit/counter must *say so*, or the user won't trust it — and an off-meta pick surfaced by Phase 10 with no visible reason actively erodes trust.

Constraint: the window is small (360×640, always-on-top — `index.ts:44-49`). The UI must stay dense and glanceable, not balloon.

---

## 2. Work items

### 2.1 Structured reason chips
- Render `ReasonChip[]` (from `03_TARGET_ARCHITECTURE.md` §5) instead of flat strings. Color/icon by `kind` (meta / lane-counter / team-counter / synergy / comp-fit / warning) and by `polarity` (positive vs negative — negative "risky" chips visually distinct).
- Sort by `strength`; show the top few, with overflow behind a tap/expand. Keep the default card compact.
- Hedging language (Likely/Possibly) is driven by `confidence` on the chip — fold the existing logic (`counterModule.ts:64-89`) into a shared formatter so lane-counter, team-counter, and synergy hedge consistently.

### 2.2 "Why this pick" decomposition (expand-on-demand)
- Tapping a card reveals the score decomposition: `metaBase` + each factor's signed `effectiveDelta` (e.g. "Meta 58 · +6 synergy · +4 comp-fit · −3 team-counter"). This is the transparency payload — it shows the user exactly how the rebalance moved the pick.
- Include the synergy **per-ally breakdown** from Phase 8 ("S-tier with Amumu, A-tier with Jinx") and team-counter **threat callouts** from Phase 9.

### 2.3 Team-composition readout panel
- A compact panel (new `src/renderer/components/CompositionPanel.tsx`) showing the ally comp at a glance: damage mix (AD/AP bar), and badges for the satisfied/missing needs ("✓ frontline", "needs AP", "needs engage"), plus the top enemy threats ("⚠ dive", "⚠ poke").
- Reads from `TeamContext`. This requires `TeamContext` (or a UI-projection of it) to be sent over IPC alongside recommendations — extend the `RecommendationUpdate` payload (`types.ts:41-45`) or add a sibling IPC channel. Keep the renderer UI-only (the projection is computed in main).
- Place it near the draft board; collapsible so it never crowds the recommendations.

### 2.4 Settings: five sliders + new presets
- `SettingsPanel.tsx` grows to the v2 weight schema: `meta` (relabel "Meta anchor"), `laneCounter`, `teamCounter`, `synergy`, `compFit`. Group visually as **"Meta anchor"** vs **"Draft-aware factors"** so five sliders read as two clusters, not clutter.
- Replace presets (`SettingsPanel.tsx:18-22`) with the set from `02_PRODUCT_DIRECTION.md` §5: **Coach** (new, synergy/counter-forward), **Trust the meta**, **Lane bully**, **Team comp**.
- The default preset is a product decision (`11_RISKS_AND_OPEN_QUESTIONS.md`); wire whichever the owner picks as `DEFAULT_APP_CONFIG`.

---

## 3. Files
- `src/renderer/components/RecommendationCard.tsx` — structured chips + expandable decomposition.
- `src/renderer/components/CompositionPanel.tsx` — new.
- `src/renderer/App.tsx` — mount the composition panel; subscribe to the new payload.
- `src/renderer/components/SettingsPanel.tsx` — five sliders, grouping, new presets.
- `src/shared/types.ts` — extend `RecommendationUpdate` (or add a `TeamContextProjection` channel) and ensure `ReasonChip` is the wire shape.
- `src/main/index.ts` / `src/main/ipc.ts` — send the composition projection.
- Styling: the existing CSS (reason-chip, score-track, etc. referenced in `RecommendationCard.tsx`).
- Tests: a renderer/component test if the project adds one (currently UI is untested — at minimum, keep types sound; consider a small test for the chip formatter and the comp projection).

---

## 4. Acceptance criteria

- [ ] Every top-5 card shows **at least one draft-tied reason** (synergy, comp-fit, or counter) when one exists — not just a meta stat.
- [ ] Negative/"risky" reasons render visibly distinct from positive ones.
- [ ] Expanding a card shows the base + per-factor delta decomposition and the synergy per-ally breakdown / threat callouts.
- [ ] The composition panel reflects locked picks live (damage mix, needs, enemy threats) and updates as the draft changes.
- [ ] Settings shows the five weighted factors grouped sensibly, with the four new presets; changing a slider still re-ranks instantly with no network call (preserve P7 `rerankLatest`).
- [ ] Hedged language preserved and consistent across all counter/synergy chips.
- [ ] Layout stays usable in the 360px always-on-top window (live screenshot).

---

## 5. Handoff notes
- This phase is where the live "feel" is judged. Pair its completion with a week of real-draft use (the standing recommendation in `PROJECT_STATUS.md` §7.1) before deciding whether to build Phase 12.
- If the decomposition feels noisy, prefer **fewer, higher-strength chips** on the card and push detail into the expand — glanceability beats completeness in champ select.
