# Development Handoff — alpha-exec-engine

Snapshot captured: **2026-11-12 (Asia/Seoul)** from connected GitHub repository/Actions metadata. This is a dated snapshot, **not** a live-status guarantee.

## Verified source and CI baseline

- Repository: https://github.com/pungking/alpha-exec-engine — execution sidecar only.
- Verified `main` merge commit: `12f4875cff3488af2bf759d58f9f2f46f4c7c8d3`.
- Last merged task: **STEP 5C-4D-3Z**, https://github.com/pungking/alpha-exec-engine/pull/88; Merge commit has the old `main` and reviewed PR HEAD as its two parents.
- Verified exact post-merge `main` push CI: https://github.com/pungking/alpha-exec-engine/actions/runs/43067822898 — **SUCCESS**.
- CI job log: 3Z `OFFLINE_PAPER_VARIABLE_RUN_ATTEMPT_SCOPE_PASS` (**73 checks**; actual GitHub requests=0; broker requests=0; external writes=0; operational authority=0). Admission: **17 Workflows / 21 Jobs / 10 OPEN blockers**, `operationalHold=true`. HARD HOLD: approved Jobs=0, authorized orders=0, authorized state writes=0.
- Current `main` branch was protected when inspected. Recheck exact policy and checks before each merge.

## Current next STEP, not yet implemented

- **STEP 5C-4D-3AA**: GET-only GitHub Run/Attempt/Job candidate metadata acquisition and normalization.
- Scope and test acceptance: https://github.com/pungking/alpha-exec-engine/issues/89 (**Issue exists; does not mean code or Draft PR exists**).
- Decide whether ChatGPT can implement the bounded work directly through GitHub tools. Delegate only where Codex materially improves safe implementation; supply exact repository/SHA, module list, acceptance and tests.
- Do **not** promote GitHub Run/Job success to historical `ALPACA_BASE_URL` attestation or broker/custody authorization.
- Separate unrelated root-repo cleanup: https://github.com/pungking/US_Alpha_Seeker/issues/57 — keep deferred.

## Safety baseline / persistent proof gaps

- `EXEC_ENABLED=false`; `READ_ONLY=true`; `MARKET_GUARD_MODE=observe`; PAPER and LIVE **operational HOLD**. Source merge is never order, custody or migration approval.
- Actual current/historical GitHub variable values, historical effective runtime egress, broker key privileges, PAPER/LIVE separation, external Writer inventory, shared mutation fencing and independent operation-specific human approval remain **unverified**.
- Admission review date in the frozen baseline: `2026-12-11T00:00:00Z`; do not silently extend or change it.
- No workflow dispatch/rerun, Secrets/Variables/Rulesets change, broker request or production-state mutation as a side effect of STEP 3AA.

## New-session checklist

1. Read `AGENTS.md`, `docs/AI_DEVELOPMENT_CONTINUITY.md` and this file.
2. Inspect **current** `main` commit, PR/CI, Issue #89, exact 3Z source contracts and relevant review decisions.
3. If 3AA has already progressed, continue from actual latest PR HEAD; never duplicate branches from a stale snapshot.
4. Implement/test on a dedicated branch, Draft PR and exact-HEAD CI; review and request a **new PR-specific source merge instruction**.
5. Following merge, check new `main` push CI and update this handoff by reviewed PR.
