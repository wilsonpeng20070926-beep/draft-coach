# Privacy-Preserving Feedback Process

Draft Coach does not include automatic telemetry. Feedback is manual, opt-in, and separate from normal app operation.

## Collection rules

1. Ask the reviewer for consent before collecting a worksheet or screenshot.
2. Use `docs/EXPERT_REVIEW_WORKSHEET.md` and assign a random submission identifier.
3. Do not collect summoner names, Riot IDs, account identifiers, chat, LCU tokens, local paths, teammate identity, or raw cache files.
4. Prefer champion/role state and the recommendation's already-visible evidence.
5. Remove image metadata and crop account-identifying UI before submission.
6. Record only a day-level date unless finer timing is necessary to reproduce a freshness bug.

## Storage and access

- Keep unsubmitted worksheets on the reviewer's device.
- Store submitted feedback in a maintainer-controlled private location with access limited to people evaluating Draft Coach.
- Do not merge raw worksheets into the public repository.
- Retain raw submissions only as long as needed for the stated evaluation cycle; default to 90 days.
- Convert useful findings into anonymized scenario fixtures or aggregate counts, then delete the raw submission.

## Reporting

Report motivated wins, regressions, missing evidence, wording concerns, and timing problems. Do not publish player-level histories. A small or self-selected review sample must be labeled as such and must not be presented as population telemetry.

## Withdrawal and deletion

Reviewers can request deletion using the random submission identifier. Maintainers should delete the raw worksheet and any private screenshot, then confirm completion. An anonymized software fixture that cannot reasonably be linked back to the reviewer may remain.

## Changes to this process

Adding automatic telemetry, crash-report uploads, account-linked feedback, or background analytics requires a new explicit product decision, an updated privacy review, user-facing consent, and a corresponding configuration/removal path. It is not authorized by the current plan.
