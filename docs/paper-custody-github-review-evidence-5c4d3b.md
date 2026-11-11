# STEP 5C-4D-3B — GitHub workflow review history evidence boundary

Status: **READ-ONLY / SOURCE-ONLY / OPERATIONAL HOLD**.
Starting reviewed main SHA: cf856931c73e2d27c94287881bb271d501121b3e (PR #63 merged and its push CI succeeded).

## Objective

Bind the GitHub **workflow run identity** and **required-review history** to a
fixed scoped PAPER manual workflow, without trusting a user-entered approval string.
This implementation is not an admission release, not an active runtime caller
and does not prove any real account-wide writer exclusion.

The REST endpoints are documented by GitHub:
- GET /repos/{owner}/{repo}/actions/runs/{run_id}
- GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals

They require an appropriate Actions read permission in a private repository.
The module takes an explicitly supplied token and fetch implementation, has
no credential, endpoint or environment defaults from process env, cannot
dispatch, review, order, create a branch or modify Secrets.

## Checked facts and limitations

- Exact repository and head repository: pungking/alpha-exec-engine
- Exact code SHA and one approved allowlisted workflow path
- Exact run ID, main branch, manual workflow_dispatch, attempt 1, no PR
- A single required-review history record for environment
  PAPER_CUSTODY_APPROVAL with pinned environment ID 26847620868 and GitHub
  user login pungking and a positive user ID
- Rejected, ambiguous, duplicated, missing, wrong-env or wrong-user history
  is denied; no blind re-run adoption
- API requests are GET-only, with explicit HTTPS host, response streaming
  byte bounds, no retry, redacted failures
- A passed review-history match returns
  HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY, not PASS/READY
- Arbitrary injected objects are only *claims*, not authenticated GitHub reads
- The accountScopeSha256 is checked for shape but is **not proved by GitHub review history**
- This code does NOT retrieve an independent environment config/protection
  snapshot, deployment reviewer approval for a specific job, ledger/state HEAD,
  current broker/source/risk/cashflow proof or ongoing writer exclusion.
- The current Job approval workflow still unconditionally exits 1, provides no
  authorization output and remains protected. Existing 17 workflows and 21 jobs
  are unchanged.

## Required later before any real PAPER operation

1. Verify current GitHub Environment settings and authorized reviewer identity,
   exact job deployment and approval semantics, source SHA, branch and run attempt
   via a trusted approved context, not an untrusted JSON fixture.
2. Bind account scope, source/risk and expected state predecessor to a controlled,
   single-use action; enforce independent, account-wide writer exclusion.
3. Approve and provision dedicated key and paper-state genesis through separate
   operator change control; preserve all existing PAPER protection rules.
4. Acquire and verify a durable writer CLAIM and fully persisted checkpoint
   before any broker-side request, including unknown/ambiguous outcomes.
5. Complete P0 original ownership, cash-flow, halt/resume and real risk proof;
   grant **distinct**, explicit user approval for a supervised PAPER operation.

Rollback is a source PR reverting this diagnostic only. It does not imply
checkpoint deletion, re-enabling old writers, order cancellation or source-adoption.

The Admission Baseline must pin the two new files and updated custody test
importer, preserve all 10 blockers, 2026-12-11 UTC expiry, HOLD=true and
zero operationally eligible jobs. The current PR CI uses only synthetic data.
