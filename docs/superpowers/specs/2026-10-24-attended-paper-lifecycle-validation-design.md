# Attended PAPER lifecycle validation: scope-separated design

Parent: PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1
Design work item: PAPER_ATTENDED_LIFECYCLE_VALIDATION_DESIGN_V1
Reviewed baseline: 6114afd0136afcffdf8c6f51102471db66692063
Status: DESIGN_DIRECTION_APPROVED; ATTENDANCE_DECISION_RESOLVED; READY_FOR_WRITTEN_REVIEW
Written-design acceptance: NOT_GRANTED
Implementation, runtime, state adoption and order authorization: NOT_GRANTED

## 1. Decision and approval boundary

On 2026-10-24 the operator approved developing an attended, limited PAPER
broker-lifecycle validation design, separate from LIVE and unattended readiness.
The exact five existing limited-control identities and other risk limits remain.
External trading-status coverage remains unverified. The approval explicitly
excludes code safety-gate changes, API calls and orders.

On 2026-10-25 the operator selected the existing time-bounded attestation plus
direct broker-interface supervision and manual stop. There is no per-order human
confirmation mechanism, presence polling, biometric check or new attendance
service. This resolves the builder's single operator-control question, not the
separate implementation or runtime approval gates.

This document makes that direction implementable for review. It does not change
an execution policy today. It proposes a narrowly scoped future exception to
the requirement for externally verified halt status in a PAPER functional test;
it is not a finding that halt risk is irrelevant or that a broker guarantees it.
Written-design approval, offline implementation approval and exact runtime/order
approval are distinct. No previous one-shot authorization transfers to this path.

The original all-source operational goal remains incomplete. A limited PAPER
test cannot satisfy its missing source coverage, certify autonomous trading,
normalize historical identity, or establish LIVE/return/win-rate readiness.

## 2. Approaches and selected scope

1. Retain the complete production-style source gate for every PAPER test:
   strongest equivalence, but requires source qualification before lifecycle
   integration can be exercised. This remains the existing route's behavior.
2. Separate an attended PAPER lifecycle claim from production readiness:
   selected by the operator. Reuses the controller, transport, paired stores and
   observer while explicitly limiting what the result proves. Requires strict
   authority, schema and downstream isolation; no silent global bypass.
3. Treat tradability, fresh quotes or broker acceptance as NOT_HALTED:
   rejected. These do not establish comprehensive trading-status evidence.

Databento and a supplier email are not prerequisites for designing or testing
option 2 offline. Sufficient public source documentation may independently
qualify option 1 later. No purchase, feed connection or repeated inquiry is part
of this design. Official-source qualification remains unresolved, not waived
for LIVE or the old operational route.

## 3. Existing code and actual change reach

The current prerequisite audit in `scripts/lib/scoped-paper-operational.mjs`
always preserves missing source, current-risk and clock-provenance blockers.
`collectOperationalEvidence` and `runOperationalPaperCloseout` are not yet
implemented. Static validation is not a functioning operational caller.

Two independent current boundaries require NOT_HALTED:
`assessSourceBindings` in `scripts/lib/scoped-paper-evidence.mjs` and
`priceOrder` in `scripts/lib/scoped-closeout-contract.mjs`. The evidence mapper
also copies that fact into each sealed snapshot. Removing one check or putting
NOT_HALTED into a fixture-shaped runtime object would be wrong.

