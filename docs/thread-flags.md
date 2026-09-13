# Thread flags (native v1)

Issue: https://github.com/shojikumaru/buzz-thread-flags/issues/3
Design inspection base: block/buzz `813bbd14121edacc6cb4733301a3af12131aa10e`.
Integration base after forward-port: `6c35e82bd50f4ad6587554eeb429e7378d474ba7`.
Maintainer: SHO / shojikumaru. Implementation: alpha-codex (Astra).
GitHub is the owner's sole source of truth. This intentionally follows the
owner's repository workflow over VISION.md's integrated-forge preference;
the product's Nostr events and channel authority remain unchanged.

## User behavior

The selected, non-archived stream channel has a **Flagged threads** panel.
React to the **first message**, not a reply:

| Root reaction | View |
| --- | --- |
| 🚩 | Coordinating and Active |
| 🔴 | In progress and Active |
| ☑️ | Completed and All only; overrides both active flags |

Both active flags render once with two badges. Any current reactor counts;
a reactor later leaving does not erase their stored reactions. Removing a
reaction recomputes the next result. Completion never archives anything.
These are shared labels, not agent runtime status.

Search is a literal case-insensitive substring of the **original stored root body**, not only the
240-character whitespace-collapsed preview. Edit-event overlays are not projected in v1. Empty titles show “Untitled thread”.
Canonical depth-zero roots and roots without metadata are eligible, but any valid NIP-10 reply marker excludes the event. Live ingest intentionally leaves roots without replies metadata-less. SQL/Rust-parser parity tests cover bare, root-only, malformed and valid reply tags.

One query fetches 50 roots; Load more uses a time/ID cursor, up to five displayed
pages. Narrow search to reach older results beyond that UI budget. Every refresh
replaces the list from the head. The visible panel refreshes every 30 seconds,
on returning to the foreground, and manually. It has no extra WebSocket or
per-thread daemon. Results are cleared on refresh, error, channel/account/relay
switch, and unmount. Any error pauses automatic requests until manual retry. There is no persistent status or cache. Changes can take
up to the refresh interval to appear; this is not instant observation.

## Integration contract

`POST /query` accepts exactly one filter with exactly these fields:

```json
[{"kinds":[9],"limit":1,"#h":["channel-uuid"],"thread_flags":{"mode":"active","q":"","limit":50,"cursor":null}}]
```

The outer limit1 caps legacy fallback to a single event; supported relays use the inner page limit.
The extension runs after existing NIP-98 admission, relay membership and
channel-access repair. It additionally reads fresh channel grants; the SQL
statement repeats community/channel/viewer access predicates. Revocation
between those two reads returns no private rows. Archived/deleted channels
produce no rows. Existing route middleware still owns rate admission.

`thread_flags` is the strict `buzz_core::thread_flags::Query` contract. Unknown
fields/modes, query >200 Unicode scalars, limit outside1..100, and malformed
composite cursors are errors, never clamped. Cursor order is `created_at DESC,
id ASC`: next page is older time OR same time and larger ID. The probe is never
emitted. Classification, substring and cursor predicates run before LIMIT.
A page is current state, not a cross-page transaction snapshot; concurrent
flag changes can change matches, and refreshing restarts at head.

Response is exactly one query-only, relay-signed kind39007 event. It is registered
relay-only, never submitted/stored as a message. Content carries version1,
channel, exact query, rows, has_more and next_cursor. Its d coordinate includes
the request identity. A missing/newer/invalid overlay is an explicit error,
including on older relays; supported empty results still return an envelope.

Tauri captures configured relay URL and signer keys, uses existing NIP-11 `self`
lookup for that URL, pins the captured keys throughout the signed request, then
checks current scope again. It verifies response signature/signer and strict
page shape before returning to React. This trusts the **configured relay's TLS
origin**, matching existing relay-directory semantics; it is not independent
out-of-band cryptographic trust in an untrusted relay. Key mismatch fails closed;
existing URL-scoped NIP-11 cache expiration governs rotation retry.

## Module boundary and updates

Native contract and wire validation: `buzz-core/src/thread_flags.rs`.
One classification source in native execution: `buzz-db/src/store/thread_flags.rs`
(SQL normalizes FE0E/FE0F at query time; stored reactions are untouched).
Bridge dispatcher:13 lines; focused native command and React feature own the
rest. AppSidebar adds only an import and a mount. No dependency/schema migration.

The prototype in shojikumaru/buzz-thread-flags commit1cdac1a is the reviewed
behavioral reference, not a production CLI data provider. Native uses its
policy through the server projection and a React adapter; it does not load the
snapshot DOM widget or reclassify paged rows client-side. Update the documented
policy and both packages' behavioral tests together if semantics change.

A relay and Desktop build with this change are both required. This branch is
not deployment, merge approval or an installed-app update.

## Reproduce local wire smoke

Start a disposable relay on127.0.0.1:43109 with its own PostgreSQL/Redis, then run
`node desktop/scripts/thread-flags-live.mjs`. This uses published test-only keys
and the installed Buzz CLI, creates two test channels, exercises actual signed
events and NIP-98 requests, and archives those channels on success. The URL is
fixed to loopback. Never use its keys on a real community. This checks the real
relay wire path, not the installed Desktop binary.
