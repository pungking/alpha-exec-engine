# STEP 5C-4D-3D — Encrypted PAPER custody lineage verification, GET-only

Base: main 97e62aa0680755a96a32851b93ea09f98a93a04a, PR #65 merged and post-merge CI successful.
Status: SOURCE-ONLY, READ-ONLY, OPERATIONAL HOLD. No actual state branch, no credential provisioning, no broker operation.

## Why this exists

3C checked structural agreement between a caller-supplied CLAIM, reviewed workflow/run data and observed Git ref HEAD. A matching HEAD cannot prove the corresponding checkpoint ciphertext was authentic, properly decrypted or linked back to the reviewed genesis.

This update reuses the existing encrypted GitHub custody validation, without introducing another independent payload parser, encrypted state format or writer implementation.

## New inspection contract

A new export in scripts/lib/github-paper-custody.mjs:
inspectGithubCustodyLineageReadOnly({config, request, privateKey}).

This function:
- Validates the full fixed custody configuration and RSA private-key fingerprint before contacting the injected request.
- Enforces a strict GET-only route allowlist scoped to the configured GitHub Git endpoint: paper-state ref, commits, trees and blobs.
- Reuses the existing bounded history traversal, commit/tree/blob hash checks, AES-GCM decryption, payload/manifest and allowed-file checks, strict parent/sequence/envelope chain and monotone ledger checks.
- Performs a second ref-HEAD GET after verification to reject observed HEAD drift within the inspection window.
- Returns only a limited summary: commit, genesis, parent, encrypted-envelope digest, phase, sequence, account/scope hashes, attempt ID and writer-identity hashes; it never returns restored ledger/order/source bytes.
- Does not require or create an extraction directory, publish or release a custody CLAIM, write local files, dispatch a workflow, access default credentials or call a broker.

When the synthetic bytes validate, status remains HOLD_CRYPTOGRAPHIC_LINEAGE_NOT_OPERATIONAL_AUTHORITY; successful cryptographic lineage is evidence, not operational authorization.

All outputs keep:
- authenticatedEnvironmentVerified=false
- accountWideWriterExclusionVerified=false
- brokerSubmitAuthorized=false
- stateMutationAuthorized=false
- operationalEligible=false

## Limits and trust gap

- The inspected Git objects and private key come from injected caller-controlled inputs; this inspection alone does not prove the caller is a protected approved GitHub job or that the observed state has the real PAPER account's ownership.
- The encrypted envelope uses authenticated encryption (AES-GCM) for integrity after correct key use. It is not an independent signer attestation of who submitted a commit. Repository and key access control must be established separately.
- HEAD may move immediately after verification; this check cannot fence a later writer or broker-side mutation. For any eventual effect, a fresh durable exclusive claim and state recheck is still required.
- Inbound fake request implementations can impersonate GitHub; the production transport wrapper, secure key custody and protected runner bindings are mandatory future work.
- The current paper-state branch is absent and remains intentionally unprovisioned.
- Legacy analysis caches and other direct API writers remain outside account-wide single-writer fencing.
- Current source/risk/cashflow/trading-halt P0 proof and explicit action approvals are unresolved.
- The four manual PAPER mutation workflows still have hard HOLD; this PR modifies no workflow YAML.

## Offline negative tests

The new synthetic test uses the existing memoryGithub fixture, proving:
- SEED and real mock CLAIM/HANDOFF ancestry is readable with zero writes by inspector;
- key/ref/config mismatch, HEAD drift, insufficient history budget, malformed blob and extra commit parents are rejected;
- simulated HEAD change between initial and final GET is rejected;
- input shape, extra fields, invalid repository path and secret-like HTTP error messages fail closed.

Existing npm ops:test:github-paper-custody CI runner imports the new suite. Admission Baseline hashes must be independently reviewed for the modified custody engine, changed test importer and new test file, preserving:
17 workflows, 21 jobs, 10 blockers, operationalHold=true, zero eligible jobs, reviewBy 2026-12-11T00:00:00Z.
No baseline expiry extension or bypass.

## Next review gates

1. Independently verify protected Environment and exact job deployment review, plus key permissions; the GitHub approval history alone does not prove custody authorization.
2. Join 3C review/run/scope pins with 3D cryptographically verified read-only lineage under one bounded trusted runtime, without premature operational escalation.
3. Inventory and quarantine every legacy mutation writer before transitioning to a genuine account-wide single writer. Analyze effect ambiguity and reconciliation.
4. Separately approve protected genesis and dedicated key provisioning; branch absence must fail closed until approved.
5. Verify P0 current-account source/risk/cashflow/halt status and obtain a distinct human approval for any supervised PAPER order. LIVE remains separately controlled.

Rollback: source-only revert, not a state reset. Never revive stale caches, silently remove an active claim or cancel an unknown order.
