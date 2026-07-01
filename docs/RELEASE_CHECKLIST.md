# Release Checklist

Use this checklist before making the repository public or publishing binaries.

## Safety

- [ ] Publish from a fresh sanitized repository snapshot.
- [ ] Confirm old handoff/history files are not included.
- [ ] Confirm any maintainer credentials exposed during private development have been revoked or rotated.
- [ ] Run a secret scanner against the public snapshot.
- [ ] Review raw OP.GG fixtures and replace with synthetic/minimized fixtures if needed.

## Compliance

- [ ] Register or update the product in Riot's developer portal as required.
- [ ] Include Riot non-endorsement notice in README and app.
- [ ] Review current OP.GG data-use terms.
- [ ] Confirm Data Dragon attribution and asset usage posture.

## Quality

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `npm audit`
- [ ] Review Electron runtime advisories; Electron is a devDependency but is bundled into release artifacts.
- [ ] `npm run security:scan`
- [ ] `npm run smoke:electron`
- [ ] `npm run dist:win`
- [ ] `npm run dist:mac`
- [ ] Optional: `npm run dist:mac:dmg` when DMG packaging is stable in the release environment
- [ ] `npm run release:checksums`

## Manual Live Draft Smoke

- [ ] Start League and log in.
- [ ] Start Draft Coach.
- [ ] Enter champ select in a real, custom, or practice draft.
- [ ] Confirm status changes to `In champ select`.
- [ ] Confirm board updates allies, enemies, bans, local player, and lane opponent when known.
- [ ] Confirm recommendations appear once the local role is known.
- [ ] Confirm AP picks can receive comp-fit chips in an AD-heavy allied draft.
- [ ] Confirm enemy dive/assassin threats can create risky warning chips.
- [ ] Expand `Why` and confirm score deltas, synergy breakdown, and threat breakdown are readable.
- [ ] Move a settings slider and confirm recommendations rerank without a loading phase.

## Release Artifacts

- [ ] Windows installer exists.
- [ ] macOS ZIP exists.
- [ ] Optional signed/notarized macOS DMG exists.
- [ ] SHA-256 checksum file exists.
- [ ] Release notes include known limitations and unsigned-build warnings if applicable.
- [ ] Downloads have been installed and launched on target operating systems.
