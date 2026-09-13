## 結論（翔さん向け・平易版）

差分そのものに「即アウト」の致命バグは見つかりませんでした。ただし **merge 前に潰すべき中程度の問題が 6 件**あります。特に大きいのは 3 つです。

1. エラーが出ても 30 秒ごとに問い合わせ続ける（未対応リレー／権限拒否でも永久リトライ）
2. ページ送りの「しおり」が秒単位に丸められるため、DB の時刻に 1 秒未満の端数があると**行が静かに抜ける**
3. 実際にアプリを起動して動かした証跡がない（URL の形が合わずに全リクエスト失敗する型のミスが残りうる）

判定は **Changes requested（条件付き GO）**。次にやることは、上の 3 点の修正・確認と、Postgres テストが CI で本当に走っているかの確認です。

---

## Reviewer metadata

- **Model (as reported by the harness):** `claude-opus-5` (displayed name "Opus 5"). 
- **Effort / reasoning level:** not exposed to me by this harness. Per instruction I am **not inferring** one.
- **Scope discipline:** no tools, no repo access, no delegation. I reviewed **only the pasted diff**. Every claim that depends on code outside the diff is marked `[verify]`. I could not compute the diff SHA-256 without tools, so the stated hash is unverified; I reviewed the text as pasted.

---

## Findings

### M1 — Polling never stops on permanent failure; unsupported-relay fallback is an unbounded history query
**Severity:** Medium 
**Location:** `desktop/src/features/thread-flags/ThreadFlags.tsx` (`FlagResults` effect) + `desktop/src-tauri/src/commands/messages/thread_flags.rs::decode`

**Evidence:** The refresh timer is installed unconditionally and is keyed only on `request` identity:
```ts
useEffect(() => { void request(null);
  const refresh = () => { if (!document.hidden) void request(null); };
  const interval = setInterval(refresh, 30_000); ... }, [request]);
```
`error` is not part of that effect and there is no terminal state. So a `FORBIDDEN "channel unavailable"`, a 500, or `"This relay does not support thread flags yet"` all keep firing a full request every 30 s (plus one on every `visibilitychange` back to visible, undebounced) for as long as the panel is mounted. 

Second half: on a relay that predates the extension, the filter `{"kinds":[9],"#h":[channel],"thread_flags":{...}}` carries **no `limit` and no `since`**. If the old relay's filter deserializer ignores the unknown `thread_flags` key (rather than rejecting it) `[verify against the nostr Filter deserializer + bridge.rs raw→typed conversion]`, that request is a plain unbounded kind-9 channel history query, repeated every 30 s. `decode` then correctly reports "does not support", so the user-visible behaviour is right while the network behaviour is not.

**Correction:** add a terminal/fatal state — on `403` and on the unsupported-response branch, clear the interval and render a static message instead of retrying; apply backoff (or a small retry ceiling) to transient errors. Independently, make support detection cheap: allow `limit` in the relay's `parse` key allowlist and send a small `limit` on the wire so the legacy path cannot return a full history page.

---

### M2 — Composite cursor truncates to whole seconds; sub-second `events.created_at` silently skips rows
**Severity:** Medium (Blocker if the invariant below does not hold) 
**Location:** `crates/buzz-db/src/store/thread_flags.rs` (cursor encode/decode) ↔ `PAGE_SQL` keyset predicate

**Evidence:** The emitted cursor is `created_at: time.timestamp()` (i64 seconds) and is re-bound as `DateTime::from_timestamp(c.created_at, 0)`, i.e. `.000000`. The keyset predicate is exact-equality based:
```sql
($6::timestamptz IS NULL OR e.created_at < $6 OR (e.created_at = $6 AND e.id > $7))
```
If any row has `created_at = 12:00:00.500`, the cursor becomes `12:00:00.000`; the next page asks for `< 12:00:00.000` or `= 12:00:00.000 AND id > x`. Every root in `[12:00:00.000, 12:00:00.500)` is **excluded even though it sorts after the cursor** under `ORDER BY created_at DESC, id ASC`. Rows are dropped with no error, and `Page::validate`'s ordering check cannot detect it because it compares the same truncated seconds. `KIND_WINDOW_BOUNDS`-style `has_more` also stays `true`, so the UI shows a consistent-looking but lossy list.

