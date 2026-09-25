# PAPER controlled-closeout private input contract

## Diagnosis and boundary

Automatic `sidecar-state-*` artifacts now contain aggregate `evidence.json`, not
private state. The manual `paper-oco-read-verify` and `paper-oco-submit-canary`
workflows still require private candidate/approval/submit files. Persistent OCO
plan/submit workflows require reconciliation/repair plans; open-verify workflows
require a private preview plus submit reports/ledgers. Their `test -f` checks
reject an aggregate-only source before broker steps. The result-sync workflow
consumes submit artifacts and writes Notion; it is not an input collector.

These are protective-order repair paths, not limited-position closeout paths.
Do not run them to close a limited-control position, select an older public
artifact as a workaround, or upload private state to satisfy their inputs.
Their existing output paths are not covered by the automatic-publication guard;
this change does not certify their privacy or enable their use.

The new local-only command supplies the missing private **report-only input**
boundary. It does not revive these workflows or create a broker transport.
The historical caches previously found absent remain unavailable; this command
does not search for, restore or save any cache. Old local evidence remains a
historical snapshot even if its hashes validate.

## Offline private input

Run `npm run ops:paper-closeout-private-evidence -- /private/input/directory SHA256`
only against an operator-prepared, immutable snapshot outside the checkout.
`SHA256` is the separately pinned SHA-256 of the exact `manifest.json` bytes.
Pin it before use; a hash supplied by the same untrusted input is not provenance
authentication. The input directory and files must be owned by the current user
and inaccessible to group/others (0700 directory, 0600 files). Never change the
permissions or contents of preserved originals to satisfy this check.

`manifest.json` requires:

- `schemaVersion=paper-closeout-private-evidence-v1`
- `environment=PAPER`, `evidenceBasis=PRESERVED_SNAPSHOT`
- `files`: the following seven filenames mapped to their raw-byte SHA-256:
  `last-dry-exec-preview.json`, `performance-dashboard.json`,
  `position-protection-root-cause-audit.json`,
  `broker-child-order-reconciliation.json`, `order-state-consistency-report.json`,
  `order-ledger.json`, `order-idempotency.json`.
- `targets`: exact `ledgerKey`, `idempotencyKey`, `ledgerRecordSha256`,
  `idempotencyRecordSha256` for **every** limited-control idempotency entry.
  Record hashes use the existing `sha256Canonical` helper: sorted object keys,
  preserved array order and JSON scalar values, SHA-256 of UTF-8 JSON.

No arbitrary source paths, URLs, latest-run lookup or symbol-based identity
resolution are accepted. Each target binds exact map entries, immutable
client-order/Stage6/side lineage and nullable original broker-order identity.
A missing original broker ID is counted, never manufactured or treated as broker
fill proof. Duplicate identities and conflicting lineage fail closed.
All seven byte hashes must match before evaluation; mixed report histories are
not made current by sharing a manifest. The operator must retain source/run
provenance privately. The checker verifies integrity, not broker authenticity.

The existing pure `buildPaperExitReadiness` is reused without its CLI writes.
Its symbol-based report joins are descriptive replay only; they are not used to
prove identity. Duplicate report symbols are rejected rather than choosing the
latest. Other portfolio rows remain visible as unscoped counts and cannot be
silently used to approve a target. Ledger/idempotency files are never rewritten.

## Output and downstream compatibility

Stdout contains only fixed status strings, counts, safety booleans and the pinned
manifest hash. Error messages never echo filesystem paths, parse text, identifiers
or arbitrary report strings. No private output, payload, credential loading,
network request or report file write is performed. Missing/malformed input exits 1.

