import fs from "node:fs";
import { PROTECTION_LANES } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.GUARD_SOURCE_RECOVERY_STATE_DIR || "state").trim() || "state";
const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  protectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardRefresh: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  guardLineage: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  fillStateReconciliation: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`,
  preview: `${STATE_DIR}/last-dry-exec-preview.json`
};
const OUTPUT_JSON = `${STATE_DIR}/guard-source-recovery-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/guard-source-recovery-plan.md`;

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
const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / 60000;
};
const round = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(digits));
};

const RECOVERY_STATUSES = Object.freeze({
  CURRENT_SOURCE_FRESH: "CURRENT_SOURCE_FRESH",
  RECOVERY_SOURCE_READY_REPORT_ONLY: "RECOVERY_SOURCE_READY_REPORT_ONLY",
  RECOVERY_SOURCE_MATERIALIZATION_REQUIRED: "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED",
  NO_FRESH_SOURCE_AVAILABLE: "NO_FRESH_SOURCE_AVAILABLE",
  RECOVERY_SOURCE_INVALID_GEOMETRY: "RECOVERY_SOURCE_INVALID_GEOMETRY"
});
const SOURCE_PRIORITY = [
  "broker_children",
  "position_lifecycle_revalidated_guard",
  "recommendation_ledger",
  "stage6_20trade_loop",
  "order_ledger"
];
const idempotencyReady = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "filled" || normalized === "reconciled_filled";
};

const sourcePrecedenceEvidence = (refreshRow, sourcePriority) => {
  const rankOf = (type) => {
    const rank = sourcePriority.indexOf(String(type || ""));
    return rank >= 0 ? rank + 1 : sourcePriority.length + 1;
  };
  const selectedType = refreshRow?.selectedSource?.type || null;
  const ready = (Array.isArray(refreshRow?.sourceCandidates) ? refreshRow.sourceCandidates : [])
    .filter((candidate) => candidate?.fresh === true && candidate?.hasBothPrices === true)
    .sort((a, b) => rankOf(a?.type) - rankOf(b?.type));
  const expectedType = ready[0]?.type || selectedType;
  return {
    configuredPriority: sourcePriority,
    selectedType,
    selectedRank: selectedType ? rankOf(selectedType) : null,
    expectedType: expectedType || null,
    expectedRank: expectedType ? rankOf(expectedType) : null,
    violation: Boolean(selectedType && expectedType && selectedType !== expectedType)
  };
};

const recoveryRootCause = ({ status, lineageRow, refreshRow, preview }) => {
  if (status === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH || status === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY) {
    return null;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return "recovery_source_not_materialized";
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY) {
    return "source_geometry_unusable";
  }
  const lineageCause = String(lineageRow?.rootCause || "");
  if (["SOURCE_TIMESTAMP_MISSING", "SOURCE_AGE_EXCEEDED"].includes(lineageCause)) {
    return "source_timestamp_stale";
  }
  const candidates = Array.isArray(refreshRow?.sourceCandidates) ? refreshRow.sourceCandidates : [];
  const latestHash = String(preview?.stage6Hash || "").trim();
  const stage6Candidates = candidates.filter((candidate) => candidate?.stage6Hash || candidate?.stage6File);
  if (latestHash && !stage6Candidates.some((candidate) => String(candidate?.stage6Hash || "").trim() === latestHash)) {
    return "latest_stage6_symbol_or_hash_mismatch";
  }
  if (!candidates.some((candidate) => candidate?.type === "position_lifecycle_revalidated_guard")) {
    return "lifecycle_source_missing";
  }
  return "recommendation_or_order_ledger_source_missing";
};

const nextActionForRecovery = (status, rootCause) => {
  if (status === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH) return "monitor_current_fresh_guard_source";
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY) return "manual_protective_repair_review_report_only";
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return "prepare_separate_state_only_materialization_review_no_mutation";
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY) {
    return "route_to_guard_geometry_root_cause_no_repair";
  }
  if (rootCause === "source_timestamp_stale") return "wait_for_fresh_stage6_or_lifecycle_guard_source";
  if (rootCause === "latest_stage6_symbol_or_hash_mismatch") return "trace_latest_stage6_symbol_hash_lineage";
  if (rootCause === "lifecycle_source_missing") return "rebuild_position_lifecycle_guard_source_report_only";
  return "trace_recommendation_order_ledger_guard_source";
};

const laneFromDecision = (decision) => {
  if (decision.recoveryDecision === "NO_ACTION_BROKER_CHILDREN_PRESENT") {
    return PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED;
  }
  if (["BLOCK_FILL_STATE_RECONCILIATION_FIRST", "BLOCK_POSITION_OWNERSHIP_REVIEW"].includes(decision.recoveryDecision)) {
    return PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED;
  }
  if (decision.recoveryDecision === "BLOCK_INVALID_GUARD_GEOMETRY") {
    return PROTECTION_LANES.INVALID_GUARD_GEOMETRY_NO_REPAIR;
  }
  if (decision.recoveryDecision.startsWith("FRESH_SOURCE_REQUIRED")) {
    return PROTECTION_LANES.FRESH_GUARD_SOURCE_REQUIRED;
  }
  if (decision.repairEligibleNow) return PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE;
  return null;
};

const indexRows = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const rowDecision = ({ refreshRow, protectionRow, lineageRow, fillStateRow, reconciliationRow }) => {
  const refreshDecision = String(refreshRow?.refreshDecision || "");
  const ownership = String(refreshRow?.ownershipClassification || protectionRow?.ownershipClassification || "");
  const fillState = String(refreshRow?.fillStateReconciliation?.status || protectionRow?.fillStateStatus || "");
  const brokerStopPresent = refreshRow?.broker?.stopPresent === true || reconciliationRow?.brokerStopPresent === true;
  const brokerTargetPresent = refreshRow?.broker?.targetPresent === true || reconciliationRow?.brokerTargetPresent === true;
  const brokerChildrenPresent = brokerStopPresent && brokerTargetPresent;
  const lineageFreshness = String(lineageRow?.freshnessStatus || lineageRow?.lineageStatus || "");
  const staleSource =
    refreshDecision === "BLOCKED_REFRESH_SOURCE_STALE" ||
    lineageFreshness === "STALE_SOURCE_ONLY" ||
    lineageFreshness === "LINEAGE_STALE_SOURCE_ONLY";
  const missingSource =
    refreshDecision === "BLOCKED_NO_REFRESH_SOURCE" ||
    lineageFreshness === "MISSING_NO_SOURCE" ||
    lineageFreshness === "LINEAGE_MISSING_NO_SOURCE";
  const invalidGeometry = refreshDecision === "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY" || protectionRow?.invalidGeometry === true;
  const fillStateConfirmed =
    fillStateRow?.reconciliationDecision === "FILL_STATE_CONFIRMED" &&
    fillStateRow?.requiresLedgerTerminalizationReview !== true;
  const fillStateBlocked = !fillStateConfirmed && (refreshDecision === "BLOCKED_FILL_STATE_RECONCILIATION" || ownership === "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED");
  const ownershipBlocked = refreshDecision === "BLOCKED_POSITION_OWNERSHIP_REVIEW" || ownership === "EXTERNAL_OR_MANUAL_POSITION";

  if (brokerChildrenPresent) {
    return {
      recoveryDecision: "NO_ACTION_BROKER_CHILDREN_PRESENT",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: ["monitor_current_broker_children"],
      blockers: []
    };
  }
  if (fillStateBlocked) {
    return {
      recoveryDecision: "BLOCK_FILL_STATE_RECONCILIATION_FIRST",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: ["run_fill_state_reconciliation_audit", "verify_broker_fill_or_terminal_state", "only_then_rebuild_guard_source"],
      blockers: ["fill_state_reconciliation_required"]
    };
  }
  if (ownershipBlocked) {
    return {
      recoveryDecision: "BLOCK_POSITION_OWNERSHIP_REVIEW",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: ["classify_manual_or_external_position", "do_not_attach_sidecar_repair_without_ownership_proof"],
      blockers: ["position_not_sidecar_managed"]
    };
  }
  if (invalidGeometry) {
    return {
      recoveryDecision: "BLOCK_INVALID_GUARD_GEOMETRY",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: ["trace_stage6_stop_target_geometry", "do_not_repair_until_stop_current_target_valid"],
      blockers: ["invalid_guard_geometry"]
    };
  }
  if (staleSource) {
    return {
      recoveryDecision: "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: [
        "fresh_stage6_same_symbol_if_candidate_present",
        "position_lifecycle_guard_refresh_from_confirmed_fill",
        "manual_guard_metadata_review_only"
      ],
      blockers: ["stale_guard_source"]
    };
  }
  if (missingSource) {
    return {
      recoveryDecision: "FRESH_SOURCE_REQUIRED_NO_DYNAMIC_SOURCE_FOUND",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: ["rebuild_lineage_from_stage6_or_lifecycle", "manual_guard_metadata_review_only"],
      blockers: ["missing_guard_source"]
    };
  }
  if (refreshRow?.refreshReady === true) {
    return {
      recoveryDecision: "FRESH_SOURCE_READY_REPAIR_REEVALUATION_REPORT_ONLY",
      recoveryReady: true,
      repairEligibleNow: refreshRow?.afterRefreshRepairDecision === "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE",
      methods: ["reevaluate_protective_repair_candidate_report_only"],
      blockers: []
    };
  }
  return {
    recoveryDecision: "BLOCKED_UNCLASSIFIED_GUARD_SOURCE_GAP",
    recoveryReady: false,
    repairEligibleNow: false,
    methods: ["inspect_guard_refresh_and_lineage_reports"],
    blockers: ["unclassified_guard_source_gap"]
  };
};

const buildRow = ({ refreshRow, protectionRow, lineageRow, fillStateRow, reconciliationRow, preview, sourcePriority }) => {
  const decision = rowDecision({ refreshRow, protectionRow, lineageRow, fillStateRow, reconciliationRow });
  const protectionLane = protectionRow?.protectionLane || laneFromDecision(decision);
  const brokerChildrenComplete = (
    refreshRow?.broker?.stopPresent === true || reconciliationRow?.brokerStopPresent === true
  ) && (
    refreshRow?.broker?.targetPresent === true || reconciliationRow?.brokerTargetPresent === true
  );
  const currentSourceFresh = brokerChildrenComplete || protectionRow?.guardSourceFresh === true ||
    protectionRow?.guardSourceFreshness === "fresh";
  const selectedSourceFresh = refreshRow?.selectedSourceFresh === true || refreshRow?.selectedSource?.fresh === true;
  const selectedStop = toNum(refreshRow?.selectedSource?.stopPrice);
  const selectedTarget = toNum(refreshRow?.selectedSource?.targetPrice);
  const selectedCurrent = toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice);
  const selectedSourceGeometryValid = refreshRow?.selectedSourceGeometryValid === true || (
    refreshRow?.selectedSourceGeometryValid == null &&
    selectedStop != null && selectedCurrent != null && selectedTarget != null &&
    selectedStop < selectedCurrent && selectedCurrent < selectedTarget
  );
  const recoverySourceReady = refreshRow?.refreshReady === true && selectedSourceFresh && selectedSourceGeometryValid;
  const recoveryStatus =
    protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE && currentSourceFresh && recoverySourceReady
      ? RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY
      : currentSourceFresh
        ? RECOVERY_STATUSES.CURRENT_SOURCE_FRESH
        : selectedSourceFresh && (!selectedSourceGeometryValid || protectionLane === PROTECTION_LANES.INVALID_GUARD_GEOMETRY_NO_REPAIR)
          ? RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY
          : recoverySourceReady
            ? RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED
            : RECOVERY_STATUSES.NO_FRESH_SOURCE_AVAILABLE;
  const idempotencyStatus = protectionRow?.idempotencyStatus || refreshRow?.lineage?.idempotencyBrokerStatus || "not_recorded";
  const idempotencyPass = idempotencyReady(idempotencyStatus);
  const repairEligibleNow =
    recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY &&
    protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE &&
    protectionRow?.repairEligible !== false &&
    protectionRow?.geometry?.valid !== false &&
    idempotencyPass &&
    decision.repairEligibleNow;
  const selected = refreshRow?.selectedSource || null;
  const sourceAgeMin = selected?.ageMin ?? round(ageMinutes(selected?.generatedAt));
  const precedence = sourcePrecedenceEvidence(refreshRow, sourcePriority);
  const normalizedRootCause = recoveryRootCause({ status: recoveryStatus, lineageRow, refreshRow, preview });
  const nextAction = nextActionForRecovery(recoveryStatus, normalizedRootCause);
  const blockerSource =
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE" ||
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_NO_DYNAMIC_SOURCE_FOUND" ||
    decision.recoveryDecision === "BLOCK_INVALID_GUARD_GEOMETRY" ||
    decision.recoveryDecision === "BLOCKED_UNCLASSIFIED_GUARD_SOURCE_GAP"
      ? [...(refreshRow?.blockers || []), ...decision.blockers]
      : decision.blockers;
  const fillStateConfirmed =
    fillStateRow?.reconciliationDecision === "FILL_STATE_CONFIRMED" &&
    fillStateRow?.requiresLedgerTerminalizationReview !== true;
  return {
    symbol: asSymbol(refreshRow?.symbol || protectionRow?.symbol || lineageRow?.symbol || reconciliationRow?.symbol),
    currentPrice: toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice),
    qty: toNum(refreshRow?.qty ?? protectionRow?.qty ?? reconciliationRow?.qty),
    ownershipClassification: refreshRow?.ownershipClassification || protectionRow?.ownershipClassification || null,
    fillStateStatus: fillStateRow?.reconciliationDecision || refreshRow?.fillStateReconciliation?.status || protectionRow?.fillStateStatus || null,
    refreshDecision: refreshRow?.refreshDecision || null,
    lineageFreshnessStatus: lineageRow?.freshnessStatus || lineageRow?.lineageStatus || null,
    lineageRootCause: lineageRow?.rootCause || null,
    selectedSource: selected
      ? {
        type: selected.type || null,
        generatedAt: selected.generatedAt || null,
        ageMin: sourceAgeMin,
        fresh: selected.fresh === true,
        stopPrice: toNum(selected.stopPrice),
        targetPrice: toNum(selected.targetPrice),
        stage6Hash: selected.stage6Hash || null,
        stage6File: selected.stage6File || null
      }
      : null,
    currentSource: {
      type: protectionRow?.effectiveGuardSource || null,
      generatedAt: protectionRow?.effectiveGuardGeneratedAt || protectionRow?.plannedLedgerUpdatedAt || null,
      fresh: currentSourceFresh,
      stopPrice: toNum(protectionRow?.plannedStopPrice),
      targetPrice: toNum(protectionRow?.plannedTargetPrice),
      stage6Hash: protectionRow?.plannedStage6Hash || null,
      stage6File: protectionRow?.plannedStage6File || null
    },
    sourcePrecedence: protectionRow?.sourcePrecedence || null,
    sourcePrecedenceClass: protectionRow?.sourcePrecedenceClass || null,
    sourcePrecedenceRank: protectionRow?.sourcePrecedenceRank || null,
    guardSourceFreshness: protectionRow?.guardSourceFreshness || (currentSourceFresh ? "fresh" : "missing"),
    recoverySourceFreshness: selected ? (selectedSourceFresh ? "fresh" : "stale") : "missing",
    sourcePrecedenceEvidence: precedence,
    brokerChildren: {
      stopPresent: refreshRow?.broker?.stopPresent === true || reconciliationRow?.brokerStopPresent === true,
      targetPresent: refreshRow?.broker?.targetPresent === true || reconciliationRow?.brokerTargetPresent === true,
      sourceActive: reconciliationRow?.brokerChildrenSourceActive === true
    },
    recoveryDecision: decision.recoveryDecision,
    recoveryStatus,
    recoveryRootCause: normalizedRootCause,
    recoveryReady: recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY ||
      recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED,
    currentSourceFresh,
    recoverySourceReady,
    stateMaterializationRequired: recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED,
    protectionLane,
    blockerDomain: protectionRow?.blockerDomain || (
      decision.recoveryDecision === "BLOCK_FILL_STATE_RECONCILIATION_FIRST"
        ? "ledger_fill_state"
        : protectionLane === PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED
          ? "ownership"
          : protectionLane === PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED
            ? "none"
            : "protection"
    ),
    repairEligibleNow,
    blockedReason: protectionRow?.blockedReason || decision.blockers[0] || null,
    nextAction,
    geometry: protectionRow?.geometry || null,
    recoveryGeometry: {
      valid: selectedSourceGeometryValid,
      stopPrice: toNum(selected?.stopPrice),
      currentPrice: toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice),
      targetPrice: toNum(selected?.targetPrice)
    },
    idempotencyStatus,
    idempotencyPass,
    recommendedSourceRecoveryMethods: decision.methods,
    blockers: [...new Set(blockerSource.filter((blocker) => !(fillStateConfirmed && blocker === "fill_state_reconciliation_required")))],
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
    reason: decision.blockers.length
      ? `status=${recoveryStatus}; blocked:${decision.blockers.join(",")}`
      : `status=${recoveryStatus}; report_only_source_recovery_classified`
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Guard Source Recovery Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} classified=${report.summary.classifiedRows} unclassified=${report.summary.unclassifiedRows} protection=${report.summary.protectionBlockerRows} ownership=${report.summary.ownershipBlockerRows} ledger=${report.summary.ledgerBlockerRows} materialization=${report.summary.sourceMaterializationRequired} noFresh=${report.summary.noFreshSourceAvailable} invalidRecovery=${report.summary.recoverySourceInvalidGeometry} repairEligible=${report.summary.repairEligibleNow}\``
  );
  lines.push(`- recovery_status_counts: \`${JSON.stringify(report.summary.recoveryStatusCounts)}\``);
  lines.push(`- fresh_source_status_counts: \`${JSON.stringify(report.summary.freshSourceRecoveryStatusCounts)}\``);
  lines.push(`- blocker_count_consistency: \`${report.classificationConsistency.blockerCountMatchesRootCause ? "pass" : "fail"}\``);
  lines.push("- safety: `report-only; no broker mutation; no state mutation`");
  lines.push("| Symbol | Lane | Recovery Status | Root Cause | Domain | Source | Current Fresh | Recovery Fresh | Materialize | Geometry | Idempotency | Repair Eligible | Next Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.protectionLane || "N/A"} | ${row.recoveryStatus} | ${row.recoveryRootCause || "none"} | ${row.blockerDomain || "N/A"} | ${row.selectedSource?.type || "N/A"} | ${row.currentSourceFresh ? "yes" : "no"} | ${row.recoverySourceFreshness} | ${row.stateMaterializationRequired ? "yes" : "no"} | ${row.recoveryGeometry.valid ? "valid" : "invalid"} | ${row.idempotencyStatus}/${row.idempotencyPass ? "pass" : "block"} | ${row.repairEligibleNow ? "yes" : "no"} | ${row.nextAction} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;
const laneCounts = (rows) => Object.fromEntries(
  Object.values(PROTECTION_LANES).map((lane) => [lane, count(rows, (row) => row.protectionLane === lane)])
);
const recoveryStatusCounts = (rows) => Object.fromEntries(
  Object.values(RECOVERY_STATUSES).map((status) => [status, count(rows, (row) => row.recoveryStatus === status)])
);

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const performance = readJson(FILES.performance);
  const protectionAudit = readJson(FILES.protectionAudit);
  const guardRefresh = readJson(FILES.guardRefresh);
  const guardLineage = readJson(FILES.guardLineage);
  const fillStateReconciliation = readJson(FILES.fillStateReconciliation);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const preview = readJson(FILES.preview);
  const sourcePriority = Array.isArray(guardRefresh?.config?.sourcePriority) && guardRefresh.config.sourcePriority.length
    ? guardRefresh.config.sourcePriority.map((value) => String(value || "").trim()).filter(Boolean)
    : SOURCE_PRIORITY;

  const refreshRows = Array.isArray(guardRefresh?.rows) ? guardRefresh.rows : [];
  const protectionBySymbol = indexRows(protectionAudit?.rows);
  const lineageBySymbol = indexRows(guardLineage?.rows);
  const fillStateBySymbol = indexRows(fillStateReconciliation?.rows);
  const reconciliationBySymbol = indexRows(brokerChildReconciliation?.rows);
  const rows = refreshRows.map((refreshRow) => {
    const symbol = asSymbol(refreshRow?.symbol);
    return buildRow({
      refreshRow,
      protectionRow: protectionBySymbol.get(symbol) || null,
      lineageRow: lineageBySymbol.get(symbol) || null,
      fillStateRow: fillStateBySymbol.get(symbol) || null,
      reconciliationRow: reconciliationBySymbol.get(symbol) || null,
      preview,
      sourcePriority
    });
  });
  const freshSourceRows = rows.filter((row) => row.protectionLane === PROTECTION_LANES.FRESH_GUARD_SOURCE_REQUIRED);

  const summary = {
    rows: rows.length,
    freshSourceRequired: freshSourceRows.length,
    fillStateReconciliationRequired: count(rows, (row) => row.recoveryDecision === "BLOCK_FILL_STATE_RECONCILIATION_FIRST"),
    positionOwnershipReviewRequired: count(rows, (row) => row.recoveryDecision === "BLOCK_POSITION_OWNERSHIP_REVIEW"),
    invalidGeometry: count(rows, (row) => row.recoveryDecision === "BLOCK_INVALID_GUARD_GEOMETRY"),
    brokerChildrenPresentNoAction: count(rows, (row) => row.recoveryDecision === "NO_ACTION_BROKER_CHILDREN_PRESENT"),
    recoveryReady: count(rows, (row) => row.recoveryReady),
    repairEligibleNow: count(rows, (row) => row.repairEligibleNow),
    recoveryStatusCounts: recoveryStatusCounts(rows),
    freshSourceRecoveryStatusCounts: recoveryStatusCounts(freshSourceRows),
    recoveryStatusUnknown: count(rows, (row) => !Object.values(RECOVERY_STATUSES).includes(row.recoveryStatus)),
    currentSourceFresh: count(freshSourceRows, (row) => row.recoveryStatus === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH),
    recoverySourceReadyReportOnly: count(freshSourceRows, (row) => row.recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY),
    sourceMaterializationRequired: count(freshSourceRows, (row) => row.recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED),
    noFreshSourceAvailable: count(freshSourceRows, (row) => row.recoveryStatus === RECOVERY_STATUSES.NO_FRESH_SOURCE_AVAILABLE),
    recoverySourceInvalidGeometry: count(freshSourceRows, (row) => row.recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY),
    sourcePrecedenceViolations: count(rows, (row) => row.sourcePrecedenceEvidence?.violation === true),
    classifiedRows: count(rows, (row) => Object.values(PROTECTION_LANES).includes(row.protectionLane)),
    unclassifiedRows: count(rows, (row) => !Object.values(PROTECTION_LANES).includes(row.protectionLane)),
    protectionLaneCounts: laneCounts(rows),
    protectionBlockerRows: count(rows, (row) => row.blockerDomain === "protection"),
    ownershipBlockerRows: count(rows, (row) => row.blockerDomain === "ownership"),
    ledgerBlockerRows: count(rows, (row) => row.blockerDomain === "ledger_fill_state"),
    manualApprovalCandidates: count(rows, (row) => row.protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false
  };
  const rootProtectionBlockers = toNum(protectionAudit?.summary?.protectionBlockerRows);
  const recoveryStatusTotal = Object.values(summary.recoveryStatusCounts).reduce((total, value) => total + value, 0);
  const freshSourceStatusTotal = Object.values(summary.freshSourceRecoveryStatusCounts).reduce((total, value) => total + value, 0);
  const classificationConsistency = {
    rootCauseProtectionBlockerRows: rootProtectionBlockers,
    recoveryProtectionBlockerRows: summary.protectionBlockerRows,
    blockerCountMatchesRootCause:
      rootProtectionBlockers == null || rootProtectionBlockers === summary.protectionBlockerRows,
    recoveryStatusCountMatchesRows: recoveryStatusTotal === summary.rows,
    freshSourceStatusCountMatchesLane: freshSourceStatusTotal === summary.freshSourceRequired
  };
  const overall = summary.unclassifiedRows > 0 || summary.recoveryStatusUnknown > 0 ||
    summary.sourcePrecedenceViolations > 0 || !classificationConsistency.blockerCountMatchesRootCause ||
    !classificationConsistency.recoveryStatusCountMatchesRows || !classificationConsistency.freshSourceStatusCountMatchesLane
    ? "classification_inconsistent"
    : !performance?.live?.available
    ? "warn"
    : summary.repairEligibleNow > 0
      ? "manual_review_ready"
      : summary.freshSourceRequired > 0 || summary.fillStateReconciliationRequired > 0 || summary.positionOwnershipReviewRequired > 0
        ? "blocked_source_recovery_required"
        : rows.length > 0
          ? "classified"
          : "no_positions";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_guard_source_recovery_plan_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      latestStage6Hash: preview?.stage6Hash || null,
      latestStage6File: preview?.stage6File || null,
      guardRefreshOverall: guardRefresh?.overall || null,
      guardLineageOverall: guardLineage?.overall || null,
      protectionAuditOverall: protectionAudit?.overall || null
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      stateMutationSubmitted: false,
      requiresSeparateApprovalForStateWrite: true
    },
    classificationConsistency,
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[GUARD_SOURCE_RECOVERY] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} rows=${summary.rows} freshRequired=${summary.freshSourceRequired} fillRecon=${summary.fillStateReconciliationRequired} repairEligible=${summary.repairEligibleNow} attempted=false submitted=false`
  );
};

main();
