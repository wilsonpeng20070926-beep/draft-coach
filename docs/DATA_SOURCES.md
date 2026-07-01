# Data Sources And Attribution

Draft Coach combines local League client state with public game-data context.

## League Client Update API

Draft Coach reads local champ-select state from the League Client Update API on the user's machine. This is used to identify gameflow phase, allied picks, enemy picks, bans, local player role, and lane opponent context.

The app is read-only. It does not automate champion selection, lock champions, inject into League, or modify gameplay.

Riot policy references:

- https://developer.riotgames.com/docs/lol
- https://developer.riotgames.com/policies/general

Riot notice:

Draft Coach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Data Dragon

Draft Coach uses Riot Data Dragon for champion names, ids, tags, icons, and current catalog metadata. Champion catalog data is cached locally so repeated runs are faster.

## OP.GG-Backed Data

Draft Coach uses OP.GG-backed MCP responses for meta, matchup, analysis, damage-style, and synergy signals. These responses are cached locally with a time-to-live and are used to compute recommendation factors.

OP.GG policy references:

- https://help.op.gg/hc/en-us/articles/31091405109401-Can-I-use-OP-GG-data
- https://op.gg/lol/policies/agreement

Before broad public or commercial distribution, maintainers should confirm that the planned usage, request volume, citation, and redistribution posture are acceptable under current OP.GG terms.

## Fixtures

Test fixtures under `scripts/fixtures/` are used to keep parser tests offline. Before publishing, maintainers should review whether raw captured responses should remain public or be replaced with minimized synthetic fixtures.
