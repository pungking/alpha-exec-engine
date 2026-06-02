import fs from "node:fs";

const parseDotEnv = (path) => {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const idx = text.indexOf("=");
    if (idx < 0) continue;
    const key = text.slice(0, idx).trim();
    let value = text.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
};

const RUNTIME_ENV = {
  ...parseDotEnv("../../../.env"),
  ...parseDotEnv("../../.env"),
  ...parseDotEnv(".env"),
  ...process.env
};

const STATE_DIR = String(RUNTIME_ENV.BROKER_FILL_STATE_EVIDENCE_STATE_DIR || "state").trim() || "state";
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const FILES = {
  fillStateAudit: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  performance: `${STATE_DIR}/performance-dashboard.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`
};
const OUTPUT_JSON = `${STATE_DIR}/broker-fill-state-evidence.json`;
const OUTPUT_MD = `${STATE_DIR}/broker-fill-state-evidence.md`;

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = (filePath, payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};
const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
};
const boolEnv = (key, fallback = true) => {
  const raw = RUNTIME_ENV[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};
const positiveEnv = (key, fallback) => {
  const n = Number(RUNTIME_ENV[key] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const normalizeOrder = (order) => ({
  id: String(order?.id || "").trim() || null,
  clientOrderId: String(order?.client_order_id || "").trim() || null,
  symbol: asSymbol(order?.symbol),
  side: String(order?.side || "").trim().toLowerCase() || null,
  type: String(order?.type || "").trim().toLowerCase() || null,
  status: String(order?.status || "").trim().toLowerCase() || null,
  qty: toNum(order?.qty),
  filledQty: toNum(order?.filled_qty),
  limitPrice: toNum(order?.limit_price),
  submittedAt: order?.submitted_at || null,
  updatedAt: order?.updated_at || null,
  filledAt: order?.filled_at || null,
  canceledAt: order?.canceled_at || null,
  expiredAt: order?.expired_at || null,
  rejectedAt: order?.rejected_at || null,
  legs: Array.isArray(order?.legs) ? order.legs.map(normalizeOrder) : []
});

const normalizeFill = (fill) => ({
  id: String(fill?.id || "").trim() || null,
  orderId: String(fill?.order_id || "").trim() || null,
  symbol: asSymbol(fill?.symbol),
  side: String(fill?.side || "").trim().toLowerCase() || null,
  qty: toNum(fill?.qty),
  price: toNum(fill?.price),
  transactionTime: fill?.transaction_time || null
});

const normalizePosition = (position) => ({
  symbol: asSymbol(position?.symbol),
  qty: toNum(position?.qty),
  avgEntryPrice: toNum(position?.avg_entry_price),
  currentPrice: toNum(position?.current_price),
  marketValue: toNum(position?.market_value)
});

const latest = (rows, dateSelector) => {
  const sorted = [...rows].sort((a, b) => {
    const ax = Date.parse(String(dateSelector(a) || ""));
    const bx = Date.parse(String(dateSelector(b) || ""));
    return (Number.isFinite(bx) ? bx : 0) - (Number.isFinite(ax) ? ax : 0);
  });
  return sorted[0] || null;
};

const flattenOrders = (orders) => {
  const out = [];
  const visit = (order) => {
    if (!order) return;
    out.push(order);
    for (const leg of Array.isArray(order.legs) ? order.legs : []) visit(leg);
  };
  for (const order of Array.isArray(orders) ? orders : []) visit(order);
  return out;
};

const credentials = () => {
  const key = firstNonEmpty(RUNTIME_ENV.ALPACA_KEY_ID, RUNTIME_ENV.ALPACA_KEY, RUNTIME_ENV.VITE_ALPACA_KEY);
  const secret = firstNonEmpty(RUNTIME_ENV.ALPACA_SECRET_KEY, RUNTIME_ENV.ALPACA_SECRET, RUNTIME_ENV.VITE_ALPACA_SECRET_KEY);
  const baseUrl = String(RUNTIME_ENV.ALPACA_BASE_URL || PAPER_BASE_URL).replace(/\/+$/, "");
  return { ok: Boolean(key && secret && baseUrl), key, secret, baseUrl };
};

const alpacaGet = async (creds, path) => {
  try {
    const response = await fetch(`${creds.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": creds.key,
        "APCA-API-SECRET-KEY": creds.secret
      }
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? data : null,
      reason: response.ok ? "ok" : `alpaca_http_${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      reason: error instanceof Error ? short(error.message, 140) : "alpaca_get_failed"
    };
  }
};

const indexBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};
const objectRows = (object) => Object.entries(object?.orders || {}).map(([key, value]) => ({ key, ...value }));
const latestObjectBySymbol = (object) => {
  const out = new Map();
  for (const row of objectRows(object)) {
    const symbol = asSymbol(row?.symbol);
    if (!symbol) continue;
    const prev = out.get(symbol);
    const at = Date.parse(String(row?.updatedAt || row?.brokerCheckedAt || row?.lastSeenAt || row?.createdAt || ""));
    const prevAt = Date.parse(String(prev?.updatedAt || prev?.brokerCheckedAt || prev?.lastSeenAt || prev?.createdAt || ""));
    if (!prev || (Number.isFinite(at) && (!Number.isFinite(prevAt) || at >= prevAt))) out.set(symbol, row);
  }
  return out;
};

const classifyEvidence = ({ candidate, brokerPosition, clientOrder, openOrders, closedOrders, fills }) => {
  const flatOpen = flattenOrders(openOrders);
  const flatClosed = flattenOrders(closedOrders);
  const clientStatus = String(clientOrder?.status || "").toLowerCase();
  const clientFilledQty = toNum(clientOrder?.filledQty) ?? 0;
  const fillQty = fills.reduce((acc, fill) => acc + (toNum(fill.qty) || 0), 0);
  const positionQty = toNum(brokerPosition?.qty) ?? 0;
  const latestClosed = latest(flatClosed, (order) => order.updatedAt || order.filledAt || order.expiredAt || order.canceledAt || order.submittedAt);
  const latestOpen = latest(flatOpen, (order) => order.updatedAt || order.submittedAt);
  const terminalStatuses = new Set(["filled", "canceled", "cancelled", "expired", "rejected", "failed"]);
  const workingStatuses = new Set(["new", "accepted", "pending_new", "open", "submitted", "partially_filled", "held"]);

  if (clientStatus === "filled" || clientFilledQty > 0 || fillQty > 0) {
    return {
      evidenceVerdict: "BROKER_FILLED_CONFIRMED",
      proposedTerminalState: "filled",
      confidence: fillQty > 0 || clientStatus === "filled" ? "high" : "medium",
      reason: `clientStatus=${clientStatus || "N/A"} clientFilledQty=${clientFilledQty} fillQty=${fillQty}`,
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  if (terminalStatuses.has(clientStatus) && clientStatus !== "filled" && positionQty <= 0) {
    return {
      evidenceVerdict: "BROKER_TERMINAL_UNFILLED_CONFIRMED",
      proposedTerminalState: clientStatus === "cancelled" ? "canceled" : clientStatus,
      confidence: "high",
      reason: `clientStatus=${clientStatus} positionQty=${positionQty}`,
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  if (positionQty > 0 && workingStatuses.has(clientStatus)) {
    return {
      evidenceVerdict: "POSITION_PRESENT_WITH_BROKER_ORDER_STILL_WORKING",
      proposedTerminalState: null,
      confidence: "medium",
      reason: `positionQty=${positionQty} clientStatus=${clientStatus}; no terminalization without fill/terminal evidence`,
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  if (positionQty > 0 && !clientStatus && !fillQty) {
    return {
      evidenceVerdict: "POSITION_PRESENT_BROKER_EVIDENCE_INCONCLUSIVE",
      proposedTerminalState: null,
      confidence: "low",
      reason: "position present but client-order/fill evidence missing in read-only lookback",
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  if (workingStatuses.has(clientStatus)) {
    return {
      evidenceVerdict: "BROKER_ORDER_STILL_WORKING",
      proposedTerminalState: null,
      confidence: "medium",
      reason: `clientStatus=${clientStatus}; wait for filled or terminal status`,
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  if (terminalStatuses.has(clientStatus) && clientStatus !== "filled") {
    return {
      evidenceVerdict: "BROKER_TERMINAL_BUT_POSITION_REVIEW_REQUIRED",
      proposedTerminalState: clientStatus === "cancelled" ? "canceled" : clientStatus,
      confidence: "medium",
      reason: `clientStatus=${clientStatus}; positionQty=${positionQty} requires ownership review before ledger write`,
      latestOpenStatus: latestOpen?.status || null,
      latestClosedStatus: latestClosed?.status || null
    };
  }
  return {
    evidenceVerdict: "BROKER_EVIDENCE_INCONCLUSIVE",
    proposedTerminalState: null,
    confidence: "low",
    reason: `clientStatus=${clientStatus || "N/A"}; fillQty=${fillQty}; positionQty=${positionQty}`,
    latestOpenStatus: latestOpen?.status || null,
    latestClosedStatus: latestClosed?.status || null
  };
};

const fetchEvidenceForCandidate = async ({ candidate, ledgerRow, idempotencyRow, creds, after }) => {
  const symbol = asSymbol(candidate.symbol);
  const clientOrderId = firstNonEmpty(candidate?.ledger?.clientOrderId, candidate?.idempotency?.clientOrderId, ledgerRow?.clientOrderId, idempotencyRow?.clientOrderId);
  const openPath = `/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=100`;
  const closedPath = `/v2/orders?status=closed&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=100&after=${encodeURIComponent(after)}`;
  const fillsPath = `/v2/account/activities/FILL?after=${encodeURIComponent(after)}&direction=desc&page_size=100`;
  const [positionRes, clientRes, openRes, closedRes, fillsRes] = await Promise.all([
    alpacaGet(creds, `/v2/positions/${encodeURIComponent(symbol)}`),
    clientOrderId
      ? alpacaGet(creds, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`)
      : Promise.resolve({ ok: false, status: null, data: null, reason: "client_order_id_missing" }),
    alpacaGet(creds, openPath),
    alpacaGet(creds, closedPath),
    alpacaGet(creds, fillsPath)
  ]);
  const brokerPosition = positionRes.ok ? normalizePosition(positionRes.data) : null;
  const clientOrder = clientRes.ok ? normalizeOrder(clientRes.data) : null;
  const openOrders = Array.isArray(openRes.data) ? openRes.data.map(normalizeOrder) : [];
  const closedOrders = Array.isArray(closedRes.data) ? closedRes.data.map(normalizeOrder) : [];
  const fills = Array.isArray(fillsRes.data)
    ? fillsRes.data.map(normalizeFill).filter((fill) => fill.symbol === symbol)
    : [];
  const classification = classifyEvidence({ candidate, brokerPosition, clientOrder, openOrders, closedOrders, fills });
  return {
    symbol,
    clientOrderId: clientOrderId || null,
    candidateDecision: candidate.reconciliationDecision || null,
    readStatus: {
      position: { ok: positionRes.ok, status: positionRes.status, reason: positionRes.reason },
      clientOrder: { ok: clientRes.ok, status: clientRes.status, reason: clientRes.reason },
      openOrders: { ok: openRes.ok, status: openRes.status, reason: openRes.reason, count: openOrders.length },
      closedOrders: { ok: closedRes.ok, status: closedRes.status, reason: closedRes.reason, count: closedOrders.length },
      fills: { ok: fillsRes.ok, status: fillsRes.status, reason: fillsRes.reason, count: fills.length }
    },
    brokerPosition,
    brokerOrder: clientOrder
      ? {
        id: clientOrder.id,
        status: clientOrder.status,
        qty: clientOrder.qty,
        filledQty: clientOrder.filledQty,
        submittedAt: clientOrder.submittedAt,
        updatedAt: clientOrder.updatedAt,
        filledAt: clientOrder.filledAt,
        expiredAt: clientOrder.expiredAt,
        canceledAt: clientOrder.canceledAt,
        rejectedAt: clientOrder.rejectedAt
      }
      : null,
    latestOpenOrder: latest(flattenOrders(openOrders), (order) => order.updatedAt || order.submittedAt),
    latestClosedOrder: latest(flattenOrders(closedOrders), (order) => order.updatedAt || order.filledAt || order.expiredAt || order.canceledAt || order.submittedAt),
    fillActivity: {
      count: fills.length,
      qty: fills.reduce((acc, fill) => acc + (toNum(fill.qty) || 0), 0),
      latest: latest(fills, (fill) => fill.transactionTime)
    },
    ...classification,
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Broker Fill-State Evidence");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`candidates=${report.summary.candidates} brokerReads=${report.summary.brokerReadAttempted} filled=${report.summary.brokerFilledConfirmed} terminalUnfilled=${report.summary.brokerTerminalUnfilledConfirmed} working=${report.summary.brokerStillWorking} inconclusive=${report.summary.inconclusive}\``
  );
  lines.push("- safety: `GET-only broker read; no broker mutation; no ledger mutation`");
  lines.push("| Symbol | Verdict | Proposed State | Confidence | Position Qty | Client Order | Fill Qty | Latest Open | Latest Closed | Reason |");
  lines.push("| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.evidenceVerdict} | ${row.proposedTerminalState || "N/A"} | ${row.confidence || "N/A"} | ${fmt(row.brokerPosition?.qty, 4)} | ${row.brokerOrder?.status || "N/A"} | ${fmt(row.fillActivity?.qty, 4)} | ${row.latestOpenOrder?.status || "N/A"} | ${row.latestClosedOrder?.status || "N/A"} | ${short(row.reason, 180)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fillStateAudit = readJson(FILES.fillStateAudit);
  const performance = readJson(FILES.performance);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.idempotency);
  const targetRows = (Array.isArray(fillStateAudit?.rows) ? fillStateAudit.rows : [])
    .filter((row) => row.requiresLedgerTerminalizationReview === true || row.reconciliationDecision === "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE");
  const ledgerBySymbol = latestObjectBySymbol(orderLedger);
  const idempotencyBySymbol = latestObjectBySymbol(idempotency);
  const creds = credentials();
  const readVerifyEnabled = boolEnv("BROKER_FILL_STATE_READ_VERIFY", true);
  const paperOnly = creds.baseUrl === PAPER_BASE_URL;
  const lookbackDays = Math.max(1, Math.round(positiveEnv("BROKER_FILL_STATE_EVIDENCE_LOOKBACK_DAYS", 45)));
  const after = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  let rows = [];
  let brokerReadAttempted = false;
  let overall = "no_candidates";
  let readBlockReason = null;
  if (!targetRows.length) {
    overall = "no_reconciliation_candidates";
  } else if (!readVerifyEnabled) {
    overall = "read_verify_disabled";
    readBlockReason = "BROKER_FILL_STATE_READ_VERIFY=false";
  } else if (!creds.ok) {
    overall = "broker_credentials_missing";
    readBlockReason = "Alpaca credentials unavailable";
  } else if (!paperOnly) {
    overall = "blocked_non_paper_base_url";
    readBlockReason = `ALPACA_BASE_URL must be ${PAPER_BASE_URL} for this read-only evidence lane`;
  } else {
    brokerReadAttempted = true;
    rows = [];
    for (const candidate of targetRows) {
      const symbol = asSymbol(candidate?.symbol);
      rows.push(await fetchEvidenceForCandidate({
        candidate,
        ledgerRow: ledgerBySymbol.get(symbol) || null,
        idempotencyRow: idempotencyBySymbol.get(symbol) || null,
        creds,
        after
      }));
    }
    overall = rows.some((row) => row.evidenceVerdict.includes("INCONCLUSIVE"))
      ? "evidence_inconclusive"
      : rows.some((row) => row.evidenceVerdict.includes("WORKING"))
        ? "broker_working_state_observed"
        : rows.some((row) => row.evidenceVerdict === "BROKER_FILLED_CONFIRMED" || row.evidenceVerdict === "BROKER_TERMINAL_UNFILLED_CONFIRMED")
          ? "terminal_or_filled_evidence_ready"
          : "evidence_collected";
  }

  const summary = {
    candidates: targetRows.length,
    brokerReadAttempted,
    brokerReadSubmitted: false,
    brokerFilledConfirmed: count(rows, (row) => row.evidenceVerdict === "BROKER_FILLED_CONFIRMED"),
    brokerTerminalUnfilledConfirmed: count(rows, (row) => row.evidenceVerdict === "BROKER_TERMINAL_UNFILLED_CONFIRMED"),
    brokerStillWorking: count(rows, (row) => row.evidenceVerdict === "BROKER_ORDER_STILL_WORKING" || row.evidenceVerdict === "POSITION_PRESENT_WITH_BROKER_ORDER_STILL_WORKING"),
    inconclusive: count(rows, (row) => row.evidenceVerdict.includes("INCONCLUSIVE")),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false
  };

  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_broker_fill_state_evidence_get_only_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    config: {
      readVerifyEnabled,
      paperOnly,
      baseUrl: creds.baseUrl || null,
      lookbackDays,
      after,
      readBlockReason
    },
    source: {
      performanceGeneratedAt: performance?.generatedAt || null,
      fillStateAuditOverall: fillStateAudit?.overall || null
    },
    executionPolicy: {
      mode: "broker_get_only_report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[BROKER_FILL_STATE_EVIDENCE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} candidates=${summary.candidates} readAttempted=${summary.brokerReadAttempted} filled=${summary.brokerFilledConfirmed} terminal=${summary.brokerTerminalUnfilledConfirmed} attempted=false submitted=false`
  );
};

main().catch((error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    overall: "script_error",
    error: short(error?.stack || error?.message || error, 2000),
    executionPolicy: {
      mode: "broker_get_only_report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    summary: {
      candidates: 0,
      brokerReadAttempted: false,
      brokerReadSubmitted: false,
      brokerFilledConfirmed: 0,
      brokerTerminalUnfilledConfirmed: 0,
      brokerStillWorking: 0,
      inconclusive: 0,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAttempted: false
    },
    rows: []
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.error(`[BROKER_FILL_STATE_EVIDENCE] script_error ${short(error?.message || error, 320)}`);
  process.exit(1);
});
