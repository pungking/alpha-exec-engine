# Order-ledger storage fail-closed contract

Scope: runtime `loadOrderLedgerState` / `saveOrderLedgerState` in `src/index.ts`.
The atomic IO is shared with the existing idempotency store, not reimplemented.
This change does not repair historical state or authorize broker activity.

## Read and compatibility boundary

- Missing/unreadable files, invalid UTF-8/JSON, invalid root/record/history shape,
  invalid timestamps/statuses, key/embedded-key mismatch and writer locks throw
  sanitized `ORDER_LEDGER_*` errors. There is no empty fallback or normalization.
- The persisted schema/field names are unchanged. Existing valid keys, history,
  optional legacy fields and extensions survive round trips. A deliberately
  initialized `{ "orders": {}, "updatedAt": "" }` is valid; a missing file is not.
- Formerly tolerated partial/corrupt stores now block. Review their preserved
  bytes and lineage before a separately approved migration; never fabricate
  missing fields, timestamps, IDs, fill status or terminal history.
- Shape validation is not broker-fill, ownership, freshness or P&L verification.

## Write and propagation boundary

- Save requires an object loaded from the same file with the same validator.
  An exclusive owner-only lock serializes cooperating writers. Original-byte
  parity rejects stale snapshots without replacing a newer file.
- Owner-only temporary bytes are synced, read back, schema-checked and renamed
  atomically; the containing directory is synced before success is returned.
  Failure before rename preserves the old file. Failure after rename leaves a
  lock and reports `ORDER_LEDGER_COMMIT_UNCERTAIN`; no automatic rollback/retry.
- A killed writer can leave a lock and private temp file. Recovery requires
  preserving them and determining whether commit happened, not deleting an
  apparently old lock. Migration tools must not run concurrently with runtime
  writers. This is not a multi-file or distributed transaction.
- Main validates ledger storage before provider reads/state-producing work.
  The shared submit boundary validates it again before broker access, including
  entry/scale-in paths. Held-position/portfolio/submit catches rethrow storage
  failures instead of proceeding with empty holdings or fake broker failure.
- Successful storage validation is not a writeability guarantee for a later
  disk failure or a cross-file/broker transaction. Ambiguous post-submit or
  post-rename outcomes require separate reconciliation, never automatic resend.

No Stage6, sizing, transition, TTL/pruning, protection, limited-control or
execution policy changes. Safe defaults remain `READ_ONLY=true` and
`EXEC_ENABLED=false`. Idempotency public APIs/error codes remain compatible.
No runtime/cache/state migration is performed by this task. Rollback is a code
revert only; it must not reset state or remove locks.

Checks (synthetic private temporary files, no provider/broker calls):

```
npm run ops:test:order-ledger-storage
npm run ops:test:order-idempotency-storage
```

The shared IO crash/competing-writer tests run in the idempotency suite; the
ledger suite additionally covers its schema, unchanged history, deterministic
save, update caller, all four catching paths, startup and pre-submit rejection.
