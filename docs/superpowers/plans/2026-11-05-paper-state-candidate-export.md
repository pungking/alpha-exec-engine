# PAPER State Candidate Export Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (approved Native implementation). Complete the checkbox tasks with offline fixtures and one independent whole-diff review.

**Goal:** Obtain a separately authorized, exactly pinned, encrypted PAPER state candidate without adopting it or rerunning the historical export.
**Architecture:** A new manual-only one-shot workflow and local CLI reuse existing private I/O and RSA-OAEP/AES-GCM helpers. Narrow file enumeration preserves raw bytes and existing scoped companions. Candidate capture is separate from authoritative adoption and current risk/source qualification.
**Tech Stack:** Existing Node.js 20+ built-ins and GitHub Actions; no new package.
**Spec:** Operator-approved CUTOVER_SCOPE_DRAFT.md, preserved outside the repository. The public contract below contains no private evidence.
**Approval:** 2026-11-05: offline implementation plan, implementation, fixtures, independent review, PR/CI and merge if passing. No runtime export, API acquisition, keys, state adoption or orders.

## Global constraints and public contract

- Preserve the old exact-cache exporter, its workflow, and all prior attempts unchanged.
- New workflow is workflow_dispatch-only, first dispatch/run_attempt=1 only, main only, read-only token permissions. No automatic trigger, broker secret, cache save, fallback, notification or execution activation.
- Fixed safe flags: PAPER, READ_ONLY=true, EXEC_ENABLED=false, LIVE_ORDER_SUBMIT_ENABLED=false, MARKET_GUARD_MODE=observe.
- Input scope bytes and SHA-256 pin repository, reviewed export commit, source run/attempt/head/workflow/event/conclusion, exact main cache ID/key/version and recipient fingerprint. No account/order/position identity in dispatch inputs.
- Existing source keys use sidecar-state-main-<sourceRunId>. Metadata must match exactly, including the source repository and completed first attempt. Failure/cancelled source runs may be reviewed if explicitly pinned, never called current or complete.
- Prepare a private exclusive attempt before metadata queries. A single bounded history page, source-run GET and cache list before/after restore are allowed by the future scope; no retry/pagination implemented. GitHub cache transport itself is distinct from these four metadata reads.
- Restore-only uses the original state path in a disposable runner to preserve cache version compatibility. Require cache-hit=true and exact matched key; compare cache ID/version/created time/size after restore. Cache metadata is not a cryptographic run-to-bytes attestation.
- Capture root order-ledger.json and order-idempotency.json; optional last-dry-exec-preview.json; existing inputs/*.json and .scoped-closeout-<attempt>/{original pair, wire-0..4.json, observation-<sha>.json, notifications.json}. No arbitrary recursive directory dump.
- Relevant unknown paths, links, active fences, temporary files, missing referenced original backups, oversize/invalid JSON or credential fields fail closed. Unrelated top-level reports are not exported. Partial candidate files are not published.
- Bounds: 8 MiB/file, 64 MiB aggregate raw bytes, 1,000 files, 128 MiB envelope. Preserve exact byte hashes; encryption nonce/ciphertext is intentionally nondeterministic.
- Candidate output always states currentStateAuthenticityVerified=false, sourceClosureVerified=false, stateAdopted=false, executionAuthorized=false, realizedPnlVerified=false. Capturing present companions does not prove external inputs absent from the cache or writer quiescence.
- Only ciphertext is uploaded. Local decrypt pins envelope/scope/run/commit/recipient and creates a new owner-only candidate directory after authentication and manifest validation. No existing directory or operational ledger is overwritten.
- New recipient must be prepared under later export approval. Do not reuse/upload old local-only keys. No keys are provisioned by this implementation.
- Existing current-cutoff external-capital and source-dependent caller restrictions remain. Export is not custody genesis, state repair, an invocation capability or a five-row execution approval.

## Review focus

1. Mutable cache metadata and prefix matches cannot silently substitute bytes; exact-before/after metadata and exact restore outputs must be checked (Task 1/3).
2. Candidate export cannot require unseen source-byte hashes in advance; compute them after capture while separately pinning provenance and avoiding adoption (Task 2).
3. Existing attempt companions and original backups must survive, but path traversal/links/secrets must not escape into output (Task 2).
4. Failure or rerun must not overwrite a prior attempt/output; safe errors must not include identifiers, paths or bodies (Tasks 1/2).
5. Export/decrypt success must not mint custody/source/risk/execution readiness or alter the old one-shot contract (all tasks).

## Task 1: Scope and preflight

Files: new scripts/paper-state-candidate-export.mjs; new scripts/test-paper-state-candidate-export.mjs.
Interfaces: validateCandidateScope(bytes, expectedSha); prepareCandidateAttempt(directory, env); preflightCandidateAttempt(directory, env).

- [ ] Write failing import/default-inert/scope/first-attempt/source-run/cache-pin fixtures.
- [ ] Observe the missing implementation assertion fail.
- [ ] Implement exact allowlisted scope, private exclusive attempt, metadata checks and pinned receipt with existing helper reuse.
- [ ] Test missing approval/unsafe flags/wrong source/head/event/version/fallback/truncated or duplicate history and pre-existing attempt rejection.

## Task 2: Private capture and local decrypt

Interfaces: encryptCandidateSource(sourceDirectory, attemptDirectory, env); decryptCandidateSource(input, keyFile, outputDirectory, envelopeSha, scopeFile, scopeSha, exportRunId).

- [ ] Write byte-parity/companion round-trip tests; invalid path/link/fence/secret/missing-backup/tamper/output-exists rejection; default no-I/O and redacted failure fixtures.
- [ ] Implement narrow inventory, repeated inventory/hash check, encryption and authenticated new-directory extraction. Existing crypto/private I/O helpers stay unchanged.
- [ ] Verify deterministic manifest and original bytes, randomized ciphertext, no source write and no readiness promotion.

## Task 3: Workflow and integration

Files: new .github/workflows/paper-state-candidate-export.yml; package.json test entry; .github/workflows/ci.yml offline test step; this plan.

- [ ] Wire prepare -> four pinned metadata reads -> exact restore-only -> post-restore metadata validation -> encrypt -> ciphertext-only upload.
- [ ] Test workflow trigger/permission/cache/no-secret/output boundaries with fixtures. No workflow execution.
- [ ] Run new test, old export, runtime private binding, GitHub custody, scoped storage/adapter/operational/IEX/attended, public evidence, notifications, state consistency, dry-run safety, symbol guard, typecheck/build, npm audit --audit-level=high and git diff --check.
- [ ] Independent whole-diff review; fix demonstrated defects and re-test.
- [ ] Commit/non-force push/PR/CI; merge only on passing checks. Record main and post-merge CI. No parent/runtime completion claim.

## Sources and limits

- https://github.com/actions/cache/blob/main/restore/README.md : restore-only behavior, exact-hit outputs, no prefix fallback configured.
- https://docs.github.com/en/rest/actions/cache : list API key filter may be a prefix; exact client comparison is necessary.
- Runtime request/restore/upload behavior is not established by static workflow assertions.
- Rollback is reverting this source change; it does not cancel orders, alter caches or undo a future state adoption.
