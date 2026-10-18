# PAPER Operational Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the previously selected Native method. Use checkbox steps task-by-task. The operator approved Native offline implementation and the sequencing amendment; operational activation remains separate.

**Goal:** Complete the existing five-target PAPER management route's operational binding without normalizing historical ownership or enabling orders during development.

**Architecture:** Reuse the scoped controller, sealed transport/evidence, existing two stores and notification receipts. Separate fixed authority from changing observations; add observation-only oversight without re-entering submission. Missing official source guarantees remain an activation blocker, not a reason to stop provider-independent implementation.

**Tech Stack:** Existing Node.js 20+, JavaScript ES modules, TypeScript validators and built-in assert/fs/crypto; no new dependency, ledger, broker abstraction or daemon.

**Spec:** `docs/superpowers/specs/2026-10-16-paper-operational-binding-design.md` (approved architecture; source contract unresolved).

**Status:** NATIVE_IMPLEMENTATION_APPROVED_OFFLINE_ONLY (2026-10-18). The operator requested immediate next-stage work after the revised implementation request. This approves the sequencing amendment and Native implementation/tests/PR/CI, not API calls, state adoption, orders or activation. Code inspected at `4b399bf4dd2f105ad0be88f39e636f105b024edb`; local origin/main is `e313185b9744f122bf36c9b5b5abcede90c42252`, not a freshly fetched remote assertion.

## Approved sequencing amendment

The original spec's sections 1 and 8 required source-contract closure before implementation planning. The approved amendment permits this plan and provider-independent implementation/tests before closure; the source gate remains before any source-dependent operational readiness or submission. This changes sequencing, not execution authority.

An Alpaca support response is one possible source of contract evidence, not the only acceptable one. A documented official contract plus an appropriately authorized observation can also qualify. Fixture PASS cannot prove provider initialization, entitlement, gap coverage or continuity. No new broker probe is included here.

Native implementation approval authorizes Tasks 1-5 with synthetic inputs and the offline portion of Task 6. Task 6's real source mapping remains incomplete until its documented contract exists. An unresolved source is a real blocker: never implement an always-PASS proof generator, claim an always-BLOCKED stub is the completed producer, or mark the parent goal complete from fixtures alone.

## Global Constraints

- alpha-exec-engine only. Scheduler changes are already separately integrated; do not reopen analysis, Harvester, Stage6 or OOS policy work.
- Safe defaults: READ_ONLY=true, EXEC_ENABLED=false, LIVE_ORDER_SUBMIT_ENABLED=false, MARKET_GUARD_MODE=observe. No execution variable changes.
- Development: broker/provider requests=0, actual Telegram sends=0, production state/cache changes=0, workflow dispatch/rerun=0. Never load .env for tests.
- Five exact existing limited-control targets only; full positive-quantity SELL LIMIT DAY reductions. No entry, scale-in, short, cancel, replacement or protective-child mutation.
- Preserve pinned private caps, spread 10 bps, adverse price 10 bps, evidence age 30 seconds, no retry/pagination. Do not calculate new caps from current prices.
- Existing controller ceiling: 61 GET / 5 POST, total 66, request/body timeout 3 seconds, body 8 MiB, invocation 300 seconds. Ceilings are not execution permission.
- New source and oversight reads cannot use leftover old one-shot allowances or silently reset controller counters.
- Preserve existing explicit PAPER IEX support and coverage acknowledgment. IEX is not relabeled NBBO; no feed fallback or SIP purchase.
- Original ownership, historical normalization and realized P&L verification stay false. Historical missing-input goal stays withdrawn, not completed.
- The operator reports a manual trade in the same PAPER account. Old portfolio observations are not current. Do not add that exposure to the five-target authority or invent the new portfolio; future authorized current evidence must match a newly reviewed full-portfolio basis.
- No state adoption, directory creation for production, lock clearing, unattended operation or launchd activation. Those require separate exact operational authority.

## Review Focus

