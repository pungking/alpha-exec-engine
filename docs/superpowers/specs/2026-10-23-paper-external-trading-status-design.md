# External trading-status source: safety-preserving design review

Parent goal: PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1
Reviewed code: bff854da3de73ad5886ffa39ebd50dfa538e592c
Review date: 2026-10-23
Status: DESIGN_REVIEW_COMPLETE_SOURCE_NOT_QUALIFIED
Written-spec approval: NOT_GRANTED
Runtime, purchase, dependency and execution authorization: NONE

## 1. Intent and decision

The operator approved evaluating an external status source, with Databento as a
candidate, without reducing existing safety requirements. The objective remains
real inputs -> readiness -> existing PAPER adapter -> observation/notifications.
This document is a proposed amendment to the 2026-10-16 operational-binding
design, not completed implementation or a new diagnostic runtime goal.

Decision: Databento documents useful bootstrap and recovery mechanisms, but the
reviewed public contract does not yet qualify the complete source required here.
Do not purchase, connect, implement a production decoder, or declare source PASS.
The specific remaining source question is authoritative per-target trading-state
coverage, including how its currentness is established during quiet periods and
upstream loss. An open TCP connection alone cannot answer it.

This is not a finding that Databento cannot provide the service. It is a bounded
qualification result, not a reason to repeat account probes or wait for RTH.

## 2. Unchanged authority and ownership

- Only the existing five exact limited-control identities can be managed. A later
  manual holding is not adopted. Historical ownership/idempotency/PnL remains
  unverified; no historical normalization or state migration is authorized.
- Alpaca PAPER remains the broker and the explicitly acknowledged IEX quote source.
  The candidate supplies trading-status evidence only, not prices, Stage6 signals,
  quote entitlement, account identity, a market clock or risk-policy approval.
- Retain the private fixed caps, 10 bps spread, 10 bps adverse-price condition and
  30-second evidence-age ceiling. Do not substitute broader market-data coverage
  for the existing quote/risk gates or relax freshness.
- READ_ONLY=true, EXEC_ENABLED=false and LIVE_ORDER_SUBMIT_ENABLED=false remain
  defaults. MARKET_GUARD_MODE=observe. No recurring activation or LIVE authority.
- Current task changes documentation only. No broker/data API, stream, credential
  read, purchase, email send, workflow, state, execution setting or order operation.

## 3. Official-document findings

Links were reviewed on the date above. These are public-document facts, not
account entitlement or actual target-coverage observations.

