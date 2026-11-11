# STEP 5C-4D-3H — Composite protected-CLAIM, deployment and writer coverage diagnostics

Starting `main`: `fb36adb22d8ec12dae318d71d2a659d959f63189`, PR #69 merged, push CI #43014119792 SUCCESS.

**Source-only / offline simulation / PAPER & LIVE HOLD.** Nothing is dispatched or deployed. The existing operational YAML, GitHub environments, approval actors, tokens, secrets, account custody state and broker are untouched.

## Integration boundary
- `scripts/lib/paper-custody-composite-evidence.mjs` calls the existing 3E protected CLAIM / required-review / environment identity **synthetic inspector**, 3F deployment and account-writer inventory inspector, and 3G source-pinned mutation writer inventory inspector.
- It binds the observed code SHA, broker account fingerprint and scope fingerprint across 3E and 3F. It requires all three component reports to retain their explicit HOLD statuses and all referenced execution permissions as false.
- It rejects missing, mismatched, spoofed or inconsistent components with `DENY_COMPOSITE_EVIDENCE_INCOMPLETE`. Even fully matching synthetic evidence always returns `HOLD_COMPOSITE_EVIDENCE_NOT_OPERATIONAL_AUTHORITY`.
- `trustedEvidenceSources` is a **negative placeholder** only; it explicitly requires unavailable/unverified job deployment approval, environment policy, external account writer coverage and broker fencing. An asserted VERIFIED status is rejected, never promoted.
- `scripts/test-paper-custody-composite-evidence.mjs` constructs isolated synthetic encrypted CLAIM lineage and exercises negative cases for SHA/account/scope mismatch, altered job/deployment, environment bypass, altered ledger lineage, removed/claimed-safe legacy writers and forged externally verified evidence.

## Trust limitations
Matching source SHA, a GitHub deployment/status REST shape, and cryptographically checked synthetic CLAIM are not authenticated job-specific approval. Review or environment configuration must be obtained from a trusted GitHub API origin and bound to an actual job-specific deployment/attempt with separately proven approval provenance and timestamp. Calling these pure functions with untrusted data cannot establish that authority.

A source inventory of six known mutation jobs does not prove the full account's authorized/external writer set. A broker-side account lock cannot be asserted merely from GitHub concurrency or source-level checks; credential revocation, complete external client discovery, actual broker account identity, and enforcement at all mutation edges require independent proof. This module does not implement, install, renew or revoke a lease, fencing token, or signed attestation.

## Invariants
All three component diagnostics and the composite always set `operationalEligible=false`, `stateMutationAuthorized=false`, `brokerSubmitAuthorized=false`, and composite additionally `liveTradingAuthorized=false`. No path returns READY. Existing workflow admission baseline stays at 17 workflows / 21 jobs / 10 open blockers, with expiry `2026-12-11T00:00:00Z`.

## Test & review gate
New test imported by `scripts/test-github-paper-custody.mjs`, admission evidence hashes pinned and digest guard updated. Require Draft PR CI pass, independent diff review, explicit user merge approval and new main push CI before any follow-up. Do not run any PAPER mutation workflow.
