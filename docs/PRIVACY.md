# Privacy

Draft Coach is a local desktop app.

## What The App Reads

- Local League client process command line, to discover the LCU port and local auth token.
- Local League Client Update API responses for gameflow and champ-select state.
- Champion ids, assigned roles, bans, team slots, and pick state needed to build draft context.

## What The App Stores

Draft Coach stores local app data in Electron's user-data directory:

- `config.json` for settings.
- Data Dragon champion catalog cache.
- OP.GG-backed recommendation data cache.
- A validated professional-data aggregate snapshot and its freshness metadata.

## What The App Sends

Draft Coach fetches:

- Riot Data Dragon champion metadata and assets.
- OP.GG-backed MCP data for meta, matchup, analysis, damage-style, and synergy signals.
- A project-hosted, compressed professional-data snapshot when professional evidence is enabled and network access is allowed.

Professional snapshot refreshes do not include local League client state, account credentials, local picks, settings, or the LCU token. Direct Leaguepedia Cargo fallback is disabled by default and runs only when explicitly configured by the operator.

The build-time Leaguepedia fetcher can authenticate with an email-verified bot identity supplied through the `LEAGUEPEDIA_BOT_USERNAME` and `LEAGUEPEDIA_BOT_PASSWORD` environment variables. Those credentials are used only for MediaWiki login and authenticated Cargo requests. They are not written to the repository, snapshot, build artifact, logs, application cache, or desktop package.

Draft Coach should not send the local LCU token to third-party services. The token is used only to communicate with the local League client.

## What The App Does Not Do

- It does not collect account credentials.
- It does not require a Riot API key.
- It does not lock champions or automate game actions.
- It does not inject into the League process.
- It does not intentionally publish local settings or cache files.
- It does not send automatic analytics, recommendation telemetry, draft history, or expert-review feedback.

## Optional Feedback

Feedback is manual and opt-in. The app does not upload it. Reviewers who choose to share a worksheet should follow `docs/FEEDBACK_PROCESS.md`, which excludes account identifiers, chat, LCU credentials, teammate identity, and raw cache files. Submitted raw feedback is intended for a limited evaluation cycle and should be deleted after anonymized findings are extracted.

## User-Controlled Cleanup

Users can remove local app settings and caches by deleting Draft Coach's Electron user-data directory for their operating system.