| Existing location | Narrow responsibility of a future implementation |
| --- | --- |
| `scripts/lib/scoped-paper-operational.mjs` | Versioned limited-test configuration, local input validation and separate limited-readiness result; retain old audit semantics. |
| `scripts/lib/scoped-closeout-contract.mjs` | Opaque purpose-bound authority, explicit scope-aware source check, same controller/pricing/caps and submit-to-observer handoff. |
| `scripts/lib/scoped-paper-evidence.mjs` | Authentic non-halt observations, sealed limited snapshot and retained NOT_VERIFIED halt truth; no fabricated source proof. |
| `scripts/lib/scoped-paper-adapter.mjs` | Compose approved scope, receipts, controller, stores and observer; do not duplicate the execution engine. |
| `scripts/lib/scoped-paper-transport.mjs` | Preserve fixed PAPER routes, sealed receipts, deadlines and budgets; limited authority must not enable other verbs/origins. |
| `scripts/lib/scoped-closeout-storage.mjs`, `src/scoped-management-record.ts` | Durable purpose labels and strict paired-write/transition validation, including restart. |
| `src/order-ledger-storage.ts`, `src/order-idempotency-storage.ts` | Version-aware readers; generic entry consumers must still reject management records. |
| `scripts/lib/scoped-paper-oversight.mjs` | Retain scope and broker timestamps; observe only, never recover submission rights. |
| `scripts/paper-order-notifications.mjs` | Scope-qualified aggregate lifecycle results, deduplication and unresolved handoff. |
| `scripts/run-scoped-paper-closeout.mjs` | Explicit new schema/command dispatch; default and old commands remain inert or unchanged. |
| Existing scoped fixtures/tests, code-pin inventories and offline CI | Negative isolation, compatibility, end-to-end mock proof and redaction. |

No analysis/Harvester edits, new provider, planner, ledger, broker abstraction,
runtime environment flag or dependency. Changes remain in alpha-exec-engine.

## 4. Authority and truthful readiness

Use a proposed distinct configuration schema
`scoped-paper-attended-lifecycle-invocation-v1` with fixed
`validationScope=ATTENDED_PAPER_LIFECYCLE_ONLY`. Reuse existing operational
authority fields, exact file/code hashes, account binding, custody, writer
exclusion, oversight and notification settings. Its pinned validation-policy
document replaces only the external halt-source prerequisite in this scope;
non-halt source provenance is still required. Do not require a fictional valid
external source-contract file or silently accept an old operational schema.

The separately signed runtime approval must bind this entire configuration and
the explicit acknowledgement that external halt coverage is NOT_VERIFIED. It
must have a different exact approval kind from legacy/operational/observer kinds.
Keep the repository's existing execution-confirmation gate, exact PAPER host and
account, original finite deadlines and single-use claim. This document supplies
no runtime approval, credentials or executable command.

In-process authority must be minted by the validator and retained in the existing
opaque capability mechanism. A JSON `validationScope` value, copied source label,
hash alone or caller-supplied boolean cannot grant authority. Bind purpose to the
scope, each snapshot generation, every pre-submit check and observer handoff.
Legacy validators reject the new schema; legacy scope plus limited snapshot,
limited scope plus a forged normal snapshot, LIVE, BACKTEST, DRY_RUN and
unattended invocation all reject before credentials/network/store writes.

The limited readiness result is `PAPER_LIFECYCLE_PRECONDITIONS_MET` only when all
unchanged conditions pass. It is not PASS for generic execution/source readiness.
Always expose separately:

- externalTradingStatus=NOT_VERIFIED;
- productionReadiness=false; liveReadiness=false; unattendedReadiness=false;
- executionAuthorized=false until a distinct, valid runtime capability exists;
- originalOwnershipVerified=false; realizedPnlVerified=false;
- historicalEvidenceNormalized=false.

The existing full-source audit continues to report its actual blockers. Do not
delete them, turn a broad BLOCKED into PASS, or use a limited result to complete
the parent goal. The final wire boundary must check the limited capability again,
not only the earlier readiness result.

## 5. Exact exception and unchanged rejection rules

Only unavailable comprehensive external trading-status coverage may be recorded
as NOT_VERIFIED for this explicitly acknowledged PAPER validation purpose.
Missing coverage is not a fabricated Trading event, freshness refresh or source
receipt. No `halt.observedAt` is generated from local time, a quote or a heartbeat.

Known halt/restriction, conflicting source evidence, and stale, malformed or
unverifiable evidence supplied as a status observation still block. Invalid
supplied evidence must not be dropped and reclassified as absent coverage. A
known halt is sticky for this invocation; disappearance of its record or a new
quote does not clear it. There is no assertion that all real-world halts can be
detected in this deliberately limited scope. A caller cannot upgrade it to the
normal route even if a status later appears to be verified.

All other conditions remain unchanged:

