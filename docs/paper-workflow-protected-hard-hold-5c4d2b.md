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
