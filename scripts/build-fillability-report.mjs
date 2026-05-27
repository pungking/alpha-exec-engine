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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
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

const STATE_DIR = String(RUNTIME_ENV.FILLABILITY_STATE_DIR || "state").trim() || "state";
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const DECISION_AUDIT_PATH = `${STATE_DIR}/last-order-decision-audit.json`;
const OUTPUT_JSON = `${STATE_DIR}/fillability-report.json`;
const OUTPUT_MD = `${STATE_DIR}/fillability-report.md`;

const OPEN_STATUSES = new Set(["new", "accepted", "pending_new", "partially_filled"]);
const TERMINAL_UNFILLED_STATUSES = new Set(["canceled", "expired", "rejected"]);

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
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

const short = (value, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const fmt = (value, digits = 2) => {
  const n = toNum(value);
  if (n == null) return "N/A";
  return n.toFixed(digits);
};

const pct = (value, digits = 2) => {
  const n = toNum(value);
  if (n == null) return "N/A";
  return `${n.toFixed(digits)}%`;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return value;
  }
  return null;
};

const readDecisionRecords = (preview, audit) => {
  if (Array.isArray(audit?.records)) return audit.records;
  if (Array.isArray(preview?.orderDecisionAudit?.records)) return preview.orderDecisionAudit.records;
  if (Array.isArray(preview?.decisionAudit)) return preview.decisionAudit;
  return [];
};

const normalizeOrder = (order) => {
  const status = String(order?.status ?? "").trim().toLowerCase();
  const symbol = String(order?.symbol ?? "").trim().toUpperCase();
  return {
    id: String(order?.id ?? "").trim() || null,
    symbol,
    side: String(order?.side ?? "").trim().toLowerCase(),
    type: String(order?.type ?? "").trim().toLowerCase(),
    orderClass: String(order?.order_class ?? "").trim().toLowerCase() || null,
    status,
    qty: toNum(order?.qty),
    filledQty: toNum(order?.filled_qty),
    limitPrice: toNum(order?.limit_price),
    stopPrice: toNum(order?.stop_price),
    clientOrderId: String(order?.client_order_id ?? "").trim() || null,
    submittedAt: order?.submitted_at || null,
    updatedAt: order?.updated_at || null,
    canceledAt: order?.canceled_at || null,
    expiredAt: order?.expired_at || null,
    filledAt: order?.filled_at || null
  };
};

const normalizeFill = (fill) => ({
  id: String(fill?.id ?? "").trim() || null,
  orderId: String(fill?.order_id ?? "").trim() || null,
  symbol: String(fill?.symbol ?? "").trim().toUpperCase(),
  side: String(fill?.side ?? "").trim().toLowerCase(),
  qty: toNum(fill?.qty),
  price: toNum(fill?.price),
  transactionTime: fill?.transaction_time || null
});

const hasAlpacaCredentials = () => {
  const key = firstNonEmpty(RUNTIME_ENV.ALPACA_KEY_ID, RUNTIME_ENV.ALPACA_KEY, RUNTIME_ENV.VITE_ALPACA_KEY);
  const secret = firstNonEmpty(
    RUNTIME_ENV.ALPACA_SECRET_KEY,
    RUNTIME_ENV.ALPACA_SECRET,
    RUNTIME_ENV.VITE_ALPACA_SECRET_KEY
  );
  const baseUrl = String(RUNTIME_ENV.ALPACA_BASE_URL || "https://paper-api.alpaca.markets").trim();
  return {
    ok: Boolean(key && secret && baseUrl),
    key: String(key || "").trim(),
    secret: String(secret || "").trim(),
    baseUrl: baseUrl.replace(/\/+$/, "")
  };
};

const fetchAlpaca = async (baseUrl, headers, path) => {
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
      return { ok: false, status: response.status, data: null, reason: `alpaca_http_${response.status}` };
    }
    return { ok: true, status: response.status, data, reason: "ok" };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      reason: error instanceof Error ? short(error.message, 120) : "alpaca_fetch_failed"
    };
  }
};

