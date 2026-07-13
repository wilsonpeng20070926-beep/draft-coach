# Draft Intelligence v2 — Master Specification

## 1. Product outcome

Draft Coach becomes a whole-draft planning tool rather than a local-player tier list.

In live champ select it follows the actual allied pick turn, recommends for every simultaneously active ally in separate tabs, permits a clickable override, evaluates hovers, and turns locked picks into concise post-pick evaluations. Outside live champ select it offers a manual simulator for allied and hypothetical enemy draft continuations.

The engine blends ranked evidence with recent tier-one professional drafting. Professional evidence must improve matchup, synergy, enemy-answer, composition, role-priority, flex, and draft-pattern signals—not exist as an ornamental tournament bonus.

## 2. Confirmed product decisions

- Primary scope: allied recommendations. Secondary scope: hypothetical enemy threats.
- Live target: follow active LCU pick actions; show separate tabs for simultaneous allied turns; local player opens first.
- Manual override: clicking an ally pauses automatic focus only until the active turn changes.
- The user may inspect their own role before their turn.
- Hover behavior: debounce 300–500 ms, evaluate the hover, and keep alternatives visible.
- Locked pick: collapse to a concise strengths, risks, and team-fit evaluation.
- Enemy workflow: answer “what pick should we prepare to counter?” An anticipated pick can influence earlier allied choices, such as preferring tank killers when Dr. Mundo is a credible threat.
- Manual simulator: required; it supports team-specific strategy exploration.
- Categories: Best overall (5), Best lane matchup (3), Best synergy (3), Best composition answer (3), Pro-inspired (3), and Avoid / High risk (up to 3). Champions may appear in multiple categories.
- Recommendation priority: lane matchup, ally synergy, current ranked strength, answer to enemy composition, fill allied needs, professional priority, recent-tournament success. Professional evidence also informs the earlier factors.
- Off-meta picks are essential when evidence explains them.
- Strong negative advice is allowed. Use “Avoid” only with high confidence; otherwise use “High risk” or “Poor fit.”
- Pro scope: current international tournaments and tier-one LCK, LPL, LEC, LCS, LCP, and CBLOL competition. Exclude academy, collegiate, ERL, and semi-professional play by default.
- Recency: current patch plus two previous patches with strong exponential decay.
- International-event multiplier: initial value 1.5, subject to calibration.
- Competition weighting: international highest, major tier-one high, other included tier-one medium. Team-quality weighting is bounded and modest.
- Fearless Draft: simple presence is sufficient initially; label the format where known and do not attempt a correction model.
- Team insights: users may choose favorite teams. No team is favored by default. Favorites have a modest overall influence and a stronger Pro-inspired influence.
- One game never creates a confident pro recommendation. Repeated current-patch evidence may; repeated favorite-team evidence may contribute cautiously.
- Data: no paid dependency and no operated backend. A GitHub-hosted static snapshot is acceptable; direct source access is an optional fallback.
- Refresh: startup when stale, every 2–3 hours while open, and manual refresh. Keep the last valid snapshot on failure, then fall back to ranked-only if none exists.
- Professional signals can be disabled.
- Show concise evidence with expandable detail and disclose the effective ranked/pro evidence balance.
- Initial product remains free. A legal/data-usage review is mandatory before commercial distribution.
- Model: explainable, confidence-shrunk statistics first; no opaque ML in this iteration.

## 3. Domain model

### 3.1 Never overload champion state

Represent these separately:

```ts
type PickState = "empty" | "hovering" | "locked";

interface DraftPlayer {
  cellId: number;
  side: "ally" | "enemy";
  role: Role | null;
  roleSource?: "assigned" | "inferred" | "manual";
  roleConfidence?: number;
  champion: ChampionRef | null;
  pickState: PickState;
  isLocalPlayer: boolean;
}

interface DraftTarget {
  side: "ally" | "enemy";
  cellId: number;
  role: Role;
  source: "automatic" | "manual" | "simulation";
  purpose: "recommend" | "anticipate";
}

interface AnticipatedThreat {
  champion: ChampionRef;
  role: Role | null;
  source: "forecast" | "manual" | "simulation";
  confidence: number;
  targetCellId?: number;
}
```

