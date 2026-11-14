# Issue #91 STEP #91-14C-R4D — Process containment and pre-attestation security review

**Decision: DENY admission re-attestation, DENY merge, operational HOLD.** This document is a **review candidate**, not a trust root, a permission grant, or a substitute for independent human security/operations review.

## Verified inputs (freeze at review)
- main: `73984070264f6e47cc8ab212b4ea4db0e09d7c20`
- stacked PR #101: `6a5cabef0ef47ae0ad6d8a64f7101797c0b1175c`; PRs #97–#100 remain prerequisite unmerged Draft work.
- R4C exact-HEAD PR CI: `43637822293`, build job `132577992732`, concluded FAILURE at `PAPER workflow admission inventory` with `REVIEWED_ENTRYPOINT_DRIFT` (defensive denial). Earlier offline security test reports 27 observations, `n03SymlinkAndPathSwapVerifiedOffline:true`. Linux process-tree test reports the six cases below. Subsequent CI steps were not executed.
- 140 pinned source hashes; 17 workflows; 21 jobs; 10 OPEN blockers; `operationalHold:true`. Existing baseline remains unchanged. Historic Issue #91 bootstrap root cause UNKNOWN.
- This R4D document is based on source inspection and captured R4C CI logs. No fresh host-wide root/cgroup isolation test is implied.

## Threat-model split: observable claim vs missing guarantee

| Boundary | Evidenced behavior | Security consequence / acceptance |
| --- | --- | --- |
| C1: classifier exits normally, same process group | same-group-success test; no running descendant after grace period | accept **scoped Linux synthetic same-group cleanup** only |
| C2: SIGTERM, SIGINT, SIGHUP delivered to probe | observed children gone under the synthetic harness | accept **caught-signal same-group cleanup** only; no adversarial signal race proof |
| C3: classifier forks detached child into another session/group | `escaped-timeout` descendant survives until test-owned supervisor cleans it | **OPEN**: `kill(-pid, SIGKILL)` cannot reach an escaped group; cannot claim no-orphan |
| C4: probe parent SIGKILL | `killed-probe-parent` child survives until supervisor cleanup | **OPEN**: SIGKILL is uncatchable; JS finally/signal handling cannot guarantee cleanup |
| C5: wrapper or GitHub runner killed, cancellation, resource exhaustion | no actual cancellation/runner teardown experiment | **UNVERIFIED**; no implication of durable original exit status |
| C6: descendant retains pipe or opens another FD | probe promises bounded output and timeout, tests only specific paths | **UNVERIFIED**: no complete FD inheritance/escape proof |
| C7: container/job/cgroup lifecycle kill | no isolated cgroup delegated runner and no authoritative kernel attestation | **UNVERIFIED**; may require orchestrator/runner integration before guarantees |
| C8: malicious or network-capable spawned executable | tests use synthetic Node child; no OS network namespace isolation | **UNVERIFIED**; not an operational permission |

## Admissible offline tests

The pre-existing `scripts/test-private-sidecar-process-tree-r4b.mjs` is executed by the existing pre-Admission test import in CI. Its **actual** Linux results at R4C were:
- same-group-success: `descendantSurvived:false`
- escaped-timeout: `descendantSurvived:true`
- SIGTERM: `descendantSurvived:false`
- SIGINT: `descendantSurvived:false`
- SIGHUP: `descendantSurvived:false`
- killed-probe-parent: `descendantSurvived:true`

All six use a finite-lived synthetic child; cleanup of recorded PID+process-starttime identities is performed by the **test supervisor**. That cleanup must never be misreported as the product wrapper's containment. Linux procfs zombie handling is not the same as global child reaping. macOS results are explicitly not equivalent. No further real analysis or workflow dispatch is authorized.

The R4D contract test `scripts/test-private-sidecar-containment-contract-r4d.mjs` is offline/read-only. It makes accidental promotion of six scoped observations into a blanket `hostWideNoOrphan:true` fail; it is **not a new no-orphan stress test**.

## Decision gates before admitting source or trust hashes

1. Independently approve the exact runtime source closure and identify every repository-controlled new execution dependency, including probe, classifier and transitive static imports; review source producer/run-step semantics separately.
2. Define a **supported operational containment scope**: either contractually limit claims to same-group descendants **or** design and test a host/job-level containment mechanism (e.g. OS cgroup or runner-owned process supervision) under its actual security boundary. Do not claim a `killpg`-based process tree guarantee.
3. If stronger containment is required, use a **new** scoped design/fix Draft PR only after approval, with lifecycle test cases covering escaped setsid children, SIGKILL, runner cancellation, deadline, pipe retention, FD inheritance, stop/restart, resource limits and cleanup ownership. Do not opportunistically modify runtime in R4D.
4. Independently review R4C's no-follow file-descriptor changes for remaining TOCTOU/ancestor-symlink hazards, fallback behavior, privacy, max buffer and permission edge cases. N03 fixture PASS is a bounded observation.
5. Obtain documented **actual human** security + operations reviewer decisions and required repo governance review (AI COMMENT does not count as human APPROVE).
6. Separately request explicit user approval before any Admission baseline/checker/trust digest/Ruleset/Workflow change; keep 10 OPEN blockers, expiry, zero eligible jobs and HOLD until separately reauthorized. An old Admission failure is not a CI green pass.
7. Source PR merge requires **separate PR-specific user approval** after independently reviewed safe source and appropriate new CI; then validate post-merge main CI. Merge is not operations release.

## Recovery / rollback

R4D branch changes are test/doc only. Close its Draft PR or revert these two files to roll back with no operational state consequences. R4D never writes the trusted baseline, workflow, Ruleset, package script, secrets, cache, paper-state, broker, account or order.

**Verdict**: R4C narrow N03 offline observations accepted; R4B C3/C4 containment limits still OPEN; complete host-wide no-orphan and admission trust transfer NOT VERIFIED; operational HOLD remains.
