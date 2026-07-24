# Release Approval Requests

Last reviewed: 2026-07-13

Use this packet to resolve the three external gates in `RELEASE_POLICY_STATUS.json`. Do not commit account details, API keys, access tokens, private email addresses, support attachments, or unredacted correspondence. Keep the original response in a private maintainer record and commit only the decision, review date, and non-sensitive conditions needed to operate the project correctly.

## Evidence Packet

Prepare these once and reuse them where appropriate:

- Product name: Draft Coach.
- Release candidate: `v0.2.0` from the current `main` branch.
- Repository: https://github.com/wilsonpeng20070926-beep/draft-coach
- A short screen recording showing startup, live or simulated champ select, multiple recommendations, the expanded `Why` view, settings, and the privacy/data-source panels.
- [User Guide](USER_GUIDE.md), [Privacy](PRIVACY.md), [Data Sources](DATA_SOURCES.md), and [Scoring](SCORING.md).
- A statement that the app is read-only: it does not select or lock champions, send League client actions, modify gameplay, expose hidden player data, or collect automatic telemetry.
- A statement that public binaries and professional-data automation remain disabled until the corresponding review is recorded.

Do not submit a GitHub repository alone as the Riot product demonstration. Riot's current FAQ asks native-app developers for a user-facing site or another clear, working demonstration. Attach a screen recording or accessible prototype that makes the user flow understandable.

## Riot Product Registration

Start at the [Riot Developer Portal](https://developer.riotgames.com/) and use **Register Product** after signing in. The [portal guide](https://developer.riotgames.com/docs/portal) describes the application and its messaging channel; the [League policy](https://developer.riotgames.com/docs/lol) requires the applicable registered status.

Suggested product description:

```text
Draft Coach is a read-only Windows and macOS desktop companion for League of Legends champ select. It reads the local League Client Update API to reconstruct visible picks, bans, and assigned roles, then presents several explainable champion recommendations. It never selects or locks a champion, sends League client actions, modifies gameplay, displays hidden information, or analyzes private player identity.

Recommendations combine current champion catalog data with bounded meta, matchup, synergy, and composition signals. The UI presents multiple choices and confidence-limited explanations rather than making or automating the player's decision. The app includes Riot's required non-endorsement notice, stores only local caches/settings, and has no automatic telemetry.

We are requesting registration for a small friend beta of version 0.2.0. Please confirm whether this product and its champ-select recommendation flow can be recorded as Approved or Acknowledged, and identify any changes required before distributing the desktop binaries.
```

Ask Riot to address these points explicitly:

1. Whether the read-only multi-recommendation champ-select flow is acceptable under the game-integrity policy.
2. Whether a small friend beta should be registered as a personal project or another product type.
3. Whether the resulting product status is `Approved` or `Acknowledged` for the proposed distribution.
4. Any required wording, presentation, or data-source change before binary distribution.

Record privately:

- product/application identifier;
- submission and response dates;
- status shown by the portal;
- any conditions or required changes;
- a redacted status screenshot suitable for the release record.

## Leaguepedia / Fandom Review

Use the [Leaguepedia contact page](https://lol.fandom.com/wiki/Leaguepedia:Community/Contact), which currently recommends its community Discord, and include the [Leaguepedia API documentation](https://lol.fandom.com/wiki/Help:Leaguepedia_API) in the request.

Suggested request:

```text
Hello — I maintain Draft Coach, a read-only League of Legends champ-select assistant. I am requesting guidance before enabling our Leaguepedia Cargo integration or redistributing its derived snapshot.

The fetcher uses the structured Cargo API rather than rendered-page scraping. It requests only the current patch and two previous patches for major international and tier-one leagues. Pagination is 100 rows, requests are separated by at least 1.5 seconds, transient failures retry at most three times with exponential backoff, and the client identifies itself as DraftCoach-ProSnapshot/0.2.0 with the public repository URL. Automation is currently disabled. If approved, the planned cadence is once every three hours.

Raw Cargo responses are not published. The pipeline normalizes the selected games into aggregate champion/draft statistics and compact replay records, validates them, and creates checksummed JSON/GZIP assets. A private build artifact is retained for 14 days; a public static snapshot would be enabled separately only after this review.

Please confirm: (1) whether this request pattern and cadence are acceptable; (2) the required attribution; (3) whether the derived JSON/GZIP snapshot is covered by CC BY-SA 3.0 and, if so, exactly which snapshot files or accompanying materials must use that license; and (4) any additional caching, redistribution, or share-alike conditions we must follow.
```

Do not enable either variable until its corresponding answer is recorded:

- `PRO_SNAPSHOT_FETCH_ENABLED` controls Cargo API access.
- `PRO_SNAPSHOT_PUBLISH_ENABLED` controls public snapshot redistribution.

## OP.GG Written Clarification

Use the official [OP.GG request form](https://help.op.gg/hc/en-us/requests/new). Link both the current [data-use help article](https://help.op.gg/hc/en-us/articles/31091405109401-Can-I-use-OP-GG-data) and the [general Terms of Use](https://op.gg/lol/policies/agreement), because the release gate exists to resolve their differing language.

Suggested request:

```text
Hello — I maintain Draft Coach, a read-only League of Legends champ-select desktop assistant, and I am requesting written clarification before a small public/friend beta.

The app connects to OP.GG's public MCP endpoint and requests champion meta, matchup, analysis, damage-style, and synergy fields needed to rank several explainable champ-select choices. Responses are cached locally for six hours using patch-scoped request keys; repeated scoring reads the shared cache. The candidate pool is capped at 40, raw responses are not redistributed, and the app does not automate any League client action. OP.GG is cited in the repository's data-source documentation and in relevant limited-data UI messages.

Your data-use help article says responsible crawling with citation is generally permitted, while the general Terms prohibit scraping or data mining and restrict commercial reuse without express consent. Please confirm in writing whether the MCP-backed access described above is permitted for a free desktop beta, and specify required citation, request-volume, caching, redistribution, and future commercial-use conditions. If it is not permitted, please say so explicitly so we can disable the OP.GG integration before release.
```

Record privately:

- support request identifier and submission date;
- the complete response and response date;
- whether free public distribution is permitted;
- required citation, caching, volume, and redistribution conditions;
- whether a new review is required before monetization.

Resolution recorded 2026-07-24:

- OP.GG Support replied on 2026-07-21 to the disclosed free, small-scale beta request.
- The described small-scale use has no specific limit, but access can be restricted when request volume or usage patterns affect service stability.
- Commercial service or product use requires a separate agreement.
- The project keeps six-hour patch-scoped local caching, visible attribution, a candidate cap of 40, request reuse, and no raw-response redistribution.
- The complete correspondence and support identifier remain in the private maintainer record.

## Closing A Gate

For each response:

1. Implement every required product, attribution, request-rate, caching, or licensing change.
2. Add focused regression coverage for enforceable technical conditions.
3. Update `docs/RELEASE_POLICY_STATUS.json` with the review date, status, a non-sensitive summary, owner action, and authoritative public policy/contact URLs.
4. Run `npm run release:policy:report` and the full release checklist.
5. Run `npm run release:policy:assert`. Do not tag or publish stable `v0.2.0` until it exits successfully. A separately labeled owner-authorized `vX.Y.Z-preview.N` prerelease may use `npm run release:policy:preview`; it does not close any gate and must carry the recorded uncertified-preview disclosure.