- Five unique approved identities; long, full-quantity sell, LIMIT DAY,
  extendedHours=false; no entry, scale-in, shorting, replacement or residual retry.
- Existing private per-row/total notional caps, spread <=10 bps, adverse-price
  bound <=10 bps and evidence-age ceiling <=30 seconds. No inferred numeric caps.
- Fresh exact PAPER account, full signed portfolio, empty conflict-free open-order
  set and protective-child check, asset identity/increments, acknowledged IEX
  single-exchange quote scope and size units, liquidity/depth, RTH calendar/clock.
- Verified current non-halt risk inputs under the existing explicit policy:
  position/sector/portfolio exposure, daily loss/drawdown, volatility, dollar
  volume and earnings distance. No implicit risk-reduction exception is approved.
- Independent clock-reference provenance and monotonic continuity; interval
  arithmetic or a running clock daemon alone is not that proof.
- Authentic current state custody, paired pre-write hashes, durable exclusive
  attempt, account-wide writer exclusion and an attended broker interface.

Old captures are not current evidence. A later manual holding is not adopted;
any full-portfolio drift invalidates the previously approved terms. Missing
risk/time/custody evidence blocks explicitly and is not deferred until after an
order. The real producer for these inputs remains implementation work; a policy
document or synthetic fixture does not fulfill it.

## 6. One controller, bounded attempt and real oversight

Future flow: local pins and approval -> limited capability -> authentic bounded
observations -> all-five readiness -> paired reservation -> per-target fresh
pre-submit validation -> existing PAPER adapter -> same controller outcome ->
bounded existing observer and deduplicated notification/handoff.

All-five readiness is a pre-submit gate, not an atomic broker transaction.
The first accepted/nonterminal, partial, uncertain or failed outcome stops later
submissions in this invocation and hands off only attempted identities. A later
fill does not resume remaining targets. Zero-to-five submitted orders is possible;
never report five-row completion from the initial reservation or acceptance.

Retain current upper ceilings: account 6, positions 11, orders 11, clock 11,
calendar 1, assets 10, lookup 5, quotes 6 GETs (61 total), submit <=5 POSTs.
These are code ceilings, not permission to use them. Future scope pins its exact
budget without increases; oversight has its own explicit finite `1 + 8*maxCycles`
read budget/deadline and single-use claim. Keep response bounds 3 seconds/8 MiB,
300-second attempt with its existing 17-second send margin, no pagination/retry,
no POST fallback and no PATCH/DELETE. No new source-network route is introduced.

Attendance is an operator-attested commitment covering the full signed
observation/handoff window, not machine-verified physical presence. Keep
`physicalAttendanceVerified=false` and the existing pinned attendance document,
named operator, PAPER account/session, expiry and handoff-procedure hash. An
unattended configuration, missing/expired attestation or changed bytes blocks.
There is no automatic renewal. Unreported human absence cannot be detected by
this contract and remains an explicitly acknowledged residual risk.

The chosen operator procedure is: remain at the correct PAPER broker interface,
stop the attempt before leaving or when intervening manually, and check any
submitted or uncertain order until it is terminal or explicitly handed off.
Later manual trading is not authorized by this design; it invalidates writer
exclusion and must not be silently adopted into this scope.

Future caller control semantics (proposed implementation, not existing behavior):

- A manual interrupt (`SIGINT`) irreversibly retires new submission authority
  for this invocation. Recheck it at every send boundary. Do not create another
  attempt, resume later targets, cancel/replace an order or release dedup keys.
  Let an in-progress atomic state operation reach its safe boundary; a force-kill
  may interrupt paired persistence and must leave that state fail-closed.
- If no wire attempt occurred, preserve any reservation/attempt receipt and
  terminate without extra broker reads. If a POST may have reached the broker,
  preserve ATTEMPTED/uncertain evidence; stopping local work does not prove that
  the broker rejected or canceled it. Complete only already-authorized bounded
  observation/handoff if its authority, attendance and time budget remain valid.
- A second interrupt, `SIGTERM`, process crash or host loss may end observation.
  Attempt a safe handoff only within remaining authority; do not promise delivery
  or extend the observation budget. The operator must use the broker interface
  to determine the outstanding outcome. No automatic cleanup is authorized.
