# STEP 5C-4D-3M — request-bound untrusted GitHub evidence bundle

**Baseline:** PR #74 merged into `main` as `d1f8a85bc339bd3c4eb2e1977914e417d76096ef`; post-merge main push CI #43024054983 SUCCESS.

**Mode:** SOURCE-ONLY / OFFLINE / READ-ONLY. Existing PAPER and LIVE mutation workflow HOLD remains in force.

## New protection: bind the capture receipt to the selected evidence content

3L verified a digest of selected non-secret GitHub REST evidence fields, but did not include the separate capture receipt's `capturedAt` timestamp in that fingerprint. A caller could change the receipt time to a new, still-chronologically-plausible value while the 3L selected-content hash continued to match.

3M adds `scripts/lib/paper-evidence-bundle-context.mjs` with a **separate, untrusted, domain-separated SHA-256 bundle binding** over:
1. Existing 3L selected snapshot digest (with all reviewed 3J/3K validity preconditions).
2. A strict-schema capture receipt digest, including `capturedAt`, Run ID, Job ID and Deployment ID.
3. The exact caller-requested repository, branch, Environment, source SHA, Run/Job/Deployment IDs, attempt and workflow path.

The combined receipt is valid only with `evidenceOrigin=CALLER_SUPPLIED_UNVERIFIED`, `signer=NONE`, `approvalClaim=NONE`, `replayProtection=UNPROVEN`. Changed capture time without a matching digest, swapped request context, ambiguous receipt schema, extra positive authority fields and broken component evidence cause **DENY**.

A syntactically consistent, self-recomputed bundle returns **HOLD**, never execution authority. Every output explicitly sets GitHub origin authentication, Job/Deployment approval, anti-replay enforcement, broker writer exclusivity, PAPER state mutations and LIVE orders to false.

## Evidence required before operational authorization could be considered

| Gate | Source that would be needed | Status |
|---|---|---|
| Actual GitHub data origin | Authentication of GitHub-origin transport and protected collector identity, independently verifiable provenance | UNPROVEN |
| Environment enforcement | Trusted snapshot of review rules, branch restrictions and bypass policy at the relevant run attempt | UNPROVEN |
| Exact Job ↔ Deployment | An authenticated join binding Job ID, run attempt, Deployment ID, Environment and approver decision | UNPROVEN |
| Full broker Writer coverage | Independent broker account/key inventory plus every direct, legacy, scheduled and external mutation client | UNPROVEN |
| Account-wide Writer exclusivity | Enforced shared fencing/lease checked at each broker mutation boundary and negative crash/race test | UNPROVEN |
| Anti-replay | Trusted monotonically enforced capture/authority sequence and independently managed receipt validation | UNPROVEN |
| Human operational approval | Separate explicit decision after risk, account, source and custody checks; approval cannot be inferred from a code review or CI | NOT REQUESTED / HOLD |

No item is marked verified on the basis of GitHub CI, matching mock records, unsignable digests or self-declared receipts.

## Test and invariant contract

`scripts/test-paper-evidence-bundle-context.mjs` includes a test where 3L still returns HOLD after `capturedAt` changes but 3M returns DENY. It also rejects context drift and unauthorized proof claims, checks malicious rehash remains HOLD, and verifies unknown secret-bearing source fields are never returned.

The existing GitHub custody CI imports this offline test; the admission baseline pins the new two files plus updated test importer. Its 17 Workflow / 21 Job / 10 open blockers, `operationalHold=true` and review deadline `2026-12-11T00:00:00Z` are unchanged. No workflow YAML, broker API, GitHub Environment, real paper-state ref, Secrets, deployment job or credential state is modified.

**Next gate:** Draft CI success, independent final diff review, fresh explicit source merge approval, then post-merge `main` CI. Do not dispatch any existing PAPER mutation Workflow.
