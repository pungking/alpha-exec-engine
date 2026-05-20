import fs from "node:fs";
import { createHash } from "node:crypto";
import { evaluateGuardMetadataRisk } from "./lib/guard-metadata-risk.mjs";

const STATE_DIR = String(process.env.PERSISTENT_OCO_REPAIR_SUBMIT_STATE_DIR || process.env.PERSISTENT_OCO_REPAIR_STATE_DIR || "state").trim() || "state";
const PLAN_PATH = `${STATE_DIR}/persistent-oco-repair-plan.json`;
const LEDGER_PATH = `${STATE_DIR}/persistent-oco-repair-submit-ledger.json`;
const OUTPUT_JSON = `${STATE_DIR}/persistent-oco-repair-submit-report.json`;
const OUTPUT_MD = `${STATE_DIR}/persistent-oco-repair-submit-report.md`;
const REQUIRED_APPROVAL_PHRASE = "CONFIRM LIVE EXECUTION";
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const PERSISTENT_REPAIR_TIME_IN_FORCE = "gtc";

const nowIso = () => new Date().toISOString();
const short = (v, n = 500) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sym = (v) => String(v || "").trim().toUpperCase();
const num = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const boolEnv = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};
const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return null; }
};
const writeJson = (path, value) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const addGate = (gates, id, status, detail) => gates.push({ id, status, detail: short(detail, 360) });

const guardRiskDetail = (risk) => {
  if (!risk || typeof risk !== "object") return "missing guardMetadataRisk";
  const blockers = Array.isArray(risk.blockers) ? risk.blockers : [];
  return `status=${risk.status || "N/A"} ageMin=${risk.ageMin ?? "N/A"}/${risk.maxAgeMin ?? "N/A"} stopDist=${risk.stopDistancePct ?? "N/A"}% targetDist=${risk.targetDistancePct ?? "N/A"}% blockers=${blockers.join(",") || "none"}`;
};
const guardRiskBlocked = (risk) => {
  if (!risk || typeof risk !== "object") return true;
  return risk.status === "BLOCK" || (Array.isArray(risk.blockers) && risk.blockers.length > 0);
};

const redactScalar = (key, value) => {
  const k = String(key || "").toLowerCase();
  if (/(account|secret|token|authorization|api[-_]?key|password)/i.test(k)) return "[REDACTED]";
  if ((k === "id" || k.endsWith("_id") || k === "parent_order_id") && typeof value === "string" && value.length > 10) return `redacted_${value.slice(-6)}`;
  return value;
};
const sanitize = (value, key = "") => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (!value || typeof value !== "object") return redactScalar(key, value);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
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
const terminalStatuses = new Set(["filled", "canceled", "cancelled", "expired", "rejected"]);
const isTerminal = (status) => terminalStatuses.has(String(status ?? "").trim().toLowerCase());
const classifyProtection = (orders, symbol) => {
  const target = sym(symbol);
  const activeSell = flattenOrders(orders).filter((order) => sym(order?.symbol) === target && String(order?.side || "").toLowerCase() === "sell" && !isTerminal(order?.status));
  const stops = [];
  const targets = [];
  for (const order of activeSell) {
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop" || num(order?.stop_price) != null) stops.push(order);
    if (type === "limit" && num(order?.limit_price) != null) targets.push(order);
  }
  return {
    activeSellOrderCount: activeSell.length,
    stopOrderCount: stops.length,
    targetOrderCount: targets.length,
    hasStop: stops.length > 0,
    hasTarget: targets.length > 0,
    ocoParentCount: activeSell.filter((order) => String(order?.order_class || "").toLowerCase() === "oco").length
  };
};

const alpaca = async (method, path, payload = null) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = String(process.env.ALPACA_KEY_ID || "").trim();
  const secret = String(process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl) return { ok: false, status: null, data: null, reason: "ALPACA_BASE_URL_missing" };
  if (!keyId || !secret) return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, reason: res.ok ? "ok" : `alpaca_http_${res.status}` };
  } catch (error) {
    return { ok: false, status: null, data: null, reason: `alpaca_network:${short(error?.message || error, 180)}` };
  }
};
const getAlpaca = (path) => alpaca("GET", path);
const postAlpaca = (path, payload) => alpaca("POST", path, payload);

