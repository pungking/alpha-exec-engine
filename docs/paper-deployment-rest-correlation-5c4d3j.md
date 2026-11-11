# STEP 5C-4D-3J — bounded GitHub deployment REST correlation (HOLD)

Starting main `c360c7f7c8f7337a5a21dfde2c9e6979af245e03`, PR #71 merged; push CI #43018050441 SUCCESS.

## Purpose and what this is NOT

3E/3F/3G/3H/3I established synthetic evidence contracts, not real operational approval. This change adds a **read-only API preparation surface** capable of collecting five GET-only GitHub REST resources if a human-approved caller injects an appropriate token, fetch and AbortSignal. The repository change itself never invokes those endpoints and never reads env secrets. CI uses synthetic responses only.

The new code **does not authenticate API source provenance**: an injected fetch can be mocked, intercepted or supplied by an untrusted caller. Correlating GitHub records by run, job, deployment, SHA, environment and approval history cannot prove that the specific job was approved to deploy, that environment policy was enforced or that the broker account has exclusive Writer ownership. The output deliberately keeps these verification bits false.

## Explicit allowlisted REST routes
- `GET /repos/pungking/alpha-exec-engine/actions/runs/{runId}`
- `GET /repos/pungking/alpha-exec-engine/actions/jobs/{jobId}`
- `GET /repos/pungking/alpha-exec-engine/deployments/{deploymentId}`
- `GET /repos/pungking/alpha-exec-engine/deployments/{deploymentId}/statuses?per_page=2`
- `GET /repos/pungking/alpha-exec-engine/actions/runs/{runId}/approvals`

Exact id, run attempt=1, main code SHA, four reviewed protected admission Workflow paths, protected HOLD job identity, single approved reviewer entry for the expected environment, deployment/status shape and status cardinality are enforced. Unexpected, missing or ambiguous data is DENY. No POST/PATCH/DELETE, redirects, fallback hosts, pagination chasing, automatic token loading or silent API retries.

Each streaming REST response is bounded to 256 KiB and all five together to 1 MiB. Invalid/missing media type, HTTP status, JSON, stream or Content-Length is rejected. An AbortSignal must be supplied by the caller. A noncompliant injected fetch may ignore cancellation, so the function **does not promise an unconditional wall-clock deadline**. No raw REST payloads, credentials, secrets or provider errors are emitted by the summary.

## Invariants

- Matching mocked or real-looking responses -> `HOLD_UNATTESTED_GITHUB_REST_CORRELATION`.
- Any mismatch, invalid transport or failed read -> `DENY_GITHUB_REST_CORRELATION`.
- `verifiedTransportOrigin=false`, `authenticatedJobToDeploymentBinding=false`, `environmentPolicyIndependentlyAttested=false`, `accountWriterExclusionVerified=false`, `operationalEligible=false`, `brokerSubmitAuthorized=false`, `stateMutationAuthorized=false`, `liveTradingAuthorized=false`.
- This is not a deployed, wired, credentialed or scheduled collector. No source code or fixture should be construed as an approval record.

## Test boundary and follow-up

`scripts/test-paper-deployment-rest-correlation.mjs` exercises the pure shape inspector and an injected mock HTTP fetch with GET-only route assertions, bad approval history, invalid Job/Run/Deployment/Status, wrong content type, malformed JSON, mismatched content length and missing signal/credentials. Imported through the existing offline GitHub PAPER custody CI. Keep the 17-workflow/21-job/10-open-blocker baseline, operational HOLD, and review expiry `2026-12-11T00:00:00Z` unchanged.

Before any trusted attestation in a future step, define a reviewable, externally verifiable provenance contract, exact Job-to-Deployment evidence binding, Environment policy/branch protection attestation and credential/writer fencing verified at the broker mutation boundary. Even then, require human operational approval and independent risk/source/account checks before any PAPER execution. All LIVE orders remain disabled.
