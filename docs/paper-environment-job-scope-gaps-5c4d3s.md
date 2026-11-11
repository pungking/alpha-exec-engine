# STEP 5C-4D-3S — exact Environment identity and non-transferable Job approval scope

**Starting point:** PR #80 merged to `main` at `6cd26eb4fffc32c181a6768b3f9eaff589162bb8`, with `sidecar-ci` push run #43036172683 SUCCESS.

**SOURCE ONLY — ALL PAPER & LIVE EXECUTION HOLD.**

## Problem addressed

In 3R, the untrusted GitHub Environment policy-shaped input checked an Environment's expected *name* plus any positive ID. That was sufficient for synthetic rejection of a misspelled Environment but not a strong source-level binding to the reviewed Environment ID. Also, even a valid Environment reviewer's approval of `admission` must never be represented as approval for the separate mutation-capable Writer Job.

3S corrects this by requiring the explicitly reviewed numeric Environment ID **26847620868**, along with the exact name `PAPER_CUSTODY_APPROVAL`, as *source-only candidate identity checks*. The numeric ID is a reviewed expectation, **not proof the live GitHub Environment still has that ID**.

## Implementation and verified source topology

- Tighten `scripts/lib/paper-protected-environment-policy-candidate.mjs` to reject any candidate with a different positive Environment ID. Extend its existing offline fixture tests.
- New pure `scripts/lib/paper-environment-job-scope-gaps.mjs` combines 3P's real local Workflow source-topology audit and the 3R policy-candidate inspector. It binds the expected reviewed main SHA, repository, Environment name/ID, manual PAPER Workflow file, protected `admission` Job and exact *different* mutation Writer Job.
- Scope covers **four** pinned workflows: `ledger-filled-migration`, `recover`, `submit-canary` and `submit-persistent-repair`, each with a protected fail-closed `admission` Job but **a distinct mutation-capable Job without that Environment attached**.
- Any wrong ID, wrong source SHA, renamed/adversarial Job, altered YAML HOLD guard, disabled review rule, wildcard branch policy, forged "verified" claim, or changed Admission inventory becomes **DENY_PROTECTED_ENVIRONMENT_SCOPE_INVALID**.
- A completely matching, locally reviewed source and *untrusted* policy candidate yields **HOLD_PROTECTED_ADMISSION_POLICY_NOT_WRITER_AUTHORITY**. It never promotes source matching or reviewer settings into broker account authorization.

## External evidence still required

| Boundary | Externally verified input needed | Current result |
|---|---|---|
| GitHub policy identity | Trusted GET with independently authenticated origin + actual Environment numeric ID and reviewer/branch settings | UNVERIFIED |
| Administrator bypass | Actual applicable "prevent admin bypass" setting and appropriate history / audit logs. The 3R GET candidate is insufficient to prove this | UNVERIFIED |
| Runtime applicability | Trusted Run ID, attempt, code SHA and exact Job ↔ Deployment ↔ Environment decision; historical settings cannot be inferred from current settings | UNVERIFIED |
| Actual protected branch | Independently confirm `main` rulesets/branch protection when protected-branches mode is used | UNVERIFIED |
| Broker account scope | Independently enumerate account identities, credential grants, direct/scheduled/legacy/out-of-band writers | UNVERIFIED |
| Enforced account Writer fence | Independent edge-side lease/fencing validation across every mutating client, including crash/race/recovery tests | UNVERIFIED |
| Security & authority | Trusted anti-replay evidence, separate risk qualification and explicit human operational approval | NOT AUTHORIZED / HOLD |

The GitHub REST Environment response structure and role of deployment reviewer gates are documented at:
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments

**Current connected GitHub tool limitation:** known Actions Runs and Jobs are readable; direct Environment and deployment-branch-policy management endpoints were rejected by the connector. Therefore these tests use **synthetic** policy-shaped objects and do not verify any actual GitHub Environment configuration. The Admission baseline continues to declare `settingsEvidence=USER_REPORTED_NOT_FETCHED`.

## CI & safety

Offline tests `scripts/test-paper-environment-job-scope-gaps.mjs` cover all four Job pairings plus compromised SHA, foreign repository, swapped Writer identity, mismatched Environment ID, weaker reviewer/branch rule, altered source topology and forged authority claims. Both new test and changed 3R module/test are SHA-256 pinned in the Admission baseline and imported into the existing synthetic-only GitHub PAPER custody suite.

Frozen **17 Workflow / 21 Job / 10 OPEN blocker** inventory, `operationalHold=true` and `reviewBy=2026-12-11T00:00:00Z` are unchanged. No operational Workflow YAML, branch rule, Environment/Secrets mutation, broker call, order submit, PAPER state or cache/ledger write is included.

PR remains Draft until complete CI and an independent final code review; only a fresh explicit user request authorizes source merge, and that is never approval of PAPER/LIVE operations.

Legacy Knowledge Intake, Gemini and Obsidian schedule cleanup remains separate under `pungking/US_Alpha_Seeker` Issue #57.
