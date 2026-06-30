# Ops Health Guard Metadata Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `ops-health-report=fail` into actionable guard-metadata, protective-order, ledger/fill-state, ownership, scheduler, and mutation-safety blockers without broker/state mutation.

**Architecture:** Reuse existing `alpha-exec-engine` report-only scripts and add only the smallest missing aggregation/gate. The sidecar remains the execution boundary; this plan only improves evidence classification and live-readiness reporting.

**Tech Stack:** Node.js ESM scripts, JSON/Markdown state artifacts, existing npm ops scripts, GitHub Actions `dry-run.yml` artifacts.

---

## Scope Boundaries

- Repo: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine`
- Allowed: report-only audits, docs, tests, CI artifact wiring.
- Forbidden: broker submit, replace, reprice, OCO repair submit, state migration, ledger mutation, idempotency mutation.
- Required invariant: every touched lane must keep `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`, and state mutation false unless a future task has explicit confirmation.

## Files

- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-ops-health-report.mjs`
- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-live-readiness-scorecard.mjs`
- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-guard-source-recovery-plan.mjs`
- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-position-protection-root-cause-audit.mjs`
- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-fill-state-reconciliation-audit.mjs`
- Inspect: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-protection-blocker-reduction-plan.mjs`
- Likely modify: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-live-readiness-scorecard.mjs`
- Likely modify: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-ops-health-report.mjs`
- Likely modify or add minimal test: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/test-live-readiness-blocker-separation.mjs`
- Optional docs append: `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/docs/DEVELOPMENT_PLAN_LIVING.md`

## Task 1: Baseline Current Blockers

- [ ] Run current report-only chain.

```bash
cd /Users/givet-bsm/Documents/GitHub/alpha-exec-engine
npm run ops:broker-child-reconcile
npm run ops:position-protection:audit
npm run ops:position-lifecycle-guard-source
npm run ops:guard-metadata-refresh
npm run ops:guard-metadata:lineage
npm run ops:guard-source-recovery
npm run ops:fill-state-reconcile
npm run ops:protection-blocker-reduction
npm run ops:health
npm run ops:live-readiness
```

Expected: commands complete without broker/state mutation.

- [ ] Summarize current blockers from generated artifacts.

```bash
node - <<'NODE'
const fs = require('fs');
const files = [
  'state/ops-health-report.json',
  'state/live-readiness-scorecard.json',
  'state/guard-source-recovery-plan.json',
  'state/protection-blocker-reduction-plan.json',
  'state/fill-state-reconciliation-audit.json'
];
for (const file of files) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('\n##', file);
  console.log(JSON.stringify({ overall: j.overall, summary: j.summary, blockerGroups: j.blockerGroups, finalVerdict: j.finalVerdict }, null, 2).slice(0, 4000));
}
NODE
```

Expected: blocker categories are visible enough to decide whether code needs a small aggregation fix.

## Task 2: Add Missing Blocker Separation Only If Evidence Is Ambiguous

- [ ] If `ops-health-report.json` already separates these groups, skip implementation and document that no diff is needed:
  - `stage6_entry_tuning`
  - `protection_guard_metadata`
  - `ledger_fill_state`
  - `ownership`
  - `safety_mutation`
  - `scheduler_data`

- [ ] If any group is missing, update `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-ops-health-report.mjs` in the existing `buildBlockerGroups` function only.

Implementation rule:

```js
// ponytail: report-only grouping; add a new group only when an existing blocker has no owner.
```

Expected: no new script if existing `buildBlockerGroups` can hold the change.

## Task 3: Make Live Readiness Consume The Same Blocker Buckets

- [ ] Inspect whether `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/build-live-readiness-scorecard.mjs` already reports these blocker owners.

```bash
rg -n "protection_guard_metadata|ledger_fill_state|ownership|scheduler_data|safety_mutation|stage6_entry_tuning" scripts/build-live-readiness-scorecard.mjs
```

Expected: each bucket is either directly present or derived from `ops-health-report.json`.

- [ ] If missing, add the smallest read of `opsHealth.blockerGroups` to the scorecard output.

Expected output fields:

```json
{
  "opsHealthBlockerGroups": {
    "stage6_entry_tuning": { "status": "pass|warn|fail" },
    "protection_guard_metadata": { "status": "pass|warn|fail" },
    "ledger_fill_state": { "status": "pass|warn|fail" },
    "ownership": { "status": "pass|warn|fail" },
    "safety_mutation": { "status": "pass|warn|fail" },
    "scheduler_data": { "status": "pass|warn|fail" }
  }
}
```

## Task 4: Strengthen Existing Fixture Test

- [ ] Extend `/Users/givet-bsm/Documents/GitHub/alpha-exec-engine/scripts/test-live-readiness-blocker-separation.mjs` instead of creating a new test.

Minimal assertions:

```js
const requiredGroups = [
  'stage6_entry_tuning',
  'protection_guard_metadata',
  'ledger_fill_state',
  'ownership',
  'safety_mutation',
  'scheduler_data'
];
for (const group of requiredGroups) {
  assert(report.blockerGroups[group] || report.opsHealthBlockerGroups?.[group], `missing blocker group ${group}`);
}
assert.equal(report.safety?.brokerMutationAllowed, false);
assert.equal(report.safety?.stateMutationAllowed, false);
```

Expected: test fails before any required missing group fix, passes after.

## Task 5: Verify No Mutation And No Execution Drift

- [ ] Run focused tests.

```bash
npm run ops:test:live-readiness-blockers
npm run ops:test:protection-blocker-reduction
npm run ops:safety:symbol-agnostic
npm run ops:health
npm run ops:live-readiness
npm run build
```

Expected:
- live-readiness remains `BLOCKED` unless all blocker groups are clean.
- broker/state/multi mutation flags remain false.
- no order submit/replace/reprice workflow is triggered.

## Task 6: Commit And Push

- [ ] Commit only if code/docs changed.

```bash
git status --short
git add scripts/build-ops-health-report.mjs scripts/build-live-readiness-scorecard.mjs scripts/test-live-readiness-blocker-separation.mjs docs/DEVELOPMENT_PLAN_LIVING.md
git commit -m "test(ops): separate live readiness blocker groups"
git push
```

Expected: push succeeds. If no code change was needed, do not commit a no-op.

## Task 7: Next RTH One-Shot Check

- [ ] On the next sidecar safe run, inspect artifacts once:

```bash
# replace RUN_ID with the latest sidecar-dry-run run id
gh run download -R pungking/alpha-exec-engine RUN_ID --dir /tmp/sidecar-run-RUN_ID
```

Required evidence:
- `ops-health-report.json.blockerGroups` separates blocker ownership.
- `live-readiness-scorecard.json.finalVerdict=BLOCKED` until blockers clear.
- `brokerMutationAttempted=false` / `brokerMutationSubmitted=false`.
- If no new event exists, stop; do not monitor repeatedly.

## Done-When Criteria

- `ops-health-report=fail` is no longer opaque; it names the owning blocker lane.
- Live readiness shows whether the blocker is Stage6 entry, guard metadata/protection, ledger/fill state, ownership, scheduler/data, or mutation safety.
- Existing report-only chain passes locally.
- No broker/state mutation path is enabled.
- Next RTH safe run confirms the same blocker split in artifacts.
