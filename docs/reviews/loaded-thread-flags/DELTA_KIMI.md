• ## Model identity

  - **Requested:** none specified in the review brief (prior artifacts reference KIMI/OPUS/GROK runs, but this review names no model).
  - **Actual:** Kimi Code CLI (Moonshot AI "Kimi" model). No finer-grained model version is exposed to me, so I report only what is visible.

  ## Review findings

  I reviewed all eight supplied artifacts against the stated goal (loaded-only, root flags 🚩/🔴, ☑ completion semantics, searchable, passive cache reads, canonical formatter, no new queries/timers/persistence, no changed query options).

  **No blocking or medium-severity defects found.** The logic checks out in each area I traced:

  - **Passive reads:** `useCachedQuery`/`useCachedQueries` use `getQueryState` + `cache.subscribe` only — no observer mounting, no query creation, no option mutation. The "passive panel" test pins this (options unchanged, `getObserversCount() === 0`, invalidation/focus/online trigger zero fetch calls).
  - **Formatter call shape:** positional args in `ThreadFlags.tsx` match the verified signature — `personaLookup`/`respondToLookup` are `undefined`, `relaySelfPubkey` is `relayIdentity`, `ownerProfiles` omitted. `members` are passed separately and only feed display roles, not edit authorization, matching the brief.
  - **Flag semantics in `loadedFlags.ts`:** root-only gate (`kind === 9`, `!pending`, `depth === 0`, no `parentId`/`rootId`); `☑` in any non-complete/non-all mode excludes the row (completion hides active); `coordinate`/`progress` require their emoji; `complete` requires `☑`; `all` passes everything flagged. Variation-selector stripping (`\uFE0E/\uFE0F`) makes `☑️`/`☑` equivalent on both the reaction side and the display re-expansion in the row renderer. Search/cap order is filter-then-slice, as tested.
  - **Ownership delta:** `useLoadedProfiles` reads canonical `usersBatchEntryKey` entries, shared `profile` and `managed-agents` keys, merges via the same `useMessageProfiles` as ChannelScreen, and error states of every dependency (messages, members, relaySelf, profile, agents, batch entries) are fail-closed (`undefined`/`EMPTY`). The ownership test covers trust via NIP11 self + actor tag, cache-removal fail-closed, spoofed-signer rejection, and untrusted-actor fallback. Note `mergeAgentNamesIntoProfiles` defaults a managed agent's `ownerPubkey` to `currentPubkey` — this is canonical ChannelScreen behavior, not new in this delta, and matches the relay's `is_agent_owner` framing.
  - **Scope control reset:** keyed remount on `[relayUrl, pubkey, channel.id]` resets `mode`/`query`/`limit`; the remount test confirms and also confirms no stale rows across channel/account/relay switches.
  - **Accepted limitations** (incomplete historical coverage, ownership metadata possibly unloaded, Hosted relay immutable) are honored: the panel explicitly states loaded-only scope, does no ownership-only fetching, and the dormant extension/`get_thread_flag_page` is gone from the frontend with an E2E tripwire asserting zero calls.

  ### Low / informational (no correction required)

  1. **Test helper — un-tracked inline clients** — `ThreadFlags.test.mjs`, "channel changes and community/account QueryClient remounts" test creates `new app.QueryClient()` twice without pushing to `clients`, so `afterEach` doesn't `clear()` them. Evidence: `clients.push(client)` only happens in `setup`. Harmless — those clients hold zero queries, so no GC timers exist to leak — but if a future edit seeds them, the cleanup gap becomes real. Smallest correction (optional): expose a helper that pushes every created client to `clients`.
  2. **`getServerSnapshot` asymmetry** — `useCachedQuery` uses `() => undefined` while `useCachedQueries` reuses the computing snapshot. Both are unreachable in this desktop (non-SSR) app; noted only for consistency. No correction needed.
  3. **`pubkey: message.pubkey ?? ""` fallback in the `SearchHit`** — if `TimelineMessage.pubkey` is ever absent, the opened hit carries an empty author. The canonical type appears to guarantee a pubkey, so this is defensive dead code at worst. No correction.

  ### Unverifiable-by-design items (not counted against the verdict)

  - Full Desktop suite and final E2E are still RUNNING per the brief; only typecheck and prior suites are confirmed green. The supplied test sources are internally consistent with the claimed fixes (spread-order correction, `client.clear()` in `afterEach`, live kind-5 deletion path, fixture-derived unique IDs), but I cannot confirm the final run results from source alone.

  ## Verdict

  **PASS — approve the delta.** The implementation satisfies every stated invariant: loaded-only data, passive cache reads with zero new queries/timers/persistence, unchanged query options, canonical formatter and merge path, correct active/complete/search semantics, fail-closed ownership authorization, and scope-reset behavior, with test coverage matching each claim. The three low-severity notes are optional hygiene, not blockers. Final sign-off should still wait on the in-flight Desktop + E2E runs completing green.

