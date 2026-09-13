• ## Delta review — thread-flags native follow-up

  Scope: post-review diff only (buzz-core validation, buzz-db SQL + parity tests, relay strict parse, desktop command/sidebar/ThreadFlags, screenshot script). Reviewed read-only against the supplied evidence.

  ### Blocking findings

  **None.** All Opus change requests are addressed in a way that is internally consistent with the supplied evidence:

  - **Root/metadata gap (the design-review correction)** — `crates/buzz-db/src/store/thread_flags.rs:22-31`: LEFT JOIN + `(tm.event_id IS NULL OR tm.depth = 0)` + `NOT EXISTS (e-tag, marker at index 3 = 'reply', 64-hex target)`. This exactly matches the ingest contract stated in the evidence (`parse_thread_markers().resolve()` → `None ⇒ Ok(None)` ⇒ no metadata row for normal roots). The LEFT JOIN cannot fan out (same join keys as the prior INNER JOIN, one metadata row per event assumed by the old query too). The parity test pins SQL outcomes to the same frozen parser for bare-e, root, reply (lower/upper hex), malformed-ID, and mixed-tag cases, and the `flags_history_auth_and_deletion` fixture now exercises the real "metadata-less reply" path through `NOT EXISTS` instead of the old inner-join accident. No post-limit classification reintroduced.
  - **Old-relay fallback cap** — relay `parse` now requires `limit: 1` (`crates/buzz-relay/src/api/thread_flags.rs:14-21`) and the desktop command sends it (`desktop/src-tauri/src/commands/messages/thread_flags.rs:61`); strict-parse test updated for both directions. Consistent pair.
  - **Cursor decode** — explicit `InvalidData` errors instead of silent `None`; this now matches the already-present `#[serde(deny_unknown_fields)]` (GLM's cursor comment was indeed factually wrong per the adjudicated evidence).
  - **statement_timeout** — `SET LOCAL '5s'` inside an explicit transaction on the already-acquired connection; transaction-scoped, so no pool-wide policy leak; failure path drops the tx → rollback. Correct.
  - **Auto-refresh suspension/overlap** — `polling.current` gate in `ThreadFlags.tsx:94,127-133,141-142` pauses on error, blocks concurrent automatic requests, and the manual "Refresh flags" path resets `paused` via the unconditional reset at request start. Matches the Desktop6494 regression test evidence.
  - **AppSidebar reorder** — the moved JSX block is byte-identical, same condition, same props; only position relative to `SidebarDndContext` changed. Matches the passed browser navigation evidence.
  - **Whole-second timestamp / cursor invariant** — the new assertions (`stored.timestamp_subsec_nanos() == 0`, `from_timestamp` guard in `buzz-core/src/thread_flags.rs:141`) are consistent with the cited `store/event.rs:398,1357` canonical paths; no fractional-cursor or `date_trunc` indexing change was introduced. Correct call.
  - **Screenshots script** — `GH_REPO` override plus explicit author-config failure and DCO trailer via second `-m` are sound; `${arr[@]+...}` bash-3.2 guards retained.

  ### Non-blocking observations (do not gate)

  1. **Untested marker-at-index-2 shape** (`crates/buzz-db/src/store/thread_flags.rs:28-30` and the parity test's case list). SQL checks `tag->>3 = 'reply'` only. If the canonical parser also honors the legacy positional form `["e", <id>, "reply"]` (marker at index 2), SQL and parser diverge for *metadata-less* rows of that shape. Ingest normally backstops this (a parser-recognized reply gets a depth>0 row, excluded by `tm.depth = 0`), so the exposure is limited to legacy rows that never got metadata. One added parity case `["e", &target, "reply"]` would settle it in either direction; the in-code comment "mirrors nip10::parse_thread_markers; parity tests pin it" slightly overclaims until then.
  2. **Overlap half of the new desktop test is vacuous** (`ThreadFlags.test.mjs:155-160`). Only one `tick()` fires while the first request is pending, so `calls === 1` would pass even without the `busy` guard. The pause/resume assertions (the actual regression) are real; a second `tick()` before `fail(...)` would make the title's "does not overlap" claim true.
  3. **Stale-request catch can set `paused`** (`ThreadFlags.tsx:127`). The added `polling.current.paused = true` runs before/outside the ticket guard used in `finally`; a late-rejecting superseded request could pause polling after a successful manual retry. Requires overlapping manual requests, pre-existing pattern otherwise — worth a `ticket.current === current` guard when next touched, not now.
  4. `scripts/post-screenshots.sh:59-60`: under `set -e`, a missing `user.name` makes `$(git config user.name)` abort before the `:?` message fires, so the friendly error text is mostly unreachable. Cosmetic.

  ### Verdict

  **Approve.** Every previously requested change is implemented, internally consistent across all four layers (core validation, DB SQL, relay contract, desktop client/UI), and backed by the cited passing evidence (Desktop6494, DB254 + new parity test, browser navigation, relay smoke, baseline failure attribution). The four notes above are follow-up-quality items; none blocks delivery of the PR.

