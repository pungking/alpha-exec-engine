# Alpaca OCO Paper Canary Runbook

## Scope

This runbook defines the **future** Alpaca paper canary for attaching OCO protection to an existing long paper position that has planned target/stop metadata but no broker-side child orders.

The canary is portfolio-wide by design. BZ/QFIN are only current examples from the latest artifacts; the selector must work for any future symbol that becomes a filled/held position with missing broker-side protection.

This document does not enable execution. The current implementation remains report-only.

## Safety Boundary

Default state must remain:

```env
EXEC_ENABLED=false
READ_ONLY=true
LIVE_ORDER_SUBMIT_ENABLED=false
GUARDED_CHILD_REPAIR_MODE=report_only
```

The OCO paper canary is a broker-mutating action. It must not be run automatically. It requires a separate safety-gated task and a single manually selected paper target row.

The current code only builds the report-only candidate selector:

```bash
npm run ops:paper-oco-canary
```

Outputs:

- `state/paper-oco-canary-candidate.json`
- `state/paper-oco-canary-candidate.md`
- `state/paper-oco-canary-approval-gate.json`
- `state/paper-oco-canary-approval-gate.md`

The selector may recommend one lowest-notional eligible `symbol + qty=1` target, but it still sets `executionAllowed=false` and does not emit an Alpaca submit payload.

The approval gate is also report-only:

```bash
npm run ops:paper-oco-gate
```

It decides whether the selected row is blocked or `READY_FOR_MANUAL_APPROVAL`. It still sets `recommendedAction=DO_NOT_SUBMIT`.

## Candidate Selection

A position can be considered for a future OCO paper canary only if all conditions are true in the latest artifacts:

1. `performance-dashboard.json` shows an open long paper position with `qty > 0`.
2. `plannedStopPrice` / `stopPrice` exists and is below current price.
3. `plannedTargetPrice` / `targetPrice` exists and is above current price.
4. `broker-child-order-reconciliation.json` marks the row as missing stop/target children.
5. `guarded-child-order-repair-plan.json` marks the row as `CANDIDATE_BLOCKED_REPORT_ONLY`.
6. `alpaca-order-payload-schema-report.json` is `overall=pass`.
7. `alpaca-oco-response-fixture-report.json` is `overall=pass`.
8. `order-state-consistency-report.json` has no fill-state failures for the symbol.
9. `GET /v2/orders?status=open&nested=true&symbols=<SYMBOL>` immediately before submit confirms no active sell stop/limit child already protects the same quantity.

If any condition fails, do not submit OCO. Keep report-only and write the blocker to ops health.

## Candidate Selection Rule

The selector must consider every row in `guarded-child-order-repair-plan.json` with `readiness=CANDIDATE_BLOCKED_REPORT_ONLY`.

It must not contain a ticker allowlist. It may accept `PAPER_OCO_CANARY_SYMBOL=<SYMBOL>` as a manual filter, but that filter only selects from the current dynamic eligible set.

Default selection, when no symbol is requested:

1. require valid current price, stop, target, and whole-share qty;
2. require both stop and target broker children to be missing;
3. require payload fixture and nested response fixture validation to pass;
4. require order-state consistency to have no symbol-level failure;
5. choose the lowest `canaryQty * currentPrice` candidate to minimize paper canary blast radius.

The selected row is still `SELECTED_PENDING_SAFETY_APPROVAL`, never executable.

## Approval Gate Rule

The approval gate consumes only the selector output and current safety artifacts. It does not select a ticker by itself.

It returns `manual_approval_required` only if:

1. exactly one selected candidate exists;
2. selector scope is portfolio-wide;
3. selector, guarded repair plan, payload fixture, OCO response fixture, order-state, and runtime safe flags pass;
4. broker child reconciliation confirms both stop and target children are missing;
5. selected row remains `executionAllowed=false`;
6. `qty=1` and stop/current/target geometry is still valid.

Even then, the decision remains `DO_NOT_SUBMIT` until a separate broker-mutating task is explicitly approved.

## Proposed Paper Request Shape

For a long position, the future paper request must be qty-based and opposite-side:

```json
{
  "symbol": "BZ",
  "side": "sell",
  "type": "limit",
  "time_in_force": "day",
  "order_class": "oco",
  "qty": "1",
  "take_profit": { "limit_price": "24.50" },
  "stop_loss": { "stop_price": "20.10" },
  "client_order_id": "repair_<stage6hash>_<symbol>_<nonce>"
}
```

Rules:

- Use `qty`, never `notional`.
- `qty` must be less than or equal to the current open long quantity.
- `side=sell` for long protection.
- `type=limit` because Alpaca OCO uses the take-profit order as the parent limit order.
- Stop must be below current price and below take-profit base by at least Alpaca's threshold.
- Do not use extended-hours advanced orders.

## Required Capture After Submit

After a future paper submit, immediately capture both:

1. The sanitized POST `/v2/orders` response, if available.
2. The sanitized nested GET response:

```text
GET /v2/orders?status=open&nested=true&symbols=<SYMBOL>&direction=desc&limit=50
```

The nested GET response is the canonical fixture because Alpaca documents that `nested=true` rolls multi-leg orders into `legs`.

## Sanitization Rules

Before committing or uploading a fixture:

- remove account identifiers,
- remove API keys, tokens, auth headers, request headers,
- keep order IDs only if they are redacted or fake fixture IDs,
- keep prices, qty, side, type, status, `order_class`, `client_order_id`, `parent_order_id`, and `legs`,
- confirm no `account`, `account_id`, `account_number`, `secret`, `token`, or `authorization` fields exist.

## Fixture Validation

Run:

```bash
npm run ops:alpaca:oco-response-fixtures
```

Expected result before any future canary is considered ready:

```text
overall=pass
fail=0
brokerMutationAllowed=false
callsBrokerApi=false
```

Outputs:

- `state/alpaca-oco-response-fixture-report.json`
- `state/alpaca-oco-response-fixture-report.md`

## Abort Conditions

Abort the paper canary if any of these are true:

- existing active sell child order already exists,
- current price is already below planned stop,
- current price is already at/above planned target,
- planned stop/target geometry is invalid,
- position qty changed after the planner snapshot,
- market/session status is unknown,
- idempotency key already exists for the same symbol/qty/stop/target,
- account/order response contains unredacted sensitive fields,
- Alpaca rejects the fixture shape in paper.

## Done-When Evidence

A future OCO paper canary is considered useful only when all are true:

- Alpaca accepts the OCO paper order.
- `GET /v2/orders?status=open&nested=true` shows the take-profit parent and stop-loss child.
- `build-performance-dashboard.mjs` reports broker stop/target present for the symbol.
- `broker-child-order-reconciliation.json` no longer reports stop/target missing for that symbol.
- `order-state-consistency-report.json` remains `PASS` or has no symbol-level failure.
- No account number or credential leaks into artifacts.

Until then, keep the lane report-only.
