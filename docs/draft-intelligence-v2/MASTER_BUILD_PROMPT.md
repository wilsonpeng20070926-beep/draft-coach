# Master Codex Build Prompt

You are implementing Draft Intelligence v2 in the Draft Coach Electron/React/TypeScript repository.

Read these files completely before editing:

1. `docs/draft-intelligence-v2/MASTER_SPEC.md`
2. `docs/draft-intelligence-v2/README.md`
3. all existing `docs/decisions/*.md`
4. the current shared types, draft manager, recommendation engine, factor modules, data-source adapters, IPC, renderer, config store, and relevant tests.

Then execute `PHASE_1_DRAFT_TARGETS.md` through `PHASE_7_EVALUATION_AND_RELEASE.md` in order. Treat each phase as a separate review boundary. At the start of each phase, inspect `git status` and preserve unrelated user changes. At the end of each phase:

- run the phase-specific tests;
- run `npm run typecheck`, `npm test`, and `npm run build`;
- report files changed, behavior delivered, assumptions, data-policy concerns, performance impact, and remaining work;
- stop for review unless the user explicitly asks you to continue through all phases.

Engineering constraints:

- Keep changes focused, typed, test-driven, and concise.
- Do not couple the engine to the local player; pass an explicit `DraftTarget`.
- Distinguish empty, hover, locked, and anticipated states.
- Keep data vendors behind interfaces and scoring independent of raw API schemas.
- Score candidates once and project all UI categories from that result.
- Preserve bounded deltas, confidence shrinkage, deterministic ordering, cache-first behavior, read-only LCU access, and network-free reranking.
- Never block live recommendations on professional-data refresh.
- Never let a single pro game materially drive Best overall.
- Do not add auto-pick, chat actions, teammate lookup, paid services, hidden telemetry, or opaque ML.
- Do not rewrite stable code merely for style.
- Do not commit captured third-party responses unless minimized and permitted; prefer synthetic fixtures.

The implementation is complete only when every acceptance criterion in the master specification and Phase 7 is satisfied, or when a clearly documented external policy/licensing blocker requires product-owner action.
