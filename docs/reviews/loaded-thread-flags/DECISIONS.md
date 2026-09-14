# Loaded-only design delta — frozen for implementation
Lane: UI. Base 8d644c70. User accepts loaded-only Desktop operation; Hosted relay untouched.
Reviews: requested Opus 5 high, Kimi K3 (effort not exposed), Grok 4.5 high.
GLM 5.2 failed transport twice; it is not counted. Grok is the configured one-seat fallback.
Reviewers saw only the neutral brief and did not write implementation.

- Accept Opus H2 / Grok 1: useSyncExternalStore over QueryCache/getQueryState,
  not a second useQuery. No query creation/options mutation, fetcher or timer.
- Opus H1 / Kimi 2 verified in App.tsx:218: CommunityQueryProvider constructs a NEW
  QueryClient via useState; keyed by community+account+signerEpoch at lines 407 and 630.
  The channel-messages key is exactly the imported key factory, no cursor suffix.
  Tests swap the scoped provider and channel keys; cache removal hides rows.
- Kimi 1 verified in formatTimelineMessages.ts431: missing parent yields depth 1/2,
  not 0; original references remain. Retain kind 9 / depth 0/no parent/root/pending guard.
- Accept Grok 2: canonical formatter for rows, current body and reactions. Pass
  already-cached members and relay-self to match trusted author/edit resolution.
  No profile fetch needed for flag presence. null fourth argument is avatar only.
- Error policy: retained data on ANY query error is hidden, as explicitly scoped
  in the brief and supported by Grok 3. Reject Opus M1's keep-stale recommendation:
  a 403 refetch may retain prior data, and this panel must not expose it. A plain
  background fetch with no error does not hide current loaded rows.
- Filter/search BEFORE local 50 cap, sort timestamp descending / ID ascending.
  Root deletion hides; removal drops that reaction; completion hides from active,
  coordinate, progress; removing completion restores remaining active flags;
  all/complete retain completion. Active dual flags display once in fixed order.
- Variation-selector stripping classifies the three agreed labels, not general
  reaction identity; do NOT change canonical formatter normalization globally.
- useMemo avoids duplicate formatter work for control-only changes. Existing
  shared formatter output is not exposed across ChannelScreen/sidebar; no new store.
- Exclude pending roots; reactions follow existing optimistic timeline state and
  rollback (labels are not confirmation or process status). No extra persistence.
- Membership/open check only suppresses private withdrawn channels; it grants no
  access, invokes no API. No shared predicate found in inspected mount paths.
- Empty wording: No matching flags in loaded messages. More loaded flags only
  increases local visible cap. No exhaustive-history or total flags claim.
- Old native/server extension stays as a future option, NOT a compatibility
  dependency. Desktop entry no longer imports/invokes it. No Rust change needed.
- Mobile Flutter unaffected; this is the existing desktop React sidebar surface.

Acceptance: real QueryClient passive/no-option-write/no-fetch tests, live reaction
removal/completion/root deletion, orphan exclusion, cache error/removal/scope loss,
current edit/search, >50 filter ordering, full desktop suite/check/tsc, existing
bridge sidebar E2E and release app bundle. No rollout claim before installed test.

## Implementation review dispositions

- Opus F1 / Kimi 1 / Grok 1 accepted: extract channelMembersKey beside its
  owning query, used by both owner and reader. Key values and fetch behavior are
  unchanged. The formatter source confirms members are display roles, not edit
  authority; the review's authority inference was incorrect, but key drift is worth avoiding.
- Opus F2 / Kimi 2 accepted: profile ownership, rather than member role, authorizes
  an owner edit. Reuse canonical per-user delta cache entries plus current profile
  and managed-agent metadata through useMessageProfiles. No ownership-only fetch.
  Missing metadata may defer an owner edit; loaded coverage remains explicit.
  Test uses a genuinely signed relay event because trusted actor resolution verifies
  its signature; fabricated signatures correctly fail closed.
- Opus F3 / Grok 3 accepted: discard error-state data for every read dependency.
- Opus F4 accepted: unexpected message cache shape renders an unavailable alert.
- Opus F5/F6 accepted: test control reset on keyed channel remount, open non-member,
  archived and forum guards. Separate provider-remount tests cover cache isolation.
- Opus F7/F8 / Kimi 4 / Grok 2: accept bounded overhead of a passive cache-wide
  notification and memoized formatter. No new subscriptions to the relay, timers or
  query observers. Previews remain code-point safe (not grapheme segmented); search
  covers full text although a match after the preview may not be visible.
- Kimi delta hygiene note: extra empty QueryClients contain no entries/timers;
  fixture-created populated clients are all cleared after each test.
- Opus process note suggesting five reviewers is not the applicable routing policy:
  the canonical Codex routing requires three independent families at H/L, with one
  configured Grok fallback for the unavailable GLM seat. Three were requested.

Test corrections are not product changes: avoid overwriting bound Testing Library
queries with unbound module exports; normalize only whitespace for JSDOM's bidi
accessible-name difference (Chromium E2E retains exact names); use signed trusted
relay fixtures; do not use a fixed root ID already owned by an E2E join fixture;
exercise live deletion instead of a raw mock command whose UI hook normally patches
cache. Full-suite results, rather than scoped passes, govern acceptance.

## Final delta review resolution

Opus, Kimi and Grok returned code GO conditional on verification (requested
claude-opus-5/high, kimi-code/k3, grok-4.5/high; actual Opus 5 and Grok 4.5
reported; Kimi CLI exposes family only). No reviewer implemented changes.

Opus delta F2/F3 evidence from the actual owner source:

- profile/hooks.ts normalizes and sorts `pubkeys.map((pubkey) => pubkey.toLowerCase())`
  before fetching. Its queryFn calls `queryClient.setQueryData<UsersBatchEntry>(
  usersBatchEntryKey(pubkey), { summary, fetchedAt: now })` for each fetched pubkey.
  This is the same exported factory used by the passive reader, not a test-only key.
- channels/hooks.ts useChannelMembersQuery now uses exactly
  `queryKey: channelMembersKey(channelId ?? "none")`. The extracted factory returns
  the unchanged tuple `["channels", channelId, "members"]`.
- Opus F4: threading.ts getThreadReference returns null parentId AND null rootId
  whenever there is no explicitly marked `reply` tag. Quote/mention/root-only tags
  therefore do not become replies. The defensive rootId predicate is retained.
- Opus F5/F7 optional extra assertions deferred: the same search predicate runs
  before every mode branch, shared guards and canonical formatter have existing
  coverage, and actual browser completion/removal passes. No new production change
  justified by the remaining low test-coverage notes. Existing passive tests pin
  zero queries at empty mount and zero observers for populated ownership reads.
- Opus F8 accepted as inherited behavior: useMessageProfiles preserves the native
  timeline's managed-agent ownership fallback; do not alter only this sidebar.
- Opus F10: empty relayAgents intentionally omits name/isAgent-only presentation,
  not ownership. This panel renders body and flags, not agent name/owner badges.
- Grok low comment corrected; unused E2E channelId is harmless fixture metadata.
- Opus F1 remains a verification gate until the recorded full CI finishes; review
  verdicts are not substituted for executed tests. The extension-call tripwire is
  regression evidence alongside actual reactive interaction, not standalone proof.
