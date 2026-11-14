# Issue #91 — STEP #91-8: protected bootstrap diagnostic admission contract

Status: **DESIGN ONLY / NOT APPROVED FOR OPERATIONAL INTEGRATION**  
Verified source baseline: `main` `12f4875cff3488af2bf759d58f9f2f46f4c7c8d3`, 2026-11-14 KST. This is a dated review, **not** a live branch or account attestation.

## 1. Observed evidence and non-conclusions

- Naturally dispatched `repository_dispatch` Run [#43476681116](https://github.com/pungking/alpha-exec-engine/actions/runs/43476681116), Job `dry-run`: `Run dry-run bootstrap` **FAILURE**, private wrapper `exitCode=1 rawOutputPublished=false`.
- Public aggregate artifact `sidecar-state-43476681116` (artifact ID `14062314047`) records `BINDING_INCOMPLETE`. This is **not proven to cause the earlier bootstrap exit**, nor an independent account/order audit.
- The protected wrapper suppresses stdout, stderr and the Step Summary. It reveals only the exit code, not a failure category; thus the classification visibility gap is established at source level. Exact historic root cause: **UNKNOWN**.
- At the STEP #91-8 review cutoff, [PR #92](https://github.com/pungking/alpha-exec-engine/pull/92) was **Draft / not merged**. Its standalone `scripts/classify-private-sidecar-failure.mjs` and synthetic tests are **offline only**, not wired to production. At the 2026-11-14 STEP #91-8 evidence cutoff, HEAD was `8838dff774d99d87c1f803856c202c03f3d4c725` and exact-HEAD PR CI [#43542652932](https://github.com/pungking/alpha-exec-engine/actions/runs/43542652932) SUCCESS. **This is a historical snapshot; PR #92 was subsequently merged and its new-main CI is separately verified in Phase A.** A COMMENTED technical review is **not** independent human APPROVE.

## 2. Existing binding — never bypass the admission gate

The reviewed `config/paper-workflow-admission-baseline.json` (review window 2026-11-11 through **2026-12-11 00:00 UTC**) holds `operationalHold=true`, inventories **17 workflows / 21 jobs**, and pins 140 evidence source hashes. In particular `scripts/run-private-sidecar-step.sh` is pinned by SHA-256. `scripts/check-paper-workflow-admission.mjs` itself pins the canonical baseline hash `419fbfae411d8e4e772b5dc7175b665fda3608660418eff5389cf0aae82f434b`. Do not equate SHA-256 for a source file with its Git blob SHA.

The gate fails closed on `REVIEWED_ENTRYPOINT_DRIFT`, `BASELINE_UNREVIEWED_CHANGE`, `PACKAGE_COMMAND_DRIFT`, and `WORKFLOW_DEFINITION_UNREVIEWED`. Initial PR #92 runtime wrapper prototype correctly failed `REVIEWED_ENTRYPOINT_DRIFT` (CI #43542382642). The wrapper was fully restored; no reviewed hash was rebased or silently updated.

**Prohibited shortcut:** editing the baseline hash or checker constant merely to make a diagnostic PR green. A separately authorized admission re-review must inspect the entire relevant affected source, preserve the default execution HOLD and prove all existing regressions, before any prospective baseline update. Never extend `reviewBy` to avoid expiry.

## 3. Minimal phased plan and owned modules

### Phase A — source-only adoption status (updated after PR #92 merge)

PR #92 was subsequently **separately source-merge approved** and merged as `7a417789efe75071a1cff1b05568cc64ab0ffb7a`; exact new-main push CI [#43547028861](https://github.com/pungking/alpha-exec-engine/actions/runs/43547028861) completed SUCCESS. The classifier remains **offline-only**, not integrated into the protected wrapper. This STEP documents a *future* operational change contract only, and does not re-import PR #92 code or change any operational controls. No new runtime hooks, workflow YAML edits, secrets, broker calls, log uploads, state or credential access.

### Phase B — prospective technical integration; separate authorization required

Although #92 is source-merged and its new-main CI is confirmed, **runtime integration and admission-baseline changes are not approved**. Only after separately scoped technical/security approval, and a fresh main/Admission recheck:
1. Rebase or branch from *then-current* main, re-read `AGENTS.md`, `check-paper-workflow-admission.mjs`, the reviewed baseline, and the private wrapper.
2. Consider a *single* failure-only, `PAPER_EVIDENCE_PHASE=preview` code path in `scripts/run-private-sidecar-step.sh`, invoking the proven classifier against its own private output file **after** producer exit. No new repo dispatch, no rerun, no external service.
3. Emit only the exact public fields `class=<ENUM>`, `rawOutputPublished=false`, `rootCauseVerified=false`; supported enums: `ENVIRONMENT_MISSING`, `DRIVE_AUTH_FAILURE`, `STAGE6_READ_FAILURE`, `STAGE6_TRIGGER_REJECTED`, `UNKNOWN`. No raw excerpts, source paths, line numbers, caller-provided labels, hashes, symbols or IDs. Unknown and ambiguous matches default to `UNKNOWN`; a category means a source pattern matched, **never** proof of root cause.
4. Preserve producer exit code verbatim, `set -eo pipefail` semantics, private `GITHUB_STEP_SUMMARY` redirection, begin/finish binding behavior, `umask 077`, approved environment flags and fail-closed default. Classification failures must degrade to `UNKNOWN`; they must neither retry nor convert a failed producer into success.
5. Do **not** self-approve the changed hash. Require independent security/operations review of the actual diff and the complete relevant admission inventory; a **separate, explicitly scoped, approved** baseline re-attestation is required. Absent that review, `REVIEWED_ENTRYPOINT_DRIFT` **must** remain a blocking CI failure. Treat the initial failure as a protective success, not a flaky test.

No Stage 0–6 producer code belongs in this repository. Any producer contract change is a separate task in `US_Alpha_Seeker`.

## 4. Minimum offline negative-test matrix — independent of production

Tests must use a disposable directory, synthetic secrets/paths and a fully intercepted network surface. No live Stage6 retrieval or provider/broker request. Avoid duplicating #92's existing classifier pattern unit tests; focus on prospective **wrapper integration and admission**.

| ID | Injected condition | Required result |
|---|---|---|
| N01 | Original producer exits 1, 7 or 127 and includes fake token/account/stack/path | Original code unchanged; no secret text in stdout/stderr/public summary or artifacts |
| N02 | Success exit 0 and arbitrary private text | No diagnostic failure marker; existing behavior identical |
| N03 | Unknown/malformed/oversized or unreadable private log | Only `UNKNOWN`; fail closed, no trace; producer exit preserved |
| N04 | Two conflicting known error patterns (e.g., auth and Stage6) | `UNKNOWN`, not first-match privilege or a root-cause claim |
| N05 | Unknown category or malicious multi-line classifier output | Wrapper-level allowlist replaces with `UNKNOWN`; no injected text crosses boundary |
| N06 | Classifier executable missing, nonzero exit or timeout | `UNKNOWN`, no hangs or retries; producer exit preserved |
| N07 | Binding begin or finish fails (synthetic offline fixture) | Existing binding evidence and producer behavior not bypassed or declared verified |
| N08 | Wrong workflow/phase/event, including manual synthetic event | No new runtime capability or misleading operational proof |
| N09 | Modify protected wrapper without separately reviewed baseline | Admission MUST reject `REVIEWED_ENTRYPOINT_DRIFT` |
| N10 | Change baseline, extend deadline, change package command or workflow job | Corresponding admission checker MUST reject; do not regenerate trusted hashes in test |
| N11 | Execution safety flags become LIVE, `READ_ONLY=false` or submit enabled | Existing workflow and admission safety tests reject the change |
| N12 | Secret/identity injected in source Step Summary or post-failure telemetry | Public output contains only fixed enum and booleans; private summary remains isolated |

For any proposed integration, assert **(a)** full original `ops:test:sidecar-public-evidence` and `ops:test:paper-workflow-admission` pass under an actually authorized reviewed baseline, **(b)** existing admission tests reject an unreviewed changed wrapper, **(c)** no protected wrapper/CI tests are suppressed, weakened or skipped, and **(d)** exact-HEAD CI is SUCCESS **without** any operational workflow dispatch. Historical runs must never be relabelled.

## 5. Review gates and evidence required

| Gate | Evidence required | Default |
|---|---|---|
| G0 | Distinct repo boundary, exact main SHA and current Issue/PR/CI review | HOLD |
| G1 | PR #92 individually reviewed, separately merge-approved, and post-merge main CI verified | COMPLETED — source only; no runtime authorization |
| G2 | Proposed runtime diff and N01–N12 negative results, fixed output-only schema, no secret leakage | HOLD |
| G3 | Admission baseline re-attestation independently reviewed and explicitly authorized; original blockers maintained | HOLD |
| G4 | Branch → Draft PR → exact-HEAD CI → independent code review → **new PR-specific user source-merge approval** | HOLD |
| G5 | Any actual PAPER/LIVE or broker/account/state operation requires its own independent operational admission; source merge is not such approval | HARD HOLD |

A CI `SUCCESS` on an offline design or fixture is not permission to trigger `dry-run.yml`, access protected credentials, or mutate broker/account/order/state. Preserve all recorded evidence, snapshots and ledgers; no destructive cleanup.

## 6. This STEP acceptance and rollback

This PR must contain **only this Markdown design file**, based on `main`, with no changes to the runtime wrapper, classifier, tests, workflow, package scripts, hash-locked entrypoints or baseline. CI passing establishes only documentation/source integration safety. Independent technical diff review must identify any overclaim, missing negative test, or unsafe relaxation. PR #92 is already merged source-only; keep Issue #91 OPEN. Do not merge this PR without fresh, PR-specific user approval.

Rollback: revert this document-only change if eventually merged; no runtime migration, cache, state or credential cleanup.
