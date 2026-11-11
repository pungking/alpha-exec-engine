# STEP 5C-4D-3X — Actual broker endpoint source audit

**Base:** PR #85 merged to main at 0cd1f54fa6d6f7f8220540a193cdcbbdf499e994, with post-merge sidecar-ci #43054411296 SUCCESS.

**Operating mode: SOURCE ONLY / OFFLINE TESTS / PAPER AND LIVE EXECUTION HOLD.** No real broker, GitHub Variables, GitHub Secrets or account API is accessed.

## Verified findings from nine checked-in workflow YAML sources

The 3V inventory found nine Job scopes referencing both ALPACA_KEY_ID and ALPACA_SECRET_KEY. Their Job-level ALPACA_BASE_URL is configured as follows:

| Binding class | Actual reviewed workflow Jobs | Result |
|---|---|---|
| **Literal PAPER URL** | paper-five-row-broker-evidence-recovery.yml#restore-and-read; paper-oco-read-verify.yml#read-verify; paper-oco-submit-canary.yml#submit-canary; persistent-oco-repair-open-verify-multi.yml#verify-open-protection-multi; persistent-oco-repair-open-verify.yml#verify-open-protection; persistent-oco-repair-submit.yml#submit-persistent-repair | **6** source PAPER URL declarations; not a runtime destination attestation |
| **GitHub variable, no fallback** | dry-run.yml#dry-run; market-guard.yml#market-guard | **2** unknown actual runtime route values |
| **GitHub variable with PAPER default** | ledger-filled-migration.yml#ledger-filled-migration | **1** unknown actual runtime route: a configured variable overrides the PAPER fallback |

**Total: 6 literal PAPER / 3 variable-dependent / 9 secret-reference Jobs.** The actual value of ALPACA_BASE_URL has not been fetched or verified. The three variable-dependent Jobs are not evidence of LIVE calls; they are potential routing risks requiring separate investigation. The four protected PAPER_CUSTODY_APPROVAL admission Jobs are distinct and remain fail-closed.

IMPORTANT: DRY_RUN, READ_ONLY=true, EXEC_ENABLED=false, a PAPER fallback, GitHub code reviews or a successful CI job **cannot prove** broker key permission scope, effective outbound hostname, PAPER/LIVE account isolation or exclusion of other broker clients.

## Added technical control

scripts/lib/paper-broker-endpoint-source-audit.mjs is a pure offline source inspector. It composes 3V's existing reviewed 17-Workflow/21-Job/10-OPEN-blocker broker secret inventory with actual local YAML for the exact nine Workflows. Each YAML definition is independently pinned to the reviewed canonical SHA-256. It checks:

- Exact frozen source/inventory and reviewed main SHA identities, all operational HOLD and unknown-settings invariants
- Exactly nine expected Workflow files, correct Job names, correct ALPACA_KEY_ID and ALPACA_SECRET_KEY source references
- Six fixed PAPER URL declarations and three expected unresolved variable bindings
- Any previously unknown LIVE URL substitution, changed secret binding, source hash, missing/extra Workflow, environment drift or forged authority claim is DENY

Valid source evidence yields **HOLD_THREE_BROKER_ENDPOINT_VARIABLES_UNATTESTED**. Modified or mismatched evidence yields **DENY_BROKER_ENDPOINT_REVIEWED_SOURCE_DRIFT**. All returned operational flags remain false. No code path returns READY or execution authority. No actual repository Variables, account keys, outbound network addresses or broker Writer leases are inspected by this module.

## External evidence still missing

| Required fact | Evidence acquisition route | Status |
|---|---|---|
| Current GitHub ALPACA_BASE_URL | Separately approved GET-only GitHub Actions Variables lookup and effective repo/org/environment variable scope, without treating current value as historical | NOT VERIFIED |
| PAPER versus LIVE account/key separation | Owner-authorized secure independent broker/account configuration inspection with redacted identifiers, **no LIVE API calls** | NOT VERIFIED |
| Effective outbound broker host | Independently validated runtime egress policy or trusted host log for nested scripts, not simply YAML metadata | NOT VERIFIED |
| Broker key scopes and external writers | Broker-side credential grants, users, keys, legacy/local/scheduled/manual/API client enumeration | NOT VERIFIED |
| Common account Writer fence and replay | Broker mutation-edge globally enforced lease/fencing, crash/race/stale-lease tests and replay barrier | NOT VERIFIED |
| Human approval policy | Source main active Ruleset currently requires 0 independent APPROVE reviews; future rule change requires separate authorization and a qualified human reviewer | NOT CONFIGURED |
| Exact protected Job operation approval | Run/Job/Deployment/account/SHA, limits and independently verified human operational approval | HOLD |

A possible future authorized read-only GitHub endpoint is GET /repos/pungking/alpha-exec-engine/actions/variables/ALPACA_BASE_URL. It is **not called** here. Even if retrieved, a current variable value is not proof of past resolution or key authorization.

## CI and boundaries

scripts/test-paper-broker-endpoint-source-audit.mjs uses **nine actual checked-in YAML files** and offline negative fixtures for LIVE URL drift, source digest mismatch, changed credential expression, altered Job Environment, missing files and forged authority. Tests are imported into GitHub PAPER Custody CI and protected by SHA-256 admission evidence pins.

Operational YAML, Secrets, Variables, Environment, Ruleset, orders, account state and PAPER branch are **unchanged**. Admission remains 17 Workflows, 21 Jobs, 10 OPEN blockers; operationalHold=true; reviewBy=2026-12-11T00:00:00Z. Legacy Gemini/Obsidian Knowledge Intake cleanup remains tracked separately at US_Alpha_Seeker Issue #57.