An ally hover is not a locked team member. A target’s hover remains scoreable. Locked champions are excluded. Other allied hovers may be treated as reserved in the UI but must not corrupt composition scoring.

### 3.2 Preserve LCU draft actions

Normalize pick actions including `actorCellId`, `championId`, `completed`, `isInProgress`, action id, and action-group order. Derive:

- all active allied pick cells;
- locked pick ownership;
- target-relative lane opponent;
- current automatic target ordering;
- hover versus locked state.

Do not keep `DraftState.laneOpponent` as a local-player global. Resolve it for `(draft, target)`.

### 3.3 Target-independent engine

The core contract becomes conceptually:

```ts
recommend(draft: DraftState, target: DraftTarget, threats?: AnticipatedThreat[]): Promise<RecommendationResult>
```

Every factor and candidate-pool path must use the target’s role and target-relative context, never `draft.localPlayer.role`. Keep local-player identity only for UI priority.

## 4. Professional data architecture

### 4.1 Source strategy

Use a replaceable `ProDataSource` boundary. Initial source priority:

1. A small versioned snapshot hosted in the project’s GitHub release/static assets.
2. Last-known-good local snapshot with checksum/schema validation.
3. Carefully rate-limited direct Leaguepedia Cargo refresh when enabled and permitted.
4. Ranked-only operation when no professional snapshot is valid.

Leaguepedia currently exposes structured game data including tournament, UTC time, teams, patch, ordered picks, bans, and winners. Treat its schema and availability as unstable. Fetch in the build pipeline, validate, aggregate, and publish; do not make the scoring engine depend on raw Cargo response shapes.

Oracle’s Elixir may be evaluated as a noncommercial historical seed, but its maintainer has stated that downloaded data is noncommercial. Do not make it a release-critical or future-commercial dependency. GRID and PandaScore remain possible future adapters but are outside the no-paid initial release.

### 4.2 Snapshot contents

Publish aggregates, not a giant raw match archive:

- schema version, generated time, source attribution, checksum, covered patches, competitions, game count, and warnings;
- champion role picks, wins, bans, draft opportunities, and flex-role counts;
- allied champion-pair counts by role pair;
- opposing champion counts, with same-role matchups marked separately;
- team-specific champion, role, pair, and response counts;
- per-competition and per-patch partitions needed for runtime reweighting;
- enough draft records or compact aggregates to run historical draft replay evaluation separately.

Target a compact compressed payload. Concise schemas and bounded recent-patch windows matter more than an arbitrary size limit.

### 4.3 Refresh and safety

- GitHub automation runs every three hours and supports manual dispatch.
- Use conditional requests, a descriptive user agent, pagination, backoff, and conservative request counts.
- Validate champion names against Data Dragon aliases.
- Reject partial, future-dated, empty, unknown-schema, or implausibly smaller snapshots.
- Publish atomically only after deterministic validation.
- The desktop verifies checksum and schema before replacing its last-known-good cache.
- Never block champ select on refresh.

## 5. Professional evidence

Use effective weighted samples rather than raw counts.

Initial patch weights:

```text
current patch     1.00
previous patch    0.45
two patches back  0.20
older             0.00
```

Apply the 1.5 international multiplier. Apply competition quality and a bounded team-quality multiplier (suggested clamp 0.85–1.15). Favorite-team evidence is a separate user preference, not a claim that the favorite is objectively best.

Derive explainable evidence for:

- pro priority: picks plus discounted bans per opportunity;
- role presence and flex value;
- ally pairing lift, shrunk toward the global role-pair prior;
- same-role matchup and broader response evidence;
- composition/archetype fit;
- success, heavily shrunk because pro win rate is confounded by team strength;
- favorite-team tendencies.

Use sample confidence such as `n_eff / (n_eff + k)` with calibrated `k` by signal. One game can be displayed as an observation but cannot materially reorder Best overall. Repeated evidence should mean at least three effective appearances initially, then be calibrated.

## 6. Scoring and categories

### 6.1 Evidence before weights

Keep ranked and pro evidence independently observable. Professional data should enrich relevant factor modules, while a separate pro-priority contribution captures pure draft priority/flex.

The default qualitative order is:

1. lane matchup;
2. synergy;
3. ranked meta anchor;
4. enemy-team answer;
5. allied composition fit;
6. pro priority/flex;
7. recent tournament success.

