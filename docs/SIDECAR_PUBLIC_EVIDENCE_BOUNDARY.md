# Sidecar public evidence boundary

The automatic dry-run and market-guard workflows run in a public repository. Its published artifact
is an aggregate, not a backup of private execution state.

- `sidecar-state-<run_id>` and `sidecar-guard-state-<run_id>` keep their names but contain only
  `evidence.json` (`sidecar-public-evidence-v1`). Download consumers must not expect
  ledger, idempotency, order identifiers, positions, raw logs or private reports.
- Existing producers and execution guards are unchanged. Shell steps preserve
  exit status, pipefail, GITHUB_ENV and GITHUB_OUTPUT. Their stdout, stderr and
  detailed step summaries stay in RUNNER_TEMP and are not uploaded.
- The last publication step uses ordinary bash and emits fixed, typed counts,
  safety booleans and source content hashes. Missing counts remain null, not zero.
  It makes no broker, source, Telegram or Notion request and changes no ledger.
- Existing cache restore/save and private Notion/Telegram routes are unchanged.
  A cache is not a public artifact, but its access policy needs separate review;
  this change is not an account-wide secrecy guarantee.
- Existing runs, artifacts and saved caches are not deleted or rewritten.
  Removal of previously exposed public evidence requires separate operator approval.
- Other workflows are outside this boundary. Do not claim that all historical or
  repository-wide disclosures have been contained by this change.

Test: `npm run ops:test:sidecar-public-evidence`.

Rollback: revert this merge only after review. A blind revert restores private
state publication. No execution policy, Stage6 contract or runtime state migration
is part of the change.
