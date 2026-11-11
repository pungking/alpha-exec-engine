# STEP 5C-4D-2A — PAPER mutation admission: offline deny contract

Status: **OFFLINE CONTRACT ONLY / OPERATIONAL HOLD**. Parent PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1 remains blocked.
Starting approved main: 995bbdb40b68cbc9376735873b5da51bd8e8a0ad.
This change does not attach a GitHub Environment to any job, grant writer rights, dispatch actions or submit/restore state.

## Explicit reviewed targets (exact workflow + job + operation)

| Workflow | Job | Operation | Existing side effect | Disposition |
| --- | --- | --- | --- | --- |
| paper-oco-submit-canary.yml | submit-canary | PAPER_OCO_CANARY | PAPER POST then DELETE attempt | HOLD |
| persistent-oco-repair-submit.yml | submit-persistent-repair | PAPER_OCO_PERSISTENT_REPAIR | PAPER POST, stays open | HOLD |
| ledger-filled-migration.yml | ledger-filled-migration | PAPER_LEDGER_MIGRATION | ledger/idempotency cache writes | HOLD |
| paper-five-row-active-limited-state-recovery.yml | recover | PAPER_FIVE_ROW_STATE_RECOVERY | limited recovery and cache writes | HOLD |

These four workflows still have **no** job-level PAPER_CUSTODY_APPROVAL Environment reference. Their existing dispatch inputs and approval phrases are not trusted authorization for custody. The existing one-shot recovery's historical change allowlist remains unchanged; it is not repurposed.

## Pure module semantics

scripts/lib/paper-mutation-admission-contract.mjs exports an exact four-target allowlist and a **non-authorizing** inspector. No network, fs, clock acquisition, process.env, GitHub API, broker API or mutation operations. Inputs are in-memory fixtures and are **not trusted**.

It inspects:
- fixed repository/refs/workflow/job/operation and PAPER approval environment name;
- request ID, run/attempt, manual event, exact code SHA and account/scope fingerprints;
- claimed approval/deployment/reviewer binding (a claim, **not** an authenticated GitHub environment review);
- expected ciphertext state commit/genesis, writer claim and stale/ambiguous state flags;
- P0 source/risk/cash-flow/trading-status requirements and predecessor persistence assertions;
- timestamp coherence, deadline and duplicate request consumption;
- strict key sets; no input payload values are returned in diagnostics.

An all-green *synthetic* input returns HOLD_OFFLINE_EVIDENCE_UNTRUSTED, never READY.
An invalid input returns DENY_CONTRACT_INVALID with reason codes only.
Every result has operationalEligible=false, brokerSubmitAuthorized=false,
stateMutationAuthorized=false, environmentApprovalVerified=false and durableWriterVerified=false.

**Security boundary:** ordinary JSON claims, usernames, booleans or workflow approval input fields cannot prove GitHub reviewer identity, deployment approval, a broker-side exclusive writer, actual current risk, checkpoint linearizability or external source completeness. This code is NOT an enforcement hook in existing submit workflows. Future integration must use actual trusted GitHub environment identity/protection checks, exact current main revision, runtime receipts and durable writer-claim protocol before any side effect. An inspector PASS must never become an authorization token.

## How CI validates without changing operational workflows

The existing package command ops:test:paper-workflow-admission already runs in sidecar-ci.
Its existing test script imports the new negative-fixture suite after the 65 existing checks.
The previously reviewed, closed-world baseline is explicitly revised to pin all three
changed/new test/inspection source files. No new workflow, schedule, runtime default, secret,
npm dependency, package command, state branch, API or job Environment is added.
Its original 17 workflow hashes, 85 reviewed evidence hashes, original review deadline
(2026-12-11 UTC), operationalHold=true and 10 baseline blockers must remain unchanged.
A new anchored SHA-256 commits to the reviewed manifest; not auto-generated at runtime.

## Still blocked / separate STEP 5C-4D-2B

1. Job-level protected Environment binding and authentic reviewer check, prior to any side effects.
2. Trusted exactly pinned main/reviewed workflow revision; no artifact 'latest successful run' inference.
3. Durable exclusive claim/checkpoint protocol and legacy writer exclusion, not concurrency alone.
4. Actual current broker source qualification, full cash-flow cutoff and halt/resume evidence.
5. Independent runtime negative tests; separately approved live Github state genesis/cutover.
6. A separate human decision for PAPER execution, and a distinct future LIVE approval.

Rollback: revert the source/test/docs/baseline changes in a reviewed source PR. Never
delete checkpoints, unlock the paper-state branch, restore old ledgers or cancel orders.