`PRIVATE_EVIDENCE_CONTRACT_VALID_CURRENT_PROOF_REQUIRED` means input integrity
and exact limited-state representation passed, **not** closeout eligibility.
Every result has `currentBrokerEvidenceVerified=false`, `selectedCandidateCount=0`,
`entryAllowed=false`, `scaleInAllowed=false`, `riskIncreasingActionAllowed=false`,
`brokerSubmitAllowed=false`, `realizedPnlVerified=false` and
`historicalEvidenceNormalized=false`. Historical RTH-open evidence cannot grant
current market eligibility. Original entry idempotency cannot authorize a new
exit-action idempotency entry. The existing submission guard still rejects
limited-control rows, and ownership/protection/terminal guards are unchanged.

Existing scorecard CLI outputs and schemas are unchanged. Only pure helper
exports are additive; importing the scorecard no longer writes reports.
No execution variable, Stage6 policy, dependency or state schema is changed.

## Finite next approval package (not executed by this change)

The next bounded operation is private input preparation, not another five-row
broker reconstruction attempt. Use the already preserved local snapshot once
to establish the input contract; do not claim it is current. If the snapshot or
exact identities cannot satisfy the contract, stop with the named input blocker.
Do not repeat the audit or synthesize missing inputs. A successful result leaves
the next trading prerequisite explicit: current privately retained state and
separately approved fresh broker/clock/protection evidence. No RTH wait is needed
for the input operation, and no order authorization is provided here.

Approval template (pin the merged main SHA and source snapshot SHA before use):

```text
AUTHORIZE PAPER PRIVATE CLOSEOUT INPUT PREPARATION ONE-SHOT —
alpha-exec-engine merged main only; preserve all completed evidence;
use only the already preserved local PAPER snapshot, with its existing SHA-256
verified before reading; prepare one new owner-only private evidence directory
and one exact-key/hash manifest; include all limited-control identities and the
full preserved portfolio reports; audit once with the pinned manifest hash;
keep evidenceBasis=PRESERVED_SNAPSHOT and selectedCandidateCount=0;
publish aggregate-only stdout; no broker/provider request, cache restore/save,
artifact download/upload, workflow execution, ledger/idempotency migration,
order or protective-child mutation, current-evidence promotion or policy change;
abort on missing input, identity ambiguity or hash drift; no retry.
```

Tests: `npm run ops:test:paper-closeout-private-evidence` plus existing limited
recovery, live-readiness, lifecycle, protection, P&L and public-boundary tests.
Rollback: revert this commit; no state migration or broker action is involved.

## Complete private capture prerequisite

Goal: `PAPER_COMPLETE_PRIVATE_EVIDENCE_CAPTURE_CONTRACT_V1`.
The preserved run 34639087903 bundle failed the offline input preflight: the
dashboard was absent and preview was duplicated. Do not re-audit that archive,
download it again, choose a duplicate arbitrarily, or patch the historical bundle.
The old private-input goal remains blocked; implementing this prerequisite does
not make the old snapshot complete.

Sequence: static fixtures and implementation -> CI/main integration -> separately
approved bounded capture -> privately retained output audit. No scheduled job,
workflow-dispatch path, cache restore/save or automatic broker request is added.
This change implements only the first two steps. Existing producers and the
offline auditor are reused; no new ledger, dependency or execution policy exists.

### Private source preflight

After separate approval, the local/server-side command is:

```sh
npm run ops:paper-private-evidence-capture -- SOURCE_DIRECTORY SOURCE_MANIFEST_SHA256 OUTPUT_DIRECTORY
```

Both input and the output parent must already be owner-only real directories
(0700); output must not exist, overlap input or be inside this checkout. Source
files must be owner-only regular files (0600), not symlinks. The command neither
locates nor repairs inputs. Missing source or permissions fail before requests.
Do not rewrite preserved source evidence to pass these checks.

The separately pinned `source-manifest.json` requires:

- `schemaVersion=paper-private-capture-source-v1`, `environment=PAPER`,
  `evidenceBasis=PRESERVED_STATE_SNAPSHOT`, numeric-string `sourceRunId`.
- `expectedPaperAccountSha256`: raw UTF-8 SHA-256 of the independently confirmed
  PAPER account ID, retained privately. Do not print the ID or derive this pin
  from an unverified response during capture.
