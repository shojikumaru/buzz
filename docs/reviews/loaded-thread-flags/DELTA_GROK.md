## Delta review: loaded-only sidebar (ownership pass)

**Requested model:** not specified (read-only independent delta review)  
**Actual model:** Grok 4.5 (xAI)

**Scope:** supplied snippets only. No tools, no unseen files, no invented runtime behavior. Claims about App.tsx / `api.ts` deletion / owner-hook wiring / live CI are treated as context, not verified here.

---

### Findings

#### 1) LOW — misleading unit-test comment (not a product bug)
- **Location:** `ThreadFlags.test.mjs` — ownership test, block that sets `pubkey: agent` / `"Agent edited"`
- **Evidence:** Comment says a signer is not an actor merely from an untrusted `actor` tag, but the assertion expects **`🚩 Agent edited`** (edit accepted). With `relaySelf` still set, root author resolves to `agent`, and the edit is signed by `agent`, so this is authorized self-edit of the resolved author — not a spoofed-actor rejection case. The next step (remove `relaySelf` → original text) is the real trust fail-closed check.
- **Smallest correction:** Rewrite the comment to match the assertion (e.g. “trusted relay + agent-signed edit applies; removing relay trust fails closed”), or change the fixture to the spoof case the comment describes.

#### 2) LOW — unused E2E return field
- **Location:** `thread-flags.spec.ts` — `page.evaluate` return `{ id, channelId }`
- **Evidence:** `channelId` is never used after the evaluate.
- **Smallest correction:** Return `{ id }` only (or use `channelId` in an assertion).

#### 3) INFO (verification caveat, not a code defect)
- **Location:** verification claims in the brief
- **Evidence:** Prior sidebar E2E (pre-ownership) and typecheck-with-ownership are claimed green; **full Desktop + final E2E are explicitly RUNNING and must not be counted passed**. Owner `useChannelMembersQuery` adoption of `channelMembersKey` is claimed but **not in the supplied tree**.
- **Smallest correction:** Treat merge/GO as blocked on final E2E + CI green; optionally paste the owner-hook `queryKey` line into the review pack next time.

---

### Goal / constraint check (from supplied code only)

| Requirement | Result |
|---|---|
| Loaded selected-channel messages/reactions only | **Met** — passive `channelMessagesKey(channel.id)`; roots via `selectLoadedFlags` on canonical timeline |
| 🚩/🔴 active; ☑ hides from active; completed searchable | **Met** — `loadedFlags.ts` complete short-circuit + `complete`/`all` modes |
| No new network / query mount / timer / persistence / option mutation | **Met in supplied production code** — `useCachedQuery(ies)` only `getQueryState` + cache subscribe; unit test asserts `observersCount === 0`, unchanged `queryFn`/`staleTime`/`gcTime`, `calls === 0` after invalidate/focus/online |
| Existing cache + canonical formatter | **Met** — `formatTimelineMessages(...)`; profiles via `usersBatchEntryKey` / `profile` / `managed-agents` + same `useMessageProfiles` |
| Error retained data ignored | **Met** — messages/members/relaySelf/profile/managed/batch entries all drop `status === "error"` |
| Members ≠ edit authorization | **Met** — members passed for formatter display path; ownership test exercises batch `ownerPubkey` + relay trust, not member role |
| Accepted incomplete history / Hosted relay unchanged | **Met in UI copy + design**; E2E asserts `get_thread_flag_page` never called |
| Scope remount / shape guard / visibility | **Met** — keyed remount, control reset test, `{ pages: [] }` → alert, archived/forum hidden, open non-member allowed |
| Test helper spread / client GC cleanup / live deletion E2E | **Met as written** — `{ ...ui, ...app }` so bound queries win; `client.clear()`; kind `5` via `__BUZZ_E2E_EMIT_MOCK_MESSAGE__`; no fixed `e*64` id |

**Acceptable frame limitation (stated):** missing ownership cache may omit an owner edit until loaded; panel does not fetch for itself. Matches implementation.

---

### Verdict

**Approve (code), with verification still open.**

No High/Medium product defects in the supplied final loaded-only + ownership-delta implementation. Remaining items are LOW test nits plus the explicit unfinished Desktop/final E2E/CI gate. Do not treat this review as CI-green evidence.
