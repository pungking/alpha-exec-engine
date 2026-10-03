# PAPER broker notification implementation plan

**Goal:** Notify the existing private simulation Telegram route about observed PAPER order changes, independently of Stage6 message deduplication.

**Approved design:** The user's approval covers broker-confirmed acceptance, partial/full fills, protection observations, reconciled closeout, cancellation/rejection and safe blocking notifications. It does not authorize order execution, extra broker requests, state repair or test messages.

**Architecture:** Project the existing performance producer's in-memory broker responses into a private, versioned notification snapshot. A separate notification-only consumer uses atomic delivery receipts, never the order ledger, and runs after performance collection even when Stage6 is unchanged. Existing public projections remain aggregate-only.

**Tech stack:** Existing Node built-ins; no dependencies or broker adapter.

## Constraints and delivery semantics

- Preserve execution flags and all trading ledgers; development uses synthetic temporary files only.
- Existing broker GET count is unchanged. No websocket, retry or polling loop is added.
- First observation seeds a baseline silently. No historical event replay.
- A receipt is reserved before send. Ambiguous delivery is not retried automatically. Telegram plus filesystem/cache is not an exactly-once transaction.
- A missing receipt creates a new silent baseline; a corrupt receipt blocks notification. Existing GitHub cache durability is not an exactly-once service: cache loss can lose notifications and restoring an older receipt can replay an event. No duplicate-free claim is made across cache rollback. This cannot justify execution.
- A full fill is not necessarily a closed position. Closeout requires exact exit identity, terminal state, zero residual position, no open orders/children and existing verified fill-to-fill evidence.
- Protection messages describe observed children, not a guarantee of protection or permission to cancel them.
- Notification records are delivery metadata only, not a new order/planner ledger. Public output contains counts and status only.
- Automatic snapshot cadence, not real-time push: intermediate transitions between snapshots may not be observed.

## Tasks

- [x] RED: synthetic broker snapshots and mock Telegram transport; same Stage6/change in broker status, first-baseline, duplicate, unknown delivery, storage corruption, paper-only, raw/identifier redaction, closeout fail-closed.
- [x] GREEN: pure snapshot projection and atomic receipt consumer; reuse existing performance calls without changing their request sequence.
- [x] Integrate: simulation-only automatic workflow step; offline CI test; document schema and rollback (revert this change).
- [ ] Verify: notification fixture, existing performance/privacy/binding/protection/order-state/dispatch/symbol tests, typecheck/build/audit and diff check; commit, push, PR, CI, merge only on green.

## Files

- `scripts/paper-order-notifications.mjs`: snapshot and delivery contract (no broker transport).
- `scripts/test-paper-order-notifications.mjs`: synthetic offline tests.
- `scripts/build-performance-dashboard.mjs`: additive private snapshot from already fetched responses.
- `scripts/send-paper-order-notifications.mjs`: simulation-route consumer with same-run hash binding.
- `.github/workflows/dry-run.yml`, `.github/workflows/ci.yml`, `package.json`: wiring/tests only.

## Completion boundary

Static implementation and CI can complete here. Actual Telegram delivery and actual PAPER closed-loop execution remain unverified; neither is forced in this task. This does not close the original private-evidence goal or authorize a canary.

## Additive schema / operating limits

`performance-dashboard.json.notificationSnapshot` uses `paper-order-notification-v1` and contains only classified observations, account/event hashes and private symbols. Existing public dashboard and sealed-bundle projections keep their existing allowlists; no raw broker responses or order/account IDs are added to public evidence. Existing consumers may ignore the optional field. No Stage6 schema or execution payload changes.

`state/paper-order-notification-receipts.json` is new **notification delivery metadata**, not trading/idempotency state. It records hashes and attempt status/run/head/time only. The existing cache persists it; no new cache operation is introduced. Its exclusive lock and atomic write prevent concurrent local attempts. Capacity is bounded (50,000 event hashes / 10,000 attempts); reaching capacity stops notification rather than deleting receipts. Do not reset a failed/corrupt receipt to force resend.

First use baselines the observed account. A later account-hash mismatch blocks notification. This is a change detector, not independent approval of the broker account or proof of automated order ownership. Filled/canceled/rejected messages describe broker observations, not actions by this notifier. Protection observations do not certify stop/target geometry. Unknown statuses and inconsistent snapshots are excluded, not inferred. A 500-order query cap or missing current-source evidence blocks the snapshot; no extra broker query is made to recover it.

Delivery is guarded by the current automatic main run, attempt=1, existing performance phase receipt, raw output SHA-256 and unchanged ledger/idempotency input hashes. The notifier runs independently of Stage6 summary deduplication, but only after successful performance collection. Existing preflight/block summaries are retained. No manual, rerun, PR, live-host or execution-enabled path sends these notifications.

There are no real-time or catch-up guarantees: the existing 15-minute scheduled collection can miss intermediate states; acceptance may never be observed before a fill. A filled order alone never produces a closeout claim. Even with execution later approved, this read-only notification workflow remains separate and requires a subsequent scheduled PAPER observation.

Rollback: revert this change; preserve any existing notification receipts. Do not delete or migrate order state.
