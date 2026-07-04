# Troubleshooting

## League Client Not Detected

- Keep Draft Coach open.
- Start or restart the League client.
- Make sure the League client is fully logged in.
- If a firewall or security tool blocks local process discovery, allow Draft Coach.

## Connected But Not In Champ Select

Draft Coach is connected to League, but League is currently in lobby, matchmaking, ready check, in game, or another non-draft state. Enter champ select to see the draft board.

## No Recommendations

Recommendations appear once Draft Coach knows your role. This can require League role assignment, pick intent, or role inference from available draft data.

## Loading Feels Slow

The first useful run may fetch Data Dragon and OP.GG-backed data. Later drafts should be faster because Draft Coach caches champion catalog and recommendation data locally.

## Limited Data Note Appears

The app could not find enough confident data for part of the recommendation. You can still use visible context, but treat the score as less certain.

## Settings Changes Rerank Instantly

Weight-only settings changes use the latest cached scored candidate pool. Draft changes regenerate candidates; slider changes should not trigger network requests.

## Windows Or macOS Security Warning

Unsigned beta builds may trigger Windows SmartScreen or macOS Gatekeeper. Public releases should be signed and notarized when certificates are available. If a release is unsigned, verify the published SHA-256 checksum before installing.

### macOS Says Draft Coach Is Damaged

If macOS says `"Draft Coach" is damaged and can't be opened`, you probably downloaded an unsigned beta ZIP with Safari quarantine metadata attached.

First, make sure you downloaded Draft Coach from the official GitHub Release and verify the SHA-256 checksum. Then remove quarantine from the unzipped app:

```bash
xattr -dr com.apple.quarantine "/Applications/Draft Coach.app"
```

If the app is still in Downloads, use the app's actual path instead:

```bash
xattr -dr com.apple.quarantine "$HOME/Downloads/Draft Coach.app"
```

The v0.1.1 macOS beta ZIP is ad-hoc signed to avoid the invalid bundle-seal issue from v0.1.0, but it is still not Developer ID signed or notarized.

## Reporting Bugs

Open a GitHub Issue and include:

- operating system
- Draft Coach version
- status line text
- whether League was open before Draft Coach started
- whether the problem happened before or during champ select
- screenshots with private information removed