const fetchAlpacaSnapshot = async (symbols) => {
  const credentials = hasAlpacaCredentials();
  if (!credentials.ok) {
    return {
      available: false,
      reason: "alpaca_credentials_missing",
      openOrders: [],
      closedOrders: [],
      fills: []
    };
  }

  const headers = {
    "APCA-API-KEY-ID": credentials.key,
    "APCA-API-SECRET-KEY": credentials.secret
  };
  const lookbackHours = Math.max(1, Math.round(toNum(RUNTIME_ENV.FILLABILITY_LOOKBACK_HOURS) ?? 36));
  const after = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const [open, closed, fills] = await Promise.all([
    fetchAlpaca(credentials.baseUrl, headers, "/v2/orders?status=open&nested=true&limit=100&direction=desc"),
    fetchAlpaca(
      credentials.baseUrl,
      headers,
      `/v2/orders?status=closed&nested=true&limit=100&direction=desc&after=${encodeURIComponent(after)}`
    ),
    fetchAlpaca(
      credentials.baseUrl,
      headers,
      `/v2/account/activities/FILL?after=${encodeURIComponent(after)}&direction=desc&page_size=100`
    )
  ]);

  const quoteBySymbol = {};
  for (const symbol of symbols) {
    if (!symbol) continue;
    const quote = await fetchAlpaca(
      "https://data.alpaca.markets",
      headers,
      `/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`
    );
    if (quote.ok && quote.data?.quote) {
      quoteBySymbol[symbol] = {
        bid: toNum(quote.data.quote.bp),
        ask: toNum(quote.data.quote.ap),
        bidSize: toNum(quote.data.quote.bs),
        askSize: toNum(quote.data.quote.as),
        at: quote.data.quote.t || null
      };
    } else {
      quoteBySymbol[symbol] = { reason: quote.reason };
    }
  }

  return {
    available: open.ok || closed.ok || fills.ok,
    reason: [open, closed, fills].filter((row) => !row.ok).map((row) => row.reason).join(",") || "ok",
    lookbackHours,
    openOrders: Array.isArray(open.data) ? open.data.map(normalizeOrder) : [],
    closedOrders: Array.isArray(closed.data) ? closed.data.map(normalizeOrder) : [],
    fills: Array.isArray(fills.data) ? fills.data.map(normalizeFill) : [],
    quoteBySymbol
  };
};

const bySymbol = (rows) => {
  const map = new Map();
  for (const row of rows) {
    if (!row?.symbol) continue;
    const bucket = map.get(row.symbol) || [];
    bucket.push(row);
    map.set(row.symbol, bucket);
  }
  return map;
};

const latestByTime = (rows) =>
  [...rows].sort((a, b) => {
    const ax = Date.parse(a.updatedAt || a.submittedAt || a.transactionTime || "");
    const bx = Date.parse(b.updatedAt || b.submittedAt || b.transactionTime || "");
    return (Number.isFinite(bx) ? bx : 0) - (Number.isFinite(ax) ? ax : 0);
  })[0] || null;

const calcDistancePct = (current, limit) => {
  const currentNum = toNum(current);
  const limitNum = toNum(limit);
  if (currentNum == null || limitNum == null || limitNum <= 0) return null;
  return ((currentNum - limitNum) / limitNum) * 100;
};

const validQuoteMid = (quote) => {
  const bid = toNum(quote?.bid);
  const ask = toNum(quote?.ask);
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || ask < bid) return null;
  return Number(((bid + ask) / 2).toFixed(4));
};

const parseReasonNumber = (reason, key) => {
  const match = String(reason || "").match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  return match ? toNum(match[1]) : null;
};

const countLabels = (rows, key) => {
  const out = {};
  for (const row of rows) {
    const values = Array.isArray(row?.[key]) ? row[key] : [];
    for (const value of values) {
      const label = String(value || "").trim();
      if (!label) continue;
      out[label] = (out[label] || 0) + 1;
    }
  }
  return out;
};

