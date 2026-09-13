## Delta review — native thread-flags follow-up (read-only, no tools used)

Scope: the post-review diff above plus the supplied adjudication evidence. Where a conclusion depends on source I cannot see (`buzz_core::nip10`, `DbError`, the `insert`/`react` helpers, the stylesheet), I say so explicitly rather than asserting it.

## Verdict

**Conditional GO — not mergeable on the evidence as presented.** No blocking defect found in the changed logic itself; the root-classification redesign (`LEFT JOIN` + depth reject + SQL marker predicate) is sound and correctly structured. Two named pieces of evidence are still outstanding and one of them is load-bearing for the entire change, and there is one one-line UI defect in a changed line that I'd fix in this PR.

---

## BLOCKING

### B1. The parity test that justifies the whole redesign has not been reported green
**Location:** `crates/buzz-db/src/store/thread_flags.rs:198` (`metadata_less_root_predicate_matches_canonical_nip10_parser`)
**Evidence:** your own summary — *"latest root fix adds one parity test, pending."* Everything else rests on the claim *"Root-only, malformed-ID and bare-e tags remain roots per canonical parser."* I cannot read `parse_thread_markers`, and that claim is non-obvious: under marked NIP-10, a direct reply to a root carries **only** a `root` marker, so a parser that returns the root as parent would make cases 3 and 7 (`["e", target, "", "root"]`, and root+malformed-reply) `Some(..)` → `expected` excludes them → the SQL `NOT EXISTS` (which only looks at `tag->>3 = 'reply'`) includes them → the assertion fails.
**Correction:** do not merge until this test is green in the relay Postgres job. If it fails on the root-marker cases, the fix is one line — widen the predicate to `tag->>3 IN ('reply','root')` — and the enumeration already contains the cases that prove it. Note `just ci` excludes Postgres, so a local green `just ci` is not evidence here; the gate is `.github/workflows/_ci-relay.yml:206` → `scripts/postgres-test-run.sh`. Discovery does follow from the existing mechanism (both new tests are in the same `mod postgres_tests`, so a `postgres_tests` name filter matches `store::thread_flags::postgres_tests::*`).

### B2. Kimi's wire-test condition is not yet satisfied, and the `limit` change is exactly what makes a wire test necessary
**Location:** `crates/buzz-relay/src/api/thread_flags.rs:14-21` + `desktop/src-tauri/src/commands/messages/thread_flags.rs:61`
**Evidence:** the relay now *requires* an outer `"limit": 1`, while the real page size lives in `thread_flags.limit`. The browser test used a **mocked** native command, so it never crosses the wire; the live relay smoke is *"rerunning"*. The same field therefore means "cap the old-relay fallback to one event" on the legacy path and "ignored" on the new path — a generic limit clamp applied anywhere before or after dispatch would silently truncate every page to one row, and no test in this diff would catch it (the relay test only exercises `parse`).
**Correction:** the live smoke must assert a **multi-row** page through the real wire with the outer `limit: 1` present — at minimum ≥2 rows and a working "Older" page — not just a 200/normal response. Also grep for other constructions of this filter (docs, e2e scripts, any relay integration test) that now need `limit: 1` added, or they will start failing closed with `"requires legacy safety limit 1"`.

---

## SHOULD FIX (in this PR; one line)

### S1. A stale *failed* request wipes a fresh successful page and pauses polling
**Location:** `desktop/src-tauri/../thread-flags/ThreadFlags.tsx` — catch block at the added `polling.current.paused = true;`
**Evidence:** the `finally` block is ticket-guarded (`if (ticket.current === current)`), but the `catch` block is not: `setRows([])`, `setPage(null)`, `setPages(0)`, `setError(..)` run unconditionally, and the new line now adds `paused = true` to that unguarded set. Reachable sequence: the 30s auto refresh fires (r1) → user clicks **Refresh flags** (r2) → r2 resolves and renders → r1 then rejects (very plausible now that the DB path can return after the new 5s `statement_timeout`) → the panel clears to empty, shows an error, and **automatic refresh is pinned off** even though the newest request succeeded. The clearing half is pre-existing; the pause is new, and it converts a transient visual glitch into a stuck panel.
**Correction:** guard the handler on identity, e.g. first line of `catch`: `if (ticket.current !== current) return;` (keeps the new pause semantics for the live request and incidentally fixes the pre-existing stale-clear).

---

## NON-BLOCKING

