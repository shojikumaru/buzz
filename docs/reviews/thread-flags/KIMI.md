• Design delta review of `BRIEF.md` (read-only; host checkout not inspected — uncertainties listed at the end).

  ## Findings

  **1. Medium — Flag-precedence and per-filter semantics are not pinned down**
  - Location: §1 ("canonical distinct flags", five filter modes) + §4 (filter UI); Acceptance: "Completed overrides active visibility; dual flags one row."
  - Evidence: The proposal never states how a thread holding both 🚩 and ☑️ is classified per filter. "Canonical distinct flags" describes the row payload, not visibility. Two conforming implementations can disagree: does `active` exclude ☑️-completed threads even when 🚩/🔴 reactions remain? Does `complete` require ☑️ regardless of other flags? This is the acceptance criterion most easily lost in SQL.
  - Correction (small): Define one derived per-thread state in `store/thread_flags.rs` — e.g. `completed` if any active ☑️ exists, else `active` with its flag set — computed in one place (SQL CASE or Rust post-pass). Define each filter mode as a predicate over that derived state; row payload still reports the raw distinct flag set. Add the planned "dual" test in both directions: 🚩+☑️ appears in `complete`/`all`, never in `active`/`coordinate`.

  **2. Medium — Variation-selector normalization point is unspecified**
  - Location: §1 flags matching; Acceptance: "variation selectors normalized."
  - Evidence: ☑️ circulates as both U+2611 and U+2611+FE0F in reaction content. If reactions are stored raw and matched raw in the SQL, one variant silently misses and thread state is wrong; removal must clear the flag symmetrically. The design says flags are "canonical" but not where canonicalization happens.
  - Correction: Pin the location — either normalize reaction content at ingest (preferred if the existing store already has such a hook) or enumerate both literal forms in the query predicate. State it in one sentence and have the DB tests exercise both variants for add and remove.

  **3. Low — `q` substring matching needs wildcard escaping and a stated case policy**
  - Location: §1 "title substring q bounded200 chars."
  - Evidence: If implemented as `ILIKE '%' || q || '%'` with raw input, `%`/`_` in user text act as wildcards — wrong matches (correctness, not injection, assuming parameterization, which the existing POST/query layer already practices).
  - Correction: Escape LIKE metacharacters or use `strpos(lower(title), lower(q)) > 0`; state case-insensitivity explicitly. One line in the design, one test row with a literal `%` in q.

  **4. Low — Cursor capture vs limit+1 probe is ambiguous**
  - Location: §1 "limit+1 probe. Capture cursor on returned ordered final row."
  - Evidence: With a probe row fetched, "returned ordered final row" reads as the last *emitted* row — but if anyone captures the cursor from the probe row instead, the next page's keyset condition `(created_at, id) < (t, id)` skips that probe row entirely: silent row loss, adjacent to the "same-second pages no skip" guarantee.
  - Correction: State explicitly: emit at most `limit` rows; `next_cursor` derives from the last emitted row; the probe row only sets `has_more` and is never serialized into 39007. The planned cursor test should include a page boundary landing exactly on a same-second pair.

  **5. Low — Reaction-to-root join needs two explicit predicates**
  - Location: §1 "active reactions removed_at null with community/event timestamp/id joins."
  - Evidence: Acceptance is root-only. The design constrains the *message* side (thread_metadata depth null/0) but the reaction join must also (a) target the root event id, not a reply, and (b) match the channel's community/#h bind — otherwise a reaction on a reply, or a same-event reaction from another community, flips root state. "community/event ... joins" implies this but doesn't commit to it.
  - Correction: Write both as named join predicates in the method contract. The planned root-vs-reply and tenant tests already cover this if written against these two cases specifically.

  **6. Info — Live-state pagination semantics should be documented, not changed**
  - Location: §1 "Query time live state (not cross-page snapshot)."
  - Evidence: Ordering keys (created_at, id of the root) are immutable, so inserts/deletes/flag flips cannot cause skips or duplicates *within* a filter — the choice is sound. But a thread gaining a flag with created_at older than the cursor is omitted from remaining pages, and one losing its flag vanishes mid-pagination. Client de-dup (§4) already handles overlap.
  - Correction: One sentence documenting these semantics as intended. No code change.

  **7. Info — 39007 sits in the addressable range (30000–39999)**
  - NIP-01 treats these as parameterized-replaceable if ever published. Fully mitigated by "query-only, register relay-only, never published," and consistent with the existing 39005/39006 precedent. Note only; confirm-unused remains a pre-implementation check.

  **8. Info — Overlay freshness**
  - 39007 validation echoes version/channel/filter/cursor but carries no request nonce, so a stale signed overlay for the identical request is replayable. Since the pinned relay is already the trusted signer for 39005/39006, this adds no new trust — accepted as-is.

  ## What the design gets right

  Extension placed after existing auth and before fallback; explicit-unsupported for old relays rather than silent empty; both-or-neither cursor; signer/relay fencing on both sides of the await; query key scoped to relay/account/channel/mode/q; no client-cached membership; error/switch hides stale data; no new tables, deps, endpoints, or daemon. I found no avoidable complexity worth cutting — the five filter modes map to acceptance criteria, and the limit+1 probe is the minimal `has_more` mechanism.

  ## Uncertainties

  - Whether the existing reaction store normalizes emoji content anywhere today (finding 2's correction depends on it).
  - Whether "canonical thread_metadata depth null/0" reliably excludes broadcast replies on all ingest paths, including kind-9 events with missing/malformed parent markers.
  - Whether the store's `removed_at` is set for *all* reaction-removal paths (kind-5 deletion, re-sync, replacement) — "removal recomputes state" depends on it.
  - Whether "expected relay" fencing covers multi-relay account configurations or assumes a single relay per community.
  - The pinned relay public key lookup mechanism — already flagged in §3; must be resolved before implementation, as stated.

  ## Verdict

  **Approve with minor corrections.** No missing security boundary and no speculative redesign needed. Findings 1 and 2 must be pinned in the design text before implementation (they are the two places where two engineers would build different behavior from the same words); findings 3–5 are one-line contract clarifications backed by tests already in the plan; 6–8 are documentation-level.

