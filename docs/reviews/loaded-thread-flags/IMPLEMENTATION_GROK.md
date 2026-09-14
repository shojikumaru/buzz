## Independent implementation review

**Model:** Grok 4.5 (identity exposed in this runtime)  
**Mode:** Read-only, frozen snapshot only. No tools, edits, or unseen files.

**Verdict: APPROVE WITH NOTES** — no High/Critical defect evidenced inside the supplied files; residual risk is integration assumptions outside the snapshot (members key ownership, AppSidebar wiring, API-file removal). Do not treat pending Desktop/E2E runs as green.

---

### Findings

#### 1) Medium — Members cache key is locally invented, not shared with owners
- **Where:** `desktop/src/features/thread-flags/ThreadFlags.tsx` — `membersKey = ["channels", channel.id, "members"]`
- **Evidence in snapshot:** `channelMessagesKey` and `relaySelfQueryKey` are imported factories; members is the only dependency keyed by an inline tuple. DECISIONS require passing already-cached members for trusted author/edit resolution. Wrong key ⇒ `members?.data` is always `undefined` (silent degradation, not a fetch).
- **Smallest correction:** Import and use the same members query-key factory that the channel members owner uses (mirror `channelMessagesKey` / `relaySelfQueryKey`).
- **Note:** Self-edit unit coverage can still pass without members; that does not prove moderator/relay-self edit paths resolve.

#### 2) Low — `useCachedQuery` notifies on every QueryCache event
- **Where:** `desktop/src/features/thread-flags/useCachedQuery.ts` — `cache.subscribe(notify)`
- **Evidence:** Subscription is cache-global, not query-filtered. Correctness is likely preserved because `getQueryState(key)` should return a stable reference when this query is unchanged (Object.is bailout), but unrelated cache traffic still wakes the store callback.
- **Smallest correction:** Filter inside subscribe (`if (event.query.queryHash === hash) notify()`), or subscribe only to that query’s cache entry if the installed TanStack API exposes it — without adding an observer / changing options / extending `gcTime`.

#### 3) Low — Members / relay-self retain error `data`; only messages are fail-closed
- **Where:** `ThreadFlags.tsx` — messages: `status === "error" ? EMPTY_EVENTS : …`; members/relaySelf: always `members?.data` / `relaySelf?.data`
- **Evidence:** Comment + DECISIONS explicitly fail-close **message** retained pages (e.g. 403). Members/relay-self are not given the same treatment. Stale member/self cache can still affect edit/author resolution while message rows are hidden.
- **Smallest correction (if desired to align with fail-closed spirit):** Pass `undefined` when those queries are `status === "error"` (still no fetch). Not required by the frozen message-row policy as written.

---

### Goal / DECISIONS cross-check (in-snapshot)

| Requirement | Snapshot assessment |
|---|---|
| No new network / timer / query / persistence / option writes | **Met.** `useCachedQuery` only `getQueryState` + cache subscribe; tests assert 0 observers, unchanged `queryFn`/`staleTime`/`gcTime`, 0 fetches after invalidate/focus/online. |
| Loaded-only roots; no exhaustive history | **Met.** Copy states loaded-only; `selectLoadedFlags` keeps `kind===9`, `depth===0`, no `parentId`/`rootId`, not `pending`. |
| Fail-closed on message query error (no stale private rows) | **Met** for events: error ⇒ `EMPTY_EVENTS` + alert; retained TQ `data` unused. Background success path not blanked. |
| Canonical formatter; avatar `null`; pass cached members + relay-self | **Met in call shape** (`formatTimelineMessages(events, channel, pubkey, null, … members, … relaySelf)`). Members key match unverified (Finding 1). |
| VS stripping only in classifier; fixed flag order; filter before cap | **Met.** `replace(/[\uFE0E\uFE0F]/g,"")`; `FLAGS` order; `selectLoadedFlags` then `slice(0, limit)`. |
| Completion hides from active/coordinate/progress; restore on removal | **Met** in `loadedFlags.ts` + unit/E2E scenarios as written. |
| `onOpen(SearchHit, query)` preserved | **Met** in literal fields used; `tsc passed` (per brief) supports type fit. `threadRootId: message.id` is correct for guarded depth-0 roots. |
| Hosted relay / native unused by panel | **Met in panel + E2E intent** (`get_thread_flag_page` stubbed, expect 0 calls). |
| Scope remount / no cross-account rows | **Met in panel:** `LoadedFlags` keyed by `[relayUrl, pubkey, channel.id]`; tests remount channel / new `QueryClient`. App.tsx provider keying cited in brief — **not in this snapshot**. |

---

### Out of snapshot (not inventable; do not count as defects or passes)

- `AppSidebar` actually passing selected `Channel`, `relayUrl`, `pubkey`, existing navigation callback  
- Old frontend API file removal  
- `formatTimelineMessages` / native `ChannelScreen` query ownership  
- Desktop suite / browser E2E final green (explicitly in progress)

---

### Summary

Implementation matches the frozen loaded-only, passive-cache, fail-closed-on-message-error design on the code that was supplied. The only substantive correction worth making before merge confidence is **wiring members through the shared query-key factory** so edit/authority resolution cannot silently no-op. Everything else is Low or external verification.

**Final verdict: APPROVE WITH NOTES**
