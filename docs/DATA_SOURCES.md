# Data Sources And Attribution

Draft Coach combines local League client state with public game-data context.

## League Client Update API

Draft Coach reads local champ-select state from the League Client Update API on the user's machine. This is used to identify gameflow phase, allied picks, enemy picks, bans, local player role, and lane opponent context.

The app is read-only. It does not automate champion selection, lock champions, inject into League, or modify gameplay.

Riot policy references:

- https://developer.riotgames.com/docs/lol
- https://developer.riotgames.com/policies/general

Policy review on 2026-07-11 confirmed that player-facing products must be registered even when they do not use an official documented API. Public beta remains blocked until the product's portal status is recorded in `docs/RELEASE_POLICY_STATUS.json`.

Riot notice:

Draft Coach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Data Dragon

Draft Coach uses Riot Data Dragon for champion names, ids, tags, icons, and current catalog metadata. Champion catalog data is cached locally so repeated runs are faster.

## OP.GG-Backed Data

Draft Coach uses OP.GG-backed MCP responses for meta, matchup, analysis, damage-style, and synergy signals. These responses are cached locally with a time-to-live and are used to compute recommendation factors.

OP.GG policy references:

- https://help.op.gg/hc/en-us/articles/31091405109401-Can-I-use-OP-GG-data
- https://op.gg/lol/policies/agreement

OP.GG's help guidance, updated December 31, 2025, says crawling is not generally prohibited but requires source citation and care not to impair the service; it warns that commercial use without citation or excessive requests may be restricted. Before broad public or commercial distribution, maintainers must confirm the planned MCP-backed usage, request volume, caching, citation, and redistribution posture.

## Professional Draft Snapshot

Draft Coach's professional signals use a vendor-neutral, versioned aggregate snapshot. The initial build-time adapter queries the structured Leaguepedia Cargo API; it does not scrape rendered wiki HTML. The fetch window is limited to the current patch and two previous patches and to current international events plus tier-one LCK, LPL, LEC, LCS, LCP, and CBLOL competition. Academy, collegiate, ERL, development, and semi-professional competition is excluded by default.

Attribution:

- Source: Leaguepedia Cargo data, maintained by Leaguepedia contributors.
- Endpoint: https://lol.fandom.com/api.php
- Leaguepedia: https://lol.fandom.com/wiki/League_of_Legends_Esports_Wiki

The scheduled workflow derives the current three-patch window from Data Dragon, builds and validates the snapshot every three hours, and supports a manual patch-window override. It publishes only normalized aggregates and compact replay records, never the raw Cargo response. Desktop clients verify the schema and SHA-256 checksum before atomically replacing their local last-known-good cache. If no valid snapshot is present, recommendations continue in ranked-only mode.

Direct Cargo access from the desktop is disabled by default. It is available only through explicit operator configuration and is independently rate-limited.

Leaguepedia's API documentation describes the API as a courtesy without a guarantee of stability or accuracy. It documents a 500-row limit for ordinary Cargo queries and warns that unauthenticated Cargo access is heavily rate-limited. The wiki states that community content is available under CC BY-SA 3.0 unless otherwise noted. These facts do not by themselves constitute project-specific permission to publish derived snapshot assets.

### Release policy gate

Leaguepedia API access, attribution, caching, and redistribution terms must be re-verified before a public beta. Snapshot release publishing remains disabled unless the repository variable `PRO_SNAPSHOT_PUBLISH_ENABLED` is explicitly set to `true` after that review. This is a release gate; the implementation does not assume redistribution permission.

Oracle's Elixir is not used by the release pipeline or desktop app. Any future optional import experiment must remain non-release-critical and must honor its stated noncommercial limitation. A monetized release requires a dedicated data-license review and removal or replacement of any noncommercial-only source.

## Fixtures

Test fixtures under `scripts/fixtures/` are minimized synthetic responses used to keep parser tests offline. Do not commit raw captured API responses without a separate policy and privacy review.