1. Proof replacement between validation and POST must invalidate that send, even if its label still says PASS (Tasks 1/2/5).
2. An unchanged resting order can have an old event time but a fresh query interval; do not fabricate an event or weaken submit-time checks (Task 4).
3. A crash can leave a permanent directory fence or one updated store; never delete the fence, restore an old backup or resume submission automatically (Task 3).
4. A manual account trade can change an unrelated holding while all five targets still match; full-portfolio drift still blocks the existing authority (Tasks 2/5).
5. Observation budget, record-history capacity or host availability can end before an order does; explicit unresolved handoff is required, not simulated cancellation (Tasks 3/4/5).

## Existing gaps and file map

| Existing code | Verified gap / planned owner |
| --- | --- |
| `scripts/lib/scoped-closeout-contract.mjs` | `authorizeScopedPaperInvocation` pins fresh `bindings.proof` in the whole config; `observedBindings` pins one proof hash. Task 1 adds a distinct authority path, not a forged legacy approval. |
| `scripts/lib/scoped-paper-evidence.mjs` | `assessSourceBindings` consumes proof but does not produce it. Tasks 2/6 bind exact source records; Task 4 adds a separate current-query observation mapper. |
| `scripts/lib/scoped-paper-adapter.mjs` | Existing bounded submit/postcheck composition, not persistent oversight. Tasks 1/2/5 reuse it and its private-file/code-pin checks. |
| `scripts/lib/scoped-closeout-storage.mjs` | `withScopedStores` rejects every prior management attempt. Task 3 adds observation-only access, retaining that rejection for submission. |
| `src/order-state-storage.ts` | Local fence remains on exceptional exit; it is not cross-host exclusion. Reuse, do not relax or auto-clear. |
| `src/scoped-management-record.ts` | STOPPED is sticky; history has a 16-entry ceiling. Task 3 preserves both rather than treating polling as a new submission or truncating history. |
| `scripts/lib/scoped-paper-transport.mjs` | Fixed submit/postcheck phases and counters. Task 4 adds separately gated observation-only requests with no submit capability. |
| `scripts/run-scoped-paper-closeout.mjs` | Dependency-injected, default-inert CLI. Task 5 adds explicit operational loading, not an automatic scheduler. |
| `scripts/paper-order-notifications.mjs` | Reuse scoped events and delivery receipts; supervision alerts must not imply cancellation or normal P&L. |
| `scripts/lib/scoped-paper-operational.mjs` (new) | Only operational configuration/source-readiness composition and custody/writer checks; no alternate execution controller. |
| `scripts/lib/scoped-paper-oversight.mjs` (new) | Observation-only orchestration for the exact attempted identities. |
| `scripts/test-scoped-paper-operational.mjs`, `scripts/test-scoped-paper-oversight.mjs` (new) | Synthetic red/green fixtures using existing network-denial preload and temporary stores. |
| Existing scoped tests/fixtures, `package.json`, `.github/workflows/ci.yml` | Extend regression coverage; synthetic fixtures only in CI. |

Do not change generic entry/protection consumers merely to accept management records. Preserve their fail-closed treatment. Any necessary compatibility edit must be tied to a failing regression, not a broad schema rewrite.

## Task 1: Stable authority and sealed changing observations

**Files:** Modify contract, adapter, existing contract/adapter tests; create operational module/test above.

**Interfaces (new, internal):**
- `validateOperationalConfiguration(config)` returns a frozen assessment, without I/O.
- `authorizeOperationalInvocation({ config, approval, clock })` returns an unforgeable in-process capability after actual process/authority checks.
- `bindOperationalObservation(capability, { scope, observation, clock })` registers only a sealed, scope-bound observation for the existing controller.

**Schema:** `scoped-paper-operational-invocation-v1`. Stable fields explicitly contain the existing exact targets/portfolio, account hash bases, terms, input/code pins, directory/pre-write hashes, session/expiry, source/risk/time rules, writer/custody references, oversight limits and notification destination hash. Observation content is a separate named object, not arbitrary excluded hash fields. Approval binds the stable hash; each observation binds it and its own hash. Legacy synthetic v1 and observed v2 remain separate and unchanged.

