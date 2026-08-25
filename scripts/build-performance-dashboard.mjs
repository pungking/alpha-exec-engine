import fs from "node:fs";
import { pathToFileURL } from "node:url";

const STATE_DIR = "state";
const LOOP_PATH = `${STATE_DIR}/stage6-20trade-loop.json`;
const ORDER_LEDGER_PATH = `${STATE_DIR}/order-ledger.json`;
const ORDER_IDEMPOTENCY_PATH = `${STATE_DIR}/order-idempotency.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const OUTPUT_JSON = `${STATE_DIR}/performance-dashboard.json`;
const OUTPUT_PUBLIC_JSON = `${STATE_DIR}/performance-dashboard-public.json`;
const OUTPUT_MD = `${STATE_DIR}/performance-dashboard.md`;

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const writeTextAtomic = (path, text) => {
  const tmpPath = `${path}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, path);
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toIso = (value) => {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
};

const short = (value, max = 500) => String(value ?? "").trim().slice(0, max);

const redactAccountNumber = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const tail = text.slice(-4);
  return `****${tail}`;
};

const sortByIso = (rows, key) =>
  [...rows].sort((a, b) => {
    const ax = Date.parse(a?.[key] || "");
    const bx = Date.parse(b?.[key] || "");
    if (!Number.isFinite(ax) && !Number.isFinite(bx)) return 0;
    if (!Number.isFinite(ax)) return 1;
    if (!Number.isFinite(bx)) return -1;
    return ax - bx;
  });

const latestIso = (...values) => {
  const timestamps = values
    .map((value) => Date.parse(value || ""))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length === 0) return "";
  return new Date(Math.max(...timestamps)).toISOString();
};

const normalizeLoopRows = (loop) => {
  const rowsMap = loop && typeof loop.rows === "object" ? loop.rows : {};
  return Object.values(rowsMap).map((raw) => {
    const runDate = toIso(raw?.runDate);
    const symbol = String(raw?.symbol || "").toUpperCase() || "N/A";
    const entryPlanned = toNum(raw?.entryPlanned);
    const entryFilled = toNum(raw?.entryFilled);
    const stopPlanned = toNum(raw?.stopPlanned);
    const targetPlanned = toNum(raw?.targetPlanned);
    const exitPrice = toNum(raw?.exitPrice);
    const rMultiple = toNum(raw?.RMultiple);
    const holdDaysPlanned = toNum(raw?.holdDaysPlanned);
    const holdDaysActual = toNum(raw?.holdDaysActual);
    const decisionReason = short(raw?.decisionReason || "N/A", 120);

    let status = "planned";
    if (exitPrice != null) status = "closed";
    else if (entryFilled != null) status = "open";

    const entryRef = entryFilled ?? entryPlanned;
    const returnPct = entryRef != null && exitPrice != null && entryRef > 0 ? ((exitPrice - entryRef) / entryRef) * 100 : null;
    const pnlPerUnit = entryRef != null && exitPrice != null ? exitPrice - entryRef : null;

    return {
      runDate,
      symbol,
      status,
      decisionReason,
      entryPlanned,
      entryFilled,
      stopPlanned,
      targetPlanned,
      exitPrice,
      holdDaysPlanned,
      holdDaysActual,
      rMultiple,
      returnPct,
      pnlPerUnit,
      notes: short(raw?.notes || "", 400)
    };
  });
};

const buildSimulationSummary = (loop) => {
  const rows = sortByIso(normalizeLoopRows(loop), "runDate");
  const snapshots = sortByIso(Array.isArray(loop?.snapshots) ? loop.snapshots : [], "at").map((snap) => ({
    at: toIso(snap?.at),
    tradeCount: toNum(snap?.tradeCount) ?? 0,
    filledCount: toNum(snap?.filledCount) ?? 0,
    closedCount: toNum(snap?.closedCount) ?? 0,
    fillRatePct: toNum(snap?.fillRatePct),
    avgR: toNum(snap?.avgR),
    medianHoldErrorDays: toNum(snap?.medianHoldErrorDays),
    noReasonDrift: toNum(snap?.noReasonDrift),
    kpiSource:
      typeof snap?.kpiSource === "string" && snap.kpiSource.trim()
        ? snap.kpiSource
        : "none"
  }));

  const bySymbol = new Map();
  for (const row of rows) {
    const current = bySymbol.get(row.symbol) || {
      symbol: row.symbol,
      total: 0,
      planned: 0,
      open: 0,
      closed: 0,
      latestRunDate: row.runDate,
      latest: row,
      closedReturns: [],
      closedR: []
    };
    current.total += 1;
    if (row.status === "planned") current.planned += 1;
    if (row.status === "open") current.open += 1;
    if (row.status === "closed") current.closed += 1;
    if (Date.parse(row.runDate) >= Date.parse(current.latestRunDate)) {
      current.latestRunDate = row.runDate;
      current.latest = row;
    }
    if (row.returnPct != null) current.closedReturns.push(row.returnPct);
    if (row.rMultiple != null) current.closedR.push(row.rMultiple);
    bySymbol.set(row.symbol, current);
  }

  const perSymbol = [...bySymbol.values()].map((item) => {
    const avgReturnPct =
      item.closedReturns.length > 0
        ? item.closedReturns.reduce((a, b) => a + b, 0) / item.closedReturns.length
        : null;
    const avgR = item.closedR.length > 0 ? item.closedR.reduce((a, b) => a + b, 0) / item.closedR.length : null;
    return {
      symbol: item.symbol,
      totalTrades: item.total,
      plannedTrades: item.planned,
      openTrades: item.open,
      closedTrades: item.closed,
      avgReturnPct,
      avgR,
      latestRunDate: item.latestRunDate,
      latest: item.latest
    };
  });

  const closedRows = rows.filter((row) => row.status === "closed");
  const wins = closedRows.filter((row) => (row.returnPct ?? -999) > 0).length;
  const losses = closedRows.filter((row) => (row.returnPct ?? 999) < 0).length;
  const avgClosedReturnPct =
    closedRows.length > 0
      ? closedRows.reduce((acc, row) => acc + (row.returnPct || 0), 0) / closedRows.length
      : null;
  const avgClosedR =
    closedRows.filter((row) => row.rMultiple != null).length > 0
      ? closedRows.reduce((acc, row) => acc + (row.rMultiple || 0), 0) /
      closedRows.filter((row) => row.rMultiple != null).length
      : null;

  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const latestSnapshotTradeCount =
    latestSnapshot && Number.isFinite(latestSnapshot.tradeCount) ? latestSnapshot.tradeCount : null;
  const rowVsSnapshotGap =
    latestSnapshotTradeCount != null ? rows.length - latestSnapshotTradeCount : null;
  const snapshotCoveragePct =
    latestSnapshotTradeCount != null && rows.length > 0 ? (latestSnapshotTradeCount / rows.length) * 100 : null;
  const topByReturn = [...perSymbol]
    .filter((row) => row.avgReturnPct != null)
    .sort((a, b) => (b.avgReturnPct || 0) - (a.avgReturnPct || 0));

  return {
    batchId: loop?.batchId || "N/A",
    updatedAt: toIso(loop?.updatedAt || Date.now()),
    totalRows: rows.length,
    filledRows: rows.filter((row) => row.entryFilled != null).length,
    openRows: rows.filter((row) => row.status === "open").length,
    closedRows: closedRows.length,
    wins,
    losses,
    winRatePct: closedRows.length > 0 ? (wins / closedRows.length) * 100 : null,
    avgClosedReturnPct,
    avgClosedR,
    latestSnapshot,
    latestSnapshotTradeCount,
    rowVsSnapshotGap,
    snapshotCoveragePct,
    chartSeries: snapshots,
    rows,
    perSymbol,
    topWinners: topByReturn.slice(0, 5),
    topLosers: [...topByReturn].reverse().slice(0, 5)
  };
};

