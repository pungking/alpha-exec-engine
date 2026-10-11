# PAPER Scoped Closeout Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Native execution, or superpowers:subagent-driven-development if selected. Implement task-by-task using the checkbox steps below.

**Goal:** Bind the existing scoped management controller to a fail-closed PAPER adapter with REST-shaped offline integration tests, without activating it or certifying historical ownership.

**Architecture:** Reuse the pure controller, durable stores and notification receipts. Add narrow transport and evidence mapping beside a callable adapter and thin configuration-only CLI. Keep exceptional five-row cleanup separate from the later normal Stage6-driven automatic lifecycle.

**Tech Stack:** Node.js 20+, existing JavaScript ES modules/TypeScript validators, built-in fetch/crypto/fs, existing assert fixtures. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-paper-scoped-closeout-paper-adapter-design.md`

**Status:** PLAN_REVIEW_REQUIRED. No task is implemented by this plan.

## Global Constraints

- alpha-exec-engine only; baseline c9cf075c46a78331c11479374cb213ac53ee714d.
- Safe defaults: READ_ONLY=true, EXEC_ENABLED=false, LIVE_ORDER_SUBMIT_ENABLED=false, MARKET_GUARD_MODE=observe.
- Actual broker/provider/Telegram calls, production state/cache writes, runtime dispatch and execution-variable changes=0 during implementation.
- Five scoped positive positions, SELL LIMIT DAY, full exact quantities, no entry/scale-in/short/protective-child mutation.
- GET<=61, POST<=5, total<=66; retry=0, pagination=0, PATCH/DELETE=0.
- Complete request<=3 seconds; response<=8 MiB; attempt<=300 seconds; post-check starts<=2 seconds after outcome; reserve>=17 seconds.
- Evidence age<=30 seconds; spread<=10 bps; adverse-price bound<=10 bps; private per-row/total caps remain pinned, never invented.
- SIP/USD explicitly selected; no delayed/IEX fallback, fabricated source proof or HTTP/local-time substitution.
- Historical evidence, original keys and strict generic consumer blocks are preserved. Records do not authorize execution.
- The old PAPER_PRIVATE_CLOSEOUT_INPUT_PREPARATION_V1 is WITHDRAWN_BY_USER_NOT_COMPLETED, not a prerequisite. Preserve its evidence; no replacement can certify its missing original report.
- All product steps remain unchecked until actual red/green verification. No runtime activation approval is issued here.

## Review Focus

1. Response arrives before timeout but body stalls: abort the entire response and never hash partial bytes (Task 1).
2. Nanosecond timestamp is future within the local millisecond: reject before truncation, never convert it into fresh evidence (Task 2).
3. Account pins use different historical hash bases: validate named bases against one account ID, never silently rehash preserved inputs (Tasks 2/3).
4. Crash after ATTEMPTED but before known socket completion: preserve may-have-submitted state and refuse a second attempt ID/client ID (Task 4).
5. First notification observation is baselined and suppresses a new fill: establish an empty scoped-action baseline before execution; never label a partial account snapshot complete (Task 5).

## File Map

| File | Responsibility |
| --- | --- |
| scripts/lib/scoped-paper-transport.mjs (new) | Fixed route groups, bounded response receipts, physical request counts |
| scripts/lib/scoped-paper-evidence.mjs (new) | Exact REST identity/time/decimal/provenance mapping and dependency rejection |
| scripts/lib/scoped-closeout-contract.mjs | Versioned observed input; same phased controller, synthetic v1 retained |
| scripts/lib/scoped-paper-adapter.mjs (new) | Config/authority gate, callable effect dispatcher, existing store composition |
| scripts/run-scoped-paper-closeout.mjs (new) | Thin configuration-only default entry point; no import-time effects |
| scripts/lib/scoped-closeout-storage.mjs | Existing transaction receipts; change only if the integrated tests prove a gap |
| scripts/paper-order-notifications.mjs | Scoped-event snapshot adapter reusing validation, formatter and delivery receipt |
| scripts/fixtures/scoped-paper-adapter.mjs (new) | Synthetic REST bodies, fake transport, fixed time, temporary state inputs |
| scripts/test-scoped-paper-{transport,evidence,adapter}.mjs (new) | Independent safety and end-to-end fixture suites |
| scripts/test-paper-order-notifications.mjs | Scoped baseline, partial-stream and event dedup regression |
| package.json / .github/workflows/ci.yml | Offline test commands and existing CI integration only |

No changes to runtime scheduling, src/index.ts order semantics, Stage6 or other repos.
Do not export the generic unbounded fetchAlpacaJson or call capturePrivateEvidence
as an adapter: it has a different scope/budget. Reuse the bounded complete-body
handling pattern from capture, not its private-source workflow. Extract a shared
body reader only if this is smaller and preserves all existing capture diagnostics;
otherwise keep the narrow transport local rather than add generic options.

## Shared Interface Decisions

These are proposed internal interfaces, not provider response field names.

- `clock = { now(): string, monotonicMs(): number }`; real invocation uses the local
  clock plus independently validated source alignment, tests use a fixed clock.
- `scope`: a deeply frozen validated five-row input, with explicit named hash bases.
- `Receipt`: `{group, phase, status, complete, bytes, responseSha256, requestedAt,
  retrievedAt, durationMs, data}`; data remains private/in-memory. Incomplete
  responseSha256 is null, not a hash labeled as a complete response.
- `DependencyReport`: `{status, reasons, evidenceHashes}`; reasons contain fixed
  codes, no private values. PASS is derived from documented source bindings and
  actual validated evidence, never accepted as a caller's boolean.
- `InvocationApproval`: direct scoped execution authority supplied through the
  explicit invocation, with code/terms/source/account/session/state pins, endpoint
  budget, expiry, writer exclusion and resting-DAY acknowledgement. User evidence
  JSON or a hash alone cannot create it; repository approval rules still apply.
- `RunResult`: allowlisted `{status, reasons, requestCounts, requestBudgetCompliant,
  rowStatusCounts, hashes, actualBrokerMutationAttempted, actualStateWriteAttempted,
  originalHistoryNormalized:false, realizedPnlVerified:false}`. Private row detail
  is written only to the explicitly authorized owner-only destination at runtime.

### Task 1: Bounded PAPER Transport

**Files:** Create transport module, transport test and shared REST fixture listed above.

**Interfaces:**
- Produces `createScopedPaperTransport({credentials, fetchImpl, clock, deadlineMs})`.
- Returns `{request({group, phase, routeInput, body}), counts()}`. Only compiled
  allowlisted routes are accepted; routeInput carries exact validated scope values,
  never an arbitrary URL. The adapter supplies credentials after its gate passes.
- `request` returns Receipt or a sanitized failure receipt; counts is a frozen copy.
  Transport-level POST support is not execution authorization.

- [ ] **1. Write failing assertions** in `scripts/test-scoped-paper-transport.mjs`:
  fake fetch is called once for a valid group; redirect/LIVE/arbitrary path/method
  invokes it zero times; failed calls count once; over-budget calls invoke it zero
  times; incomplete/oversized bodies have no complete hash; no retry.
- [ ] **2. Verify red:** `node scripts/test-scoped-paper-transport.mjs` fails because
  the new transport export does not exist. Capture only synthetic/sanitized output.
- [ ] **3. Implement** route mapping for account, positions, nested open orders
  limit=500, v2 clock, exact-session calendar, exact assets, exact-client lookup,
  latest quotes feed=sip/currency=USD and new SELL LIMIT DAY orders. Count before
  dispatch, reject redirects/proxy overrides, apply full-body deadline and byte cap.
  Keep schema/identity validation in Task 2; never include raw errors/URLs publicly.
- [ ] **4. Add body-stall and clock tests:** headers arrive at 1 ms but the body
  stalls beyond 3000 ms => stopped; 8388609 bytes => stopped; valid 8388608-byte
  bounded response is allowed by size only. Backward wall clock or monotonic time
  invalidates the receipt. Aborted parallel reads cannot continue into POST.
- [ ] **5. Verify green:** run the transport test and existing
  `npm run ops:test:paper-private-evidence-capture` under the network-denial preload.
- [ ] **6. Commit** only transport/fixture/test changes, plus capture files only
  if the documented optional body-reader extraction was necessary.

### Task 2: Exact REST Evidence Mapping

**Files:** Create evidence module and evidence test; extend shared REST fixture.

**Interfaces:**
- Consumes Receipt and scope from Task 1/shared decisions.
- Produces `assessSourceBindings(bindings, scope, clock): DependencyReport`;
  `mapPreflightEvidence({scope, receipts, bindings, clock, committed})`;
  `mapOrderObservation({scope, record, receipt})`;
  `mapPostcheckEvidence({scope, receipts, bindings, clock, committed})`.
- Mapped evidence retains receipt-group hashes and exact asset/quantity lineage;
  it cannot turn unknown source semantics into synthetic-verified flags.

- [ ] **1. Write failing tests** for exact immutable asset mapping, renamed symbol
  with same proven asset, symbol-only mismatch rejection, duplicate asset rejection,
  signed quantity mismatch, nested children, 500-row truncation and missing orders.
- [ ] **2. Verify red:** `node scripts/test-scoped-paper-evidence.mjs` fails on the
  missing evidence exports, then record that failure without provider calls.
- [ ] **3. Implement mapping** using existing decimal/hash helpers. Validate account
  raw-id and canonical PAPER/account hash bases explicitly. Preserve source decimal
  precision; unsupported precision fails rather than rounds quantity or infers IDs.
  Quote symbols must bind to the requested immutable asset set, not arbitrary rows.
- [ ] **4. Add source/time tests:** future sub-millisecond quote rejected; missing
  SIP entitlement/size conversion/halt/risk proof produces the specific spec code;
  no universal x100 conversion; no tradable=>NOT_HALTED promotion; wrong clock
  version, holiday/closed/DST/early-close mismatch or stale receipt fails closed.
- [ ] **5. Verify green:** new evidence suite plus existing private closeout audit
  and private capture fixture. Verify no synthetic proof is emitted for real input.
- [ ] **6. Commit** evidence module and its synthetic fixtures/tests only.

### Task 3: Observed Controller Input and Invocation Gate

**Files:** Modify scoped controller; begin adapter module and adapter tests.

**Interfaces:**
- Keep `validateScopedCloseoutInput(v1)` and current synthetic behavior intact.
- Add `validateObservedCloseoutInput(v2, invocationCapability)` returning a branded
  immutable scope for the same `createScopedCloseoutState/advanceScopedCloseout`.
- Add `validateScopedPaperConfiguration(config): DependencyReport` and
  `authorizeScopedPaperInvocation({config, approval, clock})` in the existing
  controller module and re-export them from the adapter. Keep capability issuance
  and validation together to avoid a circular adapter/controller dependency.
  The latter returns an in-process capability, not serializable approval evidence.
  It binds reviewed terms/source configuration and actual invocation authority;
  it does not certify fresh broker observations. Task 2 maps those receipts only
  after the scope is created and the bounded initial reads complete. The controller
  still requires fresh observed preflight before any submit effect.
- Observed v2 uses `schemaVersion:2`, `environment:PAPER`,
  `evidenceMode:PAPER_OBSERVED`, actual process flags, explicit management authority
  and named source bindings. Unknown fields or inconsistent hashes fail closed.

- [ ] **1. Write failing fixtures:** unchanged v1 still works; observed v2 cannot
  use SYNTHETIC_ONLY authority; deserialized/forged invocationCapability is rejected;
  missing approval, default safe flags, LIVE origin, changed scope/code/session,
  unverified writer exclusion or source dependency => mutation capability absent.
- [ ] **2. Verify red:** `node scripts/test-scoped-paper-adapter.mjs` fails at the
  missing authorization/observed-scope exports, not at a production side effect.
- [ ] **3. Implement additive versioned validation** and the explicit invocation
  gate. Share policy/transition code; do not implement a second execution state
  machine or relabel observed evidence as synthetic. Records remain non-authorizing.
  Configuration-only validation never reads credentials or writes stores.
- [ ] **4. Add regressions:** observed input with fake safe flags cannot be used by
  an executing process; old raw-id account pin cannot be silently converted;
  stale source receipt cannot be replaced by a caller boolean or generatedAt.
- [ ] **5. Verify green:** adapter gate fixtures plus the entire existing
  `npm run ops:test:scoped-closeout-contract` suite, with network denied.
- [ ] **6. Commit** only the controller/gate and related fixtures.

### Task 4: Durable Effect Dispatcher and Callable Runner

**Files:** Complete adapter and adapter tests; touch scoped storage only for a
test-proven integration defect, not a refactor.

**Interfaces:**
- Produces `runScopedPaperCloseout({config, approval, transport, clock, notify})`.
- Returns RunResult and executes the existing controller effects through Task 1
  transport, Task 2 mapping and existing `withScopedStores/reserveScopedExits/
  recordScopedAttempt/recordScopedObservation` interfaces.
- Real composition supplies explicit dependencies only after Task 3's gate;
  tests supply fakes. No implicit process.env/global fetch/default state directory.

- [ ] **1. Write failing integration** with five REST-shaped scoped assets and
  actual temporary stores: verify both ATTEMPTED receipts exist before each fake
  POST, exact intent/wire payload binding, five fully reconciled outcomes, total
  fake GET<=61/POST<=5, unchanged original record hashes and no real network.
- [ ] **2. Verify red:** adapter runner test fails at the missing runner export.
- [ ] **3. Implement one effect dispatcher**: exclusive ownership/attempt check,
  account-first read, all-five preflight, backup/reserve, just-in-time checks,
  durable ATTEMPTED, one submit and bounded lookup-first post-check. Map source
  expiry to STOPPED, never an extra refresh. Track physical counts separately
  from controller-planned counts; public request counts describe physical calls.
- [ ] **4. Add crash cases** before/after each two-store write and before/after
  dispatch: rejected/partial/uncertain outcomes never resume later targets;
  a changed attempt ID cannot bypass an existing management attempt. A verified
  lookup fill survives a later positions/clock error. Budget/deadline exhaustion
  preserves uncertainty and never resends on a 404.
- [ ] **5. Add concurrency/immutability tests:** cooperating writer denied, hash
  drift before POST denied, caller mutation after validation cannot change scope,
  unknown external writer proof blocks, no submitted-quantity holdings reduction.
- [ ] **6. Verify green:** new adapter suite plus both store suites, scoped
  consumers, order-state consistency and realized-PnL regressions; then commit.

### Task 5: Scoped Notifications and Safe Entry Point

**Files:** Add CLI; minimally extend existing notification module/test and adapter.

**Interfaces:**
- Add `buildScopedNotificationSnapshot({scope, records, storeReceipt, observations,
  sourceRunId, headSha, observedAt})` in the notification module, producing the
  existing delivery snapshot schema from this scope only, not an invented complete
  account closed-order history. Reuse strict records, event keys and formatter.
- Existing `deliverNotifications({snapshot, receiptPath, send})` remains unchanged
  unless a failing fixture proves a required compatible fix.
- Add an explicit scoped observation basis to the snapshot and formatter. A
  `SCOPED_CLOSEOUT_STOPPED` scope-level event carries a scope hash and fixed reason
  code, not an invented symbol/side or a complete account-history assertion.
  Existing periodic snapshot validation and wording remain backward compatible.
- CLI exports `main(argv, dependencies)` and executes only behind its existing-style
  direct-invocation check. No arguments => configuration-only result. Explicit
  runtime mode still requires the full invocation gate; no secret values in args.

- [ ] **1. Write failing tests:** import/default CLI performs zero fetch, credential
  reads, store writes and sends; no scheduling or automatic execute fallback.
  First scoped accepted/fill event is not swallowed as a baseline; duplicate event
  sends zero; unknown delivery does not resend; private markers absent in stdout;
  scope-level stop is accepted without a fake position and its message identifies
  bounded scoped observation rather than periodic account-wide collection.
- [ ] **2. Verify red:** new CLI/scoped-notification fixtures fail on missing exports.
- [ ] **3. Implement scoped event mapping** and establish the empty new-action
  notification baseline before any submit using existing owner-only receipts.
  Preserve distinct accepted/partial/filled/management-flat/stop meanings; never
  promote strategy PnL. Dispatch at most 21 approved event notifications; missing
  destination authority means no send. Notification failure cannot replay orders
  or suppress durable outcome recording. Do not add unbudgeted closed-order GETs.
- [ ] **4. Implement thin CLI composition** with default validation only and no
  runtime-workflow hook. Configuration output is counts/statuses/hash bases only.
  Missing source proof blocks rather than activating a broad environment override.
- [ ] **5. Verify green:** CLI adapter tests, notification fixtures and Telegram
  routing guard with fake senders and network denied; commit the minimal changes.

### Task 6: Full Verification, Review and Integration

**Files:** package.json, .github/workflows/ci.yml, operational compatibility notes
in the spec; no runtime workflows or environment variables.

**Interfaces:**
- New `ops:test:scoped-paper-adapter` builds existing TS validators and runs the
  three new suites. Existing scoped-closeout command and legacy tests remain.
- CI executes offline suites only; it is not a scoped runtime invocation.

- [ ] **1. Add the package command and CI invocation** after the shared validator
  build, then verify the negative network-denial fixture rejects accidental fetch.
- [ ] **2. Run** new adapter suite, scoped-closeout, both storage suites,
  order-state-consistency, paper-exit-liveness, paper-realized-pnl,
  live-readiness-blockers, protection-lanes/protection-report, migration apply/
  package/public-evidence, private closeout/capture, paper-order-notifications,
  dry-run-dispatch-safety, symbol-agnostic and Telegram-routing checks.
  Use the exact regression commands below; all must exit 0. Do not substitute
  previous-run results or allow a failure to fall through to the next command.
- [ ] **3. Run** `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`
  and `git diff --check`. Audit may use the package advisory service, not a broker
  or paid provider. No dependency upgrades are included to fix unrelated findings.
- [ ] **4. Obtain one fresh independent whole-branch review**, fix reproducible
  defects with red/green tests and repeat affected/full checks as appropriate.
- [ ] **5. Commit/non-force push and create a main PR**, attach it to this chat,
  document safety/schema/compatibility/rollback, and merge only after relevant CI
  succeeds. No manual runtime workflow is dispatched to substitute for CI.
- [ ] **6. Record final code/CI evidence** and the exact runtime dependency status.
  ADAPTER_STATIC_INTEGRATED is not PAPER_RUNTIME_VERIFIED. If halt/quote-size/risk/
  state authority remains unavailable, list it explicitly; no readiness promotion.

Exact Task 6 offline regression sequence (network-denial preload active):

```bash
set -e
for check in \
  ops:test:scoped-paper-adapter ops:test:scoped-closeout-contract \
  ops:test:order-idempotency-storage ops:test:order-ledger-storage \
  ops:test:order-state-consistency ops:test:paper-exit-liveness \
  ops:test:paper-realized-pnl ops:test:live-readiness-blockers \
  ops:test:protection-lanes ops:test:protection-report \
  ops:test:ledger-filled-migration-apply \
  ops:test:ledger-terminalization-migration-package \
  ops:test:ledger-filled-migration-public-evidence \
  ops:test:paper-closeout-private-evidence ops:test:paper-private-evidence-capture \
  ops:test:paper-order-notifications ops:test:dry-run-dispatch-safety \
  ops:safety:symbol-agnostic ops:safety:telegram-routing typecheck build
