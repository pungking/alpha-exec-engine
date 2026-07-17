import fs from "node:fs";

const STATE_DIR = String(process.env.POSITION_OWNERSHIP_GUARD_GAP_STATE_DIR || "state").trim() || "state";
const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  protectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardLineage: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  guardSourceRecovery: `${STATE_DIR}/guard-source-recovery-plan.json`,
  persistentOcoRepairPlan: `${STATE_DIR}/persistent-oco-repair-plan.json`,
  limitedMultiOcoRepairPlan: `${STATE_DIR}/limited-multi-oco-repair-plan.json`
};
const OUTPUT_JSON = `${STATE_DIR}/position-ownership-guard-gap-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/position-ownership-guard-gap-audit.md`;

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
const unique = (values) => Array.from(new Set(values.filter(Boolean))).sort();
const indexRows = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const performance = readJson(FILES.performance);
const protectionAudit = readJson(FILES.protectionAudit);
const guardLineage = readJson(FILES.guardLineage);
const guardSourceRecovery = readJson(FILES.guardSourceRecovery);
const persistentOcoRepairPlan = readJson(FILES.persistentOcoRepairPlan);
const limitedMultiOcoRepairPlan = readJson(FILES.limitedMultiOcoRepairPlan);

const protectionBySymbol = indexRows(protectionAudit?.rows);
const lineageBySymbol = indexRows(guardLineage?.rows);
const recoveryBySymbol = indexRows(guardSourceRecovery?.rows);
const persistentBySymbol = indexRows(persistentOcoRepairPlan?.rows);
const limitedBySymbol = indexRows(limitedMultiOcoRepairPlan?.rows);
const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];

