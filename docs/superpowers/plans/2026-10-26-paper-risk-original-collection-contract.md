# PAPER Risk Original Collection Contract Follow-up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the missing original-risk source premise before adding a collector, then connect qualified evidence to the existing attended PAPER implementation without changing risk limits or certifying a review capture as readiness.

**Architecture:** Retain the current opaque receipt/capability and six-role original-file boundary. Keep any future history capture separate from the existing five-GET capture and order transport. A source-qualification decision gates implementation; a separate runtime approval gates every actual acquisition.

**Tech Stack:** Existing Node.js 20 ESM, exact-decimal helpers, strict JSON parsing, private atomic-file patterns and network-denied fixtures. No dependency, provider, ledger or execution-engine addition.

**Spec:** `docs/superpowers/specs/2026-10-26-paper-risk-original-collection-amendment-design.md`

**Parent:** `PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1`

**Method:** Native, already selected. Do not ask for the method again. This plan is for review, not new implementation or runtime permission. The earlier three-task implementation approval remains valid in its original scope.

**Workspace:** `/Users/givet-bsm/Documents/GitHub/.worktrees/alpha-exec-engine/complete-private-evidence-capture`, branch `codex/paper-operational-binding-design`, HEAD `a7a18123212048767e4e6ea2b4ce1e2f93078039` with preserved uncommitted implementation. Do not switch to or overwrite the primary checkout.

## Global Constraints

- Execution defaults remain `READ_ONLY=true`, `EXEC_ENABLED=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`, `MARKET_GUARD_MODE=observe`; no .env/credential reads in planning or tests.
- Preserve all original evidence, attempts and state. No broker/provider requests, workflow dispatch, cache operation, actual notification, order/protective-child mutation or state adoption under this plan's current authority.
- Five existing limited-control identities remain the closeout scope; no manual position is added. Full-portfolio risk measurements must not silently omit other positions.
- Daily loss/drawdown use the account observation cutoff; decision time separately enforces the explicit age bound <=30 seconds. Do not invent zero-latency proof or change risk limits, lookbacks, adjustment basis or timestamps.
- Proposed separate capture: account<=2, clock<=1, calendar<=1, history<=2, activity pages<=4, total GET<=10, page size100. No retry. These are unapproved ceiling proposals, not calls to perform.
- Reuse proposed 3-second/8-MiB response and 300-second attempt ceilings. Exceeding coverage or budget yields incomplete, never automatic retry or an enlarged scope.
- Any future raw originals remain in a new owner-only local directory. No identifiers, values, bodies, credentials or private paths in public CI/report output.
- Collection success always leaves execution and risk-verification flags false. Hash pins do not create source authenticity.
- No Stage6/OOS change, safety bypass, new planner/provider abstraction or analysis/Harvester edit. Do not reset this worktree or merge incomplete work.

## Review Focus

1. Interval-start labels interpreted as equity observation time: reject until exact interval-end mapping is supported.
2. Empty/exhausted created-time activity results interpreted as complete effective-time capital flows: keep these claims separate.
3. Dividends, fees, ambiguous journals or security transfers treated as deposits/withdrawals: reject unsupported economic classification.
4. New capture pagination or routes leaking into a previously approved no-pagination/order path: preserve both old allowlists and budgets.
5. Pinned or forged source documents promoted to sealed readiness without producer/custody verification: reject substitution, including after restart.

## Task 1: Resolve the source admission premise once

**Files:** Review the spec, the original three-task plan, `scripts/lib/scoped-paper-risk-evidence.mjs`, `scripts/lib/scoped-paper-operational.mjs` and the four linked official references. Update the spec's qualification findings only; no production-code change in this task.

**Inputs:** The explicit measurement policy and its equity sampling grid, the actual `lossAndDrawdown` call site, documented portfolio-history/activity semantics and available producer/custody evidence. No private account request.

**Output:** A reviewed source-qualification matrix in the spec. Each of the following six rows must name an exact source/field, its meaning, rejection condition and supporting evidence, or explicitly be UNSUPPORTED:

1. equity interval end and session grid;
2. current account observation cutoff and permitted freshness;
3. external-capital type and sign;
4. effective time or compatible interval allocation;
5. complete reported coverage at the same equity cutoff;
6. original producer/account/custody binding.

