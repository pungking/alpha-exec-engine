import fs from "node:fs";

const STATE_DIR = String(process.env.PERSISTENT_OCO_REPAIR_STATE_DIR || "state").trim() || "state";
const RECON_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const OUTPUT_JSON = `${STATE_DIR}/persistent-oco-repair-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/persistent-oco-repair-plan.md`;

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
const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const priceString = (value) => {
  const n = toNum(value);
  if (n == null || n <= 0) return null;
  return n.toFixed(n >= 1 ? 2 : 4);
};
const qtyString = (value) => {
  const n = toNum(value);
  if (n == null || n <= 0) return null;
  return String(Math.trunc(n));
};

const maxQty = Math.max(1, Math.trunc(Number(process.env.PERSISTENT_OCO_REPAIR_MAX_QTY || "1") || 1));
const recon = readJson(RECON_PATH);
const rows = Array.isArray(recon?.rows) ? recon.rows : [];
const candidates = rows
  .map((row) => {
    const symbol = asSymbol(row?.symbol);
    const qty = toNum(row?.qty);
    const plannedStop = toNum(row?.plannedStopPrice);
    const plannedTarget = toNum(row?.plannedTargetPrice);
    const current = toNum(row?.currentPrice);
    const bothMissing = row?.stopChildMissing === true && row?.targetChildMissing === true;
    const filled = String(row?.normalizedFillState || "").toLowerCase() === "filled";
    const guardOk = row?.guardMetadataMissing !== true;
    const geometryOk = plannedStop != null && current != null && plannedTarget != null && plannedStop < current && current < plannedTarget;
    const repairQty = qty != null ? Math.min(Math.trunc(qty), maxQty) : null;
    const blockers = [];
    if (!symbol) blockers.push("missing_symbol");
    if (!filled) blockers.push("position_not_filled");
    if (!bothMissing) blockers.push("requires_stop_and_target_missing");
    if (!guardOk) blockers.push("guard_metadata_missing");
    if (!geometryOk) blockers.push("invalid_stop_current_target_geometry");
    if (!repairQty || repairQty < 1) blockers.push("invalid_repair_qty");
    const payloadPreview = blockers.length === 0
      ? {
        symbol,
        side: "sell",
        type: "limit",
        time_in_force: "day",
        order_class: "oco",
        qty: qtyString(repairQty),
        take_profit: { limit_price: priceString(plannedTarget) },
        stop_loss: { stop_price: priceString(plannedStop) },
        client_order_id: `persistent_oco_${symbol.toLowerCase()}_q${repairQty}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48)
      }
      : null;
    return {
      symbol,
      sourceStatus: row?.protectionStatus || null,
      severity: row?.severity || null,
      qty,
      repairQty,
      currentPrice: current,
      plannedStopPrice: plannedStop,
      plannedTargetPrice: plannedTarget,
      stopChildMissing: row?.stopChildMissing === true,
      targetChildMissing: row?.targetChildMissing === true,
      brokerSellOrderCount: row?.brokerSellOrderCount ?? null,
      normalizedFillState: row?.normalizedFillState || null,
      blockers,
      readiness: blockers.length === 0 ? "PERSISTENT_REPAIR_READY_FOR_APPROVAL" : "BLOCKED",
      executionAllowed: false,
      autoCancel: false,
      payloadPreview,
      idempotencyKeyPreview: payloadPreview ? `persistent-oco-repair:${symbol}:qty=${repairQty}:stop=${plannedStop}:target=${plannedTarget}` : null,
      reason: blockers.length ? `blocked:${blockers.join(",")}` : "paper-only persistent OCO repair candidate; broker mutation requires separate exact approval"
    };
  })
  .filter((row) => row.symbol);

const eligible = candidates.filter((row) => row.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL");
eligible.sort((a, b) => {
  const an = (a.currentPrice ?? Number.POSITIVE_INFINITY) * (a.repairQty ?? 1);
  const bn = (b.currentPrice ?? Number.POSITIVE_INFINITY) * (b.repairQty ?? 1);
  if (an !== bn) return an - bn;
  return String(a.symbol).localeCompare(String(b.symbol));
});
const selected = eligible[0] || null;
const overall = selected ? "manual_approval_required" : "blocked_no_eligible_row";
const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "portfolio_wide_dynamic_persistent_protection_candidate_not_ticker_specific",
  executionPolicy: {
    mode: "persistent_oco_repair_plan_report_only",
    targetEnvironment: "PAPER",
    brokerMutationAllowed: false,
    autoCancel: false,
    oneRowOnly: true,
    maxQty,
    requiredApprovalPhrase: "CONFIRM LIVE EXECUTION"
  },
  selectedCandidate: selected,
  rows: candidates,
  summary: {
    rows: candidates.length,
    eligible: eligible.length,
    selectedSymbol: selected?.symbol || null,
    selectedRepairQty: selected?.repairQty ?? null,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false
  },
  nextAction: selected
    ? "request a separate approved paper-only persistent OCO repair submit for the selected row; no auto-cancel"
    : "wait for an eligible filled position with both stop and target child missing"
};

const md = [
  "## Persistent OCO Repair Plan",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${String(report.overall).toUpperCase()}\``,
  `- scope: \`${report.scope}\``,
  `- selected: \`${selected ? `${selected.symbol} qty=${selected.repairQty} stop=${selected.plannedStopPrice} target=${selected.plannedTargetPrice}` : "N/A"}\``,
  "- safety: `report-only plan; PAPER only; one row only; no auto-cancel; no POST unless separately approved`",
  "- rows:",
  ...candidates.map((row) => `  - ${row.symbol}: ${row.readiness} qty=${row.qty} repairQty=${row.repairQty ?? "N/A"} blockers=${short(row.blockers.join(",") || "none", 180)}`),
  ""
].join("\n");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${md}\n`, "utf8");
console.log(`[PERSISTENT_OCO_REPAIR_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${selected?.symbol || "none"}`);