- Expiry, reported revocation/absence, changed pins, drift or evidence failure
  stop new sends. The existing code has no manual-interrupt binding yet; its
  implementation must be tested before claiming this control is available.

A resting DAY order may remain at the broker after this process stops. The
operator must acknowledge this limitation; an expired or failed notification is
unconfirmed and never permits resubmission. No software claim of actual human
presence, reliable host-loss delivery or remote supervision is introduced.

## 7. Durable purpose and compatibility

Scope must survive crashes, restarted observation and downstream reporting.
Proposed new records use `SCOPED_MANAGEMENT_EXIT_V3`, `schemaVersion=3`, the
existing record fields plus required `validationScope=ATTENDED_PAPER_LIFECYCLE_ONLY`
and `externalTradingStatus=NOT_VERIFIED`. `brokerEventTimestamps` is a required
field: null only while brokerStatus/brokerOrderId are null; once an authentic
observation exists it follows the V2 exact timestamp rules and cannot regress.
Do not synthesize broker event times for reservations or ambiguous sends.

V1/V2 readers and behavior remain supported. No historical records are upgraded,
relabelled, stripped, normalized or moved. V3 records arise only from a separately
approved new attempt. Paired writes, backups, CAS, history limit and sticky STOPPED
remain. Every V3 transition/observer restart retains its scope; it cannot become
V1/V2, normal execution eligible, original ownership verified or verified P&L.
Generic entry/ranking/protection execution consumers continue to reject these
management records. A filled-and-flat PAPER observation is not LIVE evidence.

Update the shared validator and both store readers together; test both stores,
observer, controller and notification consumers. Old binaries must reject V3,
not ignore extra fields. Before any V3 write, rollback is code-only. After such
an approved write, retain a V3-capable reader for observation; never restore an
old ledger or erase labels to run older code. Update exact reviewed-code inventories
and obtain new future pins/approvals; do not rewrite an old private authorization.

## 8. Results and completion claims

Each target is classified once in the final safe aggregate: NOT_ATTEMPTED,
ACCEPTED_OPEN, PARTIALLY_FILLED, SUBMISSION_UNCERTAIN, TERMINAL_WITH_RESIDUAL,
FILLED_AND_FLAT_RECONCILED or CONTRACT_BLOCKED. Preserve finer existing reasons.
Counts must total five; unknown evidence belongs to SUBMISSION_UNCERTAIN or
CONTRACT_BLOCKED, not an invented broker state. Overall completion requires all
five FILLED_AND_FLAT_RECONCILED and unchanged unscoped portfolio, not only fills.
Any other outcome is bounded progress or unresolved handoff, never silent success.

Offline fixtures can prove all edge cases, but their result is
`PAPER_LIFECYCLE_OFFLINE_CONTRACT_PASS`, never a runtime result. A separately
authorized real PAPER attempt can prove only the transitions it actually observes.
Successful full closure is `PAPER_LIFECYCLE_RUNTIME_PASS_LIMITED_SCOPE`; incomplete
or blocked attempts retain their reasons and do not receive this status.

Report and notifications must state PAPER/attended/limited and external halt
coverage NOT_VERIFIED. Public output contains counts/status/hashes only, never
positions, quantities, account/order IDs, credentials or raw responses. Reuse
existing private receipt and alert deduplication; no actual sends during development.

## 9. Required offline acceptance matrix

1. Old valid paths unchanged; old unknown halt still blocked. New scope rejected
   by old schemas, LIVE/unattended and generic consumers; cloned capability fails.
2. Default safe flags, absent/expired/wrong-purpose approval, file/code drift and
   no-argument CLI produce zero credentials/network/store/order activity.
3. Explicit absent external coverage stays NOT_VERIFIED on every surface;
   known halt, invalid/stale supplied status, dropped prior blocker, contradictory
   observation and attempted unknown-to-NOT_HALTED promotion reject.
4. Each other missing/stale risk or clock input, closed market, wrong account,
   portfolio drift/manual position adoption, protection conflict, duplicate identity,
   corrupt idempotency and mismatched ledger hashes reject before first POST.