- `files`: raw-byte hashes of exactly one `last-dry-exec-preview.json`,
  `order-ledger.json`, `order-idempotency.json`; optionally exact hashed
  `fillability-report.json`, `fill-state-reconciliation-audit.json`,
  `position-lifecycle-guard-source-plan.json`. No other filenames are accepted.

Every limited-control identity is resolved by the exact embedded idempotency key
and validated with the existing immutable Stage6/client/broker/side record
contract. No symbol-only recovery or timestamp fabrication is performed. Exact
private target bindings select report inputs without changing the original state.
Distinct historical identities cannot overwrite the selected target merely by
sharing its symbol or having a newer timestamp. Unbound or conflicting identities
still fail closed. A nullable original broker ID stays nullable.
The dashboard now carries the actual ledger map key rather than incorrectly
substituting the embedded idempotency key; protection reporting follows the exact
ledger row to its idempotency entry and retains that map key in its own output.
Original state bytes are never changed. Present observation timestamps in source
records and nested broker orders must parse and cannot be later than receipt;
an explicit ISO8601 timezone is required, and future source observations
(including idempotency releases) fail before any request. Scheduled next-open/expiry
times are not treated as observations. No clock tolerance or timestamp fallback
is introduced.

Required process environment: `ALPHA_ENV=PAPER`,
`ALPACA_BASE_URL=https://paper-api.alpaca.markets`, `READ_ONLY=true`,
`EXEC_ENABLED=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`, PAPER credentials in
`ALPACA_KEY_ID`/`ALPACA_SECRET_KEY`, and
`PAPER_PRIVATE_CAPTURE_APPROVAL=AUTHORIZE PAPER COMPLETE PRIVATE EVIDENCE READ-ONLY ONE-SHOT`.
Secrets are passed only to the bounded GET client, never to report subprocesses.

### Request and persistence contract

Budget is **five GETs total**, sequentially, each at most once:

| Group | Fixed PAPER path |
| --- | --- |
| Account identity | `/v2/account` |
| Full positions | `/v2/positions` |
| Open orders | `/v2/orders?status=open&nested=true&direction=desc&limit=500` |
| Closed orders | `/v2/orders?status=closed&nested=true&direction=asc&limit=500` |
| Broker clock | `/v2/clock` |

There are no fill-activity, per-symbol, by-ID or secondary requests. Timeout is
15 seconds per request; response bytes are bounded to 8 MiB. Redirects, retry and
pagination are disabled. HTTP/schema/account mismatch, future clock, >=500 orders
or transport failure terminates the attempt. Short positions fail explicitly:
the reused protection reports are long-only; no short is omitted or treated as
sell-side protected. Supporting shorts requires a separate tested producer fix,
not relaxed capture validation. Closed-order history completeness is **not**
established by a single page; verified realized P&L is not promoted.

Exclusive output-directory creation and `attempt.json` claim the attempt before
the first request. Existing output, including failed/in-progress attempts, blocks
all requests. It is not a cross-directory/global idempotency ledger: operators
must not change the output path to retry under the same one-shot authorization.

Only normalized reports and hashes are stored, never raw broker responses. All
writes stay in the new private directory. Existing dashboard, reconciliation,
order-state and protection producers generate the missing reports from captured
responses and immutable private state copies; their stdout/stderr is suppressed.
Full portfolio coverage is checked, including preview/report set parity. Missing
rows or changed portfolio fail closed rather than creating synthetic preview rows.

`complete/` contains the seven required files, their pinned `manifest.json`,
aggregate `result-safe.json` and terminal `attempt-terminal.json` (`COMPLETE`).
They are published together by atomic directory rename after exactly one offline
audit and source-byte hash parity recheck. Failure preserves the attempt and
private intermediates without a published complete package. The output root also
keeps response hashes/times and normalized broker clock in
`capture-provenance.json`; this file is private. The complete manifest hash is
recorded before audit. Never upload this directory, manifest, intermediate
Markdown or logs to a public workflow artifact.