- [x] Confirm operator-reported original absence and the old capture's five routes. Do not ask for those files again.
- [x] Inspect public schema/time/pagination documentation without broker calls. Document that ordinary schemas alone do not establish all six rows.
- [x] Trace replay cutoff to `currentAccount.observedAt`; run the existing delayed-observation fixture to avoid adding an unsupported zero-latency gate.
- [x] Assess each row against the specific original-source contract, not a local completeness assertion. The official SDK implementation supplies no event-level time or complete-through evidence beyond the public reference. Record unsupported mappings rather than fabricating a resolution.
- [x] Record exactly one result: `SOURCE_MAPPING_UNSUPPORTED_REQUIRES_CONTRACT_DECISION`; spec section 7.1 identifies row 4 (effective-time/event representation) as first unsupported, row 5 (same-cutoff coverage) as unsupported and row 6 as our producer/custody gap.

**Initial result (2026-10-27):** The six-row qualification assessment completed with a negative disposition. Source admission was NOT_QUALIFIED; Task1 was not PASS and Task2 remained prohibited. The subsequent V2 authorization and remaining boundary are recorded below; do not ask for the already completed representation review again.

**Stop rule:** Without qualification, do not implement Task2, perform a review capture hoping to discover a guarantee, or fabricate a passing Task3 source fixture. The operator's current-cutoff decision below controls further work; do not reopen a measurement waiver without a new request. A support reply is not the only acceptable evidence. Do not demand future-data immutability beyond the approved risk contract, but do not treat undocumented coverage as known.

**V2 implementation follow-up, 2026-10-28:** The operator subsequently approved
offline interval-representation implementation. The written contract is
`docs/superpowers/specs/2026-10-27-paper-interval-risk-measurement-design.md`.
It preserves the old evaluation grid, formulas, limits and current-gap rejection
while representing supported external flows as interval sums. The pure replay
and fixtures now pass the local regression. That resolves the internal need to
invent per-event times; it does not prove that the proposed provider intervals
have the required alignment, current coverage or custody.

Source admission remains NOT_QUALIFIED. The primary residual is row5: complete
external-capital coverage through currentAccount.observedAt. Current fresh equity
and an older completed history interval are not a same-cutoff risk observation.
No original-source producer was authorized by the V2 reply. Task2 stays gated;
do not repeat diagnostics, assume zero flows in the uncovered tail or treat an
API-call approval as a solution to the semantic mismatch.

**Direct operator decision, 2026-10-28 (Asia/Seoul):** Retain current-cutoff risk
verification and block execution until qualifying evidence is available.
Completed-interval risk plus fresh current exposure was NOT selected. No new
measurement waiver/design, source-collection implementation or acquisition is
authorized by this answer. Do not re-request the already resolved V2 decision.

Reopening the dependent source/caller work requires genuinely new evidence that
supports the account-bound external-capital partition through
currentAccount.observedAt, its equity basis and original producer/custody.
An older complete bucket, empty activity result, fresh quote, equal account
reads or a caller-supplied completeness flag is not that evidence. V2 and its
verified offline fixtures remain intact; risk caps, formulas, grid and current
gap rejection are unchanged. Parent status remains BLOCKED, not complete.
No repeated account probe, supplier poll, RTH wait or new automation is scheduled.
Any later collection or execution still requires its own scoped authorization.

## Task 2: Conditional bounded original producer

**Entry conditions:** Task1 `SOURCE_MAPPING_QUALIFIED`, explicit offline implementation approval covering this amendment, and a concrete supported original schema. This section specifies the fixed implementation boundaries, not an authorization to build now.

**Files:** Create `scripts/capture-paper-risk-originals.mjs` and `scripts/test-paper-risk-originals.mjs`; add only their offline test entry to `package.json` and existing CI after review. Inspect/reuse safe private I/O patterns from `capture-paper-private-evidence.mjs`. Its routes, approval phrase and behavior remain unchanged; do not export a new generic provider client.

**Interfaces:** `collectPaperRiskOriginals({scope, scopeSha256, approval, outputDirectory, fetchImpl, clock, credentials}) -> Promise<SafeAggregate>`. The scope pins exact account/terms/code, approved request parameters and the Task1 mapping contract. The actual invocation approval schema/phrase must be reviewed in the implementation plan after qualification, not borrowed from an old capture. No executable CLI or .env loading is added by default.

- [ ] Write failing fixtures for import/default zero I/O, old approval rejection, missing credentials before request, wrong account/host, input/code drift, existing-attempt rejection and owner-only atomic output.
- [ ] Add bounded-transport fixtures: counts `[2,1,1,2,4]` total<=10; no retries; unsupported history window before network; cursor advance/duplicate/loop rejection; full last page incomplete; malformed/oversized/timeout responses; no raw or private stdout.
- [ ] Add source mapping fixtures pinned to Task1's actual schema: interval label/end and early close, gaps/duplicates, date-only/late-posted flows, unsupported journals/transfers and empty cash-flow maps. These address Review Focus1-3; no synthetic `complete=true` can satisfy source provenance.
- [ ] Run `node scripts/test-paper-risk-originals.mjs` under the existing network-denial preload; first observe the missing implementation fail, then implement the minimum bounded read-only collector with original and derived views separated.
- [ ] Repeat the test to PASS. Assert every safe result has `executionAuthorized=false`, `brokerSubmitAllowed=false`, `riskEvidenceVerified=false` and one of the spec's capture dispositions. Confirm no order route can be selected and old capture fixtures are unchanged (Review Focus4).
- [ ] Stage only approved producer/fixture/test-wiring changes, inspect for private evidence and commit after passing tests. Do not execute the collector, push/merge unrelated work or create a ready-to-run approval package at this stage.

