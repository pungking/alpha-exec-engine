# STEP 5C-4D-3Z — Workflow Run↔Job attempt scope is not runtime variable proof

**Base:** PR #87 merged to main at 5de8d91bc6449a3516989f3ba312659f15554c12; exact-SHA main push sidecar-ci #43059937878 SUCCESS.

**SOURCE ONLY / OFFLINE SYNTHETIC CI / PAPER & LIVE EXECUTION HOLD.** No actual GitHub Actions Variable, historical Run/Job, protected Environment, Alpaca account or broker credential has been fetched; no operational Workflow, variable, order, state or GitHub policy change.

## Independently reviewed source boundary

3X/3Y previously verified nine real YAML source broker-secret references. Six have a literal PAPER broker host. Three depend on GitHub Actions configuration variable ALPACA_BASE_URL:

| Reviewed workflow | Source Job key | Allowed source events | Boundary |
|---|---|---|---|
| dry-run.yml | dry-run | schedule, workflow_dispatch | Automatic/report only by source; not a broker permission certificate |
| market-guard.yml | market-guard | schedule, workflow_dispatch | Observation/report by source; not a broker permission certificate |
| ledger-filled-migration.yml | ledger-filled-migration | workflow_dispatch only | Separate protected admission Job is hard fail-closed |

None of these three broker-credential-bearing Jobs has a directly bound GitHub Environment. The ledger admission Job is a distinct hard-fail path. Approving it would not automatically approve the separate downstream mutation-capable Job.

The connected GitHub generic fetch tool rejects the GitHub Actions Variables management endpoints. **The real ALPACA_BASE_URL value, existence, modification history and historical effective values remain UNKNOWN.** A denied GET is not proof of variable absence or a PAPER destination.

## 3Z source-to-attempt normalized evidence contract

scripts/lib/paper-variable-run-attempt-scope.mjs exports a **pure** inspector that composes the exact prior 3Y candidate and 3X nine-YAML source audits. Its input includes exactly three caller-supplied **normalized**, rather than raw GitHub API, Run↔Job attempt records. It enforces:

- Exact repository, reviewed source SHA, Workflow path, source Job key and event class
- Positive Run ID / Job ID, matching Run ID, attempt number, head SHA and main branch ref, with completed state and bounded conclusions
- Unique Run IDs, Job IDs and Workflow identities across the three records
- Internally consistent reporting Job outcomes, and rejection of a falsely successful ledger migration Job under hard-failed protected admission
- No fake Environment inheritance, broker account binding, historical variable resolution, trusted GitHub origin or outbound broker egress attestation

A matching synthetic or caller-provided record returns **HOLD_UNATTESTED_RUN_JOB_VARIABLE_AT_RUNTIME**. Inconsistent scope, mismatched IDs, unsupported real-world proof claims or a spoofed successful protected mutation becomes **DENY_RUN_JOB_SCOPE_OR_VARIABLE_PROOF_INVALID**. Neither has any READY/ALLOW or operational authority path.

The result does not expose IDs, account numbers, variables, key material or raw GitHub response bodies. The code has no network adapter and has not fetched an actual Run/Job object. A successful match on untrusted normalized metadata is **not** a trusted GitHub or broker evidence source.

## Critical external evidence boundaries

| Evidence class | Minimum independently verified material | Current status |
|---|---|---|
| Current GitHub variable | Owner-authorized authenticated Variables(read), scope and capture timestamp | NOT COLLECTED |
| Run/Job source join | Verified historical SHA, Workflow, Run ID/attempt, Job ID and exact path | NOT ATTESTED |
| Variable during Run attempt | Protected at-run classification proving actual value for that exact Job and attempt | NOT ATTESTED |
| Runtime broker network route | Independently trusted outbound hostname policy, including nested scripts and external clients | NOT VERIFIED |
| Broker account capability | PAPER-vs-LIVE separate key identity, permission grants, account-wide external Writer inventory | NOT VERIFIED |
| Enforced broker-side fencing | Common mutation edge lock/fencing, stale client, collision and recovery negative tests | NOT IMPLEMENTED |
| Human approval | Independent GitHub source APPROVE policy plus separate, explicit operation-specific consent and replay barrier | NOT AUTHORIZED |

GitHub documentation distinguishes configuration vars from workflow/Job/Step env and describes Run/Job REST metadata:
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/rest/actions/workflow-jobs

Even authenticated GitHub Run/Job metadata does **not** independently prove the historical value of vars.ALPACA_BASE_URL, a broker key's permissions or complete account-wide Writer exclusion. A new approved observational workflow would at most prove facts about that *new* attempt, not an older one. Do not infer a historic config snapshot from current GitHub variable state.

## CI and frozen safety

scripts/test-paper-variable-run-attempt-scope.mjs uses nine actual checked-in YAML files and synthetic Run/Job normalized objects. Negative tests cover foreign/duplicate IDs, SHA, job attempt drift, wrong event, branch, status/outcome, source-digest changes, fake runtime variable proof, unauthorized human approval and falsely successful ledger migration under fail-closed admission. Tests are imported into existing offline GitHub PAPER Custody CI with SHA-256 source/test evidence pins.

Admission remains **17 Workflows / 21 Jobs / 10 OPEN blockers**, operationalHold=true, settingsEvidence=USER_REPORTED_NOT_FETCHED, and reviewBy=2026-12-11T00:00:00Z. No GitHub Workflow YAML, Actions Variables/Secrets, protected Environment, Ruleset, broker key, order, PAPER state or LIVE API is modified.

Unrelated obsolete Knowledge Intake / Gemini → Obsidian schedule cleanup remains tracked in pungking/US_Alpha_Seeker Issue #57 and is not executed as part of 3Z.

**Next:** A separately authorized read-only discovery path may inspect actual GitHub variable and Run/Job metadata, retaining independently unverified historical runtime resolution, account Writer fencing and distinct human operational approval as permanent HOLD gaps until separately proved.
