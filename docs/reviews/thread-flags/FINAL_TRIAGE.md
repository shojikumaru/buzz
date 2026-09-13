# Native implementation review adjudication

Owner/implementer: alpha-codex (Astra). Reviewers did not edit code.
Review contexts: independent CLI snapshots, no repository tools. Claude Opus 5,
GLM 5.2 and Kimi K3 were requested explicitly. Kimi CLI exposes neither actual
backend model nor a reasoning-effort flag; no stronger verification is claimed.
Design records above are retained; implementation and delta responses are saved
separately. The implementation base is `6c35e82bd50f4ad6587554eeb429e7378d474ba7`.

## Accepted and fixed

- Legacy compatibility: outer `limit:1` bounds old-relay fallback; the extension's
  inner limit controls projection pages. Missing limit is rejected. Native and
  documented wire requests use this same shape.
- Error retries: any error pauses automatic polling; manual refresh retries.
  A busy guard prevents overlapping automatic requests. State clears on error.
- Expensive scans: an explicit transaction sets LOCAL statement_timeout=5s.
  Existing SubscriptionHistory writer observation and route admission remain.
- Root classification: **the initial depth-zero-only design is superseded**.
  Real signed wire tests found ordinary roots without thread_metadata. The
  projection now LEFT JOINs metadata and excludes canonical valid reply tags.
  A Postgres test compares SQL with the actual Rust NIP-10 parser for bare,
  root-only, marker-index-two, malformed, uppercase-ID, case-sensitive marker,
  multiple marker, root+reply and fifth-element shapes. Standard tagged-event
  hashing precludes constructing a signed self-ID tag without a fixed point;
  no unsupported self-reference production invariant is claimed.
- Cursor conversion fails explicitly, and response timestamps are range checked.
- Snapshot image tooling supports the fork, validates the origin push target,
  and uses configured authorship/DCO; missing identity yields an explicit error.
- All original access/removal/complete/cursor tests retained; open non-member
  authorization and a visibility flip now use the canonical access helper.

## Findings resolved by source/evidence

- Delta Opus B1: parser parity passes in the full official Postgres lane, not
  only mocked UI tests. See verification record.
- Delta Opus B2 / Kimi wire condition: real relay smoke passes ten checks,
  including a multi-row page and next page with outer limit1. It publishes
  signed roots/reactions and uses actual NIP-98 HTTP requests.
- Delta Opus S1 and GLM stale catch finding: false positive from limited diff
  context. The first catch statement already is
  `if (ticket.current !== current) return;`, before rows, page, polling or error
  changes. The finally block is guarded as well. No duplicate guard added.
- Cursor field/length findings: Cursor already denies unknown fields. Query
  validation runs before DB acquisition and requires exactly64 lowercase hex
  characters. Bad input is rejected by relay parsing with400, before DB errors.
- Fractional timestamps: canonical signed-event insert paths in store/event.rs
  derive created_at with from_timestamp(event.created_at.as_secs(),0). A DB test
  asserts the stored seconds invariant. received_at is a different field.
  Manual corruption of this invariant is outside the signed-event contract.
- JSON tag shape: both canonical event insert paths serialize nostr Tags into
  arrays. This feature introduces no arbitrary-JSON write path. Corrupt manual
  database writes are outside this contract; SQL errors fail closed.
- Join uniqueness: schema/schema.sql thread_metadata primary key is exactly
  (community_id,event_created_at,event_id), preventing metadata fan-out.
- Authorization is intentionally the canonical active channel membership OR
  open visibility; there is no invented admin bypass. SQL repeats that scope.
- URL normalization exists in the shared relay HTTP helper. NIP11 self is trust
  in the configured TLS origin, not an independent key-distribution guarantee.
- Postgres tests are discovered by existing postgres_tests job filtering. The
  ignored markers prevent running them without fixtures; discovery guard passed.
- The component's busy test is not vacuous: without the guard its interval tick
  during a pending request would produce a second fetch; it asserts one.

## Deliberately bounded follow-up

Unsupported relays show their explicit compatibility error and paused refresh;
manual retry permits a relay upgrade without reloading Desktop. A capability-
aware hidden panel is optional future polish, not a background retry loop.
Original-body search does not fold edit events. Polling is30s, not live pushes.
No cross-page snapshot, process-state inference, archive operation or deployment.
No new per-feature metric family/read pool was introduced. A projection-specific
index or service is deferred until measured demand justifies it.
The tiny fixture-ID and diagnostic punctuation suggestions do not affect
production data; they are not grounds for expanding this change.

The screenshot target is the public OSS fork shojikumaru/buzz, verified with
GitHub. It is distinct from the private prototype repository. Screenshots use
synthetic E2E fixtures, never private channel content.
