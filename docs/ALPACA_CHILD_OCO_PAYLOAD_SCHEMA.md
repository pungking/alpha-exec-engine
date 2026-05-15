# Alpaca Child/OCO Payload Schema Verification

## Scope

This document locks the non-mutating schema design for Alpaca bracket entry orders and future OCO repair orders.
It is a verification/design artifact only. It does not authorize broker mutation.

## Official Source Checks

Verified against Alpaca's official "Placing Orders" documentation on 2026-05-15:

- Bracket orders: https://docs.alpaca.markets/us/docs/orders-at-alpaca#bracket-orders
- OCO orders: https://docs.alpaca.markets/us/docs/orders-at-alpaca#oco-orders
- Stop-loss threshold for advanced orders: https://docs.alpaca.markets/us/docs/orders-at-alpaca#threshold-on-stop-price-of-stop-loss-orders
- Notional order restrictions: https://docs.alpaca.markets/us/docs/orders-at-alpaca#notional-order-restrictions
- Create Order API reference: https://docs.alpaca.markets/us/reference/postorder

## Bracket Entry Payload Contract

Current sidecar broker-submit lane converts internal notional sizing into whole-share `qty` before submitting to Alpaca.
The broker-facing entry payload must remain qty-based:

```json
{
  "symbol": "BZ",
  "side": "buy",
  "type": "limit",
  "time_in_force": "day",
  "order_class": "bracket",
  "limit_price": "21.25",
  "qty": "1",
  "take_profit": { "limit_price": "24.50" },
  "stop_loss": { "stop_price": "20.10" },
  "client_order_id": "fixture_bracket_bz_0001"
}
```

Required project checks:

- `order_class=bracket`.
- `side=buy` for long entry.
- `type=limit` or `market`; current project fixture uses `limit`.
- `time_in_force=day|gtc`; current project fixture uses `day`.
- `qty` is present and is a positive whole-share value.
- `notional` is not present in paper fixtures or repair fixtures.
- `take_profit.limit_price` is present.
- `stop_loss.stop_price` is present.
- For a long limit entry, `take_profit.limit_price > limit_price > stop_loss.stop_price`.
- `extended_hours` is omitted or false.

## OCO Repair Payload Contract

OCO is the official Alpaca order class that can add take-profit and stop-loss after a position already exists.
This is the only currently designed shape for future guarded child repair of a long position:

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
  "client_order_id": "fixture_oco_bz_repair_0001"
}
```

Required project checks:

- `order_class=oco`.
- `side=sell` when protecting an existing long position.
- `type=limit`.
- `qty` is present and is a positive whole-share value.
- `notional` is not present.
- `take_profit.limit_price` is above current price.
- `stop_loss.stop_price` is below current price.
- `take_profit.limit_price > stop_loss.stop_price`.
- `stop_loss.stop_price` is at least `$0.01` below the base price constraints described by Alpaca.

## Nested Open Order Reconciliation

Alpaca documents that `GET /v2/orders?nested=true` nests child orders under `legs` for bracket order groups.
For OCO orders, the take-profit order appears as parent and stop-loss appears as child when nested.

The existing report-only reconciliation therefore remains correct in principle:

1. Fetch open orders with `nested=true`.
2. Flatten parent and `legs`.
3. Classify broker-side sell limit children as target protection.
4. Classify broker-side sell stop/stop-limit children as stop protection.
5. Report missing children, but do not auto-repair.

## Fixture Validator

Run:

```bash
npm run ops:alpaca:payload-fixtures
```

Inputs:

- `testdata/alpaca/bracket-entry-long.paper.fixture.json`
- `testdata/alpaca/oco-exit-long-repair.paper.fixture.json`

Outputs:

- `state/alpaca-order-payload-schema-report.json`
- `state/alpaca-order-payload-schema-report.md`
- `state/alpaca-oco-response-fixture-report.json`
- `state/alpaca-oco-response-fixture-report.md`
- `state/paper-oco-canary-candidate.json`
- `state/paper-oco-canary-candidate.md`
- `state/paper-oco-canary-approval-gate.json`
- `state/paper-oco-canary-approval-gate.md`

The validator is intentionally offline and report-only:

- no Alpaca endpoint calls,
- no order submission,
- no cancel/replace,
- no execution-ready rows.

## Future Repair Lane Preconditions

Before any actual repair submit lane is implemented, all of this must be true:

1. Paper fixture submit is tested manually in Alpaca paper and captured as a sanitized fixture.
2. The repair planner verifies current position qty immediately before submit.
3. The repair planner re-fetches `nested=true` open orders immediately before submit.
4. The repair planner blocks if any existing protective sell child is present.
5. The repair planner blocks if price has crossed planned stop or target.
6. A deterministic repair idempotency key is persisted before broker submission.
7. The execution approval gate is completed for the exact file/module/environment.
8. Defaults remain `EXEC_ENABLED=false` and `READ_ONLY=true`.

## OCO Paper Canary Runbook and Response Fixture

The future paper canary procedure is documented separately:

- `docs/ALPACA_OCO_PAPER_CANARY_RUNBOOK.md`

The expected sanitized nested response shape is validated by:

```bash
npm run ops:alpaca:oco-response-fixtures
```

Input:

- `testdata/alpaca/oco-repair-nested-open.paper-response.fixture.json`

The response fixture models the post-submit `GET /v2/orders?status=open&nested=true&symbols=<SYMBOL>` check, where the OCO take-profit order is the parent and the stop-loss order appears under `legs`.

The generic report-only canary target selector is:

```bash
npm run ops:paper-oco-canary
```

It scans all current guarded repair candidates, selects at most one lowest-notional `symbol + qty=1` candidate, and keeps `executionAllowed=false`. It must not be interpreted as a ticker-specific lane.

The non-mutating approval gate is:

```bash
npm run ops:paper-oco-gate
```

It validates the selected row against safety artifacts and still recommends `DO_NOT_SUBMIT` unless a separate broker-mutating task is explicitly approved.