const alpacaHeaders = () => ({
  "APCA-API-KEY-ID": String(process.env.ALPACA_KEY_ID || "").trim(),
  "APCA-API-SECRET-KEY": String(process.env.ALPACA_SECRET_KEY || "").trim()
});

const fetchAlpaca = async (path) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const headers = alpacaHeaders();
  if (!baseUrl || !headers["APCA-API-KEY-ID"] || !headers["APCA-API-SECRET-KEY"]) {
    return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        reason: `alpaca_http_${response.status}`
      };
    }
    return { ok: true, status: response.status, data, reason: "ok" };
  } catch (error) {
    return { ok: false, status: null, data: null, reason: `alpaca_network:${short(error?.message || error, 160)}` };
  }
};

const normalizeFillState = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "filled") return "filled";
  if (text === "partially_filled" || text === "open_waiting" || text.startsWith("open_")) return "open";
  if (text === "submitted" || text === "accepted" || text === "idempotency_held") return "open";
  if (text === "canceled" || text === "cancelled") return "canceled";
  if (text === "expired") return "expired";
  if (text === "rejected") return "rejected";
  if (text === "terminal_unfilled") return "unfilled_terminal";
  return text;
};

const normalizeFillabilityState = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "filled") return "filled";
  if (text.startsWith("open_")) return "open";
  if (text === "terminal_unfilled") return "unfilled_terminal";
  if (text === "idempotency_held") return "open";
  if (text === "payload_ready_no_broker_match") return "planned";
  if (text === "no_active_order" || text.startsWith("blocked_")) return null;
  return normalizeFillState(text);
};

const TERMINAL_ORDER_STATUSES = new Set(["filled", "canceled", "cancelled", "expired", "rejected"]);

const flattenAlpacaOrders = (orders, depth = 0, root = null, parent = null) => {
  const out = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== "object") continue;
    const rootOrder = root || order;
    out.push({
      ...order,
      _nestedDepth: depth,
      _rootOrderId: rootOrder?.id || null,
      _rootClientOrderId: rootOrder?.client_order_id || null,
      _parentOrderId: parent?.id || null
    });
    if (Array.isArray(order.legs)) {
      out.push(...flattenAlpacaOrders(order.legs, depth + 1, rootOrder, order));
    }
  }
  return out;
};

const isActiveBrokerOrderStatus = (status) => {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return !TERMINAL_ORDER_STATUSES.has(normalized);
};

const buildBrokerProtectionBySymbol = (openOrders) => {
  const flattenedOrders = flattenAlpacaOrders(openOrders);
  const bySymbol = new Map();
  for (const order of flattenedOrders) {
    const symbol = String(order?.symbol || "").toUpperCase();
    const side = String(order?.side || "").toLowerCase();
    if (!symbol || side !== "sell" || !isActiveBrokerOrderStatus(order?.status)) continue;
    const type = String(order?.type || "").toLowerCase();
    const orderClass = String(order?.order_class || "").toLowerCase();
    const stop = toNum(order?.stop_price);
    const limit = toNum(order?.limit_price);
    const id = short(order?.id || order?.client_order_id || "", 80) || null;
    const current = bySymbol.get(symbol) || {
      stopPrice: null,
      targetPrice: null,
      stopPresent: false,
      targetPresent: false,
      stopOrderIds: [],
      targetOrderIds: [],
      sellOrderCount: 0,
      nestedSellOrderCount: 0,
      sourceTypes: []
    };
    current.sellOrderCount += 1;
    if ((order?._nestedDepth || 0) > 0) current.nestedSellOrderCount += 1;
    current.sourceTypes.push(`${type || "unknown"}:${orderClass || "n/a"}`);
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop" || stop != null) {
      current.stopPresent = true;
      current.stopPrice = stop ?? current.stopPrice;
      if (id) current.stopOrderIds.push(id);
    }
    if (type === "limit" && limit != null) {
      current.targetPresent = true;
      current.targetPrice = limit;
      if (id) current.targetOrderIds.push(id);
    }
    bySymbol.set(symbol, current);
  }
  return { bySymbol, flattenedOrders };
};

