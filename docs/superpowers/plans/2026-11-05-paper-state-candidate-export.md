# PAPER State Candidate Export Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (approved Native implementation). STEP 3C uses one main agent only; independent GitHub review is reserved for ChatGPT after delivery, not a new agent.

**Goal:** Obtain a separately authorized, exactly pinned, encrypted PAPER state candidate without adopting it or rerunning the historical export.
**Architecture:** A new manual-only one-shot workflow and local CLI reuse existing private I/O and RSA-OAEP/AES-GCM helpers. Narrow file enumeration preserves raw bytes and existing scoped companions. Candidate capture is separate from authoritative adoption and current risk/source qualification.
**Tech Stack:** Existing Node.js 20+ built-ins and GitHub Actions; no new package.
**Spec:** Operator-approved CUTOVER_SCOPE_DRAFT.md, preserved outside the repository. The public contract below contains no private evidence.
**Approval:** 2026-11-05: offline implementation plan, implementation, fixtures, independent review, PR/CI and merge if passing. No runtime export, API acquisition, keys, state adoption or orders.

**Current scope override, 2026-11-10:** STEP 3C only, based on verified STEP 3B
commit 6d15aa29a6558edfdbfe58880e683df483ce521a. Preserve Tasks 1/2; implement
CLI/workflow/CI wiring and offline fixtures. One main agent, no new subagents or
independent review agents. Ordinary commit/push and Draft PR/actual CI validation
are authorized; main merge is not. No runtime export, actual cache restore,
operational keys, broker/provider calls, state adoption or orders. GitHub source
control/CI and npm security audit access are development checks, not export
authorization. ChatGPT's independent commit audit and user approval remain pending.
The parent goal remains incomplete.

## Mandatory resume rule for development instructions

Before resuming after interruption, inspect branch, HEAD, upstream, remote head,
porcelain status, post-baseline commits/diff and existing tests/results. Check for
concurrent conflicting work, preserve committed and uncommitted changes, and
continue only unfinished work. Never reset/clean/force-checkout/force-push or
silently overwrite changes. A failed/interrupted review is not a completed review.
Reconfirm the approved step and retain parent-goal incompleteness.

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

- [x] Write failing import/default-inert/scope/first-attempt/source-run/cache-pin fixtures.
- [x] Observe the missing implementation assertion fail.
- [x] Implement exact allowlisted scope, private exclusive attempt, metadata checks and pinned receipt with existing helper reuse.
- [x] Test missing approval/unsafe flags/wrong source/head/event/version/fallback/truncated or duplicate history and pre-existing attempt rejection.

STEP 3A command: `node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-paper-state-candidate-export.mjs --step3a`.
At the STEP 3A checkpoint the full test failed at STEP_3B_NOT_IMPLEMENTED.
After STEP 3B it must stop at STEP_3C_NOT_IMPLEMENTED; workflow/CLI assertions
remain unexercised until that separate implementation.
No encryption/decryption stubs or executable CLI were added in STEP 3A.
The dedicated mode uses a fixed synthetic public ASN.1 fixture, not a key pair.
Preflight consumes an exclusive private claim before reading metadata; a failed
attempt cannot be retried by replacing the failed metadata.
Receipts bind the exact scope bytes, run, raw metadata hashes and selected cache.
These local declarations are not independently authenticated GitHub responses,
permission evidence, source-byte integrity proof, a cache restore or state authority.

STEP 3A verification, 2026-11-10: dedicated suite 112 cases PASS; full suite
fails at STEP_3B_NOT_IMPLEMENTED as intended. Syntax, typecheck, build,
symbol-agnostic guard, dry-run dispatch safety and diff checks PASS.
Independent review found the child test process lacked the offline preload;
a no-request RED/GREEN probe and explicit preload on every test child resolve it.
Targeted independent re-review reports no remaining STEP 3A blockers.
No generated key pair, broker/API call, workflow execution, actual export,
operational state change or main merge was performed.

## Task 2: Private capture and local decrypt

Interfaces: encryptCandidateSource(sourceDirectory, attemptDirectory, env); decryptCandidateSource(input, keyFile, outputDirectory, envelopeSha, scopeFile, scopeSha, exportRunId).