### Evidence meaning and finite exit

`PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED` certifies the seven-file
private input contract, **not** fresh exit readiness or order authorization.
The old preview and state retain their exact bytes and original timestamps.
Fresh sequential broker observations are distinct from preserved preview/state,
and are not an atomic portfolio snapshot. Source-state authenticity/currentness,
historical fill completeness and fresh Stage6/exit-action lineage remain unproven.
The manifest's `PRESERVED_SNAPSHOT` basis is for offline descriptive replay only.
It must never be relabeled as one coherent current broker/decision snapshot.

Every aggregate keeps `currentBrokerEvidenceVerified=false`,
`selectedCandidateCount=0`, `brokerSubmitAllowed=false`, `realizedPnlVerified=false`
and no entry/scale-in/risk increase. Clock-open alone changes none of these.
Preserved preview is never regenerated by changing `generatedAt`.
`captureInputSha256` hashes the pinned source manifest and response hashes;
identical evidence repeats deterministically. Complete artifact byte hashes also
bind real report-generation timestamps and may differ between captures. This
does not authorize rerunning a capture to test determinism.

Next action is **one separately approved private capture**, only after the actual
merged SHA, source path/manifest SHA, independent account pin and new output path
have been fixed. If these inputs are unavailable, stop with that prerequisite;
do not restore a cache or fetch a workflow artifact under this approval.
The original blocked input goal cannot be declared passed using mixed new/old
evidence. A capture failure terminates this attempt with one named blocker; no
repeated audit or broker calls are authorized.

```text
AUTHORIZE PAPER COMPLETE PRIVATE EVIDENCE READ-ONLY ONE-SHOT —
alpha-exec-engine merged main and separately pinned private source manifest only;
preserve all original evidence, ledgers, idempotency and caches;
one new owner-only private output directory; include every exact limited-control
identity and the full portfolio; Alpaca PAPER account GET<=1, positions GET<=1,
open-orders GET<=1, closed-orders GET<=1, clock GET<=1, total GET<=5;
no retry, pagination, redirects, raw response storage or public private-evidence
upload; atomically publish all seven files and their terminal receipt only after
exact source hash parity and one offline audit; retain old preview timestamps;
selectedCandidateCount=0, currentBrokerEvidenceVerified=false;
no broker POST/PATCH/DELETE, order/protective-child mutation, ledger/idempotency
write, cache restore/save, workflow/sidecar run or policy change;
abort on input, identity, account, schema, scope, budget or hash mismatch.
```

Tests: `npm run ops:test:paper-private-evidence-capture` uses synthetic responses
only, including missing input, exact/legacy identity, HTTP/timeout failures,
private permissions, duplicate/failed attempts, limit/portfolio/short rejection,
original-byte retention, redaction, terminal parity and deterministic input hash.

## Exact-cache encrypted source export

The separately approved `paper-exact-cache-private-export.yml` is manual-only
and fixed to `sidecar-state-main-35610146111`. It does not run the capture,
sidecar, migration or broker code. Before restore it requires the exact reviewed
main SHA, cache ID/version, approval phrase, and locally pinned public-key hash.
Workflow run attempt must be one; its dispatch history must contain only the
current run. A prior/failed/concurrent dispatch blocks restore. Do not delete run
history or change the workflow name to retry this authorization.

`actions/cache/restore` restores only into a disposable runner with no broker
secrets. No fallback keys or cache-save step exist. Both `cache-hit=true` and the
exact matched key are mandatory. The checkout is sparse, contains no tracked
state, and persists no checkout credential. Only these original bytes are read:

- `order-ledger.json`
- `order-idempotency.json`
- `last-dry-exec-preview.json`

The exporter rejects missing, symlinked, hard-linked, oversized or non-object
JSON files and recognized nonempty credential fields. It never logs source JSON
or parser errors. Source hashes are checked again before publishing ciphertext.
This is transport validation, not proof that cache content is trustworthy,
current, complete, PAPER-account matched or reconstruction-ready.