const buildStatusBySymbol = () => {
  const ledger = readJson(ORDER_LEDGER_PATH) || {};
  const idempotency = readJson(ORDER_IDEMPOTENCY_PATH) || {};
  const fillability = readJson(FILLABILITY_PATH) || {};
  const bySymbol = new Map();

  const merge = (symbol, patch) => {
    if (!symbol) return;
    const current = bySymbol.get(symbol) || { symbol };
    bySymbol.set(symbol, {
      ...current,
      ...patch,
      observedAt: latestIso(current.observedAt, patch.observedAt)
    });
  };

  for (const row of Object.values(ledger?.orders || {})) {
    const symbol = String(row?.symbol || "").toUpperCase();
    merge(symbol, {
      ledgerStatus: row?.status || null,
      ledgerReason: row?.statusReason || null,
      plannedLimitPrice: toNum(row?.limitPrice),
      plannedTargetPrice: toNum(row?.takeProfitPrice),
      plannedStopPrice: toNum(row?.stopLossPrice),
      plannedStopSource: toNum(row?.stopLossPrice) != null ? "order_ledger" : null,
      plannedTargetSource: toNum(row?.takeProfitPrice) != null ? "order_ledger" : null,
      plannedStage6Hash: row?.stage6Hash || null,
      plannedStage6File: row?.stage6File || null,
      plannedLedgerKey: row?.idempotencyKey || null,
      ledgerUpdatedAt: row?.updatedAt || null,
      observedAt: row?.updatedAt || row?.createdAt || null
    });
  }

  for (const row of Object.values(idempotency?.orders || {})) {
    const symbol = String(row?.symbol || "").toUpperCase();
    merge(symbol, {
      idempotencyBrokerStatus: row?.brokerStatus || null,
      idempotencyBrokerCheckedAt: row?.brokerCheckedAt || null,
      observedAt: row?.brokerCheckedAt || row?.lastSeenAt || row?.firstSeenAt || null
    });
  }

  for (const row of Array.isArray(fillability?.rows) ? fillability.rows : []) {
    const symbol = String(row?.symbol || "").toUpperCase();
    merge(symbol, {
      fillabilityStatus: row?.status || null,
      fillabilityReason: row?.reason || null,
      fillQty: toNum(row?.fillQty),
      avgFillPrice: toNum(row?.avgFillPrice),
      observedAt: fillability?.generatedAt || null
    });
  }

  for (const [symbol, row] of bySymbol) {
    const normalized = [
      normalizeFillState(row.ledgerStatus),
      normalizeFillState(row.idempotencyBrokerStatus),
      normalizeFillabilityState(row.fillabilityStatus)
    ].filter(Boolean);
    const unique = [...new Set(normalized)];
    bySymbol.set(symbol, {
      ...row,
      normalizedFillState: unique.length === 1 ? unique[0] : unique.length > 1 ? "mixed" : null,
      fillStateConsistent: unique.length > 1 ? false : unique.length === 1 ? true : null
    });
  }

  return bySymbol;
};

const stateOrderEntries = (state) => {
  const orders = state?.orders;
  if (Array.isArray(orders)) return orders.map((row, index) => [String(index), row]);
  return orders && typeof orders === "object" ? Object.entries(orders) : [];
};

const orderStatusClass = (value) => {
  const status = String(value || "").trim().toLowerCase();
  if (status === "filled") return "filled";
  if (["new", "accepted", "pending_new", "partially_filled", "submitted"].includes(status)) return "open";
  if (["canceled", "cancelled", "expired", "rejected"].includes(status)) return "terminal_unfilled";
  return status || null;
};

const buildOwnedOrderIndex = (orderLedger, orderIdempotency) => {
  const groups = new Map();
  const add = (source, key, row) => {
    if (!row || typeof row !== "object") return;
    const groupKey = String(row.idempotencyKey || key || "").trim();
    if (!groupKey) return;
    const group = groups.get(groupKey) || { key: groupKey, ledger: null, idempotency: null };
    group[source] = row;
    groups.set(groupKey, group);
  };
  for (const [key, row] of stateOrderEntries(orderLedger)) add("ledger", key, row);
  for (const [key, row] of stateOrderEntries(orderIdempotency)) add("idempotency", key, row);
  for (const row of Array.isArray(orderIdempotency?.releases) ? orderIdempotency.releases : []) {
    const key = String(row?.key || row?.idempotencyKey || "").trim();
    const existing = groups.get(key);
    if (!existing?.idempotency) add("idempotency", key, row);
  }

  const byBrokerId = new Map();
  const byClientId = new Map();
  for (const group of groups.values()) {
    const rows = [group.ledger, group.idempotency].filter(Boolean);
    const brokerIds = [...new Set(rows.map((row) => String(row?.brokerOrderId || "").trim()).filter(Boolean))];
    const clientIds = [...new Set(rows.map((row) => String(row?.clientOrderId || "").trim()).filter(Boolean))];
    const statusClasses = [...new Set(rows.map((row) => orderStatusClass(row?.brokerStatus || row?.status)).filter(Boolean))];
    const quantityRow = rows.find((row) => toNum(row?.submittedQty ?? row?.qty) != null);
    const limitedRecoveryEvidence = group.idempotency?.recoveryMode === "ACTIVE_POSITION_LIMITED_CONTROL";
    const meta = {
      key: group.key,
      symbol: String(rows.find((row) => row?.symbol)?.symbol || "").trim().toUpperCase(),
      actionType: String(rows.find((row) => row?.actionType)?.actionType || "").trim().toUpperCase() || null,
      executionSide: String(rows.find((row) => row?.executionSide)?.executionSide || "").trim().toLowerCase() || null,
      submittedQty: toNum(quantityRow?.submittedQty ?? quantityRow?.qty),
      ledgerEvidencePresent: Boolean(group.ledger),
      idempotencyEvidencePresent: Boolean(group.idempotency),
      idempotencyConflict: brokerIds.length > 1 || statusClasses.length > 1,
      limitedRecoveryEvidence,
    };
    for (const id of brokerIds) byBrokerId.set(id, meta);
    for (const id of clientIds) byClientId.set(id, meta);
  }
  return { byBrokerId, byClientId };
};

