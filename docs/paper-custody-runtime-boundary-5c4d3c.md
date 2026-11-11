# STEP 5C-4D-3C — Approval Job + account scope + encrypted custody writer-claim boundary

Status: SOURCE-ONLY / READ-ONLY / OPERATIONAL HOLD.
Reviewed starting main: ce0ead04dc1c351ab4063d078c1d36f99a1dda50 (PR #64 merged; push CI succeeded).

## Why this layer exists

- 3A supplied a constrained GitHub REST boundary for encrypted checkpoint Git objects.
- 3B supplied read-only GitHub Workflow Run and required-review history inspection.
- The existing encrypted GitHub custody engine can restore and publish a persistent
  CLAIM/checkpoint/HANDOFF in an explicitly injected synthetic store.
- These pieces were NOT bound to the same runtime identity, PAPER management
  scope, reviewed code pin and claimed remote ref HEAD.

This PR adds a non-authorizing source-only runtime-boundary diagnostic and
optional read-only GET composition. It introduces no operational entrypoint,
external effect, secret acquisition, job, trigger, package command or branch.

## Contract

paperCustodyAccountScopeFingerprint computes SHA-256 over the exact JSON tuple:
["paper-custody-account-scope-v1", accountSha256, scopeSha256, attemptId].

inspectPaperCustodyRuntimeBoundary verifies structural consistency of:
- fixed pungking/alpha-exec-engine repository and refs/heads/paper-state;
- exactly allowlisted manual workflow path and run ID, attempt=1, and externally
  pinned Git source SHA checked by the 3B GitHub review checker;
- custody config repository, runId, runAttempt, workflow, codeSha256,
  accountSha256, scopeSha256 and attemptId;
- account/scope fingerprint, reviewed code manifest SHA-256,
  genesis SHA and expected predecessor commit;
- CLAIM-shaped writer observation bound to run+workflow+code+account+scope,
  with a nonempty, changed commit and claimed envelope hash;
- ref HEAD observation whose SHA equals claimed checkpoint commit;
- 3B review diagnostic in an unambiguously non-authorizing HOLD state.

inspectPaperCustodyReadOnlyPreflight performs:
1. Local strict structural screening without HTTP.
2. Official GitHub Run and required-review-history GETs through the 3B module.
3. Only if review history matches, a single GitHub Git-Ref HEAD GET through the
   existing constrained 3A REST adapter.
4. Composition through the offline binding checker.

Every result is DENY or HOLD. Successful shape matching returns
HOLD_BOUNDARY_UNTRUSTED_NOT_AUTHORIZED. Every capability field
operationalEligible, brokerSubmitAuthorized, stateMutationAuthorized,
durableWriterVerified remains false.

## Important limitations

The writer observation is caller supplied and NOT cryptographic evidence.
The 3C GET checks only the remote ref SHA; it does not decrypt ciphertext,
verify the commit/tree/blob/envelope lineage, or prove that the CLAIM was
written by the reviewed job. The account/scope digest proves internal
consistency only, not PAPER broker account ownership or broker permissions.
The live GitHub Environment protection and job-specific deployment approval
are not verified here. Existing operational workflows remain hard HOLD.
External broker UI and legacy cache writers are not excluded.

## CI / safety

Offline fixtures cover wrong identity/branch/run/SHA/account/scope, stale claim,
wrong predecessor, denied/duplicate/missing approval, wrong code pin,
ref failures and zero HTTP calls for malformed local inputs.
No actual GitHub ref, state, branch, key or broker request is modified.

Existing ops:test:github-paper-custody imports the new test suite.
Closed Admission Baseline must pin two new files and changed test importer
(94 to 96 evidence paths), preserve 17 workflows / 21 jobs, ten blockers,
operationalHold=true, zero eligible jobs and reviewBy 2026-12-11T00:00:00Z.
ci.yml and existing hard-HOLD operational workflows are unchanged.

## Next, separately reviewed and approved

1. Independently verify current GitHub Environment protection, exact job
   deployment review, and source SHA; detect pinned environment ID drift.
2. Read-only cryptographic check of live ciphertext/commit lineage.
3. True account-wide writer fencing, legacy cache-writer cutover and
   ambiguous broker effect reconciliation before any remote write.
4. Dedicated key, approved genesis/branch initial state via independent
   operator approval — never through a code merge.
5. Independently verify P0 source/risk/cashflow/halt history and obtain
   distinct human approval for supervised PAPER. LIVE is later and separate.

Rollback: source PR revert only. No state reset, branch creation, old-cache
adoption or order cancellation.