const classify = ({ position, protectionRow, lineageRow, recoveryRow, persistentRow, limitedRow }) => {
  const symbol = asSymbol(position?.symbol || protectionRow?.symbol || lineageRow?.symbol || recoveryRow?.symbol);
  const qty = toNum(position?.qty ?? protectionRow?.qty ?? recoveryRow?.qty) ?? 0;
  const ownership = String(
    protectionRow?.ownershipClassification ||
    lineageRow?.ownershipClassification ||
    recoveryRow?.ownershipClassification ||
    limitedRow?.ownershipClassification ||
    ""
  );
  const rootCauses = unique([
    ...(Array.isArray(protectionRow?.rootCauses) ? protectionRow.rootCauses : []),
    ...(Array.isArray(lineageRow?.protectionRootCauses) ? lineageRow.protectionRootCauses : []),
    ...(Array.isArray(recoveryRow?.blockers) ? recoveryRow.blockers : []),
    ...(Array.isArray(persistentRow?.blockers) ? persistentRow.blockers : []),
    ...(Array.isArray(limitedRow?.blockers) ? limitedRow.blockers : [])
  ].map(String));
  const brokerStopPresent = position?.brokerStopPresent === true || protectionRow?.brokerStopPresent === true || persistentRow?.brokerStopPresent === true || limitedRow?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true || protectionRow?.brokerTargetPresent === true || persistentRow?.brokerTargetPresent === true || limitedRow?.brokerTargetPresent === true;
  const brokerChildrenPresent = brokerStopPresent && brokerTargetPresent;
  const lineageStatus = String(lineageRow?.lineageStatus || "");
  const lineageRootCause = String(lineageRow?.rootCause || "");
  const hasFreshValidSource = Array.isArray(lineageRow?.freshValidSources) && lineageRow.freshValidSources.length > 0;
  const hasStopTargetSource = Array.isArray(lineageRow?.sourceSummary?.sourcesWithStopTarget) && lineageRow.sourceSummary.sourcesWithStopTarget.length > 0;
  const guardMissing =
    protectionRow?.missingGuardMetadata === true ||
    rootCauses.includes("guard_metadata_missing") ||
    rootCauses.includes("missing_guard_source") ||
    lineageStatus === "LINEAGE_MISSING_NO_SOURCE" ||
    lineageRootCause === "NO_SOURCE_WITH_STOP_TARGET";
  const external = ownership === "EXTERNAL_OR_MANUAL_POSITION" || rootCauses.includes("position_not_sidecar_managed");
  const protectedNoAction = brokerChildrenPresent || persistentRow?.readiness === "NO_ACTION_BROKER_CHILDREN_PRESENT" || limitedRow?.blockerGroup === "already_protected_no_action";
  const persistentRepairReady = persistentRow?.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL";
  const persistentPlanRepairEligible = persistentRow?.repairEligible === true && persistentRow?.protectionLane === "MANUAL_APPROVAL_CANDIDATE";
  const limitedPlannerReady = limitedRow?.eligibleForLimitedBatch === true || limitedRow?.selectedForApprovalBatch === true;
  const guardSourceRepairEligibleNow = recoveryRow?.repairEligibleNow === true;
  const persistentEligible = persistentRepairReady && persistentPlanRepairEligible && guardSourceRepairEligibleNow;
  const limitedEligible = limitedPlannerReady && persistentRepairReady && persistentPlanRepairEligible && guardSourceRepairEligibleNow;

  let classification = "monitor_only";
  const blockers = [];
  const requiredEvidence = [];
  const nextActions = [];

  if (protectedNoAction) {
    classification = "already_protected_no_action";
    nextActions.push("monitor_broker_children_do_not_duplicate_oco");
  } else if (external && guardMissing) {
    classification = "external_position_and_guard_metadata_missing";
    blockers.push("position_not_sidecar_managed", "guard_metadata_missing");
    requiredEvidence.push("sidecar_order_ledger_or_idempotency_ownership_proof", "fresh_stage6_or_position_lifecycle_stop_target_source");
    nextActions.push("do_not_repair", "separate_position_ownership_review_from_guard_source_recovery");
  } else if (external) {
    classification = "external_position_ownership_review";
    blockers.push("position_not_sidecar_managed");
    requiredEvidence.push("sidecar_order_ledger_or_idempotency_ownership_proof");
    nextActions.push("do_not_repair_until_sidecar_ownership_is_proven");
  } else if (guardMissing) {
    classification = "guard_metadata_missing_source_gap";
    blockers.push("guard_metadata_missing");
    requiredEvidence.push("fresh_stage6_or_position_lifecycle_stop_target_source");
    nextActions.push("do_not_repair_until_fresh_valid_guard_source_exists");
  } else if ((persistentRepairReady || limitedPlannerReady) && !guardSourceRepairEligibleNow) {
    requiredEvidence.push("guard_source_recovery_repair_eligibility_contract");
    nextActions.push("defer_to_guard_source_recovery_plan_until_repair_eligible_now");
  } else if (persistentRepairReady && !persistentPlanRepairEligible) {
    requiredEvidence.push("canonical_persistent_protection_lane_repair_eligibility");
    nextActions.push("defer_to_persistent_protection_classification_until_repair_eligible");
  } else if (persistentEligible || limitedEligible) {
    classification = "manual_approval_candidate";
    nextActions.push("separate_scoped_approval_required_before_any_broker_mutation");
  }

  const repairEligible = classification === "manual_approval_candidate";
  const multiPlannerEligible = limitedEligible === true;

  return {
    symbol,
    qty,
    currentPrice: toNum(position?.currentPrice ?? protectionRow?.currentPrice),
    positionStatus: position?.positionStatus || null,
    ownershipClassification: ownership || null,
    sidecarManaged: external ? false : protectionRow?.sidecarManaged === true,
    normalizedFillState: protectionRow?.normalizedFillState || position?.normalizedFillState || null,
    ledgerStatus: protectionRow?.ledgerStatus || position?.ledgerStatus || null,
    idempotencyBrokerStatus: protectionRow?.idempotencyBrokerStatus || position?.idempotencyBrokerStatus || null,
    brokerChildrenPresent,
    brokerStopPresent,
    brokerTargetPresent,
    guardMetadataMissing: guardMissing,
    hasStopTargetSource,
    hasFreshValidSource,
    lineageStatus: lineageStatus || null,
    lineageRootCause: lineageRootCause || null,
    recoveryDecision: recoveryRow?.recoveryDecision || null,
    guardSourceRecoveryStatus: recoveryRow?.recoveryStatus || null,
    guardSourceRecoveryRootCause: recoveryRow?.recoveryRootCause || null,
    guardSourceRepairEligibleNow,
    persistentReadiness: persistentRow?.readiness || null,
    persistentRepairReady,
    persistentPlanRepairEligible,
    limitedMultiGroup: limitedRow?.blockerGroup || null,
    limitedPlannerReady,
    classification,
    blockers: unique(blockers),
    rootCauses,
    repairEligible,
    multiPlannerEligible,
    requiredEvidence: unique(requiredEvidence),
    nextActions: unique(nextActions),
    safetyDecision: repairEligible
      ? "manual_approval_required_before_broker_mutation"
      : "repair_blocked_or_monitor_only",
    evidence: short(
      `ownership=${ownership || "N/A"} lineage=${lineageStatus || "N/A"} lineageRoot=${lineageRootCause || "N/A"} brokerStop=${brokerStopPresent} brokerTarget=${brokerTargetPresent} recoveryEligible=${guardSourceRepairEligibleNow} persistent=${persistentRow?.readiness || "N/A"} limited=${limitedRow?.blockerGroup || "N/A"}`,
      500
    )
  };
};