In practice Nostr `created_at` is whole seconds and the test fixture inserts `from_timestamp(secs, 0)` — so this is latent, not active, **conditional on every writer of `events.created_at` / `reactions.event_created_at` preserving whole seconds** `[verify: column type and all insert paths; is there any `now()`-derived event row?]`.

**Correction:** remove the dependency on the invariant. Either compare against `date_trunc('second', e.created_at)` on both the ORDER BY and the predicate, or carry the full instant in the cursor (micros) instead of seconds. Add a DB test with a `.5`-second root that must appear on page 2.

---

### M3 — SQL re-derives channel authorization; the `visibility = 'open'` and role-based branches are untested
**Severity:** Medium 
**Location:** `crates/buzz-db/src/store/thread_flags.rs` `PAGE_SQL` WHERE clause; `crates/buzz-relay/src/api/thread_flags.rs`

**Evidence:** The API gate uses the canonical `get_accessible_channel_ids`, then the row query re-implements the policy independently:
```sql
AND (c.visibility = 'open' OR EXISTS (SELECT 1 FROM channel_members cm ... cm.pubkey = $3 AND cm.removed_at IS NULL))
```
Because both must pass, the composition is safe in the permissive direction (it cannot grant more than the API gate). The risk is the other direction: **silent false negatives**. The only test exercises `ChannelVisibility::Private` + membership. Untested: (a) the literal `'open'` matches the stored encoding of the visibility enum `[verify ChannelVisibility's DB representation]`, so an open channel viewed by a non-member returns rows; (b) a community admin/owner whom `get_accessible_channel_ids` admits but who has no `channel_members` row — that viewer gets a permanently empty panel with no error.

**Correction:** call the canonical single-channel authorization predicate (or extract one) instead of re-deriving it; failing that, add DB cases for open-channel/non-member and admin/non-member, and pin the enum encoding with a test rather than a string literal.

---

### M4 — No end-to-end execution evidence; the scope-assert URL contract is unverified
**Severity:** Medium 
**Location:** `desktop/src-tauri/src/commands/messages/thread_flags.rs::get_thread_flag_page`, `desktop/src/features/sidebar/ui/AppSidebar.tsx`

**Evidence:** The listed evidence is entirely `cargo check` / typecheck / unit-and-integration test runs, plus "No deployment". The wiring that no test covers is:
```rust
assert_expected_relay_scope(Some(&expected_relay_url), &api)?; // api = relay_api_base_url_with_override(...)
```
fed from `relayUrl={activeCommunity.relayUrl}` in the sidebar. If `activeCommunity.relayUrl` is a `ws(s)://` value while `api` is `http(s)://`, and `assert_expected_relay_scope` does not normalize schemes, **every** request fails at the first assert. Similarly `fetch_relay_self_at` must return lowercase 64-char hex for `event.pubkey.to_hex() != relay_key` to ever match; an `npub…` or uppercase form makes every response "invalid relay signature". Both are compile-clean and test-clean and both fail 100% at runtime. `[verify by comparing an existing caller that passes `expectedRelayUrl` from the same `activeCommunity` field]`

**Correction:** run the panel once against a dev relay (open + private channel, flagged + unflagged root, load-more, revoked membership) before merge, and record that as evidence. If the URL forms differ, normalize at the call site rather than inside the assert helper.

---

### M5 — Writer-pool read on a mislabeled operation, unindexable predicate, and an early return that may bypass downstream limiting
**Severity:** Medium 
**Location:** `crates/buzz-db/src/store/thread_flags.rs` (`acquire_writer(..., WriterOperation::SubscriptionHistory)`), `PAGE_SQL`; `crates/buzz-relay/src/api/bridge.rs` (new branch)

**Evidence:** Three compounding facts. (1) Every poll takes a **writer** connection under an unrelated label, `SubscriptionHistory`, so this traffic is misattributed in whatever metrics that enum drives. Reading the primary is defensible for the revocation fence, but the label is not. (2) The predicate is unindexable — `strpos(lower(e.content), lower($5)) > 0` plus `regexp_replace` over full `content`, with `array_agg` over a `reactions ⋈ events ⋈ thread_metadata ⋈ channels` join and no statement timeout. (3) The new branch returns **before** the rest of `query_events_authed`:
```rust
if raw_filters.iter().any(|raw| raw.get("thread_flags").is_some()) { ... return super::thread_flags::query(...).await; }
```
If any per-tenant rate limiting, quota accounting, or audit logging lives after this point, this endpoint skips it `[verify what follows the search branch in query_events_authed]`. Combined with a 30 s client poll × every visible client × every channel switch, and `limit` up to 100 server-side, a client can drive expensive primary-pool scans at will.

