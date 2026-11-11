# STEP 5C-4D-3F — Job deployment evidence and account-wide writer exclusion

**Baseline:** main `8d76e162f651a8e7cebc4de6c75aee3920cd9e8d`; PR #67 merge push CI SUCCESS, 2026-11-11.
**Status:** SOURCE-ONLY / OFFLINE / ALL OPERATIONAL ACTIONS HOLD.

## Contract
- `scripts/lib/paper-deployment-writer-exclusion.mjs`: pure evidence-shape inspector. It does not call GitHub, broker, clock, files, or any mutation capability. It refuses unbound run/job/deployment/environment identifiers and incomplete account/scope writer inventory.
- `scripts/test-paper-deployment-writer-exclusion.mjs`: deterministic positive-shape HOLD fixture and negative DENY cases for wrong head, run, attempt, job, deployment, status, missing job attestation, missing legacy writers, duplicates, account mismatch, missing cryptographic evidence digest, unknown writer disposition, external inventory and durable claim. Imported through the existing GitHub custody CI test runner.
- Workflow admission baseline includes the new source and tests; main-only 17 workflow / 21 job coverage, 10 blockers, expiry 2026-12-11, and `operationalHold: true` remain unchanged. No operational YAML, Secrets, keys, branch rulesets, PAPER state or broker orders changed.

## Key distinction: matching REST payload is NOT authenticated deployment
A deployment `sha`, `environment`, `ref` and successful deployment status can be correlated with a run, but do not independently prove that the named *job* received a trusted Environment approval. The explicit `jobDeploymentAttestation` is a **negative placeholder only** (`UNVERIFIED_ONLY`, `verified: false`). Any affirmative, fabricated, duplicate, missing or ambiguous evidence is DENY; even a matching synthetic snapshot remains HOLD. Real evidence requires an independently trusted deployment-to-job binding and approver identity provenance, with approval timestamps relative to the exact job attempt.

## Writer scope: no finite source list proves all external writers
The fixture inventory exercises exact account SHA256 / scope SHA256, unique writer identifiers, complete legacy ID coverage, tested gate/retirement disposition and dedicated custody writer designation. **`complete:true` is caller-supplied and not proof of account-wide discovery**; external API clients, broker credentials, manual CLI/API writers, other repositories, schedules, direct cache/ledger writers, existing runners, and out-of-band human actions require independent evidence. The historical inventory identifies dry-run, market-guard, ledger migration, active recovery, OCO submit/cancel and separate direct cache writers as conflicting or potentially conflicting pathways. One local claim, GitHub concurrency group, cache sentinel or synthetic fingerprint cannot fence them all.

## Mandatory remains HOLD
All outputs set `authenticatedJobDeploymentVerified=false`, `externalEnvironmentPolicyAttested=false`, `brokerAccountOwnershipVerified=false`, `accountWideWriterExclusionVerified=false`, `legacyWriterDecommissionVerified=false`, `durableWriterClaimVerified=false`, `brokerSubmitAuthorized=false`, `stateMutationAuthorized=false`, `operationalEligible=false`.

**Before any future promotion:** prove trusted GitHub job-specific deployment approval, separately inventory all broker credentials/external writers, fence every mutation endpoint against a single account-wide ownership lease, verify fencing survives retries/crashes, reconcile current broker state and risks, and obtain separate human approval. No such promotion is provided by this PR.

Rollback is source-only; never delete existing state or dispatch historical PAPER jobs.
