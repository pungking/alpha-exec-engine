import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.PERSISTENT_OCO_REPAIR_VERIFY_STATE_DIR || "state").trim() || "state";
const SUBMIT_DIR = String(process.env.PERSISTENT_OCO_MULTI_SUBMIT_DIR || `${STATE_DIR}/persistent-oco-submit-reports`).trim();
const SUBMIT_REPORTS_CSV = String(process.env.PERSISTENT_OCO_MULTI_SUBMIT_REPORTS || "").trim();
const OUTPUT_JSON = `${STATE_DIR}/persistent-oco-repair-open-verify-multi.json`;
const OUTPUT_MD = `${STATE_DIR}/persistent-oco-repair-open-verify-multi.md`;
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";

const nowIso = () => new Date().toISOString();
const short = (v, n = 500) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const asSymbol = (v) => String(v || "").trim().toUpperCase();
const toNum = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const boolEnv = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};
const readJson = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
};
const addGate = (gates, id, status, detail) => gates.push({ id, status, detail: short(detail, 360) });

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

const isTerminal = (status) => ["filled", "canceled", "cancelled", "expired", "rejected"].includes(String(status ?? "").trim().toLowerCase());
const flattenOrders = (orders, depth = 0) => {
  const out = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== "object") continue;
    out.push({ ...order, _nestedDepth: depth });
    if (Array.isArray(order.legs)) out.push(...flattenOrders(order.legs, depth + 1));
  }
  return out;
};
const activeSellOrdersForSymbol = (orders, symbol) => {
  const target = asSymbol(symbol);
  return flattenOrders(orders).filter((order) => asSymbol(order?.symbol) === target && String(order?.side || "").toLowerCase() === "sell" && !isTerminal(order?.status));
};
const classifyProtection = (orders, symbol) => {
  const activeSell = activeSellOrdersForSymbol(orders, symbol);
  const stopOrders = [];
  const targetOrders = [];
  for (const order of activeSell) {
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop" || toNum(order?.stop_price) != null) stopOrders.push(order);
    if (type === "limit" && toNum(order?.limit_price) != null) targetOrders.push(order);
  }
  const tifValues = [...new Set(activeSell.map((order) => String(order?.time_in_force || "").toLowerCase()).filter(Boolean))].sort();
  return {
    activeSellOrderCount: activeSell.length,
    stopOrderCount: stopOrders.length,
    targetOrderCount: targetOrders.length,
    hasStop: stopOrders.length > 0,
    hasTarget: targetOrders.length > 0,
    ocoParentCount: activeSell.filter((order) => String(order?.order_class || "").toLowerCase() === "oco").length,
    timeInForceValues: tifValues,
    allActiveSellGtc: activeSell.length > 0 && activeSell.every((order) => String(order?.time_in_force || "").toLowerCase() === "gtc")
  };
};
const findPosition = (positions, symbol) => (Array.isArray(positions) ? positions : []).find((row) => asSymbol(row?.symbol) === asSymbol(symbol)) || null;
const findActiveClientOrder = (orders, clientOrderId) => {
  const target = String(clientOrderId || "").trim();
  if (!target) return null;
  return flattenOrders(orders).find((order) => String(order?.client_order_id || "").trim() === target && !isTerminal(order?.status)) || null;
};

const walk = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};
const submitReportPaths = () => {
  const explicit = SUBMIT_REPORTS_CSV
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  return walk(SUBMIT_DIR).filter((filePath) => path.basename(filePath) === "persistent-oco-repair-submit-report.json").sort();
};
const ledgerForReportPath = (reportPath) => {
  const sibling = path.join(path.dirname(reportPath), "persistent-oco-repair-submit-ledger.json");
  if (fs.existsSync(sibling)) return readJson(sibling);
  const stateLedger = `${STATE_DIR}/persistent-oco-repair-submit-ledger.json`;
  return readJson(stateLedger) || { entries: {} };
};