const rows = positions
  .filter((position) => (toNum(position?.qty) ?? 0) > 0)
  .map((position) => {
    const symbol = asSymbol(position?.symbol);
    return classify({
      position,
      protectionRow: protectionBySymbol.get(symbol) || null,
      lineageRow: lineageBySymbol.get(symbol) || null,
      recoveryRow: recoveryBySymbol.get(symbol) || null,
      persistentRow: persistentBySymbol.get(symbol) || null,
      limitedRow: limitedBySymbol.get(symbol) || null
    });
  });

const count = (predicate) => rows.filter(predicate).length;
const classCounts = rows.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] || 0) + 1;
  return acc;
}, {});
const brokerMutationAttempted = false;
const brokerMutationSubmitted = false;
const overall = count((row) => row.classification === "manual_approval_candidate") > 0
  ? "manual_approval_candidates_present"
  : count((row) => row.classification.includes("external") || row.classification.includes("guard_metadata_missing")) > 0
    ? "blocked_root_cause_review_required"
    : "monitoring";

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "position_ownership_and_guard_metadata_gap_audit_report_only_symbol_agnostic",
  executionPolicy: {
    mode: "position_ownership_guard_gap_audit_report_only",
    brokerMutationAllowed: false,
    brokerMutationAttempted,
    brokerMutationSubmitted,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    multiSubmitLaneAllowed: false,
    requiredApprovalPhraseForAnyBrokerMutation: "CONFIRM LIVE EXECUTION"
  },
  files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
  summary: {
    rows: rows.length,
    alreadyProtectedNoAction: count((row) => row.classification === "already_protected_no_action"),
    externalPositionAndGuardMissing: count((row) => row.classification === "external_position_and_guard_metadata_missing"),
    externalPositionOwnershipReview: count((row) => row.classification === "external_position_ownership_review"),
    guardMetadataMissingSourceGap: count((row) => row.classification === "guard_metadata_missing_source_gap"),
    manualApprovalCandidates: count((row) => row.classification === "manual_approval_candidate"),
    repairEligible: count((row) => row.repairEligible),
    multiPlannerEligible: count((row) => row.multiPlannerEligible),
    guardSourceRecoveryRequired: count((row) => (row.persistentRepairReady || row.limitedPlannerReady) && !row.guardSourceRepairEligibleNow),
    brokerMutationAttempted,
    brokerMutationSubmitted,
    classCounts
  },
  rows,
  doneWhen: [
    "external/manual positions are separated from sidecar-managed repair candidates",
    "guard metadata missing rows name the missing ownership/source evidence",
    "already protected rows remain monitor-only",
    "multi planner remains report-only with no submit lane",
    "brokerMutationAllowed=false, brokerMutationAttempted=false, brokerMutationSubmitted=false"
  ],
  nextAction: "resolve ownership evidence and fresh guard source gaps before considering any protective repair approval"
};

const lines = [
  "## Position Ownership + Guard Metadata Gap Audit",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- scope: \`${report.scope}\``,
  `- summary: \`rows=${report.summary.rows} protected=${report.summary.alreadyProtectedNoAction} externalAndGuardMissing=${report.summary.externalPositionAndGuardMissing} ownershipReview=${report.summary.externalPositionOwnershipReview} guardMissing=${report.summary.guardMetadataMissingSourceGap} manualApproval=${report.summary.manualApprovalCandidates} repairEligible=${report.summary.repairEligible} multiEligible=${report.summary.multiPlannerEligible} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``,
  "- safety: `report-only; no broker mutation; no state mutation; no multi-submit lane authorized`",
  "| Symbol | Classification | Ownership | Guard Missing | Lineage | Recovery | Persistent | Multi Group | Protected | Repair Eligible | Required Evidence | Next Actions |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
];
for (const row of rows) {
  lines.push(
    `| ${row.symbol} | ${row.classification} | ${row.ownershipClassification || "N/A"} | ${row.guardMetadataMissing ? "yes" : "no"} | ${row.lineageStatus || "N/A"}/${row.lineageRootCause || "N/A"} | ${row.recoveryDecision || "N/A"} | ${row.persistentReadiness || "N/A"} | ${row.limitedMultiGroup || "N/A"} | ${row.brokerChildrenPresent ? "yes" : "no"} | ${row.repairEligible ? "yes" : "no"} | ${short(row.requiredEvidence.join(",") || "none", 180)} | ${short(row.nextActions.join(",") || "monitor_only", 180)} |`
  );
}
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[POSITION_OWNERSHIP_GUARD_GAP] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} rows=${rows.length} repairEligible=${report.summary.repairEligible} multiEligible=${report.summary.multiPlannerEligible} attempted=false submitted=false`);
