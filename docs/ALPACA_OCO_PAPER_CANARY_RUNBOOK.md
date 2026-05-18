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
- `state/paper-oco-canary-submit-gate.json`
- `state/paper-oco-canary-submit-gate.md`
- `state/paper-oco-canary-submit-ledger.json` is reserved for a future approved broker-mutating implementation

The selector may recommend one lowest-notional eligible `symbol + qty=1` target, but it still sets `executionAllowed=false` and does not emit an Alpaca submit payload.

The approval gate is also report-only:

```bash
npm run ops:paper-oco-gate
```

It decides whether the selected row is blocked or `READY_FOR_MANUAL_APPROVAL`. It still sets `recommendedAction=DO_NOT_SUBMIT`.

The final submit gate is blocked by default:

```bash
npm run ops:paper-oco-submit-gate
```

Default behavior:

- no broker mutation,
- no Alpaca POST,
- no auto rollback,
- no executable row,
- writes `paper-oco-canary-submit-gate.json/.md`.

Read-only Alpaca precheck can be requested with:

```bash
PAPER_OCO_CANARY_READ_VERIFY=true npm run ops:paper-oco-submit-gate
```

Actual paper submit is not implemented in this lane. It remains a separate broker-mutating task that requires a fresh safety warning, exact approval phrase, paper-only environment, idempotency write-before-POST, rollback plan, and post-submit nested visibility capture.

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

## Submit Gate Rule

The submit gate consumes `paper-oco-canary-approval-gate.json`; it does not choose a ticker and does not submit.

Before a future broker-mutating implementation may POST, this gate must prove:

1. confirm the approval gate is `manual_approval_required` / `READY_FOR_MANUAL_APPROVAL`;
2. confirm selector scope is `portfolio_wide_dynamic_candidates_not_ticker_specific`;
3. confirm `qty=1` and stop/current/target geometry;
4. require `ALPHA_ENV=PAPER` and the paper Alpaca base URL;
5. read-only Alpaca precheck, if requested, is constrained to `ALPHA_ENV=PAPER` and the paper Alpaca base URL;
6. the future task must require `READ_ONLY=false` and `EXEC_ENABLED=true` only inside the explicitly approved run;
7. the future task must require the exact approval phrase;
8. the future task must read Alpaca account, clock, positions, nested open orders, and client-order lookup immediately before submit;
9. block if market is not open, position qty is missing, existing active sell protection exists, client order id is already used, or the dedicated idempotency ledger has an active entry;
10. persist `paper-oco-canary-submit-ledger.json` before POST;
11. after POST, verify nested open orders contain the OCO target parent and stop child.

If post-submit visibility fails, the default rollback behavior is manual review only. Automatic cancel is intentionally not enabled.

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

- The selector/approval gate is report-only. If the parent sidecar is running in paper execution mode (`READ_ONLY=false`, `EXEC_ENABLED=true`), that runtime state is reported as a warning, not a blocker; actual OCO broker mutation still requires the separate approval/submit lane.

## Approved Paper Submit Canary Lane

After the exact approval phrase is captured for the scoped task, run `paper-oco-submit-canary.yml`. This is the only lane that may call `POST /v2/orders` for a one-row paper OCO canary. It must verify read precheck, write `paper-oco-canary-submit-ledger.json` before POST, verify nested open-order visibility after POST, auto-cancel the returned paper order, and verify the ledger terminal state before the run is considered successful.

## Result Sync and Persistent Repair Planning

After an approved submit canary run, execute `npm run ops:paper-oco-result` or `paper-oco-canary-result-sync.yml` to create a separate result record. The result is pass only when broker submit, nested visibility, rollback cancel, rollback terminal verification, and terminal idempotency ledger checks all pass.

Persistent child-order repair is a separate lane from canary rollback testing. `npm run ops:persistent-oco-plan` is report-only and selects at most one dynamic paper candidate with `autoCancel=false`. It does not call Alpaca. A future persistent submit must be a separate paper-only, one-row task with exact approval, fresh read precheck, idempotency write-before-POST, nested visibility verification, and no auto-cancel.

## Approved Persistent Protective OCO Repair Lane

After the exact approval phrase is captured for the scoped task, run `persistent-oco-repair-submit.yml`. This is the only lane that may call `POST /v2/orders` to leave one paper protective OCO open for the dynamically selected persistent repair row. It must remain `PAPER` only, one row only, no auto-cancel, and must verify:

- fresh read precheck against Alpaca paper account, clock, position, and nested open orders,
- idempotency ledger write before POST,
- nested open-order visibility after POST,
- selected symbol appears in broker child-order reconciliation with stop and target present,
- manual rollback instructions are emitted with the client order id.

This lane is not a live-trading promotion. It is a paper-only persistence proof. Broader repair automation requires a separate approval and scale-up task.
