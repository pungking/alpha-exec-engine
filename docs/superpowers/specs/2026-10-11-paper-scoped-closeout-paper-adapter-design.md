# PAPER scoped closeout adapter integration

Goal: PAPER_SCOPED_CLOSEOUT_PAPER_ADAPTER_INTEGRATION_V1
Baseline: c9cf075c46a78331c11479374cb213ac53ee714d
Status: ACCEPTED_FOR_IMPLEMENTATION_PLANNING
The user requested proceeding with the next planned work after withdrawing the
obsolete missing-input goal. The implementation plan still requires review before
product edits. Neither design nor plan approval authorizes runtime execution.

## 1. Intent and completion boundary

The user's destination is automated analysis, entry, fill verification, protective
orders, holding management, exit, reconciliation and notification within an
explicitly approved account, policy, risk budget and operating period. Approval of
that bounded operating policy must not be confused with manual approval of every
normal strategy trade. Autonomous operation does not mean unconditional orders.

This goal supplies the PAPER adapter for the already implemented scoped management
controller. The historical five-position cleanup is an exceptional authority, not
the normal strategy entry signal or the architecture for all future trading.
The adapter must have a callable application interface, not a human-only series
of shell steps. Its first operational invocation remains separately authorized;
no recurring hook is installed or enabled in this goal.

The normal automatic lifecycle is the next, separate integration: it must consume
canonical Stage6 and reuse existing entry/protection/lifecycle helpers after their
contracts pass. Do not route general buying, scale-in or stop changes through the
five-row management authority. Do not add speculative generic interfaces now.

Implementation acceptance means an adapter, actual REST-shaped fixture mapping,
durable temporary-store integration, negative safety tests, independent review and
CI are complete. It does NOT certify data entitlement, current account/state,
exclusive account operation, broker fills, or profitable automatic trading.

No broker/provider/Telegram requests, credentials read, production state writes,
cache operations, workflow dispatch/rerun, execution-variable changes, LIVE access,
Stage6/OOS changes or historical normalization are authorized for this work.
Official documentation and Git/CI metadata are development references, not broker
requests. Tests use fake transport, fake credentials and disposable private state.

## 2. Existing code and alternatives

Reuse these boundaries:

| Existing implementation | Role in integration |
| --- | --- |
| scripts/lib/scoped-closeout-contract.mjs | Pure phased controller, exact terms, budgets and sticky stop |
| scripts/lib/scoped-closeout-storage.mjs | Five reservations, attempt persistence, observations and parity |
| src/order-state-storage.ts | Local writer fence, CAS, durable atomic single-file writes |
| src/order-ledger-storage.ts / src/order-idempotency-storage.ts | Strict legacy and management variants |
| src/scoped-management-record.ts | Management history validation, never strategy ownership |
| scripts/capture-paper-private-evidence.mjs | Bounded complete-body parsing, hashing and sanitized errors |
| scripts/lib/closeout-decimal.mjs | Exact decimal arithmetic |
| scripts/paper-order-notifications.mjs | Event classification and delivery receipt deduplication |

Chosen: a small scoped PAPER adapter on one durable execution host, invoking the
existing controller and stores. The host is not assumed to be the future DGX;
it must be available for the bounded attempt and resting-order oversight.

Rejected alternatives:
- Relax the generic submission block: broadens authority and can route cleanup
  through market exits and strategy-history assumptions.
- Use Actions caches as the transaction store: cache snapshots and separate job
  concurrency groups do not provide durable, account-wide single-writer ordering.
- Build another execution engine/framework: duplicates existing state and guards.

The existing generic fetchAlpacaJson in src/index.ts is not directly reusable:
it permits environment URL overrides, lacks this complete-body deadline/size
contract and includes response excerpts in errors. Do not export it unchanged.
Extract only the bounded transport primitive from the private capture code if
that reduces duplication; preserve the old capture contract and its tests.

## 3. Authority and compatibility

Keep the existing synthetic v1 input and tests unchanged. Never relabel real
observations as SYNTHETIC or set SYNTHETIC_VERIFIED to bypass validation.

Add an explicit versioned observed-PAPER input at the adapter/controller boundary.
Shared policy and phase transitions remain in the existing controller; there is
no second state machine. Observed inputs bind exact source/terms/code hashes,
account scope, five identities, session, submission expiry, pre-write hashes,
receipt provenance and approved management authority.

