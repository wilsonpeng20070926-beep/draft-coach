# 02 — Product Direction & Scoring Philosophy

**Purpose:** Set the north star and the scoring philosophy so that every phase decision downstream has a principle to defer to. This is the "what we're optimizing for and why" document.

---

## 1. The product thesis

A tier list tells you what is strong. **A draft coach tells you what is right *for this draft*.** The difference is entirely synergy and counters — the things that depend on the other nine champions on the screen. If Draft Coach mostly reproduces OP.GG's meta ranking, it is a worse OP.GG. Its reason to exist is to answer the questions a tier list cannot:

- "Given my locked-in allies, which of my viable picks makes the *team* better?"
- "Given what the enemy has shown, which pick punishes them / avoids being punished?"
- "*Why* — in one glance — is this the pick?"

The next iteration makes those three questions the spine of the product, with meta demoted from gatekeeper to **calibrated baseline**.

---

## 2. Principles (in priority order)

1. **Synergy and counters decide; meta anchors.** Meta sets a believable starting score for a champion in a vacuum. Synergy, comp-fit, and counters are what move it up or down from there. The user must be able to make synergy/counter dominate — and the default preset should already lean that way (see §5).

2. **Be honest before being bold.** The rebalance must not become hype. We amplify *discriminating, well-sampled* signal; we keep shrinking thin samples; we keep confidence-dampening uncertain reads (e.g. inferred enemy roles). A loud wrong recommendation is worse than a quiet right one. The existing honesty machinery (shrinkage, confidence, hedged chips) is a feature and stays.

3. **Every number must be explainable in one line.** If the engine moves a pick up, the UI must be able to say why in plain language: "Adds AP to an AD-heavy team," "S-tier synergy with Amumu," "Punishes their immobile mid," "Risky into three dive threats." A recommendation the user can't understand is one they won't trust. Explainability is a first-class requirement, not a polish item.

4. **Derive what we can; curate only what we must.** Champion attributes (damage type, engage, range, etc.) should come from data sources (Data Dragon tags, OP.GG `damage_type`) wherever possible, with a *small* curated override layer for the things data can't express. New champions must degrade gracefully to a tag-based prior, exactly as role inference already does — never crash, never silently drop.

5. **Respect the seam and the safety posture.** Everything new is a `FactorModule` or a service behind `MetaDataSource`. Read-only, no game-process contact, no auto-pick. Non-negotiable.

6. **Latency is a feature.** Champ select is a live, time-boxed moment. More factors must not mean a slower board. Reuse single OP.GG calls across factors, cache aggressively, and keep the candidate set small. A correct recommendation that arrives after the user has locked in is worthless.

---

## 3. What "more emphasis on synergy and counters" concretely means

Translating the ask into engineering commitments:

| User's words | Concrete commitment | Phase |
|---|---|---|
| "More emphasis on synergy" | Synergy can change which champion is #1, not just nudge order. Lead with curated synergy *tier*, not the flat win-rate band. | 7, 8 |
| "…through analyzing while picking" | A **comp-fit** factor: does this pick complete what the team lacks (damage mix, frontline, engage, peel)? Plus a visible team-composition readout. | 6, 8, 11 |
| "Lane counters" | Keep the lane matchup, and add **team counter** (vs the enemy *composition*, not just the one laner). Surface which enemy this pick beats/loses to. | 9 |
| "Instead of over-focused on OP.GG win rates" | Meta becomes a calibrated baseline (a `metaBase`), not the candidate gate and not the dominant term. Off-meta-but-correct picks can surface. | 7, 10 |
| "Striving the balance" | A redesigned, transparent scoring model with separate, individually-weightable factors and a default preset that is synergy/counter-forward but still sane. | 7, 11 |
| "Crucial part that makes this project meaningful" | The "why this pick" experience: per-pick reasoning, comp gaps, threat callouts. | 11 |

---

## 4. Non-goals (explicitly out of scope for this iteration)

- **Auto-pick / automation / any game-process interaction.** Permanent non-goal.
- **A second data vendor.** We stay on OP.GG behind `MetaDataSource`. We use *more* of what it already returns; we do not integrate a new API in this iteration.
- **Player-specific / champion-mastery weighting** ("you're better on X"). Interesting, but a separate future iteration — it needs per-summoner data we don't currently read. Noted in `11_RISKS_AND_OPEN_QUESTIONS.md`.
- **Rune/item/build recommendations.** OP.GG returns them, but they're a different product surface. Out of scope here.
- **Rewriting the OP.GG text parser.** It works and is tested. We extend it for new fields with the probe-first discipline; we don't refactor it for its own sake.

---

## 5. Default behavior change (a product decision to confirm)

Today's default weights are `meta 0.25 / counter 0.50 / synergy 0.25` (`config.ts:31-35`) — already counter-leaning, but synergy is structurally muted (see review §2.2).

**Proposed new default**, once the scoring model and factors land: a synergy/counter-forward preset that, in the new base+delta model, lets comp-fit and counters meaningfully shape the top 5, with meta as the anchor. Exact numbers are a calibration task in Phase 7 (they can only be set once the model is additive). The presets in the settings panel (`SettingsPanel.tsx:18-22`) should be re-expressed as:

- **"Coach" (new default)** — synergy + comp-fit + counters lead; meta anchors.
- **"Trust the meta"** — meta-forward (today's behavior, for users who want the tier list).
- **"Lane bully"** — lane + team counter forward.
- **"Team comp"** — comp-fit + synergy forward.

This is flagged as a decision in `11_RISKS_AND_OPEN_QUESTIONS.md` because changing a default is a product call, not an engineering one.

---

## 6. Success criteria for the iteration

The iteration is successful when, in live drafts:

1. **Synergy/comp-fit and counters demonstrably reorder the top 5** under the default preset — verified by before/after on the same draft (a meta-only #1 is displaced by a synergy/counter-justified pick in clearly-motivated cases).
2. **The tool surfaces at least some correct off-meta picks** that the old meta-gated pool could never have shown (validates Phase 10).
3. **Every recommendation in the top 5 shows at least one plain-language reason** tied to the draft (synergy, comp gap, or threat) — not just a meta stat.
4. **No regression in honesty:** uncertain reads (inferred roles, thin samples) are still visibly hedged or dampened; the tool never shows a confident reason it can't support.
5. **Board latency stays within today's feel** despite the added factors (no perceptible slowdown in champ select).

These criteria are restated as per-phase acceptance checks in the roadmap.
