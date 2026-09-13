**Model (as exposed to me):** Opus 5 — `claude-opus-5`. Effort/thinking level is not exposed to me; I will not claim one.

**Method:** I reviewed only the five supplied artifacts. I ran no tools and opened no other files. Where a claim in the goal statement depends on code not in the snapshot (`AppSidebar`, `formatTimelineMessages`, `messageQueryKeys`, `relaySelfQueryKey`, `TimelineMessage`, the removed frontend API file, native/server code), I say so explicitly rather than assuming it.

---

## Verdict

**Conditional GO — merge blocked on F1; F2–F4 should land in the same PR.** The design is sound and the passive-reader mechanism is correctly built: no observer, no fetcher, no option mutation, no timer, no persistence. Test 1 is a genuinely strong proof of that and is the best artifact in the set. The blocking issue is not the reader — it is one hand-rolled cache key and a set of positional formatter arguments that no supplied test can distinguish from wrong.

I cannot verify these goal claims from the snapshot, and they must be confirmed by whoever holds the full tree: AppSidebar's props and null-channel handling, removal of the old frontend API file, and that native/server code is unreferenced. None of the supplied files contain evidence either way.

---

## Findings

### F1 — BLOCKING (High): `membersKey` is a hand-rolled literal, and no supplied test can detect it being wrong

**Location:** `desktop/src/features/thread-flags/ThreadFlags.tsx`, `membersKey` useMemo.

```ts
const membersKey = useMemo(() => ["channels", channel.id, "members"] as const, [channel.id]);
```

**Evidence.** Two of the three keys in this file come from the owning feature (`channelMessagesKey`, `relaySelfQueryKey`). This third one is transcribed by hand from a feature this file otherwise does not import. If it does not hash-match the producer's key, `useCachedQuery` returns `undefined` forever and `members?.data` is permanently `undefined`.

The failure is silent in every supplied test: `ThreadFlags.test.mjs` never calls `setQueryData` for a members key in any test, so `members?.data` is already `undefined` in 100% of unit runs. A correct key and a typo'd key produce byte-identical unit results. The E2E never exercises an edit or a moderated message, so it does not cover it either. tsc cannot help — `as const` on a literal array satisfies `QueryKey` regardless of correctness.

Consequence per the frozen DECISIONS ("Pass already-cached members and relay-self to match trusted author/edit resolution"): the panel would resolve edit authorization differently from `ChannelScreen`, so the sidebar can display a different body for the same thread than the conversation shows. That is exactly the divergence the "canonical formatter" decision exists to prevent.

**Smallest correction:** import the canonical members key from the owning feature, the same way `channelMessagesKey` is imported. If that feature exports no key factory, export one and use it on both sides — do not keep two literals. If neither is acceptable within scope, then pass `undefined` deliberately and record in DECISIONS that member-derived authorization is not applied; a known gap is better than an unverifiable one.

---

### F2 — High: the three `undefined` positional formatter arguments are unpinned, and the one edit test cannot pin them

**Location:** `ThreadFlags.tsx`, the `formatTimelineMessages` call (9 positional args, 3 of them `undefined`).

**Evidence.** Correctness here rests entirely on `members` landing in slot 6 and `relaySelf` in slot 9. tsc does not protect this: if several trailing parameters are `string | null | undefined`-compatible, a mis-slotted `relaySelf` typechecks and silently changes author/edit resolution.

The only edit test uses `event(40003, "<img> changed needle", [["e", r.id]])`, and `event()` hardcodes `pubkey: scope.pubkey` — the root's own author. A self-authored edit is authorized under any plausible policy, with or without `members` and `relaySelf`. So the test that appears to cover "authorized edits" actually covers only the trivially-authorized case. Combined with F1, neither argument's position is observable from any supplied test.

**Smallest correction:** add two unit cases — (a) an edit authored by a third pubkey that is *not* a member/relay-self, asserting the original body still renders; (b) the same edit authored by the seeded relay-self (or a privileged member), asserting the new body renders. Case (b) fails loudly if `relaySelf` is in the wrong slot. Optionally pass the arguments by name if the formatter has an options object.

---

### F3 — Medium: error-hiding policy is applied to messages only, contradicting the frozen decision

**Location:** `ThreadFlags.tsx`:

```ts
const events = state?.status === "error" ? EMPTY_EVENTS : (state?.data ?? EMPTY_EVENTS);
...
members?.data,
relaySelf?.data,
```

**Evidence.** DECISIONS states: *"retained data on ANY query error is hidden."* The implementation applies that to `state` and not to `members` or `relaySelf`. A members query that 403s after access revocation keeps its retained page, and that retained page still feeds edit/author resolution in this panel. The blast radius is smaller than for messages (it changes which body text is shown, not whether a row exists), which is why this is Medium rather than blocking — but the code and the frozen record currently disagree, and the record is the thing future readers will trust.

**Smallest correction:** `members?.status === "error" ? undefined : members?.data` and the same for `relaySelf`. Or amend DECISIONS to scope the policy to the messages query explicitly. Pick one; do not ship the disagreement.

---

### F4 — Medium: `useCachedQuery<RelayEvent[]>` is an unchecked assertion with no runtime guard

**Location:** `useCachedQuery.ts` (generic is caller-asserted) and `ThreadFlags.tsx` (`events` handed straight to the formatter).

**Evidence.** Nothing binds `T` to the producer's actual cached shape. The unit tests fabricate the shape with `client.setQueryData(key, [event, ...])`, so they assert the assumption rather than test it. If the owner of `channel-messages` ever moves to `useInfiniteQuery` or a wrapper object, the cache holds `{pages, pageParams}`, tsc still passes at this call site, and the formatter receives a non-array at runtime. With no error boundary visible in the snapshot, a throw here takes down the sidebar tree.

This is not a claim that the shape is wrong today — the E2E, once green, exercises the real producer and would catch a present-day mismatch. It is a claim that the mismatch is undetectable at compile time and unguarded at runtime, on a value this component does not own.

**Smallest correction:** one line — `const raw = state?.status === "error" ? undefined : state?.data; const events = Array.isArray(raw) ? raw : EMPTY_EVENTS;`. If the app already has a shared ErrorBoundary, wrapping the panel in AppSidebar is a reasonable second layer; do not add a bespoke try/catch that swallows errors silently.

---

### F5 — Medium: the `key={JSON.stringify([...])}` remount is untested; the test that claims to cover it is tautological

**Location:** `ThreadFlags.tsx` `key` prop; `ThreadFlags.test.mjs`, test *"channel changes and community/account QueryClient remounts never keep old rows"*.

**Evidence.** Delete the `key` prop and that test still passes, for all three cases:

- Channel change: `channel.id` changes → `messagesKey` recomputes → reads `channel-b`, which was never seeded → no rows, with or without a remount.
- Account/relay change: a brand-new empty `QueryClient` is supplied, and `useCachedQuery`'s snapshot callback already depends on `client`, so it re-reads from the new empty cache without any remount → no rows either way.

So the test proves cache-key and provider isolation — which is real and worth having — but not the `key` line. The `key` line's only observable effect is resetting `mode`/`query`/`limit`, and nothing asserts that. DECISIONS' phrasing ("Tests swap the scoped provider and channel keys") is accurate; it is the test *name* that overclaims.

**Smallest correction:** seed `channel-b` (and the new client at the same key) with a *different* flagged root, then assert the panel shows the new rows and that a previously-set filter/search resets to `active`/empty. That version fails if the `key` is removed. Rename the test to match what it proves.

---

### F6 — Low: access-suppression branches are only 1/4 covered

**Location:** `ThreadFlags.tsx` guard; tests.

**Evidence.** Only `isMember: false` on a private channel is asserted. `archivedAt` set, `channelType !== "stream"`, and the positive `visibility: "open"` + `isMember: false` path (panel *should* render) are all untested. The "open" branch is the one that decides whether a non-member sees content, so it is worth pinning even though it grants no access by itself.

**Smallest correction:** three assertions in the existing membership test using the same `{...channel, ...}` spread pattern already in place.

---

### F7 — Low: duplicate formatter work over the full loaded set

`formatTimelineMessages` now runs twice per message update — once in `ChannelScreen`, once here — over the entire loaded set. DECISIONS accepts this ("no new store"), and `useMemo` correctly prevents recomputation for control-only changes (`mode`, `query`, `limit` are not deps). No change requested; flagging so it is a known cost rather than a surprise if loaded sets get large. One thing to confirm at integration: if `AppSidebar` rebuilds the `channel` object identity on every render, the `channel` dep defeats the memo entirely.

