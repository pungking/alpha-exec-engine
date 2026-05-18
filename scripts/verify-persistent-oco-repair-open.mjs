import fs from "node:fs";

const STATE_DIR = String(process.env.PERSISTENT_OCO_REPAIR_VERIFY_STATE_DIR || process.env.PERSISTENT_OCO_REPAIR_SUBMIT_STATE_DIR || "state").trim() || "state";
const SUBMIT_REPORT_PATH = `${STATE_DIR}/persistent-oco-repair-submit-report.json`;
const LEDGER_PATH = `${STATE_DIR}/persistent-oco-repair-submit-ledger.json`;
const OUTPUT_JSON = `${STATE_DIR}/persistent-oco-repair-open-verify.json`;
const OUTPUT_MD = `${STATE_DIR}/persistent-oco-repair-open-verify.md`;
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
const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (path, payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
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
const classifyProtection = (orders, symbol) => {
  const target = asSymbol(symbol);
  const activeSell = flattenOrders(orders).filter((order) => asSymbol(order?.symbol) === target && String(order?.side || "").toLowerCase() === "sell" && !isTerminal(order?.status));
  const stopOrders = [];
  const targetOrders = [];
  for (const order of activeSell) {
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop" || toNum(order?.stop_price) != null) stopOrders.push(order);
    if (type === "limit" && toNum(order?.limit_price) != null) targetOrders.push(order);
  }
  return {
    activeSellOrderCount: activeSell.length,
    stopOrderCount: stopOrders.length,
    targetOrderCount: targetOrders.length,
    hasStop: stopOrders.length > 0,
    hasTarget: targetOrders.length > 0,
    ocoParentCount: activeSell.filter((order) => String(order?.order_class || "").toLowerCase() === "oco").length
  };
};

const alpacaGet = async (path) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = String(process.env.ALPACA_KEY_ID || "").trim();
  const secret = String(process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl) return { ok: false, status: null, data: null, reason: "ALPACA_BASE_URL_missing" };
  if (!keyId || !secret) return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  try {
    const response = await fetch(`${baseUrl}${path}`, {
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

const findPosition = (positions, symbol) => (Array.isArray(positions) ? positions : []).find((row) => asSymbol(row?.symbol) === asSymbol(symbol)) || null;
const findActiveClientOrder = (orders, clientOrderId) => {
  const target = String(clientOrderId || "").trim();
  if (!target) return null;
  return flattenOrders(orders).find((order) => String(order?.client_order_id || "").trim() === target && !isTerminal(order?.status)) || null;
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Persistent OCO Repair Open Verify");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- selected: \`${report.selected.symbol || "N/A"} qty=${report.selected.repairQty ?? "N/A"} clientOrderId=${report.selected.clientOrderId || "N/A"}\``);
  lines.push(`- brokerReadOnly: \`${report.executionPolicy.readOnlyBrokerGetOnly}\``);
  lines.push(`- protection: \`activeSell=${report.protection.activeSellOrderCount} stop=${report.protection.stopOrderCount} target=${report.protection.targetOrderCount} hasStop=${report.protection.hasStop} hasTarget=${report.protection.hasTarget}\``);
  lines.push(`- ledger: \`status=${report.ledger.status || "N/A"} terminal=${report.ledger.terminal}\``);
  lines.push("- gates:");
  for (const gate of report.gates) lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  lines.push("- manual_rollback_plan:");
  for (const item of report.manualRollbackPlan) lines.push(`  - ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const gates = [];
  const submitReport = readJson(SUBMIT_REPORT_PATH);
  const ledger = readJson(LEDGER_PATH) || { entries: {} };
  const selected = submitReport?.selected || {};
  const symbol = asSymbol(selected.symbol);
  const repairQty = toNum(selected.repairQty);
  const clientOrderId = String(submitReport?.summary?.clientOrderId || submitReport?.payloadPreview?.client_order_id || "").trim();
  const ledgerKey = submitReport?.idempotency?.key || null;
  const ledgerEntry = ledgerKey ? ledger.entries?.[ledgerKey] || null : null;

  addGate(gates, "submit_report_present", submitReport ? "PASS" : "BLOCK", submitReport ? "persistent submit report loaded" : "missing persistent-oco-repair-submit-report.json");
  addGate(gates, "prior_submit_visible_open", submitReport?.overall === "persistent_submitted_visible_open" ? "PASS" : "BLOCK", `overall=${submitReport?.overall || "N/A"}`);
  addGate(gates, "selected_symbol_present", symbol ? "PASS" : "BLOCK", `symbol=${symbol || "N/A"}`);
  addGate(gates, "client_order_id_present", clientOrderId ? "PASS" : "BLOCK", `clientOrderId=${clientOrderId || "N/A"}`);
  addGate(gates, "ledger_visible_open", ledgerEntry?.status === "persistent_visible_open" && ledgerEntry?.terminal !== true ? "PASS" : "BLOCK", `status=${ledgerEntry?.status || "N/A"} terminal=${ledgerEntry?.terminal ?? "N/A"}`);

  const env = String(process.env.ALPHA_ENV || "").trim().toUpperCase();
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  addGate(gates, "paper_environment_only", env === "PAPER" ? "PASS" : "BLOCK", `ALPHA_ENV=${process.env.ALPHA_ENV || "N/A"}`);
  addGate(gates, "paper_base_url_only", baseUrl === PAPER_BASE_URL ? "PASS" : "BLOCK", `ALPACA_BASE_URL=${baseUrl || "N/A"}`);

  const account = await alpacaGet("/v2/account");
  addGate(gates, "alpaca_account_read", account.ok ? "PASS" : "BLOCK", account.reason);
  const clock = await alpacaGet("/v2/clock");
  const requireOpen = boolEnv("PERSISTENT_OCO_REPAIR_VERIFY_REQUIRE_MARKET_OPEN", false);
  const isOpen = clock.ok && clock.data && typeof clock.data === "object" ? clock.data.is_open === true : null;
  addGate(gates, "market_clock_read", clock.ok ? "PASS" : "BLOCK", clock.reason);
  addGate(gates, "market_open_requirement", !requireOpen || isOpen === true ? "PASS" : "BLOCK", `requireOpen=${requireOpen} is_open=${isOpen ?? "N/A"}`);

  const positions = await alpacaGet("/v2/positions");
  const position = positions.ok ? findPosition(positions.data, symbol) : null;
  const positionQty = toNum(position?.qty);
  addGate(gates, "selected_symbol_still_held", positions.ok && positionQty != null && positionQty >= repairQty ? "PASS" : "BLOCK", `positionQty=${positionQty ?? "N/A"} repairQty=${repairQty ?? "N/A"}`);

  const orders = await alpacaGet(`/v2/orders?status=open&nested=true&symbols=${encodeURIComponent(symbol)}&direction=desc&limit=50`);
  const openOrders = Array.isArray(orders.data) ? orders.data : [];
  const matched = findActiveClientOrder(openOrders, clientOrderId);
  const protection = classifyProtection(openOrders, symbol);
  addGate(gates, "nested_open_orders_read", orders.ok ? "PASS" : "BLOCK", orders.reason);
  addGate(gates, "active_parent_client_order_visible", matched ? "PASS" : "BLOCK", `clientOrderId=${clientOrderId} active=${Boolean(matched)}`);
  addGate(gates, "active_stop_child_visible", protection.hasStop ? "PASS" : "BLOCK", `stopCount=${protection.stopOrderCount}`);
  addGate(gates, "active_target_child_visible", protection.hasTarget ? "PASS" : "BLOCK", `targetCount=${protection.targetOrderCount}`);

  const blocking = gates.filter((gate) => gate.status === "BLOCK");
  const overall = blocking.length === 0 ? "pass" : "fail";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    files: {
      submitReport: Boolean(submitReport),
      submitLedger: Boolean(ledger)
    },
    executionPolicy: {
      mode: "persistent_oco_repair_open_verify_read_only",
      targetEnvironment: "PAPER",
      readOnlyBrokerGetOnly: true,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    selected: {
      symbol,
      repairQty,
      clientOrderId,
      plannedStopPrice: selected.plannedStopPrice ?? null,
      plannedTargetPrice: selected.plannedTargetPrice ?? null
    },
    ledger: {
      key: ledgerKey,
      status: ledgerEntry?.status || null,
      terminal: ledgerEntry?.terminal === true,
      brokerOrderId: ledgerEntry?.brokerOrderId || null
    },
    broker: {
      account: { ok: account.ok, status: account.status, reason: account.reason, data: sanitize(account.data) },
      clock: { ok: clock.ok, status: clock.status, reason: clock.reason, data: sanitize(clock.data) },
      position: { ok: positions.ok, status: positions.status, reason: positions.reason, row: sanitize(position) },
      nestedOpenOrders: { ok: orders.ok, status: orders.status, reason: orders.reason, data: sanitize(openOrders) },
      matchedOrder: sanitize(matched)
    },
    protection,
    gates,
    summary: {
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      persistentOpenVerified: overall === "pass",
      blockingGates: blocking.length
    },
    manualRollbackPlan: [
      `Alpaca paper UI에서 client_order_id ${clientOrderId || "N/A"} 또는 symbol ${symbol || "N/A"}의 open OCO sell order를 확인한다.`,
      "수동 롤백이 필요하면 해당 open OCO parent order를 cancel한다. OCO parent cancel 시 child leg도 함께 취소되는지 nested=true로 재확인한다.",
      "취소 후 이 verifier를 다시 실행하면 active_parent_client_order_visible / stop / target gate가 BLOCK으로 바뀌어야 한다.",
      "이 검증 lane은 GET-only이며 POST/DELETE를 호출하지 않는다."
    ]
  };

  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[PERSISTENT_OCO_OPEN_VERIFY] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${symbol || "none"} persistentOpen=${report.summary.persistentOpenVerified}`);
  if (overall !== "pass") process.exitCode = 1;
};

main().catch((error) => {
  const report = {
    generatedAt: nowIso(),
    overall: "fail",
    executionPolicy: {
      mode: "persistent_oco_repair_open_verify_read_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    error: short(error?.stack || error?.message || error, 2000),
    gates: [{ id: "script_error", status: "BLOCK", detail: short(error?.message || error, 320) }],
    manualRollbackPlan: ["Do not mutate broker state from this verifier; inspect script error first."]
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown({ ...report, selected: {}, ledger: {}, protection: {} }), "utf8");
  console.error(`[PERSISTENT_OCO_OPEN_VERIFY] FAIL ${short(error?.message || error, 240)}`);
  process.exit(1);
});
