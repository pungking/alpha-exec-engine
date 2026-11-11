# STEP 5C-4D-3L — canonical UTC dates and untrusted snapshot-content commitments

Starting `main`: `2b86fad8f2ee8dae4c7cfed40c5330ac97563f2b` (PR #73 merged, new `main` push CI #43022451325 SUCCESS).

**SOURCE ONLY / OFFLINE CI / ALL PAPER & LIVE EXECUTION HOLD.**

## Fix: reject invalid calendar dates
The 3K timeline inspector previously checked UTC-looking strings with `Date.parse()`. Some JavaScript engines normalize impossible calendar dates (e.g., February 30). Now parsing must round-trip to the same UTC calendar instant using `toISOString()` (with canonical millisecond padding for 1–3 fractional digits); invalid day, leap date, 24:00 or ambiguous timezone offsets DENY. Valid leap days are accepted. Missing timestamps remain explicit proof gaps, never fabricated.

## New: deterministic, content-addressed **untrusted** evidence commitment
`scripts/lib/paper-evidence-snapshot-commitment.mjs` creates a SHA-256 fingerprint from a deliberately bounded, allowlisted subset of non-secret GitHub Run / Job / Deployment / Status / Approval fields, including identifiers, SHA and timestamps. It **does not** serialize arbitrary REST responses or credentials. A fully caller-supplied `paper-github-evidence-commitment-v1` receipt may reference that digest only if it declares `CALLER_SUPPLIED_UNVERIFIED`, `signer=NONE`, and `approvalClaim=NONE`. Any extra authority field, missing SHA binding, changed timestamp, changed reviewer, changed status, or mismatching snapshot hash DENY. It composes the existing 3K chronology/capture-receipt inspector; a malformed chronology prevents HOLD.

**This is corruption/change detection within a self-declared evidence bundle, not provenance authentication.** Anyone able to alter a snapshot can calculate a new hash and fabricate a matching receipt. The fixture explicitly demonstrates this case returns HOLD, never READY. This fingerprint does not rule out replay of an old valid bundle, external broker API writers, bypassed protected environments, or a forged GitHub source. Unknown response fields are excluded from the digest and must not be interpreted as covered data. No signed attestation or external key management is installed.

## Safety invariants
- Matching synthetic receipt -> `HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT`.
- Mismatch, forged verified state, or incompatible 3J/3K input -> `DENY_SNAPSHOT_COMMITMENT_INVALID`.
- GitHub source authenticated, signed receipt verified, replay protection, account Writer exclusivity, job-specific deployment permission, broker submit, PAPER state writes, LIVE trading: **always false**.
- No GitHub REST read, credential retrieval, environment policy change, workflow dispatch, broker order, cache/ledger write, or paper-state provisioning occurs in CI.

## CI
- Extend existing `scripts/test-paper-deployment-provenance-gaps.mjs` with impossible/valid leap day cases.
- Add `scripts/test-paper-evidence-snapshot-commitment.mjs`: token-data omission, tampering, context swap, forged sender, recomputed attacker hash and untrusted HOLD behavior.
- Import new tests via existing custody CI and pin new SHA256 digests. The 17-workflow / 21-job / 10-open-blocker Admission baseline, operational HOLD and review deadline 2026-12-11 remain unchanged.

Require Draft PR CI and independent final diff review, then fresh explicit source merge approval and post-merge `main` CI. Future work must obtain independently trusted evidence source and broker-writer scope before even considering a separate operational-approval change.
