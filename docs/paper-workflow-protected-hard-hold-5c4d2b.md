# STEP 5C-4D-2B — PAPER manual mutation protected approval (HOLD only)

Status: SOURCE CHANGE ONLY; **operational execution remains prohibited**. Supersedes no prior P0 safety requirements. Parent PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1 remains BLOCKED.

Starting main: 361aa2b170917de211fbca3ff954d35992be60fd (PR #61 merged and main CI successful).

## Actual wiring

The four existing `workflow_dispatch` mutation workflows each have exactly two jobs after this PR:

| Workflow | Protected admission job | Legacy mutation job | Status |
| --- | --- | --- | --- |
| paper-oco-submit-canary.yml | admission | submit-canary | hard HOLD |
| persistent-oco-repair-submit.yml | admission | submit-persistent-repair | hard HOLD |
| ledger-filled-migration.yml | admission | ledger-filled-migration | hard HOLD |
| paper-five-row-active-limited-state-recovery.yml | admission | recover | hard HOLD |

The admission job:
- Runs only for the exact `workflow_dispatch` event and `refs/heads/main`, subject to existing Environment branch protection;
- References **PAPER_CUSTODY_APPROVAL**, the previously configured reviewer-protected GitHub Environment;
- Has only `contents: read` permission, one safe bash step, and no declared outputs, broker credentials or mutable state;
- Always exits with code 1 and emits only a generic, non-sensitive BLOCKED status.

Every original broker/state mutation job:
- Has `needs: admission` and exact `if: needs.admission.result == 'success' && needs.admission.outputs.operational_authorized == 'true'`;
- Cannot start when admission fails and cannot start even if a future accidental admission step returned success, because the required output is not defined;
- Retains original source, input approval phrases, order logic and prior concurrency; none of those older gates confers operational authorization.

## STEP 5C-4D-2B-FIX: approval waits do not own writer locks

Resume baseline: PR #62 HEAD 280b860a9c7187245cca4d68539411a45a190fdf,
main 361aa2b170917de211fbca3ff954d35992be60fd; both rechecked remotely.
No existing uncommitted changes were present; the same remote branch is reused.

The four concurrency blocks now belong only to the original mutation jobs, not
the workflow or admission job. Group strings and cancel-in-progress=false are
unchanged. In particular, waiting for ledger migration approval must not occupy
the sidecar-dry-run group used by automatic analysis. The approval job has no
concurrency of its own. The original jobs still require admission success AND
the deliberately absent operational_authorized output. Approval still leads to
unconditional exit 1, never a release of execution authority.

This uses GitHub's distinct [workflow/job concurrency scopes](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
It is source/condition validation, not a live scheduling experiment. No workflow
is dispatched. The existing dry-run and market-guard workflows remain identical.
These per-job legacy groups are still NOT a unified durable custody writer lock.

The original 64 hard-HOLD checks are preserved; 68 new checks cover moving locks
back to workflow/admission, missing/changed writer groups, cancel=true, and the
exact pinned execution condition with waiting/rejected/failure/cancelled/skipped
or success-without-authority results. Pending/rejected labels model absence of
admission success, not additional GitHub needs-result enum values. The condition
test is not a general Actions expression interpreter. The old workflow layout
fails RED at "approval wait must not acquire a workflow lock"; the corrected
layout passes 132 checks.

Reviewed baseline updates must be limited to changed definitions, corresponding
job concurrency observations and changed source bytes. Preserve all 17 workflows,
21 jobs, 10 blockers, zero operational-eligible jobs, operationalHold=true and
reviewBy=2026-12-11T00:00:00Z. No automatic regeneration/expiry extension is allowed.

Independent read-only review found no defects in the concurrency/test diff before
the baseline update, then verified the final bounded update: four definition
hashes, eight concurrency-only job observations, one hard-HOLD test source hash
and the checker anchor. Canonical baseline SHA-256:
`13b34ca36b294bc31d81ed20bd73d6f14ffeffd67c562ea86197318b71119c04`.
The combined admission command passes 65 inventory + 99 mutation-contract + 132
hard-HOLD checks. Other workflow files (13, including CI) are byte-identical to
the resume HEAD. This is not a merge approval or live Environment verification.

Local verification: all 21 regression commands passed, including build,
typecheck, dispatch safety, candidate export, private binding, custody, scoped
closeout/adapter/operational/attended contracts, migration/recovery, public
evidence, notifications, order consistency, symbol/routing safety, HF replay and
git diff --check. npm audit --audit-level=high reported zero vulnerabilities.
Actual PR CI on the final commit must also pass; its run is recorded in PR #62.

In GitHub Actions, a job that is skipped does not execute `if: always()` steps inside it. This separate-job design intentionally avoids allowing an existing post-failure reporting/Notion/cache step to run after a same-job HOLD check.

**Approval prompt is not an execution release.** If someone manually dispatches one of these workflows, the protected admission job may request the reviewer’s approval, then fails intentionally; no original mutation job runs. This PR does not dispatch workflows, modify Secrets or create paper-state.

## Why this is a staged safety hold, not operational deployment

- The Environment is linked to the admission job only; it does not authenticate real broker account scope or authorize custody.
- The original broker jobs still use existing repository secrets; they are unreachable under this hard HOLD, not granted new custody entitlement.
- GitHub Actions concurrency across legacy analysis/market guard and manual writers is not yet unified. The old state caches remain report/legacy snapshots, not authoritative custody.
- Historic recovery has a fixed baseline allowlist and one-shot sentinel. Modifying its Workflow here is **not** permission to run it or to bypass its older policy.
- `paper-state` creation/update is still blocked by existing rulesets; no branch provisioning or reference update is part of this change.
- P0 source, halt/reopen events, risk/cashflow completeness and exact current seed lineage remain outstanding.
- The inspector introduced in STEP 5C-4D-2A continues to return HOLD or DENY for all untrusted evidence.

## Next required work, outside this PR

1. Independent source review and PR CI. User approval before merge. Verify post-merge main CI.
2. Trusted admission: exact GitHub approved deployment/actor, verified SHA and immutable source inputs; never read approval from a user-supplied JSON document.
3. Unified exclusive writer and remote checkpoint proof before any external side effect; legacy writer quiescence and resilient ambiguous-result reconciliation.
4. Qualify real P0 source/risk/cashflow and attest genuine account/portfolio scope.
5. Separate approved paper-state genesis/cutover and a distinct explicit approved supervised PAPER operation; then separately consider LIVE in future.

Rollback: revert this PR via protected main review. Never use a revert to restore stale caches, erase unknown broker effects, or cancel a possible remote order. Preserve existing reports and other automated analysis.
