• # Independent design-delta review (read-only, proposal-text only)

  Scope note: I reviewed only the delta as written in your brief. I did not inspect the repository, so every claim below is either (a) derivable from the design text and the evidence you supplied, or (b) explicitly marked as uncertainty the implementer must verify. Nothing below asserts anything about uninspected code.

  ## Findings, severity-ordered

  **1. Medium — Orphan promotion can misclassify flag replies as roots**
  - Location: root selection rule — "committed kind9 depth0 roots without parent/root references," using `formatTimelineMessages` fields.
  - Evidence/uncertainty: Window-based timeline formatters commonly promote replies whose parent fell outside the loaded window to depth 0 (or drop them). If `formatTimelineMessages` nulls `parentId`/`rootId` for orphans, then after a cache trim, live refetch window shift, or late loading, a flagged *reply* can silently become a "root" and appear in the sidebar — a false row, violating "roots only." Your stated evidence only confirms the fields exist, not how orphans are handled. This is the single correctness risk I cannot settle from the brief.
  - Smallest correction: verify the formatter's orphan behavior before relying on `depth===0`. If it promotes orphans, add a guard on the raw event (no `e`/`a` root tag on the source event) rather than the formatted fields, or exclude messages whose depth was assigned by promotion. One-line predicate change; no new plumbing.

  **2. Medium — Shared cache entry may cross relay/account boundaries despite remount keying**
  - Location: "key subtree by relay/account/channel" + "existing app community remount/reset owns clearing the shared query cache."
  - Evidence/uncertainty: Keying the React subtree forces the *component* to remount, but the observer reads the *shared* cache entry for `channelMessagesKey(channel.id)`. If that key is not itself composed of relay/account (unknown from the brief — you only state it takes `channel.id`), and channel ids are community-scoped rather than globally unique, then on account/relay switch the fresh mount can read a stale entry belonging to the previous identity until the reset clears it. Whether the existing reset actually fires on every one of {error, revocation, channel, account, relay} transitions is asserted but not evidenced per-case.
  - Smallest correction: confirm `channelMessagesKey` composition; if it lacks relay/account, either confirm the reset provably precedes any sidebar read on each switch path (test each of the five transitions), or derive rows from `query.data` only when the entry's fetch metadata matches the current identity. Do not add a new store — this stays a verification + at most a guard clause.

  **3. Low — Error-over-data policy discards good rows on transient background errors**
  - Location: "Display error/pending state instead of cached rows when underlying query error."
  - Evidence: React Query keeps `data` alongside `error` when a background refetch fails (the source query has 5min staleTime and live reconciliation, so refetch failure with retained data is a normal state, not an edge case). The design as worded blanks a populated sidebar during a transient relay hiccup.
  - Smallest correction: render error state only when `data` is absent; when both exist, keep rows and (optionally) show the existing inline error pattern. This also better matches "existing UI patterns." If the all-or-nothing behavior was a deliberate simplicity choice, accept as-is — flagging for decision, not demanding change.

  **4. Low — `enabled: false` semantics are version-dependent in detail**
  - Location: "passive observation ... enabled:false so no new network request."
  - Evidence/uncertainty: In React Query v4 and v5, `enabled: false` never fetches, still subscribes to cache updates, and still re-renders on cache writes — the design is sound on both. The residual uncertainty is only which major version the app pins and whether any default (`placeholderData`, `notifyOnChangeProps`, a global `queryFn`) interacts. Note also the observer's own `status` will read `pending` when the cache is empty even while the *sibling* query is fetching — which is fine given your pending-state design, but the sidebar's pending means "nothing in cache," not "loading."
  - Smallest correction: none to the design; make the version check and the "pending = not-yet-loaded, not loading" wording explicit in the implementation note and in the mocked-cache test setup.

  **5. Low — Unmemoized full-window recompute per render**
  - Location: "Use canonical formatTimelineMessages(...)" on every observer render, then flag scan.
  - Evidence: React Query structural sharing keeps `query.data` referentially stable between unrelated renders, so `useMemo` on the data reference makes both the format pass and the flag scan effectively free on unrelated re-renders; without it, every sidebar render (filter mode change, search keystroke) re-runs the whole window transform. Window size bounds the cost, so this is Low, not Medium.
  - Smallest correction: `useMemo(() => selectFlags(formatTimelineMessages(...)), [data, currentPubkey])`. No behavioral change.

  **6. Low — Revocation-while-mounted path needs an explicit owner**
  - Location: "Only selected nonarchived stream channel with accessible membership OR open visibility mounts."
  - Evidence/uncertainty: The mount guard covers mount time. If membership is revoked while the panel is mounted, unmount depends on the guard's inputs being reactive to the same membership/visibility authority ChannelScreen uses. The brief states the guard but not its reactivity source.
  - Smallest correction: derive the guard from the exact selector/state ChannelScreen uses for its own gating (your "favor existing authority" principle), and add one E2E case: revoke mid-session → rows gone. No new logic, just sourcing.

  ## Sound as designed (no change recommended)

  - `enabled: false` + shared key satisfies "no `get_thread_flag_page`, no extra fetch, no timer" — the acceptance criterion is structurally guaranteed, not just test-asserted, provided finding 4's version check passes.
  - Reusing `formatTimelineMessages` for reaction removal, deletion, and authorized-edit overlays is the correct authority; it avoids the parallel-status-logic trap the brief warns about. Displaying the edited root body via the same path is consistent.
  - Restricting scope to loaded bodies, explicit loaded-only wording, no count/all-history claims — matches the user's stated acceptance of the desktop-only, loaded-only tradeoff.
  - 50-row cap with local "Show more," filter modes retained, completion-wins, FE0E/FE0F normalization, two-flags-one-row: all small, reversible, dependency-free.
  - Not broadening the huddle `resolvedMessages` path, leaving the merged-but-undeployed native code dormant and documented: correct containment; just ensure the doc note lives next to the dormant entry point, not only in this panel.
  - Keying the subtree and delegating cache clearing to the existing community remount/reset: correct *architecture*; only its per-transition coverage needs the test evidence in finding 2.

  ## Test/E2E checklist the acceptance list should explicitly cover

  1. Real `QueryClient`, cache written via the same reconciliation path the live subscription uses (not direct component props) — you already specify this; keep it.
  2. `enabled: false` observer: assert zero fetches across mount, window focus, and reconnect (the three default refetch triggers).
  3. All five non-retention transitions (error, revocation, channel, account, relay) — finding 2.
  4. Orphan case: flagged reply whose parent leaves the loaded window must not appear — finding 1.
  5. Background-refetch-error-with-data case — finding 3, whichever policy is chosen.
  6. Native bundle build + full desktop suite + `tsc`/check, as stated.

  ## Verdict

  Approve with two pre-implementation verifications: the orphan-promotion behavior of `formatTimelineMessages` (finding 1) and the key-composition/reset-coverage question (finding 2). Both are confirm-or-guard-clause scale; neither changes the architecture. The delta fits the stated constraints: no hosted-relay change, no credentials touch, no new network, no new persistent state, small and reversible.
