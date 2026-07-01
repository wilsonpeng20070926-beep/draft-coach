# Contributing

Thanks for helping improve Draft Coach.

## Development Setup

```bash
nvm use
npm ci
npm run dev
```

Run these checks before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

## Guidelines

- Keep renderer code UI-only. Draft shaping, scoring, and projection logic belong in main/shared modules.
- Keep tests offline by default. Live OP.GG or League probes should be explicit scripts, not normal CI.
- Do not commit local handoff notes, `.env` files, app caches, logs, screenshots with private data, or release artifacts.
- Add fixtures or focused tests when changing scoring, parsing, role inference, or IPC behavior.

## Pull Requests

- Describe the user-facing behavior change.
- List verification commands and results.
- Call out any Riot, OP.GG, Data Dragon, packaging, or privacy implications.
- Include screenshots for UI changes when practical.
