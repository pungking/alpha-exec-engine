# Attended PAPER Lifecycle Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect authentic non-halt evidence, purpose-bound readiness, the existing PAPER adapter, durable observation and aggregate notification for the exact five-row attended lifecycle test, without certifying production readiness.

**Architecture:** Extend the existing controller, opaque capabilities, sealed transport receipts and paired stores; do not add another execution engine. Keep the old full-source route unchanged. The new route records external halt coverage as NOT_VERIFIED, while validating all remaining risk, timing, identity and operational controls.

**Tech Stack:** Existing Node.js 20 ESM, TypeScript strict storage validators, node:assert, node:crypto and existing exact-decimal helpers. No dependency additions.

**Spec:** `docs/superpowers/specs/2026-10-24-attended-paper-lifecycle-validation-design.md`

**Execution method:** Native, approved for offline implementation, validation, independent review and PR/CI/merge. Use executing-plans, with one fresh whole-branch implementation review at the end. Runtime authorization is separate; the later source-collection and interval amendments have their own narrower approval boundaries below.

**Baseline:** `688fb2b0646b0ba450662c53c5f2d5eb60ab181a`, branch `codex/paper-operational-binding-design`, worktree `/Users/givet-bsm/Documents/GitHub/.worktrees/alpha-exec-engine/complete-private-evidence-capture`.

**Parent:** `PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1`. The source-qualified parent remains incomplete; this plan does not replace its completion criteria or the historical missing-original-evidence goals.

## Global Constraints

- Approved offline implementation may proceed; runtime, state adoption and orders remain NOT_AUTHORIZED. A new original-source collector is not included in this approval. No push or CI dispatch during planning.
- Default `READ_ONLY=true`, `EXEC_ENABLED=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`, `MARKET_GUARD_MODE=observe`; all FORCE/guard mutation defaults remain false.
- Fixed `validationScope=ATTENDED_PAPER_LIFECYCLE_ONLY`; PAPER only, attended only, exactly five existing identities. Never include a later manual holding.
- Long/full-quantity SELL, LIMIT DAY, extendedHours=false; original private per-row/total caps, spread <=10 bps, adverse price <=10 bps, evidence <=30 seconds. No inferred caps or risk exemptions.
- `externalTradingStatus=NOT_VERIFIED`; physicalAttendanceVerified, productionReadiness, liveReadiness, unattendedReadiness, originalOwnershipVerified, realizedPnlVerified and historicalEvidenceNormalized remain false.
- Known/restrictive, conflicting, stale, malformed or unverified supplied halt evidence blocks. Missing coverage is not NOT_HALTED; dropping a previously supplied blocker cannot clear it.
- Existing ceilings: GET account6/positions11/orders11/clock11/calendar1/assets10/lookup5/quotes6 =61; submit POST<=5. Oversight has separately pinned `1 + 8*maxCycles` GETs. Ceilings are not permission.
- Response <=3 seconds/8 MiB; attempt <=300 seconds with existing 17-second send margin; no retry, pagination, fallback POST, PATCH/DELETE, cancel, replace or residual resubmission.
- No .env/key reads, broker/provider calls, Telegram send, workflow execution, production-state/cache changes or source inquiries during implementation/tests. Network-denied synthetic fixtures and disposable paired stores only.
- Do not alter Stage6/OOS, analysis/Harvester repositories, original private terms or historical evidence. No new provider, runtime environment flag, planner, ledger or broker abstraction.
- Evidence files are owner-only and hash-pinned; no private values in stdout, git or CI. Public results contain counts/status/hashes only.
- Existing operator attestation plus direct supervision/manual stop; physical presence is not machine-verified. Accepted orders may remain after interruption. No guarantee of host-loss alert delivery.

## Review Focus

1. A cloned/old capability or valid receipt from another transport must not cross purposes or generations (Task 1).
2. A well-formed risk/clock document without underlying evidence must never become current verified evidence; cash-flow, split or time-basis mismatch must block (Task 1).
3. Removing known halt evidence or substituting tradable=true must not turn a blocked limited attempt into an allowed one (Task 1).
4. Stop arriving after asynchronous pre-submit validation but before fetch, or after a possibly accepted POST, must prevent every later submit without inventing cancellation (Task 3).
5. A torn paired write or V3 reader/observer downgrade must not erase the limited-purpose label or create generic execution/P&L eligibility (Task 2).

## Inspected baseline and remaining evidence boundary

The approved spec's source gaps are real: `assessOperationalRiskPolicy` validates eight limits, not measurements; `assessOperationalClockEvidence` validates an interval, not its provenance. The old readiness evaluator deliberately retains all three source/risk/clock blockers. `collectOperationalEvidence` and the complete operational caller do not exist. The current transport exposes request/counts, not a manual-stop API.

The existing adapter already provides bounded broker receipt mapping, a controller, paired writes and pre-submit rechecks. Reuse those; do not build a second loop. The shared record validator currently supports V1/V2 only, and the observer currently emits V2. Both must preserve V3 before the new caller is exposed.

### Non-halt measurement decisions proposed for plan review

These are explicit implementation choices, not claims that suitable private evidence currently exists. None changes a limit or the old risk-policy schema. Do not silently substitute a different basis if a real policy/source uses different semantics.

