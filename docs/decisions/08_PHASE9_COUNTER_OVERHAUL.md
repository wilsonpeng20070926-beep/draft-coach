# Phase 9 — Counter Overhaul (lane + team counter)

**Goal:** Keep the existing lane matchup (it's good and honest), and add a **team-counter** factor that scores a candidate against the *enemy composition* — not just the single lane opponent. Surface which enemy this pick punishes and which enemy threatens it.

**Depends on:** Phase 6 (TeamContext `enemyThreats`), Phase 7 (delta contract).
**Blocks:** Phase 10 (uses the counter scorers for candidate generation), Phase 11 (renders threat callouts).

---

## 1. Why this phase exists

`01_ARCHITECTURE_REVIEW.md` §2.3: counter only looks at `draft.laneOpponent`, and only when exactly one enemy holds the role (`draftManager.ts:198-200`). It says nothing about the enemy *comp* — three dive threats, a hard-engage support, a fed scaling carry. A draft coach must answer "does this pick survive/punish what the enemy is building," not just "how's my lane."

---

## 2. Part A — Lane counter (retain, port shape only)

- Keep the matchup data path (`opggMcpSource.ts` `getMatchup`, two-tier guide→analysis fallback). It already produces honest, confidence-dampened numbers.
- It was ported to the delta contract in Phase 7; this phase makes no behavioral change to it beyond emitting structured threat/answer chips consistently with team-counter (shared chip vocabulary).
- Lane counter remains weighted separately (`laneCounter` weight) so users can value lane vs team independently.

---

## 3. Part B — Team-counter (new factor)

### 3.1 What it does
Reads `TeamContext.enemyThreats` and the candidate's `ChampionAttributes`, and scores how well the candidate *answers the enemy comp*:

```
for each threat in ctx.enemyThreats:
    answer = candidateAnswers(threat.kind, candidateAttributes)   // 0..1
            - candidateVulnerability(threat.kind, candidateAttributes)
    contribution = answer * threat.severity
delta = scaledSum(contributions) * ctx.confidence   // bounded per Phase 7
```

Threat → answer/vulnerability mapping (start simple, test-driven):
- **`dive`** → answered by `peel`/`mobility`/`frontline`; squishy immobile candidates are *vulnerable* (negative).
- **`burst-ap`** → answered by MR-itemizers / range / mobility; squishy melee vulnerable.
- **`burst-ad`** → answered by armor/frontline/range; immobile squishy vulnerable.
- **`poke`** → answered by engage/sustain/disengage; low-mobility low-range vulnerable.
- **`hard-engage`** → answered by disengage/peel/mobility; clumped immobile vulnerable.
- **`scaling-carry`** → answered by early power curve (`powerCurve: early`) / pick potential; pure-scaling candidates neutral-to-negative.

### 3.2 Signed and honest
- The delta is **signed**: a pick that answers the enemy comp rises; a pick that is *vulnerable* to the enemy's threats falls. This is the first time the engine can say "don't pick this into that."
- Scaled by `TeamContext.confidence` (enemy comp is largely inferred). Low-confidence enemy reads → gentle deltas, hedged chips ("Possibly risky into their dive").
- Threat callouts as `ReasonChip`s: positive ("Punishes their immobile mid", "Frontline answers their dive"), negative ("Squishy into 3 dive threats"). Cap the number of chips so the card stays readable (P11 will prioritize by `strength`).

### 3.3 Optional enrichment (only if cheap)
If the shared per-candidate analysis call (`getChampionAnalysis`) already returns `weak_counters`/`strong_counters`, team-counter can *also* check whether the candidate specifically counters a named enemy carry ("Strong counter to their Zed") for a sharper chip — at no extra round-trip. Treat as a nice-to-have, not required for acceptance.

### 3.4 Files
- New `src/main/engine/factors/teamCounterModule.ts` implementing `FactorModule.contribute`.
- `src/main/engine/factors/counterModule.ts` — emit chips in the shared threat/answer vocabulary (minor).
- `src/main/index.ts` — register `TeamCounterModule`; ensure `teamCounter` weight is live.
- Attribute→threat mapping helpers (colocate or in `championAttributes.ts`).
- Tests: new `teamCounterModule.test.ts`; extend `counterModule.test.ts` for chip vocabulary.

---

## 4. Acceptance criteria

- [ ] Team-counter delta responds to enemy comp shape: a frontline/peel pick gets a positive delta into a dive-heavy enemy comp; a squishy immobile pick gets a negative delta into the same comp.
- [ ] Team-counter is scaled by `TeamContext.confidence`; an all-inferred enemy comp produces softer deltas and hedged chips than an all-assigned one.
- [ ] Lane counter behavior is unchanged from Phase 7 (regression guard); both factors emit chips in a consistent vocabulary.
- [ ] No chip claims certainty the data doesn't support; negative ("risky") chips are present and correctly signed.
- [ ] Under a lane-bully / coach preset, a fixture enemy comp causes a team-counter-justified champion to rise (or a vulnerable meta pick to fall).
- [ ] No round-trip added per candidate beyond the shared analysis fetch; verified by call-count assertion.
- [ ] No regression; honesty preserved.

---

## 5. Handoff notes
- Phase 10 reuses `topCounterFits(role, enemy, ctx)` — expose a callable "score this candidate's counter-fit given ctx" entry point (parallel to the synergy/comp-fit one from P8).
- Keep the threat→answer weight tables in named constants for calibration and for P11 chip wording.