- [x] Write tests: refresh verified observation without changing stable hash; mutate every stable field and reject; old v2 approval/serialized capability/forged PASS rejected; previous observation invalid after generation change.
- [x] Run `node scripts/test-scoped-paper-operational.mjs`; require the new cases to fail before production changes.
- [x] Implement the three interfaces using existing canonical hash/WeakMap patterns. Revalidate actual flags, authority, source generation and time at pre-send. Do not call the legacy authorizer with a freshly fabricated config approval.
- [x] Run the new test plus `npm run ops:test:scoped-closeout-contract` and `npm run ops:test:scoped-paper-adapter` under network denial; require PASS.
- [x] Commit only these changes: `feat: separate scoped PAPER authority from current evidence`.

## Task 2: Real-evidence boundary with explicit unresolved source gate

**Files:** Modify operational/evidence/adapter modules, fixtures and operational/evidence tests.

**Interfaces:** `assessOperationalReadiness({ config, custody, writer, sourceContract, clock })` returns status/reasons without network or writes. `collectOperationalEvidence({ capability, transport, sourceRecords, clock })` consumes existing sealed allowlisted receipts and produces the sealed observation consumed by Task 1. It cannot receive a caller-created PASS binding as a substitute for source records.

- [ ] Add failing tests for absent source contract, unknown status, gap/disconnect, expired time proof, stale/future evidence, risk input missing, substituted referenced bytes, identity ambiguity, nested orders and whole-portfolio drift including an unscoped manual position.
- [ ] Run operational/evidence tests and record failing assertions.
- [ ] Reuse existing account/positions/orders/assets/calendar/quotes mapping and exact private-file/hash checks. Keep provider event time, query receipt interval and independently established coverage time distinct. Return named blocks for missing status initialization/continuity, clock alignment, risk policy or custody; never create those facts from hashes or labels.
- [ ] Keep source-contract-dependent mapping explicitly unimplemented until Task 6's contract gate is satisfied; a blocked real path is not the completed producer. Fixtures may inject synthetic records only into mock transport and must not be accepted as operational source evidence.
- [ ] Verify unknown source rejects before broker credential/transport creation for a new submission attempt; a previously authorized order observer has a separate authority and cannot regain submission privilege.
- [ ] Run operational, evidence and adapter regression tests; commit: `feat: bind operational evidence with unresolved-source rejection`.

Risk/time/source rules have no permissive defaults. All applicable existing risk dimensions must have verified inputs or a separately approved reduction-only exception; no exception is approved here. Status silence, tradable=true, fresh quotes, clock.is_open, subscription acknowledgment or missing RSS rows never establish NOT_HALTED.

## Task 3: Custody, writer fence and observation-only store access

**Files:** Modify scoped storage; test storage and operational modules. Reuse both strict TypeScript store validators and `withOrderStateDirectoryLock` unchanged unless a fixture proves a specific defect.

**Interfaces:** `withScopedObservationStores({ directory, attemptId, authoritySha256, expectedHashes }, task)` returns an opaque observation-only context. That context is rejected by `reserveScopedExits` and `recordScopedAttempt`; it may only append valid observed state via `recordScopedObservation`.

- [x] Add failing tests: identical valid paired records reopen for separately authorized observation; mismatched pair/hash/authority, symlink, stale fence, wrong account, externally active writer and expired exclusion reject; repeated observation authority with unchanged stores rejects before network; no implicit state adoption or replay.
- [x] Run storage test and verify red.
- [x] Reuse owner-only reads, exact schema, lock, compare-and-swap, backup and parity checks. Preserve initial backups and existing attempt directory. Observation authority must cover the current hashes, exact prior attempt and all management identities, not the old pre-write hashes masquerading as current state.
- [x] Before credential/network access, atomically claim the canonical observation-authority hash once in the existing attempt directory using an owner-only exclusive-create receipt, file/directory sync and readback. Preserve the claim after success, failure or crash; an existing claim rejects invocation even if store hashes never changed. Restart requires fresh exact observation authority, never automatic renewal or claim deletion. This is an attempt receipt, not a new ledger or a reset of submission authority. Do not write order records until Task 4 verifies the active transport's account.
- [x] Preserve STOPPED as a no-submit state even when later broker evidence is filled. Record independently verified fill under the same sticky state; report terminal/position reconciliation from exact observation evidence without marking the controller resubmittable or P&L verified.
- [x] Deduplicate unchanged broker state before appending history. Preserve the 16-entry limit; on capacity exhaustion or torn write, stop observation writes and issue unresolved handoff. No truncation, automatic repair, fence deletion or stale-backup restore.
- [x] Exercise injected failure before/after each existing backup/write/sync/rename boundary, including two-store parity; run storage/consumer regressions; commit: `feat: allow scoped observation without submission replay`.

