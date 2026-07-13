# Phase 6 Prompt — Live and Simulator Experience

Deliver the complete compact UI for the contracts built in Phases 1–5. Read `MASTER_SPEC.md` first.

## Scope

1. Highlight the active target on the draft board. Show separate tabs for simultaneous allied pickers, local first. Manual slot selection resets when active turns change.
2. Enemy slot selection opens “Prepare to counter” with forecast threats and pin/remove actions. Never present forecasts as known picks.
3. Add Live and Simulator modes. Simulator supports reset, undo, roles, bans, picks/hovers/locks, target selection, and favorite-team strategy context.
4. During a debounced hover, show its evaluation prominently and retain alternatives. After lock, collapse to strengths, risks, team fit, and expandable details.
5. Render category navigation compactly, preferably as horizontal chips/tabs. Show 5 overall and 3 per specialist category. Preserve category overlap.
6. Evidence is concise by default and exact on expansion, e.g. `MSI · 26.13 · 7 picks`, `BLG tendency · 4 drafts`, and `65% ranked / 35% pro evidence`.
7. Render Avoid only at high confidence; otherwise High risk/Poor fit. Make negative explanations specific and non-alarmist.
8. Settings: pro-data toggle, multiple favorite teams with no default, refresh action, freshness/status, and advanced balance controls. Migrate existing config safely.
9. Show last update/source only in a lightweight status/details surface, except stale/ranked-only conditions warrant a visible notice.
10. Preserve keyboard accessibility, focus behavior, compact always-on-top window usability, loading stability, and no layout jump during reranking.

## Required tests and QA

- renderer tests for target tabs, automatic/manual focus, hover/lock transitions, categories, overlap, threat pinning, stale/ranked-only states, and config migration;
- accessibility labels and keyboard navigation;
- live-window visual QA at supported compact dimensions;
- no unhandled overflow with long champion/team names;
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run smoke:electron` where the environment supports it.

Do not introduce auto-pick, chat, or teammate identity lookup.
