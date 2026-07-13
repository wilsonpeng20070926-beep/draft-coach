# Draft Coach

Draft Coach is a read-only desktop companion for League of Legends champ select. It watches your local League client through the League Client Update API, builds a live draft state, and recommends champions with explainable draft-aware scoring.

The current app includes meta anchoring, lane-counter signals, team-counter warnings, ally synergy, composition fit, weight presets, instant reranking when settings change, and an expandable `Why` view for each recommendation.

[Explore the privacy-safe interactive product demonstration](https://draft-coach-wilson-demo.savory-heron-7495.chatgpt.site/). It uses synthetic data and makes no Riot, OP.GG, or Leaguepedia requests.

> Draft Coach is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Status

- Current engineering version: `v0.2.0`; an explicitly uncertified friend-preview channel is available while stable public release remains blocked pending the recorded policy approvals.
- Public product demonstration: deployed and available for external review.
- Supported app targets: Windows and macOS desktop builds.
- Developer runtime: Node 24 (see `.nvmrc`).
- License: MIT.
- Riot product registration: required before broad public distribution.
- Signing/notarization: recommended for public binaries; unsigned beta artifacts should be clearly labeled.

## Features

- Live champ-select detection through local LCU.
- Normalized ally, enemy, ban, local-player, lane-opponent, and role state.
- OP.GG/Data Dragon-backed meta, matchup, analysis, damage-style, and synergy data with local caching.
- Candidate generation from meta, matchup, synergy, and composition signals.
- Draft-aware scoring with signed factor deltas and confidence-aware explanation chips.
- Composition readout for allied AD/AP balance, team needs, and enemy threat pressure.
- Settings panel with presets and advanced controls for scoring weights and confidence thresholds.
- Network-free reranking when only factor weights change.
- Live and offline Simulator modes with explicit targets and hypothetical threat planning.
- Optional professional-draft evidence with freshness, ranked-only fallback, multiple favorite teams, and expandable provenance.

## Download

The owner-authorized `v0.2.0-preview.1` release is an uncertified prerelease for friend testing. It must remain visibly labeled as unregistered, unapproved, unsigned, and not production-ready. Stable `v0.2.0` publication remains blocked until `npm run release:policy:assert` passes. The existing `v0.1.1` prerelease predates Draft Intelligence v2 and should be treated as a historical beta.

Expected release artifacts:

- `draft-coach-0.2.0-win-x64.exe`
- `draft-coach-0.2.0-mac-arm64.zip`
- `SHA256SUMS-draft-coach-windows.txt`
- `SHA256SUMS-draft-coach-macos.txt`

Until Developer ID signed and notarized builds are available, Windows SmartScreen and macOS Gatekeeper may warn that the app is from an unidentified developer. A signed/notarized macOS DMG is planned for a later release path; current macOS ZIP packaging uses ad-hoc signing.

## Quick Start For Users

1. Download the installer or archive for your operating system from the appropriate GitHub Release, and read its certification and signing warning before opening it.
2. Install or unzip Draft Coach.
3. Open the League client and log in.
4. Launch Draft Coach.
5. Enter champ select in a real, custom, or practice draft.
6. Wait until your role is known, then read the recommendations and expand `Why` for details.

No Riot API key, OP.GG key, or environment file is required.

## Developer Setup

```bash
nvm use
npm ci
npm run dev
```

The Electron window is intentionally compact and always on top so it can sit beside the League client.

## Quality Checks

```bash
npm run typecheck
npm test
npm run build
npm run evaluation:test
npm audit --omit=dev
npm audit
npm run security:scan
npm run release:policy:report
npm run smoke:electron
```

Run full `npm audit` before publishing binaries. Electron is listed as a development dependency because it is part of the build toolchain, but it is also the runtime bundled into release artifacts.

Packaging commands:

```bash
npm run dist:dir
npm run dist:win
npm run dist:mac
npm run dist:mac:dmg
npm run release:checksums
```

`dist:mac:dmg` is optional until signing/notarization is in place.

## How Recommendations Work

Draft Coach starts from role-aware meta strength, then adjusts candidates with lane matchup, enemy-team threat, ally synergy, and composition-fit factors. Each recommendation includes a total score, visible reason chips, and an expanded score breakdown.

Explanations are intentionally hedged when confidence is limited. Role inference, thin samples, missing matchup data, and external data-source changes can all reduce certainty.

## Settings

- `Coach`: balanced draft-aware preset.
- `Trust the meta`: prioritizes stable meta strength.
- `Lane bully`: emphasizes lane matchup and enemy pressure.
- `Team comp`: emphasizes ally synergy and composition needs.
- `Top N`: number of recommendations shown.
- `Pick floor`: minimum pick-rate threshold used to avoid very thin samples.
- `Shrink K`: sample-size shrinkage used when confidence is low.
- `Chip confidence`: minimum confidence needed for visible reason chips.
- `Professional evidence`: enable/disable the validated pro snapshot contribution.
- `Pro influence`: tune its bounded effect.
- `Favorite teams`: optional, comma-separated strategy context with no default favorite.

## Troubleshooting

See [Troubleshooting](docs/TROUBLESHOOTING.md).

Common cases:

- Leave Draft Coach running and restart League if the app says the League client is not detected.
- Enter a draft mode if the app is connected but says it is not in champ select.
- Wait for your role to be assigned or inferred if recommendations are empty.
- First useful run can be slower because Data Dragon and OP.GG-backed data are cached locally.

## Data, Privacy, And Attribution

Draft Coach reads local League client state and fetches public game-data context. See:

- [Data Sources](docs/DATA_SOURCES.md)
- [Scoring](docs/SCORING.md)
- [Privacy](docs/PRIVACY.md)
- [User Guide](docs/USER_GUIDE.md)
- [Evaluation](docs/EVALUATION.md)
- [Calibration Report](docs/CALIBRATION_REPORT.md)
- [Release Policy Status](docs/RELEASE_POLICY_STATUS.json)
- [Release Approval Requests](docs/RELEASE_APPROVAL_REQUESTS.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md).

## Release Checklist

Before broad public distribution, complete the [Release Checklist](docs/RELEASE_CHECKLIST.md). At minimum, resolve every machine-readable policy blocker, confirm secret scanning, run evaluation and dependency gates, smoke-test Windows/macOS artifacts, and publish release checksums.
