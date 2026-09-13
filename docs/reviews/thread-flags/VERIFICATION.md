# Verification — native thread flags

2026-09-13, macOS MBP; independent worktree `buzz-native-flags`.
Base:6c35e82bd50f4ad6587554eeb429e7378d474ba7.
Implementation:0836f8dcd672f34ef40a5bf834d2700a8c2bec45 (4776f35 plus review fixes).
The implementation HEAD was recorded in the same shell before the final wire
smoke and full Rust package run. Earlier UI/Tauri runs tested the same production
logic; subsequent changes added parity fixtures and reviewer documentation.
No installed Desktop, production relay, existing agent runtime or original
checkout was modified. No merge/release performed.

## Executed evidence

| Check | Result |
| --- | --- |
| Official isolated Postgres lane, full buzz-db lib |255 passed;122 non-Postgres skipped |
| Final full buzz-core/buzz-db/buzz-relay package run, including integration targets |1443 passed,2 failed,353 ignored/skipped; baseline failures below |
| Real relay signed-event/NIP-98 smoke |10 passed |
| Whole Desktop unit suite in final CI |6508 passed |
| Whole Tauri workspace tests |Passed; main library3191 passed/19 ignored; remaining targets and doc tests passed |
| Playwright smoke: actual AppSidebar and thread navigation |1 passed; only the new native query mocked |
| Postgres test discovery guard |Passed |
| Script syntax / whitespace |Passed after normalizing reviewer output whitespace |
| Final just ci |Passed (exit0), including mobile2121 tests, desktop/web builds, Tauri, formatting and lint |

Postgres/Redis used disposable loopback containers at55439/56389; live relay at
43109. Tests used public fixture keys and synthetic content only. The official
Postgres runner creates/drops isolated test databases. The default `just test`
launcher’s hardcoded container names/ports would collide with existing services,
so full affected packages plus the official isolated Postgres lane were run
instead. This is not a claim that the literal `just test` command passed.

The live smoke (`desktop/scripts/thread-flags-live.mjs`) covers signed envelopes,
a multi-row page despite outer limit1, next-page cursor, dual active flags,
reply-only exclusion, completion precedence, removal, literal `%` search, warmed
membership removal, strict bounds, archive, and an open non-member read. There
are ten grouped assertions. Actual NIP11 signer and event signature verified.
Browser evidence separately covers mount, active/complete filtering, opening the
existing thread view, and stale-list clearing on failure. It is not an installed
Tauri-to-production end-to-end test.

## Unrelated baseline failures retained

1. `buzz-db::observability_source::p0_pool_acquisitions_use_typed_operation_pairs_without_other`
   reports unchanged store/event.rs `.fetch_all(pool)`. Reproduced at exact base
   6c35e82 in the full buzz-db package:124 passed/1 failed/252 skipped. No changes
   to event.rs or the source guard were made.
2. `buzz-relay::api::mesh_demo::tests::demo_join_forwarded_arm_round_trips_echo`
   times out (504 vs200). Reproduced at exact base6c35e82 in full relay lib:
   1039 passed/1 failed. The final package run reproduces it too.

An earlier CI attempt also hit an agent fake-LLM cancellation test failure. A
full base agent package run passed698 tests; that earlier failure was **not**
reproduced on base and is not mislabeled as a proven baseline defect. Temporary
scratch-file formatting failures were corrected, not waived.

## Review and artifacts

Read FINAL_TRIAGE.md alongside all three design/implementation/delta responses.
Opus’s pending parity/wire conditions are satisfied by the actual tests above;
the stale-catch finding is contradicted by the guard already present in source.
Kimi delta approved. GLM’s remaining stale-catch finding is adjudicated on the
same full-function evidence. Astra owns adjudication and all implementation.

PR screenshots use synthetic data and the repository’s post-screenshots helper:
https://github.com/shojikumaru/buzz/pull/1#issuecomment-5652943255
The public raw image URL returned HTTP200; no private chat was uploaded.

Local raw logs are retained in the operator workspace `.scratch/native-flags-review/`:
POSTGRES_FINAL.log, PACKAGES_FINAL.log, BASE_DB_ALL.log, BASE_RELAY_TESTS.log,
LIVE_FINAL.json, DESKTOP_POST_REVIEW.log, TAURI_TESTS.log, E2E_FINAL.log,
DISCOVERY.log and FINAL_CI_VERIFIED.log. This checked-in summary preserves their
scope and outcomes; the disposable local paths are not required to use the feature.
