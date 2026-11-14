# Issue #91 — STEP #91-14C-R4F: Dedicated cgroup v2 preflight and real PoC approval specification

**Disposition: OBSERVATION ONLY, DENY REAL ISOLATION POC pending separate authorization.** This file defines a proposed protocol, not permission to execute it.

## Frozen inputs at R4F creation

- Latest observed main `73984070264f6e47cc8ab212b4ea4db0e09d7c20`.
- Stacked Draft PR #103 HEAD `08a7222c659d81c654d9fb863aa15599ad08e3d0`.
- R4E GitHub Linux PR CI run `43655597960`: synthetic process PoC passed, `cgroup.version=V2_OBSERVED`, `delegation=UNVERIFIED`, `killApi=ROOT_KILL_FILE_NOT_OBSERVED`, `isolationTest=NOT_RUN`; existing Admission correctly rejected `REVIEWED_ENTRYPOINT_DRIFT`. This is NOT successful host isolation.
- Issue #91 OPEN; historic Stage6 bootstrap cause UNKNOWN; 140 protected hashes, 17 workflows, 21 jobs and 10 OPEN blockers unchanged.

## R4F preflight security boundaries

The test `scripts/test-private-sidecar-cgroup-preflight-r4f.mjs` uses four deterministic input fixtures and read-only `/proc/self/cgroup`, `/proc/self/mountinfo`, `/sys/fs/cgroup/cgroup.controllers`. It only reports booleans/enums. It never writes to `/sys/fs/cgroup`, never invokes `cgroup.kill`, never creates a sub-cgroup, never migrates a process and never invokes a real producer.

Observing cgroup v2 mount and membership is not proof of delegated authority, permission to use `cgroup.kill`, process membership confinement, cgroup namespace ownership, or a reliable clean-up path. Host-specific mount paths and PIDs must not be emitted. Any missing capability returns UNVERIFIED rather than elevating authority. No privileged probing or container launch is permitted in R4F.

## Decision matrix for the proposed *future* real containment experiment

| Condition | Required independent evidence | Fail-closed result if missing |
| --- | --- | --- |
| Isolated destination | Dedicated ephemeral VM/container or exclusively owned self-hosted runner, not shared production or normal GitHub-hosted runner | DENY |
| Authority | Explicit user approval **for that host**, separate written security/ops authorization, owner and deletion window | DENY |
| Cgroup delegation | cgroup v2 hierarchy and delegated **new child** subtree, write scope and namespace ownership confirmed by host operator | DENY |
| Exclusion | Existing runner, daemon, broker, account and unrelated PID trees are never members of test child scope | DENY |
| Kill API | `cgroup.kill` writable only in the exclusively owned child scope; never target root/shared hierarchy | DENY |
| Network / secrets | Disposable synthetic-only fixture, denied external network and credentials absent; no broker/provider/real Stage6 | DENY |
| Rollback | Out-of-band supervisor/console access, pre-defined teardown and reclaim of owned scope even on test crash | DENY |
| Evidence | Versioned host/kernel/container/sandbox identity, isolated scope identity, start/finish readback and independent human read-only review | DENY |

### Proposed future experiment, NOT authorized here

After confirming the above gates independently in a controlled dedicated sandbox:

1. Verify cgroup v2 delegation is restricted to a **new test-only** owned child subtree and that no shared PIDs can join it. Do not rely on root-path `cgroup.kill`.
2. Have an independently surviving privileged supervisor create and exclusively own the sub-scope. The test itself must not have permission to write parent or sibling scopes.
3. Spawn disposable offline Node parent and one escaped setsid child inside the owned scope. Record PID identity and membership readbacks without printing sensitive host paths.
4. SIGKILL the parent; verify child survives at this interim stage but **remains in the delegated scope**.
5. From the supervisor, invoke child-scope `cgroup.kill` (never system/root shared scope), verify membership empty or documented zombies, and assert no runnable descendants after a bounded grace window.
6. Negative tests: no delegation; wrong scope; PID replacement; child cgroup migration; failed `cgroup.kill`; runner cancellation; resource exhaustion; signal interruption; stale scope; rollback after process crash. Treat any uncertain result as DENY.
7. Independent reviewer validates the readback evidence and signs a human-only approval record. If cleanup fails, stop, isolate the host and use out-of-band owner recovery. Do not retry blindly against a broader cgroup.

None of the above seven steps grants operational permission by appearing in this document. No execution is authorized until a new explicit user decision specifying host, scope, risks, test period and recovery owner.

## Admission/source governance

- R4F is source-only offline preflight and documentation. Do NOT change `config/paper-workflow-admission-baseline.json`, `scripts/check-paper-workflow-admission.mjs`, its canonical trusted digest, GitHub Workflow, Ruleset, package scripts or operational runtime source.
- Exact-HEAD R4F CI must show `R4F_READONLY_CGROUP_PREFLIGHT_PASS` **before** the old Admission's intended `REVIEWED_ENTRYPOINT_DRIFT` rejection. The full CI remains FAILURE and subsequent steps can be SKIPPED. A test PASS is not Admission PASS.
- Require an actual independent human security/ops decision in addition to AI technical COMMENT, and separate user PR-specific approval before any merge. Trusted re-attestation is a separate approval from source merge; no automatic updating of trust hashes.
- Baseline remains operationalHold=true, 10 OPEN blockers. PAPER/LIVE, account/order/state, dispatch/rerun, provider/broker, actual analysis and any real host cgroup writes remain HOLD.
- R4F rollback: close its Draft PR or revert its test/docs additions; no operating state should require recovery because this change does not mutate the host cgroup.

**Decision: NO-GO for real containment PoC on the currently evidenced GitHub-hosted Runner; approval remains unrequested/ungranted.** A privately controlled, dedicated test environment may be considered only after fresh authority and isolation verification.
