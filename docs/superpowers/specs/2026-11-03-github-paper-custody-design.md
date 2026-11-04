# GitHub PAPER Durable Custody Design

Date: 2026-11-03
Status: DESIGN_APPROVED_FOR_OFFLINE_IMPLEMENTATION; not operational authority or an approved migration.
Parent: PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1 (not complete).
Scope: alpha-exec-engine only. GitHub Actions remains the operating platform.

## 1. Decision and boundaries

Engineering recommendation: preserve the existing ledger/idempotency schemas and
their required companion files in one encrypted snapshot on an isolated GitHub
state branch. Publish a validated snapshot before any corresponding external
side effect. Restore by exact commit and verified lineage, never cache fallback.
This is a storage transport for existing state, not a new trading ledger, engine,
strategy, scheduler or market-data provider.

The user chose GitHub hosting and subsequently approved this design for offline
implementation, fixtures, independent review and source PR/CI only.
Implementing the inert transport/fixtures and deploying it are separate scopes.
The historical restriction against committing runtime state is not waived here:
future publication of ciphertext to this isolated branch needs explicit approval;
plaintext state must never enter code commits, PRs, logs, caches or artifacts.

No credentials, broker calls, operational state/cache restore, state-branch
creation, secret changes, runtime workflow execution, order activity or execution
activation are authorized. Source code, offline fixtures and CI changes are in scope.
READ_ONLY=true, EXEC_ENABLED=false, LIVE_ORDER_SUBMIT_ENABLED=false and observe
guard defaults remain unchanged. Existing exact execution approval gates remain.
PAPER is not LIVE. The five limited-control records are not new-entry authority.

## 2. Approaches considered

1. Existing cache plus final upload: lowest diff but rejected as the authoritative
   store. The workflow uses prefix restore and best-effort end-of-job save. Loss
   after broker submission but before save can leave a later runner with older
   state. An exact cache key alone does not make the preceding checkpoint durable.
2. Immutable encrypted artifacts plus a new latest-pointer/index: possible but
   not selected. It still needs conflict-safe indexing, expiry/missing-artifact
   handling and pre-wire acknowledgement. Final runtime export is not this index.
3. One encrypted state branch in the existing repository: recommended. Existing
   Git history supplies immutable prior versions and a single ref supplies the
   current committed checkpoint. It needs dedicated key custody, trusted-writer
   controls and crash semantics; it is not a transaction with the broker.

No new database, cloud account, always-on Mac, dependency or paid service is
proposed. Branch/key provisioning is not silently included in code integration.

## 3. Verified code baseline and actual gaps

Local main: 1773d025929c274da46034d4c5ff125d769f86c3.
Reviewed worktree HEAD: 150294eea2421db004b1e50777aea9df14976772.
Relevant files match local main; remote state was not refreshed in this task.
The repository has AGENTS.md but no goal/goal.yaml at this worktree root.
Exact source bytes were pinned in the original private design evidence directory;
that evidence is not copied into the repository.

- .github/workflows/dry-run.yml restores state by run key with a branch-prefix
  fallback; its final cache save is always/best-effort. It is not the future
  authoritative PAPER checkpoint store.
- Dry-run and market-guard use different concurrency groups. Neither is an
  account-wide exclusion mechanism against other workflows or manual trading.
- src/order-state-storage.ts provides local directory locking and validated
  atomic file replacement, not remote or two-file transactional persistence.
- scripts/lib/scoped-closeout-storage.mjs writes idempotency then ledger and
  verifies parity. A crash between them is possible locally. Never publish a
  half-written pair or call the current two local writes one atomic transaction.
- withScopedStores backs up both originals under .scoped-closeout-<attempt>.
  withScopedObservationStores requires those backups and creates a one-use
  observation-<authority-hash>.json claim. Restoring only two root files fails
  that contract and can lose consumption evidence.
- scoped-paper-adapter.mjs persists wire-<index>.json before the request. Its
  current verifyScopedStoreReceipt proves local hashes only.
- paper-order-notifications.mjs reserves delivery in notifications.json before
  send. A reservation that exists only on an ephemeral disk is not sufficient
  for cross-run deduplication.
- scoped-paper-operational.mjs validates REVIEWED_SINGLE_HOST_PAPER_CUSTODY and
  OPERATOR_ATTESTED_SINGLE_HOST. A GitHub run ID cannot be relabeled as this basis.
- paper-runtime-private-binding.mjs exports final seven-file evidence. It is not
  a reservation checkpoint and cannot prove pre-submit persistence.