Actual production directory adoption and account-wide writer exclusion remain separate operator-authorized operations. A local lock or zero open orders is not proof of remote/manual writer exclusion. If the operator cannot enforce that exclusion, submission stays blocked.

## Task 4: Bounded accepted/partial/uncertain oversight

**Files:** Create oversight module/test; modify evidence, transport, storage tests and scoped integration fixtures.

**Interfaces:** `mapOversightObservation({ scope, record, receipt, accountBinding, clock })` requires an in-process account binding for the same observation transport, preserves broker event timestamps and verifies a fresh sealed query interval. `runScopedPaperOversight({ authority, records, observationTransport, stores, clock, notify })` returns a safe aggregate and has no submit/cancel/replace capability. A copied scope account hash is not an account binding.

- [x] Add failing tests: old unchanged accepted event with fresh query; partial then filled; unknown submit then exact lookup; terminal status with residual position; future/regressing times, quantity or identity drift; read failure; exhausted budget; expired submit authority with valid observation authority; wrong-account restart with a matching client ID rejected before lookup; repeated authority with unchanged stores rejected before any GET; restart never submits.
- [x] Run `node scripts/test-scoped-paper-oversight-runtime.mjs`; require red (storage fault tests remain separate).
- [x] Add an observation-only transport mode using existing fixed PAPER routes, complete-response/time/byte guards and sealed receipts. It rejects POST/PATCH/DELETE and records its own counters. Do not reopen a sticky-failed submission transport or reset its budget.
- [x] Every fresh observation transport performs exactly one separately budgeted account GET before order lookups. Verify both named account hash bases from that sealed receipt against the approved account and bind the result to the transport's immutable credentials/capability. Reuse existing account identity checks, distinguishing identity validation from permission to trade. A different account, cloned binding or credential/transport replacement rejects all subsequent observation calls and record writes; never infer account identity from a client-order ID or an old capture.
- [x] Observe only the exact attempted identities. Use original client/order/asset IDs, never a new ID or symbol-only search. Each approved observation cycle permits at most one lookup per attempted identity plus one positions, one open-orders and one clock GET. No pagination/retry; stop immediately on a failed/incomplete response.
- [x] Require explicit finite `validFrom`, `expiresAt`, `maxCycles`, `intervalMs`, per-group/total ceilings, handoff deadline and operator-attendance evidence in oversight authority; no operational default values. Budget one account GET per authorized invocation plus at most 5 lookups + 3 shared GETs per cycle: maximum `1 + 8 * maxCycles`. An explicit maximum cycle count must fit the signed total ceiling and observation deadline. Task 3's durable single-use claim prevents transport restart from renewing that allowance; a fresh authorization is required instead. Test-only example values are never runtime defaults.
- [x] Append only meaningful status/quantity changes through Task 3. Broker-filled alone is not position-flat; confirm portfolio/open-order evidence and preserve unscoped holdings. Canceled/rejected/expired residual exposure stays unresolved. No resubmission after a timeout/404 or partial fill.
- [x] Run oversight, adapter, storage, consumer and notification tests; commit: `feat: supervise scoped PAPER outcomes without new order authority`.