An RSA key pair (at least 3072 bits) is created locally. The private key stays in
an owner-only local directory, never a workflow input, repository secret or
artifact. Only the SPKI DER public key and its SHA-256 enter the runner. The
Node standard crypto library wraps a fresh 256-bit AES key with RSA-OAEP-SHA256;
AES-256-GCM encrypts the three files and their hashes with a fresh 96-bit nonce.
Source key/run, export run/commit and recipient fingerprint are authenticated
additional data. Ciphertext hash is reported as a safe aggregate. Encryption
alone does not authenticate the sender: the operator must independently pin
that hash from the exact successful reviewed workflow run.

The only uploaded file is `envelope.json`, retained for one day. No plaintext,
private key, manifest or state directory is uploaded. After one download, use:

```sh
node scripts/paper-exact-cache-private-export.mjs decrypt \
  ENVELOPE_FILE LOCAL_PRIVATE_KEY NEW_PRIVATE_OUTPUT_DIRECTORY \
  PINNED_ENVELOPE_SHA256 EXPORT_RUN_ID REVIEWED_MAIN_SHA
```

Decryption requires an owner-only parent/key, authenticates the complete
envelope and verifies all three byte hashes before atomically publishing the
`source` directory (0700, files 0600). An existing output blocks reuse. Failure
must not be converted into a second dispatch or artifact download. Decryption
preserves original observation timestamps and labels the resulting
`export-manifest.json` as `UNVERIFIED_CACHE_SNAPSHOT`. It is **not** a capture
`source-manifest.json`; no independent PAPER account hash is fabricated.
Current broker proof remains false and selected candidate count remains zero.

GitHub Actions caches are not a confidential vault or durable ledger backup.
This one-shot does not fix ongoing cache confidentiality, certify historical
recovery, or authorize changing cache persistence. It preserves the source
cache and all prior evidence. No execution policy or Stage6 contract changes.

Validation: `node scripts/test-paper-exact-cache-private-export.mjs` uses only
synthetic files and locally generated test keys; broker/cache requests are zero.

## Exact private report identity closure

Goal: `PAPER_PRIVATE_CAPTURE_EXACT_IDENTITY_REPORT_JOIN_V1`.

The capture requires exactly five unique limited-control identities. The existing
exact record/hash validator runs before network access. A shared in-memory report
view then selects their exact ledger and idempotency map entries. Dashboard,
order-state and protection reports reuse this view; no original file is filtered,
rewritten or normalized. All unscoped portfolio history remains visible. Full
original ledgers still feed exit-conflict and realized-P&L checks.

The private dashboard carries `privateCaptureTargets` (exact keys and record
hashes). The offline auditor checks it against the pinned manifest and verifies
ledger/Stage6 parity across dashboard, child reconciliation, protection and
order-state reports. This additive field is omitted by the public dashboard.
Ordinary producers without this explicit private scope retain existing behavior.

Same-identity release evidence remains visible, including terminal conflicts.
Distinct historical release identities may be excluded from the target report
view; symbol-only releases, conflicting identity anchors and unidentified
same-symbol state rows fail closed. Duplicate embedded idempotency keys also
fail closed; a missing original broker ID cannot prove a release is distinct.
A scoped row in an optional historical
fillability, fill-state or lifecycle report is not yet identity-certified and
blocks capture before requests rather than overriding exact evidence. Unscoped
optional rows are unchanged. This intentionally does not claim those optional
report schemas have an exact-target contract.

Tests use synthetic responses only: competing historical rows in both insertion
orders, legacy map keys, same-identity releases, conflicting/unbound evidence,
report-binding tampering, five-row scope, unchanged input hashes, public redaction
and ordinary-call compatibility. No account pin is derived from the recovered
snapshot, and no broker capture is authorized by static test success. Independent
PAPER account confirmation and a separately approved bounded capture remain
required. Rollback is revert of the code commit; no state migration is needed.
