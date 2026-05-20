import fs from "node:fs";
import { evaluateGuardMetadataRisk } from "./lib/guard-metadata-risk.mjs";

const STATE_DIR = String(process.env.PAPER_OCO_SUBMIT_STATE_DIR || "state").trim() || "state";
const APPROVAL_GATE_PATH = `${STATE_DIR}/paper-oco-canary-approval-gate.json`;
const CANDIDATE_PATH = `${STATE_DIR}/paper-oco-canary-candidate.json`;
const LEDGER_PATH = `${STATE_DIR}/paper-oco-canary-submit-ledger.json`;
const OUTPUT_JSON = `${STATE_DIR}/paper-oco-canary-submit-gate.json`;
const OUTPUT_MD = `${STATE_DIR}/paper-oco-canary-submit-gate.md`;

const REQUIRED_APPROVAL_PHRASE = "CONFIRM LIVE EXECUTION";
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";

const boolEnv = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = (path, value) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fmt = (value, digits = 2) => {
  const n = toNum(value);
  if (n == null) return "N/A";
  return n.toFixed(digits);
};

const priceString = (value) => {
  const n = toNum(value);
  if (n == null || n <= 0) return null;
  return n.toFixed(n >= 1 ? 2 : 4);
};

const qtyString = (value) => {
  const n = toNum(value);
  if (n == null || n <= 0 || !Number.isInteger(n)) return null;
  return String(n);
};

const addGate = (gates, id, status, detail) => {
  gates.push({ id, status, detail: short(detail, 360) });
};

const guardRiskDetail = (risk) => {
  if (!risk || typeof risk !== "object") return "missing guardMetadataRisk";
  const blockers = Array.isArray(risk.blockers) ? risk.blockers : [];
  return `status=${risk.status || "N/A"} ageMin=${risk.ageMin ?? "N/A"}/${risk.maxAgeMin ?? "N/A"} stopDist=${risk.stopDistancePct ?? "N/A"}% targetDist=${risk.targetDistancePct ?? "N/A"}% blockers=${blockers.join(",") || "none"}`;
};

const guardRiskBlocked = (risk) => {
  if (!risk || typeof risk !== "object") return true;
  return risk.status === "BLOCK" || (Array.isArray(risk.blockers) && risk.blockers.length > 0);
};

const sanitizeScalar = (key, value) => {
  const k = String(key || "").toLowerCase();
  if (/(account|secret|token|authorization|api[-_]?key|password)/i.test(k)) return "[REDACTED]";
  if ((k === "id" || k.endsWith("_id") || k === "parent_order_id") && typeof value === "string" && value.length > 10) {
    return `redacted_${value.slice(-6)}`;
  }
  return value;
};

const sanitizeBrokerObject = (value, key = "") => {
  if (Array.isArray(value)) return value.map((item) => sanitizeBrokerObject(item, key));
  if (!value || typeof value !== "object") return sanitizeScalar(key, value);
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) out[childKey] = sanitizeBrokerObject(childValue, childKey);
  return out;
};

const flattenOrders = (orders, depth = 0) => {
  const out = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== "object") continue;
    out.push({ ...order, _nestedDepth: depth });
    if (Array.isArray(order.legs)) out.push(...flattenOrders(order.legs, depth + 1));
  }
  return out;
};

const isTerminalStatus = (status) => ["filled", "canceled", "cancelled", "expired", "rejected"].includes(String(status ?? "").trim().toLowerCase());
const isActiveStatus = (status) => !isTerminalStatus(status);

const classifySellProtection = (orders, symbol) => {
  const target = asSymbol(symbol);
  const activeSellOrders = flattenOrders(orders).filter((order) => {
    return asSymbol(order?.symbol) === target && String(order?.side || "").toLowerCase() === "sell" && !isTerminalStatus(order?.status);
  });
  const stopOrders = [];
  const targetOrders = [];
  for (const order of activeSellOrders) {
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    const stop = toNum(order?.stop_price);
    const limit = toNum(order?.limit_price);
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop" || stop != null) stopOrders.push(order);
    if (type === "limit" && limit != null) targetOrders.push(order);
  }
  return {
    activeSellOrderCount: activeSellOrders.length,
    stopOrderCount: stopOrders.length,
    targetOrderCount: targetOrders.length,
    hasStop: stopOrders.length > 0,
    hasTarget: targetOrders.length > 0,
    ocoParentCount: activeSellOrders.filter((order) => String(order?.order_class || "").toLowerCase() === "oco").length
  };
};