- Add a purpose-specific measurement definition in the new pinned validation-policy document: risk calculation basis/version, timezone `America/New_York`, completed-session basis, adjustment/return basis, volatility and dollar-volume windows/minimum observations, drawdown window/sampling grid, annualization factor, and evidence age/uncertainty limits. Every parameter is explicit; no numeric defaults or inferred thresholds.
- Current account/position observations come only from the existing authenticated, same-transport account/positions GET receipts. Validate USD equity >0, exact full-portfolio identity and positive signed long positions. Source market values are broker-marked values at the read interval, not a claim of synchronized NBBO.
- Exposure is `100*abs(position market value)/equity`; sector and portfolio exposure aggregate the complete approved portfolio. Sector identity requires exact source-map lineage, not symbol guessing. Missing/unscoped assets invalidate the input instead of reducing the denominator.
- Daily loss uses a verified same-session start-equity basis, current equity and complete external cash-flow coverage: `100*max(0, startEquity + netExternalFlows - currentEquity)/startEquity`. Neither `last_equity` alone nor absence of a cash-flow file proves no cash movement.
- Drawdown uses the explicit policy window and complete sampling grid of cash-flow-adjusted equity; compare current adjusted equity against the sampled high-water mark including current equity. It is sampled drawdown, not an assertion of an unobserved continuous-time peak. Missing coverage or incompatible legacy policy basis blocks.
- Volatility uses simple daily close returns, sample variance and the declared annualization factor; compare squared volatility to the squared cap using rational arithmetic, avoiding a permissive rounding tolerance. Dollar volume uses the declared completed-session mean of close*volume with compatible split/volume adjustment. Never forward-fill a gap to pass.
- Earnings distance comes from exact asset/event/source publication lineage, calculated in market calendar dates. Missing date/timezone, future publication, ambiguous identity or an incompatible event basis blocks; do not borrow today's data for past decisions.
- Historical inputs are read from individually pinned, reviewed original artifacts and their provenance/coverage manifests. The new private replay view is computed from those bytes, never accepted as a precomputed PASS. Hashes establish byte identity, not provenance: unidentified producer/schema, unsigned assertion of coverage, missing underlying records or unsupported source adapters return BLOCKED. No new remote acquisition is part of this plan.
- The existing broker clock receipt is an external-to-host reference observation only. Bind its TLS route, receipt ownership, remote timestamp and monotonic send/receive interval; require the remote time to fit the observed request interval without compensation. This proves origin/interval consistency, not UTC accuracy, host synchronization or a provider accuracy SLA. Subsequent wall-time versus monotonic elapsed divergence beyond the explicitly pinned uncertainty bound blocks; no implicit skew tolerance. A policy requiring stronger guarantees remains blocked, never silently downgraded.

