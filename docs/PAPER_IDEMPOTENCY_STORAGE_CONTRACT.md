# Idempotency storage fail-closed contract

Scope: the shared runtime load/save functions used by `src/index.ts`. This is
storage hardening, not execution activation or a historical state migration.

- Missing, unreadable, malformed JSON, invalid schema, or a writer lock aborts
  the caller. No empty store is inferred and no invalid token is normalized.
- UTF-8 decoding is fatal on invalid bytes. Original and readback snapshots are
  compared as bytes, not lossy decoded strings. Storage errors also propagate
  through the exit submission catch, never becoming fabricated broker failures
  that overwrite stored broker metadata during downstream reconciliation.
- Existing valid keys, releases, extensions and limited-control records are
  retained. Unknown historical timestamps remain null, never fabricated.
- Missing `orders`, `releases`, or required record fields is invalid. Legacy
  artifacts previously coerced into an empty shape now require explicit review;
  there is no silent schema migration. No persisted fields are renamed.
- Only an object returned by a successful load can be saved to the same path.
  Exclusive owner-only locks serialize cooperating runtime writers. Byte parity
  rejects stale snapshots; workflow concurrency remains unchanged.
- Save writes an exclusive owner-only temporary file, syncs it, reads it back,
  validates it, verifies original bytes and atomically renames it. Failures
  before rename preserve the original file; caller execution stops.
- The containing directory is synced before success is returned. Failure after
  rename is `ORDER_IDEMPOTENCY_COMMIT_UNCERTAIN`: the lock remains and no payload
  is returned. A process killed during persistence may also leave a lock/private
  temporary file. Neither is automatically retried, deleted, or restored.
- Errors contain fixed codes only, not serialized state or filesystem error
  details. Tests use synthetic temporary directories, never PAPER state.

## Operator recovery boundary

Stop all writers before any separately approved recovery. Preserve exact bytes,
hashes, locks and temporary files; establish whether rename committed before
proposing a repair. Never delete a lock merely because its age is high, create
an empty store on cache miss, or overwrite a valid newer store with an older one.
Other migration tools do not participate in this runtime lock and must not run
concurrently. This is not a distributed transaction or proof of broker fills.

Existing pruning, release, execution approval, market-session, limited-control
and PAPER/LIVE policies are unchanged. `READ_ONLY=true`, `EXEC_ENABLED=false`
remain the safe defaults. No broker call, state migration, or runtime dispatch
is part of this change. Rollback is a code revert only; state is never reset.

Check: `npm run ops:test:order-idempotency-storage`.