The existing 3-second/8-MiB per-response bounds remain. Observation windows are distinct from the 300-second submit attempt and require separately reviewed finite policy before activation. No unbounded loop, automatic reconnect or schedule is authorized. Power loss cannot be locally detected as an alert delivered; require attending operator until a separately approved independent observer exists.

## Task 5: Default-inert caller, notifications and end-to-end composition

**Files:** Modify existing CLI, adapter, operational/oversight modules, notification helpers and tests. No workflow schedule or launchd file.

**Interfaces:** Preserve `main(argv, dependencies)` and legacy dependency-injected behavior. Add explicit operational schema dispatch and pinned config/approval file loading only when the operator selects that route. No-argument invocation remains zero-I/O `CONFIGURATION_REQUIRED`; local validation never reads credentials or writes stores. `runOperationalPaperCloseout(...)` composes Tasks 1-4, not a parallel controller.

- [ ] Add failing tests: default invocation no I/O; malformed/old approval stops before credentials; safe flags zero network/state; source/code/custody/writer drift before send; all five initial readiness before first POST; observation handoff on first nonterminal/uncertain outcome; ignored manual position is never an order target.
- [ ] Run operational/adapter tests; require red.
- [ ] Load fixed PAPER credentials only in a separately authorized runtime caller after config/authority/local evidence gates. Do not source .env implicitly. No host/feed/account auto-selection. Update `SCOPED_PAPER_REVIEWED_FILES` for every newly reachable runtime module and validator.
- [ ] Use the existing controller/store/transport once for submission and Task 4 for oversight. Any nonterminal/uncertain action permanently stops later targets for that invocation. Stopping submission does not cancel orders; observer expiry or error must surface remaining uncertainty.
- [ ] Reuse `buildScopedNotificationSnapshot`/`deliverNotifications`: accepted, partial, terminal-with-residual, filled-and-reconciled and unresolved handoff remain distinct. Deduplicate by existing receipts; notification failure cannot resubmit or erase state. Mark actual send unverified unless confirmed.
- [ ] Verify unattended mode without independent supervision rejects before first order; do not claim a Mac power-loss test proves a real remote alert. Run integration/notification/dispatch-safety regressions; commit: `feat: compose default-inert PAPER operational caller`.

## Task 6: Source closure, full regression and reviewed integration

**Files:** Existing spec, operational/evidence code/tests, package scripts, CI and this plan's evidence checkboxes only. Any new provider source module needs the documented contract first; no invented endpoint or broker field.

- [ ] Establish and record exact official initialization/current-state, entitlement, coverage and gap-recovery rules, including how the approved 30-second basis is satisfied. A support reply is evidence to evaluate, not executable instructions or sufficient merely because it arrived.
- [ ] Implement the actual source mapping/producer inside the existing structure only after those facts exist. Add fixtures derived from the documented schema and malformed/unknown/gap cases. Keep broker runtime access unperformed. If contract evidence remains absent, leave this step unchecked and report `SOURCE_INITIAL_STATE_AND_CONTINUITY_UNVERIFIED`, not complete producer.
- [ ] Wire both new offline tests into package scripts and `.github/workflows/ci.yml` using `scripts/fixtures/scoped-paper-offline.cjs`. No secrets, raw artifacts or private scopes in CI.
- [ ] Run the full validation matrix below, then one independent whole-branch review using the approved Native method. A usage-limit failure is NOT a completed review. Address concrete findings and rerun affected checks.
- [ ] Commit, non-force push and create a single execution-repo PR only after implementation approval. Include safety, additive schema/compatibility, source limits, tests and rollback sections; attach the PR. Merge only after required CI passes. No runtime dispatch/rerun.
- [ ] Confirm reviewed main commit, post-merge CI and clean intended checkout. Preserve old v1/v2 contracts, original data and unresolved runtime gates. No production state migration is part of the merge.

## Validation matrix

Run with scrubbed process environment, safe flags, existing network-denial preload and disposable owner-only test directories. Do not print private input values. All commands below are static/mock-only except dependency audit, which contacts the package registry and is not a broker/provider proof.