Validation must separate three things:
1. A pure policy decision/proposal, which cannot authorize a network side effect.
2. Verified observations and durable reservations for the exact proposed action.
3. The actual process execution gate plus direct current-scope operator approval.

The adapter evaluates actual safe flags; it cannot pass fake safe values to a
controller while mutating in another process. READ_ONLY=true or EXEC_ENABLED=false
blocks every broker mutation, even with valid terms. Defaults stay unchanged;
LIVE_ORDER_SUBMIT_ENABLED remains false and LIVE origins are unconditionally denied.
No approval embedded in an artifact, model response, environment default or old
run is sufficient. Missing scope, expiry, account pin or required operator approval
fails before credential use/network. Exact approval rules in AGENTS.md remain binding.

Management records retain brokerSubmitAllowed=false: a stored record is not an
authorization token. Runtime receipts separately report actual attempts/outcomes;
they must never copy inert-model safety booleans to conceal a performed mutation.
Original ownership, history normalization and strategy realized-PnL remain false.

Hash bases must be named. Scoped account identity uses the existing canonical
PAPER/account-id basis used by notifications. The older capture account pin has a
different raw-id basis: validate each against the same actual account ID; never
compare different bases as if equal, or rewrite historical manifests.

## 4. Transport, identity and source mapping

Proposed implementation surface: one scoped adapter module under scripts/lib and
a thin standalone entry point for explicit invocation, plus tests/fixtures.
No import-time I/O, default credential loading, URL override or automatic scheduler
hook. The application function accepts validated configuration and dependencies;
production wiring and test substitutes are distinct and cannot silently fall back.
The default invocation is configuration validation only: no credentials, network,
production-store writes or notifications. A configured PAPER URL alone authorizes
neither read requests nor submission; both require the invocation's explicit scope.

Only these origins are eligible in a future authorized invocation:
- https://paper-api.alpaca.markets
- https://data.alpaca.markets

Method/path/group allowlists are fixed, query values encoded and kept private.
Reject redirects and unapproved proxy/dispatcher overrides. Count immediately
before each dispatch, including failures. No SDK retry, pagination or implicit
feed/endpoint fallback. Enforce the deadline across headers AND complete body;
abort/cancel pending reads on failure, bound bytes, then hash complete bytes before
strict JSON/schema validation. Never publish response excerpts or request URLs
containing private identities. Incomplete bodies have no complete-response hash.

Required mapping rules:
- Account: exact pinned ID, PAPER origin and usable/restriction status. A hash is
  not proof of account type or current account authorization.
- Positions: immutable asset ID, signed side and exact decimal quantity. Bind a
  routing symbol only through that asset evidence. Never symbol-only ownership.
- Orders: complete unfiltered open-order set with nested children; unknown shape,
  limit reached, pagination hints, unknown identity or any open-order conflict
  blocks. Do not omit an unsupported order to produce an empty list.
- Clock/calendar: existing v2 is_open contract, exact approved New York session,
  DST/early close and verified time basis. No v3 fallback or local-time assumption.
- Quotes: explicit SIP/USD, exact requested set, provider timestamp and proven size
  units. No IEX/delayed fallback, receipt-time substitution or universal x100 rule.
- Asset metadata: exact immutable ID, supported class, tradability and quantity/
  price increments. Tradability alone does not prove absence of a trading halt.
- Risk: existing applicable account/loss/exposure/liquidity/volatility/event rules
  or individually reviewed management-only exceptions. Missing inputs block; no
  blanket riskStatus=PASS because selling is described as risk reducing.
- Response status: map actual order states explicitly; unknown/pending states
  cannot become filled. Accepted, partial, filled and flat are distinct outcomes.

Provider timestamp precision must not hide a future timestamp by truncating it.
Validate full source precision and preserve its hash before any documented
millisecond projection for compatibility. Invalid precision/clock alignment blocks.
Preserve exact decimal quantities; no floating-point truncation to fit the terms.

Current verified public documentation does not establish every required binding.
These are explicit runtime blockers, not fields a mapper may fabricate:

| Required proof | Decision when unavailable |
| --- | --- |
| SIP entitlement for this account | FEED_ENTITLEMENT_UNVERIFIED; no silent fallback |
| REST quote-size units and instrument conversion | QUOTE_SIZE_CONTRACT_UNVERIFIED |
| Current halt status with actual source provenance | HALT_EVIDENCE_UNAVAILABLE |
| Current clock alignment and session | CLOCK_ALIGNMENT_UNVERIFIED |
| Required risk configuration/current evidence | RISK_EVIDENCE_INCOMPLETE |

The quoted REST endpoint and asset flag do not, from the documentation reviewed,
prove all five conditions. Alpaca documents a separate trading-status stream.
Do not add a WebSocket, extra GET, subscription purchase or risk waiver inside
this unchanged budget. First resolve source semantics from documentation/existing
evidence; if an additional source is necessary, report that precise scope change
for approval. Static integration must not be reported as operationally ready while
any required source binding is missing.

References reviewed 2026-10-11 (public documentation, no account access):
- https://docs.alpaca.markets/us/reference/stocklatestquotes-1
- https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data

## 5. Durable ownership and effect execution

Use existing strict PAPER stores and the directory fence, no new ledger/database.
The operator must identify and approve the exact durable directory before runtime.
If it is an adopted historical management baseline, label it as such; it is NOT
proof of current sidecar-state authenticity. Do not copy/adopt/restore it now.

The local fence excludes cooperating local writers only. GitHub jobs, another host
and manual account actions require operational exclusion for the attempt. A JSON
writersDisabled=true value or two unrelated concurrency groups is not proof.
Runtime readiness requires a reviewed, scoped operational exclusion record and
enforced local ownership. Code cannot certify that an unknown external account
writer does not exist. No writer pause/credential change is performed by this goal.

Sequence for a separately authorized invocation:
1. Validate code/terms/source pins, authority, durable directory and all prerequisites.
   Acquire exclusive attempt/writer ownership before network. Existing attempts
   cannot be erased or resumed by changing the attempt ID.
2. Read/validate pinned account before the remaining bounded initial observations.
   All five identities, unscoped portfolio and source/risk evidence must pass.
3. Backup and fsync both stores, reserve all five new exit actions, reread parity.
   Old records and original entry keys remain untouched.
4. Revalidate just-in-time, persist the exact ATTEMPTED request intent/price/evidence
   in both stores, verify parity, then independently recheck the actual submit gate.
5. Dispatch at most one SELL LIMIT DAY for the exact full quantity; no buy, short,
   cancel, replace, reprice, bracket/protective-child mutation or market fallback.
6. Persist the outcome before the bounded post-check. A lost response remains
   MAY_HAVE_SUBMITTED. Lookup is for reconciliation, never authority to resend.
7. Full fill plus current flat position/no orders and durable parity can establish
   MANAGEMENT_FLAT_RECONCILED, never verified original strategy ownership/PnL.
8. Any partial fill, rejection, uncertainty, storage failure or unresolved order
   stops later submissions. Preserve observations, reservations, backups and locks
   where required. Code rollback must never restore pre-fill state.

Five-row preflight is all-or-nothing; five broker orders cannot be atomic together.
Two store writes are not a cross-file transaction. Preserve this distinction in
reports. Do not optimistically reduce holdings by submitted quantity.

The callable runner consumes controller effects only once, validates the exact
serialized broker payload against its persisted intent and routing asset binding,
and binds its wire-body digest to the private receipt. Intent and wire hashes use
different explicitly named bases; do not claim they are equal.

## 6. Bounded contract and notifications

The existing model ceiling is retained, not authorized for use now:

| Group | Maximum |
| --- | ---: |
| account GET | 6 |
| positions GET | 11 |
| open-orders GET | 11 |
| clock GET | 11 |
| calendar GET | 1 |
| assets GET | 10 |
| by-client-order-id GET | 5 |
| quotes GET | 6 |
| new-order POST | 5 |

GET<=61, POST<=5, total<=66; retry=0, pagination=0, PATCH/DELETE=0.
Complete request<=3 seconds, response<=8 MiB, attempt<=300 seconds; post-check
starts within 2 seconds of submit outcome, with the current 17-second reserve.
Evidence age<=30 seconds and spread/adverse price bounds remain the adopted 10 bps
offline terms. Dollar caps/quantities are private, explicitly pinned, never invented.

The 300-second attempt cap does not extend the 30-second freshness of initial-only
observations such as calendar evidence. If a necessary observation expires within
the allowed request budget, stop; no refresh loop is implied. Performance testing
must show this rather than claim all five always complete within the window.