const compactCountMap = (map) =>
  Object.entries(map || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}:${value}`)
    .join(",");

const classifyRow = (row, broker) => {
  const fillQty = broker.fills.reduce((acc, fill) => acc + (fill.qty || 0), 0);
  if (fillQty > 0 || (broker.openOrder?.filledQty || 0) > 0 || broker.latestClosed?.status === "filled") {
    return { status: "FILLED", reason: "fill_activity_or_broker_status" };
  }
  if (broker.openOrder) {
    if (row.openOrderMonitor?.status === "CANCEL_CANDIDATE") {
      return { status: "OPEN_CANCEL_CANDIDATE", reason: row.openOrderMonitor.reason || "monitor_cancel_candidate" };
    }
    if (row.openOrderMonitor?.status === "REPRICE_CANDIDATE") {
      const suggestedLimit = toNum(row.openOrderMonitor?.suggestedLimitPrice);
      const openLimit = toNum(broker.openOrder.limitPrice);
      if (suggestedLimit != null && openLimit != null && Math.abs(suggestedLimit - openLimit) < 0.01) {
        return { status: "OPEN_REPRICED_WAITING", reason: "reprice_applied_waiting_for_pullback" };
      }
      return { status: "OPEN_REPRICE_CANDIDATE", reason: row.openOrderMonitor.reason || "monitor_reprice_candidate" };
    }
    return { status: "OPEN_WAITING", reason: row.openOrderMonitor?.reason || broker.openOrder.status || "open_order" };
  }
  if (broker.latestClosed && TERMINAL_UNFILLED_STATUSES.has(broker.latestClosed.status)) {
    return { status: "TERMINAL_UNFILLED", reason: broker.latestClosed.status };
  }
  if (String(row.reason || "").includes("entry_too_far_from_market")) {
    return { status: "BLOCKED_ENTRY_DISTANCE", reason: row.reason };
  }
  if (
    String(row.reason || "").includes("entry_notional_below_limit_price") ||
    String(row.reason || "").includes("entry_min_one_share_")
  ) {
    return { status: "BLOCKED_HIGH_PRICE_SIZE", reason: row.reason };
  }
  if (String(row.reason || "").includes("idempotency_duplicate")) {
    return { status: "IDEMPOTENCY_HELD", reason: row.reason };
  }
  if (row.status === "payload") {
    return { status: "PAYLOAD_READY_NO_BROKER_MATCH", reason: "payload_ready_without_matching_broker_order" };
  }
  return { status: "NO_ACTIVE_ORDER", reason: row.reason || "no_payload_or_broker_match" };
};

const classifyTerminalUnfilledTaxonomy = (row) => {
  if (row.status !== "TERMINAL_UNFILLED") return [];
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) labels.push(label);
  };
  const closedFilledQty = toNum(row.brokerClosedFilledQty) ?? 0;
  const currentVsLimitPct = toNum(row.currentVsLimitPct);
  if (closedFilledQty <= 0 && currentVsLimitPct != null && currentVsLimitPct > 0) {
    add("limit_not_reached");
  }
  if (row.quoteInvalid) add("quote_invalid");

  const context = [
    row.overlayStyle,
    row.overlayReason,
    row.monitorStatus,
    row.monitorReason,
    row.executionReason,
    row.reason
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (
    context.includes("pullback") ||
    context.includes("trend_unconfirmed") ||
    context.includes("near_entry") ||
    context.includes("entry_wait")
  ) {
    add("pullback_not_filled");
  }
  if (closedFilledQty <= 0 && labels.length === 0) add("broker_terminal_unfilled");
  return labels;
};

const buildReentryPolicy = (row, taxonomy) => {
  if (row.status !== "TERMINAL_UNFILLED") {
    return {
      sameStage6ReentryAllowed: null,
      reentryApprovalRequired: false,
      reentryPolicyDecision: "not_applicable",
      reentryPolicyReason: "row_not_terminal_unfilled"
    };
  }
  const needsFreshSignal =
    taxonomy.includes("limit_not_reached") ||
    taxonomy.includes("pullback_not_filled") ||
    taxonomy.includes("quote_invalid");
  return {
    sameStage6ReentryAllowed: false,
    reentryApprovalRequired: true,
    reentryPolicyDecision: needsFreshSignal
      ? "WAIT_FRESH_STAGE6_OR_MANUAL_RETRY_APPROVAL"
      : "MANUAL_TERMINAL_REENTRY_REVIEW",
    reentryPolicyReason: needsFreshSignal
      ? "terminal_unfilled_requires_fresh_stage6_or_explicit_retry_approval"
      : "terminal_unfilled_requires_manual_review"
  };
};

const buildRows = (records, alpaca, preview = {}) => {
  const openBySymbol = bySymbol(alpaca.openOrders.filter((order) => order.side === "buy" && OPEN_STATUSES.has(order.status)));
  const closedBySymbol = bySymbol(alpaca.closedOrders.filter((order) => order.side === "buy"));
  const fillsBySymbol = bySymbol(alpaca.fills);

  return records.map((row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    const openOrder = latestByTime(openBySymbol.get(symbol) || []);
    const latestClosed = latestByTime(closedBySymbol.get(symbol) || []);
    const fills = fillsBySymbol.get(symbol) || [];
    const quote = alpaca.quoteBySymbol?.[symbol] || null;
    const quoteMid = validQuoteMid(quote);
    const quoteInvalid =
      quote &&
      quote.reason == null &&
      quoteMid == null &&
      (toNum(quote?.bid) != null || toNum(quote?.ask) != null);
    const currentPrice = firstNonEmpty(
      quoteMid,
      row?.executionOverlay?.currentPrice,
      row?.openOrderMonitor?.currentPrice,
      row?.executionOverlay?.market?.currentPrice
    );
    const activeLimit = openOrder?.limitPrice ?? row?.openOrderMonitor?.limitPrice ?? row?.entryAdjusted;
    const classification = classifyRow(row, { openOrder, latestClosed, fills });
    const entry = toNum(row?.entryAdjusted);
    const stop = toNum(row?.stop);
    const oneShareRiskDollars =
      entry != null && stop != null && entry > stop ? Number((entry - stop).toFixed(2)) : null;
    const highPricePolicy = String(preview?.entrySizingPolicy?.highPricePolicy || "").trim() || null;
    const minOneShareMaxNotional = toNum(preview?.entrySizingPolicy?.minOneShareMaxNotional);
    const maxRiskDollarsPerTrade = toNum(preview?.entrySizingPolicy?.maxRiskDollarsPerTrade);
    const requestedNotional = toNum(row?.requestedNotional) ?? parseReasonNumber(row?.reason, "notional");
    const minOneShareFeasibleUnderCaps =
      classification.status === "BLOCKED_HIGH_PRICE_SIZE" &&
      entry != null &&
      (minOneShareMaxNotional == null || minOneShareMaxNotional <= 0 || entry <= minOneShareMaxNotional) &&
      (maxRiskDollarsPerTrade == null ||
        maxRiskDollarsPerTrade <= 0 ||
        (oneShareRiskDollars != null && oneShareRiskDollars <= maxRiskDollarsPerTrade));

    const baseRow = {
      symbol,
      status: classification.status,
      reason: short(classification.reason, 260),
      decisionStatus: row?.status || "unknown",
      verdict: row?.verdict || null,
      finalDecision: row?.finalDecision || null,
      executionBucket: row?.executionBucket || null,
      executionReason: row?.executionReason || null,
      entryAdjusted: toNum(row?.entryAdjusted),
      target: toNum(row?.target),
      stop: toNum(row?.stop),
      stage6EntryDistancePct: toNum(row?.stage6EntryDistancePct),
      effectiveEntryDistancePct: toNum(row?.effectiveEntryDistancePct),
      rrAtAdjustedEntry: toNum(row?.riskRewardAfter ?? row?.executionOverlay?.rrAtAdjustedEntry),
      currentPrice: toNum(currentPrice),
      quoteBid: toNum(quote?.bid),
      quoteAsk: toNum(quote?.ask),
      quoteMid,
      quoteValid: quoteMid != null,
      quoteInvalid: Boolean(quoteInvalid),
      activeLimit: toNum(activeLimit),
      currentVsLimitPct: calcDistancePct(currentPrice, activeLimit),
      rrAtCurrent: toNum(row?.executionOverlay?.rrAtCurrent ?? row?.openOrderMonitor?.rrAtCurrent),
      overlayStyle: row?.executionOverlay?.style || null,
      overlayReason: row?.executionOverlay?.reason || null,
      monitorStatus: row?.openOrderMonitor?.status || null,
      monitorReason: row?.openOrderMonitor?.reason || null,
      monitorSuggestedLimit: toNum(row?.openOrderMonitor?.suggestedLimitPrice),
      monitorSuggestedDeltaPct: toNum(row?.openOrderMonitor?.suggestedDeltaPct),
      monitorAgeMinutes: toNum(row?.openOrderMonitor?.ageMinutes),
      monitorRrAtLimit: toNum(row?.openOrderMonitor?.rrAtLimit),
      monitorRrAtCurrent: toNum(row?.openOrderMonitor?.rrAtCurrent),
      brokerOpenStatus: openOrder?.status || null,
      brokerOpenLimit: openOrder?.limitPrice ?? null,
      brokerOpenQty: openOrder?.qty ?? null,
      brokerOpenFilledQty: openOrder?.filledQty ?? null,
      brokerOpenClientOrderId: openOrder?.clientOrderId || null,
      brokerClosedStatus: latestClosed?.status || null,
      brokerClosedLimit: latestClosed?.limitPrice ?? null,
      brokerClosedFilledQty: latestClosed?.filledQty ?? null,
      oneShareNotional: entry,
      oneShareRiskDollars,
      requestedNotional,
      highPricePolicy,
      minOneShareMaxNotional,
      maxRiskDollarsPerTrade,
      minOneShareFeasibleUnderCaps,
      highPricePolicyChangeWouldAllow:
        classification.status === "BLOCKED_HIGH_PRICE_SIZE" &&
        highPricePolicy === "skip" &&
        minOneShareFeasibleUnderCaps === true,
      fillCount: fills.length,
      fillQty: fills.reduce((acc, fill) => acc + (fill.qty || 0), 0),
      avgFillPrice:
        fills.length > 0
          ? fills.reduce((acc, fill) => acc + (fill.price || 0) * (fill.qty || 0), 0) /
            Math.max(fills.reduce((acc, fill) => acc + (fill.qty || 0), 0), 1e-9)
          : null
    };
    const terminalUnfilledTaxonomy = classifyTerminalUnfilledTaxonomy(baseRow);
    const reentryPolicy = buildReentryPolicy(baseRow, terminalUnfilledTaxonomy);
    return {
      ...baseRow,
      terminalUnfilledTaxonomy,
      terminalUnfilledPrimaryCause: terminalUnfilledTaxonomy[0] || null,
      ...reentryPolicy
    };
  });
};

const summarizeRows = (rows, preview, alpaca) => {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const openRows = rows.filter((row) => row.brokerOpenStatus);
  const distanceRows = openRows.filter((row) => row.currentVsLimitPct != null);
  const avgOpenCurrentVsLimitPct =
    distanceRows.length > 0
      ? distanceRows.reduce((acc, row) => acc + (row.currentVsLimitPct || 0), 0) / distanceRows.length
      : null;
  const fillRows = rows.filter((row) => row.fillQty > 0);
  const invalidQuoteCount = rows.filter((row) => row.quoteInvalid).length;
  const entryTooFar = count("BLOCKED_ENTRY_DISTANCE");
  const highPriceSizeBlocked = count("BLOCKED_HIGH_PRICE_SIZE");
  const openReprice = count("OPEN_REPRICE_CANDIDATE");
  const openRepricedWaiting = count("OPEN_REPRICED_WAITING");
  const openCancel = count("OPEN_CANCEL_CANDIDATE");
  const terminalUnfilled = count("TERMINAL_UNFILLED");
  const openWaiting = count("OPEN_WAITING");
  const terminalUnfilledRows = rows.filter((row) => row.status === "TERMINAL_UNFILLED");
  const terminalUnfilledTaxonomyCounts = countLabels(terminalUnfilledRows, "terminalUnfilledTaxonomy");
  const expiredLimitNotReached = terminalUnfilledRows.filter((row) =>
    row.terminalUnfilledTaxonomy.includes("limit_not_reached")
  ).length;
  const expiredQuoteInvalid = terminalUnfilledRows.filter((row) =>
    row.terminalUnfilledTaxonomy.includes("quote_invalid")
  ).length;
  const expiredPullbackNotFilled = terminalUnfilledRows.filter((row) =>
    row.terminalUnfilledTaxonomy.includes("pullback_not_filled")
  ).length;
  const reentryReviewRequired = rows.filter((row) => row.reentryApprovalRequired === true).length;

  let overall = "pass";
  const findings = [];
  if (!alpaca.available) {
    overall = "warn";
    findings.push(`broker data unavailable: ${alpaca.reason}`);
  }
  if (rows.length === 0) {
    overall = "warn";
    findings.push("no decision audit records available");
  }
  if (fillRows.length === 0 && (openRows.length > 0 || terminalUnfilled > 0)) {
    overall = "warn";
    findings.push("submitted/open orders exist but no fills observed in lookback");
  }
  if (entryTooFar > 0) {
    overall = "warn";
    findings.push(`${entryTooFar} candidate(s) blocked by entry distance`);
  }
  if (highPriceSizeBlocked > 0) {
    overall = "warn";
    findings.push(`${highPriceSizeBlocked} candidate(s) blocked by high-price sizing`);
    const feasible = rows.filter((row) => row.highPricePolicyChangeWouldAllow).length;
    if (feasible > 0) {
      findings.push(
        `${feasible} high-price candidate(s) would fit configured one-share notional/risk caps if ENTRY_HIGH_PRICE_POLICY=min_one_share`
      );
    }
  }
  if (openReprice > 0) {
    findings.push(`${openReprice} open order(s) are reprice candidates`);
  }
  if (openCancel > 0) {
    findings.push(`${openCancel} open order(s) are cancel candidates`);
  }
  if (openRepricedWaiting > 0) {
    findings.push(`${openRepricedWaiting} open order(s) already repriced and waiting for pullback`);
  }
  if (terminalUnfilled > 0) {
    findings.push(`${terminalUnfilled} order(s) closed without fill`);
  }
  if (expiredLimitNotReached > 0) {
    findings.push(`${expiredLimitNotReached} expired/unfilled order(s) classified as limit_not_reached`);
  }
  if (expiredQuoteInvalid > 0) {
    findings.push(`${expiredQuoteInvalid} expired/unfilled order(s) had invalid latest bid/ask`);
  }
  if (expiredPullbackNotFilled > 0) {
    findings.push(`${expiredPullbackNotFilled} expired/unfilled order(s) remained pullback_not_filled`);
  }
  if (reentryReviewRequired > 0) {
    findings.push(
      `${reentryReviewRequired} terminal unfilled order(s) require fresh Stage6 or explicit retry approval before re-entry`
    );
  }
  if (invalidQuoteCount > 0) {
    overall = "warn";
    findings.push(`${invalidQuoteCount} latest quote(s) had invalid bid/ask and fell back to overlay/monitor price`);
  }

  return {
    overall,
    findings,
    stage6File: preview?.stage6File || null,
    stage6Hash: preview?.stage6Hash || null,
    generatedAt: preview?.generatedAt || null,
    candidateCount: rows.length,
    payloadCount: toNum(preview?.payloadCount) ?? 0,
    skippedCount: toNum(preview?.skippedCount) ?? 0,
    brokerAttempted: toNum(preview?.brokerSubmission?.attempted ?? preview?.orderDecisionAudit?.summary?.brokerAttempted) ?? 0,
    brokerSubmitted: toNum(preview?.brokerSubmission?.submitted ?? preview?.orderDecisionAudit?.summary?.brokerSubmitted) ?? 0,
    openOrderCount: alpaca.openOrders.length,
    fillActivityCount: alpaca.fills.length,
    filledSymbols: fillRows.length,
    openWaiting,
    openRepricedWaiting,
    openReprice,
    openCancel,
    terminalUnfilled,
    terminalUnfilledTaxonomyCounts,
    terminalUnfilledTaxonomySummary: compactCountMap(terminalUnfilledTaxonomyCounts) || null,
    expiredLimitNotReached,
    expiredQuoteInvalid,
    expiredPullbackNotFilled,
    reentryReviewRequired,
    entryTooFar,
    highPriceSizeBlocked,
    highPricePolicyChangeWouldAllow: rows.filter((row) => row.highPricePolicyChangeWouldAllow).length,
    invalidQuoteCount,
    avgOpenCurrentVsLimitPct
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Sidecar Fillability Evidence");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.summary.overall.toUpperCase()}\``);
  lines.push(
    `- stage6: \`${report.summary.stage6File || "N/A"} @ ${short(report.summary.stage6Hash || "", 12) || "N/A"}\``
  );
  lines.push(
    `- broker: \`available=${report.broker.available} reason=${report.broker.reason} open=${report.summary.openOrderCount} fills=${report.summary.fillActivityCount} attempted/submitted=${report.summary.brokerAttempted}/${report.summary.brokerSubmitted}\``
  );
  lines.push(
    `- fillability: \`candidates=${report.summary.candidateCount} payloads=${report.summary.payloadCount} skipped=${report.summary.skippedCount} openWaiting=${report.summary.openWaiting} repricedWaiting=${report.summary.openRepricedWaiting} reprice=${report.summary.openReprice} cancel=${report.summary.openCancel} terminalUnfilled=${report.summary.terminalUnfilled} expiredTaxonomy=${report.summary.terminalUnfilledTaxonomySummary || "none"} reentryReview=${report.summary.reentryReviewRequired} entryTooFar=${report.summary.entryTooFar} highPriceSize=${report.summary.highPriceSizeBlocked} highPricePolicyWouldAllow=${report.summary.highPricePolicyChangeWouldAllow} avgOpenDistance=${pct(report.summary.avgOpenCurrentVsLimitPct)}\``
  );
  if (report.summary.findings.length > 0) {
    lines.push("- findings:");
    for (const finding of report.summary.findings) lines.push(`  - ${finding}`);
  }
  lines.push("");
  lines.push("| Symbol | Status | Current | Limit | Distance | RR@Limit | RR@Current | Taxonomy | Reentry | Monitor | Reason |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 20)) {
    lines.push(
      `| ${row.symbol} | ${row.status} | ${fmt(row.currentPrice)} | ${fmt(row.activeLimit)} | ${pct(row.currentVsLimitPct)} | ${fmt(row.monitorRrAtLimit ?? row.rrAtAdjustedEntry)} | ${fmt(row.monitorRrAtCurrent ?? row.rrAtCurrent)} | ${row.terminalUnfilledTaxonomy.join(",") || "N/A"} | ${row.reentryPolicyDecision || "N/A"} | ${row.monitorStatus || "N/A"} | ${short(row.reason, 90)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const preview = readJson(PREVIEW_PATH);
  const audit = readJson(DECISION_AUDIT_PATH);
  const records = readDecisionRecords(preview, audit);
  const symbols = [...new Set(records.map((row) => String(row?.symbol || "").trim().toUpperCase()).filter(Boolean))];
  const alpaca = await fetchAlpacaSnapshot(symbols);
  const rows = buildRows(records, alpaca, preview);
  const summary = summarizeRows(rows, preview, alpaca);
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      previewPath: PREVIEW_PATH,
      decisionAuditPath: DECISION_AUDIT_PATH,
      previewFound: Boolean(preview),
      decisionAuditFound: Boolean(audit)
    },
    broker: {
      available: alpaca.available,
      reason: alpaca.reason,
      lookbackHours: alpaca.lookbackHours ?? null
    },
    summary,
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[FILLABILITY] overall=${summary.overall} candidates=${summary.candidateCount} payloads=${summary.payloadCount} skipped=${summary.skippedCount} open=${summary.openOrderCount} fills=${summary.fillActivityCount} reprice=${summary.openReprice} terminalUnfilled=${summary.terminalUnfilled} expiredTaxonomy=${summary.terminalUnfilledTaxonomySummary || "none"} reentryReview=${summary.reentryReviewRequired} entryTooFar=${summary.entryTooFar} highPriceSize=${summary.highPriceSizeBlocked} highPricePolicyWouldAllow=${summary.highPricePolicyChangeWouldAllow} avgOpenDistance=${fmt(summary.avgOpenCurrentVsLimitPct)}`
  );
};

main().catch((error) => {
  console.error(`[FILLABILITY] failed=${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
