# STEP 5C-4D-3T — moving `main` ref versus frozen 3S source snapshot

**Base:** PR #81 merged by Merge commit `73361997484c83a17e5dd391dcf566179b2f6521`. Post-merge `main` push `sidecar-ci` #43038644527 **SUCCESS**.

**Scope:** GitHub repository read-only source lineage. Absolutely no PAPER order, state mutation, LIVE trade, GitHub Environment change, workflow dispatch, broker credential use, external proof promotion or removal of existing HOLD.

## Real GitHub source observation (not operational authorization)

Using the connected read-only GitHub repository API, the following were independently observed during 3T planning:

| Observation | Value |
|---|---|
| `GET /repos/pungking/alpha-exec-engine/branches/main` | branch `main`, commit `73361997484c83a17e5dd391dcf566179b2f6521`; `protected=true` summary |
| `GET /repos/pungking/alpha-exec-engine/git/ref/heads/main` | `refs/heads/main`, commit `73361997484c83a17e5dd391dcf566179b2f6521` |
| `GET /repos/pungking/alpha-exec-engine/commits/73361997484c83a17e5dd391dcf566179b2f6521` | first parent `6cd26eb4fffc32c181a6768b3f9eaff589162bb8`, second parent `176cd04aa3b4fd04f3d04981216042ac70f36082`; commit tree `ec366d4aedae5c30a4dc754ca8b2031cfc06d77a` |

This confirms that the frozen 3S reviewed-source anchor `6cd26eb4...` and the newer `main` merge commit `73361997...` are **different**. The fact that `main` reports `protected=true` says only that GitHub branch metadata reports protection; it does **not** independently attest the exact current or historical branch rulesets, administrator bypass protections, Environment reviewer decisions, Job-specific approvals or broker Writer custody.

## Actual currently active GitHub Rulesets — independent read-only observation

The GitHub connector independently retrieved the repository's active branch Rulesets (GET /repos/pungking/alpha-exec-engine/rulesets and /rulesets/{id}). These are **current GitHub server configuration snapshots**, not signed evidence of policy enforcement during any historical Job/Deployment attempt:

| Ruleset | Target and current enforcement | Important observed policy |
|---|---|---|
| [26952584](https://github.com/pungking/alpha-exec-engine/settings/rules/26952584) — alpha-main-source-protection | main, active, bypass_actors=[] | Reject deletion/non-fast-forward; require PR merge (method merge); strict status check `build` (integration 15368); `required_approving_review_count=0`, code-owner review not required, review-thread resolution not required |
| [26956735](https://github.com/pungking/alpha-exec-engine/settings/rules/26956735) — alpha-paper-state-admission-hold | paper-state, active, bypass_actors=[] | Creation and update rules active |
| [26956389](https://github.com/pungking/alpha-exec-engine/settings/rules/26956389) — alpha-paper-state-integrity | paper-state, active, bypass_actors=[] | Deletion and non-fast-forward restrictions active |

**Operational relevance:** A `main` branch ruleset demanding **zero** approving reviews must not be described as independently requiring a human GitHub `APPROVE`. The recorded source-only technical `COMMENT` and explicit conversational merge request are not a GitHub required-approval policy. The user-requested source merge does not authorize PAPER/LIVE trading. Before any operational policy change, independently assess whether to require at least one separate human approval and evaluate code-owner protections under an isolated, separately authorized branch/ruleset modification. This PR **does not edit any Ruleset**.

The branch-protection subresource (`GET /branches/main/protection`) returned GitHub 403 `Resource not accessible by integration`; this access limitation does not contradict the independently accessible active Rulesets. Current Ruleset reads do not validate the protected Environment approval or account-wide brokerage Writer exclusion.

## New GET-only acquisition and consistency check

`scripts/lib/paper-reviewed-main-ref-snapshot.mjs` adds a pure source-snapshot inspector and an **optional**, strictly GET-only candidate collector. The collector never runs automatically and requires a caller-injected token, transport and AbortSignal. There is no ambient token, worker, cron, GitHub Action dispatch, credential store or broker import.

The collector performs up to four sequential, exact-host GitHub REST GETs:
1. `/repos/pungking/alpha-exec-engine/branches/main` (snapshot before)
2. `/repos/pungking/alpha-exec-engine/git/ref/heads/main`
3. `/repos/pungking/alpha-exec-engine/commits/{validated_branch_sha}` (fixed 40-hex SHA only)
4. `/repos/pungking/alpha-exec-engine/branches/main` (snapshot after)

It checks the same reported SHA across both branch responses, Git ref and commit resource; validates commit parent SHA shapes and commit tree identity, expected main branch/ref and a `protected=true` branch *summary only*. A moving or contradictory read is **DENY_MAIN_REF_OBSERVATION_INVALID**; a matching frozen source SHA is **HOLD_FROZEN_REVIEWED_SOURCE_REF_MATCH**; a consistent observed SHA different from the reviewed 3S anchor is **HOLD_MAIN_MOVED_BEYOND_REVIEWED_SOURCE**. Both matching cases preserve **all operational authority flags false**. A first-parent match is merely lineage shape evidence, not signed/independently attested GitHub provenance.

Mock-only transport includes no redirects, no retries, GET only, 96-KiB per-response byte ceilings, Content-Length equality, JSON HTTP 200 media checks and no logging of raw provider payloads or token. It has no guaranteed wall-clock deadline if an injected transport ignores AbortSignal. A successful same-SHA check over separate GETs cannot eliminate all possible ref movement between reads or forgeable caller-supplied responses. No record is signed or persisted and no independent replay control exists.

## Why this matters for future 3U+

The reviewed Job/Environment source probes in 3P–3S intentionally pin exact historical source SHAs. Once `main` changes, these anchors must remain **frozen provenance**, not silently be described as current `main`. Any proposed promotion to a newer source must require a fresh, separately reviewed source SHA, recomputation of referenced Workflow YAML inventory, exact code diff and CI linkage, and independent protected policy/approval/custody evidence. The 3T inspector detects the **difference**, but does not itself rotate the approved anchor or grant any run permission.

Remaining operational prerequisites are independent GitHub Environment policy and bypass settings, a trusted exact run-attempt Job ↔ Deployment ↔ human approval join, complete broker account/credential/direct/legacy Writer inventory, enforced broker-side shared Writer fencing, replay controls and separately authorized human execution approval. All remain **UNPROVEN / HOLD**.

## CI integration

`scripts/test-paper-reviewed-main-ref-snapshot.mjs` exercises synthetic first-parent movement, stale source, ref race between branch reads, malformed commit/branch records, forged authorization, HTTP status/media/size/length failures and secret non-reflection with mock GET. It is imported into network-denied PAPER Custody tests and SHA-256 pinned under existing Admission baseline. No real GitHub network request is performed by CI.

The unchanged 17-workflow / 21-job / 10-OPEN-blocker Admission inventory, `operationalHold=true` and deadline `2026-12-11T00:00:00Z` remain in place. Existing Knowledge Intake cleanup remains separate at `pungking/US_Alpha_Seeker` Issue #57.