const alpacaRequest = async (method, path, payload = null) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = String(process.env.ALPACA_KEY_ID || "").trim();
  const secret = String(process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl) return { ok: false, status: null, data: null, reason: "ALPACA_BASE_URL_missing" };
  if (!keyId || !secret) return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        ...(payload ? { "Content-Type": "application/json" } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: response.ok, status: response.status, data, reason: response.ok ? "ok" : `alpaca_http_${response.status}` };
  } catch (error) {
    return { ok: false, status: null, data: null, reason: `alpaca_network:${short(error?.message || error, 180)}` };
  }
};

const fetchAlpaca = (path) => alpacaRequest("GET", path);
const postAlpaca = (path, payload) => alpacaRequest("POST", path, payload);
const deleteAlpaca = (path) => alpacaRequest("DELETE", path);

const findPosition = (positions, symbol) => (Array.isArray(positions) ? positions : []).find((row) => asSymbol(row?.symbol) === asSymbol(symbol)) || null;

const findOrderByClientId = (orders, clientOrderId) => {
  const target = String(clientOrderId || "").trim();
  if (!target) return null;
  return flattenOrders(orders).find((order) => String(order?.client_order_id || "").trim() === target) || null;
};

const findActiveOrderByClientId = (orders, clientOrderId) => {
  const order = findOrderByClientId(orders, clientOrderId);
  return order && isActiveStatus(order.status) ? order : null;
};

const buildPayloadPreview = (selected) => {
  const symbol = asSymbol(selected?.symbol);
  const qty = qtyString(selected?.canaryQty);
  const target = priceString(selected?.plannedTargetPrice);
  const stop = priceString(selected?.plannedStopPrice);
  const clientOrderId = String(selected?.clientOrderIdPreview || `oco_canary_${symbol.toLowerCase()}_pending`)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 48);
  if (!symbol || !qty || !target || !stop) return null;
  return {
    symbol,
    side: "sell",
    type: "limit",
    time_in_force: "day",
    order_class: "oco",
    qty,
    take_profit: { limit_price: target },
    stop_loss: { stop_price: stop },
    client_order_id: clientOrderId
  };
};

const readLedger = () => readJson(LEDGER_PATH) || { schemaVersion: 1, generatedAt: nowIso(), entries: {} };

const writeLedger = (ledger) => writeJson(LEDGER_PATH, { ...ledger, updatedAt: nowIso() });

const ledgerStatusIsActive = (status) => new Set(["submit_started", "submitted", "accepted", "new", "partially_filled", "visibility_pass", "cancel_started"]).has(String(status || ""));

const loadActiveLedgerDuplicate = (idempotencyKey) => {
  const ledger = readLedger();
  const entry = ledger?.entries?.[idempotencyKey] || null;
  return { entry, duplicate: Boolean(entry && ledgerStatusIsActive(entry.status)) };
};

const updateLedgerEntry = (idempotencyKey, patch) => {
  const ledger = readLedger();
  const prior = ledger.entries[idempotencyKey] || { idempotencyKey, history: [] };
  const entry = {
    ...prior,
    ...patch,
    updatedAt: nowIso(),
    history: [
      ...(Array.isArray(prior.history) ? prior.history : []),
      {
        at: nowIso(),
        status: patch.status || prior.status || "unknown",
        reason: patch.reason || null,
        brokerOrderId: patch.brokerOrderId || prior.brokerOrderId || null,
        terminal: patch.terminal ?? prior.terminal ?? false
      }
    ].slice(-20)
  };
  ledger.entries[idempotencyKey] = entry;
  writeLedger(ledger);
  return entry;
};

