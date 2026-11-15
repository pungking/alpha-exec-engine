# Issue #91 — STEP #91-14C-R4G: Isolated cgroup v2 acceptance plan and execution approval boundary

**State: DEFERRED actual host construction and cgroup process-kill experiment.** This Draft PR is design + deterministic offline negative tests only. Operational **HOLD** remains.

## GitHub evidence and dependency chain

- Observed main at start: `73984070264f6e47cc8ab212b4ea4db0e09d7c20`.
- R4F parent PR #104 exact HEAD: `5433a0fc0907f51fa48f5c4400f3c4abc6a420c0`, Draft/unmerged.
- Prior R4F PR CI: run `43655939965`, offline cgroup preflight PASS but overall FAIL at `REVIEWED_ENTRYPOINT_DRIFT` protected Admission.
- cgroup v2 membership/mount/controllers were **observed only** on the GitHub-hosted Linux runner. Delegated child scope, owned dedicated host, right to issue child-scope kill and independent recovery authority were **not verified**.
- Issue #91 historical root cause remains UNKNOWN. Protected inventory 140 hashes / 17 workflows / 21 jobs / 10 OPEN blockers is not re-attested.

## Decision: why no actual host mutation in R4G now

A generic “proceed if no problems” instruction cannot establish physical ownership of an isolated host or authority to change host cgroup hierarchy. Running `cgroup.kill` at root/shared scope can terminate unrelated processes, potentially the CI runner itself. R4F explicitly identified missing authority, delegated scope verification and host-wide containment evidence.

The real host test is **DEFERRED** until a separate user host-specific approval and independent human security + operations approvals are recorded. The approval must identify dedicated sandbox owner, exact limited environment, permitted scope, duration, recovery operator, network isolation, safe rollback, and evidence policy. This R4G PR creates no host, service, container, cgroup or process.

## R4G model: two independently enforced gates

### Gate A — isolated-host design intake (this R4G PR: offline only)

`scripts/test-private-sidecar-cgroup-approval-r4g.mjs` evaluates 15 mandatory gates in synthetic test records with strict boolean checks, denies empty/partial/unsafe inputs, tests a fully populated synthetic fixture but returns **DESIGN_READY_ONLY**, never actual execution authorization. Mandatory gates:

1. dedicatedEphemeralHost;
2. hostOwnerIdentified;
3. outOfBandRecoveryConfirmed;
4. separateUserHostApproval;
5. humanSecurityApproved;
6. humanOperationsApproved;
7. cgroupV2DelegatedChildVerified;
8. noSharedPidsInScope;
9. independentSupervisorOutsideChild;
10. childOnlyKillAuthorization;
11. scopeEscapeDenied;
12. networkDenied;
13. credentialsAbsent;
14. syntheticProducerOnly;
15. boundedCleanupVerified.

A synthetic manifest with all fifteen booleans true is **not evidence** that any approval or control exists. The actual external attestations must be verified by an independent reviewer before a separate, explicit user execution decision. All root/shared scope requests DENY.

### Gate B — future real Linux host experiment (NOT implemented or authorized)

Only within an explicitly owned, disposable Linux host with a pre-established delegated cgroup v2 **child** subtree:

1. A separate host-owned supervisor verifies exclusive membership and confirms no unrelated PIDs or sensitive services exist within the child scope. The supervisor stays **outside** the target child scope.
2. Stage only synthetic Node workers with bounded lifespan and no external network or credentials. Never run any actual private diagnostic producer, broker or PAPER/LIVE engine.
3. Spawn a synthetic parent and escaped setsid/PGID descendant **within the delegated child scope**; confirm membership by independent readback without publicly disclosing PID/host paths.
4. SIGKILL only the fixture parent to prove the escaped child remains runnable temporarily, but belongs to the dedicated delegated child scope.
5. **After a new separate user execution authorization**, the external supervisor may write `cgroup.kill` to the explicitly owned **child** cgroup. Never write root/shared `cgroup.kill`, never broaden target on error.
6. Read back the scoped `cgroup.procs` and verified process identities, allow a bounded zombie/reaping grace period, and assert no runnable fixture descendants; distinguish actual kernel containment from test supervisor cleanup.
7. Record bounded timeout, cancellation behavior, bad delegation, child migration, PID reuse, wrong-scope attempts, partial kill, host crash, and cleanup/rollback failures as explicit FAIL/UNVERIFIED; never label a skip as PASS.

These steps are a future proposal, not a script executed by the current CI. Actual no-orphan guarantees are not established until a separately authorized execution and evidence review.

## Rollback, custody and review

- Rollback for the current R4G PR: close Draft PR or revert its documentation/test-only changes; no host recovery should be necessary because no real cgroup operations occur.
- Future experiment rollback: independent out-of-band console/host owner retains a distinct control path; if worker cleanup cannot be independently confirmed, stop and quarantine the dedicated ephemeral host rather than killing broader scopes.
- All records are sanitized and should contain only enums/booleans/hashes and exact repo HEAD/CI links. Do not print host cgroup paths, credentials, PIDs, private logs or account metadata.
- Validate exact-HEAD test-only PR CI. The existing Admission `REVIEWED_ENTRYPOINT_DRIFT` remains expected and must not be bypassed, refreshed or conflated with a green CI.
- Approval to merge a PR is distinct from human independent review, Admission re-attestation and any real host experiment. All require separately scoped decisions. AI technical COMMENT is not a human security approval.
- No workflow dispatch/rerun, actual analysis, external provider/broker, PAPER/LIVE, account/orders/state or host cgroup changes. Source merge, protected SHA update, Checker, Workflow and Ruleset changes are **HOLD**.

**R4G disposition:** host construction and actual cgroup v2 termination verification are **DEFERRED** because host-specific approval/delegation have not been established; offline design and negative acceptance-contract verification can proceed safely.
