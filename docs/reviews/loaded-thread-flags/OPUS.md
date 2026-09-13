## Scope note

Per the read-only constraint I inspected no files, ran no tools, and delegated nothing. Every finding below is evaluated against the delta description and the evidence lines *you* supplied; where a claim in the brief is asserted without a source citation I say so rather than treating it as established. No plan file written — the deliverable here is a review, not an implementation plan.

**Verdict: conditional GO.** The direction (passive read of the existing query instead of a parallel fetch path) is the right call and is strictly smaller and more reversible than the merged-but-undeployed native path. Two items must be verified in source before implementation starts (H1, H2), because each can silently invalidate a stated acceptance criterion. The rest are corrections that cost sentences, not architecture.

---

## H1 — The account/relay acceptance criterion rests on an unevidenced assumption

**Design location:** "Existing app community remount/reset owns clearing the shared query cache" + acceptance "error/revocation/channel/account/relay switches do not retain rows."

**Evidence/uncertainty:** Every other technical claim in the brief carries a source trace (`useChannelMessagesQuery`, `reconcileFetchedChannelWindow`, `formatTimelineMessages`). This one does not — it is stated as fact. It is also the load-bearing one: `channelMessagesKey(channel.id)` is keyed by channel id alone, so it carries no account or relay identity. If the existing reset re-renders the tree without clearing or removing that key, the panel will render the previous account's message bodies for up to the 1h gcTime, and the acceptance criterion is unmet by construction. Keying the subtree by relay/account/channel resets *the panel's own* local state (search text, expand cap) — it does not evict cached rows, so it does not satisfy this criterion on its own.

**Smallest correction:** Before writing the component, confirm the reset path actually calls `queryClient.clear()` / `removeQueries` or constructs a new QueryClient per relay+account. If it does, cite that call site in the design and the criterion is satisfied for free. If it does not, the panel renders empty unless the cached payload's own identity matches the current session — do not paper over it with a remount key.

---

## H2 — "Observe the existing key with `enabled:false`" has two failure modes, both cheap to eliminate

**Design location:** "passive observation of the existing React Query `channelMessagesKey(channel.id)`, `enabled:false`."

**Evidence/uncertainty:**
1. **Key shape.** The brief simultaneously describes a *windowed* query (`getChannelWindowEvents`, `reconcileFetchedChannelWindow`). Windowed queries frequently carry window/cursor parameters in the key. If the hook's real key is `[...channelMessagesKey(id), window]` and the panel subscribes to the bare `channelMessagesKey(channel.id)`, the observer attaches to a *different, empty* query and the panel is silently blank — passing the "no extra fetch" test and failing the feature.
2. **queryFn ownership.** A second `useQuery` on a shared key is not inert. Observer options are merged into the query, and a later observer supplying `queryFn`/`gcTime` can rewrite the query's options; an observer supplying *no* `queryFn` that happens to create the query (render-order, Suspense, or panel-outlives-screen) leaves a query with no fetcher that will throw if anything later invalidates it. `enabled:false` also does not prevent the observer from extending retention — gcTime is the max across observers, so a panel that outlives `ChannelScreen` keeps the window alive longer than today.

**Smallest correction:** Don't hand-roll a second `useQuery`. Either (a) import the hook's own key factory and read through `useQueryClient()` + a `queryCache` subscription (`useSyncExternalStore` over `getQueryData`), which cannot own or mutate the query by construction, or (b) call the existing `useChannelMessagesQuery(channel)` unchanged and accept its dedupe/staleTime semantics. (a) is the better fit for "no new network request, ever." Add a test that mounts the panel *without* `ChannelScreen` and asserts the cache contains no fetching query — that single test pins both failure modes.

---

## M1 — "Show error state instead of cached rows" creates a second status authority and can contradict the visible timeline

**Design location:** "Display error/pending state instead of cached rows when underlying query error."

**Evidence/uncertainty:** In React Query, a failed *background* refetch on a query that already holds data retains the data; whether `status` flips to `'error'` while `data` is present depends on version, and I cannot verify the version in use here. Independent of that detail, the behavioral consequence is the problem: `ChannelScreen` will still be rendering messages from the retained cache while the sidebar blanks itself and says "error." The user sees flagged messages in the timeline and an empty flag panel beside them. The brief's own closing instruction — "favor existing authority rather than new parallel status logic" — argues against this criterion.

**Smallest correction:** Derive rows from data presence, not from `status`. If data exists, render the rows and put a non-destructive inline banner above them mirroring however `ChannelScreen` already surfaces a stale/failed refetch. Reserve the empty/error-only state for "no data in cache at all." Rewrite the acceptance line accordingly.

---

## M2 — The 50-row cap must apply after filter and search, not before

**Design location:** "Limit visible list to 50 with local Show more" + "Filter modes remain."

**Evidence/uncertainty:** Ordering is unspecified in the delta. If the cap is applied to the root set before filtering, a filter or a search term whose matches sit at positions 51+ renders an empty panel while matching flags are plainly visible in the timeline — the same contradiction as M1, reached by a different route.

**Smallest correction:** One sentence in the design: cap applies to the filtered + searched + sorted result; "Show more" raises the cap only. State the sort key explicitly too (root timestamp descending is the obvious choice, but it is currently unwritten, and implementer/reviewer will diverge on it).

---

## M3 — The flag precedence lattice is named but not defined

**Design location:** "completion wins; two flags one row" + acceptance "roots only, completion + removal + deletion."

**Evidence/uncertainty:** "Completion wins" resolves only one pair. Undefined: what happens when a completion reaction is itself removed or deleted and a second flag remains (does the row revert to that flag or disappear?); how a deleted root interacts with a live flag; and whether "two flags one row" means both are rendered or the loser is hidden. These are exactly the cases the acceptance list tests, so they will be adjudicated by whoever writes the code first.