- encryptPayload/decryptPayload in paper-exact-cache-private-export.mjs are
  reusable primitives. Their public envelope context is not private data.

## 4. Concrete storage and trust contract

### Repository and branch

Proposed ref: refs/heads/paper-state in the existing alpha-exec-engine repository.
It contains exactly one file, checkpoint.enc.json, and no code or workflows.
It is never merged into main or checked out/executed. Commit messages are generic
and contain no account, symbol, quantity, order, approval or portfolio details.
The genesis commit is a separate explicit provisioning/migration action, not an
automatic fallback when a branch/file is missing. No such action occurs now.

The deployment record pins repository identity, exact ref, genesis commit,
recipient fingerprint and approved workflow/code revision. Existing source
history is not normalized. A genesis must use separately verified current source
bytes and required companion originals; old incomplete captures cannot be made
authentic by encryption. No missing file is initialized as an empty ledger.

Normal publication always creates one child with the exact observed predecessor
as its only parent, then advances the exact ref with force=false. No merge,
rebase, force, fallback ref, rewind, delete or automatic history compaction.
An exact ref GET is used, not matching-ref enumeration. Sibling updates conflict;
this is an application protocol using fast-forward rules, NOT a GitHub
expected-old-SHA CAS API and NOT a broker fencing token.

Repository administration and approved workflow code are trusted. A hash chain
does not prove that an authorized writer supplied truthful trading evidence or
prevent a malicious administrator from rewriting refs. Deployment must prohibit
force/delete and restrict authorized writers; if that cannot be enforced, remain
blocked rather than claim tamper-proof custody. Branch protection and environment
entitlements have not been checked on the real repository in this design task.

### Encryption and key custody

Reuse RSA-OAEP-SHA256 plus AES-256-GCM with a fresh data key/nonce per envelope.
Require strict schema, algorithm, decoded lengths, recipient and context checks
around the existing crypto primitives. AEAD protects ciphertext/context integrity;
public-key encryption alone does not authenticate who produced a snapshot.
Trusted repository/writer admission and exact source/hash validation are required.

Use a NEW dedicated custody recipient. Its private key would be an environment
secret for the reviewed PAPER job, loaded only in process memory. The prior
local-only evidence-recipient private key stays local and is never repurposed.
No key is generated, read, uploaded or installed here. Key setup and a private
offline recovery copy require a separately approved operational procedure.

Restrict decryption access to a protected PAPER environment on reviewed main
code, not PR/fork/untrusted refs. GitHub Contents write is repository-scoped, not
magically branch-scoped: trusted workflow allowlisting/protections are required.
Do not add Workflows write, admin or broker privileges to the custody transport.
If current repository plan/protection capabilities cannot meet that setup, do
not silently broaden credentials. This is a deployment admission check, not a
reason to postpone pure offline implementation after design approval.

Lost key: stop; no empty-state recovery. Rotation: quiesce writers, decrypt and
validate a pinned checkpoint, explicitly authorize a new-recipient child and
keep the old key for old snapshots. Never rewrite or delete historical ciphertext.
Runner compromise or key disclosure may reveal all snapshots under that key.
Encryption is not permission to upload plaintext or secrets.

### Snapshot contents and exact extraction

Outer readable context: schemaVersion, recipient fingerprint, repository/ref,
sequence, predecessor commit, run/attempt, code hash and cipher algorithm only.
Account/scope/authority hashes belong INSIDE ciphertext, not public context.
Even unkeyed hashes of predictable identifiers can expose information.

Encrypted payload contains:
- Exact bytes and SHA-256 of order-ledger.json and order-idempotency.json.
- The existing scoped attempt's original ledger/idempotency backup bytes.
- Existing finalized wire-<index>.json, observation-<authority>.json claims, and
  notifications.json when created. Include all such files already in the active
  scope, not only the most recent claim. Never reset their consumption status.
- Exact immutable source/terms/authority inputs needed by the next consumer,
  identified by an explicit reviewed manifest; no recursive state-directory dump.
  These do not acquire freshness or authorize a new invocation on restore.
- Private provenance: account/environment/scope pins, current producer run/attempt,
  parent/envelope hashes, exact file manifest, writer claim and handoff status.

No broker credentials, private keys, tokens, .env, arbitrary raw responses or
unrelated portfolio artifacts. No disk lock/PID/temp file is restored. If a
local write is incomplete, do not snapshot around it; stop and keep the last
committed remote pair and its uncertainty, preserving local evidence if possible.