| Requirement | Verified fact | Qualification |
| --- | --- | --- |
| Status semantics | [Status schema](https://databento.com/docs/schemas/status) has action, reason, publisher/instrument IDs and event/capture timestamps. Its boolean-like trading/quoting fields are best-efforts and may be unknown. | PARTIAL: normalized fields do not establish each venue's regulatory authority. |
| Initial state | The same page documents last-status snapshots at UTC midnight in the historical API. | PARTIAL: not an on-demand live status snapshot; exact target coverage and baseline-to-live overlap must be established. |
| Replay | [Intraday replay](https://databento.com/docs/api-live/basics/intraday-replay?lang=python) uses status event time, offers up to the available 24-hour window, and emits completion per replayed schema. Availability can be shorter around nonpublication periods. | DOCUMENTED mechanism, not proof that an arbitrary old snapshot can be bridged. |
| Recovery | [Recovery](https://databento.com/docs/api-live/basics/recovering-after-a-disconnection?lang=python) describes inclusive replay with per-instrument timestamp/count duplicate handling. Its snapshot recovery option is MBO-only. | DOCUMENTED mechanism; natural refresh or an MBO snapshot must not be treated as status recovery. |
| Live completeness | [System messages](https://databento.com/docs/api-live/basics/system-messages?lang=python) distinguish connection heartbeat, replay completion and slow-reader warning. Interval-end completeness is specified for OHLCV/BBO/CBBO, not status. | UNRESOLVED: no reviewed status-specific ongoing coverage time or equivalent completeness guarantee. |
| Failure detection | [Error detection](https://databento.com/docs/api-live/basics/error-detection?lang=python) discusses heartbeat timeout. Connection liveness is a different property from upstream status coverage. | PARTIAL: transport timeout cannot certify NOT_HALTED. |
| Venue scope | [US equities catalog](https://databento.com/catalog/us-equities) lists multiple venue datasets; XNAS.ITCH includes Status and its real-time access requires Plus or Unlimited. | UNRESOLVED: service-wide venue marketing is not exact regulatory/venue status coverage for the five targets. |
| Identity | [Security master](https://databento.com/docs/schemas/security-master) includes effective times and nullable stable identifiers. | PARTIAL: no verified join from the five broker asset IDs was collected; symbol-only matching is prohibited. |
| Cost/license | [Pricing](https://databento.com/pricing) excludes usage-based live US equities and describes license qualification. | UNVERIFIED: actual plan, reference-data rights, non-display use and total cost were not established. No signup or license form was submitted. |

Do not quote a generic pricing card as the applicable US-equities price, assume
credits cover live use, or recommend a subscription before technical fit and total
fees are known. The small planned LIVE capital is not permission for a recurring
data expense. This design does not establish any return or win-rate benefit.

## 4. Proposed source boundary

If qualification succeeds, extend only the existing source-production boundary:

    pinned status-source contract + exact identity mapping + licensed scope
      -> bounded baseline and overlapping replay
      -> authenticated, complete current status coverage
      -> sealed observation consumed by existing PAPER readiness
      -> existing controller, reservation stores, adapter and observer

Do not add a second execution engine, generic provider framework, planner or
ledger. Do not bypass existing source/risk/time or submit-boundary checks.

The reviewed repository has no production dependencies. The referenced provider
examples do not establish an already-installed compatible Node live client.
Do not assume historical HTTP/JSON is a live status feed or casually implement a
binary decoder. Any SDK/runtime or raw-protocol choice needs a separate reviewed
implementation/dependency decision after source qualification; none is selected
or installed here.

### Exact identity and scope

Bind broker asset ID, provider dataset/publisher/instrument ID, authoritative venue
scope and effective interval to independently verified identity evidence. A ticker
may locate candidates but cannot itself prove the join. Missing, multiple or
expired mappings fail closed. Preserve corporate-action/rename boundaries.

For each target, document which source proves listing-market regulatory state,
relevant trading-venue state and applicable market-wide restrictions. Do not
assume one venue's Trading action clears every other restriction. Conflicting
or unknown required scopes block the target and the five-row readiness gate.
Do not subscribe to an entire market to avoid resolving these five identities.

### Baseline, overlap and invalidation

The proposed states are:

    UNKNOWN -> BASELINE_VERIFIED -> REPLAYING -> CAUGHT_UP -> COVERAGE_VALID
    any missing requirement, disconnect or gap -> INVALIDATED

Each transition requires source evidence, not a caller-created label. A midnight
historical record is useful only if a bounded, complete overlap through the live
handoff can be proven. Absence of a record is unknown, not trading. Preserve a
carryover halt across days/weekends. Do not fabricate a start-of-day Trading event.

Associate subscriptions, datasets, schema and session with the correct completion
message. CAUGHT_UP is not automatically COVERAGE_VALID. Unknown status codes,
contradictory records, late/out-of-order data outside a documented ordering model,
replay-window loss, upstream gap, slow-reader warning and host suspend invalidate
readiness. Quoting/resumption-of-quotes alone is not trading resumption.

No automatic reconnect or retry is authorized. A future approved recovery must
retain exact per-instrument watermarks and same-time record counts, revalidate
the baseline/overlap and receive the relevant completion evidence. An unexplained
sequence/count change blocks rather than dropping potentially new events.
No stream silence, unrelated quote or subscription ACK clears a gap.

### Freshness compatibility: an explicit interface change, not a timestamp fix

Today `assessSourceBindings` in `scripts/lib/scoped-paper-evidence.mjs` requires a
fresh `halt.observedAt` within 30 seconds. Replacing that value with local receipt
time for an old status event would be false evidence. Leave legacy behavior intact.

The proposed new operational-only source-proof version would separate:

- status effective/event time;
- provider capture and optional gateway send time;
- local receipt interval;
- independently justified status coverage-through time;
- baseline/transition/identity/contract hashes and any detected gap.

These are proposed internal concepts, not claims that the provider emits fields
with these names. A valid coverage time needs a documented status-specific
completeness basis or an equivalent explicitly reviewed stream guarantee. It
cannot be minted from a heartbeat, local now, replay label alone, unrelated
interval marker or gateway send timestamp. The entire coverage proof must be
authenticated and tied to the correct session and target scope.

Require nonfuture coverage no older than the existing 30-second bound and reject
gaps or unverifiable host-clock provenance. Preserve the old event timestamp even
when valid ongoing coverage proves the unchanged state. Lack of an adequate
coverage basis means BLOCKED, not an age tolerance or refreshed event time.

A new version needs explicit schema dispatch, stable authority/code pins,
compatibility tests and rejection by old consumers. The old legacy adapter and
operational audit-only route must not accept it implicitly. No such version is
implemented or approved for use in this change.

## 5. Integration reach and tests required before any future merge

| Existing location | Future narrowly scoped responsibility |
| --- | --- |
| `scripts/lib/scoped-paper-operational.mjs` | Versioned status-source policy pinning and true source/risk/time readiness; current audit labels remain non-executable. |
| `scripts/lib/scoped-paper-evidence.mjs` | Verify authentic source records and produce the sealed current observation; retain legacy checks. |
| `scripts/lib/scoped-paper-adapter.mjs` | Reuse controller/transport/storage/observer composition; never accept source labels as execution authority. |
| `scripts/run-scoped-paper-closeout.mjs` | Explicit version dispatch only after qualified producer and reviewed final composition; default zero-I/O remains. |
| `scripts/test-scoped-paper-evidence.mjs`, `scripts/test-scoped-paper-readiness.mjs` and existing operational fixtures | Legacy regression, invalid source rejection and approved new proof semantics. |

Required future fixtures: previous-day halt baseline; absent baseline; shorter
replay window; overlapping records with equal timestamps; wrong-dataset/schema
completion; venue-only Trading versus regulatory halt; unknown/quoting status;
ambiguous/renamed identity; heartbeat without coverage; stale/future coverage;
disconnect/slow-reader/sleep invalidation; old-version rejection; valid source
with missing risk/time still blocked; no-approval/default-safe zero mutation;
no scope expansion; deterministic replay and identifier/secret redaction.

These are acceptance cases, not tests claimed to have run for an unimplemented
source. Existing offline mock success remains mock success, not vendor proof.

## 6. Runtime budget, cost and operational gates

Current authorized source sessions/requests, broker requests, orders and sends
are all zero. Future source authority must enumerate exact datasets, five identity
mappings, baseline range, subscriptions, connection count, record/byte limits,
duration, replay scope and monetary ceiling before any authenticated access.
Missing limits block; no unlimited replay (`start=0`), all-symbol subscription,
hidden polling, pagination or retry. Unknown source limits are not invented here.

Do not reuse the existing 61-GET/5-POST controller ceilings as permission for
Databento, or charge status monitoring against a previously consumed one-shot.
Source, broker and observation budgets remain separate and explicit. Existing
broker deadlines/response limits are unchanged.

Even a qualified status source does not resolve current management-risk evidence,
host-clock provenance, state custody, account-wide writer exclusion, attendance,
or independent Mac-failure notification. Those remain parent gates. Losing the
source stops new submissions; it does not cancel a resting order. Preserve the
already-reserved observation route within its own authority and budget. No
automatic cancel/replace or residual resubmission is added.

## 7. One finite next step, not repeated runtime diagnosis

Before implementation planning, resolve this single source-qualification packet
through authoritative documentation or a provider's substantive technical reply:

1. For US-listed equities, identify the exact dataset/publisher combinations and
   code mapping covering regulatory halt, LULD, market-wide halt, carryover halt
   and trading resumption. State which restrictions are venue-specific.
2. Specify a complete initial status and historical-to-live overlap contract,
   including UTC midnight, weekends, missing instruments and replay unavailability.
3. Specify how a quiet status stream proves current coverage, including upstream
   loss/stall, ordering and replay completion semantics. Does a documented
   status-specific completeness time or equivalent guarantee exist? A transport
   heartbeat description alone does not answer this requirement.
4. Confirm applicable live/historical/reference/non-display entitlements, total
   recurring fees and any minimum commitment. No private account or positions
   are needed to answer these product-level questions.

This packet is prepared, not sent. Do not search the same documents repeatedly,
open another broker probe, create another monitor or wait for natural runtime.
If the answer cannot establish the required guarantees, close this candidate as
NOT_QUALIFIED_UNDER_CURRENT_CONTRACT. Any alternative source or policy change
requires an explicit separate decision, not silent fallback or indefinite audit.

Written approval of this proposed spec does not resolve the unanswered technical
facts, authorize contact/purchase, or authorize production implementation. Once
qualified and the written design is approved, update Tasks 2/5/6 of the existing
implementation plan rather than creating another disconnected engine or goal.

## 8. Completion and rollback

This design review is complete when its evidence/unknowns, exact consumer reach,
compatibility requirements, cost boundaries and finite qualification decision are
recorded. The parent goal is not complete: Tasks 2/5/6, full reviewed integration,
main merge and separately authorized PAPER runtime proof remain outstanding.

No source has been installed or activated. Reverting this documentation commit
removes the proposal without affecting execution, historical artifacts or state.
Do not merge the existing Draft PR as operationally complete on the basis of this
review. No deposit, order approval or prediction of profitable LIVE operation is
provided.
