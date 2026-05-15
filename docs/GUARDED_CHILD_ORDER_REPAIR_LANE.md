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
- `state/alpaca-order-payload-schema-report.json`
- `state/alpaca-order-payload-schema-report.md`
- `state/alpaca-oco-response-fixture-report.json`
- `state/alpaca-oco-response-fixture-report.md`

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

1. Exact broker child/OCO payload semantics are verified from Alpaca official docs and captured paper fixtures.
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
- `npm run ops:alpaca:payload-fixtures` returns `overall=pass` before any future paper fixture submit is considered.
- `npm run ops:alpaca:oco-response-fixtures` returns `overall=pass` before any future paper OCO canary is considered.

## Alpaca Payload Schema Fixture

The official bracket/OCO payload schema and offline paper fixtures are documented in:

- `docs/ALPACA_CHILD_OCO_PAYLOAD_SCHEMA.md`
- `docs/ALPACA_OCO_PAPER_CANARY_RUNBOOK.md`
- `testdata/alpaca/bracket-entry-long.paper.fixture.json`
- `testdata/alpaca/oco-exit-long-repair.paper.fixture.json`
- `testdata/alpaca/oco-repair-nested-open.paper-response.fixture.json`

This schema fixture is still non-mutating. It only verifies the shape of a future paper test and does not enable repair execution.
