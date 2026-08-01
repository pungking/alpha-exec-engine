#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildBrokerRealizedPnlSummary,
  buildMarkdown,
  buildPublicDashboard,
} from "./build-performance-dashboard.mjs";

const ledgerState = (rows) => ({
  orders: Object.fromEntries(rows.map((row) => [row.key, {
    idempotencyKey: row.key,
    symbol: row.symbol,
    actionType: row.actionType,
    executionSide: row.side,
    submittedQty: row.qty,
    brokerOrderId: row.orderId,
    clientOrderId: `${row.orderId}-client`,
    status: "filled",
  }])),
});

const idempotencyState = (rows) => ({
  orders: Object.fromEntries(rows.map((row) => [row.key, {
    symbol: row.symbol,
    actionType: row.actionType,
    executionSide: row.side,
    submittedQty: row.qty,
    brokerOrderId: row.orderId,
    clientOrderId: `${row.orderId}-client`,
    brokerStatus: "filled",
  }])),
});

const brokerOrder = ({ orderId, symbol, side, qty, price, commission = "0", filledAt, legs }) => ({
  id: orderId,
  client_order_id: `${orderId}-client`,
  symbol,
  side,
  qty: String(qty),
  filled_qty: String(qty),
  filled_avg_price: String(price),
  commission,
  status: "filled",
  filled_at: filledAt,
  legs,
});

const build = ({ rows, orders, positions = [], paperMode = true }) => buildBrokerRealizedPnlSummary({
  orderLedger: ledgerState(rows),
  orderIdempotency: idempotencyState(rows),
  closedOrders: orders,
  currentPositions: positions,
  paperMode,
  closedOrdersSourceComplete: true,
  positionsSourceComplete: true,
});

const longRows = [
  { key: "long-entry", symbol: "LONGX", actionType: "ENTRY_NEW", side: "buy", qty: 2, orderId: "long-entry" },
  { key: "long-exit", symbol: "LONGX", actionType: "EXIT_FULL", side: "sell", qty: 2, orderId: "long-exit" },
];
const longOrders = [
  brokerOrder({ orderId: "long-entry", symbol: "LONGX", side: "buy", qty: 2, price: 100, commission: "0.25", filledAt: "2026-07-01T14:00:00Z" }),
  brokerOrder({ orderId: "long-exit", symbol: "LONGX", side: "sell", qty: 2, price: 110, commission: "0.25", filledAt: "2026-07-02T14:00:00Z" }),
];
longOrders[0].spreadCost = 50;
longOrders[1].slippageCost = 50;
const longResult = build({ rows: longRows, orders: longOrders });
assert.equal(longResult.rows[0].status, "VERIFIED_NET_REALIZED_PNL");
assert.equal(longResult.rows[0].direction, "long");
assert.equal(longResult.rows[0].actualFillGrossPnl, 20);
assert.equal(longResult.rows[0].explicitBrokerFees, 0.5);
assert.equal(longResult.rows[0].brokerNetRealizedPnl, 19.5);
assert.equal(longResult.rows[0].spreadAttribution, null);
assert.equal(longResult.rows[0].slippageAttribution, null);
assert.equal(longResult.rows[0].costDoubleCountViolation, false);

const multiRows = [
  { key: "multi-entry-a", symbol: "MULTIX", actionType: "ENTRY_NEW", side: "buy", qty: 1, orderId: "multi-entry-a" },
  { key: "multi-entry-b", symbol: "MULTIX", actionType: "SCALE_UP", side: "buy", qty: 1, orderId: "multi-entry-b" },
  { key: "multi-exit", symbol: "MULTIX", actionType: "EXIT_FULL", side: "sell", qty: 2, orderId: "multi-exit" },
];
const multiResult = build({
  rows: multiRows,
  orders: [
    brokerOrder({ orderId: "multi-entry-a", symbol: "MULTIX", side: "buy", qty: 1, price: 99, filledAt: "2026-07-01T14:00:00Z" }),
    brokerOrder({ orderId: "multi-entry-b", symbol: "MULTIX", side: "buy", qty: 1, price: 101, filledAt: "2026-07-01T15:00:00Z" }),
    brokerOrder({ orderId: "multi-exit", symbol: "MULTIX", side: "sell", qty: 2, price: 110, filledAt: "2026-07-02T14:00:00Z" }),
  ],
});
assert.equal(multiResult.rows[0].weightedEntryFillPrice, 100);
assert.equal(multiResult.rows[0].weightedExitFillPrice, 110);
assert.equal(multiResult.rows[0].actualFillGrossPnl, 20);