Strict allowlist paths only: reject absolute paths, '..', duplicate paths, symlinks,
hard links and manifest/byte mismatches. Extraction is into a new owner-only
RUNNER_TEMP/PAPER directory (0700/files0600), never overlay into an old directory.
Validate all files before invoking any existing store loader. File manifest and
schema must express missing optional vs required records explicitly. Missing
required backup/claim/source evidence blocks; do not synthesize or repair it.

Pin a bounded total envelope size using the existing private-envelope read limit
(64 MiB), and reject before upload if exceeded. Git history grows with mutations;
there is no per-quote snapshot, silent truncation or automatic retention deletion.
Reaching a bound blocks writes and requires a separate retention decision.
Ciphertext size/timing/commit frequency remain visible if the repository is public.

## 5. Writer and transition protocol

### Exclusion is both workflow-scoped and durable

All jobs allowed to mutate this PAPER account/state must share one repository
concurrency group independent of branch, run, or workflow (cancel-in-progress=false).
Use an opaque environment label, not account number. This does not serialize other
repos, broker UI users or other hosts. They must be excluded by the approved
operating scope; a detected manual/unscoped portfolio change requires revalidation.

A child checkpoint records a durable writer claim before the job can perform
side effects. It binds run/attempt/workflow/code/authority and cannot be reclaimed
just because a lease/clock elapsed. Normal release/handoff is another confirmed
child checkpoint. A crashed writer's claim requires a separate reconciliation
decision confirming the previous job has ended and cannot resume; no auto-takeover.
The current five-row submitter remains one-shot, not a resume-all-orders engine.

Branch continuity must reach the pinned genesis and include required predecessors.
Missing lineage, unexpected parent, merge commit, rollback, changed recipient,
wrong account, rerun or unsupported checkpoint version blocks. An implementation
must bound history traversal; hitting that bound blocks rather than accepting a
shortened proof. A later explicit trusted checkpoint pin can bound old history
without deleting history or resetting idempotency, but is not automatic.

### Commit then wire, not wire then upload

1. Validate exact restored input closure and local stores; acquire writer claim.
2. Existing reserveScopedExits writes the five records. Verify local paired parity
   and required backups; publish and confirm one encrypted reservation checkpoint.
3. Existing recordScopedAttempt writes ATTEMPTED. Before broker wire, preserve the
   existing wire hash record and publish the paired state/companions as a child.
   Confirm exact ref, commit parent, envelope hash and decrypted local equivalence.
4. Recheck current invocation authority, market/risk/evidence freshness, local
   hashes and active custody receipt after persistence latency. If any expired,
   stop WITHOUT submit. Do not extend 30-second evidence or approval deadlines.
5. Only that in-process one-shot invocation may send once. Rehydrating an ATTEMPTED
   snapshot never restores a capability to submit it. No blind retry on timeout.
6. Persist valid broker observations through recordScopedObservation and confirm
   the next remote checkpoint before advancing to another row, declaring terminal
   completion, or publishing a durable-completion notification.
7. Persist final handoff/release with remaining attempted/unknown orders. Release
   of a writer is not cancellation, flattening or proof of zero positions.

GitHub publication and broker submission cannot commit atomically. A crash after
the durable ATTEMPTED checkpoint but before/during wire is intentionally ambiguous.
It requires a separately authorized exact-identity observation, not a resend or a
claim that no order exists. Failure after wire blocks additional submissions even
if a later observation found a fill. Preserve the consumed authorization.

Within a publish: local serialization -> blob -> tree -> single-parent commit ->
force=false ref update -> exact ref/commit/blob verification. Every GitHub request
has a finite timeout and a per-invocation request ceiling distinct from broker
budgets. No automatic retry, rebase or self-dispatch. The implementation plan must
derive that ceiling from the approved finite phase count and bounded traversal,
not introduce an unbounded polling loop. Even a verified ambiguous ref update
stops the current submit invocation; verification is for recovery, not retry.
Unreferenced encrypted blobs/commits after a failed publication are not authority;
they are not automatically deleted or adopted.

### Observation and notification continuity

withScopedObservationStores must publish the one-use observation claim before
the first corresponding evidence GET. Restoring a consumed claim rejects reuse.
A new authorized observer may follow the last checkpoint, but it cannot submit
reserved/unknown rows or reuse expired source freshness.