**Deliverable:** A complete review-only original producer for supported schemas, not a source readiness certificate. Do not write placeholder mappings for still-unsupported fields.

## Task 3: Conditional original-source binding and parent integration

**Entry conditions:** Supported mapping/custody contract, approved implementation and valid producer fixtures. Real originals are required for any later runtime claim but not replaced by synthetic test data.

**Files:** Reuse `scoped-paper-operational.mjs`, `scoped-paper-evidence.mjs`, `scoped-paper-risk-evidence.mjs` and the original plan's attended test/files suites. No second replay engine or state store. Original parent Task1's `buildAttendedRiskEvidence({scope,files,receipts,transport,clock})` and remaining Task2/3 interfaces stay canonical.

- [ ] Write rejection fixtures for missing originals, forged provenance, account/terms drift, interval/adjustment mismatch, double-counted cash adjustments and replaying a cloned or previous-generation seal (Review Focus5).
- [ ] Add one supported-schema positive fixture with original records and audited producer/receipt/custody lineage. Label it synthetic; never report it as account proof. Preserve source observation time separately from decision evaluation time.
- [ ] If one authentic response serves equity and flows, specify and fixture-test an additive shared-source reference contract before changing the six-role loader; do not duplicate raw bodies or relax arbitrary duplicate-path rejection.
- [ ] Implement the source adapter and existing risk-seal interface only after the supported mappings above are concrete. Repeat affected tests; no PASS-label adapter or permanent BLOCKED stub substitutes for this step.
- [ ] Resume the original three-task plan at source sealing, V3 reservation/controller preservation and actual attended caller integration. The pending seven-state result partition, stop/observer/notification composition and whole-branch independent review remain required; do not replace them with this smaller producer task.
- [ ] Run the full original plan's matrix and actual related CI after authorized non-force push. Merge only with complete scope, review and CI evidence; no workflow dispatch or state migration.

## Verification and runtime separation

For future implementation, use the established safe environment and
`NODE_OPTIONS="--require=$PWD/scripts/fixtures/scoped-paper-offline.cjs"`.
The minimum affected matrix is the new original-producer fixture, existing
`ops:test:paper-private-evidence-capture`, `ops:test:scoped-closeout-contract`,
`ops:test:scoped-paper-adapter`, `ops:test:scoped-paper-operational`,
`ops:test:paper-iex-readonly-probe`, typecheck, build and `git diff --check`.
The original full matrix remains mandatory before parent completion; this is
not a substitute. If a test is missing from package scripts, use its exact node
entry point until reviewed test wiring is added; never run a production command
as a test.

Actual collection requires separate exact read-only authorization with account,
code/config/window pins, request/page ceilings, private retention and attempt
preservation. A collection approval does not approve custody adoption or orders.
Do not schedule it now, restore a cache or reuse an old authorization. After a
future capture, qualification/currentness is evaluated from its actual originals;
`ORIGINALS_CAPTURED_REVIEW_ONLY` cannot complete the missing-original or lifecycle
goal. A real PAPER attempt remains a later independent approval boundary.

## Self-review and handoff

- Spec1-2 authority/reuse -> global constraints and Task1; no blanket approval expansion.
- Spec3-6 semantics, budgets, custody -> Task1 six-row qualification and Task2 bounded fixtures; Task3 preserves authentication and replay separation.
- Spec7 finite decision -> Task1 explicit unsupported result, not repeated acquisition.
- Spec8 tests -> Task2/3 cases and original whole-branch matrix; all five Review Focus classes have owners.
- The unresolved original schema/approval details are intentionally **not** guessed. Task2 is conditional and cannot be executed from this plan until Task1 qualifies the mapping and the concrete implementation scope is reviewed. This plan is not yet an executable collector implementation plan.
- Existing Native method is preserved. No new independent implementation review has occurred; the earlier builder check covered the design only.

Planning deliverable: the ordered work, exact admission conditions and incomplete
items are explicit. Parent completion still requires its original source/caller,
review, CI and authorized integration evidence. Plan approval never marks those
done or authorizes an order.
