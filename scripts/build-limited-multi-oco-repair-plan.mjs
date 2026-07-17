import fs from "node:fs";

const STATE_DIR = String(process.env.LIMITED_MULTI_OCO_REPAIR_STATE_DIR || "state").trim() || "state";
const PERSISTENT_PLAN_PATH = `${STATE_DIR}/persistent-oco-repair-plan.json`;
const GUARD_SOURCE_RECOVERY_PATH = `${STATE_DIR}/guard-source-recovery-plan.json`;
const BROKER_RECON_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const MULTI_VERIFY_PATH = `${STATE_DIR}/persistent-oco-repair-open-verify-multi.json`;
const OUTPUT_JSON = `${STATE_DIR}/limited-multi-oco-repair-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/limited-multi-oco-repair-plan.md`;

const MAX_ROWS = Math.max(1, Math.trunc(Number(process.env.LIMITED_MULTI_OCO_REPAIR_MAX_ROWS || "2") || 2));
const MAX_QTY_PER_ROW = Math.max(1, Math.trunc(Number(process.env.LIMITED_MULTI_OCO_REPAIR_MAX_QTY_PER_ROW || "1") || 1));

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
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const short = (value, max = 320) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const uniqueSymbols = (rows) =>
  Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();

const blockerGroup = (row) => {
  const blockers = Array.isArray(row?.blockers) ? row.blockers.map(String) : [];
  if (row?.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL") return "eligible_manual_approval";
  if (row?.readiness === "NO_ACTION_BROKER_CHILDREN_PRESENT" || blockers.includes("broker_children_already_present")) {
    return "already_protected_no_action";
  }
  if (blockers.includes("position_not_sidecar_managed")) return "position_ownership_review";
  if (blockers.includes("guard_metadata_missing")) return "guard_metadata_missing";
  if (blockers.includes("fill_state_reconciliation_required")) return "fill_state_reconciliation_required";
  if (blockers.includes("invalid_stop_current_target_geometry")) return "invalid_geometry";
  if (blockers.includes("position_not_filled")) return "position_not_filled";
  if (blockers.includes("requires_stop_and_target_missing")) return "not_both_children_missing";
  return blockers.length ? "other_blocked" : "unknown";
};

const persistentPlan = readJson(PERSISTENT_PLAN_PATH);
const guardSourceRecovery = readJson(GUARD_SOURCE_RECOVERY_PATH);
const brokerRecon = readJson(BROKER_RECON_PATH);
const multiVerify = readJson(MULTI_VERIFY_PATH);
const persistentRows = Array.isArray(persistentPlan?.rows) ? persistentPlan.rows : [];
const brokerRows = Array.isArray(brokerRecon?.rows) ? brokerRecon.rows : [];
const brokerBySymbol = new Map(brokerRows.map((row) => [asSymbol(row?.symbol), row]));
const recoveryRows = Array.isArray(guardSourceRecovery?.rows) ? guardSourceRecovery.rows : [];
const recoveryBySymbol = new Map(recoveryRows.map((row) => [asSymbol(row?.symbol), row]));

const rows = persistentRows
  .map((row) => {
    const symbol = asSymbol(row?.symbol);
    const brokerRow = brokerBySymbol.get(symbol) || null;
    const recoveryRow = recoveryBySymbol.get(symbol) || null;
    const repairQty = toNum(row?.repairQty);
    const payload = row?.payloadPreview && typeof row.payloadPreview === "object" ? row.payloadPreview : null;
    const payloadQty = toNum(payload?.qty);
    const timeInForce = String(payload?.time_in_force || "").toLowerCase();
    const orderClass = String(payload?.order_class || "").toLowerCase();
    const payloadGtcOco = Boolean(payload && timeInForce === "gtc" && orderClass === "oco");
    const qtySafe = repairQty != null && repairQty > 0 && repairQty <= MAX_QTY_PER_ROW && (payloadQty == null || payloadQty <= MAX_QTY_PER_ROW);
    const persistentReady = row?.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL";
    const persistentProtectionEligible = row?.repairEligible === true && row?.protectionLane === "MANUAL_APPROVAL_CANDIDATE";
    const guardSourceRepairEligibleNow = recoveryRow?.repairEligibleNow === true;
    const extraBlockers = [];
    if (persistentReady && !persistentProtectionEligible) extraBlockers.push("persistent_protection_lane_not_eligible");
    if (persistentReady && !guardSourceRepairEligibleNow) extraBlockers.push("guard_source_repair_eligibility_not_confirmed");
    if (persistentReady && !payloadGtcOco) extraBlockers.push("payload_not_gtc_oco");
    if (persistentReady && !qtySafe) extraBlockers.push("qty_exceeds_limited_multi_cap");
    const eligibleForLimitedBatch = persistentReady && persistentProtectionEligible && guardSourceRepairEligibleNow && payloadGtcOco && qtySafe && row?.executionAllowed !== true;
    return {
      symbol,
      readiness: row?.readiness || null,
      safetyDecision: row?.safetyDecision || null,
      blockerGroup: persistentReady && !guardSourceRepairEligibleNow
        ? "guard_source_recovery_required"
        : persistentReady && !persistentProtectionEligible
          ? "protection_classification_required"
          : blockerGroup(row),
      blockers: [...(Array.isArray(row?.blockers) ? row.blockers : []), ...extraBlockers],
      guardSourceRecoveryStatus: recoveryRow?.recoveryStatus || null,
      guardSourceRecoveryRootCause: recoveryRow?.recoveryRootCause || null,
      guardSourceRepairEligibleNow,
      persistentProtectionEligible,
      brokerStopPresent: row?.brokerStopPresent === true || brokerRow?.brokerStopPresent === true,
      brokerTargetPresent: row?.brokerTargetPresent === true || brokerRow?.brokerTargetPresent === true,
      brokerChildrenPresent: (row?.brokerStopPresent === true || brokerRow?.brokerStopPresent === true) && (row?.brokerTargetPresent === true || brokerRow?.brokerTargetPresent === true),
      ownershipClassification: row?.ownershipClassification || brokerRow?.ownershipClassification || null,
      normalizedFillState: row?.normalizedFillState || brokerRow?.normalizedFillState || null,
      repairQty,
      currentPrice: toNum(row?.currentPrice),
      plannedStopPrice: toNum(row?.plannedStopPrice ?? row?.effectiveStopPrice),
      plannedTargetPrice: toNum(row?.plannedTargetPrice ?? row?.effectiveTargetPrice),
      guardMetadataRisk: row?.guardMetadataRisk || null,
      geometry: row?.geometry || null,
      idempotencyKeyPreview: row?.idempotencyKeyPreview || null,
      payloadPreview: payload,
      eligibleForLimitedBatch,
      selectedForApprovalBatch: false,
      nextAction: eligibleForLimitedBatch
        ? "manual approval candidate only; actual broker mutation requires exact scoped approval and a submit lane"
        : persistentReady && !guardSourceRepairEligibleNow
          ? "blocked; canonical guard-source recovery must confirm repairEligibleNow before any approval batch selection"
        : persistentReady && !persistentProtectionEligible
          ? "blocked; canonical persistent protection lane must confirm repair eligibility before batch selection"
        : row?.readiness === "NO_ACTION_BROKER_CHILDREN_PRESENT"
          ? "monitor only; do not create duplicate protective children"
          : "blocked; resolve blocker group before repair approval"
    };
  })
  .filter((row) => row.symbol);

const eligibleRows = rows
  .filter((row) => row.eligibleForLimitedBatch)
  .sort((a, b) => {
    const an = (a.currentPrice ?? Number.POSITIVE_INFINITY) * (a.repairQty ?? 1);
    const bn = (b.currentPrice ?? Number.POSITIVE_INFINITY) * (b.repairQty ?? 1);
    if (an !== bn) return an - bn;
    return a.symbol.localeCompare(b.symbol);
  });
const selectedRows = eligibleRows.slice(0, MAX_ROWS);
const selectedSymbols = new Set(selectedRows.map((row) => row.symbol));
for (const row of rows) row.selectedForApprovalBatch = selectedSymbols.has(row.symbol);

const groupedCounts = rows.reduce((acc, row) => {
  acc[row.blockerGroup] = (acc[row.blockerGroup] || 0) + 1;
  return acc;
}, {});

const persistentPlanUnsafe =
  persistentPlan?.executionPolicy?.brokerMutationAllowed === true ||
  persistentPlan?.summary?.brokerMutationAttempted === true ||
  persistentPlan?.summary?.brokerMutationSubmitted === true;
const multiVerifyUnsafe =
  multiVerify?.executionPolicy?.brokerMutationAllowed === true ||
  multiVerify?.summary?.brokerMutationAttempted === true ||
  multiVerify?.summary?.brokerMutationSubmitted === true;

const overall = persistentPlanUnsafe || multiVerifyUnsafe
  ? "blocked_unsafe_upstream_mutation_signal"
  : selectedRows.length > 0
    ? "manual_batch_approval_required"
    : "blocked_no_eligible_row";

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "portfolio_wide_limited_multi_persistent_oco_repair_planner_report_only",
  executionPolicy: {
    mode: "limited_multi_persistent_oco_repair_plan_report_only",
    targetEnvironment: "PAPER",
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    autoCancel: false,
    timeInForceRequired: "gtc",
    orderClassRequired: "oco",
    maxRows: MAX_ROWS,
    maxQtyPerRow: MAX_QTY_PER_ROW,
    approvalRequired: true,
    requiredApprovalPhrase: "CONFIRM LIVE EXECUTION",
    submitLaneAvailable: false,
    submitPolicy: "no multi-row submit is authorized by this planner; use separate scoped approval before any broker mutation"
  },
  summary: {
    rows: rows.length,
    eligible: eligibleRows.length,
    selected: selectedRows.length,
    selectedSymbols: selectedRows.map((row) => row.symbol),
    alreadyProtectedNoAction: rows.filter((row) => row.blockerGroup === "already_protected_no_action").length,
    positionOwnershipReviewRequired: rows.filter((row) => row.blockerGroup === "position_ownership_review").length,
    guardMetadataMissing: rows.filter((row) => row.blockerGroup === "guard_metadata_missing").length,
    invalidGeometry: rows.filter((row) => row.blockerGroup === "invalid_geometry").length,
    fillStateReconciliationRequired: rows.filter((row) => row.blockerGroup === "fill_state_reconciliation_required").length,
    guardSourceRecoveryRequired: rows.filter((row) => row.blockerGroup === "guard_source_recovery_required").length,
    blockerGroups: groupedCounts,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false
  },
  source: {
    persistentOcoRepairPlanOverall: persistentPlan?.overall || null,
    persistentOcoRepairSelectedSymbol: persistentPlan?.summary?.selectedSymbol || null,
    persistentOcoRepairEligible: toNum(persistentPlan?.summary?.eligible),
    guardSourceRecoveryOverall: guardSourceRecovery?.overall || null,
    guardSourceRepairEligibleNow: toNum(guardSourceRecovery?.summary?.repairEligibleNow),
    brokerChildReconciliationOverall: brokerRecon?.overall || null,
    persistentOcoOpenVerifyMultiOverall: multiVerify?.overall || null
  },
  rows,
  doneWhen: [
    "protected rows remain NO_ACTION / broker children present",
    "position_not_sidecar_managed and guard_metadata_missing rows remain blocked",
    "eligible rows are capped by maxRows and maxQtyPerRow",
    "eligible rows are confirmed by guard-source-recovery repairEligibleNow",
    "brokerMutationAllowed=false, brokerMutationAttempted=false, brokerMutationSubmitted=false",
    "actual submit remains outside this planner and requires exact scoped approval"
  ],
  nextAction: selectedRows.length
    ? "review selectedSymbols and request a separate execution approval only if a broker mutation task is intended"
    : "no submit action; continue monitor-only for protected rows and root-cause blocked rows separately"
};