- [x] Write byte-parity/companion round-trip tests; invalid path/link/fence/secret/missing-backup/tamper/output-exists rejection; default no-I/O and redacted failure fixtures.
- [x] Implement narrow inventory, repeated inventory/hash check, encryption and authenticated new-directory extraction. Existing crypto/private I/O helpers stay unchanged.
- [x] Verify deterministic manifest and original bytes, randomized ciphertext, no source write and no readiness promotion.

STEP 3B design rulings:
- Preserve the old crypto implementation unchanged; reuse encryptPayload,
  decryptPayload, recipient and private I/O helpers. No default CLI action.
- Scope/preflight raw-byte receipts and exact before/after cache identity, version,
  creation time and compressed size are revalidated before and after capture.
  Compressed cache size is not misrepresented as a sum of uncompressed files.
- Inventory only the documented pair/optional preview/inputs/scoped companions;
  reject unknown directories, links, writable-by-others source paths, relevant
  unknown files, locks/temporaries and credentials. Unrelated root JSON reports
  are excluded. Bound traversal to 1,100 entries as well as 1,000 captured files.
- Bound source reads to the stat size; compare descriptor/path identity, metadata,
  inventory and hashes again after encryption. This detects observed drift but
  is not writer-quiescence or authentic-run-to-cache evidence.
- Scoped directories require both original backups, including empty directories.
  Existing ledger/idempotency attemptId/preWriteHashes references must match bytes.
  Candidate capture does not certify ledger semantics or absent external inputs.
- Canonical manifest hashes cover sorted names, original byte sizes and SHA-256;
  envelope hashes vary intentionally with fresh encryption randomness.
- Encryption claims are exclusive and consumed on capture failure. Reject source
  alias/overlap before any attempt write to avoid mutating the source itself.
- A fresh owner-only decrypt-attempt directory is claimed before authentication;
  failures retain it and cannot retry there. The nested candidate directory is
  published only after authentication, allowlist, hashes, backup, secret and
  extraction checks. Incomplete output is never promoted or overwritten.
- Local owner-controlled files are the trust boundary; these checks do not attest
  GitHub token permissions, operational custody, authoritative current state,
  full source closure, execution readiness or realized P&L.

STEP 3B verification, 2026-11-10:
- `node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-paper-state-candidate-export.mjs --step3a`: 112 PASS; no test key pair generated.
- Same command with `--step3b`: STEP 3A 112 PASS plus STEP 3B 205 PASS,
  temporary synthetic RSA keys/data only. Both suites rerun after interruption.
- Full command without a phase flag: both phases pass, then exit 1 at
  STEP_3C_NOT_IMPLEMENTED (workflow and CLI integration), intentionally incomplete.
- Old exact-cache export 46, runtime private binding 81, GitHub custody 56 checks
  PASS under the existing offline preload. Typecheck, build, dispatch safety,
  symbol-agnostic, syntax and diff checks PASS. No default npm test script exists.
- RED/GREEN observed for absent functions, empty scoped backup directories,
  source/attempt alias mutation and strict large-file parsing. The shared JSON
  scanner is iterative to avoid regular-expression stack exhaustion at the
  existing 8 MiB limit; STEP 3A duplicate-key rejection remains covered.
- Existing source files, old crypto/exporter/workflows, package/lock, src/state
  and main are unchanged. No actual broker/API/export/cache/key operation.
- Resume confirmed local/remote baseline d4d6de2, clean upstream relation and the
  same three pending files. Their existing implementation was preserved, not
  rewritten. The original review failed due to usage limit and is not counted
  as completed. Replacement review found two P2 defects: token-suffixed credential fields were
  not rejected and valid scoped attempt names containing "lock" were mistaken
  for fences. RED/GREEN tests now cover capture and authenticated decrypt token
  rejection, plus valid block/clock/lock attempt directories. Both defects are
  corrected. An unchanged-snapshot re-review is required before commit/push;
  its outcome is retained in owner-only evidence and the completion report.
- No GitHub CI or STEP 3C integration claim; parent goal remains incomplete.

## Task 3: Workflow and integration

Files: new .github/workflows/paper-state-candidate-export.yml; package.json test entry; .github/workflows/ci.yml offline test step; this plan.