const roundMoney = (value) => value == null ? null : Number(value.toFixed(8));
const QTY_TOLERANCE = 1e-8;

const matchOwnedOrder = (order, owned) => {
  const direct = owned.byBrokerId.get(String(order?.id || "").trim())
    || owned.byClientId.get(String(order?.client_order_id || "").trim())
    || null;
  const root = owned.byBrokerId.get(String(order?._rootOrderId || "").trim())
    || owned.byClientId.get(String(order?._rootClientOrderId || "").trim())
    || null;
  return { meta: direct || root, direct: Boolean(direct) };
};

const normalizeOwnedFills = ({ closedOrders, owned, paperMode }) => {
  const deduped = new Map();
  for (const order of flattenAlpacaOrders(closedOrders)) {
    const key = String(order?.id || order?.client_order_id || [order?.symbol, order?.side, order?.filled_at].join(":"));
    const prior = deduped.get(key);
    if (!prior || (order?._nestedDepth || 0) > (prior?._nestedDepth || 0)) deduped.set(key, order);
  }

  return [...deduped.values()].flatMap((order) => {
    const orderKey = String(order?.id || order?.client_order_id || [order?.symbol, order?.side, order?.filled_at].join(":"));
    const ownership = matchOwnedOrder(order, owned);
    if (!ownership.meta || String(order?.status || "").toLowerCase() !== "filled") return [];
    const symbol = String(order?.symbol || ownership.meta.symbol || "").trim().toUpperCase();
    const side = String(order?.side || "").trim().toLowerCase();
    const quantity = toNum(order?.filled_qty);
    const price = toNum(order?.filled_avg_price);
    if (!symbol || !["buy", "sell"].includes(side) || quantity == null || quantity <= 0 || price == null || price <= 0) return [];
    const commissionPresent = Object.prototype.hasOwnProperty.call(order, "commission") && toNum(order.commission) != null;
    const explicitFee = commissionPresent ? Math.max(0, toNum(order.commission)) : paperMode ? 0 : null;
    const submittedQty = ownership.direct ? ownership.meta.submittedQty : null;
    const orderQty = toNum(order?.qty);
    return [{
      symbol,
      side,
      quantity,
      price,
      filledAt: order?.filled_at || order?.updated_at || order?.submitted_at || null,
      orderKey,
      feePerUnit: explicitFee == null ? null : explicitFee / quantity,
      feeEvidenceComplete: commissionPresent || paperMode,
      feeEvidenceStatus: commissionPresent ? "EXPLICIT_BROKER_FEE" : paperMode ? "PAPER_PLATFORM_COSTS_NOT_MODELED" : "FEE_EVIDENCE_INCOMPLETE",
      ledgerEvidencePresent: ownership.meta.ledgerEvidencePresent,
      idempotencyEvidencePresent: ownership.meta.idempotencyEvidencePresent,
      idempotencyConflict: ownership.meta.idempotencyConflict,
      limitedRecoveryEvidence: ownership.meta.limitedRecoveryEvidence,
      submittedQuantityMismatch: submittedQty != null && Math.abs(Math.abs(submittedQty) - quantity) > QTY_TOLERANCE,
      brokerOrderQuantityMismatch: orderQty != null && Math.abs(Math.abs(orderQty) - quantity) > QTY_TOLERANCE,
      actionType: ownership.meta.actionType
    }];
  }).sort((a, b) => {
    const timeGap = Date.parse(a.filledAt || "") - Date.parse(b.filledAt || "");
    return Number.isFinite(timeGap) && timeGap !== 0 ? timeGap : a.orderKey.localeCompare(b.orderKey);
  });
};

const matchFillsFifo = (fills) => {
  const longLots = [];
  const shortLots = [];
  const matches = [];
  const consume = (lots, fill, direction) => {
    let remaining = fill.quantity;
    while (remaining > QTY_TOLERANCE && lots.length > 0) {
      const lot = lots[0];
      const quantity = Math.min(remaining, lot.quantity);
      matches.push({
        direction,
        quantity,
        entryPrice: lot.price,
        exitPrice: fill.price,
        entryFeePerUnit: lot.feePerUnit,
        exitFeePerUnit: fill.feePerUnit,
        feeEvidenceComplete: lot.feeEvidenceComplete && fill.feeEvidenceComplete,
        entryOrderKey: lot.orderKey,
        exitOrderKey: fill.orderKey
      });
      lot.quantity -= quantity;
      remaining -= quantity;
      if (lot.quantity <= QTY_TOLERANCE) lots.shift();
    }
    return remaining;
  };

  for (const fill of fills) {
    if (fill.side === "buy") {
      const remaining = consume(shortLots, fill, "short");
      if (remaining > QTY_TOLERANCE) longLots.push({ ...fill, quantity: remaining });
    } else {
      const remaining = consume(longLots, fill, "long");
      if (remaining > QTY_TOLERANCE) shortLots.push({ ...fill, quantity: remaining });
    }
  }
  return { longLots, shortLots, matches };
};

