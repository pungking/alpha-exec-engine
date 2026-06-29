import fs from "node:fs";
import { createHash } from "node:crypto";
import { evaluateGuardMetadataRisk } from "./lib/guard-metadata-risk.mjs";

const STATE_DIR = String(process.env.PERSISTENT_OCO_REPAIR_STATE_DIR || "state").trim() || "state";
const RECON_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const LIFECYCLE_GUARD_SOURCE_PATH = `${STATE_DIR}/position-lifecycle-guard-source-plan.json`;
const OUTPUT_JSON = `${STATE_DIR}/persistent-oco-repair-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/persistent-oco-repair-plan.md`;
const PERSISTENT_REPAIR_TIME_IN_FORCE = "gtc";

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
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
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
const payloadFingerprint = ({ symbol, repairQty, plannedStop, plannedTarget }) => {
  const source = `${symbol}|${PERSISTENT_REPAIR_TIME_IN_FORCE}|${repairQty}|${plannedStop}|${plannedTarget}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 8);
};
const clientOrderId = ({ symbol, repairQty, plannedStop, plannedTarget }) => {
  const fingerprint = payloadFingerprint({ symbol, repairQty, plannedStop, plannedTarget });
  return `persistent_oco_${symbol.toLowerCase()}_${PERSISTENT_REPAIR_TIME_IN_FORCE}_${fingerprint}_q${repairQty}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 48);
};