---

### F8 — Low (cosmetic / nits)

- `Array.from(body).slice(0, 240)` is code-point safe but not grapheme-safe; it can split ZWJ emoji sequences and combining marks mid-cluster. `Intl.Segmenter` is the correction if it matters, otherwise accept.
- Search matches anywhere in `body` but the button shows only the first 240 chars, so a hit can be invisible in its own row.
- A query in `pending` + `fetching` renders "No messages loaded yet." rather than a loading state. Correct per the loaded-only framing, slightly misleading during first load.
- `useCachedQuery` depends on callers memoizing the key; an inline array would churn `getSnapshot` identity. Hashing the key internally would make it misuse-proof. Not a defect in current usage — all three call sites are stable.
- `cache.subscribe` fires for every query in the cache; re-renders are correctly suppressed by `Object.is` on the stable `state` reference, so this is overhead only.
- `DECISIONS.md` has lost spaces in numerous places ("Base8d644c70", "at407,630", "a403", "kind9/depth0", "local50"). It is the frozen record; it should be legible.

---

## What the snapshot gets right (so it does not get "fixed" later)

- **Test 1 is real proof, not theater.** `getAll().length === 0` before any data, `setQueryDefaults` + post-hoc `options.queryFn/staleTime/gcTime` equality, `getObserversCount() === 0` before *and after* unmount, and `calls === 0` across `invalidateQueries` + `focus` + `online` — that is a correct and complete characterization of "passive reader."
- **The >50 test genuinely proves filter-before-cap.** `root("Old text", { created_at: 0 })` sorts to index 55 under the descending sort, past the 50-row cap; it can only surface via search if filtering precedes slicing. That is a deliberately constructed test, and it works.
- **Reaction/deletion semantics are exercised through the real formatter**, not a stub — completion hiding, kind-5 removal restoring the remaining flags, and root deletion hiding the row.
- The `depth !== 0 || parentId || rootId || pending || kind !== 9` guard, the filter-mode truth table, and the descending-time / ascending-id stable sort all match DECISIONS exactly; I found no logic defect in `selectLoadedFlags`.
- Variation-selector stripping is correctly confined to this file's three labels and does not touch canonical reaction identity.
- XSS is handled by React text nodes and asserted (`querySelector("img") === null`); `<bdi>` isolation and the a11y roles (`region`, `alert`, `status`, labeled `select`/`input`) are right.

---

## Process observation (not a code finding)

The frozen record lists three seats, one of which is the configured fallback after GLM's transport failure. This change introduces a new surface that renders private-channel content and gates it on a membership/visibility predicate — an access-visibility boundary. Under your own rubric that argues for the 5-seat tier rather than 3. That is the owner's call, not mine; I am flagging it because the DECISIONS file will be the durable record of what the seat count was chosen against.

Also, per your instruction: the Desktop suite and browser E2E are **in progress and are not counted as passing** in this verdict. `ThreadFlags.test.mjs` is a `.mjs` file importing `./ThreadFlags.tsx` under a `@/` alias — confirm it is actually picked up by the suite runner and not silently unmatched, before treating a green run as coverage.

---

## 日本語まとめ（翔さん向け）

**結論: 条件つき GO。1件直せば merge して良い状態です。**

作りの中心である「既存キャッシュを読むだけ（新しい通信・タイマー・保存を一切増やさない）」という仕組みは正しく実装されていて、その証明テストも本物でした。ここは評価できます。

直してほしいのは1つだけです。メンバー一覧をキャッシュから取り出すための「住所（キー）」が、他の2つと違って手書きでコピーされています。もしこの住所が1文字でも違っていると、パネルは何も文句を言わずに動き続け、会話画面とサイドバーで同じ書き込みの表示が食い違う可能性があります。しかも今のテストでは、住所が正しい場合と間違っている場合の結果が完全に同じになるため、誰も気づけません。→ 他の2つと同じく、本家からインポートする形に直す。

そのほか、同じPRで一緒に直すと良い点が3つ（引数の位置を確認できるテスト追加、エラー時の扱いを決定文書と揃える、データ形式の1行ガード）あります。テストはまだ実行中なので、「通った」とはこの時点では言えません。