Orders are DAY and may remain accepted after submission authority expires. A future
execution approval must accept that lifecycle and specify oversight; no hidden
cancellation authority is added. One bounded post-check is not continuous monitoring.

Use existing notification classification/dedup receipts. Notify acceptance, partial,
fill, management flat and stop distinctly; protect the private destination. Existing
maximum event allowance is 21, actual sending still separately scoped. A send
failure never repeats an order or falsely reports successful delivery. Public output
contains only allowlisted counts/statuses/hash bases/SHA-256 values.

## 7. Implementation reach and verification

Allowed reach after written-spec and plan approval:
- scoped controller: additive versioned observed-input validation, shared transitions;
- small adapter/entry point: allowlisted transport, source mapping, effect dispatcher;
- existing bounded capture helper only if extraction is smaller than duplication;
- strict store/management validator only if integration proves a necessary change;
- notifications only for exact management outcome compatibility;
- synthetic REST fixtures, adapter integration tests, package scripts, safety CI;
- compatibility and operational activation/rollback documentation.

Do not change generic Stage6 execution policy, recurring workflows, historical
private evidence, dependency lockfiles or other repositories. Preserve the old
capture behavior and synthetic controller tests; no broad index.ts refactor.

Required test groups:
1. Safe/default modes, missing/expired/wrong-scope authority, LIVE/redirect/proxy
   rejection, unknown path/method, import has no side effects, no real network.
2. Raw REST-shape mapping: account/hash bases, asset identity/rename, exact quantities,
   open nested orders, truncation, clock versions/DST/early close, source precision,
   feed/size/halt/risk unavailable, payload-to-intent binding and redaction.
3. Budgets including failed calls, full-body timeout/oversize/incomplete JSON,
   strict freshness, no fallback/retry/pagination, no unauthorized parallel POST.
4. Five reservations, parity before POST, local competing writer, crash at each
   store boundary, crash around POST, ambiguous response/404, sticky batch stop.
5. Accepted versus partial/full, terminal partial, post-check failure preserves fill,
   no optimistic holdings/PnL, later target rejection and repeated invocation denial.
6. Five-row successful fake-transport integration with actual disposable stores,
   notification failure/dedup and current generic consumer regression suites.

Run existing scoped-closeout, both storage, order-state consistency, exit-liveness,
realized-PnL, live-readiness, protection, migration, private capture/audit, notification,
dry-run safety, symbol-agnostic, Telegram routing, typecheck/build and related CI.
Use network denial around offline tests. Static documentation checks do not replace
these tests. No provider calls are part of testing, and no historic evidence is
redownloaded. Implement failing fixtures first and obtain independent code review.

## 8. Finite resumption gates

| Work | Earliest legitimate resumption | What it cannot prove |
| --- | --- | --- |
| This adapter implementation | Written spec and implementation-plan review complete; no RTH wait | Actual account/feed/order readiness |
| Five-position PAPER management | Merged adapter/CI, source and risk bindings, durable authority/exclusion, fresh same-invocation RTH evidence and exact execution approval | Original entry history or verified strategy PnL |
| Normal autonomous PAPER closed loop | Management/account safety reconciled; canonical Stage6 to existing lifecycle connected and activation separately approved | LIVE profitability or OOS sample sufficiency |
| Missing-original-input historical goal | Authentic original evidence recovered and verified | A new GET, later fill or cleanup cannot retroactively complete it |

The preserved first-bundle followup has status PENDING_AUTOMATIC_BOUND_BUNDLE.
It is a historical result, not a fresh assertion that no suitable run exists today.
Do not repeat its one-shot download or use it as permission to query again.

No calendar completion date is supported yet. Static work begins without a market
session. The earliest runtime opportunity is the first eligible RTH invocation
AFTER its gates pass, not an unconditional promise about the next session. When a
gate fails, report one dominant blocker plus known dependent requirements; do not
hide remaining requirements and rediscover them through repeated diagnostic goals.

Required final status must distinguish SPEC_READY, ADAPTER_STATIC_INTEGRATED,
RUNTIME_PREREQUISITES_UNVERIFIED and PAPER_RUNTIME_VERIFIED. Never collapse these
into an unqualified complete or live-ready label. No runtime activation or actual
order approval phrase is supplied by this document.