**Correction:** add a dedicated `WriterOperation` variant; confirm the limiter/metering runs before the branch or move the branch after it; set a statement timeout on this query; `EXPLAIN (ANALYZE)` it on production-scale `reactions` and add the missing index if the plan starts with a `reactions` scan.

---

### M6 — The only test covering the acceptance criteria is `#[ignore]`
**Severity:** Medium 
**Location:** `crates/buzz-db/src/store/thread_flags.rs` `#[ignore = "requires Postgres"] async fn flags_history_auth_and_deletion`

**Evidence:** This single test is what covers depth-0 restriction, legacy-metadata exclusion, cross-tenant isolation, completion-wins, removal-recomputes, deletion, archive, and membership revocation — i.e. nearly the whole fixed acceptance list. It is excluded from a default `cargo test`. Everything else is a small unit test. The reported run ("DB 253 test run failed only our last-owner fixture") implies it was run locally with `--ignored`.

**Correction:** confirm `just ci` actually runs the ignored Postgres lane and that this test is in it; if not, that is a merge blocker regardless of the code. Also split it — one ~200-line test asserting ~15 behaviours gives a single bit of failure information.

---

### Low findings

| # | Location | Issue / evidence | Correction |
|---|---|---|---|
| L1 | `ThreadFlags.tsx` title rendering | Previews strip whitespace runs but not `Cf`-category characters. A root beginning with U+202E or zero-width marks renders mangled/spoofable in the sidebar. | Wrap the title in `<bdi>` (or `unicode-bidi: isolate`) and strip format characters in `regexp_replace`. |
| L2 | `PAGE_SQL` (`e.kind = 9`), `api/thread_flags.rs` (`raw["kinds"] != json!([9])`), `ThreadFlags.tsx` (`kind: 9`) | The kind is hardcoded in three places while `buzz-core::kind` is the registry the same diff extends. | Use the named constant; in SQL bind it from the constant. |
| L3 | `desktop/src/features/thread-flags/api.ts` | `FlagQuery`/`FlagRow`/`FlagPage` hand-mirror the Rust structs. With `deny_unknown_fields` on both sides, any drift is a hard runtime failure, not a soft one. | Generate the bindings if the repo has tooling; otherwise add a round-trip fixture test shared by both sides. |
| L4 | `AppSidebar.tsx` | New panel is shipped ungated while `FeatureGate` is imported in that very file, and all strings are hardcoded English. | Confirm the convention for new sidebar panels (gate + i18n) and follow it. |
| L5 | `AppSidebar.tsx` | Panel is inserted **above** `SidebarDndContext`, so selecting a stream channel pushes the whole channel tree down. Also the file carries `biome-ignore format: keep compact to stay within file size limit`, implying a size constraint this +18 lines may押し上げる. | Confirm intended placement and that the file-size lint still passes. |
| L6 | `ThreadFlags.tsx` `request` error branch and 30 s refresh | Any error clears all accumulated pages, including a transient failure on page 4; the 30 s auto-refresh also resets 5 loaded pages back to 1 while the user scrolls a `max-h-64` list. The latter matches the stated acceptance ("cap reset on refresh") but applies to the *automatic* path too. | Confirm intended; consider keeping rows on load-more failure and suppressing auto-refresh while the list is scrolled/interacted with. |
| L7 | `store/thread_flags.rs` cursor binding | `hex::decode(&c.id).ok()` and `from_timestamp(...)` silently degrade to `None`. With `$7` NULL the tie branch becomes NULL → the query silently falls back to `created_at < $6`. Currently unreachable because `validate()` runs first, so this is fragile coupling rather than a live bug. | Return `DbError::InvalidData` instead of `.ok()`. |
| L8 | `api/thread_flags.rs` | `internal_error(&format!("thread flags query: {e}"))` puts the `DbError` Display into the response `[verify whether internal_error echoes to the client or only logs]`. | Log detail, return a generic message — unless this matches the surrounding handler pattern. |
| L9 | `store/thread_flags.rs` row decode | `record.try_get::<String,_>("title")` fails with UnexpectedNull → 500 if `events.content` is nullable. | `try_get::<Option<String>>` with a default, or rely on a documented NOT NULL. |
| L10 | `thread_flags.rs` (core) `Page::validate` | `Cursor` is range-checked via `from_timestamp`, `Row.created_at` only for `< 0`. A row at `i64::MAX` validates, then its derived `next_cursor` is rejected on the *next* request. | Apply the same range predicate to rows. |
| L11 | tests | Not covered: the `pages >= 5` cap message; the 30 s interval / `visibilitychange` handler (no fake timers); a root carrying only a non-canonical emoji; the `bridge.rs` `raw_filters.len() != 1` → 400 branch. JS fixtures use non-hex ids (`"Task".padEnd(64,"a")`), so the UI tests never see realistically shaped data. | Add the four cases; use hex-shaped fixture ids. |
| L12 | `api/thread_flags.rs` | The relay signs an event whose `d` tag embeds client-controlled `q` (≤200 chars). Bounded and mitigated by the relay-only kind + `deny_unknown_fields` + version pin, and consistent with the 39006 precedent — noting it, not objecting. Related: 39007 sits in the addressable 30000–39999 range, so any generic handler that routes that range into replaceable storage would persist one row per distinct query `[verify query_relay_at_with_keys has no store side effect]`. | Confirm the 39006 precedent path is identical; otherwise shorten the `d` tag to a hash. |
| L13 | `ThreadFlags.tsx` | `fetchPage` is in `useCallback` deps; an inline arrow from a future caller would re-install the effect every render (request storm). Safe today only because the default is the module-level `fetchFlags`. | Hold `fetchPage` in a ref, or document the stability requirement. |
| L14 | Tauri command | `fetch_relay_self_at` is called on **every** poll, adding a NIP-11 round trip per 30 s per panel; `get_accessible_channel_ids` returns all accessible ids per request where a single-channel check would do. | Cache the relay self key for the session; use a targeted authorization check. |
| L15 | `ThreadFlags.tsx` `onOpen` | A synthetic `SearchHit` (`score: 0`, `channelName: null`, `content` = 240-char collapsed preview) is fed to the message-search navigation callback, with the flag query string as the second arg. If `onOpenSearchResult` also sets global search state, focuses the search panel, or records history, this leaks flag-panel state into the search feature `[verify]`. | Confirm the callback's side effects, or use a dedicated open-thread path. |

