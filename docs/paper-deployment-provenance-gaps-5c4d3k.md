# STEP 5C-4D-3K — REST byte integrity and GitHub deployment provenance-gap triage

Starting `main`: `85c69357c9337602622e3e33485776e8f345f71b` (PR #72 merge; push sidecar-ci #43020590818 SUCCESS).

**SOURCE ONLY / OFFLINE TESTS / ALL PAPER & LIVE EXECUTION HOLD**

## Change 1 — exact HTTP response length
The read-only `scripts/lib/paper-deployment-rest-correlation.mjs` now checks that any supplied decimal `Content-Length` equals the exact consumed bytes, after already bounding each streamed response to 256 KiB and the total to 1 MiB. A smaller or larger declaration is DENY; the previous maximum-only check could accept inconsistent declared lengths. No API is automatically called and neither token nor response payload is logged. Existing GET-only route allowlist, caller-injected AbortSignal, no-retry/no-redirect contract and operational HOLD remain unchanged.

## Change 2 — timestamp triage, not approval attestation
`scripts/lib/paper-deployment-provenance-gaps.mjs` composes the reviewed 3J REST-shaped correlation contract with syntactic *caller-supplied* capture-receipt and UTC timeline checks.

It looks for explicit `run.created_at`, `run.run_started_at`, `job.started_at`, `job.completed_at`, `deployment.created_at`, deployment status `created_at`, and optionally review history `created_at`. It compares only grounded within-stream ordering (run before job, job start before completion, deployment before its status, run before approval, receipt after observed evidence). Missing timestamps are reported as **proof gaps**, invalid/contradictory observed timestamps are DENY. Caller receipt fields must remain explicitly `CALLER_SUPPLIED_UNVERIFIED` and `attestation=NONE`; no verified or credentialed claim can be smuggled through.

The following are **unresolved proof gaps even on successful offline shape checks**:
- An injected HTTP client or REST-shaped snapshot is not independently authenticated GitHub origin.
- A single workflow approval history record cannot cryptographically identify and bind the specific Job to a Deployment.
- A Deployment status of `success` and a separate protective Job result of `failure` may concern different processes; the status cannot be attributed to that Job without stronger evidence.
- No Environment policy/bypass/branch rule attestation is proven at run time.
- No broker credential reachability audit or account-wide writer fencing has been performed.

A response may omit a root review timestamp; absence is not silently fabricated. GitHub deployment status history is limited by platform retention, so a current response cannot prove historical completeness.

## Test and invariant contract

Tests are offline and use synthetic snapshots:
- `scripts/test-paper-deployment-rest-correlation.mjs` has two added negative Content-Length cases.
- `scripts/test-paper-deployment-provenance-gaps.mjs` covers chronological contradictions, missing dates, incorrect run/job/deployment identity, forged receipt authority, injected actor and capture-time ordering.
- Imported through the existing custody contract CI and pinned in `config/paper-workflow-admission-baseline.json`.
- Keep 17 Workflow / 21 Job, 10 open admission blockers, reviewBy 2026-12-11 and `operationalHold=true`; unchanged workflow YAML.

Outputs only `HOLD_UNAUTHENTICATED_JOB_DEPLOYMENT_PROVENANCE` on structurally acceptable snapshots, else `DENY_PROVENANCE_SNAPSHOT_INVALID`. In both cases: Job deployment authentication, Environment attestation, broker writer exclusivity, PAPER/LIVE submit authorization and production state changes remain **false**.

No real GitHub API requests, broker requests or production state writes are performed by CI. The next meaningful evidence step is trusted source capture design and account-wide writer closure inventory, not removal of a HOLD gate.