```text
npm run ops:test:scoped-paper-adapter
npm run ops:test:scoped-closeout-contract
node scripts/test-scoped-paper-operational.mjs
node scripts/test-scoped-paper-oversight.mjs
npm run ops:test:order-idempotency-storage
npm run ops:test:order-ledger-storage
npm run ops:test:order-state-consistency
npm run ops:test:live-readiness-blockers
npm run ops:test:paper-exit-liveness
npm run ops:test:paper-realized-pnl
npm run ops:test:protection-lanes
npm run ops:test:protection-report
npm run ops:test:paper-order-notifications
npm run ops:test:dry-run-dispatch-safety
npm run ops:safety:symbol-agnostic
npm run ops:safety:telegram-routing
npm run typecheck
npm run build
npm audit --audit-level=high
git diff --check
```

## Acceptance and approval separation

| Gate | Evidence required | Current result |
| --- | --- | --- |
| Existing component behavior | Fresh network-denied adapter/contract suites | PASS on inspected HEAD; not new operational implementation |
| Revised sequencing / implementation | Operator requested immediate next-stage work after revised plan request; preserve Native method | APPROVED_OFFLINE_ONLY_2026_10_18 |
| Full static binding | Tasks 1-6 implemented, fixtures, independent review, PR/CI | NOT_IMPLEMENTED |
| Real source validity | Documented current-state/continuity + authentic allowed observation | UNVERIFIED |
| Operational custody/exclusion | Exact state adoption, current portfolio, single-writer/attendance evidence | NOT_AUTHORIZED_NOT_VERIFIED |
| PAPER execution | Separate exact session/scope approval plus all current gates | NOT_AUTHORIZED |
| Parent goal complete | Full operational contract implemented and verified, without claiming an actual closeout | NOT_COMPLETE |

Actual order completion additionally requires broker terminal/position reconciliation, never just code/test/merge/accepted-order evidence. This exceptional five-target work does not itself complete normal Stage6 entry/holding/protection automation or Toss LIVE readiness.

Rollback before activation: revert the implementation merge without touching private artifacts or stores. After any separately authorized broker action, stop new submissions and preserve oversight/handoff; reverting code is not cancellation or permission to restore historical state.

## Draft self-review

- Spec sections 1-4: scope/authority/legacy compatibility -> Task 1, global constraints.
- Section 5: exact source production, risk/time and unresolved provider contract -> Tasks 2/6; completion explicitly withheld.
- Section 6: custody, local fence and external writer boundary -> Task 3 and runtime gate.
- Section 7: resting/partial/uncertain/terminal, host loss and time semantics -> Tasks 4/5.
- Section 8: per-route budgets and approvals -> Tasks 4/6; no new operational budget defaults.
- Section 9: negative cases/compatibility -> task fixtures and full validation matrix.
- Sections 10-11: official-source research remains evidence, not automatic authorization; original spec preserved.
- No executed task is represented by an unchecked future step; no blocked producer is relabeled complete.

## Independent draft review and baseline verification

One independent draft review completed on 2026-10-17 against commit `d9c078a9bc76c819f9d651dee49e65fe237c85ab`. Two concrete findings were accepted after checking the current code: restarted observation lacked account verification, and transport-local counters could renew the same authority after restart. Tasks 3/4 now require same-transport account binding and a durable single-use observation-authority claim with explicit account-read budget. These are plan corrections, not implemented fixes or runtime permission.

The requested independent recheck of those corrections stopped at a usage limit. Its agent handle was no longer present when checked on 2026-10-18; no live review is waiting to finish. Correction closure remains independently unverified, not PASS. Do not restart agents to bypass the limit or count the initial review as the recheck. This does not replace Task 6's required whole-branch implementation review.

Fresh baseline checks also passed: `typecheck`, idempotency storage (42 rejection cases), order-ledger storage (51 rejection cases), and notification fixtures including scoped dedup/redaction. They used disposable synthetic files/mock senders, broker requests=0 and production state mutation=0. Existing-component PASS does not check off future implementation tasks or establish provider continuity/custody.
