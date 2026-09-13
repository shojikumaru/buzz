# Thread flags — loaded Desktop messages

Task: https://github.com/shojikumaru/buzz-thread-flags/issues/4
Maintainer: SHO / shojikumaru. Implementer: alpha-codex (Astra).
GitHub is the sole source of truth. Hosted relay remains unchanged.

## Behavior and coverage

In a selected, accessible, non-archived stream channel, **Flagged threads** reads
messages already loaded by the existing conversation. It makes no request,
creates no query, polls no timer and stores no duplicate status.

- 🚩 coordinating and 🔴 in progress appear in active views; both yield one row.
- ☑️ completion wins over active flags. Completed/All loaded flags can find it.
- Removing completion restores any remaining active flags; deleting the root
  removes the row. Reaction behavior follows the canonical loaded timeline,
  including optimistic updates and their rollback. Pending roots are excluded.
- Only root messages count, including when a reply's parent is not loaded.
- Search matches the full root body after authorized edits, using the loaded ownership
  metadata and edit events. Titles are safe text previews up to 240 characters.
- Filter and search precede the local 50-row display cap. **Show more loaded flags**
  raises that cap only; it never fetches older messages. Sort: timestamp descending,
  then event ID ascending. This is not an exhaustive history search.

Loaded coverage can expand, shrink or be replaced as the conversation loads or
refreshes. Old unloaded roots, reactions, edits, deletions or ownership metadata may be absent.
An owner edit may appear only once its ownership metadata has loaded. The
panel does not promise all historical flags or instant state beyond what the
existing conversation has received. Flags are labels, not agent execution status.
Completion never archives anything.

Query errors hide retained rows; the existing conversation owns retry. A plain
background fetch preserves data. Cache removal and channel changes remove old
rows. App.tsx CommunityQueryProvider creates a separate QueryClient on community,
account or signer epoch changes; no new global cache is introduced here.

## Implementation boundary

`ThreadFlags.tsx` passively reads the existing message, member and relay-self
query states and already-loaded ownership profiles with `useCachedQuery.ts` (`useSyncExternalStore`). It neither adds
an observer with competing query options nor extends query retention.
`formatTimelineMessages` remains the sole event/reaction/edit authority.
`loadedFlags.ts` classifies the three labels and selects filtered/sorted roots.
The selected channel's existing sidebar thread-navigation callback opens rows.

The previous server extension and native command remain dormant as a future
self-managed-relay option; this Desktop panel has no `get_thread_flag_page`
call. See [historical protocol](thread-flags-relay-option.md). The Hosted service
needs no deployment for the loaded-only version. The user explicitly accepted
this reduced coverage after confirming the service is managed by Buzz.

The custom Desktop still needs build/install verification; merging a fork does
not publish an official signed/notarized update. See the PR verification record.
