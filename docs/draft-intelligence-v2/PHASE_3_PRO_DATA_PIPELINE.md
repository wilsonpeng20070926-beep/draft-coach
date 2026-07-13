# Phase 3 Prompt — Professional Data Snapshot Pipeline

Build the free, source-swappable professional-data ingestion and desktop cache. Read `MASTER_SPEC.md` first.

## Scope

1. Define vendor-neutral raw draft and compact snapshot schemas with explicit schema versions. Include provenance, generated time, covered patches/competitions, counts, warnings, and checksum.
2. Implement a Leaguepedia Cargo adapter as the initial build-time source. Query only current plus two previous patches and only allowlisted tier-one competitions: current global events and LCK, LPL, LEC, LCS, LCP, CBLOL. Exclude development leagues by default.
3. Use conservative pagination, conditional requests where supported, backoff, timeouts, a descriptive user agent, and fixture-driven parsing. Never scrape rendered HTML.
4. Normalize champion aliases against the catalog, ordered roles, bans, teams, winner, patch, UTC timestamp, competition, stage, and format/fearless metadata when available.
5. Aggregate and publish deterministic compressed static snapshots suitable for GitHub hosting. Add scripts for fetch, validate, build, and checksum. Provide a scheduled three-hour GitHub workflow plus manual dispatch, but do not overwrite unrelated existing workflow changes.
6. Implement desktop download/cache behind `ProDataSource`:
   - refresh at startup when stale, every 2–3 hours, and manually;
   - never block recommendations;
   - verify schema/checksum before atomic replacement;
   - retain last known good on any failure;
   - support ranked-only operation and a disabled state;
   - use a tightly rate-limited direct-source fallback only if explicitly configured.
7. Do not use Oracle’s Elixir as a release-critical source. Document its noncommercial limitation if an optional import experiment is retained.

## Required tests

- minimized synthetic parser fixtures;
- pagination and rate-limit behavior;
- alias/role/order normalization;
- deterministic snapshot output;
- rejection of empty, partial, corrupt, future-dated, implausibly smaller, and unknown-schema snapshots;
- atomic last-known-good fallback;
- no-network and disabled modes;
- refresh never delays a recommendation call.

Update data-source/privacy documentation and attribution. Flag redistribution or API-policy uncertainty as a release gate, not an assumption. Run `npm run typecheck`, `npm test`, and `npm run build`.
