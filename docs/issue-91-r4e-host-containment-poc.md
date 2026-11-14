# Issue #91 — R4E: host process containment alternatives, offline PoC and approval gates

**Security disposition: NOT ADMITTED. No host-wide no-orphan assurance. All operating HOLDs remain.**

## Exact source foundation

- main `73984070264f6e47cc8ab212b4ea4db0e09d7c20` at start of R4E
- parent Draft PR #102 HEAD `f2cfdd0cee7e398f9163667cec56a03c2510a6cb`
- R4D CI `43654706227` documented six inherited Linux scenarios and protected `REVIEWED_ENTRYPOINT_DRIFT` denial
- This R4E adds **test-only** PoC, docs and existing offline pre-Admission test import. No operational wrapper/probe/host services, workflow, checker or trusted baseline edits.

## Alternatives ranked by enforceable failure semantics

| Approach | Parent SIGKILL | Escaped setsid/PGID child | Availability | Judgment |
| --- | --- | --- | --- | --- |
| JS parent signal handlers + process-group kill | NOT GUARANTEED | DOES NOT CONTAIN | Already in probe | Keep only scoped same-group wording |
| PID tracking + detached supervisor in same job | Supervisor must survive; reparenting/pid reuse hazards | Can attempt cleanup of **discovered owned PIDs** | Disposable test only | Defense in depth, not hostile-code containment |
| Dedicated cgroup v2 **delegated child scope**, cgroup.kill by owner | Potentially enforced by kernel when descendant remains inside delegated scope | Handles setsid/PGID escapes *if membership cannot be escaped* | NOT VERIFIED on GitHub runner | Preferred candidate for an independently authorized real sandbox PoC |
| systemd transient scope / container or runner-owned supervisor | Scope owner outside disposable worker can survive worker SIGKILL | Depends on hierarchy, privileges, delegate configuration, integration | NOT VERIFIED | Alternative if controlled deployment runner supports it |
| GitHub runner job teardown | Runner-owned process cleanup might be available | No tested guarantee for this work | NOT VERIFIED | Must not substitute for a documented host contract |

**Critical constraint**: A cgroup mounted on a runner does not establish delegation or authority to create a scoped subtree, migrate a process, invoke `cgroup.kill`, or prevent descendant migration. `/sys/fs/cgroup/cgroup.kill` at the root must **never** be written. GitHub-hosted runner image/permissions are mutable external facts. No cgroup mutation was approved or performed in R4E.

## R4E isolated test-only PoC

`scripts/test-private-sidecar-host-containment-poc-r4e.mjs` performs:
1. READ-ONLY inspect `/proc/self/cgroup` and `/proc/self/mountinfo`; report cgroup v2 observation without declaring writable delegation. Only tests existence of root `cgroup.kill` path, never reads/writes its contents.
2. Spawn a disposable fixture Node worker under the existing offline test with no broker, provider, market data, credentials or network. The fixture spawns one `detached:true` Node descendant with an independent process group/session, both with bounded 4-second lifetimes.
3. Capture only PID and `/proc/[pid]/stat` starttime for exact synthetic cleanup. SIGKILL the synthetic worker and confirm its escaped child survives, demonstrating the containment deficiency.
4. Clean up only recorded fixture PIDs with matching starttimes. The fixture supervisor's cleanup is **not** credited to the production wrapper or host-wide containment.
5. Emit sanitized booleans and enumerations, never PIDs or host cgroup paths. External process migration, privileged cgroup operations and operational source execution are categorically forbidden.

The process identity check has a narrow PID reuse race and is not pidfd-based. A successful PoC only proves that this **synthetic** escaped child survives its parent, and the offline harness can clean up fixture processes. It is not a kernel cgroup containment demonstration.

On non-Linux hosts, emit `R4E_POC_SKIPPED`, not PASS. On Linux the expected output is `R4E_ISOLATED_SYNTHETIC_POC_PASS`, with `cgroupMutationAttempted:false`, `hostWideNoOrphan:"UNVERIFIED"`, `admissionApproved:false`, `operationalHold:true`. The existing Admission check still must FAIL `REVIEWED_ENTRYPOINT_DRIFT` for stacked #97–#102 changes.

## Required future restricted host PoC (NOT authorized by R4E)

A separate consented sandbox or disposable dedicated runner must provide explicit delegation of a **new** owned cgroup sub-scope, never a shared/root cgroup. Before touching cgroup files, record mount identity, namespace, ownership, hierarchy, process migration scope, effective permission and cleanup/rescue policy. Restrict delegated subtree membership. Test synthetic worker and setsid escaped child, kill worker SIGKILL, use the kernel's child-scope `cgroup.kill`, assert descendants are absent using trusted PID identity. Validate cancellation, failure, PID reuse, cgroup escape, hung I/O, rejected delegation, test timeout and teardown. Do not mutate GitHub-hosted runner cgroup or real job scope without independent explicit approval and safe rollback.

## Admission and release hold

- Admission baseline remains 140 protected source hashes / 17 workflows / 21 jobs / 10 OPEN blockers; no change to trust SHA, Checker, workflow, Ruleset, package scripts or safe execution defaults.
- Existing R4C N03 synthetic regression tests pass, but adversarial filesystem races remain outside proven scope.
- R4B/R4D detached process escape and probe SIGKILL are *documented gaps*, not resolved by R4E.
- Independent human security and operations review is REQUIRED prior to any proposed trust re-attestation.
- Separate user approval is REQUIRED for any trust/baseline changes, any scoped host containment implementation, and any PR-specific merge.
- All PAPER/LIVE, dispatch/rerun, real provider/broker, account/order/state and operational execution remain HOLD. Issue #91 historical failure cause UNKNOWN.