Exact numeric weights are calibration outputs, not product truth. Preserve bounded signed deltas, confidence multiplication, shrinkage, deterministic ordering, and network-free reranking.

Report effective ranked/pro balance from absolute, confidence-adjusted evidence actually used—not merely configured slider values.

### 6.2 Category projections

Score candidates once, then project categories without additional data calls:

- Best overall: total score, top 5.
- Best lane matchup: lane evidence with a minimum overall-safety floor, top 3.
- Best synergy: ally-pair evidence with confidence floor, top 3.
- Best composition answer: enemy-answer plus allied-need evidence, top 3.
- Pro-inspired: pro evidence, flex, and favorite-team evidence with minimum sample safeguards, top 3.
- Avoid / High risk: hovered champion plus likely/popular role candidates with strong negative lane, enemy-answer, redundancy, or role-fit evidence, up to 3.

Overlap is intentional. Empty or low-confidence categories should be omitted or explicitly say evidence is insufficient.

### 6.3 Anticipated threats

Forecast enemy threats using role presence, their locked allies, answers into revealed allied picks, composition completion, current pro priority, and optionally favorite-team patterns in simulation mode. Forecasts must be labeled hypothetical.

Users may pin an anticipated champion. Add it to enemy-answer scoring at reduced confidence until locked. This enables forward planning, such as selecting anti-health or percentage-damage answers before a likely Dr. Mundo pick. Manual threats override forecast ranking but remain visibly hypothetical.

## 7. UX requirements

- Highlight the current recommendation target on the draft board.
- Show one tab per simultaneous active ally; local player opens first.
- Clicking any allied slot opens a manual target until the live active turn changes.
- Enemy slots open the threat-preparation view, not ordinary ally recommendations.
- Debounced hovers show “Evaluate hover” plus alternatives.
- Locked picks collapse into a readable evaluation and remain reopenable.
- Category navigation must fit the compact Electron window; horizontal chips/tabs are preferred to six long stacked lists.
- Evidence examples: `MSI · patch 26.13 · 7 picks`, `BLG tendency · 4 recent drafts`, `65% ranked / 35% pro evidence`.
- Show snapshot age and source in a lightweight details surface, especially when stale or ranked-only.
- Settings: professional evidence toggle, favorite teams, refresh action, and advanced ranked/pro controls. No favorite by default.
- Simulator clearly distinguishes live and hypothetical state and supports reset, undo, role assignment, picks, bans, hovers, and anticipated threats.

## 8. Evaluation and acceptance

Create three complementary gates:

1. Deterministic scenario fixtures for motivated lane, synergy, composition, pro-priority, off-meta, avoid, flex, and anticipated-threat cases.
2. Historical draft replay: reveal real professional drafts one pick at a time and measure top-k continuation recall, reciprocal rank, category coverage, and calibration. Actual pro continuation is evidence, not the only correct answer.
3. Live expert review and structured user feedback. Do not collect telemetry without a separate explicit privacy decision.

Release acceptance:

- active allied turns and manual targeting behave deterministically;
- no factor reads `localPlayer.role` as its recommendation target;
- hovers never pollute locked composition state;
- repeated current-patch pro evidence can reorder justified picks, while a one-game novelty cannot;
- off-meta but well-supported candidates can surface;
- Avoid appears only with traceable high-confidence negative evidence;
- stale/corrupt/missing pro data degrades to last-known-good or ranked-only;
- recommendation updates remain usable within champ-select timing;
- typecheck, tests, build, offline fixture tests, snapshot validation, and release-policy checks pass.

## 9. Non-goals

- Auto-pick, chat automation, or any action on behalf of a player.
- Teammate identity lookup or automatic champion-mastery profiling.
- Paid providers in the initial release.
- Academy, collegiate, ERL, or semi-professional influence by default.
- Fearless-Draft correction beyond transparent format labels.
- Opaque machine learning.
- Runes, builds, or item recommendations.
- Claiming that a predicted enemy pick is known.

## 10. Policy gates

Before a public beta, verify Riot product registration, source attribution, API/request policy, cache behavior, and snapshot redistribution terms. Before any monetization, obtain a dedicated legal/data-license review and remove or replace any noncommercial-only source. Keep the existing Riot disclaimer and read-only safety posture.