export const buildBrokerRealizedPnlSummary = ({
  orderLedger,
  orderIdempotency,
  closedOrders,
  currentPositions = [],
  paperMode,
  closedOrdersSourceComplete,
  positionsSourceComplete
}) => {
  const owned = buildOwnedOrderIndex(orderLedger, orderIdempotency);
  const fills = normalizeOwnedFills({ closedOrders, owned, paperMode });
  const positionsBySymbol = new Map((Array.isArray(currentPositions) ? currentPositions : []).map((row) => [
    String(row?.symbol || "").trim().toUpperCase(),
    toNum(row?.qty ?? row?.quantity) ?? 0
  ]));
  const bySymbol = new Map();
  for (const fill of fills) {
    const rows = bySymbol.get(fill.symbol) || [];
    rows.push(fill);
    bySymbol.set(fill.symbol, rows);
  }

  const rows = [...bySymbol.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, symbolFills]) => {
    const { longLots, shortLots, matches } = matchFillsFifo(symbolFills);
    const matchedQuantity = matches.reduce((sum, match) => sum + match.quantity, 0);
    const actualFillGrossPnl = matches.reduce((sum, match) => sum + (
      match.direction === "short"
        ? (match.entryPrice - match.exitPrice) * match.quantity
        : (match.exitPrice - match.entryPrice) * match.quantity
    ), 0);
    const feeEvidenceComplete = matches.length > 0 && matches.every((match) => match.feeEvidenceComplete);
    const explicitBrokerFees = feeEvidenceComplete
      ? matches.reduce((sum, match) => sum + (match.entryFeePerUnit + match.exitFeePerUnit) * match.quantity, 0)
      : null;
    const weightedEntryFillPrice = matchedQuantity > 0
      ? matches.reduce((sum, match) => sum + match.entryPrice * match.quantity, 0) / matchedQuantity
      : null;
    const weightedExitFillPrice = matchedQuantity > 0
      ? matches.reduce((sum, match) => sum + match.exitPrice * match.quantity, 0) / matchedQuantity
      : null;
    const fillResidual = longLots.reduce((sum, lot) => sum + lot.quantity, 0)
      - shortLots.reduce((sum, lot) => sum + lot.quantity, 0);
    const brokerResidual = positionsSourceComplete ? positionsBySymbol.get(symbol) ?? 0 : null;
    const quantityMismatch = symbolFills.some((fill) => fill.submittedQuantityMismatch || fill.brokerOrderQuantityMismatch)
      || (brokerResidual != null && Math.abs(fillResidual - brokerResidual) > QTY_TOLERANCE);
    const idempotencyConflict = symbolFills.some((fill) => fill.idempotencyConflict);
    const limitedRecoveryEvidence = symbolFills.some((fill) => fill.limitedRecoveryEvidence);
    const idempotencyEvidenceComplete = !limitedRecoveryEvidence
      && symbolFills.every((fill) => fill.ledgerEvidencePresent && fill.idempotencyEvidencePresent);
    const partialExit = Math.abs(fillResidual) > QTY_TOLERANCE || (brokerResidual != null && Math.abs(brokerResidual) > QTY_TOLERANCE);
    const directions = [...new Set(matches.map((match) => match.direction))];
    const hasExitAction = symbolFills.some((fill) => ["SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"].includes(fill.actionType));

    let status = "VERIFIED_NET_REALIZED_PNL";
    if (!closedOrdersSourceComplete || !positionsSourceComplete || idempotencyConflict || !idempotencyEvidenceComplete) status = "TERMINAL_RECONCILIATION_REQUIRED";
    else if (matches.length === 0) status = hasExitAction ? "ENTRY_FILL_EVIDENCE_INCOMPLETE" : "EXIT_FILL_EVIDENCE_INCOMPLETE";
    else if (quantityMismatch) status = "MATCHED_QUANTITY_MISMATCH";
    else if (directions.length > 1) status = "TERMINAL_RECONCILIATION_REQUIRED";
    else if (!feeEvidenceComplete) status = "FEE_EVIDENCE_INCOMPLETE";
    else if (partialExit) status = "PARTIAL_EXIT_PNL_ONLY";

    const brokerNetRealizedPnl = feeEvidenceComplete && matches.length > 0
      ? actualFillGrossPnl - explicitBrokerFees
      : null;
    const blocker = status === "VERIFIED_NET_REALIZED_PNL" || status === "PARTIAL_EXIT_PNL_ONLY"
      ? null
      : status.toLowerCase();
    return {
      symbol,
      status,
      sourceType: paperMode ? "ALPACA_PAPER_BROKER_FILLS" : "ALPACA_BROKER_FILLS",
      ownershipClassification: idempotencyEvidenceComplete ? "SIDECAR_LEDGER_AND_IDEMPOTENCY_MATCHED" : "SIDECAR_OWNERSHIP_EVIDENCE_INCOMPLETE",
      idempotencyVerdict: limitedRecoveryEvidence
        ? "LIMITED_RECOVERY_BLOCKED"
        : idempotencyConflict
          ? "CONFLICT"
          : idempotencyEvidenceComplete
            ? "PASS"
            : "MISSING",
      recoveryMode: limitedRecoveryEvidence ? "ACTIVE_POSITION_LIMITED_CONTROL" : null,
      realizedPnlVerified: !limitedRecoveryEvidence && status === "VERIFIED_NET_REALIZED_PNL",
      entryFillProvenance: matches.length > 0 ? "BROKER_FILLED_AVG_PRICE" : null,
      exitFillProvenance: matches.length > 0 ? "BROKER_FILLED_AVG_PRICE" : null,
      entryOrderIdsPresent: matches.length > 0,
      exitOrderIdsPresent: matches.length > 0,
      direction: directions.length === 1 ? directions[0] : directions.length > 1 ? "mixed" : null,
      matchedQuantity: roundMoney(matchedQuantity),
      weightedEntryFillPrice: roundMoney(weightedEntryFillPrice),
      weightedExitFillPrice: roundMoney(weightedExitFillPrice),
      residualSignedQuantity: roundMoney(brokerResidual ?? fillResidual),
      partialExit,
      terminalExit: matches.length > 0 && !partialExit && positionsSourceComplete && closedOrdersSourceComplete,
      actualPriceBasis: "BROKER_FILLED_AVG_PRICE",
      actualFillGrossPnl: matches.length > 0 ? roundMoney(actualFillGrossPnl) : null,
      explicitBrokerFees: roundMoney(explicitBrokerFees),
      brokerNetRealizedPnl: roundMoney(brokerNetRealizedPnl),
      feeEvidenceStatus: feeEvidenceComplete
        ? paperMode && symbolFills.some((fill) => fill.feeEvidenceStatus === "PAPER_PLATFORM_COSTS_NOT_MODELED")
          ? "PAPER_PLATFORM_COSTS_NOT_MODELED"
          : "EXPLICIT_BROKER_FEE"
        : "FEE_EVIDENCE_INCOMPLETE",
      referenceGrossPnl: null,
      spreadAttribution: null,
      slippageAttribution: null,
      implementationShortfall: null,
      reconciliationDifference: null,
      currency: "USD",
      roundingTolerance: 0.01,
      costDoubleCountViolation: false,
      grossFormulaVerdict: matches.length > 0 ? "PASS" : "NOT_APPLICABLE",
      netFormulaVerdict: brokerNetRealizedPnl != null ? "PASS_ACTUAL_GROSS_MINUS_EXPLICIT_FEES_ONLY" : "EVIDENCE_INCOMPLETE",
      blocker,
      nextAction: blocker ? "resolve_realized_pnl_evidence_before_closed_loop_readiness" : partialExit ? "retain_open_residual_lifecycle" : "no_action_report_only"
    };
  });

  const count = (status) => rows.filter((row) => row.status === status).length;
  const summary = {
    totalRows: rows.length,
    verifiedRows: count("VERIFIED_NET_REALIZED_PNL"),
    partialExitRows: count("PARTIAL_EXIT_PNL_ONLY"),
    exitFillEvidenceIncompleteRows: count("EXIT_FILL_EVIDENCE_INCOMPLETE"),
    entryFillEvidenceIncompleteRows: count("ENTRY_FILL_EVIDENCE_INCOMPLETE"),
    matchedQuantityMismatchRows: count("MATCHED_QUANTITY_MISMATCH"),
    feeEvidenceIncompleteRows: count("FEE_EVIDENCE_INCOMPLETE"),
    costMismatchRows: count("REALIZED_PNL_COST_MISMATCH"),
    terminalReconciliationRequiredRows: count("TERMINAL_RECONCILIATION_REQUIRED"),
    simulationOrProxyRows: count("SIMULATION_OR_PROXY_ONLY"),
    costDoubleCountViolationRows: rows.filter((row) => row.costDoubleCountViolation).length,
    unknownRows: 0
  };
  const producerReadyRows = summary.verifiedRows + summary.partialExitRows;
  return {
    contractVersion: "paper-realized-pnl-v1",
    reportOnly: true,
    status: rows.length === 0
      ? "REALIZED_PNL_PRODUCER_GAP"
      : producerReadyRows === rows.length
        ? "REALIZED_PNL_PRODUCER_READY"
        : "REALIZED_PNL_REVIEW_REQUIRED",
    paperMode,
    sourceContract: {
      closedOrdersSourceComplete: Boolean(closedOrdersSourceComplete),
      positionsSourceComplete: Boolean(positionsSourceComplete),
      actualPnlFormula: "fill_to_fill_gross_minus_explicit_broker_fees",
      spreadAndSlippageTreatment: "attribution_only_when_reference_evidence_exists"
    },
    summary,
    rows,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false
  };
};

