# STEP 5C-4D-3P — inspect the actual PAPER admission / Writer Job topology

**Base:** PR #77 merged into `main` at `ab7964e7af7791900959277718ebe8d653fc4bb5`; post-merge `sidecar-ci` push run #43029409535 SUCCESS.

**Mode:** OFFLINE SOURCE READ ONLY. Do not dispatch protected workflows, change broker state, edit the GitHub Environment or remove a HOLD.

## Evidence-driven finding

The reviewed GitHub Actions sources show **four** manual mutation-capable workflows with *two distinct jobs* each:

| Workflow | Protected `admission` | Actual potentially mutating Job | Same-Job protected Environment |
|---|---|---|---|
| `ledger-filled-migration.yml` | `admission` | `ledger-filled-migration` | No |
| `paper-five-row-active-limited-state-recovery.yml` | `admission` | `recover` | No |
| `paper-oco-submit-canary.yml` | `admission` | `submit-canary` | No |
| `persistent-oco-repair-submit.yml` | `admission` | `submit-persistent-repair` | No |

Each `admission` job currently has `environment: PAPER_CUSTODY_APPROVAL`, is limited to manually dispatched `main`, and runs a single fail-closed shell script with `exit 1`, no declared authorization outputs. Its separate mutation-capable downstream job uses `needs: admission` and the exact condition `needs.admission.result == 'success' && needs.admission.outputs.operational_authorized == 'true'`. Therefore **the reviewed source is blocked**, and a reviewer approval of the `admission` job alone must not be presented as authorization of the downstream Job. The source-level guard is not an independent runtime attestation of GitHub environment policy or any broker Writer fence.

In addition, the reviewed inventory contains **two automatic report/cache Writer jobs** (`dry-run.yml#dry-run`, `market-guard.yml#market-guard`) without the protected Environment. Their safety defaults and effects must remain separately audited, and these roles must not be described as proof of exclusive broker-account Writer custody.

## New negative source-topology audit

`scripts/lib/paper-protected-writer-topology.mjs` is a deterministic offline inspector over the 4 actual workflow YAML source texts **and the reviewed 17-workflow/21-job Admission Inventory**. It reuses the admission checker’s strict YAML parser and canonical hash algorithm, pins all four reviewed workflow definitions, and checks:

- `workflow_dispatch` only, exactly one fail-closed `admission` and the expected mutation Job per workflow.
- Environment and Job identity are not conflated; the protected Job has the approved Environment, while the mutation Job has **no** Job-level Environment.
- Admission shell exactly preserves the fail-closed `exit 1`, and does not publish an `operational_authorized` output.
- Downstream `needs` and `if` depend on the exact required admission result **and** authorization output.
- All 17 workflows / 21 jobs / 10 OPEN blockers remain reviewed, both operational eligibility and Writer claim flags remain false, and live settings are `USER_REPORTED_NOT_FETCHED`.
- Any source drift, changed dependency, weakened hold script, new job, changed classification or settings assertion yields `DENY_WRITER_TOPOLOGY_SOURCE_DRIFT` rather than an unsupported readiness result.

A consistent, pinned snapshot produces `HOLD_APPROVED_ADMISSION_NOT_WRITER_JOB_AUTHORITY`. Both outcomes set every execution authority field false; no runtime application, orders or state writes are attempted.

## Critical limitations

- YAML identity and hash matching prove only consistency with a frozen source inventory and locally parsed YAML; independently trusted GitHub API data, live Environment settings, the exact Job-to-Deployment approval link, and broker account mutation capabilities are **not** verified.
- A default branch can move after observation, and manual dispatch state can differ from the checked source. Changes require independent GitHub-policy and source-SHA attestation before operational analysis.
- Even a same-job protected Environment would not prove exclusive Writer ownership, credential scope, broker-side fencing, or approved PAPER execution without a separate deployment and human authorization process.
- The source contains immutable pinned hashes for the 4 source definitions, not a new blanket approval to mutate any of them. In any mismatch, the inspector DENYs.

## CI and follow-up

`scripts/test-paper-protected-writer-topology.mjs` reads repository files and performs positive HOLD and negative DENY cases for removed dependencies, edited conditions, alternate Environment, fail-closed script modification, forged review settings, additional Workflow Jobs, shifted classifications, unknown source files, and invalid YAML. The GitHub PAPER custody test importer and frozen `evidenceSha256` admission pins are updated. Workflow YAML, deployment configuration, repository secrets, risk gates and paper-state remain untouched. The admission review expiry `2026-12-11T00:00:00Z` stays unchanged.

**Recommended next gate:** independently inspect GitHub current protected Environment policy/Job metadata and obtain external broker Writer inventory and credential-fencing evidence. Do not use successful CI or a protected admission Job as actual trading approval.

**Unrelated legacy maintenance:** `pungking/US_Alpha_Seeker` knowledge intake/NotebookLM/Obsidian schedules remain a separate follow-up, GitHub Issue #57. This PR neither disables nor changes them.