const maxQty = Math.max(1, Math.trunc(Number(process.env.PERSISTENT_OCO_REPAIR_MAX_QTY || "1") || 1));
const recon = readJson(RECON_PATH);
const lifecyclePlan = readJson(LIFECYCLE_GUARD_SOURCE_PATH);
const rows = Array.isArray(recon?.rows) ? recon.rows : [];
const lifecycleBySymbol = new Map((Array.isArray(lifecyclePlan?.rows) ? lifecyclePlan.rows : []).map((row) => [asSymbol(row?.symbol), row]));
const candidates = rows
  .map((row) => {
    const symbol = asSymbol(row?.symbol);
    const lifecycleRow = lifecycleBySymbol.get(symbol) || null;
    const lifecycleSource = lifecycleRow?.lifecycleReady === true ? lifecycleRow.lifecycleSource : null;
    const qty = toNum(row?.qty);
    const plannedStop = toNum(lifecycleSource?.stopPrice ?? row?.plannedStopPrice);
    const plannedTarget = toNum(lifecycleSource?.targetPrice ?? row?.plannedTargetPrice);
    const effectiveStop = toNum(lifecycleSource?.stopPrice ?? row?.effectiveStopPrice ?? row?.plannedStopPrice);
    const effectiveTarget = toNum(lifecycleSource?.targetPrice ?? row?.effectiveTargetPrice ?? row?.plannedTargetPrice);
    const current = toNum(row?.currentPrice);
    const stopMissing = row?.stopChildMissing === true;
    const targetMissing = row?.targetChildMissing === true;
    const bothMissing = stopMissing && targetMissing;
    const brokerSellOrderCount = toNum(row?.brokerSellOrderCount) ?? 0;
    const brokerStopPresent = row?.brokerStopPresent === true;
    const brokerTargetPresent = row?.brokerTargetPresent === true;
    const stopOnlyMissing = stopMissing && !targetMissing && brokerTargetPresent;
    const brokerChildrenComplete = brokerStopPresent && brokerTargetPresent;
    const filled = String(row?.normalizedFillState || "").toLowerCase() === "filled";
    const guardOk = row?.guardMetadataMissing !== true;
    const stopBelowCurrent = effectiveStop != null && current != null && effectiveStop < current;
    const targetAboveCurrent = effectiveTarget != null && current != null && current < effectiveTarget;
    const geometryOk = stopBelowCurrent && targetAboveCurrent;
    const guardMetadataGeneratedAt = lifecycleSource?.generatedAt || row?.effectiveGuardGeneratedAt || row?.plannedLedgerUpdatedAt || recon?.generatedAt || null;
    const rawGuardMetadataRisk = evaluateGuardMetadataRisk({
      generatedAt: guardMetadataGeneratedAt,
      currentPrice: current,
      plannedStopPrice: effectiveStop,
      plannedTargetPrice: effectiveTarget
    });
    const guardMetadataRisk = brokerChildrenComplete
      ? {
        ...rawGuardMetadataRisk,
        stale: false,
        blockers: rawGuardMetadataRisk.blockers.filter((blocker) => blocker !== "guard_metadata_stale"),
        status: rawGuardMetadataRisk.blockers.filter((blocker) => blocker !== "guard_metadata_stale").length ? "BLOCK" : "PASS"
      }
      : rawGuardMetadataRisk;
    const repairQty = qty != null ? Math.min(Math.trunc(qty), maxQty) : null;
    const blockers = [];
    if (!symbol) blockers.push("missing_symbol");
    if (brokerChildrenComplete) {
      blockers.push("broker_children_already_present");
    } else {
      if (row?.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION") blockers.push("position_not_sidecar_managed");
      if (row?.fillStateReconciliation?.repairBlocked === true && row?.ownershipClassification !== "EXTERNAL_OR_MANUAL_POSITION") {
        blockers.push("fill_state_reconciliation_required");
      }
      if (!filled) blockers.push("position_not_filled");
      if (!bothMissing) blockers.push(stopOnlyMissing ? "stop_only_repair_requires_separate_lane" : "requires_stop_and_target_missing");
      if (bothMissing && brokerSellOrderCount > 0) blockers.push("broker_sell_order_count_conflicts_with_missing_children");
      if (!guardOk) blockers.push("guard_metadata_missing");
      if (!geometryOk) blockers.push("invalid_stop_current_target_geometry");
      blockers.push(...guardMetadataRisk.blockers);
      if (!repairQty || repairQty < 1) blockers.push("invalid_repair_qty");
    }
    const payloadPreview = blockers.length === 0
      ? {
        symbol,
        side: "sell",
        type: "limit",
        time_in_force: PERSISTENT_REPAIR_TIME_IN_FORCE,
        order_class: "oco",
        qty: qtyString(repairQty),
        take_profit: { limit_price: priceString(effectiveTarget) },
        stop_loss: { stop_price: priceString(effectiveStop) },
        client_order_id: clientOrderId({ symbol, repairQty, plannedStop: effectiveStop, plannedTarget: effectiveTarget })
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
      effectiveStopPrice: effectiveStop,
      effectiveTargetPrice: effectiveTarget,
      effectiveGuardSource: lifecycleSource?.type || row?.effectiveGuardSource || row?.plannedStopSource || row?.plannedTargetSource || null,
      sourcePrecedence: row?.sourcePrecedence || null,
      lifecycleGuardSourceReady: lifecycleRow?.lifecycleReady === true,
      lifecycleOriginalGuardSource: lifecycleSource?.originalSourceType || row?.lifecycleOriginalGuardSource || null,
      lifecycleOriginalGeneratedAt: lifecycleSource?.originalGeneratedAt || row?.lifecycleOriginalGeneratedAt || null,
      stopChildMissing: stopMissing,
      targetChildMissing: targetMissing,
      childRepairPattern: bothMissing ? "stop_and_target_missing" : stopOnlyMissing ? "stop_only_missing_target_present" : targetMissing && brokerStopPresent ? "target_only_missing_stop_present" : "not_repairable_by_persistent_oco",
      stopOnlyRepairReviewReady: stopOnlyMissing && filled && guardOk && geometryOk && row?.fillStateReconciliation?.repairBlocked !== true,
      brokerStopPresent,
      brokerTargetPresent,
      brokerSellOrderCount,
      plannedStopSource: row?.plannedStopSource || null,
      plannedTargetSource: row?.plannedTargetSource || null,
      plannedStage6Hash: row?.plannedStage6Hash || null,
      plannedStage6File: row?.plannedStage6File || null,
      plannedLedgerKey: row?.plannedLedgerKey || null,
      plannedLedgerUpdatedAt: row?.plannedLedgerUpdatedAt || null,
      guardMetadataGeneratedAt,
      currentPriceSource: "alpaca_position_current_price",
      guardMetadataRisk,
      geometry: {
        stopBelowCurrent,
        targetAboveCurrent,
        valid: geometryOk
      },
      normalizedFillState: row?.normalizedFillState || null,
      ownershipClassification: row?.ownershipClassification || null,
      fillStateReconciliation: row?.fillStateReconciliation || null,
      blockers,
      readiness: brokerChildrenComplete
        ? "NO_ACTION_BROKER_CHILDREN_PRESENT"
        : blockers.length === 0
          ? "PERSISTENT_REPAIR_READY_FOR_APPROVAL"
          : "BLOCKED",
      executionAllowed: false,
      autoCancel: false,
      payloadPreview,
      idempotencyKeyPreview: payloadPreview ? `persistent-oco-repair:${symbol}:tif=${PERSISTENT_REPAIR_TIME_IN_FORCE}:qty=${repairQty}:stop=${effectiveStop}:target=${effectiveTarget}` : null,
      reason: blockers.length ? `blocked:${blockers.join(",")}` : "paper-only persistent OCO repair candidate; broker mutation requires separate exact approval",
      safetyDecision: blockers.length === 0
        ? "eligible_for_manual_approval_only"
        : "do_not_submit"
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
    timeInForce: PERSISTENT_REPAIR_TIME_IN_FORCE,
    expirationPolicy: "gtc_required_for_persistent_protection_day_orders_expire_after_market_close",
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
    brokerChildrenPresentNoAction: candidates.filter((row) => row.readiness === "NO_ACTION_BROKER_CHILDREN_PRESENT").length,
    fillStateReconciliationRequired: candidates.filter((row) => row.blockers.includes("fill_state_reconciliation_required")).length,
    positionOwnershipReviewRequired: candidates.filter((row) => row.blockers.includes("position_not_sidecar_managed")).length,
    guardMetadataStale: candidates.filter((row) => row.guardMetadataRisk?.stale).length,
    guardMetadataBreached: candidates.filter((row) => row.guardMetadataRisk?.stopBreached || row.guardMetadataRisk?.targetBreached).length,
    guardMetadataNearBreached: candidates.filter((row) => row.guardMetadataRisk?.nearStopBreach || row.guardMetadataRisk?.nearTargetBreach).length,
    stopOnlyRepairReviewReady: candidates.filter((row) => row.stopOnlyRepairReviewReady).length,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false
  },
  source: {
    brokerChildReconciliationOverall: recon?.overall || null,
    positionLifecycleGuardSourceOverall: lifecyclePlan?.overall || null
  },
  nextAction: selected
    ? "request a separate approved paper-only persistent OCO repair submit for the selected row; no auto-cancel"
    : candidates.some((row) => row.stopOnlyRepairReviewReady)
      ? "review stop-only repair lane separately; do not submit OCO because target child already exists"
      : "wait for an eligible filled position with both stop and target child missing"
};

const md = [
  "## Persistent OCO Repair Plan",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${String(report.overall).toUpperCase()}\``,
  `- scope: \`${report.scope}\``,
  `- selected: \`${selected ? `${selected.symbol} qty=${selected.repairQty} stop=${selected.plannedStopPrice} target=${selected.plannedTargetPrice}` : "N/A"}\``,
  "- safety: `report-only plan; PAPER only; one row only; no auto-cancel; GTC required; no POST unless separately approved`",
  "- rows:",
  ...candidates.map((row) => `  - ${row.symbol}: ${row.readiness} safety=${row.safetyDecision} ownership=${row.ownershipClassification || "N/A"} fill=${row.fillStateReconciliation?.status || "N/A"} qty=${row.qty} repairQty=${row.repairQty ?? "N/A"} protected=${row.brokerStopPresent && row.brokerTargetPresent} source=${row.effectiveGuardSource || "N/A"} geometry=${row.geometry.valid ? "valid" : "invalid"} guardRisk=${row.guardMetadataRisk?.status || "N/A"} pattern=${row.childRepairPattern || "N/A"} stopOnlyReview=${row.stopOnlyRepairReviewReady ? "yes" : "no"} blockers=${short(row.blockers.join(",") || "none", 180)}`),
  ""
].join("\n");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${md}\n`, "utf8");
console.log(`[PERSISTENT_OCO_REPAIR_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${selected?.symbol || "none"}`);
