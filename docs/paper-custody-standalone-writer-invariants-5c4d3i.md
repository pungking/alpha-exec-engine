# STEP 5C-4D-3I — standalone custody-writer invariants and non-authority evidence hardening

Starting `main`: `d49823217587fa3d66434a534d132a699de409f6` (PR #70 merged, main push CI #43016637858 SUCCESS).

**Scope: source-only, offline tests, NO broker/PAPER/LIVE authority.**

## Corrected invariant in 3F

Previously, `scripts/lib/paper-deployment-writer-exclusion.mjs` required a caller-supplied `custodyWriterCount=1` but could still return a synthetic HOLD shape when the designated custody writer row was absent, or when two differently named custody writers existed.

Now the standalone inspector independently derives the count from explicit writer rows, requiring **exactly one** `legacy=false`, `disposition=MIGRATED_TO_CUSTODY`, `custodyEnforced=true` entry and `custodyWriterCount===1`. Missing, duplicated or contradicted custody designation yields `DENY_DEPLOYMENT_OR_WRITER_EVIDENCE` with `CUSTODY_WRITER_CARDINALITY_INVALID`. The 3H composite's duplicate count check remains as defense in depth.

Strict field allowlists for the writer inventory, individual writer rows, job deployment attestation and durable CLAIM placeholder reject undeclared positive authority assertions such as `authorized`, `independentlyVerified` or extra active/approved fields. Writer booleans must be actual booleans; legacy writers cannot be marked as custody-enforced. No untrusted evidence can assert verified approval or runtime custody through these objects.

## Trust boundary

This proves **only structural consistency of provided offline evidence**. A `complete:true` inventory or SHA256-shaped evidence digest does not prove that all broker credentials, older clients, other repositories and humans are excluded. A single declared writer can still be a fiction. Similarly, GitHub REST deployment metadata alone is not authenticated job-specific approval, and a local/in-memory lease is not broker-account-wide fencing.

All valid synthetic inputs return `HOLD_UNATTESTED_DEPLOYMENT_AND_WRITER_BOUNDARY`. All invalid inputs return `DENY_DEPLOYMENT_OR_WRITER_EVIDENCE`. `operationalEligible=false`, `brokerSubmitAuthorized=false`, `stateMutationAuthorized=false`, and the composite `liveTradingAuthorized=false` are unchanged.

## CI and rollout

- Expanded `scripts/test-paper-deployment-writer-exclusion.mjs` with phantom, duplicate, spurious numeric/typed count, contradictory legacy role and spoofed attestation fields. Existing 3H cross-component and 3G source-coverage tests continue to run through the custody CI suite.
- Re-pin changed source and test SHA256 digests within the reviewed offline admission baseline and update its anchored checksum. Existing 17 workflows, 21 jobs, 10 open blockers and `reviewBy: 2026-12-11T00:00:00Z` remain unchanged.
- No changes to operational workflow YAML, environments, GitHub rulesets, secrets, keys, paper-state branch, ledger/cache stores, or broker.
- Require Draft PR CI, another code review, explicit new source merge approval, and fresh main push CI before proceeding.