const derivePositionStatus = ({
  qty,
  currentPrice,
  stopPrice,
  targetPrice,
  unrealizedPlPct,
  brokerStopMissing,
  brokerTargetMissing
}) => {
  if ((qty ?? 0) <= 0) return "NO_POSITION";
  if (currentPrice != null && stopPrice != null && currentPrice <= stopPrice) return "STOP_REVIEW";
  if (currentPrice != null && targetPrice != null && currentPrice >= targetPrice) return "TARGET_REVIEW";
  if (stopPrice == null && targetPrice == null) return "HOLD_MONITOR_GUARD_MISSING";
  if (stopPrice == null) return "HOLD_MONITOR_STOP_MISSING";
  if (brokerStopMissing) return "HOLD_MONITOR_BROKER_STOP_MISSING";
  if (brokerTargetMissing) return "HOLD_MONITOR_BROKER_TARGET_MISSING";
  if (targetPrice == null) return "HOLD_MONITOR_TARGET_MISSING";
  if (unrealizedPlPct != null && unrealizedPlPct <= -3) return "HOLD_MONITOR_DRAWDOWN_WATCH";
  return "HOLD_MONITOR";
};

const buildLiveSummary = async () => {
  const accountRes = await fetchAlpaca("/v2/account");
  const positionsRes = await fetchAlpaca("/v2/positions");
  const ordersRes = await fetchAlpaca("/v2/orders?status=open&nested=true&direction=desc&limit=500");

  if (!accountRes.ok || !positionsRes.ok || !ordersRes.ok) {
    return {
      available: false,
      reason: [accountRes.reason, positionsRes.reason, ordersRes.reason].join("|")
    };
  }

  const account = accountRes.data && typeof accountRes.data === "object" ? accountRes.data : {};
  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : [];
  const openOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  const statusBySymbol = buildStatusBySymbol();
  const brokerProtection = buildBrokerProtectionBySymbol(openOrders);
  const orderBySymbol = brokerProtection.bySymbol;

  const normalizedPositions = positions.map((pos) => {
    const symbol = String(pos?.symbol || "").toUpperCase();
    const qty = toNum(pos?.qty) ?? 0;
    const avgEntry = toNum(pos?.avg_entry_price);
    const currentPrice = toNum(pos?.current_price);
    const marketValue = currentPrice != null ? qty * currentPrice : null;
    const costBasis = avgEntry != null ? qty * avgEntry : null;
    const unrealizedPl = toNum(pos?.unrealized_pl);
    const unrealizedPlPctRaw = toNum(pos?.unrealized_plpc);
    const unrealizedPlPct = unrealizedPlPctRaw != null ? unrealizedPlPctRaw * 100 : null;
    const guard = orderBySymbol.get(symbol) || { stopPrice: null, targetPrice: null };
    const stateStatus = statusBySymbol.get(symbol) || {};
    const targetPrice = guard.targetPrice ?? stateStatus.plannedTargetPrice ?? null;
    const stopPrice = guard.stopPrice ?? stateStatus.plannedStopPrice ?? null;
    const stopPriceSource = guard.stopPrice != null ? "broker_stop_child" : stateStatus.plannedStopSource || null;
    const targetPriceSource = guard.targetPrice != null ? "broker_target_child" : stateStatus.plannedTargetSource || null;
    const brokerStopMissing = !guard.stopPresent && stateStatus.plannedStopPrice != null;
    const brokerTargetMissing = !guard.targetPresent && stateStatus.plannedTargetPrice != null;
    const positionStatus = derivePositionStatus({
      qty,
      currentPrice,
      stopPrice,
      targetPrice,
      unrealizedPlPct,
      brokerStopMissing,
      brokerTargetMissing
    });
    return {
      symbol,
      qty,
      avgEntry,
      currentPrice,
      stopPrice,
      targetPrice,
      brokerStopPrice: guard.stopPrice,
      brokerTargetPrice: guard.targetPrice,
      brokerStopPresent: Boolean(guard.stopPresent),
      brokerTargetPresent: Boolean(guard.targetPresent),
      brokerStopMissing,
      brokerTargetMissing,
      brokerStopOrderIds: guard.stopOrderIds || [],
      brokerTargetOrderIds: guard.targetOrderIds || [],
      brokerSellOrderCount: guard.sellOrderCount || 0,
      brokerNestedSellOrderCount: guard.nestedSellOrderCount || 0,
      brokerProtectionSourceTypes: guard.sourceTypes || [],
      plannedStopPrice: stateStatus.plannedStopPrice ?? null,
      plannedTargetPrice: stateStatus.plannedTargetPrice ?? null,
      plannedStopSource: stateStatus.plannedStopSource || null,
      plannedTargetSource: stateStatus.plannedTargetSource || null,
      plannedStage6Hash: stateStatus.plannedStage6Hash || null,
      plannedStage6File: stateStatus.plannedStage6File || null,
      plannedLedgerKey: stateStatus.plannedLedgerKey || null,
      plannedLedgerUpdatedAt: stateStatus.ledgerUpdatedAt || null,
      stopPriceSource,
      targetPriceSource,
      marketValue,
      costBasis,
      unrealizedPl,
      unrealizedPlPct,
      positionStatus,
      ledgerStatus: stateStatus.ledgerStatus || null,
      idempotencyBrokerStatus: stateStatus.idempotencyBrokerStatus || null,
      fillabilityStatus: stateStatus.fillabilityStatus || null,
      normalizedFillState: stateStatus.normalizedFillState || null,
      fillStateConsistent: stateStatus.fillStateConsistent,
      fillQty: stateStatus.fillQty ?? null,
      avgFillPrice: stateStatus.avgFillPrice ?? null,
      holdDays: null
    };
  });

  const totalUnrealizedPl = normalizedPositions.reduce((acc, row) => acc + (row.unrealizedPl || 0), 0);
  const totalCostBasis = normalizedPositions.reduce((acc, row) => acc + (row.costBasis || 0), 0);
  const totalMarketValue = normalizedPositions.reduce((acc, row) => acc + (row.marketValue || 0), 0);

  return {
    available: true,
    account: {
      accountNumber: redactAccountNumber(account?.account_number || ""),
      accountNumberRedacted: true,
      status: short(account?.status || "N/A", 40),
      equity: toNum(account?.equity),
      cash: toNum(account?.cash),
      buyingPower: toNum(account?.buying_power),
      daytradeCount: toNum(account?.daytrade_count)
    },
    totals: {
      positionCount: normalizedPositions.length,
      totalUnrealizedPl,
      totalCostBasis,
      totalMarketValue,
      totalReturnPct: totalCostBasis > 0 ? (totalUnrealizedPl / totalCostBasis) * 100 : null,
      openOrderNested: true,
      openOrderRawCount: openOrders.length,
      openOrderFlattenedCount: brokerProtection.flattenedOrders.length,
      brokerStopMissingCount: normalizedPositions.filter((row) => row.brokerStopMissing).length,
      brokerTargetMissingCount: normalizedPositions.filter((row) => row.brokerTargetMissing).length,
      guardMissingCount: normalizedPositions.filter((row) =>
        String(row.positionStatus || "").includes("GUARD_MISSING") ||
        String(row.positionStatus || "").includes("STOP_MISSING") ||
        String(row.positionStatus || "").includes("BROKER_STOP_MISSING")
      ).length,
      fillStateMismatchCount: normalizedPositions.filter((row) => row.fillStateConsistent === false).length
    },
    positions: normalizedPositions.sort((a, b) => (b.unrealizedPl || 0) - (a.unrealizedPl || 0))
  };
};