- [x] Wire prepare -> three pinned metadata reads -> preflight -> exact restore-only -> fourth metadata read/validation -> encrypt -> ciphertext-only upload.
- [x] Test workflow trigger/permission/cache/no-secret/output boundaries with fixtures. No export workflow execution.
- [x] Run new test, old export, runtime private binding, GitHub custody, scoped storage/adapter/operational/IEX/attended, public evidence, notifications, state consistency, dry-run safety, symbol guard, typecheck/build, npm audit --audit-level=high and git diff --check.
- [x] Main-agent whole-diff review; fix demonstrated defects and re-test. Independent ChatGPT audit is a separate post-delivery gate.
- [ ] Commit/non-force push/Draft PR/actual CI. No merge or post-merge runtime in this step; no parent/runtime completion claim.

STEP 3C resume and implementation rulings, 2026-11-10:
- Resume found the approved branch at 6d15aa2, matching its remote, with four
  modified tracked files and the new workflow untracked. No Draft PR existed.
  All pending changes were preserved. The previous full test passed 112/205
  cases before its shell-command scanner falsely rejected source-run.json.
  Restrict the scanner to command-token boundaries; keep source/eval injection
  regression mutations. No STEP 3A/3B implementation was rewritten.
- New workflow is serialized as JSON, a YAML subset. This allows complete
  structural parsing and unsafe-workflow mutation fixtures without a dependency.
  Platform execution behavior still requires separately authorized runtime proof.
- Read dispatch inputs from GITHUB_EVENT_PATH inside the CLI, never interpolate
  unvalidated values into run scripts or step env (which Actions prints). Use
  generic safe error codes; keep metadata bodies and command stderr in private
  temporary files. Default CLI returns NOT_RUN without performing work.
- Exact main SHA is compared to the approved scope before metadata acquisition;
  immutable action SHAs, sparse checkout without persisted credentials and only
  contents/actions read permissions keep this workflow separate from trading.
- Four explicit bounded gh metadata calls have no workflow retry or pagination.
  Restore-only action transport is separate and may internally retry downloads;
  this is not another authorized export attempt or a four-total-network-requests
  guarantee. No action/cache save or prefix fallback is configured.
- Synthetic gh/timeout executables exercise the actual workflow shell blocks:
  wrong approval/environment/history/cache, failed reads, exact restore misses
  and duplicate attempts stop before ciphertext publication. This is not a real
  cache restore, a test of the remote cache service, or source-byte attestation.
- The first-dispatch history gate intentionally blocks after any prior attempt,
  including failure. Further runtime attempts would need a separately reviewed
  authorization/contract decision, not deletion of history or workflow rerun.
- Old exporter/crypto/workflows, production src/state and dependency lock remain
  unchanged. No new subagents; prior STEP 3B review findings remain preserved.
  No interrupted review is counted as a new independent STEP 3C review.

STEP 3C local verification, 2026-11-10:
- `npm run ops:test:paper-state-candidate-export`: 388 PASS (STEP 3A 112,
  STEP 3B 205, STEP 3C 71), zero failures. The offline preload applies to the
  parent and synthetic child processes. Actual workflow runs/exports: zero.
- Old export 46, private binding 81 and custody 56 checks PASS. Scoped closeout,
  adapter, operational, attended lifecycle, IEX, public evidence, notifications,
  order-state consistency, dispatch safety and both symbol/Telegram safety guards
  PASS. The 19-command regression batch also includes syntax, typecheck, build
  and diff checks; all exit 0. All broker/sender behavior is fixture-only.
- `npm audit --audit-level=high`: exit 0, zero reported vulnerabilities. No
  dependency or lockfile changes. Workflow JSON and all embedded bash bodies
  parse successfully; exact structure and malicious variants are fixture-tested.
- Main-agent review traced dispatch inputs through scope validation, private
  metadata/preflight, exact restore outputs, unchanged encryption, and the
  ciphertext-only success upload. No remaining demonstrated STEP 3C defect;
  this is self-review, not the requested later independent ChatGPT audit.
- Draft PR and actual GitHub CI are still pending at this implementation
  checkpoint and must not be inferred from local PASS results.

## Sources and limits

- https://github.com/actions/cache/blob/main/restore/README.md : restore-only behavior, exact-hit outputs, no prefix fallback configured.
- https://docs.github.com/en/rest/actions/cache : list API key filter may be a prefix; exact client comparison is necessary.
- Runtime request/restore/upload behavior is not established by static workflow assertions.
- Rollback is reverting this source change; it does not cancel orders, alter caches or undo a future state adoption.