const partialRows = [
  { key: "partial-entry", symbol: "PARTX", actionType: "ENTRY_NEW", side: "buy", qty: 4, orderId: "partial-entry" },
  { key: "partial-exit", symbol: "PARTX", actionType: "EXIT_PARTIAL", side: "sell", qty: 2, orderId: "partial-exit" },
];
const partialResult = build({
  rows: partialRows,
  orders: [
    brokerOrder({ orderId: "partial-entry", symbol: "PARTX", side: "buy", qty: 4, price: 100, commission: "0.4", filledAt: "2026-07-01T14:00:00Z" }),
    brokerOrder({ orderId: "partial-exit", symbol: "PARTX", side: "sell", qty: 2, price: 110, commission: "0.2", filledAt: "2026-07-02T14:00:00Z" }),
  ],
  positions: [{ symbol: "PARTX", qty: "2" }],
});
assert.equal(partialResult.rows[0].status, "PARTIAL_EXIT_PNL_ONLY");
assert.equal(partialResult.rows[0].terminalExit, false);
assert.equal(partialResult.rows[0].matchedQuantity, 2);
assert.equal(partialResult.rows[0].explicitBrokerFees, 0.4);

const shortRows = [
  { key: "short-entry", symbol: "SHORTX", actionType: "ENTRY_NEW", side: "sell", qty: 2, orderId: "short-entry" },
  { key: "short-exit", symbol: "SHORTX", actionType: "EXIT_FULL", side: "buy", qty: 2, orderId: "short-exit" },
];
const shortResult = build({
  rows: shortRows,
  orders: [
    brokerOrder({ orderId: "short-entry", symbol: "SHORTX", side: "sell", qty: 2, price: 100, filledAt: "2026-07-01T14:00:00Z" }),
    brokerOrder({ orderId: "short-exit", symbol: "SHORTX", side: "buy", qty: 2, price: 90, filledAt: "2026-07-02T14:00:00Z" }),
  ],
});
assert.equal(shortResult.rows[0].direction, "short");
assert.equal(shortResult.rows[0].actualFillGrossPnl, 20);

const nestedResult = build({
  rows: [{ key: "nested-entry", symbol: "NESTX", actionType: "ENTRY_NEW", side: "buy", qty: 2, orderId: "nested-root" }],
  orders: [brokerOrder({
    orderId: "nested-root",
    symbol: "NESTX",
    side: "buy",
    qty: 2,
    price: 100,
    commission: "0.1",
    filledAt: "2026-07-01T14:00:00Z",
    legs: [brokerOrder({ orderId: "nested-target", symbol: "NESTX", side: "sell", qty: 2, price: 110, commission: "0.1", filledAt: "2026-07-02T14:00:00Z" })],
  })],
});
assert.equal(nestedResult.rows[0].status, "VERIFIED_NET_REALIZED_PNL");
assert.equal(nestedResult.rows[0].brokerNetRealizedPnl, 19.8);

const feeMissing = JSON.parse(JSON.stringify(longOrders));
delete feeMissing[0].commission;
delete feeMissing[1].commission;
const feeMissingResult = build({ rows: longRows, orders: feeMissing, paperMode: false });
assert.equal(feeMissingResult.rows[0].status, "FEE_EVIDENCE_INCOMPLETE");
assert.equal(feeMissingResult.rows[0].brokerNetRealizedPnl, null);

const quantityMismatch = JSON.parse(JSON.stringify(longOrders));
quantityMismatch[1].filled_qty = "1";
const quantityMismatchResult = build({ rows: longRows, orders: quantityMismatch });
assert.equal(quantityMismatchResult.rows[0].status, "MATCHED_QUANTITY_MISMATCH");

const idempotencyConflict = idempotencyState(longRows);
idempotencyConflict.orders["long-exit"].brokerOrderId = "different-exit-id";
const idempotencyConflictResult = buildBrokerRealizedPnlSummary({
  orderLedger: ledgerState(longRows),
  orderIdempotency: idempotencyConflict,
  closedOrders: longOrders,
  currentPositions: [],
  paperMode: true,
  closedOrdersSourceComplete: true,
  positionsSourceComplete: true,
});
assert.equal(idempotencyConflictResult.rows[0].status, "TERMINAL_RECONCILIATION_REQUIRED");

const missingIdempotencyResult = buildBrokerRealizedPnlSummary({
  orderLedger: ledgerState(longRows),
  orderIdempotency: { orders: {} },
  closedOrders: longOrders,
  currentPositions: [],
  paperMode: true,
  closedOrdersSourceComplete: true,
  positionsSourceComplete: true,
});
assert.equal(missingIdempotencyResult.rows[0].idempotencyVerdict, "MISSING");
assert.equal(missingIdempotencyResult.rows[0].status, "TERMINAL_RECONCILIATION_REQUIRED");