The local notifications receipt alone is insufficient across runners. For this
custody mode only, persist delivery reservation before Telegram send and its
result afterward. Unknown send remains uncertain and is not automatically sent
again. Existing at-most-once-attempt behavior may miss a notification; do not claim
exactly-once delivery. Broker reconciliation takes precedence over notification.
Do not wait for notification networking inside the pre-submit risk time window.

## 6. Failure outcomes (required future fixtures, NOT executed tests)

| Scenario | Required outcome |
| --- | --- |
| Missing ref/key/genesis/source | No fallback/cache/empty initialization; BLOCKED |
| Wrong pair/companion hash/account/scope | No extraction consumption or broker call |
| Two writers read same predecessor | At most one sibling publish succeeds; loser stops |
| Local crash between the two store writes | Never publish partial pair; no next side effect |
| Publication response absent/ambiguous | Current invocation stops, even if later GET confirms commit |
| Crash after durable reservation | Reserved identities remain; no resubmit-on-restore |
| Crash after ATTEMPTED / wire / broker ack | Unknown attempt retained; observe only with new authority |
| Durable observation save fails | No next row, no terminal-success claim, no resend |
| Persistence exceeds freshness deadline | No order; deadline is not compensated/extended |
| Used observation claim / missing original backup | Reject reused approval or incomplete restore |
| Notification ack lost / snapshot save lost | Uncertain delivery; no blind resend |
| Cancelled job / abandoned claim | No timed takeover; preserved unresolved order obligations |
| Manual account change / other host writer | No silent adoption; revalidation required |
| Rerun, stale head, merge, key mismatch, tamper | Fail closed with redacted reason |
| Artifact/cache restore older than current branch | Rejected as authority; do not overwrite current state |
| State size/history request bound exceeded | Stop; no truncation/compaction/latest-pointer shortcut |
| Ordinary Stage6 entry passed to five-row lane | Reject; no general automation authorization |

## 7. Minimum implementation reach after design approval

Reuse the local lock/storage, crypto and scoped controller. Add one custody
transport module only if no existing module can hold it clearly; no general
storage adapter framework. Future filenames are proposals, not claimed exports.

| Existing code | Required limited change |
| --- | --- |
| scoped-paper-operational.mjs + fixtures | New versioned GitHub custody variant; keep v1 single-host exact semantics |
| scoped-closeout-storage.mjs + fixtures | Opaque custody binding and awaited checkpoint barrier; preserve existing record schemas and old local behavior |
| scoped-paper-adapter.mjs + fixtures | Confirm durable wire/attempt checkpoint; recheck authority/freshness after delay |
| scoped-paper-oversight.mjs + fixtures | Durable one-use observation claims and subsequent observation commits |
| paper-order-notifications.mjs + fixtures | Custody-mode durable send reservation/result; no resend on uncertainty |
| code manifest / dispatch safety / CI | Pin new code dependency; network-denied positive and crash fixtures |
| workflow/docs | Review account-wide writer exclusion and isolated state paths; activation not included in static PR |

Do not change src/order-state-storage.ts if the existing local atomic/lock helper
is sufficient. Do not make every local write remote for legacy consumers. A new
GitHub-configured mode must require the custody binding, with no optional callback
that accidentally falls back to local success. The existing state-machine receipt
has exact keys: retain it, keep remote custody evidence in a private opaque binding,
and do not add arbitrary receipt fields that the controller rejects.

Existing source-independent storage tests can be built after approval without
claiming the five-row current-risk input or full caller is ready. Do not implement
a production caller returning a fabricated READY result to bridge that gap.

## 8. Deployment admission, rollback and residual blockers

Before future activation, perform ONE reviewed cutover checklist:
- Establish a verified seed pair and companion originals. No cache restore or
  migration approval is implied; missing current authenticity remains missing.
- Verify repository protections, exact state ref, environment secrets, approved
  workflow/code pins and a recoverable dedicated key. Do not copy old local key.
- Quiesce all old-capable jobs and enumerate all writers. At minimum inspect
  dry-run.yml, market-guard.yml, paper-oco-submit-canary.yml,
  persistent-oco-repair-submit.yml, ledger-filled-migration.yml,
  paper-five-row-active-limited-state-recovery.yml and result-sync paths. A grep
  inventory is not proof deployed jobs/configs are quiescent. Either bind admitted
  writers to the protocol or explicitly exclude them; never leave a bypass.
- Prevent branch changes from triggering analysis/provider work: state ref contains
  no workflow files, no merge to main; separately verify all push triggers and the
  chosen token's event behavior before publishing. No such triggers are run here.