const buildBrokerRealizedPnlRuntime = async (live) => {
  const orderLedger = readJson(ORDER_LEDGER_PATH) || {};
  const orderIdempotency = readJson(ORDER_IDEMPOTENCY_PATH) || {};
  const timestampRows = [
    ...stateOrderEntries(orderLedger).map(([, row]) => row),
    ...stateOrderEntries(orderIdempotency).map(([, row]) => row),
    ...(Array.isArray(orderIdempotency?.releases) ? orderIdempotency.releases : [])
  ];
  const timestamps = timestampRows
    .flatMap((row) => [row?.createdAt, row?.updatedAt, row?.firstSeenAt, row?.lastSeenAt, row?.releasedAt])
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  const fallbackAfter = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const afterMs = timestamps.length > 0 ? Math.min(...timestamps) - 24 * 60 * 60 * 1000 : fallbackAfter;
  const after = new Date(afterMs).toISOString();
  const closedRes = await fetchAlpaca(
    `/v2/orders?status=closed&nested=true&direction=asc&limit=500&after=${encodeURIComponent(after)}`
  );
  const closedOrders = closedRes.ok && Array.isArray(closedRes.data) ? closedRes.data : [];
  const paperMode = String(process.env.ALPACA_BASE_URL || "").includes("paper-api.alpaca.markets");
  const report = buildBrokerRealizedPnlSummary({
    orderLedger,
    orderIdempotency,
    closedOrders,
    currentPositions: live?.available ? live.positions : [],
    paperMode,
    closedOrdersSourceComplete: closedRes.ok && closedOrders.length < 500,
    positionsSourceComplete: live?.available === true
  });
  return {
    ...report,
    runtimeSource: {
      status: closedRes.ok ? "PASS" : "UNAVAILABLE",
      reason: closedRes.reason,
      queryAfter: after,
      returnedOrderCount: closedOrders.length,
      responseLimitReached: closedOrders.length >= 500
    }
  };
};