const readLedger = () => readJson(LEDGER_PATH) || { schemaVersion: 1, generatedAt: nowIso(), entries: {} };
const writeLedger = (ledger) => writeJson(LEDGER_PATH, { ...ledger, updatedAt: nowIso() });
const activeLedgerStatuses = new Set(["submit_started", "submitted", "visibility_pass", "persistent_visible_open"]);
const updateLedger = (key, patch) => {
  const ledger = readLedger();
  const prior = ledger.entries[key] || { idempotencyKey: key, history: [] };
  const entry = {
    ...prior,
    ...patch,
    updatedAt: nowIso(),
    history: [...(Array.isArray(prior.history) ? prior.history : []), { at: nowIso(), status: patch.status || prior.status || "unknown", reason: patch.reason || null, brokerOrderId: patch.brokerOrderId || prior.brokerOrderId || null, terminal: patch.terminal ?? prior.terminal ?? false }].slice(-20)
  };
  ledger.entries[key] = entry;
  writeLedger(ledger);
  return entry;
};
const activeLedgerDuplicate = (key) => {
  const entry = readLedger().entries?.[key] || null;
  return Boolean(entry && activeLedgerStatuses.has(String(entry.status || "")) && entry.terminal !== true);
};

const price = (v) => {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n.toFixed(n >= 1 ? 2 : 4);
};
const intQty = (v) => {
  const n = num(v);
  if (n == null || n <= 0 || !Number.isInteger(n)) return null;
  return String(n);
};
const payloadFingerprint = ({ symbol, qty, stop, target }) => {
  const source = `${symbol}|${PERSISTENT_REPAIR_TIME_IN_FORCE}|${qty}|${stop}|${target}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 8);
};
const fallbackClientOrderId = ({ symbol, qty, stop, target }) => {
  const fingerprint = payloadFingerprint({ symbol, qty, stop, target });
  return `persistent_oco_${symbol.toLowerCase()}_${PERSISTENT_REPAIR_TIME_IN_FORCE}_${fingerprint}_q${qty}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 48);
};
const buildPayload = (selected) => {
  const p = selected?.payloadPreview && typeof selected.payloadPreview === "object" ? selected.payloadPreview : {};
  const symbol = sym(p.symbol || selected?.symbol);
  const qty = intQty(p.qty ?? selected?.repairQty);
  const target = price(p.take_profit?.limit_price ?? selected?.plannedTargetPrice);
  const stop = price(p.stop_loss?.stop_price ?? selected?.plannedStopPrice);
  const previewTimeInForce = String(p.time_in_force || "").trim().toLowerCase();
  const previewClientOrderId = previewTimeInForce === PERSISTENT_REPAIR_TIME_IN_FORCE ? p.client_order_id : null;
  const clientOrderId = String(previewClientOrderId || fallbackClientOrderId({ symbol, qty: qty || "1", stop, target })).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  if (!symbol || !qty || !target || !stop) return null;
  return { symbol, side: "sell", type: "limit", time_in_force: PERSISTENT_REPAIR_TIME_IN_FORCE, order_class: "oco", qty, take_profit: { limit_price: target }, stop_loss: { stop_price: stop }, client_order_id: clientOrderId };
};

