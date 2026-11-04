# GitHub PAPER Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. User selected Native implementation and one fresh whole-branch review. Checkboxes track actual completion, not runtime authority.

**Goal:** Implement the approved encrypted checkpoint contract and existing-consumer persistence barriers without activating a workflow or constructing missing risk evidence.

**Architecture:** Existing ledger/idempotency and companion files remain authoritative data. A bounded injected GitHub transport publishes one encrypted snapshot with exact-parent, non-force ref advancement. Branded in-process custody sessions gate store, wire, observer and notification barriers. No default network client or runnable deployment entry point.

**Tech Stack:** Existing Node standard library, crypto/export helpers, scoped stores/controller and network-denied assert fixtures. No dependency changes.

**Spec:** ../specs/2026-11-03-github-paper-custody-design.md (user-approved design; deployment remains unapproved).

## Global Constraints

- Only alpha-exec-engine changes. No operational state, cache, credentials, keys, broker API, notification delivery or workflow dispatch.
- Preserve READ_ONLY=true, EXEC_ENABLED=false, LIVE_ORDER_SUBMIT_ENABLED=false and observe defaults. No change to automatic-trigger denial, thresholds, Stage6 or OOS.
- Separate custody config schema from the old single-host invocation. Never relabel a GitHub runner as a verified Mac. The full risk-dependent caller stays blocked.
- GitHub fetch/push/PR/CI only for source integration; no operational state branch/key provisioning.
- Runtime activation/seed adoption/key custody are not implied by merge. Fixtures are synthetic and network denied.

## Review Focus

1. Lost acknowledgement poisons a session; even confirmation later must not resume submit.
2. Two locally valid store writes are not an atomic pair; publish only validated pairs.
3. Restoring only root files loses backups/claims/wire/notification deduplication.
4. A JSON object or absent callback must not impersonate an opaque custody session.
5. Persist latency must not extend broker evidence/authority deadlines or revive an old attempt.

## Task 1: Snapshot and bounded Git reference protocol

Files: new scripts/lib/github-paper-custody.mjs; new scripts/test-github-paper-custody.mjs; new synthetic scripts/fixtures/github-paper-custody.mjs if needed.

Interfaces (new, not previously existing):
- validateGithubCustodyConfiguration(config): static VALID_NOT_EXECUTION_READY/BLOCKED.
- openGithubCustody({config, request, privateKey, directory}): restore verified exact checkpoint and return opaque session. request is injected {method,path,body,signal} -> {status,data}; no ambient fetch/credentials.
- checkpointGithubCustody(session, phase): validate the full local closure, publish/ack exact child, return only safe commit/hash metadata.
- assertGithubCustody(session, {directory, accountSha256?, attemptId?}): reject missing/forged/poisoned/closed bindings.
- releaseGithubCustody(session): acknowledged handoff; no cancellation or state erasure.

- [x] Write failing export/round-trip fixture; verify RED before implementation.
- [x] Implement strict config, encrypted closure, private new-directory extraction, bounded ancestry/request/deadline handling, no fallback or retry.
- [x] Add collision, missing/stale source, mismatched hash/key/account, unsafe path, lost ACK, abandoned claim, size/ancestry/request bound and redaction fixtures.
- [x] Run tests under scoped-paper-offline.cjs; publish only synthetic in-memory Git objects.

## Task 2: Existing-consumer durable barriers

Files: scripts/lib/scoped-closeout-storage.mjs, scoped-paper-adapter.mjs, scoped-paper-oversight.mjs, scoped-paper-operational.mjs; scripts/paper-order-notifications.mjs; related fixtures.

Interfaces: add optional branded custody session to existing function options, never a JSON callback declaring persistence PASS. Existing local callers remain unchanged; explicitly supplied invalid/missing GitHub bindings reject. A custody session is storage capability, NOT order authority. Re-export static custody validation from operational module without weakening old invocation schemas.

- [x] RED: real reserveScopedExits fails before returning when remote persistence fails; no fake receipt accepted.
- [x] Bind after backup, each successful paired commit, wire file, observation claim and notification reservation/result. Verify same directory/attempt/account; publish before subsequent external effects.
- [x] Existing beforeSubmit rechecks authority/freshness after the extra wire barrier. Add new module to reviewed-code manifest.
- [x] RED/GREEN: forged/poisoned custody rejection, restored companions, observer consumed-claim rejection and no notification send when persistence fails.
- [x] Existing local source/clock/operational schema tests stay unchanged and passing. No new full operational caller or actual host attestation.

## Task 3: Regression, review and source integration

Files: package.json test entry; .github/workflows/ci.yml network-denied fixture step only; spec/migration notes. The existing IEX reviewed-code inventory includes the two new transitive dependencies.

Review fixes: keep transport response timing distinct from awaited custody and keep the controller deadlines unchanged; reject authorization/cookie fields inside valid pinned inputs. Regression fixtures cover both.

- [x] Add npm run ops:test:github-paper-custody; wire CI only, no runtime workflow modifications.
- [x] Run build/typecheck; custody and scoped suites; storage/order-state/protection/exit/P&L/notification/public-boundary/dispatch/symbol-agnostic suites; npm audit --audit-level=high; git diff --check.
- [x] Independent whole-diff review. Fix real findings with RED/GREEN evidence; never treat interrupted review as complete.
- [ ] Commit, non-force push, PR, actual CI PASS. Merge only after review/checks pass; preserve user checkout and unrelated branches.
- [ ] Record exact main/CI, safe tests and remaining runtime/source blockers. No production readiness claim.

## Deployment exclusions

The approved design's live repository protections, key setup, exact seed source,
writer quiescence, migration, current-cutoff financial evidence, actual GitHub
custody round trip and any broker execution are NOT performed by this plan.
They are named requirements, not stubbed implementations returning PASS.