const fmt = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
};

export const buildMarkdown = ({ generatedAt, simulation, live, realizedPnl }) => {
  const lines = [];
  lines.push("## Trading Performance Dashboard");
  lines.push(`- generatedAt: \`${generatedAt}\``);
  lines.push(
    `- simulation: \`rows=${simulation.totalRows} filled=${simulation.filledRows} open=${simulation.openRows} closed=${simulation.closedRows} winRate=${fmt(simulation.winRatePct)}% avgClosedR=${fmt(simulation.avgClosedR, 4)} avgClosedReturn=${fmt(simulation.avgClosedReturnPct)}%\``
  );
  lines.push(
    `- simulation_scope: \`simRows(cumulative_loop_rows)=${simulation.totalRows} snapshotTradeCount(latest_kpi_snapshot)=${simulation.latestSnapshotTradeCount ?? "N/A"} rowSnapshotGap=${fmt(simulation.rowVsSnapshotGap, 0)} snapshotCoveragePct=${fmt(simulation.snapshotCoveragePct)}%\``
  );
  if (simulation.latestSnapshot) {
    lines.push(
      `- simulation_latest_snapshot: \`source=${simulation.latestSnapshot.kpiSource ?? "none"} tradeCount=${simulation.latestSnapshot.tradeCount} fillRatePct=${fmt(simulation.latestSnapshot.fillRatePct)} avgR=${fmt(simulation.latestSnapshot.avgR, 4)} noReasonDrift=${fmt(simulation.latestSnapshot.noReasonDrift, 0)}\``
    );
  }

  const topWinners = simulation.topWinners
    .slice(0, 3)
    .map((row) => `${row.symbol}:${fmt(row.avgReturnPct)}%`)
    .join(", ");
  const topLosers = simulation.topLosers
    .slice(0, 3)
    .map((row) => `${row.symbol}:${fmt(row.avgReturnPct)}%`)
    .join(", ");
  lines.push(`- simulation_top_winners: \`${topWinners || "N/A"}\``);
  lines.push(`- simulation_top_losers: \`${topLosers || "N/A"}\``);

  if (live?.available) {
    lines.push(
      `- live_totals: \`positions=${live.totals.positionCount} openOrders=${live.totals.openOrderRawCount} guardMissing=${live.totals.guardMissingCount} fillStateMismatch=${live.totals.fillStateMismatchCount}\``
    );
    lines.push(
      `- live_position_monitor: \`nestedOrders=${live.totals.openOrderNested} flattened=${live.totals.openOrderFlattenedCount} brokerStopMissing=${live.totals.brokerStopMissingCount} brokerTargetMissing=${live.totals.brokerTargetMissingCount}\``
    );
  } else {
    lines.push(`- live_totals: \`N/A (${live?.reason || "not_available"})\``);
  }
  lines.push(
    `- realized_pnl: \`status=${realizedPnl?.status || "REALIZED_PNL_PRODUCER_GAP"} rows=${realizedPnl?.summary?.totalRows || 0} verified=${realizedPnl?.summary?.verifiedRows || 0} partial=${realizedPnl?.summary?.partialExitRows || 0} doubleCountViolations=${realizedPnl?.summary?.costDoubleCountViolationRows || 0}\``
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
};

export const buildPublicDashboard = ({ generatedAt, simulation, live, realizedPnl }) => ({
  generatedAt,
  simulation: {
    totalRows: simulation?.totalRows || 0,
    filledRows: simulation?.filledRows || 0,
    openRows: simulation?.openRows || 0,
    closedRows: simulation?.closedRows || 0
  },
  live: {
    available: live?.available === true,
    reason: live?.available === true ? "details_redacted" : live?.reason || "not_available",
    totals: live?.available === true ? {
      positionCount: live?.totals?.positionCount || 0,
      openOrderRawCount: live?.totals?.openOrderRawCount || 0,
      brokerStopMissingCount: live?.totals?.brokerStopMissingCount || 0,
      brokerTargetMissingCount: live?.totals?.brokerTargetMissingCount || 0,
      guardMissingCount: live?.totals?.guardMissingCount || 0,
      fillStateMismatchCount: live?.totals?.fillStateMismatchCount || 0
    } : null
  },
  realizedPnl: {
    contractVersion: realizedPnl?.contractVersion || "paper-realized-pnl-v1",
    status: realizedPnl?.status || "REALIZED_PNL_PRODUCER_GAP",
    reportOnly: true,
    sourceContract: realizedPnl?.sourceContract || null,
    summary: realizedPnl?.summary || {
      totalRows: 0,
      verifiedRows: 0,
      partialExitRows: 0,
      costDoubleCountViolationRows: 0,
      unknownRows: 0
    },
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false
  }
});

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const loop = readJson(LOOP_PATH) || {};
  const simulation = buildSimulationSummary(loop);
  const live = await buildLiveSummary();
  const realizedPnl = await buildBrokerRealizedPnlRuntime(live);
  const generatedAt = new Date().toISOString();

  const output = {
    generatedAt,
    simulation,
    live,
    realizedPnl
  };

  writeTextAtomic(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`);
  writeTextAtomic(OUTPUT_PUBLIC_JSON, `${JSON.stringify(buildPublicDashboard(output), null, 2)}\n`);
  writeTextAtomic(OUTPUT_MD, buildMarkdown(output));
  console.log(
    `[PERF_DASHBOARD] saved privateJson=${OUTPUT_JSON} publicJson=${OUTPUT_PUBLIC_JSON} md=${OUTPUT_MD} simRows=${simulation.totalRows} liveAvailable=${live.available} realizedStatus=${realizedPnl.status} realizedRows=${realizedPnl.summary.totalRows}`
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[PERF_DASHBOARD] failed: ${error?.message || error}`);
    process.exit(1);
  });
}