const validateStaticInputs = ({ approvalGate, candidate, selected, payload, idempotencyKey, gates }) => {
  const { entry, duplicate } = loadActiveLedgerDuplicate(idempotencyKey);
  addGate(gates, "approval_gate_present", approvalGate ? "PASS" : "BLOCK", approvalGate ? "paper OCO approval gate loaded" : "missing paper-oco-canary-approval-gate.json");
  addGate(gates, "candidate_selector_present", candidate ? "PASS" : "BLOCK", candidate ? "paper OCO candidate selector loaded" : "missing paper-oco-canary-candidate.json");
  addGate(gates, "approval_gate_manual_ready", approvalGate?.overall === "manual_approval_required" && approvalGate?.decision?.status === "READY_FOR_MANUAL_APPROVAL" ? "PASS" : "BLOCK", `overall=${approvalGate?.overall || "N/A"} decision=${approvalGate?.decision?.status || "N/A"}`);
  addGate(gates, "single_selected_row", selected?.symbol ? "PASS" : "BLOCK", selected?.symbol ? `selected=${selected.symbol}` : "no selected row");
  addGate(gates, "selected_row_not_executable", selected?.executionAllowed === false ? "PASS" : "BLOCK", `executionAllowed=${selected?.executionAllowed ?? "N/A"}`);
  addGate(gates, "selector_scope_dynamic", candidate?.scope === "portfolio_wide_dynamic_candidates_not_ticker_specific" ? "PASS" : "BLOCK", `scope=${candidate?.scope || "N/A"}`);
  addGate(gates, "selected_matches_selector", asSymbol(candidate?.selectedCandidate?.symbol) === asSymbol(selected?.symbol) ? "PASS" : "BLOCK", `candidateSelected=${candidate?.selectedCandidate?.symbol || "N/A"} gateSelected=${selected?.symbol || "N/A"}`);
  addGate(gates, "canary_qty_one", toNum(selected?.canaryQty) === 1 ? "PASS" : "BLOCK", `canaryQty=${selected?.canaryQty ?? "N/A"}`);
  addGate(gates, "payload_preview_shape_ready", payload ? "PASS" : "BLOCK", payload ? "OCO payload preview can be built from selected row" : "selected row lacks symbol/qty/stop/target");
  addGate(gates, "payload_preview_is_oco_exit", payload?.order_class === "oco" && payload?.side === "sell" && payload?.type === "limit" && payload?.qty === "1" ? "PASS" : "BLOCK", `order_class=${payload?.order_class || "N/A"} side=${payload?.side || "N/A"} type=${payload?.type || "N/A"} qty=${payload?.qty || "N/A"}`);
  addGate(gates, "payload_preview_no_notional_no_extended_hours", payload && payload.notional === undefined && payload.extended_hours === undefined ? "PASS" : "BLOCK", "OCO canary must not use notional or extended_hours");
  addGate(gates, "price_geometry_valid", toNum(selected?.plannedStopPrice) != null && toNum(selected?.currentPrice) != null && toNum(selected?.plannedTargetPrice) != null && toNum(selected?.plannedStopPrice) < toNum(selected?.currentPrice) && toNum(selected?.currentPrice) < toNum(selected?.plannedTargetPrice) ? "PASS" : "BLOCK", `stop=${selected?.plannedStopPrice ?? "N/A"} current=${selected?.currentPrice ?? "N/A"} target=${selected?.plannedTargetPrice ?? "N/A"}`);
  const selectedRisk = selected?.guardMetadataRisk || null;
  addGate(gates, "selected_guard_metadata_fresh", selectedRisk && selectedRisk.stale !== true ? "PASS" : "BLOCK", guardRiskDetail(selectedRisk));
  addGate(gates, "selected_guard_not_near_breached", !guardRiskBlocked(selectedRisk) ? "PASS" : "BLOCK", guardRiskDetail(selectedRisk));
  addGate(gates, "idempotency_key_present", idempotencyKey && !idempotencyKey.includes("undefined") ? "PASS" : "BLOCK", `idempotencyKey=${idempotencyKey || "N/A"}`);
  addGate(gates, "idempotency_not_duplicate", !duplicate ? "PASS" : "BLOCK", duplicate ? `ledger already has active entry status=${entry.status}` : "no active submit-ledger duplicate");
};

const validateEnvForBrokerAccess = ({ gates, readVerifyEnabled, submitEnabled, approvalPhraseProvided, autoCancelEnabled }) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const env = String(process.env.ALPHA_ENV || "").trim().toUpperCase();
  addGate(gates, "paper_environment_only", !readVerifyEnabled && !submitEnabled ? "PASS" : env === "PAPER" ? "PASS" : "BLOCK", `ALPHA_ENV=${process.env.ALPHA_ENV || "N/A"}`);
  addGate(gates, "paper_base_url_only", !readVerifyEnabled && !submitEnabled ? "PASS" : baseUrl === PAPER_BASE_URL ? "PASS" : "BLOCK", `ALPACA_BASE_URL=${baseUrl || "N/A"}`);
  if (submitEnabled) {
    addGate(gates, "actual_submit_explicitly_enabled", "PASS", "PAPER_OCO_CANARY_SUBMIT_ENABLED=true");
    addGate(gates, "approval_phrase_present", approvalPhraseProvided ? "PASS" : "BLOCK", `approvalPhraseProvided=${approvalPhraseProvided}`);
    addGate(gates, "read_precheck_required_for_submit", readVerifyEnabled ? "PASS" : "BLOCK", `PAPER_OCO_CANARY_READ_VERIFY=${readVerifyEnabled}`);
    addGate(gates, "auto_cancel_required", autoCancelEnabled ? "PASS" : "BLOCK", `PAPER_OCO_CANARY_AUTO_CANCEL=${autoCancelEnabled}`);
  } else {
    addGate(gates, "actual_submit_disabled", "PASS", "no POST /v2/orders unless PAPER_OCO_CANARY_SUBMIT_ENABLED=true and approval phrase matches");
  }
};

