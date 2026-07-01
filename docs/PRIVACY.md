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

## What The App Sends

Draft Coach fetches:

- Riot Data Dragon champion metadata and assets.
- OP.GG-backed MCP data for meta, matchup, analysis, damage-style, and synergy signals.

Draft Coach should not send the local LCU token to third-party services. The token is used only to communicate with the local League client.

## What The App Does Not Do

- It does not collect account credentials.
- It does not require a Riot API key.
- It does not lock champions or automate game actions.
- It does not inject into the League process.
- It does not intentionally publish local settings or cache files.

## User-Controlled Cleanup

Users can remove local app settings and caches by deleting Draft Coach's Electron user-data directory for their operating system.