const lines = [
  "## Limited Multi Persistent OCO Repair Planner",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- scope: \`${report.scope}\``,
  `- selected: \`${report.summary.selectedSymbols.join(",") || "none"}\``,
  `- summary: \`rows=${report.summary.rows} eligible=${report.summary.eligible} selected=${report.summary.selected} alreadyProtected=${report.summary.alreadyProtectedNoAction} ownershipReview=${report.summary.positionOwnershipReviewRequired} guardMissing=${report.summary.guardMetadataMissing} invalidGeometry=${report.summary.invalidGeometry}\``,
  "- safety: `report-only; PAPER scope; no broker mutation; no multi-row submit lane authorized; exact approval required before any mutation`",
  "| Symbol | Status | Group | Selected | Protected | Qty | Stop | Target | Next Action |",
  "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |"
];
for (const row of rows) {
  lines.push(
    `| ${row.symbol} | ${row.readiness || "N/A"} | ${row.blockerGroup} | ${row.selectedForApprovalBatch ? "yes" : "no"} | ${row.brokerChildrenPresent ? "yes" : "no"} | ${row.repairQty ?? "N/A"} | ${row.plannedStopPrice ?? "N/A"} | ${row.plannedTargetPrice ?? "N/A"} | ${short(row.nextAction, 140)} |`
  );
}
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[LIMITED_MULTI_OCO_REPAIR_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${report.summary.selectedSymbols.join(",") || "none"} attempted=false submitted=false`);