**Smallest correction:** A four-line precedence table in the design (root deletion ⟶ hides row; reaction removal/deletion ⟶ flag drops out, row survives if another flag remains; completion ⟶ rendered first; remaining flags ⟶ rendered after, stable order by emoji codepoint), with a test per row.

---

## M4 — Two places where the panel risks becoming a second source of truth

**Design location:** (a) "normalize FE0E/FE0F flags"; (b) "Only selected non-archived stream channel with accessible membership OR open visibility mounts."

**Evidence/uncertainty:** (a) Your own evidence says `formatTimelineMessages` "aggregates active reactions" — aggregation across clients almost certainly already requires content normalization. A second normalizer in the panel that disagrees with the formatter's (e.g., strips variation selectors but not skin-tone modifiers or ZWJ sequences, or doesn't NFC-normalize) produces a panel that counts flags differently from the timeline. (b) Membership/visibility is a permission predicate; if the panel recomputes it rather than calling the predicate `ChannelScreen` or the channel list already uses, the two will drift on the next permissions change.

**Smallest correction:** (a) Reuse the formatter's existing normalization for reaction identity; only add panel-local normalization if you confirm the formatter has none, and if so add it *there*, not in the panel. (b) Name the existing predicate in the design and call it; if no shared predicate exists, that is worth one sentence acknowledging the duplication and where it will drift.

---

## M5 — Duplicate formatter pass on every live event

**Design location:** "Use canonical `formatTimelineMessages(events, channel, currentPubkey, null)`."

**Evidence/uncertainty:** Reusing the canonical formatter is the right call for semantics. But `ChannelScreen` already runs it over the same window; the panel makes it twice per cache update in an active, live-subscribed channel. Two secondary uncertainties: the `null` fourth argument is unexplained — if that parameter is the resolved-messages/huddle map you mention, passing `null` is correct for this feature but should be stated as a deliberate choice with the reason, not left as a bare literal; and whether the formatter is cheap enough at window size is unmeasured.

**Smallest correction:** `useMemo` on the `data` reference (structural sharing keeps the reference stable when nothing changed), and if `ChannelScreen` already exposes its formatted array through props/context, consume that instead of recomputing. Add a one-line comment naming why the fourth argument is `null`.

---

## L1 — "Kept for compatibility" is not an accurate justification

**Design location:** "Original native command/server code remain unused by this panel for compatibility; document now dormant, not required."

**Evidence/uncertainty:** The merged native extension at `8d644c70` was never deployed, so no client depends on `get_thread_flag_page`. "Compatibility" describes a constraint that does not exist and will mislead the next reader into thinking removal is risky.

**Smallest correction:** Say what is true — "retained as the starting point for a future relay-side option; currently unreferenced." Put that note at the command/handler definition site, not only in the design doc, and if there is a dead-export or coverage gate, add the allowlist entry with the reason and a link, so the next sweep neither deletes it silently nor flags it forever.

---

## L2 — Optimistic reactions are unaddressed

**Design location:** "Select committed kind9 depth0 roots" (`pending` handled for roots only).

**Smallest correction:** State whether a pending/unpublished *reaction* on a committed root produces a flag row. Either answer is defensible; leaving it unstated means a flag can appear and then vanish on publish failure with no design intent behind it. (Separately: `depth === 0` presumably already implies no parent/root reference — if the triple condition is defensive, say so; if it's because the formatter's invariant isn't trusted, that's worth knowing.)

---

## L3 — "No count claims" is over-strict and will produce awkward UI

**Design location:** "loaded-only wording explicit, no all-history/count claims."

**Smallest correction:** Forbid *totals implying completeness*; allow counts of the loaded range when labeled ("12 in loaded messages"), which "Show more" effectively needs anyway. Also pin the empty-state string now — "No flags in the loaded messages," not "No flags" — since that string is where the superseded whole-history promise actually shows up for the user.

---

## L4 — Desktop-only boundary is stated as a scope, not as a build constraint

**Smallest correction:** One line on how non-desktop targets exclude the panel (platform-split file or a build-time guard), so shared components don't get pulled into the native bundle. Your acceptance already includes a native bundle build, which will catch a violation — make the intent explicit so the fix is obvious when it does.

---

## Additions to the acceptance/test list

- Panel mounted **without** `ChannelScreen`: cache contains no fetching query, no `queryFn`-less query left behind (pins H2).
- Panel outliving `ChannelScreen`: assert no extended retention / no stale rows (pins the gcTime side of H2).
- Zero-fetch assertion via a spy on the query function plus a `queryCache` subscription, not merely "no `get_thread_flag_page` call" — the latter passes trivially even if a different fetch is introduced.
- Reaction **removal** and **root deletion** as separate E2E cases through the existing mocked live events (acceptance names them together; they exercise different formatter overlays).
- Filter/search with >50 matches, to pin M2.

The two things I could not assess and that no amount of reasoning substitutes for: the real shape of `channelMessagesKey` under windowing (H2.1), and whether the existing reset clears the cache (H1). I'd want both confirmed in source before this goes to implementation; everything else on this list is editable in the design doc as it stands.

---

**要約（翔さん向け）:** 方向性は良いです。相手のサーバを触らず、すでに画面が持っているデータを横から読むだけ、という設計なので小さく安全に戻せます。ただし実装に入る前に確認すべきことが2つあります。①アカウントやリレーを切り替えたときに古いデータが本当に消えるのか（消えないと前のアカウントの発言が残って見えてしまいます）②横から読むときの「読み先の住所」が本当に合っているか（ずれていると何も表示されないのに、テストは通ってしまいます）。残りは設計書に数行足すだけで直る指摘です。