### N1. The marker family is not closed; the parity enumeration misses the desync-prone shapes
**Location:** the `cases` vector, `thread_flags.rs:224-236`
**Evidence:** SQL matches the marker literally (`tag->>3 = 'reply'`, case-sensitive) and the ID by `^[0-9a-fA-F]{64}$`. The enumeration covers exact `reply`, uppercase *ID*, and a malformed ID — but not: `"Reply"`/`"REPLY"` casing, **two** `reply` markers, a `reply` marker whose target is the event's own id, or `reply` with a 5th element (`["e", id, relay, "reply", pubkey]`). The dangerous direction here is fail-*closed*: if the parser ignores a self-referential or duplicated `reply` marker (→ root) while the SQL sees a valid-hex `reply` tag (→ excluded), a legitimately flagged root silently disappears from the panel, and nothing in CI notices.
**Correction:** add those four shapes to the same enumeration. It costs four lines and the test is self-validating (`expected` is computed from the parser), so each case either passes or exposes a real desync. This is the "close the spelling as a family" pattern from the #145 loop.

### N2. Test fixtures still don't match live ingest, which is what hid the original bug
**Location:** `flags_history_auth_and_deletion`, root inserts (above line 395)
**Evidence:** the old inner join on `tm.depth = 0` passed only because fixtures materialise a depth-0 metadata row per root, whereas your live-relay probe showed production roots have **no** `thread_metadata` row until a reply arrives. The new parity test covers the metadata-less path, but the fixture mismatch itself is unannotated and will invite the same class of error again.
**Correction:** one comment at the root-insert site: fixtures pre-create depth-0 metadata; live ingest does not — assertions about "roots" must be exercised both ways. (Same rule as "the probe must match the production preamble".)

### N3. `hex::decode` does not pin cursor-ID length
**Location:** `thread_flags.rs:71-83`
**Evidence:** the new error paths are a real improvement (previously a malformed cursor silently returned page 1), but `hex::decode("ab")` succeeds, binding a 1-byte `bytea` into the keyset comparison against a 32-byte `e.id`. Impact is benign — a forged cursor can only move the caller's own boundary within a channel they already pass access control for — but it's a hole in an otherwise strict parse.
**Correction:** reject `decoded.len() != 32` with the same `InvalidData`. Separately, confirm `DbError::InvalidData` maps to a client-facing 4xx/NOTICE rather than `internal_error`, so a bad cursor doesn't book itself as a server fault in your metrics.

### N4. `jsonb_array_elements(e.tags)` errors, not skips, on a non-array `tags`
**Location:** `PAGE_SQL`, the new `NOT EXISTS`
**Evidence:** the function is strict, so `NULL` yields zero rows (→ treated as a root, fine), but a jsonb **object or scalar** raises `cannot extract elements from a scalar`, failing the whole query for every caller of that channel. Every write goes through a signed-event path so `tags` should always be an array; I can't see the column definition or whether any legacy/migrated row could violate it.
**Correction:** either confirm `events.tags` is `jsonb NOT NULL` with an array-shape guarantee, or wrap in `jsonb_typeof(e.tags) = 'array' AND NOT EXISTS (...)`.

### N5. Confirm `thread_metadata` is unique per event
**Location:** the new `LEFT JOIN thread_metadata`
**Evidence:** the `Some(1)`/`Some(0)` fixture shape and the sparse-row behaviour both indicate one row per event with a scalar depth, so no fan-out. But if a second row per event were ever possible, the `LEFT JOIN` would multiply candidates and duplicate entries inside the grouped reaction aggregate (duplicated flags in the UI), not just duplicate rows.
**Correction:** verify the unique/PK constraint on `(community_id, event_created_at, event_id)`. One `\d thread_metadata`.

### N6. An old relay now produces a permanent, misleading error banner
**Location:** `ThreadFlags.tsx` alert text + the legacy fallback path
**Evidence:** new desktop against an old relay gets one ordinary kind-9 event back; strict parse fails; the sidebar shows `<error> Automatic refresh paused; use Refresh flags to retry.` — and retrying can never succeed. The guidance is actionable only for transient failures.
**Correction:** distinguish "relay does not support thread flags" from a transient error, and hide the panel (or show a single static "not supported by this relay" line) in that case. Cosmetic nit in the same string: the relay message won't end with a period, so it renders as `unsupported relay Automatic refresh paused`.

