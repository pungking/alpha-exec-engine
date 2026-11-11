# STEP 5C-4D-3Q — passive GitHub Run/Job observation versus protected PAPER authority

**Starting point:** PR #78 merged at main SHA `746901741a4a484763ef785e2b66244b9e584b1c`, then the exact-SHA main push sidecar-ci #43032423411 completed SUCCESS.

**SOURCE ONLY / OFFLINE TESTS / NO BROKER OR GITHUB MUTATIONS / PAPER AND LIVE HOLD.**

## Why 3Q is distinct from 3P

3P independently compared four **checked-out Workflow YAML files** and their source SHA-256 fingerprints. That proves reviewed-source structure only. Actual GitHub Job outcomes belong to specific Workflow runs and code SHAs; they must not be used as stand-ins for either current protected-Environment settings or broker authorization.

Read-only GitHub connector calls performed during 3Q planning established:
- A complete GitHub Workflow Run **by known Run ID** and its Job list can be retrieved using available Actions read-only API routes.
- The connector currently **does not expose** the GitHub repository Environment configuration or deployment branch policy endpoints. Attempts to GET `/repos/pungking/alpha-exec-engine/environments/PAPER_CUSTODY_APPROVAL` and `.../deployment-branch-policies` returned connector policy HTTP 400, not GitHub policy data. Workflow-specific `/actions/workflows/{workflow}/runs` paths were likewise unavailable through the generic fetch tool.
- Generic event-filtered Workflow Run listing was available, but the first 100 of 2,500 historical dispatches do not establish exhaustive coverage of all 4 protected workflows.
- Historical Workflow Run [#32877521120](https://github.com/pungking/alpha-exec-engine/actions/runs/32877521120) was returned for `paper-five-row-active-limited-state-recovery.yml`, created **2026-08-25T17:22:41Z** at **historical** source SHA `2849c9c151fcc8192f14231209ecb02fa419ff8d`; the returned Job list included a completed/success `recover` Job. This **pre-dates** the reviewed current source and cannot be used to infer a current HOLD bypass or prove any broker mutation. It is evidence that the historical versus current source distinction matters.

## New reviewed-source + Run/Job comparison

`scripts/lib/paper-github-run-job-observation.mjs` consumes a caller-supplied, API-shaped **completed** Workflow Run and first-party Job list along with the 3P reviewed source inventory. It checks exact repository, workflow path, manual dispatch event, `main` branch, run ID, attempt=1, SHA shape and Job parentage/IDs/names/conclusions.

- If current source SHA (`746901741a4a484763ef785e2b66244b9e584b1c`) and a syntactically consistent API-shaped record match, output **`HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION`**. An observed successful protected `admission` or a completed non-skipped mutation-capable Job is a contradictory condition and produces **DENY**. Missing Job rows are explicit proof gaps, not evidence the Job was blocked.
- If the observed Run references an older/different SHA, output **`HOLD_HISTORICAL_SOURCE_NOT_CURRENT_AUTHORITY`** after validating its basic identity and shape. A historical successful Job is not silently reinterpreted as a present-day authorization.
- Malformed, overbroad, incomplete or mismatched Run/Job shapes produce **`DENY_GITHUB_RUN_JOB_OBSERVATION_INVALID`**.

This inspector is intentionally a pure diagnostic; even an entirely consistent API-shaped record remains caller-supplied and can be forged. It does **not** fetch real GitHub data at runtime, attest transport origin or GitHub Environment policy, prove a Job-to-Deployment approval linkage, or establish account-wide broker Writer fencing. Every output explicitly keeps all GitHub approval/Writer/PAPER/LIVE operational authority indicators false.

## Operational trust gap and next proof acquisition

Even if a future read-only connector returns `approved` for a Workflow Run, 3P demonstrated the protected `admission` Job is distinct from the actual mutation-capable Job. A decision to change HOLD requires **independent** trusted origin, policy-at-run-time, exact Job/Deployment/approver linkage, full account credential inventory, account-wide broker mutation-edge fencing, independent anti-replay, source/risk qualification and separately authorized human approval. None is obtained here. An event list excerpt does not prove the absence of historical runs.

## CI

Tests use synthetic Run and Job data (including a **synthetic historical** Run structure modeled after the read-only observation), exact reviewed source YAML, historical-source HOLD, same-SHA contradiction DENY, bad run/job identity, malformed job list, modified HOLD source, and no secret reflection.

`scripts/test-paper-github-run-job-observation.mjs` is imported in the existing offline custody CI and pinned in the Admission baseline. The 17 Workflow/21 Job/10 OPEN blocker HOLD inventory, review expiry `2026-12-11T00:00:00Z`, operational Workflow YAML, Github Environments, Secrets, broker APIs and paper-state are unchanged. Test logs with zero real GitHub and broker requests prove only offline fixture behavior. Full independent code review, CI and fresh user merge authorization are required.

**Unrelated legacy maintenance**: the existing Knowledge Intake cleanup remains tracked under `pungking/US_Alpha_Seeker` Issue #57. This PR does not modify or disable those workflows.
