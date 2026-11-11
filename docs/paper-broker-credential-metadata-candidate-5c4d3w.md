# STEP 5C-4D-3W — GitHub Secrets metadata & Alpaca PAPER account read-only proof candidate

**Base:** PR #84 merged into main as b00b2c5a2ed8997eb35825dee8f4a0004bb4f223, post-merge main push sidecar-ci #43051377182 SUCCESS.

**Mode: source-only, offline synthetic CI. PAPER submit, cancel, ledger mutations and LIVE trading remain HOLD.**

## Verified read-only external endpoint contracts

The official GitHub API documents that listing Actions Secrets returns **metadata only**, such as name and created/updated times; **never encrypted or plaintext secret values**. This requires a credential with Secrets(read) and access to the repository or relevant Environment. The currently connected GitHub generic fetch tool rejected the secret-metadata endpoints with a connector-level HTTP 400, so **no actual secret-name inventory was fetched in this implementation**.

| Allowed GET-only route | Expected metadata | Important limitation |
|---|---|---|
| https://api.github.com/repos/pungking/alpha-exec-engine/actions/secrets?per_page=100&page=1 | Repository Actions Secret **names only** | Does not establish org-inherited, account-level, job-injected or broker-side key privileges |
| https://api.github.com/repos/pungking/alpha-exec-engine/environments/PAPER_CUSTODY_APPROVAL/secrets?per_page=100&page=1 | Protected Environment Secret **names only** | Nine reviewed Alpaca-secret referencing Jobs are *not* bound to this Environment |
| https://paper-api.alpaca.markets/v2/account | PAPER-only Alpaca account identity/flags/status; raw fields never leave inspector | A successful GET does **not** mean the supplied API key is read-only; credentials may have order-write permission |

References:
- https://docs.github.com/en/rest/actions/secrets#list-repository-secrets
- https://docs.github.com/en/rest/actions/secrets#list-environment-secrets
- https://docs.alpaca.markets/us/reference/getaccount-1
- https://docs.alpaca.markets/us/docs/authentication

**Never use https://api.alpaca.markets (LIVE) in this workflow**. The implementation forms only the fixed PAPER hostname, never accepts a broker target URL, and cannot POST, PATCH or DELETE.

## New 3W code

scripts/lib/paper-broker-credential-metadata-candidate.mjs exports:
1. inspectPaperBrokerCredentialMetadataCandidate — pure, untrusted API-shaped inspector. Composes 3V source-only inventory validation, requires the reviewed 17-workflow/21-job/10-OPEN-blocker HOLD snapshot, validates bounded and deduplicated secret-name listings, detects unknown ALPACA-prefixed names, and requires basic PAPER account shape **without echoing account identifier, account number, balances, key material, account flags or raw provider payload**.
2. readPaperBrokerCredentialMetadataCandidate — optional, **injected-token and injected-fetch** GET-only adapter. It makes no request by itself. Exact two GitHub routes use the GitHub bearer only; exact PAPER account GET uses Alpaca key ID/secret headers only. It restricts response content type, streamed byte size (96 KiB each), Content-Length agreement, pagination-next, redirects, retries, and any non-200 result. A bad response returns a generic DENY status without exposing raw provider errors. It does not read environment variables or the actual repository Secrets.
3. Every status remains HOLD or DENY. If both expected names are listed in **caller-supplied repository** metadata, status is HOLD_UNATTESTED_REPOSITORY_SECRETS_AND_PAPER_ACCOUNT; if absent/partial, HOLD_REPOSITORY_SECRET_PAIR_ABSENT_OR_PARTIAL. Neither status proves the credentials exist in a particular executing Job, belong to the intended PAPER account or have a read-only broker privilege.

**Explicit limitations:** An injected fake transport can return forged account and Secrets data, and may ignore AbortSignal (no guaranteed wall-clock deadline). Repository and protected-Environment names do not prove organization secrets inheritance, credential expiration, external API grants, account activity or exhaustive key coverage. Account GET proves no inability to mutate orders; a key may have write rights even if this workflow sends only GET. No account identifier is durably bound to 9 Jobs or to a broker-side global Writer fence.

## External evidence still required — separate approval and isolated investigation

| Proof boundary | Evidence to acquire | Status |
|---|---|---|
| Authentic GitHub Secrets metadata | Independently authenticated GitHub read-only credential; repo/env secret **names**, organization inheritance and availability to each of 9 Jobs, with capture timestamp and provenance | NOT COLLECTED |
| Actual PAPER account identity | Owner-approved, independent read-only inspection of paper-only account with redacted identifiers, scope and capture evidence; ensure absolutely no LIVE host requests | NOT COLLECTED |
| Actual broker credential scope | Broker dashboard / permissions showing key grants, rotation and whether order submission is possible — do not infer read-only status from GET response | NOT COLLECTED |
| All potential broker Writers | Other API keys, users, applications, Mac/local scripts, legacy GitHub workflows, cloud jobs, third-party automations, manual UI and external clients | NOT EXHAUSTIVELY ENUMERATED |
| Enforced common Writer fence | Server-side lease/fencing checks for all mutation edges across independent clients including crash/recovery/foreign-client negatives | NOT VERIFIED |
| Human GitHub/source approval | A separate authorized human reviewer; current main Ruleset requires **0** approving reviews, so the policy is not yet enforced | NOT CONFIGURED |
| Operation-specific approval | Exact PAPER account/Run/Job/Deployment/SHA, limits, replay barrier and distinct human sign-off | NOT AUTHORIZED |

Do not paste GitHub tokens, Alpaca keys, account numbers or full account API responses into GitHub issues, CI logs, or chat. Any actual read-only collection requires a separately authorized operator and safe credential configuration. This PR does not connect existing credentials or issue a real broker request.

## Offline tests and Admission

scripts/test-paper-broker-credential-metadata-candidate.mjs uses synthetic secret names and mock PAPER account responses; tests malformed, duplicated/unknown names, raw secret-value reflection, nonmatching account shape, partial scope, forged approvals, HTTP 401/403, wrong content-type, oversized/mismatched Content-Length, pagination, aborted signals, and strict GET-only host/auth-header segregation. No network access, brokerage calls, orders, or state mutations.

Pin new source and test SHA-256 under the existing 17-workflow/21-job/10-open-blocker Admission inventory; keep operationalHold=true and reviewBy 2026-12-11T00:00:00Z. No operational YAML, GitHub Secret/Ruleset/Environment settings, paper-state or trading configuration is changed.

**Separate work:** legacy Gemini → Obsidian Knowledge Intake cleanup remains tracked in pungking/US_Alpha_Seeker Issue #57 and is untouched here.
