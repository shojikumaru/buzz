• # Independent implementation review — loaded thread-flags panel

  Model identity: not exposed in this invocation (the frozen DECISIONS.md line "Kimi K3, effort not exposed" is consistent with that; nothing further is reported).

  ## Findings

  **1. Low — hardcoded members cache key instead of a key factory**
  Location: `ThreadFlags.tsx`, `membersKey = ["channels", channel.id, "members"] as const`.
  Evidence: the same file imports `channelMessagesKey` from `messageQueryKeys` and `relaySelfQueryKey` from moderation hooks, but the members key is an inline literal. If the real members query is keyed by a factory (or later gains a relay/community segment, like the `communityKey` scoping described in the brief), `members?.data` silently becomes `undefined`. There is no error path — the panel would keep rendering, but `formatTimelineMessages` would resolve trusted authors/authorized edits without the member list, i.e. silent degradation of the edit-authorization input the design explicitly wanted passed through.
  Smallest correction: import and use the shared members key factory (same pattern as `channelMessagesKey`); if none exists, co-locate the literal next to the query that owns it.

  **2. Low — `formatTimelineMessages` positional args 5, 7, 8 passed as `undefined`, semantics unverifiable from snapshot**
  Location: `ThreadFlags.tsx`, the 9-argument `formatTimelineMessages(events, channel, pubkey, null, undefined, members?.data, undefined, undefined, relaySelf?.data)` call.
  Evidence: `tsc` passing proves only arity/types, not that the three `undefined` positions are semantically inert (e.g., if position 5 or 7 gates deletion handling, authorized-edit resolution, or self-reaction marking, passing `undefined` could change rows without any type error). Scope evidence covers args 3 (viewer), 4 (avatar:null), 6 (members), 9 (relay-self) only. Within the frozen snapshot I cannot confirm positions 5/7/8; per scope I do not assume a defect, but this is the one call where a silent behavioral mismatch is possible.
  Smallest correction: none in code if positions 5/7/8 were verified against the formatter signature during authoring; otherwise a one-line check against `formatTimelineMessages.ts` and switching to the intended values.

  **3. Info — verification still pending**
  The desktop suite and browser E2E are stated as running, and per instructions pending tests are not counted as passed. The test/E2E assertions reviewed below are internally consistent but unverified as green. Verdict is conditional on both finishing green.

  **4. Nit — cache-wide subscription in `useCachedQuery`**
  Location: `useCachedQuery.ts`, `cache.subscribe(notify)`.
  Evidence: every `QueryCache` event (any query, any key) triggers a snapshot read; `getQueryState` returning a stable `query.state` reference means React correctly bails out, so this is wasted calls, not stale UI or re-render churn. Given the desktop cache size this is negligible; no correction needed.

  ## What checks out (with concrete evidence)

  - **Passive-read contract**: `useCachedQuery` never calls `useQuery`/`fetchQuery`, only `getQueryState`; test 1 asserts zero observers, unchanged `queryFn`/`staleTime`/`gcTime`, and zero fetcher calls across invalidate/focus/online — matching the "no new network/timer/query" scope.
  - **Fail-closed error policy**: `state?.status === "error" ? EMPTY_EVENTS : ...` (`ThreadFlags.tsx`) hides retained pre-403 data; the alert branch takes precedence over the list; test 4 exercises exactly this. Matches Grok3/fail-closed decision over Opus M1.
  - **Root-only guard**: kind 9 + `!pending` + `depth === 0` + `!parentId` + `!rootId` (`loadedFlags.ts`) is the correct belt-and-suspenders against the verified "absent parent yields depth 1/2 but retains parent/root references" formatter behavior; test 3 covers orphan/pending/reply.
  - **Completion semantics**: `mode !== "complete" && mode !== "all" && complete → excluded` plus per-mode 🚩/🔴 requirements matches "completion hides from active/coordinate/progress; removal restores". Test 2 covers complete → restore-on-removal → root-deletion.
  - **Label normalization scope**: variation-selector stripping (`\uFE0E\uFE0F`) is applied only in `loadedFlags.ts` for classification; the canonical formatter is untouched, as decided.
  - **Filter/search before cap**: `selectLoadedFlags` filters and sorts (createdAt desc, id asc tiebreak) the full set; `rows.slice(0, limit)` applies the cap at render. Test 6 covers the >50 case.
  - **Scope-loss handling**: outer `ThreadFlags` guard nulls the panel on withdrawn membership/non-open; `key={JSON.stringify([relayUrl, pubkey, channel.id])}` plus the verified provider-level QueryClient replacement means no cross-account/relay row retention. Tests 4 and 5 cover cache removal, membership withdrawal, channel swap, and client swap.
  - **onOpen contract**: root rows pass `threadRootId: message.id`, `kind: 9`, `channelId`, `channelName`, `score: 0`, and the live query string — a plain `SearchHit`; no new callback shape.
  - **E2E design**: the `invoke` wrapper counts `get_thread_flag_page` calls and the final poll asserts 0, which directly proves the removed native extension is not invoked; `add_reaction`/`remove_reaction`/`delete_message` go through the real bridge, so reaction/deletion flows exercise the actual cache pipeline.

  ## Verdict

  **Approve, conditional.** No blocking or high-severity defects found in the frozen snapshot; the implementation matches the frozen DECISIONS.md on every checkable point. Two low-severity items (hardcoded members key literal; semantically unverified `undefined` formatter args at positions 5/7/8) are worth a one-line follow-up but are not release-gating per the scope evidence. Final approval is contingent on the still-running desktop suite and browser E2E completing green — they were explicitly excluded from passed status at review time.

