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