const runReadPrecheck = async ({ selected, payload, gates }) => {
  const symbol = asSymbol(selected?.symbol);
  const result = { enabled: true, account: null, clock: null, position: null, nestedOpenOrders: null, existingClientOrder: null, protection: null };

  const accountRes = await fetchAlpaca("/v2/account");
  result.account = { ok: accountRes.ok, status: accountRes.status, reason: accountRes.reason, data: sanitizeBrokerObject(accountRes.data) };
  addGate(gates, "alpaca_account_read", accountRes.ok ? "PASS" : "BLOCK", accountRes.reason);

  const clockRes = await fetchAlpaca("/v2/clock");
  result.clock = { ok: clockRes.ok, status: clockRes.status, reason: clockRes.reason, data: sanitizeBrokerObject(clockRes.data) };
  const requireOpen = boolEnv("PAPER_OCO_CANARY_REQUIRE_MARKET_OPEN", true);
  const isOpen = clockRes.ok && clockRes.data && typeof clockRes.data === "object" ? clockRes.data.is_open === true : null;
  addGate(gates, "market_open_for_advanced_order", !requireOpen || isOpen === true ? "PASS" : "BLOCK", `requireOpen=${requireOpen} is_open=${isOpen ?? "N/A"}`);

  const positionsRes = await fetchAlpaca("/v2/positions");
  const position = positionsRes.ok ? findPosition(positionsRes.data, symbol) : null;
  const positionQty = toNum(position?.qty);
  const currentPrice = toNum(position?.current_price ?? selected?.currentPrice);
  const liveGuardRisk = evaluateGuardMetadataRisk({
    generatedAt: selected?.guardMetadataRisk?.generatedAt,
    currentPrice,
    plannedStopPrice: selected?.plannedStopPrice,
    plannedTargetPrice: selected?.plannedTargetPrice
  });
  result.position = { ok: positionsRes.ok, status: positionsRes.status, reason: positionsRes.reason, row: sanitizeBrokerObject(position) };
  result.guardMetadataRisk = liveGuardRisk;
  addGate(gates, "selected_symbol_still_held", positionsRes.ok && positionQty != null && positionQty >= 1 ? "PASS" : "BLOCK", `symbol=${symbol} positionQty=${positionQty ?? "N/A"}`);
  addGate(gates, "live_position_qty_covers_canary", positionQty != null && positionQty >= toNum(selected?.canaryQty) ? "PASS" : "BLOCK", `positionQty=${positionQty ?? "N/A"} canaryQty=${selected?.canaryQty ?? "N/A"}`);
  addGate(gates, "live_price_geometry_valid", currentPrice != null && toNum(selected?.plannedStopPrice) < currentPrice && currentPrice < toNum(selected?.plannedTargetPrice) ? "PASS" : "BLOCK", `stop=${selected?.plannedStopPrice ?? "N/A"} current=${currentPrice ?? "N/A"} target=${selected?.plannedTargetPrice ?? "N/A"}`);
  addGate(gates, "pre_submit_guard_metadata_fresh", liveGuardRisk.stale !== true ? "PASS" : "BLOCK", guardRiskDetail(liveGuardRisk));
  addGate(gates, "pre_submit_guard_not_near_breached", !guardRiskBlocked(liveGuardRisk) ? "PASS" : "BLOCK", guardRiskDetail(liveGuardRisk));

  const ordersRes = await fetchAlpaca(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const openOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  const protection = classifySellProtection(openOrders, symbol);
  result.nestedOpenOrders = { ok: ordersRes.ok, status: ordersRes.status, reason: ordersRes.reason, data: sanitizeBrokerObject(openOrders) };
  result.protection = protection;
  addGate(gates, "nested_open_orders_read", ordersRes.ok ? "PASS" : "BLOCK", ordersRes.reason);
  addGate(gates, "no_existing_active_sell_protection", ordersRes.ok && protection.activeSellOrderCount === 0 ? "PASS" : "BLOCK", `activeSell=${protection.activeSellOrderCount} stop=${protection.stopOrderCount} target=${protection.targetOrderCount}`);

  const clientOrderId = String(payload?.client_order_id || "").trim();
  const clientRes = clientOrderId ? await fetchAlpaca(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`) : { ok: false, status: null, data: null, reason: "client_order_id_missing" };
  result.existingClientOrder = { ok: clientRes.ok, status: clientRes.status, reason: clientRes.reason, data: sanitizeBrokerObject(clientRes.data) };
  addGate(gates, "client_order_id_not_already_used", clientRes.status === 404 ? "PASS" : "BLOCK", `status=${clientRes.status ?? "N/A"} reason=${clientRes.reason}`);
  return result;
};

const verifyNestedVisibility = async ({ symbol, clientOrderId }) => {
  const ordersRes = await fetchAlpaca(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  const matched = findOrderByClientId(orders, clientOrderId);
  const protection = classifySellProtection(orders, symbol);
  const pass = ordersRes.ok && matched && protection.hasStop && protection.hasTarget;
  return {
    ok: Boolean(pass),
    status: ordersRes.status,
    reason: ordersRes.reason,
    matchedOrder: sanitizeBrokerObject(matched),
    matchedOrderId: matched?.id || null,
    protection,
    data: sanitizeBrokerObject(orders)
  };
};

const verifyRollbackTerminal = async ({ symbol, clientOrderId }) => {
  const ordersRes = await fetchAlpaca(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  const activeOrder = findActiveOrderByClientId(orders, clientOrderId);
  return {
    ok: ordersRes.ok && !activeOrder,
    status: ordersRes.status,
    reason: ordersRes.reason,
    activeOrder: sanitizeBrokerObject(activeOrder),
    data: sanitizeBrokerObject(orders)
  };
};

const runApprovedPaperSubmit = async ({ selected, payload, idempotencyKey, preflight, gates }) => {
  const symbol = asSymbol(selected?.symbol);
  const clientOrderId = String(payload?.client_order_id || "").trim();
  const brokerMutation = { attempted: false, submitted: false, status: null, reason: null, response: null };
  const rollback = { attempted: false, ok: false, status: null, reason: null, response: null, terminalVerified: false, terminalCheck: null };
  const postSubmitVisibility = { attempted: false, ok: false, reason: "not_run", matchedOrder: null, protection: null };

  updateLedgerEntry(idempotencyKey, {
    status: "submit_started",
    reason: "approved_paper_oco_canary_submit_started",
    terminal: false,
    symbol,
    clientOrderId,
    selected: sanitizeBrokerObject(selected),
    payloadPreview: sanitizeBrokerObject(payload),
    preflight: sanitizeBrokerObject(preflight)
  });

  brokerMutation.attempted = true;
  const postRes = await postAlpaca("/v2/orders", payload);
  brokerMutation.status = postRes.status;
  brokerMutation.reason = postRes.reason;
  brokerMutation.response = sanitizeBrokerObject(postRes.data);

  if (!postRes.ok) {
    updateLedgerEntry(idempotencyKey, {
      status: "submit_rejected",
      reason: postRes.reason,
      terminal: true,
      brokerResponse: sanitizeBrokerObject(postRes.data)
    });
    addGate(gates, "broker_post_order", "BLOCK", `POST /v2/orders failed status=${postRes.status ?? "N/A"} reason=${postRes.reason}`);
    return { brokerMutation, postSubmitVisibility, rollback, terminalLedgerStatus: "submit_rejected" };
  }

  brokerMutation.submitted = true;
  const brokerOrderId = postRes.data?.id || null;
  updateLedgerEntry(idempotencyKey, {
    status: "submitted",
    reason: "paper_oco_canary_post_accepted",
    terminal: false,
    brokerOrderId,
    brokerStatus: postRes.data?.status || null,
    brokerResponse: sanitizeBrokerObject(postRes.data)
  });
  addGate(gates, "broker_post_order", "PASS", `POST /v2/orders accepted status=${postRes.status ?? "N/A"}`);

  await sleep(Number(process.env.PAPER_OCO_CANARY_VISIBILITY_DELAY_MS || 1500));
  postSubmitVisibility.attempted = true;
  const visibility = await verifyNestedVisibility({ symbol, clientOrderId });
  Object.assign(postSubmitVisibility, visibility);
  addGate(gates, "post_submit_nested_visibility", visibility.ok ? "PASS" : "BLOCK", `ok=${visibility.ok} stop=${visibility.protection?.stopOrderCount ?? "N/A"} target=${visibility.protection?.targetOrderCount ?? "N/A"}`);
  updateLedgerEntry(idempotencyKey, {
    status: visibility.ok ? "visibility_pass" : "visibility_failed",
    reason: visibility.reason,
    terminal: false,
    brokerOrderId: brokerOrderId || visibility.matchedOrderId || null,
    visibility: sanitizeBrokerObject(visibility)
  });

  const cancelId = brokerOrderId || visibility.matchedOrderId;
  rollback.attempted = true;
  if (!cancelId) {
    rollback.reason = "missing_broker_order_id_for_cancel";
    addGate(gates, "rollback_cancel_requested", "BLOCK", rollback.reason);
    updateLedgerEntry(idempotencyKey, {
      status: "cancel_failed_missing_order_id",
      reason: rollback.reason,
      terminal: false
    });
    return { brokerMutation, postSubmitVisibility, rollback, terminalLedgerStatus: "cancel_failed_missing_order_id" };
  }

  updateLedgerEntry(idempotencyKey, {
    status: "cancel_started",
    reason: "auto_cancel_after_visibility_check",
    terminal: false,
    brokerOrderId: cancelId
  });
  const cancelRes = await deleteAlpaca(`/v2/orders/${encodeURIComponent(cancelId)}`);
  rollback.status = cancelRes.status;
  rollback.reason = cancelRes.reason;
  rollback.response = sanitizeBrokerObject(cancelRes.data);
  rollback.ok = cancelRes.ok || cancelRes.status === 204;
  addGate(gates, "rollback_cancel_requested", rollback.ok ? "PASS" : "BLOCK", `status=${cancelRes.status ?? "N/A"} reason=${cancelRes.reason}`);

  await sleep(Number(process.env.PAPER_OCO_CANARY_CANCEL_VERIFY_DELAY_MS || 1500));
  const terminalCheck = await verifyRollbackTerminal({ symbol, clientOrderId });
  rollback.terminalCheck = terminalCheck;
  rollback.terminalVerified = terminalCheck.ok;
  addGate(gates, "rollback_terminal_verified", terminalCheck.ok ? "PASS" : "BLOCK", `activeOrder=${terminalCheck.activeOrder ? "yes" : "no"} reason=${terminalCheck.reason}`);

  const terminalStatus = rollback.ok && terminalCheck.ok ? "rollback_cancelled_terminal" : "rollback_cancel_not_terminal";
  updateLedgerEntry(idempotencyKey, {
    status: terminalStatus,
    reason: rollback.reason,
    terminal: rollback.ok && terminalCheck.ok,
    brokerOrderId: cancelId,
    rollback: sanitizeBrokerObject(rollback)
  });

  return { brokerMutation, postSubmitVisibility, rollback, terminalLedgerStatus: terminalStatus };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Paper OCO Canary Submit Gate");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- decision: \`${report.decision.status} / ${report.decision.recommendedAction}\``);
  lines.push(`- selected: \`${report.selected?.symbol || "N/A"} qty=${report.selected?.canaryQty ?? "N/A"} stop=${fmt(report.selected?.plannedStopPrice)} target=${fmt(report.selected?.plannedTargetPrice)}\``);
  lines.push(`- brokerMutationAttempted: \`${report.brokerMutation.attempted}\``);
  lines.push(`- brokerMutationSubmitted: \`${report.brokerMutation.submitted}\``);
  lines.push(`- rollback: \`attempted=${report.rollback?.attempted ?? false} ok=${report.rollback?.ok ?? false} terminal=${report.rollback?.terminalVerified ?? false}\``);
  lines.push(`- idempotency: \`duplicate=${report.idempotency.duplicate} terminal=${report.idempotency.terminal ?? false} status=${report.idempotency.existingStatus || report.idempotency.terminalStatus || "N/A"}\``);
  lines.push(`- safety: \`${report.executionPolicy.mode}; target=${report.executionPolicy.targetEnvironment}; autoRollback=${report.executionPolicy.autoRollbackEnabled}\``);
  lines.push("- gates:");
  for (const gate of report.gates) lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  lines.push("- rollback_plan:");
  for (const item of report.rollbackPlan) lines.push(`  - ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const readVerifyEnabled = boolEnv("PAPER_OCO_CANARY_READ_VERIFY", false);
  const submitEnabled = boolEnv("PAPER_OCO_CANARY_SUBMIT_ENABLED", false);
  const autoCancelEnabled = boolEnv("PAPER_OCO_CANARY_AUTO_CANCEL", true);
  const approvalPhraseProvided = process.env.PAPER_OCO_CANARY_APPROVAL_PHRASE === REQUIRED_APPROVAL_PHRASE;
  const approvalGate = readJson(APPROVAL_GATE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  const approvalSelected = approvalGate?.selected || null;
  const candidateSelected = candidate?.selectedCandidate || null;
  const selected = approvalSelected
    ? {
      ...(candidateSelected || {}),
      ...approvalSelected,
      clientOrderIdPreview: candidateSelected?.clientOrderIdPreview || approvalSelected?.clientOrderIdPreview || null,
      idempotencyKeyPreview: candidateSelected?.idempotencyKeyPreview || approvalSelected?.idempotencyKeyPreview || null
    }
    : null;
  const payload = buildPayloadPreview(selected);
  const idempotencyKey = selected?.idempotencyKeyPreview || `paper-oco-canary:${asSymbol(selected?.symbol)}:qty=${selected?.canaryQty}:stop=${selected?.plannedStopPrice}:target=${selected?.plannedTargetPrice}`;
  const gates = [];
  const preflight = { readVerifyEnabled, broker: null };

  validateStaticInputs({ approvalGate, candidate, selected, payload, idempotencyKey, gates });
  validateEnvForBrokerAccess({ gates, readVerifyEnabled, submitEnabled, approvalPhraseProvided, autoCancelEnabled });

  const brokerReadEnvOk =
    !readVerifyEnabled ||
    (String(process.env.ALPHA_ENV || "").trim().toUpperCase() === "PAPER" &&
      String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "") === PAPER_BASE_URL);

  if (readVerifyEnabled && brokerReadEnvOk) {
    preflight.broker = await runReadPrecheck({ selected, payload, gates });
  } else if (readVerifyEnabled) {
    addGate(gates, "broker_read_precheck_not_run", "WARN", "broker read precheck skipped because ALPHA_ENV/ALPACA_BASE_URL are not paper-only");
  } else {
    addGate(gates, "broker_read_precheck_not_run", submitEnabled ? "BLOCK" : "WARN", "set PAPER_OCO_CANARY_READ_VERIFY=true for non-mutating Alpaca position/open-order precheck");
  }

  let brokerMutation = { attempted: false, submitted: false, status: null, reason: submitEnabled ? "blocked_before_submit" : "submit_not_requested", response: null };
  let postSubmitVisibility = null;
  let rollback = { attempted: false, ok: false, status: null, reason: submitEnabled ? "blocked_before_submit" : "submit_not_requested", response: null, terminalVerified: false };
  let terminalLedgerStatus = null;

  let blockingGates = gates.filter((gate) => gate.status === "BLOCK");
  if (submitEnabled && blockingGates.length === 0) {
    const result = await runApprovedPaperSubmit({ selected, payload, idempotencyKey, preflight, gates });
    brokerMutation = result.brokerMutation;
    postSubmitVisibility = result.postSubmitVisibility;
    rollback = result.rollback;
    terminalLedgerStatus = result.terminalLedgerStatus;
    blockingGates = gates.filter((gate) => gate.status === "BLOCK");
  }

  const ledgerEntry = readLedger()?.entries?.[idempotencyKey] || null;
  const submittedAndTerminal = brokerMutation.submitted === true && rollback?.terminalVerified === true && ledgerEntry?.terminal === true;
  const overall = blockingGates.length > 0
    ? (brokerMutation.submitted ? "submitted_with_blocking_followup" : "blocked")
    : submitEnabled
      ? (submittedAndTerminal ? "submitted_visibility_verified_rollback_terminal" : "submitted_not_terminal")
      : "ready_but_not_approved";
  const decisionStatus = blockingGates.length > 0
    ? (brokerMutation.submitted ? "SUBMITTED_REVIEW_BLOCKERS" : "DO_NOT_SUBMIT_BLOCKED")
    : submitEnabled
      ? (submittedAndTerminal ? "SUBMIT_ROLLBACK_VERIFIED" : "SUBMIT_REVIEW_REQUIRED")
      : "READY_FOR_APPROVAL_BUT_NOT_SUBMITTED";

  const report = {
    generatedAt: nowIso(),
    overall,
    files: {
      approvalGate: Boolean(approvalGate),
      candidateSelector: Boolean(candidate),
      submitLedger: fs.existsSync(LEDGER_PATH)
    },
    executionPolicy: {
      mode: submitEnabled ? "paper_oco_canary_submit_approved" : "submit_gate_non_mutating",
      brokerMutationAllowedByDefault: false,
      brokerMutationImplemented: true,
      brokerMutationRequested: submitEnabled,
      readVerifyEnabled,
      approvalPhraseProvided,
      requiredApprovalPhrase: REQUIRED_APPROVAL_PHRASE,
      targetEnvironment: "PAPER",
      autoRollbackEnabled: autoCancelEnabled
    },
    selected: selected
      ? {
        symbol: selected.symbol || null,
        canaryQty: selected.canaryQty ?? null,
        currentPrice: selected.currentPrice ?? null,
        plannedStopPrice: selected.plannedStopPrice ?? null,
        plannedTargetPrice: selected.plannedTargetPrice ?? null,
        readiness: selected.readiness || null,
        executionAllowed: selected.executionAllowed,
        guardMetadataRisk: selected.guardMetadataRisk || null
      }
      : null,
    payloadPreview: sanitizeBrokerObject(payload),
    idempotency: {
      ledgerPath: LEDGER_PATH,
      key: idempotencyKey,
      duplicate: loadActiveLedgerDuplicate(idempotencyKey).duplicate,
      existingStatus: ledgerEntry?.status || null,
      terminalStatus: terminalLedgerStatus,
      terminal: ledgerEntry?.terminal === true,
      writeBeforeSubmitRequiredInFutureTask: true
    },
    decision: {
      status: decisionStatus,
      recommendedAction: submitEnabled ? "REVIEW_CANARY_RESULT" : "DO_NOT_SUBMIT",
      requiredApprovalPhrase: REQUIRED_APPROVAL_PHRASE,
      nextAction: submitEnabled
        ? "inspect nested visibility, rollback, and terminal idempotency before any broader repair lane"
        : "actual paper OCO submit requires broker-mutating approval phrase and paper-only env"
    },
    preflight,
    brokerMutation,
    postSubmitVisibility,
    rollback,
    gates,
    summary: {
      blockingGates: blockingGates.length,
      brokerMutationAttempted: brokerMutation.attempted === true,
      brokerMutationSubmitted: brokerMutation.submitted === true,
      selectedSymbol: selected?.symbol || null,
      clientOrderId: payload?.client_order_id || null,
      rollbackTerminal: rollback?.terminalVerified === true,
      ledgerTerminal: ledgerEntry?.terminal === true
    },
    rollbackPlan: [
      "Auto-cancel is required for this canary lane and must be verified terminal in the submit ledger.",
      "If rollback terminal verification fails, manually cancel the returned Alpaca paper order id or client_order_id immediately.",
      "Do not submit a second OCO canary for the same symbol until the dedicated idempotency ledger confirms the prior attempt is terminal.",
      "Do not promote this lane beyond one dynamically selected paper row without a separate approval and scale-up task."
    ]
  };

  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[PAPER_OCO_SUBMIT_GATE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${selected?.symbol || "none"} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}`);

  if (submitEnabled && !submittedAndTerminal) process.exitCode = 1;
};

main().catch((error) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const report = {
    generatedAt: nowIso(),
    overall: "fail",
    decision: { status: "SCRIPT_ERROR", recommendedAction: "DO_NOT_SUBMIT" },
    selected: null,
    error: short(error?.stack || error?.message || error, 2000),
    brokerMutation: { attempted: false, submitted: false, reason: "script_error" },
    rollback: { attempted: false, ok: false, reason: "script_error", terminalVerified: false },
    gates: [{ id: "script_error", status: "BLOCK", detail: short(error?.message || error, 320) }],
    idempotency: { terminal: false },
    rollbackPlan: ["Do not submit; inspect script error."]
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.error(`[PAPER_OCO_SUBMIT_GATE] FAIL ${short(error?.message || error, 240)}`);
  process.exit(1);
});
