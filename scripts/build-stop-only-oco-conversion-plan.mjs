import fs from "node:fs";
import { createHash } from "node:crypto";

const STATE_DIR = String(process.env.STOP_ONLY_OCO_CONVERSION_STATE_DIR || "state").trim() || "state";
const RECON_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const OUTPUT_JSON = `${STATE_DIR}/stop-only-oco-conversion-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/stop-only-oco-conversion-plan.md`;
const TIME_IN_FORCE = "gtc";
const MAX_QTY = Math.max(1, Math.trunc(Number(process.env.STOP_ONLY_OCO_CONVERSION_MAX_QTY || "1") || 1));

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
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const sym = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const bool = (value) => value === true;
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

const fingerprint = ({ symbol, repairQty, stopPrice, targetPrice }) =>
  createHash("sha256")
    .update(`${symbol}|${TIME_IN_FORCE}|${repairQty}|${stopPrice}|${targetPrice}`)
    .digest("hex")
    .slice(0, 8);

const clientOrderId = ({ symbol, repairQty, stopPrice, targetPrice }) =>
  `oco_convert_${symbol.toLowerCase()}_${TIME_IN_FORCE}_${fingerprint({ symbol, repairQty, stopPrice, targetPrice })}_q${repairQty}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 48);

const rowIsSidecarManagedFilled = (row) => {
  const ownership = String(row?.ownershipClassification || "").toUpperCase();
  const fillState = String(row?.normalizedFillState || "").toLowerCase();
  const reconStatus = String(row?.fillStateReconciliation?.status || "").toLowerCase();
  return (
    ownership === "SIDECAR_MANAGED_FILLED" ||
    (row?.sidecarManaged === true && fillState === "filled") ||
    (ownership.startsWith("SIDECAR_MANAGED") && (fillState === "filled" || reconStatus === "confirmed_filled"))
  );
};

const classifyRow = (row) => {
  const symbol = sym(row?.symbol);
  const qty = toNum(row?.qty);
  const repairQty = qty != null ? Math.min(Math.trunc(qty), MAX_QTY) : null;
  const currentPrice = toNum(row?.currentPrice);
  const stopPrice = toNum(row?.effectiveStopPrice ?? row?.plannedStopPrice);
  const targetPrice = toNum(row?.effectiveTargetPrice ?? row?.plannedTargetPrice);
  const brokerStopPresent = bool(row?.brokerStopPresent);
  const brokerTargetPresent = bool(row?.brokerTargetPresent);
  const stopChildMissing = bool(row?.stopChildMissing);
  const targetChildMissing = bool(row?.targetChildMissing);
  const stopOnlyTargetPresent = stopChildMissing && !targetChildMissing && !brokerStopPresent && brokerTargetPresent;
  const sidecarManagedFilled = rowIsSidecarManagedFilled(row);
  const stopBelowCurrent = stopPrice != null && currentPrice != null && stopPrice < currentPrice;
  const targetAboveCurrent = targetPrice != null && currentPrice != null && currentPrice < targetPrice;
  const targetAboveStop = stopPrice != null && targetPrice != null && stopPrice < targetPrice;
  const geometryValid = stopBelowCurrent && targetAboveCurrent && targetAboveStop;
  const blockers = [];

  if (!symbol) blockers.push("missing_symbol");
  if (!stopOnlyTargetPresent) blockers.push("not_stop_only_target_present_pattern");
  if (!sidecarManagedFilled) blockers.push("not_sidecar_managed_filled_position");
  if (row?.fillStateReconciliation?.repairBlocked === true) blockers.push("fill_state_reconciliation_required");
  if (!repairQty || repairQty < 1) blockers.push("invalid_repair_qty");
  if (!geometryValid) blockers.push("invalid_stop_current_target_geometry");
  if (row?.guardMetadataMissing === true) blockers.push("guard_metadata_missing");

  const reviewReady = blockers.length === 0;
  const newOcoPayloadPreview = reviewReady
    ? {
      symbol,
      side: "sell",
      type: "limit",
      time_in_force: TIME_IN_FORCE,
      order_class: "oco",
      qty: qtyString(repairQty),
      take_profit: { limit_price: priceString(targetPrice) },
      stop_loss: { stop_price: priceString(stopPrice) },
      client_order_id: clientOrderId({ symbol, repairQty, stopPrice, targetPrice })
    }
    : null;

  return {
    symbol,
    sourceProtectionStatus: row?.protectionStatus || null,
    sourceSeverity: row?.severity || null,
    qty,
    repairQty,
    currentPrice,
    stopPrice,
    targetPrice,
    stopChildMissing,
    targetChildMissing,
    brokerStopPresent,
    brokerTargetPresent,
    brokerSellOrderCount: toNum(row?.brokerSellOrderCount) ?? null,
    brokerNestedSellOrderCount: toNum(row?.brokerNestedSellOrderCount) ?? null,
    existingTargetChildConfirmed: brokerTargetPresent && !targetChildMissing,
    existingTargetOrderReference: row?.brokerTargetOrderId || row?.targetOrderId || null,
    existingTargetOrderReferenceQuality: row?.brokerTargetOrderId || row?.targetOrderId
      ? "target_order_id_captured"
      : brokerTargetPresent
        ? "target_present_but_order_id_not_captured_in_reconciliation"
        : "target_not_present",
    sidecarManagedFilled,
    normalizedFillState: row?.normalizedFillState || null,
    ownershipClassification: row?.ownershipClassification || null,
    fillStateReconciliation: row?.fillStateReconciliation || null,
    effectiveGuardSource: row?.effectiveGuardSource || null,
    plannedStage6Hash: row?.plannedStage6Hash || null,
    plannedStage6File: row?.plannedStage6File || null,
    plannedLedgerKey: row?.plannedLedgerKey || null,
    plannedLedgerUpdatedAt: row?.plannedLedgerUpdatedAt || null,
    geometry: {
      stopBelowCurrent,
      targetAboveCurrent,
      targetAboveStop,
      valid: geometryValid
    },
    conversionPattern: stopOnlyTargetPresent ? "stop_missing_target_present" : "not_stop_only_conversion_candidate",
    conversionDecision: reviewReady
      ? "REPORT_ONLY_OCO_CONVERSION_REVIEW_READY"
      : "BLOCKED",
    blockers,
    standaloneStopAllowed: false,
    cancelExistingTargetRequired: reviewReady,
    newOcoSubmitRequired: reviewReady,
    readyForBrokerSubmit: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    idempotencyKeyPreview: reviewReady
      ? `stop-only-oco-conversion:${symbol}:tif=${TIME_IN_FORCE}:qty=${repairQty}:stop=${stopPrice}:target=${targetPrice}`
      : null,
    newOcoPayloadPreview,
    riskWindow: reviewReady
      ? [
        "cancel_existing_target_before_new_oco_creates_temporary_unprotected_gap",
        "submit_new_gtc_oco_must_follow_cancel_only_after_explicit_approval",
        "nested_visibility_must_confirm_target_and_stop_after_conversion",
        "do_not_submit_second_conversion_while_idempotency_key_is_active"
      ]
      : [],
    nestedVisibilityPlan: reviewReady
      ? [
        "GET open orders with nested=true before any approved mutation",
        "confirm existing target child or target sell order is still open",
        "if approved, cancel existing target parent/order before new OCO submit",
        "after approved submit, GET open orders nested=true and confirm stop+target present"
      ]
      : [],
    rollbackPlan: reviewReady
      ? [
        "If approval is not granted, do nothing.",
        "If approved cancel succeeds but OCO submit fails, manually recreate protective target or submit a reviewed OCO immediately.",
        "If approved OCO submit succeeds but is wrong, manually cancel the OCO parent in Alpaca paper and re-run nested=true verification.",
        "Do not retry conversion until broker open orders and idempotency state show no active duplicate."
      ]
      : [],
    reason: reviewReady
      ? "sidecar-managed filled position has target child present but stop child missing; standalone stop submit is prohibited; review cancel+new GTC OCO conversion only"
      : `blocked:${blockers.join(",") || "not_applicable"}`
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Stop-Only OCO Conversion Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push("- safety: `report-only; no broker mutation; standalone stop submit disabled; conversion requires CONFIRM LIVE EXECUTION`");
  lines.push(`- summary: \`rows=${report.summary.rows} reviewReady=${report.summary.reviewReady} blocked=${report.summary.blocked} selected=${report.summary.selectedSymbol || "N/A"} mutationAttempted=false mutationSubmitted=false\``);
  lines.push("| Symbol | Decision | Pattern | Ownership | Fill | Qty | Stop | Target | Target Present | Cancel+New OCO | Blockers |");
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(`| ${row.symbol || "N/A"} | ${row.conversionDecision} | ${row.conversionPattern} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || row.normalizedFillState || "N/A"} | ${row.repairQty ?? "N/A"} | ${row.stopPrice ?? "N/A"} | ${row.targetPrice ?? "N/A"} | ${row.existingTargetChildConfirmed ? "yes" : "no"} | ${row.cancelExistingTargetRequired && row.newOcoSubmitRequired ? "review_ready" : "no"} | ${short(row.blockers.join(",") || "none", 180)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const recon = readJson(RECON_PATH);
  const sourceRows = Array.isArray(recon?.rows) ? recon.rows : [];
  const rows = sourceRows.map(classifyRow).filter((row) => row.symbol);
  const reviewRows = rows.filter((row) => row.conversionDecision === "REPORT_ONLY_OCO_CONVERSION_REVIEW_READY");
  reviewRows.sort((a, b) => {
    const an = (a.currentPrice ?? Number.POSITIVE_INFINITY) * (a.repairQty ?? 1);
    const bn = (b.currentPrice ?? Number.POSITIVE_INFINITY) * (b.repairQty ?? 1);
    if (an !== bn) return an - bn;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
  const selected = reviewRows[0] || null;
  const report = {
    generatedAt: new Date().toISOString(),
    overall: selected ? "manual_review_required" : "no_stop_only_conversion_candidate",
    scope: "symbol_agnostic_stop_missing_target_present_oco_conversion_review",
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      standaloneStopAllowed: false,
      conversionRequiresCancelAndNewGtcOco: true,
      targetEnvironment: "PAPER",
      timeInForce: TIME_IN_FORCE,
      requiredApprovalPhrase: "CONFIRM LIVE EXECUTION"
    },
    selectedCandidate: selected,
    rows,
    summary: {
      rows: rows.length,
      reviewReady: reviewRows.length,
      selectedSymbol: selected?.symbol || null,
      blocked: rows.filter((row) => row.conversionDecision !== "REPORT_ONLY_OCO_CONVERSION_REVIEW_READY").length,
      stopOnlyTargetPresent: rows.filter((row) => row.conversionPattern === "stop_missing_target_present").length,
      targetPresentOrderIdCaptured: rows.filter((row) => row.existingTargetOrderReferenceQuality === "target_order_id_captured").length,
      targetPresentWithoutOrderId: rows.filter((row) => row.existingTargetOrderReferenceQuality === "target_present_but_order_id_not_captured_in_reconciliation").length,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    source: {
      brokerChildReconciliationOverall: recon?.overall || null,
      brokerChildReconciliationGeneratedAt: recon?.generatedAt || null
    },
    nextAction: selected
      ? "prepare an approval-gated cancel existing target + submit new GTC OCO conversion lane for exactly one selected dynamic row; do not mutate before approval"
      : "continue report-only monitoring; no standalone stop submit"
  };

  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[STOP_ONLY_OCO_CONVERSION_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} selected=${selected?.symbol || "none"}`);
};

main();