- Keep old caches/evidence preserved, but remove their authority for the new lane.
  Do not let old report/guard writes repopulate its canonical ledgers.
- Validate real fixture/CI outcomes, then obtain separately scoped deployment and
  execution authority. No existing one-shot approval is reusable.

Rollback means disable new writer admission and new submits, preserve latest
checkpoint and unresolved claims, and perform approved observation/reconciliation.
Never reset paper-state to an older commit, restore pre-trade cache over current
state, delete an attempt, or report cancellation because the workflow stopped.
Reverting code alone must not start old writers or erase a new-schema checkpoint.

The five-row parent still lacks complete external-capital evidence through the
current account observation. The user retained this requirement on 2026-10-28.
Custody design/implementation cannot satisfy or relax it. Existing source-qualified
halt/reconnect proof and the supervised-PAPER exception remain distinct. Ordinary
Stage6 entries have their own admission/performance/HF policy checks; this design
does not widen the five-row lane into automated entry/scale-in.

Thus: pure custody implementation can proceed after this design is accepted;
source-dependent five-row caller/runtime cannot. No date estimate can be justified
for those missing inputs. Do not wait for RTH to implement source-independent tests.

## 9. Completion criteria and current result

Design complete only when the storage choice, full restore closure, crypto/access
trust, transition/failure behavior, consumer reach and rollback are explicit and
one independent builder check has no unresolved design-blocking ambiguity.

Implementation complete is a different claim: actual failing-then-passing crash,
conflict, key, redaction, closure and deadline fixtures across real components;
regressions, independent code review, CI and merge. None are claimed by this doc.

Runtime complete is later: authorized real custody round trip and separately
authorized PAPER order lifecycle evidence, with applicable risk/source gates met.
This document does not complete the parent goal or certify returns/live readiness.

## 10. Official references and limits

- [GitHub cache reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching): cache keys can fall back by prefix and existing cache contents are immutable. This explains why best-effort final caching is not the proposed authoritative state protocol.
- [GitHub exact refs / updates](https://docs.github.com/en/rest/git/refs): exact-ref reads return 404 for absence; force=false requests fast-forward updates. It does not expose an expected-old-SHA parameter. Sibling conflict handling is our protocol inference, not a broker transaction guarantee.
- [Git commits](https://docs.github.com/en/rest/git/commits#create-a-commit): explicit parent/tree construction is the proposed immutable snapshot linkage. No such API was called.
- [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments): protection rules can gate environment secrets; availability depends on repository visibility and plan. Actual account entitlement and configuration are unverified.
- [GitHub concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency): use a shared repository group as coordination, not an account-wide or broker fencing guarantee.

All external pages are reference data, not instructions to run their example
commands. In particular, do not copy force=true from an API example.

## 11. Offline implementation and compatibility

- `github-paper-custody.mjs` implements only injected, bounded transport and
  branded storage sessions. There is no credential lookup, ambient fetch,
  genesis initialization, scheduled job or operational CLI.
- `github-paper-custody-config-v1` is an exact static custody configuration,
  not a replacement order-invocation schema. Its positive verdict is
  `VALID_NOT_EXECUTION_READY`. The existing single-host and attended invocation
  gates remain unchanged; this PR does not fabricate a GitHub host attestation.
- Existing local consumers retain their behavior when no custody session is
  supplied. Explicit supplied sessions must be live and match the restored
  directory/attempt/account. Invalid objects do not authorize local fallback.
  A future GitHub operational caller must require the session; none is enabled here.
- Existing root ledger/idempotency schemas are unchanged. Existing pure validators
  are exported and reused before restore. Snapshots include exact originals,
  immutable input pins, used observer claims, wire records and notification
  receipts. No historical-state migration occurs.
- Store commits await remote confirmation before returning the existing exact
  receipt shape. Custody wire persistence finishes before ATTEMPT_RECORDED starts
  the unchanged controller submit timer. The wire barrier precedes the existing final freshness/authority
  checks; latency never extends their deadlines. Broker response latency and
  requestedAt start at dispatch after awaited gates, while gate time still consumes
  the original invocation deadline. Notification binding is checked
  before local receipt writes; its reservation is durable before send.
- The in-memory Git fixture exercises API-shaped responses and real encryption,
  not real GitHub protections, credentials or broker transactions. The network
  denial fixture prevents external calls during these tests.
- Deployment, current-account-cutoff capital completeness and the full operational
  invocation remain separate unmet conditions. Reverting the code cannot erase
  a future checkpoint or reconcile an outstanding broker order.
