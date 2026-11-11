# STEP 5C-4D-3E — protected GitHub job and encrypted CLAIM binding

**Status:** SOURCE-ONLY / OFFLINE TESTS / OPERATIONAL HOLD.
Starting main: 10efcc768263f09f1f3fe9d8122bb13daccf6ea8 (PR #66 merged, main push CI SUCCESS).

## Objective and design boundary

3A supplied a bounded Git REST request wrapper. 3B checked run and required-review history. 3C added account/run/scope fingerprint consistency. 3D added GET-only encrypted genesis-to-C LAIM cryptographic checkpoint lineage validation. The next safe improvement is a single **read-only diagnostic** that joins the protected GitHub environment policy, reviewed manual run, the named HOLD admission job, and the decrypted encrypted CLAIM identity.

This is **not** an operational admission or job deployment attestation. No execution token, broker permission, current-account reconciliation or operational key deployment is created. Existing four risky manual workflows continue to unconditionally exit 1 and cannot submit orders or change PAPER state.

## Modules

- scripts/lib/github-paper-protected-lineage.mjs: read-only preflight, pure synthetic-data inspector, exact fixed repository/environment and negative diagnostics. Requires explicit token, private key and injected fetch function.
- scripts/test-github-paper-protected-lineage.mjs: self-contained mocked GitHub REST + encrypted checkpoint tests; may create simulated CLAIM data **inside an isolated in-memory fixture** before inspection, never on GitHub.
- scripts/fixtures/github-paper-custody.mjs: optional fixture-only identity override to simulate the actual repository/workflow; preserves default synthetic fixture behavior.
- scripts/test-github-paper-custody.mjs: imports the new offline suite through existing CI.
- Admission Baseline pinned to the reviewed source/test modifications; original 17 workflows / 21 jobs, 10 blockers, operationalHold true, eligible 0, and 2026-12-11 review expiry remain unchanged.

## Exact evidence fetched (GET-only)

1. Official workflow run and required-review history (reuses existing 3B) with exact run ID, main, SHA, attempt 1 and allowlisted manual workflow.
2. Environment PAPER_CUSTODY_APPROVAL: exact pinned numeric ID, expected required-reviewer identity, no admin bypass and a custom branch-policy mode.
3. Environment deployment branch policies: only main as a single branch entry.
4. Original approval HOLD job: exact job ID, run ID, run attempt, code SHA, protected approval job name, completed failure.
5. Encrypted Git paper-state ref + commits + trees + blobs through the constrained Git REST boundary, verified by existing 3D decryption / integrity / ledger lineage checks. Current plaintext CLAIM must match exact account / scope / attempt / run / workflow and reviewed code digest.

The proof is **bounded and diagnostic only**. The environment's *reported* settings are checked, but this method does not independently prove that the specific Job ran under that environment's deployment, nor that the passed API-shaped data is authentic when fetch is mocked. The GitHub job GET API does not itself prove environment-to-job deployment approval; obtaining the actual deployment evidence or a separately trusted runner attestation is required.

A failed, missing, stale, ambiguous or tampered input returns DENY; a synthetically perfect case returns **HOLD_PROTECTED_LINEAGE_NOT_OPERATIONAL_AUTHORITY**, with:
- authenticatedJobDeploymentVerified=false
- externalEnvironmentPolicyAttested=false
- brokerAccountOwnershipVerified=false
- sourceRiskCashflowVerified=false
- accountWideWriterFenced=false
- actualPaperStateProvisioned=false
- brokerSubmitAuthorized=false
- stateMutationAuthorized=false
- operationalEligible=false

## Operational blockers and next steps

Current connected GitHub app does not expose read-only GET environment/deployments API; no claim is made that the live protected Environment configuration was inspected in this task. This PR does not change or create any environment, reviewer, key, secret, state ref or schedule.

Before any actual PAPER state writes or broker submit:
- independently verify current Environment settings, reviewer protection, and exact **job-specific deployment approval** in a trusted runner context;
- establish dedicated key custody and separately approved genesis/ref creation; use real broker account/source/risk/cashflow proof;
- prove all legacy and external direct writer paths cannot race this protocol;
- perform fresh account state and pre-wire reconciliation, poison ambiguous acknowledgment paths, and require separately scoped human approval for each operational action;
- keep LIVE explicitly disabled absent its own separate approval.

Rollback this PR using a reviewed source change only. Do not touch the historical state, cache or uncertain broker orders.