---

## What the diff gets right (kept short, for triage)

- The keyset predicate `created_at < $6 OR (created_at = $6 AND id > $7)` correctly matches `ORDER BY created_at DESC, id ASC`, and hex-string vs `bytea` ordering agree (ASCII `'9' < 'a'` makes lowercase-hex lexicographic order identical to decoded byte order), so `Page::validate`'s client-side ordering check and the SQL cannot disagree.
- The mode `CASE` is in the **outer** query, so all classification happens before the `limit + 1` probe — `has_more` is honest, with no post-limit filtering.
- Variation-selector normalisation (`translate(..., chr(65038)||chr(65039), '')`) is applied on both the `= ANY($4)` predicate and the aggregate, `array_agg(DISTINCT ...)`'s collation order is re-canonicalised in Rust, and the canonical-order equality check in `Page::validate` rejects duplicates and unknown flags in one expression. The tenant fence (`r.community_id = e.community_id`) plus the cross-tenant test genuinely prove completion does not leak across communities.

---

## Verdict

**Changes requested (conditional GO).** No Blocker is demonstrable from the diff alone. Merge gates I would hold on: **M6** (confirm CI runs the Postgres lane — otherwise the acceptance criteria are untested in CI), **M4** (one live end-to-end run), **M1** (stop polling on permanent failure), and **M2** (either fix the cursor or prove the whole-second invariant with a test). **M3** and **M5** are fix-or-explicitly-accept with the named verification commands. All Low items are follow-up except **L1**, which is a two-character fix (`<bdi>`) worth taking now.

Because I was instructed not to use tools, six findings carry a `[verify]` marker and cannot be closed by me — they need one pass by a reviewer with repo access.