### N7. `post-screenshots.sh`: the new guards are dead code under `set -e`
**Location:** `scripts/post-screenshots.sh:59-62`
**Evidence:** `git config user.name` exits 1 when unset; for `VAR=$(...)` the assignment's status is the substitution's, so with `set -e` the script aborts **before** `: "${VAR:?configure screenshot commit author}"` can print anything. (`set -u` is confirmed on by the existing `${arr[@]+...}` comment, so `set -euo pipefail` is all but certain.)
**Correction:** `SCREENSHOT_AUTHOR_NAME=$(git config user.name || true)` (same for the email), then the `:?` guards fire as intended.

### N8. `GH_REPO` is used for the raw URL but the push still targets `origin`
**Location:** same file, `REPO="${GH_REPO:-block/buzz}"` and `RAW_BASE`
**Evidence:** `git push ... origin` and `RAW_BASE=.../${REPO}/${COMMIT}` can disagree — the common `origin=upstream` + `fork=mine` layout yields a 404 raw link. Also, for the stated private-fork use case, `raw.githubusercontent.com` links to a private repo do not render in PR markdown (camo can't authenticate), so the images will be broken even for members.
**Correction:** derive `REPO` from the push remote (`gh repo view --json nameWithOwner` / `git remote get-url origin`) or assert they match; and confirm the private-repo rendering path actually works before relying on it. Tooling-only, no product impact.

### N9. Minor
- `ThreadFlags.test.mjs:22` — `Buffer.from(title).toString("hex").padEnd(64,"a")` doesn't truncate; a title over 32 bytes yields a >64-char "id". Add `.slice(0, 64)`.
- `crates/buzz-relay/src/api/thread_flags.rs` tests mutate existing keys, so **omitting** `limit` entirely is untested. Add one case asserting `{kinds:[9], "#h":[uuid], thread_flags:{}}` is now rejected.
- `<bdi>` replacing `<span>` is the right call for RTL titles; verify no stylesheet rule targets that element positionally (e.g. `button > span:last-child`).
- The 5s cap runs on a `WriterOperation::SubscriptionHistory` connection. Accepted per your adjudication, but note an abusive member can hold a writer slot for 5s per request; if a read pool exists, that's the cheaper home for this query. Not for this PR.

---

## Verified correct (worth recording, since these are the easy places to get it wrong)

- **`(tm.event_id IS NULL OR tm.depth = 0)` is in `WHERE`, not in the `ON`.** This is the classic `LEFT JOIN` pitfall and it's right: in the `ON` clause, a depth-2 reply would leave `tm` NULL and be wrongly admitted as a root. The existing `reply` fixture with `Some(1)` is the regression guard for it.
- **Layered classification is genuinely complementary, not redundant:** authoritative metadata (`depth > 0` → reject) plus a syntactic fail-safe (`NOT EXISTS` valid-hex `reply` marker) for replies whose metadata is absent because the parent hasn't landed. The rewritten `missing metadata reply` fixture now exercises exactly that second layer, rather than passing for the old accidental reason.
- **Security envelope of the fail-closed → fail-open flip is contained.** Access control is unchanged (`channel_members` UNION `visibility='open'`, predicates repeated in the row SQL), and the new open-visitor test pins both directions across a visibility flip. The worst case of a misclassification is a reply appearing as a thread entry inside a channel the caller can already read — cosmetic, not a disclosure.
- **`SET LOCAL` inside an explicit transaction** is the correct way to scope the timeout without touching pool-wide policy; it reverts on both commit and the error-path rollback.
- **Postgres regex anchoring** is newline-safe here — Postgres `~` anchors `^`/`$` to string bounds without the `n` flag, so `"a"*64 + "\nx"` fails the SQL predicate, and `hex::decode` fails it on the Rust side too. Consistent.
- **New test logic in `ThreadFlags.test.mjs` is sound**: the busy/paused/ticket interleaving asserts the four states in the right order, and the `finally` ticket guard correctly prevents a stale completion from clearing `busy` (which is why S1 is only about the `catch` path).
- `chrono::DateTime::from_timestamp(row.created_at, 0).is_none()` in `buzz-core` is correctly placed — the DB path can't produce an unrepresentable timestamp, but the desktop parses an untrusted relay response, and `created_at < 0` remains meaningful because negatives are representable.
- GLM's `Cursor` / `deny_unknown_fields` point and the `relay/scope.rs`, `get_accessible_channel_ids`, `enforce_http_admission`, nextest-discovery and pre-existing-mesh-failure adjudications are internally consistent; I'm accepting them on your evidence rather than confirming them independently.

**Bottom line:** clear B1 and B2 with actual green output, land the one-line S1 guard, and this is a GO from me. I have not approved anything I authored, and N1 is the item I'd most want addressed before the next round even though it isn't blocking.
