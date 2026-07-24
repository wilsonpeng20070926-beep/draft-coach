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

Draft Coach uses OP.GG-backed MCP responses for meta, matchup, analysis, damage-style, and synergy signals. Successful responses are cached locally with a six-hour time-to-live and retained as last-known-good data across app restarts. If a refresh fails, the app uses a matching stale cache entry. If neither live nor cached data exists, a visibly labeled neutral fallback derives role presence from Data Dragon champion tags; it does not invent win rates, matchup statistics, or synergy evidence.

OP.GG policy references:

- https://help.op.gg/hc/en-us/articles/31091405109401-Can-I-use-OP-GG-data
- https://op.gg/lol/policies/agreement

OP.GG Support replied in writing on 2026-07-21 to the project's request describing a free desktop beta, six-hour patch-scoped local caching, a candidate cap of 40, source citation, and no raw-response redistribution. The response said that commercial products require a separate agreement, while the described small-scale use has no specific limit. It also warned that access may be restricted based on request volume or usage patterns to protect service stability.

The project therefore permits OP.GG-backed access only for the disclosed free, small-scale, attributed beta posture. It reuses analysis responses across scoring factors, retains fallback behavior, and does not redistribute raw OP.GG responses. Monetization, commercial distribution, materially higher traffic, or a material access-pattern change requires a new OP.GG review and separate agreement. The complete support correspondence is retained privately; only its decision date and non-sensitive operating conditions are recorded here.

## Professional Draft Snapshot

Draft Coach's professional signals use a vendor-neutral, versioned aggregate snapshot. The initial build-time adapter queries the structured Leaguepedia Cargo API; it does not scrape rendered wiki HTML. The fetch window is limited to the current patch and two previous patches and to current international events plus tier-one LCK, LPL, LEC, LCS, LCP, and CBLOL competition. Academy, collegiate, ERL, development, and semi-professional competition is excluded by default.

Attribution:

- Source: Leaguepedia Cargo data, maintained by Leaguepedia contributors.
- Endpoint: https://lol.fandom.com/api.php
- Leaguepedia: https://lol.fandom.com/wiki/League_of_Legends_Esports_Wiki

The snapshot workflow is disabled by default. Leaguepedia community guidance received on 2026-07-15 requires authenticated MediaWiki API queries from an email-verified account using a bot password with Cargo permission. The workflow accepts that bot identity only through the `LEAGUEPEDIA_BOT_USERNAME` and `LEAGUEPEDIA_BOT_PASSWORD` GitHub Actions secrets; the values are never committed, logged, included in artifacts, or sent to desktop clients. As of 2026-07-16, both secret names are configured in GitHub Actions, while `PRO_SNAPSHOT_FETCH_ENABLED` and `PRO_SNAPSHOT_PUBLISH_ENABLED` remain unset, so the credentials are not used by either workflow job. After the API-access review is formally approved, setting the repository variable `PRO_SNAPSHOT_FETCH_ENABLED` to `true` enables its three-hour schedule and manual patch-window override. When enabled, it derives the current three-patch window from Data Dragon and uploads a private 14-day artifact containing only normalized aggregates and compact replay records, never the raw Cargo response. Desktop clients verify the schema and SHA-256 checksum before atomically replacing their local last-known-good cache. If no valid snapshot is present, recommendations continue in ranked-only mode.

Direct Cargo access from the desktop is disabled by default. It is available only through explicit operator configuration and is independently rate-limited.

Leaguepedia's API documentation describes the API as a courtesy without a guarantee of stability or accuracy. It documents a 500-row limit for ordinary Cargo queries and warns that unauthenticated Cargo access is heavily rate-limited. The wiki states that community content is available under CC BY-SA 3.0 unless otherwise noted. These facts do not by themselves constitute project-specific permission to publish derived snapshot assets.

### Release policy gate

Leaguepedia API access, attribution, caching, and redistribution terms must be re-verified before a public beta. The application attributes the source to Leaguepedia contributors and links to Leaguepedia. Community guidance indicates that API-derived data is likely covered by CC BY-SA 3.0, but the Fandom admin review has not yet confirmed the exact share-alike scope for the derived JSON/GZIP files. Automated fetching remains disabled unless `PRO_SNAPSHOT_FETCH_ENABLED` is explicitly set to `true` after the API-access review. Snapshot release publishing remains separately disabled unless `PRO_SNAPSHOT_PUBLISH_ENABLED` is explicitly set to `true` after the redistribution review. These are release gates; the implementation does not assume access or redistribution permission.

### Optional local noncommercial import

To keep professional evidence functional while Leaguepedia access and redistribution approval is unresolved, Settings can import a user-selected Oracle's Elixir CSV. The importer keeps only complete games from the app's current three-patch window and the existing international/tier-one competition allowlist, maps picks to roles, builds the same checksummed aggregate snapshot used by the rest of the app, and stores it only in Electron's local user-data directory.

Oracle's Elixir states that its downloadable data may be used only noncommercially. Draft Coach therefore does not download the CSV, bundle it, upload it, include the generated snapshot in a release, or make it part of either GitHub snapshot workflow. The file picker is the only entry point, and the app reads the selected local file only after a user action. The local snapshot identifies Oracle's Elixir / Tim Sevenhuysen as its source and carries a noncommercial/no-redistribution warning.

- Downloads: https://oracleselixir.com/tools/downloads
- Usage FAQ: https://lol.timsevenhuysen.com/about/frequently-asked-questions/

This local import makes professional evidence available for a free local preview; it does not resolve public snapshot redistribution or commercial licensing. A monetized release requires a dedicated agreement or a replacement data source.

## Fixtures

Test fixtures under `scripts/fixtures/` are minimized synthetic responses used to keep parser tests offline. Do not commit raw captured API responses without a separate policy and privacy review.