do
  npm run "$check"
done
```

The advisory-only `npm audit --audit-level=high` in Step 3 runs separately from
the network-denied regression process; it must never load broker credentials.

## Plan Review and Resumption

Recommend Native execution with one fresh independent review at the end: tasks
share tight controller/transport/store interfaces, so separate implementers add
handoff cost without eliminating the need for whole-path review. Preserve the
user's prior preference if confirmed for this plan. No product task starts until
the user reviews this written plan and selects/confirms its execution method.

Static implementation requires no natural analysis or market session. Actual
closeout needs its own scope approval and current evidence within the eligible
RTH invocation. Normal autonomous strategy activation is a separate approved
operating policy, not a manual approval prompt for every routine trade.

The historical missing-input goal does not return as a dependency. Its exact
original report, if independently recovered later, may support a separately
requested historical audit; it cannot be fabricated by this implementation.

## Self-Review Map

Spec sections 1-3 -> Tasks 3/4/6 (automatic-callable boundary, authority/versioning).
Spec section 4 -> Tasks 1/2/3 (transport, source mapping, unavailable proof).
Spec section 5 -> Task 4 (durability, writer exclusion, uncertainty).
Spec section 6 -> Tasks 1/4/5 (budgets, timing, notifications).
Spec section 7 -> all tasks and Task 6 regression/review/CI.
Spec section 8 -> Task 6 and Plan Review and Resumption (honest completion gates).
All five Review Focus risks have explicitly owned fixtures above.