5. All-five reservation; identical pricing/caps; one uncertain/partial/resting
   result stops later targets. No retry/cancel/replace, residual or restart submit.
6. Fresh authenticated mock receipt binding to current transport and purpose;
   no plain-object evidence or old snapshot reuse. Verify default entry and normal
   operational routes cannot consume a limited snapshot or approval.
7. V3 null-to-exact broker times, persistent scope, timestamp monotonicity,
   paired-store fault injection, V1/V2 compatibility, downgrade rejection and
   generic consumer rejection; no historical migration or verified-P&L promotion.
8. Manual stop before reservation/before wire/during an uncertain POST/after
   acceptance permanently prevents new submits; preserve records and only allow
   bounded authorized observation. Repeated interrupt, expiry, reported absence,
   notification failure/duplicate, terminal residual and unscoped-position drift
   leave an explicit unresolved outcome. Host crash cannot promise an emitted
   alert. No delivery or physical-presence claim without its actual evidence.
9. Deterministic rerun, exact five-row count reconciliation, private redaction,
   and no source/risk/timestamp invention across the complete mock composition.

Reuse existing scoped authority/evidence/adapter/integration/storage/oversight,
notification, order-state and safety suites. Full validation, independent review
and relevant CI precede any merge; synthetic PASS is not source or runtime proof.

## 10. Finite delivery and remaining gates

This work item ends with a reviewed written design, not implementation. Following
design acceptance, prepare one Native implementation plan with three testable
increments: purpose-bound authority/evidence; durable scope/consumer isolation;
actual caller/observer/notification composition. Include authentic non-halt
source/risk/time work in that plan; do not hide it behind an always-blocked stub.

Implementation requires its own explicit scope approval. Then failing fixtures ->
minimal changes -> full offline tests -> independent review -> PR/CI -> merge.
Only afterwards prepare current evidence/custody and a separate exact PAPER
runtime approval. Never require a Databento reply for an offline fixture run,
or infer order permission from this design decision. No date/return promise.

The original source-qualified operational goal stays open. Completing this
limited work proves a useful narrower capability, not completion of every
prerequisite for automation or of the historical missing-evidence goals.

## 11. Builder review and resolved operator decision

The first fresh reviewer ended at a usage limit without findings. After the
reported reset, current app status allowed normal usage; resuming that same
handle returned not found. One replacement reviewer completed the bounded
builder check of draft SHA-256
`fb887125b3b2d1a2c4db4ddb2054dab437004f30f4f3879d7fc19cfdaabfbabb`.
The first failure is not counted as a completed review. No runtime tests were run.

The review's consequential question was: what establishes and revokes attendance?
The existing control checks a pinned operator attestation and its expiry, and
truthfully reports `physicalAttendanceVerified=false`. It cannot know that a
person signed and then left. A configured rejection of unattended invocation is
not evidence of actual human presence.

- Selected on 2026-10-25: reuse the named, time-bounded attestation
  plus direct supervision at the broker interface and an explicit manual-stop
  procedure. Physical attendance stays operator-attested, not software-verified.
  Code can react only to an observable stop/revocation, expiry or other failure;
  unnoticed absence is an acknowledged residual risk. Stopping the process does
  not cancel an accepted order; the supervising operator retains the handoff.
- Not selected: require a fresh explicit human confirmation before each possible
  submit. This is a new interaction to design and test, not a default polling
  monitor or new authorization; it still does not prove continuous physical
  presence. Fresh observation and approval checks must be rerun within their
  existing bounds after any wait, or the attempt aborts without retry.

The direct human answer resolves the choice in favor of existing attestations,
direct supervision and manual stop. Section 6 now states its truthful limits and
the proposed stop behavior. No other consequential question was returned by the
independent builder check. Parent-owned path, budget and schema-reach checks are
separate from that review; this closure is not a second independent review of
new implementation, because no implementation occurred.

Hand this updated written design to the operator for review. Do not ask the
attendance question again. The full written-design acceptance and subsequent
offline implementation/runtime authorities remain distinct and ungranted.
