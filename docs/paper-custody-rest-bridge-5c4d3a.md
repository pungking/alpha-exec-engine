# STEP 5C-4D-3A — GitHub PAPER encrypted custody REST / single-writer integration bridge

Review basis: `main` **25b277d40fd27bbefa93f44eb56f3ae930ef1a02** (PR #62 merged; main CI PASS).
This is a **source-only bridge**, not runtime deployment. Parent `PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1` remains HOLD.

## What is already implemented

The existing `scripts/lib/github-paper-custody.mjs` already has:
- strict encrypted, single-file checkpoint and verified genesis-to-head lineage;
- single-parent fast-forward update on `refs/heads/paper-state`, no force;
- persisted `CLAIM` before consumers, `HANDOFF` for explicit release;
- encrypted file manifest and exact source/ledger/idempotency/backup validation;
- finite request and history ceilings, timeout and fail-closed ambiguous ack;
- offline storage/notification/store-state integration tests.

`scripts/lib/scoped-closeout-storage.mjs` and `scripts/lib/scoped-paper-adapter.mjs` already support an opaque injected custody binding, awaited checkpoints before external submission, and after wire/observation. This source is not itself an approved operational caller.

## Gap addressed in this PR

A real GitHub REST request callback that can be passed to `openGithubCustody` was not present in the reviewed path. The new `scripts/lib/github-paper-custody-rest.mjs`:
- requires **explicit** repository, bearer token, and injected `fetchImpl`; no defaults, environment reads, secret acquisition or workflow invocation;
- fixes the host to `https://api.github.com` and scopes all routes to one repository's Git API;
- allows exact-ref GET, immutable commit/tree/blob GET, and only the reviewed blob/tree/commit creation and **non-force PAPER ref** PATCH; rejects deletion, force updates, main/other branch routes and arbitrary issue/secret endpoints;
- bounds HTTP payload/response size and sanitizes errors without propagating token, API responses or ledger bytes;
- is never imported or invoked by production workflows and never creates the state branch.

The existing `ops:test:github-paper-custody` test runner now imports a synthetic mock-HTTP bridge suite after its existing custody tests. This checks:
- one real `CLAIM` -> checkpoint -> `HANDOFF` -> next claim through the REST-shaped adapter, simulated in memory only;
- simultaneous writers reading the same parent: only one can claim; loser stops;
- active writer, stale revision, ambiguous post-update acknowledgment and orphaned claim;
- wrong-route and force/rewrite attempts rejected before any HTTP call;
- malformed/oversized HTTP responses and untrusted error content are rejected/redacted;
- no real broker or GitHub HTTP request.

The closed-world Admission Baseline will be updated by explicit human-reviewed digests for **three files**: this REST module, its tests, and the existing custody test importer. All 17 workflows/21 jobs, existing ten blockers, operational eligibility zero and 2026-12-11 expiry must be retained. Existing `ci.yml`, schedule, job admission, hard HOLD and npm commands are unchanged.

## Not implemented; still required before operational use

1. Independently authenticated exact GitHub Environment/reviewer, approved main SHA and actual runner identity; caller-supplied JSON is not authority.
2. Dedicated custody recipient key under reviewed protected Environment and operator-held recovery key; no credentials or ref created now.
3. True account-wide single-writer exclusion across *all* legacy jobs, external hosts and human broker actions. The stored CLAIM serializes only writers respecting this protocol and cannot fence broker UI.
4. Real current source/risk/cashflow/trading-status P0 closure and verified exact genesis/companion bytes.
5. An explicitly approved operational custody caller with key isolation, finite phase budgets and before-wire freshness recheck. The four legacy jobs still hard HOLD and must not be relabeled as authorized.
6. Explicit user approval for branch/key provisioning, controlled migration/cutover, production dispatch, and separate supervised PAPER action; LIVE execution is a different subsequent approval.

A passing CI is **not** evidence of running GitHub branch custody, an operational single writer, a valid approval, or broker safety.

Rollback: revert the source-only bridge/test/docs/baseline via an approved source PR. Do not touch runtime state, the pending claim, historical caches, or broker orders.
