# STEP 5C-4D-3V — source brokerage secret references and external Writer verification

**Base:** PR #83 merged on main at 393499a7b3bbaa764b662a69f3f1cfffec0f858d; post-merge main push sidecar-ci #43048923921 completed SUCCESS.

**SOURCE ONLY / OFFLINE / PAPER-LIVE OPERATIONAL HOLD.** No actual broker credentials or account APIs were inspected, no order/state mutations or GitHub policy changes, no operational authorization.

## Why this matters

The connected GitHub Ruleset 26952584 currently says required_approving_review_count=0 for main, although strict build is required. Proposing at least one independent human code review requires a separate, scoped admin change and a real reviewer able to approve. It is NOT an operational broker approval and must not be changed implicitly in 3V.

The reviewed Admission Inventory has **9 Jobs referring to both ALPACA_KEY_ID and ALPACA_SECRET_KEY**, but none of those 9 Jobs directly references protected Environment PAPER_CUSTODY_APPROVAL:

| Source category | GitHub Workflow / Job | Jobs |
|---|---|---|
| Automatic report/cache writer | dry-run.yml#dry-run, market-guard.yml#market-guard | 2 |
| Manual ledger/state migration | ledger-filled-migration.yml#ledger-filled-migration | 1 |
| Broker read/verify | paper-five-row-broker-evidence-recovery.yml#restore-and-read, paper-oco-read-verify.yml#read-verify, persistent-oco-repair-open-verify-multi.yml#verify-open-protection-multi, persistent-oco-repair-open-verify.yml#verify-open-protection | 4 |
| Broker submit/cancel | paper-oco-submit-canary.yml#submit-canary | 1 |
| Persistent broker submit | persistent-oco-repair-submit.yml#submit-persistent-repair | 1 |

Counts: 2 + 1 + 4 + 1 + 1 = **9**. Four source-protected admission Jobs remain separate, have no Alpaca secret names and preserve their existing fail-closed source gate. A source secret name is NOT proof a real GitHub secret exists or has broker permissions, nor proof its key belongs to PAPER vs LIVE accounts, or that the Job ran. A separate Job-level Environment is not inherited from admission.

## New source-only inventory audit

scripts/lib/paper-broker-secret-source-surface.mjs is a pure offline inspector that checks:
- Frozen reviewed source 4ebc37c29b7ee32001a83ed03375d96cdcd7f961, main/paper-state ref scope, settingsEvidence USER_REPORTED_NOT_FETCHED, operationalHold true, exactly 17 workflows, 21 jobs, 10 OPEN blockers
- Exactly the nine source broker secret-reference Job identities with exact role classification and both Alpaca credential names; new, missing, partial, duplicate, dynamically referenced or extra ALPACA-prefixed secret refs DENY
- Direct protected Environment presence, admission classification and its absence of broker secrets; changed source scope DENY
- Static read-only and execution flags where those flags are present, but **absence of a flag is never proof that runtime execution is safe**
- Reject forged assertions of broker access rights, independent external Writer enumeration or human operational approval

Matching source input returns HOLD_EXTERNAL_BROKER_WRITER_INVENTORY_NOT_VERIFIED; mismatches DENY_BROKER_SECRET_SOURCE_INVENTORY_DRIFT. Neither path grants operations. Outputs expose **source file/job names only**, not credential values. This inspector consumes caller-supplied baseline data and requires the existing separately pinned SHA256 Admission CI for integrity. It is not an externally authenticated inventory.

## External evidence required separately

| Evidence surface | Required investigation | Current evidence |
|---|---|---|
| Account identity and isolation | Owner-verified PAPER account, explicit exclusion of LIVE credentials, account identifier redacted in reports | NOT COLLECTED |
| Credential inventory | Broker key grants, OAuth applications, broker users, direct API clients and broker-side trade capabilities | NOT COLLECTED |
| GitHub secret configuration | Current repo/org/environment secret name presence, scope, availability to each of 9 jobs, actual broker privileges — never disclose values | NOT COLLECTED |
| Other possible Writers | Local Mac scripts, third-party services, retired workflows, agents, cloud hosts, scheduled tasks, human brokerage UI, manual and out-of-band clients | NOT COLLECTED |
| Enforced global mutation fence | Shared writer lease and fencing enforced *at each mutation edge* across all clients; collision, crash, takeover and stale-lease tests | NOT IMPLEMENTED |
| Independent operational approval | Exact Run/Job/Deployment/account, risk limits, reviewed code SHA, human authorization, audit history and anti-replay barrier | NOT AUTHORIZED |

Some broker APIs do not expose an exhaustive credential or external application inventory. If independent enumeration is unavailable, mark it UNKNOWN and preserve HOLD, rather than asserting no outside writers. Do not paste credential values or token contents into GitHub or ChatGPT.

## Independent GitHub human-review adoption assessment (proposal, NOT change)

A future isolated Ruleset adjustment could require at least one independent GitHub APPROVE, consider dismissing stale reviews and mandatory last-push approval, and evaluate bypass and thread resolution. First verify that an authorized *different person* can review and approve PRs, with correct repository permissions. On a solo repository an unsupported rule can deadlock merges. A technical COMMENT does not satisfy APPROVE, and source PR approval never authorizes account mutation. No Ruleset is changed by 3V.

## CI and safety

The new offline test reads the reviewed baseline fixture, checks missing/added broker secret references, job role and Environment changes, changed static flags, dynamic refs and forged authority claims, then joins the existing GitHub PAPER Custody CI with SHA256-pinned code/test evidence. Source baseline remains **17 Workflows, 21 Jobs, 10 OPEN blockers**, operationalHold=true, review deadline 2026-12-11T00:00:00Z.

No operational Workflow YAML, Environment, Ruleset or Secret settings changed. No brokerage credentials inspected, no real API calls, no orders, no account/PAPER state write, no LIVE execution. Existing Knowledge Intake/Gemini/Obsidian cleanup remains separate under US_Alpha_Seeker Issue #57.
