# Guarded Child-Order Repair Lane

## Scope

This lane is **design/report-only only**. It does not submit, replace, or cancel Alpaca orders.

The lane consumes:

- `state/performance-dashboard.json`
- `state/broker-child-order-reconciliation.json`
- `state/order-state-consistency-report.json`
- `state/last-dry-exec-preview.json`

It emits:

- `state/guarded-child-order-repair-plan.json`
- `state/guarded-child-order-repair-plan.md`

## Current Safety Policy

- `brokerMutationAllowed=false`
- `autoRepairEnabled=false`
- `emitsBrokerPayload=false`
- every row has `executionAllowed=false`

Any future order-repair implementation is an execution-policy change and must be handled as a separate, safety-gated task. The current planner intentionally does not contain broker submit payloads.

## Repair Candidate Semantics

The planner classifies held positions from the broker-child reconciliation output:

| Condition | Planner output |
|---|---|
| planned stop exists and no broker stop child exists | `FUTURE_CREATE_PROTECTIVE_STOP_CHILD` |
| planned target exists and no broker target child exists | `FUTURE_CREATE_PROFIT_TARGET_CHILD` |
| held position has no planned stop/target metadata | `BLOCKED_INPUT_GUARD` |
| planned stop is invalid or not below current price | `BLOCKED_INPUT_GUARD` |
| planned target is invalid or not above current price | `BLOCKED_INPUT_GUARD` |

Even valid candidates are marked `CANDIDATE_BLOCKED_REPORT_ONLY` until a future execution lane is explicitly approved.

## Future Execution Preconditions

Before any broker-mutating repair lane may be built, the following must be true:

1. Exact broker child/OCO payload semantics are verified from Alpaca official docs or captured paper fixtures.
2. A deterministic repair idempotency key is persisted before broker submission.
3. The lane verifies position quantity, current position side, market/session rules, and open child order state immediately before submission.
4. The lane blocks if current price has already crossed planned stop or target.
5. The lane blocks if planned stop/target geometry is invalid.
6. The lane has an explicit rollback/cancel plan.
7. The lane is enabled only under a separate execution approval gate.
8. The default remains disabled and report-only.

## Done-When Evidence

- `guarded-child-order-repair-plan.json` exists.
- `executionPolicy.brokerMutationAllowed=false`.
- `executionPolicy.autoRepairEnabled=false`.
- `summary.executionReadyRows=0`.
- ops health reports candidate rows as report-only, not executable.
