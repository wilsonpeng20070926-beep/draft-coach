# Draft Intelligence v2

This folder is the implementation package for the next major Draft Coach iteration.

## Documents

- `MASTER_SPEC.md` — product decisions, target architecture, scoring policy, data strategy, and release gates.
- `PHASE_1_DRAFT_TARGETS.md` — live pick-turn parsing, target selection, hovers, and locked-pick evaluation.
- `PHASE_2_SIMULATOR_AND_THREATS.md` — manual draft simulator and anticipated-enemy-pick workflow.
- `PHASE_3_PRO_DATA_PIPELINE.md` — free, GitHub-hosted professional-data snapshot pipeline.
- `PHASE_4_PRO_ANALYTICS.md` — patch-aware professional evidence and team-specific insights.
- `PHASE_5_SCORING_AND_CATEGORIES.md` — blended scoring, risk detection, and category rankings.
- `PHASE_6_EXPERIENCE.md` — target tabs, category UI, concise evidence, settings, and freshness states.
- `PHASE_7_EVALUATION_AND_RELEASE.md` — replay evaluation, calibration, resilience, policy, and release readiness.
- `MASTER_BUILD_PROMPT.md` — a single Codex prompt for executing the complete program phase by phase.

## Execution order

Execute Phases 1–7 in order. Each phase prompt is self-contained enough to hand to Codex in a fresh thread, but it assumes earlier phases have been merged. Do not combine phases into one unreviewable change.

Every phase must leave these checks green:

```bash
npm run typecheck
npm test
npm run build
```

The repository currently has unrelated uncommitted release-preparation work. Executors must inspect `git status`, preserve those changes, and edit only files required by the active phase.