const runReadPrecheck = async ({ selected, payload, gates }) => {
  const symbol = sym(selected?.symbol);
  const account = await getAlpaca("/v2/account");
  addGate(gates, "alpaca_account_read", account.ok ? "PASS" : "BLOCK", account.reason);
  const clock = await getAlpaca("/v2/clock");
  const requireOpen = boolEnv("PERSISTENT_OCO_REPAIR_REQUIRE_MARKET_OPEN", true);
  const isOpen = clock.ok && clock.data && typeof clock.data === "object" ? clock.data.is_open === true : null;
  addGate(gates, "market_open_for_advanced_order", !requireOpen || isOpen === true ? "PASS" : "BLOCK", `requireOpen=${requireOpen} is_open=${isOpen ?? "N/A"}`);
  const positions = await getAlpaca("/v2/positions");
  const position = Array.isArray(positions.data) ? positions.data.find((row) => sym(row?.symbol) === symbol) : null;
  const positionQty = num(position?.qty);
  const currentPrice = num(position?.current_price ?? selected?.currentPrice);
  const liveGuardRisk = evaluateGuardMetadataRisk({
    generatedAt: selected?.guardMetadataRisk?.generatedAt,
    currentPrice,
    plannedStopPrice: selected?.plannedStopPrice,
    plannedTargetPrice: selected?.plannedTargetPrice
  });
  addGate(gates, "selected_symbol_still_held", positions.ok && positionQty != null && positionQty >= 1 ? "PASS" : "BLOCK", `symbol=${symbol} positionQty=${positionQty ?? "N/A"}`);
  addGate(gates, "live_position_qty_covers_repair", positionQty != null && positionQty >= num(selected?.repairQty) ? "PASS" : "BLOCK", `positionQty=${positionQty ?? "N/A"} repairQty=${selected?.repairQty ?? "N/A"}`);
  addGate(gates, "live_price_geometry_valid", currentPrice != null && num(selected?.plannedStopPrice) < currentPrice && currentPrice < num(selected?.plannedTargetPrice) ? "PASS" : "BLOCK", `stop=${selected?.plannedStopPrice ?? "N/A"} current=${currentPrice ?? "N/A"} target=${selected?.plannedTargetPrice ?? "N/A"}`);
  addGate(gates, "pre_submit_guard_metadata_fresh", liveGuardRisk.stale !== true ? "PASS" : "BLOCK", guardRiskDetail(liveGuardRisk));
  addGate(gates, "pre_submit_guard_not_near_breached", !guardRiskBlocked(liveGuardRisk) ? "PASS" : "BLOCK", guardRiskDetail(liveGuardRisk));
  const orders = await getAlpaca(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const openOrders = Array.isArray(orders.data) ? orders.data : [];
  const protection = classifyProtection(openOrders, symbol);
  addGate(gates, "nested_open_orders_read", orders.ok ? "PASS" : "BLOCK", orders.reason);
  addGate(gates, "no_existing_active_sell_protection", orders.ok && protection.activeSellOrderCount === 0 ? "PASS" : "BLOCK", `activeSell=${protection.activeSellOrderCount} stop=${protection.stopOrderCount} target=${protection.targetOrderCount}`);
  const clientOrderId = String(payload?.client_order_id || "").trim();
  const client = clientOrderId ? await getAlpaca(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`) : { ok: false, status: null, data: null, reason: "client_order_id_missing" };
  addGate(gates, "client_order_id_not_already_used", client.status === 404 ? "PASS" : "BLOCK", `status=${client.status ?? "N/A"} reason=${client.reason}`);
  return { account: { ok: account.ok, status: account.status, reason: account.reason, data: sanitize(account.data) }, clock: { ok: clock.ok, status: clock.status, reason: clock.reason, data: sanitize(clock.data) }, position: { ok: positions.ok, status: positions.status, reason: positions.reason, row: sanitize(position) }, guardMetadataRisk: liveGuardRisk, nestedOpenOrders: { ok: orders.ok, status: orders.status, reason: orders.reason, data: sanitize(openOrders) }, existingClientOrder: { ok: client.ok, status: client.status, reason: client.reason, data: sanitize(client.data) }, protection };
};

const verifyVisibility = async ({ symbol, clientOrderId }) => {
  const orders = await getAlpaca(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const openOrders = Array.isArray(orders.data) ? orders.data : [];
  const flat = flattenOrders(openOrders);
  const matched = flat.find((order) => String(order?.client_order_id || "").trim() === clientOrderId && !isTerminal(order?.status));
  const protection = classifyProtection(openOrders, symbol);
  const ok = orders.ok && Boolean(matched) && protection.hasStop && protection.hasTarget;
  return { ok, status: orders.status, reason: orders.reason, matchedOrder: sanitize(matched), matchedOrderId: matched?.id || null, protection, data: sanitize(openOrders) };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Persistent OCO Repair Submit Report");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- decision: \`${report.decision.status} / ${report.decision.recommendedAction}\``);
  lines.push(`- selected: \`${report.selected?.symbol || "N/A"} qty=${report.selected?.repairQty ?? "N/A"} stop=${report.selected?.plannedStopPrice ?? "N/A"} target=${report.selected?.plannedTargetPrice ?? "N/A"}\``);
  lines.push(`- brokerMutation: \`attempted=${report.brokerMutation.attempted} submitted=${report.brokerMutation.submitted} status=${report.brokerMutation.status ?? "N/A"}\``);
  lines.push(`- visibility: \`ok=${report.postSubmitVisibility?.ok ?? false} persistentOpen=${report.postSubmitVisibility?.persistentOpen ?? false} stop=${report.postSubmitVisibility?.protection?.stopOrderCount ?? "N/A"} target=${report.postSubmitVisibility?.protection?.targetOrderCount ?? "N/A"}\``);
  lines.push(`- idempotency: \`duplicate=${report.idempotency.duplicate} status=${report.idempotency.status || "N/A"} terminal=${report.idempotency.terminal}\``);
  lines.push(`- safety: \`${report.executionPolicy.mode}; target=${report.executionPolicy.targetEnvironment}; autoCancel=${report.executionPolicy.autoCancelEnabled}; tif=${report.executionPolicy.timeInForce || "N/A"}\``);
  lines.push("- gates:");
  for (const gate of report.gates) lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  lines.push("- manual_rollback_plan:");
  for (const item of report.manualRollbackPlan) lines.push(`  - ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const plan = readJson(PLAN_PATH);
  const selected = plan?.selectedCandidate || null;
  const payload = buildPayload(selected);
  const idempotencyKey = selected?.idempotencyKeyPreview || `persistent-oco-repair:${sym(selected?.symbol)}:tif=${PERSISTENT_REPAIR_TIME_IN_FORCE}:qty=${selected?.repairQty}:stop=${selected?.plannedStopPrice}:target=${selected?.plannedTargetPrice}`;
  const readVerifyEnabled = boolEnv("PERSISTENT_OCO_REPAIR_READ_VERIFY", false);
  const submitEnabled = boolEnv("PERSISTENT_OCO_REPAIR_SUBMIT_ENABLED", false);
  const approvalPhraseProvided = process.env.PERSISTENT_OCO_REPAIR_APPROVAL_PHRASE === REQUIRED_APPROVAL_PHRASE;
  const gates = [];
  const preflight = { readVerifyEnabled, broker: null };

  addGate(gates, "plan_present", plan ? "PASS" : "BLOCK", plan ? "persistent OCO repair plan loaded" : "missing persistent-oco-repair-plan.json");
  addGate(gates, "plan_manual_approval_required", plan?.overall === "manual_approval_required" ? "PASS" : "BLOCK", `overall=${plan?.overall || "N/A"}`);
  addGate(gates, "single_selected_row", selected?.symbol ? "PASS" : "BLOCK", selected?.symbol ? `selected=${selected.symbol}` : "no selected persistent repair row");
  addGate(gates, "selector_scope_dynamic", plan?.scope === "portfolio_wide_dynamic_persistent_protection_candidate_not_ticker_specific" ? "PASS" : "BLOCK", `scope=${plan?.scope || "N/A"}`);
  addGate(gates, "selected_row_not_executable_by_default", selected?.executionAllowed === false ? "PASS" : "BLOCK", `executionAllowed=${selected?.executionAllowed ?? "N/A"}`);
  addGate(gates, "repair_qty_one", num(selected?.repairQty) === 1 ? "PASS" : "BLOCK", `repairQty=${selected?.repairQty ?? "N/A"}`);
  addGate(gates, "payload_shape_ready", payload ? "PASS" : "BLOCK", payload ? "OCO payload can be built from selected persistent row" : "selected row lacks symbol/qty/stop/target");
  addGate(gates, "payload_is_oco_exit", payload?.order_class === "oco" && payload?.side === "sell" && payload?.type === "limit" && payload?.qty === "1" ? "PASS" : "BLOCK", `order_class=${payload?.order_class || "N/A"} side=${payload?.side || "N/A"} type=${payload?.type || "N/A"} qty=${payload?.qty || "N/A"}`);
  addGate(gates, "persistent_payload_time_in_force_gtc", payload?.time_in_force === PERSISTENT_REPAIR_TIME_IN_FORCE ? "PASS" : "BLOCK", `time_in_force=${payload?.time_in_force || "N/A"} required=${PERSISTENT_REPAIR_TIME_IN_FORCE}; DAY would expire after the trading day`);
  addGate(gates, "payload_no_notional_no_extended_hours", payload && payload.notional === undefined && payload.extended_hours === undefined ? "PASS" : "BLOCK", "persistent OCO repair must not use notional or extended_hours");
  addGate(gates, "price_geometry_valid", num(selected?.plannedStopPrice) != null && num(selected?.currentPrice) != null && num(selected?.plannedTargetPrice) != null && num(selected?.plannedStopPrice) < num(selected?.currentPrice) && num(selected?.currentPrice) < num(selected?.plannedTargetPrice) ? "PASS" : "BLOCK", `stop=${selected?.plannedStopPrice ?? "N/A"} current=${selected?.currentPrice ?? "N/A"} target=${selected?.plannedTargetPrice ?? "N/A"}`);
  const selectedRisk = selected?.guardMetadataRisk || null;
  addGate(gates, "selected_guard_metadata_fresh", selectedRisk && selectedRisk.stale !== true ? "PASS" : "BLOCK", guardRiskDetail(selectedRisk));
  addGate(gates, "selected_guard_not_near_breached", !guardRiskBlocked(selectedRisk) ? "PASS" : "BLOCK", guardRiskDetail(selectedRisk));
  addGate(gates, "idempotency_key_present", idempotencyKey && !idempotencyKey.includes("undefined") ? "PASS" : "BLOCK", `idempotencyKey=${idempotencyKey || "N/A"}`);
  addGate(gates, "idempotency_not_duplicate", !activeLedgerDuplicate(idempotencyKey) ? "PASS" : "BLOCK", activeLedgerDuplicate(idempotencyKey) ? "persistent submit-ledger already has active duplicate" : "no active persistent submit-ledger duplicate");

  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const env = String(process.env.ALPHA_ENV || "").trim().toUpperCase();
  addGate(gates, "paper_environment_only", !readVerifyEnabled && !submitEnabled ? "PASS" : env === "PAPER" ? "PASS" : "BLOCK", `ALPHA_ENV=${process.env.ALPHA_ENV || "N/A"}`);
  addGate(gates, "paper_base_url_only", !readVerifyEnabled && !submitEnabled ? "PASS" : baseUrl === PAPER_BASE_URL ? "PASS" : "BLOCK", `ALPACA_BASE_URL=${baseUrl || "N/A"}`);
  if (submitEnabled) {
    addGate(gates, "actual_submit_explicitly_enabled", "PASS", "PERSISTENT_OCO_REPAIR_SUBMIT_ENABLED=true");
    addGate(gates, "approval_phrase_present", approvalPhraseProvided ? "PASS" : "BLOCK", `approvalPhraseProvided=${approvalPhraseProvided}`);
    addGate(gates, "read_precheck_required_for_submit", readVerifyEnabled ? "PASS" : "BLOCK", `PERSISTENT_OCO_REPAIR_READ_VERIFY=${readVerifyEnabled}`);
    addGate(gates, "auto_cancel_disabled", "PASS", "persistent repair leaves approved paper OCO open; manual rollback plan is emitted");
  } else {
    addGate(gates, "actual_submit_disabled", "PASS", "no POST /v2/orders unless PERSISTENT_OCO_REPAIR_SUBMIT_ENABLED=true and approval phrase matches");
  }

  const brokerReadEnvOk = !readVerifyEnabled || (env === "PAPER" && baseUrl === PAPER_BASE_URL);
  if (readVerifyEnabled && brokerReadEnvOk) preflight.broker = await runReadPrecheck({ selected, payload, gates });
  else if (readVerifyEnabled) addGate(gates, "broker_read_precheck_not_run", "WARN", "broker read precheck skipped because ALPHA_ENV/ALPACA_BASE_URL are not paper-only");
  else addGate(gates, "broker_read_precheck_not_run", submitEnabled ? "BLOCK" : "WARN", "set PERSISTENT_OCO_REPAIR_READ_VERIFY=true before persistent submit");

  let brokerMutation = { attempted: false, submitted: false, status: null, reason: submitEnabled ? "blocked_before_submit" : "submit_not_requested", response: null };
  let postSubmitVisibility = { attempted: false, ok: false, reason: submitEnabled ? "blocked_before_submit" : "submit_not_requested", persistentOpen: false, protection: null };
  let ledgerStatus = null;
  let blocking = gates.filter((gate) => gate.status === "BLOCK");

  if (submitEnabled && blocking.length === 0) {
    updateLedger(idempotencyKey, { status: "submit_started", reason: "approved_persistent_oco_repair_submit_started", terminal: false, symbol: sym(selected?.symbol), clientOrderId: payload.client_order_id, selected: sanitize(selected), payloadPreview: sanitize(payload), preflight: sanitize(preflight) });
    brokerMutation.attempted = true;
    const post = await postAlpaca("/v2/orders", payload);
    brokerMutation = { attempted: true, submitted: post.ok, status: post.status, reason: post.reason, response: sanitize(post.data) };
    if (!post.ok) {
      ledgerStatus = "submit_rejected";
      updateLedger(idempotencyKey, { status: ledgerStatus, reason: post.reason, terminal: true, brokerResponse: sanitize(post.data) });
      addGate(gates, "broker_post_order", "BLOCK", `POST /v2/orders failed status=${post.status ?? "N/A"} reason=${post.reason}`);
    } else {
      const brokerOrderId = post.data?.id || null;
      updateLedger(idempotencyKey, { status: "submitted", reason: "persistent_paper_oco_repair_post_accepted", terminal: false, brokerOrderId, brokerStatus: post.data?.status || null, brokerResponse: sanitize(post.data) });
      addGate(gates, "broker_post_order", "PASS", `POST /v2/orders accepted status=${post.status ?? "N/A"}`);
      await sleep(Number(process.env.PERSISTENT_OCO_REPAIR_VISIBILITY_DELAY_MS || 1500));
      const visibility = await verifyVisibility({ symbol: sym(selected?.symbol), clientOrderId: payload.client_order_id });
      postSubmitVisibility = { attempted: true, ...visibility, persistentOpen: visibility.ok === true };
      addGate(gates, "post_submit_nested_visibility", visibility.ok ? "PASS" : "BLOCK", `ok=${visibility.ok} stop=${visibility.protection?.stopOrderCount ?? "N/A"} target=${visibility.protection?.targetOrderCount ?? "N/A"}`);
      addGate(gates, "persistent_order_left_open", visibility.ok ? "PASS" : "BLOCK", visibility.ok ? "active OCO protection remains open by design" : "persistent OCO was not visible as active open protection");
      ledgerStatus = visibility.ok ? "persistent_visible_open" : "visibility_failed";
      updateLedger(idempotencyKey, { status: ledgerStatus, reason: visibility.reason, terminal: false, brokerOrderId: brokerOrderId || visibility.matchedOrderId || null, brokerStatus: post.data?.status || null, visibility: sanitize(visibility), manualRollbackRequired: visibility.ok === true });
    }
    blocking = gates.filter((gate) => gate.status === "BLOCK");
  }

  const ledgerEntry = readLedger().entries?.[idempotencyKey] || null;
  const success = brokerMutation.submitted === true && postSubmitVisibility.ok === true && postSubmitVisibility.persistentOpen === true && ledgerEntry?.status === "persistent_visible_open" && ledgerEntry?.terminal !== true;
  const overall = blocking.length > 0 ? (brokerMutation.submitted ? "submitted_with_blocking_followup" : "blocked") : submitEnabled ? (success ? "persistent_submitted_visible_open" : "submitted_review_required") : "ready_but_not_approved";
  const report = {
    generatedAt: nowIso(),
    overall,
    files: { plan: Boolean(plan), submitLedger: fs.existsSync(LEDGER_PATH) },
    executionPolicy: { mode: submitEnabled ? "persistent_oco_repair_submit_approved" : "persistent_oco_repair_submit_gate_non_mutating", brokerMutationAllowedByDefault: false, brokerMutationRequested: submitEnabled, approvalPhraseProvided, requiredApprovalPhrase: REQUIRED_APPROVAL_PHRASE, targetEnvironment: "PAPER", autoCancelEnabled: false, oneRowOnly: true, timeInForce: PERSISTENT_REPAIR_TIME_IN_FORCE, expirationPolicy: "gtc_required_for_persistent_protection_day_orders_expire_after_market_close" },
    selected: selected ? { symbol: selected.symbol || null, repairQty: selected.repairQty ?? null, currentPrice: selected.currentPrice ?? null, plannedStopPrice: selected.plannedStopPrice ?? null, plannedTargetPrice: selected.plannedTargetPrice ?? null, readiness: selected.readiness || null, executionAllowed: selected.executionAllowed, guardMetadataRisk: selected.guardMetadataRisk || null } : null,
    payloadPreview: sanitize(payload),
    idempotency: { ledgerPath: LEDGER_PATH, key: idempotencyKey, duplicate: activeLedgerDuplicate(idempotencyKey), status: ledgerEntry?.status || ledgerStatus, terminal: ledgerEntry?.terminal === true },
    decision: { status: success ? "PERSISTENT_SUBMIT_VISIBLE_OPEN" : blocking.length ? "DO_NOT_SUBMIT_BLOCKED" : submitEnabled ? "SUBMIT_REVIEW_REQUIRED" : "READY_FOR_APPROVAL_BUT_NOT_SUBMITTED", recommendedAction: success ? "MONITOR_OPEN_PROTECTION_OR_MANUAL_ROLLBACK_IF_NEEDED" : "REVIEW_BEFORE_RETRY", requiredApprovalPhrase: REQUIRED_APPROVAL_PHRASE },
    preflight,
    brokerMutation,
    postSubmitVisibility,
    gates,
    summary: { blockingGates: blocking.length, brokerMutationAttempted: brokerMutation.attempted === true, brokerMutationSubmitted: brokerMutation.submitted === true, selectedSymbol: selected?.symbol || null, clientOrderId: payload?.client_order_id || null, persistentOpen: postSubmitVisibility.persistentOpen === true, ledgerStatus: ledgerEntry?.status || ledgerStatus || null, ledgerTerminal: ledgerEntry?.terminal === true },
    manualRollbackPlan: [
      `Alpaca paper UI에서 client_order_id ${payload?.client_order_id || "N/A"} 또는 symbol ${selected?.symbol || "N/A"}의 open OCO sell order를 확인한다.`,
      "수동 롤백이 필요하면 해당 open OCO parent order를 cancel한다. OCO parent cancel 시 child leg도 함께 취소되는지 nested=true로 재확인한다.",
      "두 번째 persistent repair submit은 기존 open protection이 사라졌고 dedicated ledger가 active duplicate를 갖지 않는 것을 확인한 뒤에만 진행한다.",
      "이 lane은 paper-only 한정이며 live promotion과 무관하다."
    ]
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[PERSISTENT_OCO_SUBMIT] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${selected?.symbol || "none"} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted} persistentOpen=${report.summary.persistentOpen}`);
  if (submitEnabled && !success) process.exitCode = 1;
};

main().catch((error) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const report = { generatedAt: nowIso(), overall: "fail", decision: { status: "SCRIPT_ERROR", recommendedAction: "DO_NOT_SUBMIT" }, error: short(error?.stack || error?.message || error, 2000), brokerMutation: { attempted: false, submitted: false, reason: "script_error" }, postSubmitVisibility: { attempted: false, ok: false, persistentOpen: false }, gates: [{ id: "script_error", status: "BLOCK", detail: short(error?.message || error, 320) }], idempotency: { terminal: false }, manualRollbackPlan: ["Do not submit again; inspect script error and Alpaca paper open orders first."] };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.error(`[PERSISTENT_OCO_SUBMIT] FAIL ${short(error?.message || error, 240)}`);
  process.exit(1);
});