Official field reference inspected on 2026-10-25: the account/clock sections of [Alpaca SDK trading models](https://alpaca.markets/sdks/python/api_reference/trading/models.html) document account equity and the clock timestamp. That inspection did not establish original portfolio-history/cash-flow coverage, external halt guarantees or a clock-accuracy SLA. The 2026-10-26 collection amendment below separately inspects the SDK's portfolio-history model; documented fields do not establish this account's evidence. No broker request was made to inspect that documentation.

Real source availability and current custody are NOT_ESTABLISHED by this plan. Implementation must support the valid evidence path and every explicit rejection, not hard-code perpetual BLOCKED or accept fixture-style labels. A missing real input later prevents runtime approval, not offline implementation. If authentic source bytes cannot support a proposed mapping, record the exact unsupported mapping and stop that runtime preparation; do not introduce another provider or weaken a risk dimension.

## File reach and interfaces

All paths below are relative to the worktree above. Recheck callers before edits. No unrelated formatting/refactor.

| File | Responsibility |
| --- | --- |
| `scripts/lib/scoped-paper-operational.mjs` | New exact configuration, pinned-document loading, real-input replay orchestration and limited readiness; old route unchanged. |
| `scripts/lib/scoped-closeout-contract.mjs` | Purpose-bound WeakMap authority, generations, retirement, controller/pricing checks and V3 creation. |
| `scripts/lib/scoped-paper-evidence.mjs` | Same-transport receipts, remote clock provenance and sealed limited snapshot; no fabricated halt. |
| `scripts/lib/scoped-paper-risk-evidence.mjs` (new) | Pure, deterministic eight-dimension replay from validated raw records; no network/state/authority. This isolates calculations rather than adding a provider abstraction. |
| `scripts/lib/scoped-paper-transport.mjs` | Capture monotonic receipt metadata; final synchronous pre-wire/retirement check without new routes. |
| `src/scoped-management-record.ts`, `scripts/lib/scoped-closeout-storage.mjs` | V3 exact schema, paired transitions and anti-downgrade. |
| `src/order-ledger-storage.ts`, `src/order-idempotency-storage.ts` | Exercise both existing shared-validator call paths; change only if a failing compatibility test requires it. |
| `scripts/lib/scoped-paper-adapter.mjs`, `scripts/lib/scoped-paper-oversight.mjs` | One controller, actual attended composition, irreversible submit-to-observer handoff. |
| `scripts/run-scoped-paper-closeout.mjs`, `scripts/paper-order-notifications.mjs` | Explicit inert-by-default dispatch, interrupt binding, scope-qualified aggregate results/notifications. |
| `scripts/run-paper-iex-readonly-probe.mjs` | Reviewed-code transitive inventory only if runtime imports change; old attempts never repinned. |
| Existing scoped fixtures/tests, one new attended suite, `package.json`, `.github/workflows/ci.yml` | Network-denied acceptance matrix and compatibility regressions. |

New types below are conceptual JS contracts, not exported trust tokens: `Assessment` is a frozen result with status/reasons/false safety claims; `BoundFiles`, `Capability`, `RiskEvidence`, `ClockEvidence`, `Snapshot` are module-owned opaque objects. Serialized/cloned versions cannot confer authority. Private computed values must not be returned by the public reporter. The pure risk replay result is internal `RiskReplayResult={status,reasons,measurements,sourceHashes}` rather than a public Assessment or a trusted source capability; each measurement has `dimension,valueBasis,sourceHashes,asOf`. Rational values stay numerator/denominator pairs until private formatting. No PASS result from this pure function bypasses source authentication in its caller.

## Task 1: Purpose-bound authority and actual non-halt evidence

**Files:** Modify operational/contract/evidence/transport and the two code inventories above; create `scripts/lib/scoped-paper-risk-evidence.mjs` and `scripts/test-scoped-paper-attended-lifecycle.mjs`. Extend `scripts/fixtures/scoped-paper-adapter.mjs`, `scripts/test-scoped-paper-operational-files.mjs`, `scripts/test-scoped-paper-evidence.mjs`, `scripts/test-scoped-paper-transport.mjs`, `scripts/test-paper-iex-readonly-probe.mjs`.

**Interfaces:**
- `validateAttendedConfiguration(config) -> Assessment` in operational; exact new schema `scoped-paper-attended-lifecycle-invocation-v1`, fixed validationScope, existing stable fields, and sourcePolicy pins for validation policy, risk policy, risk source inventory and clock policy. No old contractFile falsely declaring halt coverage.
- `loadAttendedEvidenceFiles({config}) -> Promise<BoundFiles>` and `verifyAttendedEvidenceFiles({config,files}) -> Promise<true>` in operational; reuse strict bytes/path/schema checks, bind every referenced source file, and recheck before wire.
- `authorizeAttendedInvocation({config,approval,clock}) -> Capability`, `assertAttendedInvocation(capability,{config,clock}) -> true`, `bindAttendedObservation(capability,{scope,observation,clock}) -> void`, `retireAttendedSubmission(capability,reason) -> void` in contract. New exact approval kind `DIRECT_SCOPED_ATTENDED_LIFECYCLE_INVOCATION`; otherwise existing approval fields plus fixed validationScope and externalTradingStatus acknowledgment. Keep the existing confirmation gate; no executable approval is provided here.
- `replayAttendedRisk({policy,definition,sourceRecords,currentAccount,currentPositions,decisionAt}) -> RiskReplayResult` in new risk module. Inputs have provenance checked by the caller; this pure function cannot itself mint RiskEvidence or assert origin authenticity.
- `buildAttendedRiskEvidence({scope,files,receipts,transport,clock}) -> RiskEvidence` and `buildAttendedClockEvidence({scope,files,receipt,transport,clock}) -> ClockEvidence` in evidence; require same-transport sealed receipts and bound original-source files before sealing computed evidence.
- `collectAttendedEvidence({capability,scope,files,receipts,transport,clock}) -> Snapshot` in operational; consumes already collected receipts, does not add requests. `assessAttendedReadiness({config,files,scope,observation,clock}) -> Assessment` returns `PAPER_LIFECYCLE_PRECONDITIONS_MET` only on authentic complete evidence; otherwise BLOCKED with precise reasons.
- Existing `validateObservedCloseoutInput` reuses schema2 input validation and stores the limited purpose in private scope metadata from the new capability, not from a caller boolean. Existing snapshot evaluator and `priceOrder` use that metadata; plain/legacy scopes still require NOT_HALTED.
- Add `attendedFixture() -> {config,approval,sourceRecords,clock,fetchImpl,calls,writePinnedInputs}` to the existing fixture module. It uses only synthetic identities/receipts/temp paths and explicitly test-only approvals. It cannot be loaded by runtime modules.

- [ ] **1. Write the failing authority/evidence tests.** Use the actual new APIs, mock transport and synthetic pinned files; `writePinnedInputs` returns temp paths and a cleanup function. Name and pin these assertions:

```js
// limitedPurposeIsNotGenericReadiness
assert.equal(result.status, 'PAPER_LIFECYCLE_PRECONDITIONS_MET');
assert.equal(result.externalTradingStatus, 'NOT_VERIFIED');
assert.equal(result.executionAuthorized, false);
assert.equal(result.productionReadiness, false);
assert.equal(result.physicalAttendanceVerified, false);
// fabricatedRiskAndClockCannotPass
assert.equal(unbackedResult.status, 'BLOCKED');
assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
// policyAndSourceMutationRejects
assert.equal(staleOrChangedResult.status, 'BLOCKED');
```

Also name/table-test `crossPurposeOrClonedCapabilityRejects`, `receiptTransportAndGenerationMismatchRejects`, `knownHaltCannotBeRemoved`, `legacyUnknownHaltStillBlocks`, `missingEachRiskDimensionBlocks`, `cashflowOrHistoryGapBlocks`, `barAdjustmentOrLookaheadBlocks`, `unsupportedSourceSchemaBlocks`, `remoteClockIsNotSyncProof`, `closedOrWrongAccountBlocks`, `completePortfolioDriftBlocks`, `codeAndInputDriftBlocks`. Mutate each of the eight risk inputs independently. Boundary tests cover exact cap and one smallest represented unit above; volatility uses squared comparison. Test zero/negative equity, duplicate dates/identities, missing sector, partial cash-flow coverage and absent numeric policy values. A plain PASS document and a valid hash without original bytes/provenance both fail.

- [ ] **2. Run red:** `npm run build && NODE_OPTIONS="--require=$PWD/scripts/fixtures/scoped-paper-offline.cjs" node scripts/test-scoped-paper-attended-lifecycle.mjs`. Expected failure is the missing new exported interface/behavior, not network/credential failure. Save only aggregate red evidence locally.
- [ ] **3. Implement configuration, opaque authority and source loading.** Reuse canonical hashes, private reader and control-attestation checks. Capture purpose in the existing WeakMaps; old validators reject new config. Seal scope/feed/transport/generation and permanently retire on invalidation. Invalid files, mode or approval must fail before credential loading or writes; schema validation alone never mints execution authority.
- [ ] **4. Implement measured risk and remote-reference provenance.** Add strict replay for the eight stated calculations and supported original-source adapters; bind original bytes, identity, source publication/retrieval times, coverage and policy hashes. Read current values only from existing sealed GETs. Store send/receive monotonic metadata privately in transport receipts. Clock payload, local receipt time and provider accuracy remain distinct; no compensation or invented timestamp. Missing proof yields a specific BLOCKED reason, never fabricated measurements.
- [ ] **5. Implement sealed limited snapshot/readiness.** Preserve NOT_VERIFIED across snapshot and policy output; carry known halt blockers across generations. Reuse account/portfolio/orders/assets/quotes/calendar checks and controller prices. No wrapper may temporarily write NOT_HALTED to satisfy old code. Require real risk/time seals at both all-five readiness and each new snapshot generation.
- [ ] **6. Run green:** the red command plus `npm run ops:test:scoped-paper-adapter`, `npm run ops:test:scoped-paper-operational`, `npm run ops:test:scoped-closeout-contract`, `npm run ops:test:paper-iex-readonly-probe`, all under the same network-denial preload. Require zero real calls and legacy regressions PASS. Add new imports to both transitive pin inventories; no private approval changes.
- [ ] **7. Commit only Task 1 files:** `feat: bind attended PAPER purpose to measured evidence`. Review `git diff --check` and staged file list first; never `git add .`.

Deliverable: valid synthetic original inputs traverse the real parser/replay/sealing path and yield limited readiness; incomplete/fake/mismatched inputs reject. This is not a finding that real current source inputs or execution permission are present.

## Task 2: Durable limited-purpose records and consumer isolation

**Files:** Modify `src/scoped-management-record.ts`, contract/storage/oversight/notifications above. Extend `scripts/test-scoped-closeout-storage.mjs`, `scripts/test-scoped-closeout-consumers.mjs`, `scripts/test-scoped-paper-oversight.mjs`, `scripts/test-paper-order-notifications.mjs`. Both strict store readers remain shared-validator consumers unless regression proves an edit necessary.

**Interfaces:** Existing `validateScopedManagementRecord(key,value)` gains the strict V3 discriminated member. Existing reservation, `recordScopedObservation` and observer mapping preserve the member/purpose. No new store or alternate persistence API.

V3 = existing exact fields + recordKind `SCOPED_MANAGEMENT_EXIT_V3`, schemaVersion3, fixed validationScope, externalTradingStatus NOT_VERIFIED, required brokerEventTimestamps. Null is allowed only while brokerOrderId/status are null; after observation reuse exact V2 timestamp rules. Every false ownership/PnL/normalization/submission flag remains false. Neither existing V1/V2 nor unknown record kinds are migrated.

- [ ] **1. Write failing cases:** `v3ReservationHasNoInventedBrokerTime`, `v3ObservationRetainsPurpose`, `v3TimestampCannotRegress`, `v3CannotDowngrade`, `v1v2RemainByteUnchanged`, `bothStoresRejectPurposeMismatch`, `pairedFailureKeepsEvidence`, `genericConsumersRejectV3`, `notificationRetainsLimitedScope`.

```js
assert.equal(reserved.recordKind, 'SCOPED_MANAGEMENT_EXIT_V3');
assert.equal(reserved.brokerEventTimestamps, null);
assert.equal(observed.validationScope, 'ATTENDED_PAPER_LIFECYCLE_ONLY');
assert.equal(observed.realizedPnlVerified, false);
assert.equal(validateScopedManagementRecord(key, strippedRecord), false);
assert.equal(validateScopedManagementRecord(key, downgradedRecord), false);
```

Use existing temp-store fault injection before/after each paired persistence boundary; hash original records before/after. A force-killed/torn pair blocks reopening; no repair or dedup-key release. Test valid restart observation, STOPPED stickiness, history16 limit, paired hash parity and null-to-exact timestamp transition. Existing generic entry/protection/PnL consumers must reject V3 even if its broker fill is terminal.

- [ ] **2. Run red:** `npm run build && NODE_OPTIONS="--require=$PWD/scripts/fixtures/scoped-paper-offline.cjs" node scripts/test-scoped-closeout-storage.mjs`. Expected new V3 assertion failure; old fixtures stay valid.
- [ ] **3. Implement exact V3 typing/validation and transitions.** Keep shared validator dispatch in both stores, same CAS/backups/atomicity and no scope/version downgrade. Contract reservation derives V3 only from the authenticated limited scope; observer must not unconditionally overwrite it with V2. Generic actions still reject management records.
- [ ] **4. Implement notification/consumer compatibility.** Public scoped lifecycle summaries retain purpose and NOT_VERIFIED, without private fields. Do not label filled-and-flat as original ownership/PnL verification. No new notification destination or actual send.
- [ ] **5. Run green:** `npm run ops:test:scoped-closeout-contract`, `npm run ops:test:scoped-paper-operational`, `npm run ops:test:paper-order-notifications`, `npm run ops:test:order-idempotency-storage`, `npm run ops:test:order-ledger-storage`, `npm run ops:test:order-state-consistency`, `npm run ops:test:paper-realized-pnl`, under network denial. Require both V1/V2 regression and V3 fault cases PASS.
- [ ] **6. Commit only Task 2 files:** `feat: preserve attended PAPER scope in paired records`. Include the V3 compatibility/rollback note in the approved spec, not a historical-state migration.

Deliverable: limited scope survives every valid transition/restart; invalid or old reader paths reject rather than normalize it. Before first authorized V3 write rollback is code-only. Afterwards retain a V3-capable observer; never restore old state or strip labels.

## Task 3: Actual caller, manual stop, observation and reviewed integration

**Files:** Modify adapter/transport/contract/operational/oversight/CLI/notifications above. Extend `scripts/test-scoped-paper-attended-lifecycle.mjs`, `scripts/test-scoped-closeout-integration.mjs`, `scripts/test-scoped-paper-adapter.mjs`, `scripts/test-scoped-paper-transport.mjs`, `scripts/test-scoped-paper-oversight-runtime.mjs`, `scripts/test-paper-order-notifications.mjs`; update `package.json` and `.github/workflows/ci.yml` for offline test inclusion.

**Interfaces:**
- `runAttendedPaperCloseout({config,approval,clock,transport,notify,stopSignal}) -> Promise<SafeAggregate>` in adapter. Match the existing transport factory contract; only invoke it after local pins/control/approval validation. Reuse one `advanceScopedCloseout` effect loop, parameterized internally by validated purpose, not a second engine.
- Existing transport factory gains optional synchronous `beforeWire` check, required by the attended runner. After the awaited beforeSubmit and immediately before fetch, it must recheck the opaque capability, retirement and signal. No await is allowed between that final check and initiating fetch. A rejected check does not increment a submit wire count.
- `handoffAttendedObservation(capability,{config,records,expectedHashes,clock}) -> ObservationHandoff` in contract. Reuse existing handoff/claim/budget rules; permitted after submission retirement only for already attempted identities, never restores submission rights. Existing oversight consumes purpose-bound handoff and V3 records.
- `buildAttendedLifecycleSummary({scope,state,records,notificationDelivery}) -> SafeAggregate` in adapter: the seven spec statuses form a single partition totaling five. Limited runtime PASS requires five FILLED_AND_FLAT_RECONCILED and unchanged unscoped portfolio. No private row values in this return object.
- CLI `--validate-attended`/`--assess-attended` follow existing five-argument pinned config/approval-file pattern and remain zero broker/state I/O. `--execute-attended` uses the approved dependency-injected caller only; without exact bound dependencies/authority it is inert/BLOCKED. It does not load .env, enable flags or grant runtime permission. Old commands reject the new schema.
- SIGINT is bound only around an explicitly authorized attended caller. First interrupt retires submits and sets stopSignal; a second interrupt/SIGTERM prevents further observation and initiates safe local handoff if possible. Remove listeners in finally. This is not a cancellation API or physical-presence detector.

**Independent observer subcycle (2026-10-27):** The real V3 observer now calls
the seven-state summary using durable records and its receipt-sealed portfolio
snapshot. One reconciled attempted row cannot mean full five-row completion;
cloned/stale evidence, portfolio drift and open-order conflicts cannot prove
flatness. This observation-only entry point explicitly returns `runtimeProof=false`
even for five reconciled rows. It cannot attest to the missing source/risk
admission or complete submission path. Complete-caller runtime adjudication and
the following composition tests are still required; none is checked off here.

- [ ] **1. Write failing complete mock-composition tests.** Exercise the actual CLI -> authorizer -> authentic receipt mapper -> controller -> paired temp stores -> observer -> mock sender path, not replacement methods returning PASS. The complete valid fixture must show five reconciled targets with original false claims and no real network.

```js
assert.equal(summary.status, 'PAPER_LIFECYCLE_RUNTIME_PASS_LIMITED_SCOPE');
assert.equal(summary.counts.FILLED_AND_FLAT_RECONCILED, 5);
assert.equal(Object.values(summary.counts).reduce((a, b) => a + b, 0), 5);
assert.equal(summary.liveReadiness, false);
assert.equal(summary.externalTradingStatus, 'NOT_VERIFIED');
// The test harness, not a production runtime receipt, reports this:
assert.equal(testReport.status, 'PAPER_LIFECYCLE_OFFLINE_CONTRACT_PASS');
```

Name negative cases `defaultCliZeroIo`, `invalidApprovalBeforeCredentialAccess`, `allFivePreflightBeforeReservation`, `stopAfterAwaitBeforeWire`, `stopBeforeReservation`, `stopAfterReservationBeforeWire`, `stopDuringUnknownPost`, `acceptedPartialStopsLaterTargets`, `secondInterruptNoNewObservation`, `expiryOrReportedAbsenceRetires`, `restartCannotSubmit`, `terminalResidualIsNotPass`, `unscopedDriftAfterFillIsNotPass`, `notificationFailureDoesNotRetryOrder`, `unknownBrokerStatusIsUncertain`, `privateSentinelStringsNeverPrinted`.

- [ ] **2. Run red:** `npm run build && NODE_OPTIONS="--require=$PWD/scripts/fixtures/scoped-paper-offline.cjs" node scripts/test-scoped-paper-attended-lifecycle.mjs`. New complete-caller/interrupt assertions must fail; Task 1 evidence cases must remain green.
- [ ] **3. Connect the real caller and manual retirement.** Perform local preflight, mint purpose authority, verify actual control evidence, collect bounded receipts, require all-five readiness, then reuse existing reservation/effect/persistence path. Recheck current risk/time/identity/pins at each snapshot and final wire boundary. Do not convert the initial readiness result into permission to skip later checks.
- [ ] **4. Connect uncertain/resting/partial outcomes to existing observer.** First nonterminal/uncertain/failure stops later targets. Preserve ATTEMPTED records even if a response was lost. No wire attempt means no extra broker reads; possibly sent means only remaining separately authorized observation. Interrupts never delete reservations, cancel orders, renew budgets or restart targets. Allow an in-flight paired write to finish safely; crash recovery remains fail-closed.
- [ ] **5. Connect aggregate notification and CLI.** Reuse notification receipts/fingerprints with limited-scope labels. Test transport timeout, sender failure, duplicate delivery and exhausted observation window; delivery failure cannot permit resubmit. Host death is explicitly not a guaranteed notification. Gate CLI handlers so import/default/validation never loads credentials or installs long-running supervision.
- [ ] **6. Run targeted green:** the red command plus existing adapter/contract/operational/notification suites under network denial. Use child processes for SIGINT/SIGTERM tests so the test runner and production files are untouched. Await all fixture promises, assert no timers/listeners remain, and verify request counts at every stop edge.
- [ ] **7. Wire and run the full static matrix below; commit:** `feat: connect attended PAPER lifecycle caller and bounded oversight`. Inspect staged paths, sensitive-marker output and exact pin inventory; preserve unrelated changes. No runtime flag/secret/private state file is committed.
- [ ] **8. Request one fresh whole-branch independent review using the approved Native method.** Review against this plan, the accepted spec, all prior unmerged parent changes and the common base, not only the last commit. A quota-limited/interrupted reviewer is NOT a completed review; preserve its status and resume the same handle when available. Fix supported findings, repeat affected tests and final matrix; do not bypass usage limits with alternate accounts/models.
- [ ] **9. Only after implementation/review approval scope covers git integration:** non-force push the existing branch, update Draft PR #57 with limited claims/compatibility/tests/rollback, attach it to this chat, and await actual related CI. No workflow dispatch. Review the full PR for unrelated/private changes before marking ready. Merge only after required CI/review pass, then non-destructively fast-forward the appropriate local main checkout. No force push, reset or state migration.

## Full offline verification and stop conditions

Add `ops:test:scoped-paper-attended-lifecycle` = `npm run build && node scripts/test-scoped-paper-attended-lifecycle.mjs`. Add it to the existing offline CI job with network denial and safe defaults; no new workflow or runtime environment flag.

Run from the execution worktree, with `NODE_OPTIONS="--require=$PWD/scripts/fixtures/scoped-paper-offline.cjs"` for each test command:

```text
npm run ops:test:scoped-paper-attended-lifecycle
npm run ops:test:scoped-closeout-contract
npm run ops:test:scoped-paper-adapter
npm run ops:test:scoped-paper-operational
npm run ops:test:paper-iex-readonly-probe
npm run ops:test:order-idempotency-storage
npm run ops:test:order-ledger-storage
npm run ops:test:order-state-consistency
npm run ops:test:live-readiness-blockers
npm run ops:test:paper-exit-liveness
npm run ops:test:paper-realized-pnl
npm run ops:test:paper-order-notifications
npm run ops:test:dry-run-dispatch-safety
npm run ops:test:sidecar-public-evidence
npm run ops:safety:telegram-routing
npm run ops:safety:symbol-agnostic
npm run typecheck
npm run build
git diff --check
```

`npm audit --audit-level=high` is a separately identified package-registry security check in the approved implementation/CI scope, not a broker/provider probe. Do not run it during this planning-only step. Do not change dependencies to hide an unrelated audit failure without approval.

PASS means all commands exit0, asserted mock calls stay inside the declared budgets, fixture outputs remain private-safe and the complete valid path actually reaches the observer/notification. Passing only rejection tests is insufficient. Do not execute production scripts or rerun a prior one-shot to manufacture evidence. Unexpected user changes stop edits; retain failures and report the exact boundary.

## Completion and next action

| Claim | Required evidence | Current state |
| --- | --- | --- |
| Written design accepted | Direct operator reply on2026-10-25 | ACCEPTED |
| Native implementation plan prepared | This document plus subsequent direct Native implementation approval | APPROVED_OFFLINE_IMPLEMENTATION_IN_PROGRESS |
| Limited offline contract complete | Tasks1-3, full green matrix, independent review, PR/CI/merge | PARTIALLY_IMPLEMENTED_NOT_COMPLETE |
| Real current risk/time/custody available | Authentic original input records, exact current binding and supported calculation basis | NOT_ESTABLISHED |
| Limited PAPER order permission | Separate exact current scope/flags/account/budgets/rollback and approval gate | NOT_AUTHORIZED |
| Production/LIVE/unattended readiness | Full original source/risk/state/runtime requirements | NOT_ESTABLISHED |

Native offline implementation was subsequently approved; do not request that approval again or repeat attendance/design-method questions. The newly discovered original-source collection gap and its separate design-review boundary are recorded below. After static integration, prepare one exact current-evidence/custody readiness package; request actual PAPER runtime permission only when all non-halt prerequisites are genuinely met. No promise that one attempt fills every order, no LIVE/deposit instruction, no return target.

## Planning self-review

- Spec sections1-5 -> Task1 authority, source and calculation tests; old full-source status remains truthful.
- Section6 -> Task3 complete composition, interrupt races, finite observer and disclosure of undetectable absence.
- Section7 -> Task2 V3 and paired-store/reader/notification coverage, with old records untouched.
- Sections8-9 -> Task3 seven-state partition, full-five reconciliation and complete positive/negative fixtures; offline result distinguished from runtime.
- Sections10-11 -> staged Native delivery, completed design approval, independent implementation review still required and explicit runtime gate.
- All five Review Focus classes have named tests. New helper signatures and files are shared consistently across tasks; existing helpers are reused instead of replaced.
- Remaining real source availability, measurement-basis review and UTC-accuracy limitations are disclosed, not represented by fabricated PASS data or an implementation stub. This plan proposes no acquisition or risk-policy activation.
- No production-code edit, fixture execution, independent implementation review, push/CI, order or runtime proof has occurred as part of preparing this plan.

## Implementation discovery: original-risk collection gap (2026-10-26)

The operator subsequently approved Native offline implementation, verification,
independent review and PR/CI/merge. The planning-era permission statements above
describe the earlier planning step; they do not authorize runtime calls or orders.

During implementation the operator explicitly confirmed that preserved original
account-equity history and complete cash-movement evidence are unavailable.
The existing `capture-paper-private-evidence.mjs` captures account, positions,
open/closed orders and clock only. It does not establish either historical-equity
sampling coverage or complete external cash-flow coverage. Reusing its previous
five-GET approval would not authorize collecting these missing sources.

| Requirement | Current evidence | Consequence |
| --- | --- | --- |
| Current account/positions | Existing authenticated receipt mapper | Does not prove past equity or absent cash flows |
| Historical equity sampling grid | No preserved original, operator-confirmed | Daily loss/drawdown source binding incomplete |
| Complete external cash movements | No preserved original, operator-confirmed | Empty array cannot be treated as zero cash movement |
| Original producer/schema/coverage verification | No supported historical adapter established | Byte pins and replay arithmetic cannot mint source authority |
| Risk arithmetic | Offline synthetic replay exists | `sourceVerified=false`; not runtime readiness |

The next source work is an **offline collection-contract amendment**, not another
account probe: identify the existing-provider original response schemas, explicit
time/grid/transaction coverage and completeness evidence, private retention and
redaction, and the bounded acquisition scope needed to produce them. Do not name
an undocumented field or assert that a bounded request necessarily returns full
coverage. Implementation of a new collector and its actual execution require
their own explicit scope approval; neither is authorized by this discovery note.

Task1's original-source mapping, sealed risk readiness and the complete caller
acceptance path remain incomplete. No permanent BLOCKED stub, fabricated source
receipt, zero-flow assumption, current-balance backfill or risk waiver substitutes
for them. Task2/3's independently testable compatibility and stop controls do not
complete Task1 or the parent objective. Existing evidence and state stay intact;
there is no need to wait for a market session to resolve this contract gap.

### Public-source findings for the collection gap (2026-10-26)

This is a factual gap assessment, not an approved collector design or acquisition
scope. No account endpoint was called. Existing request budgets are unchanged.

- The official Trading API documents a PAPER portfolio-history route with an
  explicit timespan, resolution and optional cash-flow activity selection:
  https://docs.alpaca.markets/us/reference/getaccountportfoliohistory-1.
  Its existence does not establish this account's historical coverage.
- The official SDK model labels portfolio timestamps at the interval start but
  describes equity at the interval end. Preserve both meanings; copying a label
  into an exact observation timestamp would misrepresent the evidence:
  https://alpaca.markets/sdks/python/api_reference/trading/models.html#portfoliohistory.
- The activities reference documents creation-time filters and pagination. The
  conceptual guide describes a non-trade activity date as occurrence/settlement
  date. Neither can silently substitute for the exact cash-movement time needed
  by the current replay. A full first page is not complete history, and an empty
  response does not establish all effective-time movements through decisionAt:
  https://docs.alpaca.markets/us/reference/getaccountactivities-2 and
  https://docs.alpaca.markets/us/docs/account-activities.
- Current source coverage, interval-end mapping, external-versus-investment cash
  classification and late-posting/current-boundary completeness remain unproven.
  The guide and endpoint reference also differ on date-specific page-size
  behavior; do not use an unbounded date request to evade a collection budget.

The operator-confirmed disposition remains COLLECTION_CONTRACT_GAP. An offline
amendment must resolve these mappings and specify a finite request/page budget
and explicit incomplete outcome before any collector implementation is approved.
It must distinguish a documented schema from observed completeness. Do not
reinterpret an SDK default empty cash-flow map as proof of no cash movements,
or assert that a future bounded acquisition necessarily satisfies the risk gate.
No missing-original goal, Task1 source proof or execution readiness is completed
by this documentation review.

The operator selected drafting the offline collection-contract amendment. Its
review copy is `docs/superpowers/specs/2026-10-26-paper-risk-original-collection-amendment-design.md`.
The proposed ten-GET envelope and bounded activity pagination are not approved
runtime calls and do not modify this plan's existing transport budget or
no-pagination rule. Source qualification and design approval precede any new
collector implementation; capture success cannot by itself unlock risk readiness.

### Approved V2 interval representation subcycle (2026-10-27)

The direct operator response approved offline V2 code and fixtures, as specified
in `docs/superpowers/specs/2026-10-27-paper-interval-risk-measurement-design.md`.
`replayAttendedRisk` now accepts the paired V2 definition/records schemas and
complete, source-referenced external-capital intervals. V1 remains exact-event
only. Limits, formulas, policy endpoints and the current account cutoff are
unchanged. Gaps, overlap, reused references, coarse intervals crossing a policy
endpoint and unproven current tails reject; no event timestamp is manufactured.

The new fixture failed before implementation. After implementation, the attended
suite passed 688 parent and 863 authority-child assertions; the 16-command local
regression and two disposable-directory safety checks completed with exit0.
All used network-denied fixtures. This is offline sub-contract evidence, not
independent whole-branch review or actual GitHub CI. No dependency changed.

The replay is imported only by the offline test. It cannot authenticate source
bytes or grant execution authority. No source sealer, collector, runtime caller
or execution permission was added. Task1 source mapping/current-tail coverage,
the full Task2/3 caller path, independent review and Git integration remain
incomplete. No whole Task checkbox or parent completion is inferred from this
representation change. Existing local test logs and the progress ledger record
the exact code hashes and terminal command results without private evidence.

### Reviewed offline subcontracts checkpoint (2026-11-02)

The interrupted changes were recovered with exact checkpoint hash parity. A
fresh independent review covered the full base-to-working-tree delta, including
the uncommitted interval replay. It found one notification compatibility defect:
the generic notification consumer accepted V3 flat-reconciled records without
carrying their attended-only and unverified-trading-status labels.

The generic builder now rejects any V3 record in either store or release list;
the existing scoped builder retains those labels. A valid paired V3 fixture
first reproduced the defect. Both-store, one-store, released and malformed V3
cases now reject without sending or writing a delivery receipt. Mixed generic
snapshots are also rejected rather than silently dropping the limited scope.
Existing V1/V2 notifications and scoped V3 delivery remain covered.

After that fix, all 33 local offline regression/CI-equivalent commands passed,
including build/typecheck, the HF fixture replay and both safety audits. The
tests used a disposable source copy, empty HOME and network-denial preload;
production state hashes remained unchanged. The unchanged lockfile's package
registry audit reported zero vulnerabilities. This is local evidence, not a
claim that GitHub CI or a broker run has already succeeded.

Ruling: integrate only these independently testable offline subcontracts under
the existing approved PR/CI scope. This does not complete Tasks 1-3, change the
current-cutoff risk requirement, or authorize acquisition, state adoption or
orders. The CLI still exposes no attended execution command, replay still has
no runtime importer, and public readiness/authorization claims remain false.

Required remaining work is unchanged: qualify authentic source and custody with
complete external-capital coverage through the current account observation;
then implement the separately gated source producer/binding and full attended
caller, including known-halt stickiness and actual wire-attempt-aware oversight.
The parent's operational completion and execution-readiness gates remain open
regardless of whether this static checkpoint is merged.
