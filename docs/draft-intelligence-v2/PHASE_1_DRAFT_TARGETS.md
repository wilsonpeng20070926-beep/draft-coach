# Phase 1 Prompt — Draft Targets, Pick Turns, Hovers

Implement target-independent live recommendations. Read `MASTER_SPEC.md` first.

## Scope

1. Extend raw LCU normalization to preserve pick action ownership and state: actor cell, action id/order, champion id, `completed`, and `isInProgress`.
2. Add typed `PickState`, normalized draft actions, active allied pick cells, and `DraftTarget` contracts.
3. Correctly distinguish empty, hovering, and locked champions. Do not infer “locked” from `myTeam[].championId` alone.
4. Add pure target selection:
   - active allied actions create tabs;
   - local player is first when simultaneously active;
   - otherwise retain deterministic action/cell order;
   - clicking a slot creates a manual target;
   - any active-turn change restores automatic targeting.
5. Change the engine, candidate pool, team context, counter, synergy, team-counter, and comp-fit paths to accept an explicit allied target. Replace local-player-relative lane-opponent logic with target-relative resolution.
6. Ensure a target hover can be evaluated and is not excluded as “already picked.” Locked champions remain excluded. Other hovers must not count as locked composition members.
7. Debounce hover-triggered recomputation by 300–500 ms and preserve stale-run cancellation.
8. After lock, produce a reusable pick-evaluation result containing strengths, risks, team fit, total, and evidence; UI polish belongs to Phase 6.

## Compatibility

Use a migration path that keeps IPC serializable and config backward compatible. It is acceptable to temporarily render a basic target selector before Phase 6, but live recommendations must remain functional.

## Required tests

- simultaneous active ally picks and local-first ordering;
- manual override resets on a new active turn;
- hover versus lock parsing;
- hover debounce and stale results;
- recommendations for top after local mid locks;
- target-relative lane opponent and role;
- target hover remains a candidate;
- other hovers do not alter locked team composition;
- no recommendation factor depends on `draft.localPlayer.role`.

Run `npm run typecheck`, `npm test`, and `npm run build`. Do not begin the simulator or professional-data work in this phase.
