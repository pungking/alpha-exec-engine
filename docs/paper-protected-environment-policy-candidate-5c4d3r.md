# STEP 5C-4D-3R — GitHub protected Environment read-only policy candidate

Baseline: PR #79 merged on main as bef5af74542adb6a2a3f608672bcf961ac7a6d69; main push CI #43034221895 SUCCESS.

**SOURCE ONLY / OFFLINE TESTS / PAPER & LIVE OPERATIONAL HOLD**

## New evidence capability, not proof of authorization

GitHub officially documents GET endpoints for deployment Environment settings and custom deployment branch policies, as well as Workflow Run approvals and Job lists. The currently connected GitHub connector can read known Run IDs and Job lists but has **rejected** requests to Environment configuration and deployment branch-policy endpoints with connector-level HTTP 400. This is a connector access limitation, **not a finding about the actual GitHub Environment policy**. Thus actual protected Environment policy has **not** been independently observed, and the frozen source admission baseline remains settingsEvidence=USER_REPORTED_NOT_FETCHED.

| Exact read-only REST path | Candidate evidence | Still-unproven requirement |
|---|---|---|
| /repos/pungking/alpha-exec-engine/environments/PAPER_CUSTODY_APPROVAL | Required reviewers, self-review prevention, branch restriction mode | Trusted API-origin evidence at the relevant run/attempt |
| /repos/pungking/alpha-exec-engine/environments/PAPER_CUSTODY_APPROVAL/deployment-branch-policies?per_page=100&page=1 | Branch name patterns and pagination cardinality, only when custom patterns selected | Actual enforcement and exact run context |
| /repos/pungking/alpha-exec-engine/actions/runs/{run_id}/approvals | Historical review record; already addressed in 3J | Specific protected Job ↔ Deployment ID ↔ authorized reviewer binding |
| /repos/pungking/alpha-exec-engine/actions/runs/{run_id} and /actions/runs/{run_id}/jobs | Run SHA/attempt and Job outcomes; 3Q | Account-wide Writer exclusion and broker mutation-edge fencing |

Official API references:
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/rest/deployments/branch-policies
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

## Implemented source-only reader and inspector

scripts/lib/paper-protected-environment-policy-candidate.mjs supplies:
- A pure inspector of untrusted API-shaped responses, distinct from independently attested GitHub origin.
- An opt-in GET-only reader with exact allowlisted host and paths. It requires an injected credential, fetch transport and active AbortSignal; it does not load tokens from environment variables or automatically make any request.
- A conditional second GET for custom branch policies only when the first response specifies custom patterns.
- Maximum 128 KiB per response, strict JSON media type, consistent declared Content-Length vs streamed byte count, HTTP 200 only, no redirects, retries, mutable HTTP methods, or provider error exposure.
- A correct-shape candidate requires at least one required reviewer, prevention of self review, one branch-policy protection rule and either protected-branches mode or exactly one exhaustive literal main custom branch pattern. Missing, permissive, wildcard, incomplete or contradictory configurations are DENY.
- Matching untrusted payloads yield HOLD_UNATTESTED_PROTECTED_ENVIRONMENT_POLICY. Missing/weak inputs yield DENY_GITHUB_ENVIRONMENT_POLICY_CANDIDATE_INVALID. Both keep every execution flag false.

This **does not** attest actual policy, historical enforcement, reviewer identity, branch-protection state or trusted response origin. An injected transport can be forged and may ignore cancellation, so no guaranteed wall-clock deadline is claimed. Unknown API response properties are not logged or elevated to proof.

## Non-transferable Job boundary

In current reviewed Workflow source, protected PAPER_CUSTODY_APPROVAL applies to the fail-closed admission Job, not the distinct mutation-capable Job (ledger-filled-migration / recover / submit-canary / submit-persistent-repair). A real policy setting or reviewer decision for admission cannot automatically establish approval of the downstream Job.

Before any operational consideration, independent proof is still required for GitHub API origin, at-run Environment rules and Job-to-Deployment binding, complete broker credential and external Writer inventory, actual mutation-edge fence enforced for all clients, independent replay barrier, source/risk acceptance and separate human execution authorization.

## Test / workflow scope

scripts/test-paper-protected-environment-policy-candidate.mjs uses only synthetic mock HTTP GET responses, including malformed JSON, HTTP failure, incorrect content-type/size, weak reviewer policy, overbroad branch patterns, duplicate reviewers and missing/aborted credentials. No real GitHub Environment API call, broker API call or external write is made in CI.

Pin source and test SHA256 digests under the unchanged Admission inventory: 17 Workflows / 21 Jobs / 10 OPEN blockers, operationalHold=true, reviewBy 2026-12-11T00:00:00Z. No Workflow YAML, Secrets, ruleset, GitHub Environment, broker account or PAPER state is changed.

Separate legacy Knowledge Intake cleanup remains deferred in pungking/US_Alpha_Seeker Issue #57.