const alpacaGet = async (requestPath) => {
  const fixtureMap = {
    "/v2/account": process.env.PERSISTENT_OCO_MULTI_FIXTURE_ACCOUNT,
    "/v2/clock": process.env.PERSISTENT_OCO_MULTI_FIXTURE_CLOCK,
    "/v2/positions": process.env.PERSISTENT_OCO_MULTI_FIXTURE_POSITIONS,
    "/v2/orders?status=open&nested=true&direction=desc&limit=500": process.env.PERSISTENT_OCO_MULTI_FIXTURE_OPEN_ORDERS
  };
  if (boolEnv("PERSISTENT_OCO_MULTI_USE_FIXTURES", false)) {
    const fixturePath = fixtureMap[requestPath];
    const data = readJson(fixturePath);
    return { ok: data != null, status: data != null ? 200 : null, data, reason: data != null ? "fixture" : `fixture_missing:${requestPath}` };
  }
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = String(process.env.ALPACA_KEY_ID || "").trim();
  const secret = String(process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl) return { ok: false, status: null, data: null, reason: "ALPACA_BASE_URL_missing" };
  if (!keyId || !secret) return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  try {
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret
      }
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

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Persistent OCO Multi Open Verify");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- brokerReadOnly: \`${report.executionPolicy.readOnlyBrokerGetOnly}\``);
  lines.push(`- summary: \`reports=${report.summary.reports} pass=${report.summary.passCount} fail=${report.summary.failCount} symbols=${report.summary.symbols.join(",") || "N/A"} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``);
  lines.push("- rows:");
  for (const row of report.rows) {
    lines.push(`  - ${row.symbol || "N/A"}: overall=${row.overall} clientOrderId=${row.clientOrderId || "N/A"} persistentOpen=${row.persistentOpenVerified} stop=${row.protection.hasStop} target=${row.protection.hasTarget} tif=${row.protection.timeInForceValues.join("/") || "N/A"} gatesBlocked=${row.blockingGates}`);
  }
  lines.push("- gates:");
  for (const gate of report.gates) lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const gates = [];
  const reportPaths = submitReportPaths();
  addGate(gates, "submit_reports_present", reportPaths.length > 0 ? "PASS" : "BLOCK", `count=${reportPaths.length} source=${SUBMIT_REPORTS_CSV ? "csv" : SUBMIT_DIR}`);

  const env = String(process.env.ALPHA_ENV || "").trim().toUpperCase();
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const fixtureMode = boolEnv("PERSISTENT_OCO_MULTI_USE_FIXTURES", false);
  addGate(gates, "paper_environment_only", env === "PAPER" || fixtureMode ? "PASS" : "BLOCK", `ALPHA_ENV=${process.env.ALPHA_ENV || "N/A"} fixtureMode=${fixtureMode}`);
  addGate(gates, "paper_base_url_only", baseUrl === PAPER_BASE_URL || fixtureMode ? "PASS" : "BLOCK", `ALPACA_BASE_URL=${baseUrl || "N/A"} fixtureMode=${fixtureMode}`);

  const account = await alpacaGet("/v2/account");
  addGate(gates, "alpaca_account_read", account.ok ? "PASS" : "BLOCK", account.reason);
  const clock = await alpacaGet("/v2/clock");
  const requireOpen = boolEnv("PERSISTENT_OCO_REPAIR_VERIFY_REQUIRE_MARKET_OPEN", false);
  const isOpen = clock.ok && clock.data && typeof clock.data === "object" ? clock.data.is_open === true : null;
  addGate(gates, "market_clock_read", clock.ok ? "PASS" : "BLOCK", clock.reason);
  addGate(gates, "market_open_requirement", !requireOpen || isOpen === true ? "PASS" : "BLOCK", `requireOpen=${requireOpen} is_open=${isOpen ?? "N/A"}`);

  const positions = await alpacaGet("/v2/positions");
  addGate(gates, "positions_read", positions.ok ? "PASS" : "BLOCK", positions.reason);
  const orders = await alpacaGet("/v2/orders?status=open&nested=true&direction=desc&limit=500");
  const openOrders = Array.isArray(orders.data) ? orders.data : [];
  addGate(gates, "nested_open_orders_read", orders.ok ? "PASS" : "BLOCK", orders.reason);

  const rows = reportPaths.map((reportPath) => {
    const rowGates = [];
    const submitReport = readJson(reportPath);
    const ledger = ledgerForReportPath(reportPath) || { entries: {} };
    const selected = submitReport?.selected || {};
    const symbol = asSymbol(selected.symbol);
    const repairQty = toNum(selected.repairQty);
    const clientOrderId = String(submitReport?.summary?.clientOrderId || submitReport?.payloadPreview?.client_order_id || "").trim();
    const ledgerKey = submitReport?.idempotency?.key || null;
    const ledgerEntry = ledgerKey ? ledger.entries?.[ledgerKey] || null : null;
    const payloadTif = String(submitReport?.payloadPreview?.time_in_force || "").toLowerCase();
    const position = positions.ok ? findPosition(positions.data, symbol) : null;
    const positionQty = toNum(position?.qty);
    const matched = findActiveClientOrder(openOrders, clientOrderId);
    const protection = classifyProtection(openOrders, symbol);

    addGate(rowGates, "submit_report_loaded", submitReport ? "PASS" : "BLOCK", reportPath);
    addGate(rowGates, "prior_submit_visible_open", submitReport?.overall === "persistent_submitted_visible_open" ? "PASS" : "BLOCK", `overall=${submitReport?.overall || "N/A"}`);
    addGate(rowGates, "selected_symbol_present", symbol ? "PASS" : "BLOCK", `symbol=${symbol || "N/A"}`);
    addGate(rowGates, "client_order_id_present", clientOrderId ? "PASS" : "BLOCK", `clientOrderId=${clientOrderId || "N/A"}`);
    addGate(rowGates, "payload_time_in_force_gtc", payloadTif === "gtc" ? "PASS" : "BLOCK", `time_in_force=${payloadTif || "N/A"}`);
    addGate(rowGates, "ledger_visible_open", ledgerEntry?.status === "persistent_visible_open" && ledgerEntry?.terminal !== true ? "PASS" : "BLOCK", `status=${ledgerEntry?.status || submitReport?.idempotency?.status || "N/A"} terminal=${ledgerEntry?.terminal ?? submitReport?.idempotency?.terminal ?? "N/A"}`);
    addGate(rowGates, "selected_symbol_still_held", positions.ok && positionQty != null && positionQty >= repairQty ? "PASS" : "BLOCK", `positionQty=${positionQty ?? "N/A"} repairQty=${repairQty ?? "N/A"}`);
    addGate(rowGates, "active_parent_client_order_visible", matched ? "PASS" : "BLOCK", `clientOrderId=${clientOrderId} active=${Boolean(matched)}`);
    addGate(rowGates, "active_stop_child_visible", protection.hasStop ? "PASS" : "BLOCK", `stopCount=${protection.stopOrderCount}`);
    addGate(rowGates, "active_target_child_visible", protection.hasTarget ? "PASS" : "BLOCK", `targetCount=${protection.targetOrderCount}`);
    addGate(rowGates, "active_sell_orders_gtc", protection.allActiveSellGtc ? "PASS" : "BLOCK", `tif=${protection.timeInForceValues.join(",") || "N/A"}`);

    const blocking = rowGates.filter((gate) => gate.status === "BLOCK");
    return {
      reportPath,
      overall: blocking.length === 0 ? "pass" : "fail",
      symbol,
      repairQty,
      clientOrderId,
      plannedStopPrice: selected.plannedStopPrice ?? null,
      plannedTargetPrice: selected.plannedTargetPrice ?? null,
      payloadTimeInForce: payloadTif || null,
      ledger: {
        key: ledgerKey,
        status: ledgerEntry?.status || submitReport?.idempotency?.status || null,
        terminal: ledgerEntry?.terminal === true || submitReport?.idempotency?.terminal === true
      },
      position: sanitize(position),
      matchedOrder: sanitize(matched),
      protection,
      persistentOpenVerified: blocking.length === 0,
      blockingGates: blocking.length,
      gates: rowGates
    };
  });

  const passCount = rows.filter((row) => row.overall === "pass").length;
  const failCount = rows.length - passCount;
  const globalBlocking = gates.filter((gate) => gate.status === "BLOCK").length;
  const overall = globalBlocking === 0 && failCount === 0 ? "pass" : "fail";
  const symbols = [...new Set(rows.map((row) => row.symbol).filter(Boolean))].sort();
  const report = {
    generatedAt: nowIso(),
    overall,
    files: {
      reportPaths,
      submitReports: reportPaths.length
    },
    executionPolicy: {
      mode: "persistent_oco_repair_open_verify_multi_read_only",
      targetEnvironment: "PAPER",
      readOnlyBrokerGetOnly: true,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      fixtureMode
    },
    broker: {
      account: { ok: account.ok, status: account.status, reason: account.reason, data: sanitize(account.data) },
      clock: { ok: clock.ok, status: clock.status, reason: clock.reason, data: sanitize(clock.data) },
      positions: { ok: positions.ok, status: positions.status, reason: positions.reason, count: Array.isArray(positions.data) ? positions.data.length : null },
      nestedOpenOrders: { ok: orders.ok, status: orders.status, reason: orders.reason, count: openOrders.length }
    },
    rows,
    gates,
    summary: {
      reports: rows.length,
      passCount,
      failCount,
      symbols,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      persistentOpenVerified: overall === "pass"
    }
  };

  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[PERSISTENT_OCO_MULTI_OPEN_VERIFY] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} reports=${rows.length} pass=${passCount} fail=${failCount}`);
  if (overall !== "pass") process.exitCode = 1;
};

main().catch((error) => {
  const report = {
    generatedAt: nowIso(),
    overall: "fail",
    executionPolicy: {
      mode: "persistent_oco_repair_open_verify_multi_read_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    error: short(error?.stack || error?.message || error, 2000),
    rows: [],
    gates: [{ id: "script_error", status: "BLOCK", detail: short(error?.message || error, 320) }],
    summary: {
      reports: 0,
      passCount: 0,
      failCount: 1,
      symbols: [],
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      persistentOpenVerified: false
    }
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.error(`[PERSISTENT_OCO_MULTI_OPEN_VERIFY] FAIL ${short(error?.message || error, 240)}`);
  process.exit(1);
});