const releasedIdempotency = idempotencyState(longRows);
releasedIdempotency.releases = Object.entries(releasedIdempotency.orders).map(([key, row]) => ({ key, ...row }));
releasedIdempotency.orders = {};
const releasedIdempotencyResult = buildBrokerRealizedPnlSummary({
  orderLedger: ledgerState(longRows),
  orderIdempotency: releasedIdempotency,
  closedOrders: longOrders,
  currentPositions: [],
  paperMode: true,
  closedOrdersSourceComplete: true,
  positionsSourceComplete: true,
});
assert.equal(releasedIdempotencyResult.rows[0].idempotencyVerdict, "PASS");
assert.equal(releasedIdempotencyResult.rows[0].status, "VERIFIED_NET_REALIZED_PNL");

const entryOnlyResult = build({ rows: [longRows[0]], orders: [longOrders[0]] });
assert.equal(entryOnlyResult.rows[0].status, "EXIT_FILL_EVIDENCE_INCOMPLETE");
const exitOnlyResult = build({ rows: [longRows[1]], orders: [longOrders[1]] });
assert.equal(exitOnlyResult.rows[0].status, "ENTRY_FILL_EVIDENCE_INCOMPLETE");

const renamedRows = longRows.map((row) => ({ ...row, symbol: "RENAMEDX" }));
const renamedOrders = longOrders.map((row) => ({ ...row, symbol: "RENAMEDX" }));
const renamedResult = build({ rows: renamedRows, orders: renamedOrders });
assert.deepEqual(renamedResult.summary, longResult.summary);
assert.deepEqual(build({ rows: longRows, orders: longOrders }), longResult);
const allowedStatuses = new Set([
  "VERIFIED_NET_REALIZED_PNL",
  "PARTIAL_EXIT_PNL_ONLY",
  "EXIT_FILL_EVIDENCE_INCOMPLETE",
  "ENTRY_FILL_EVIDENCE_INCOMPLETE",
  "MATCHED_QUANTITY_MISMATCH",
  "FEE_EVIDENCE_INCOMPLETE",
  "REALIZED_PNL_COST_MISMATCH",
  "TERMINAL_RECONCILIATION_REQUIRED",
  "SIMULATION_OR_PROXY_ONLY",
]);
for (const report of [longResult, multiResult, partialResult, shortResult, nestedResult, feeMissingResult, quantityMismatchResult, idempotencyConflictResult, missingIdempotencyResult, releasedIdempotencyResult, entryOnlyResult, exitOnlyResult]) {
  assert.equal(report.summary.unknownRows, 0);
  for (const row of report.rows) assert.ok(allowedStatuses.has(row.status), `unexpected status ${row.status}`);
}

const markdown = buildMarkdown({
  generatedAt: "2026-07-02T15:00:00Z",
  simulation: {
    totalRows: 0,
    filledRows: 0,
    openRows: 0,
    closedRows: 0,
    winRatePct: null,
    avgClosedR: null,
    avgClosedReturnPct: null,
    topWinners: [],
    topLosers: [],
    latestSnapshot: null,
    latestSnapshotTradeCount: null,
    rowVsSnapshotGap: null,
    snapshotCoveragePct: null,
  },
  live: {
    available: true,
    account: { equity: 100000 },
    totals: {
      positionCount: 1,
      totalUnrealizedPl: 123,
      totalReturnPct: 4.5,
      openOrderNested: 0,
      openOrderRawCount: 0,
      openOrderFlattenedCount: 0,
      brokerStopMissingCount: 0,
      brokerTargetMissingCount: 0,
      guardMissingCount: 0,
      fillStateMismatchCount: 0,
    },
    positions: [{ symbol: "PRIVATE", qty: 3, currentPrice: 101, unrealizedPl: 123, unrealizedPlPct: 4.5 }],
  },
  realizedPnl: longResult,
});
assert.doesNotMatch(markdown, /PRIVATE|qty=|equity=|uPnL|100000|123/);
assert.match(markdown, /realized_pnl:.*verified=1/);
const publicDashboard = JSON.stringify(buildPublicDashboard({
  generatedAt: "2026-07-02T15:00:00Z",
  simulation: { totalRows: 0, filledRows: 0, openRows: 0, closedRows: 0 },
  live: { available: true, account: { accountNumber: "PRIVATE" }, totals: { positionCount: 1, totalUnrealizedPl: 123 }, positions: [{ symbol: "PRIVATE", qty: 3 }] },
  realizedPnl: longResult,
}));
assert.doesNotMatch(publicDashboard, /PRIVATE|100000|123|"matchedQuantity":|brokerNetRealizedPnl/);

console.log("[PAPER_REALIZED_PNL_CONTRACT_TEST] pass");
