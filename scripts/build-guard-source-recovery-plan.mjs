import fs from "node:fs";
import { PROTECTION_LANES } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.GUARD_SOURCE_RECOVERY_STATE_DIR || "state").trim() || "state";
const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  protectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardRefresh: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  guardLineage: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  lifecycleGuardSource: `${STATE_DIR}/position-lifecycle-guard-source-plan.json`,
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
const SOURCE_ROOT_CAUSES = Object.freeze({
  STATE_MATERIALIZATION_MISSING: "state_materialization_missing",
  SOURCE_PRODUCER_MISSING: "source_producer_missing",
  STAGE6_DISPATCH_MISMATCH: "stage6_dispatch_mismatch",
  SOURCE_TTL_EXPIRED: "source_ttl_expired",
  SOURCE_GEOMETRY_UNUSABLE: "source_geometry_unusable"
});
const PRESERVATION_STATUSES = Object.freeze({
  ACTIVE: "PRESERVED_ACTIVE_REPORT_ONLY",
  EXPIRED: "PRESERVED_EXPIRED_EVIDENCE_ONLY",
  NONE: "NO_PRESERVED_SOURCE"
});
const RECOVERY_DISPOSITIONS = Object.freeze({
  EXPECTED_STALE_SOURCE_BLOCK: "EXPECTED_STALE_SOURCE_BLOCK",
  LIFECYCLE_LINEAGE_PROPAGATION_DEFECT: "LIFECYCLE_LINEAGE_PROPAGATION_DEFECT",
  CURRENT_POSITION_LINEAGE_MISSING: "CURRENT_POSITION_LINEAGE_MISSING",
  DISPATCH_EVIDENCE_MISSING: "DISPATCH_EVIDENCE_MISSING",
  REPORT_ONLY_LIFECYCLE_REVALIDATION_AVAILABLE: "REPORT_ONLY_LIFECYCLE_REVALIDATION_AVAILABLE",
  FRESH_SOURCE_MATERIALIZATION_REQUIRED: "FRESH_SOURCE_MATERIALIZATION_REQUIRED",
  NO_CURRENT_SOURCE_AVAILABLE: "NO_CURRENT_SOURCE_AVAILABLE",
  SOURCE_GEOMETRY_UNUSABLE: "SOURCE_GEOMETRY_UNUSABLE"
});
const STAGE6_DISPATCH_SOURCES = new Set([
  "position_lifecycle_revalidated_guard",
  "recommendation_ledger",
  "stage6_20trade_loop",
  "order_ledger"
]);
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

const addMinutes = (iso, minutes) => {
  const timestamp = Date.parse(String(iso || ""));
  return Number.isFinite(timestamp) && Number.isFinite(minutes)
    ? new Date(timestamp + (minutes * 60_000)).toISOString()
    : null;
};

const sourceLineageEvidence = ({ selected, refreshReceivedAt, ttlMin, protectionRow, lifecycleRow, preview, nowMs }) => {
  const type = String(selected?.type || "");
  const producedAt = selected?.generatedAt || null;
  const receivedAt = refreshReceivedAt || null;
  const expiresAt = addMinutes(producedAt, ttlMin);
  const evaluatedAgeMin = round(ageMinutes(producedAt, nowMs));
  const ageMin = evaluatedAgeMin ?? selected?.ageMin ?? null;
  const freshAtReceiptAge = producedAt && receivedAt
    ? (Date.parse(receivedAt) - Date.parse(producedAt)) / 60_000
    : null;
  const freshAtReceipt = freshAtReceiptAge != null && freshAtReceiptAge >= -1 && freshAtReceiptAge <= ttlMin;
  const freshAtEvaluation = Boolean(selected && producedAt && evaluatedAgeMin != null && evaluatedAgeMin >= -1 && evaluatedAgeMin <= ttlMin);
  const expectedHash = protectionRow?.plannedStage6Hash || null;
  const expectedFile = protectionRow?.plannedStage6File || null;
  const fallbackHash = preview?.stage6Hash || null;
  const fallbackFile = preview?.stage6File || null;
  const dispatchRequired = STAGE6_DISPATCH_SOURCES.has(type);
  const dispatchBasis = expectedHash || expectedFile
    ? "position_lineage"
    : fallbackHash || fallbackFile
      ? "latest_preview_fallback"
      : "missing_expected_lineage";
  const compareHash = expectedHash || fallbackHash;
  const compareFile = expectedFile || fallbackFile;
  const sourceHash = selected?.stage6Hash || null;
  const sourceFile = selected?.stage6File || null;
  const dispatchStatus = !selected
    ? "NO_SOURCE"
    : !dispatchRequired
      ? "NOT_REQUIRED"
      : !sourceHash && !sourceFile
        ? "SOURCE_LINEAGE_MISSING"
        : !compareHash && !compareFile
          ? "EXPECTED_LINEAGE_MISSING"
          : compareHash && sourceHash
            ? (String(compareHash) === String(sourceHash) ? "MATCH" : "MISMATCH")
            : (String(compareFile) === String(sourceFile) ? "MATCH" : "MISMATCH");
  return {
    sourceType: type || null,
    producedAt,
    receivedAt,
    ttlMin,
    expiresAt,
    ageMin,
    freshAtReceipt,
    freshAtEvaluation,
    producerFreshFlag: selected?.fresh === true,
    freshnessStatus: !selected
      ? "SOURCE_MISSING"
      : !producedAt
        ? "SOURCE_TIMESTAMP_MISSING"
        : freshAtEvaluation
          ? "SOURCE_WITHIN_TTL"
          : "SOURCE_TTL_EXPIRED",
    stage6Hash: sourceHash,
    stage6File: sourceFile,
    expectedStage6Hash: compareHash,
    expectedStage6File: compareFile,
    latestStage6Hash: fallbackHash,
    latestStage6File: fallbackFile,
    dispatchRequired,
    dispatchBasis,
    dispatchStatus,
    dispatchValid: dispatchStatus === "NOT_REQUIRED" || dispatchStatus === "MATCH",
    positionLineageMatchesCurrentPosition: dispatchStatus === "MATCH" || (!dispatchRequired && Boolean(selected)),
    lifecycle: type === "position_lifecycle_revalidated_guard"
      ? {
          ready: lifecycleRow?.lifecycleReady === true,
          decision: lifecycleRow?.lifecycleDecision || null,
          generatedAt: lifecycleRow?.lifecycleSource?.generatedAt || null,
          originalSourceType: lifecycleRow?.lifecycleSource?.originalSourceType || null,
          originalGeneratedAt: lifecycleRow?.lifecycleSource?.originalGeneratedAt || null,
          originalAgeMin: toNum(lifecycleRow?.lifecycleSource?.originalAgeMin),
          stage6Hash: lifecycleRow?.lifecycleSource?.stage6Hash || null,
          stage6File: lifecycleRow?.lifecycleSource?.stage6File || null
        }
      : null
  };
};

const sourcePreservation = ({ selected, lineage, geometryValid, previousRow, positionLineageKey, nowMs }) => {
  const current = selected && lineage.freshAtEvaluation && lineage.dispatchValid && geometryValid && selected.type !== "broker_children"
    ? {
        type: selected.type || null,
        producedAt: lineage.producedAt,
        receivedAt: lineage.receivedAt,
        ttlMin: lineage.ttlMin,
        expiresAt: lineage.expiresAt,
        stopPrice: toNum(selected.stopPrice),
        targetPrice: toNum(selected.targetPrice),
        stage6Hash: selected.stage6Hash || null,
        stage6File: selected.stage6File || null,
        dispatchStatus: lineage.dispatchStatus,
        positionLineageKey
      }
    : null;
  const prior = previousRow?.sourcePreservation?.source || null;
  const priorStage6Matches = lineage.expectedStage6Hash
    ? prior?.stage6Hash === lineage.expectedStage6Hash
    : lineage.expectedStage6File
      ? prior?.stage6File === lineage.expectedStage6File
      : false;
  const previous = positionLineageKey && prior?.positionLineageKey === positionLineageKey && priorStage6Matches
    ? prior
    : null;
  const source = current || previous;
  const expiry = Date.parse(String(source?.expiresAt || ""));
  const status = !source
    ? PRESERVATION_STATUSES.NONE
    : Number.isFinite(expiry) && nowMs <= expiry
      ? PRESERVATION_STATUSES.ACTIVE
      : PRESERVATION_STATUSES.EXPIRED;
  return {
    status,
    source,
    lineageKeyMatchesCurrentPosition: Boolean(
      source && source.positionLineageKey === positionLineageKey && (
        lineage.expectedStage6Hash
          ? source.stage6Hash === lineage.expectedStage6Hash
          : lineage.expectedStage6File
            ? source.stage6File === lineage.expectedStage6File
            : false
      )
    ),
    retainedForEvidenceOnly: Boolean(source),
    usedForRepairEligibility: false
  };
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

const recoveryRootCause = ({ status, sourceLineage }) => {
  if (status === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH || status === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY) {
    return null;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return SOURCE_ROOT_CAUSES.STATE_MATERIALIZATION_MISSING;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY) {
    return SOURCE_ROOT_CAUSES.SOURCE_GEOMETRY_UNUSABLE;
  }
  if (sourceLineage.dispatchStatus === "MISMATCH") return SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH;
  if (sourceLineage.freshnessStatus === "SOURCE_TTL_EXPIRED") return SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED;
  return SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING;
};

const recoveryDisposition = ({ status, rootCause, selected, sourceLineage, lifecycleRow, geometryValid }) => {
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY || rootCause === SOURCE_ROOT_CAUSES.SOURCE_GEOMETRY_UNUSABLE) {
    return RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return RECOVERY_DISPOSITIONS.FRESH_SOURCE_MATERIALIZATION_REQUIRED;
  }
  if (sourceLineage.dispatchStatus === "EXPECTED_LINEAGE_MISSING") {
    return RECOVERY_DISPOSITIONS.CURRENT_POSITION_LINEAGE_MISSING;
  }
  if (sourceLineage.dispatchStatus === "SOURCE_LINEAGE_MISSING") {
    return RECOVERY_DISPOSITIONS.DISPATCH_EVIDENCE_MISSING;
  }
  if (rootCause === SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH) {
    return selected?.type === "position_lifecycle_revalidated_guard"
      ? RECOVERY_DISPOSITIONS.LIFECYCLE_LINEAGE_PROPAGATION_DEFECT
      : RECOVERY_DISPOSITIONS.EXPECTED_STALE_SOURCE_BLOCK;
  }
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED) {
    if (!geometryValid) return RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE;
    const lifecycleLineageMatches = lifecycleRow?.lifecycleReady === true && (
      sourceLineage.expectedStage6Hash
        ? lifecycleRow?.lifecycleSource?.stage6Hash === sourceLineage.expectedStage6Hash
        : sourceLineage.expectedStage6File
          ? lifecycleRow?.lifecycleSource?.stage6File === sourceLineage.expectedStage6File
          : false
    );
    return lifecycleLineageMatches
      ? RECOVERY_DISPOSITIONS.REPORT_ONLY_LIFECYCLE_REVALIDATION_AVAILABLE
      : RECOVERY_DISPOSITIONS.NO_CURRENT_SOURCE_AVAILABLE;
  }
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING) {
    return RECOVERY_DISPOSITIONS.NO_CURRENT_SOURCE_AVAILABLE;
  }
  return null;
};

const recoveryOwner = ({ blockerDomain, rootCause, disposition }) => {
  if (blockerDomain === "ownership") return "position_ownership_proof";
  if (disposition === RECOVERY_DISPOSITIONS.LIFECYCLE_LINEAGE_PROPAGATION_DEFECT) return "position_lifecycle_guard_source_producer";
  if (disposition === RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE) return "guard_geometry_producer";
  if (rootCause === SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH) return "stage6_dispatch_lineage";
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED) return "guard_source_freshness";
  if (rootCause === SOURCE_ROOT_CAUSES.STATE_MATERIALIZATION_MISSING) return "guard_source_state_materialization";
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_GEOMETRY_UNUSABLE) return "guard_geometry_producer";
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING) return "guard_source_producer";
  return "monitoring";
};

const nextActionForRecovery = (status, rootCause, disposition) => {
  if (disposition === RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE) {
    return "route_to_guard_geometry_root_cause_no_repair";
  }
  if (disposition === RECOVERY_DISPOSITIONS.LIFECYCLE_LINEAGE_PROPAGATION_DEFECT) {
    return "reject_report_only_lifecycle_chaining_and_rebuild_from_matching_position_lineage";
  }
  if (disposition === RECOVERY_DISPOSITIONS.EXPECTED_STALE_SOURCE_BLOCK) return "retain_safe_block_until_position_lineage_source_matches";
  if (disposition === RECOVERY_DISPOSITIONS.CURRENT_POSITION_LINEAGE_MISSING) return "establish_current_position_stage6_lineage_report_only";
  if (disposition === RECOVERY_DISPOSITIONS.DISPATCH_EVIDENCE_MISSING) return "restore_stage6_dispatch_evidence_report_only";
  if (disposition === RECOVERY_DISPOSITIONS.REPORT_ONLY_LIFECYCLE_REVALIDATION_AVAILABLE) {
    return "review_state_materialization_separately_no_mutation";
  }
  if (status === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH) return "monitor_current_fresh_guard_source";
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY) return "manual_protective_repair_review_report_only";
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return "prepare_separate_state_only_materialization_review_no_mutation";
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY) {
    return "route_to_guard_geometry_root_cause_no_repair";
  }
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED) return "wait_for_fresh_stage6_or_lifecycle_guard_source";
  if (rootCause === SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH) return "trace_expected_stage6_hash_dispatch_lineage_report_only";
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING) return "rebuild_missing_guard_source_producer_report_only";
  return "inspect_guard_source_lineage_report_only";
};

const recoveryGeometryEvidence = ({ producerReportedValid, valid, stopPrice, currentPrice, targetPrice }) => {
  const stopPresent = stopPrice != null;
  const currentPresent = currentPrice != null;
  const targetPresent = targetPrice != null;
  const stopBelowCurrent = stopPresent && currentPresent ? stopPrice < currentPrice : null;
  const targetAboveCurrent = targetPresent && currentPresent ? targetPrice > currentPrice : null;
  const rootCauses = [];
  if (!stopPresent) rootCauses.push("stop_missing");
  if (!currentPresent) rootCauses.push("current_missing");
  if (!targetPresent) rootCauses.push("target_missing");
  if (stopBelowCurrent === false) rootCauses.push("stop_not_below_current");
  if (targetAboveCurrent === false) rootCauses.push("target_not_above_current");
  if (!valid && rootCauses.length === 0) rootCauses.push("producer_geometry_flag_invalid");
  const invalidComponents = [...new Set(rootCauses.map((reason) => reason.split("_")[0]))];
  return {
    valid,
    producerReportedValid: producerReportedValid === true ? true : producerReportedValid === false ? false : null,
    computedValid: stopBelowCurrent === true && targetAboveCurrent === true,
    stopPrice,
    currentPrice,
    targetPrice,
    stopPresent,
    currentPresent,
    targetPresent,
    stopBelowCurrent,
    targetAboveCurrent,
    invalidComponents,
    rootCauses
  };
};

const stateMaterializationPrerequisites = ({
  recoveryStatus,
  selected,
  selectedSourceFresh,
  selectedSourceDispatchValid,
  sourceLineage,
  recoveryGeometry,
  idempotencyPass,
  ownershipPass,
  fillStatePass,
  currentSourceFresh
}) => {
  if (recoveryStatus !== RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) return null;
  const checks = {
    recoverySourceAvailable: Boolean(selected),
    recoverySourceFresh: selectedSourceFresh,
    recoverySourceDispatchValid: selectedSourceDispatchValid,
    recoverySourceLineageMatchesCurrentPosition: sourceLineage.positionLineageMatchesCurrentPosition,
    recoverySourceGeometryValid: recoveryGeometry.valid,
    idempotencyPass,
    ownershipPass,
    fillStatePass
  };
  const prerequisiteFailures = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([name]) => name);
  const missingEvidence = currentSourceFresh ? [] : ["fresh_recovery_source_not_applied_to_current_state"];
  return {
    applicable: true,
    mode: "report_only",
    ...checks,
    recoverySourceAppliedToCurrentState: currentSourceFresh,
    prerequisiteFailures,
    missingEvidence: [...prerequisiteFailures, ...missingEvidence],
    reviewReady: prerequisiteFailures.length === 0 && !currentSourceFresh,
    repairEligibleNow: false,
    stateMutationAllowed: false
  };
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

const buildRow = ({
  refreshRow,
  protectionRow,
  lineageRow,
  lifecycleRow,
  fillStateRow,
  reconciliationRow,
  preview,
  sourcePriority,
  previousRow,
  refreshReceivedAt,
  ttlMin,
  nowMs
}) => {
  const symbol = asSymbol(refreshRow?.symbol || protectionRow?.symbol || lineageRow?.symbol || reconciliationRow?.symbol);
  const stage6Identity = protectionRow?.plannedStage6Hash || protectionRow?.plannedStage6File || null;
  const positionLineageKey = symbol && stage6Identity ? `${symbol}:${stage6Identity}` : null;
  const decision = rowDecision({ refreshRow, protectionRow, lineageRow, fillStateRow, reconciliationRow });
  const protectionLane = protectionRow?.protectionLane || laneFromDecision(decision);
  const brokerChildrenComplete = (
    refreshRow?.broker?.stopPresent === true || reconciliationRow?.brokerStopPresent === true
  ) && (
    refreshRow?.broker?.targetPresent === true || reconciliationRow?.brokerTargetPresent === true
  );
  const selected = refreshRow?.selectedSource || null;
  const sourceLineage = sourceLineageEvidence({ selected, refreshReceivedAt, ttlMin, protectionRow, lifecycleRow, preview, nowMs });
  const currentSourceGeneratedAt = protectionRow?.effectiveGuardGeneratedAt || protectionRow?.plannedLedgerUpdatedAt || null;
  const currentSourceAgeMin = round(ageMinutes(currentSourceGeneratedAt, nowMs));
  const currentSourceType = protectionRow?.effectiveGuardSource || null;
  const currentSourceApplied = brokerChildrenComplete || Boolean(
    currentSourceType && currentSourceType !== "position_lifecycle_revalidated_guard"
  );
  const currentMetadataFresh = (protectionRow?.guardSourceFresh === true || protectionRow?.guardSourceFreshness === "fresh") &&
    currentSourceAgeMin != null && currentSourceAgeMin >= -1 && currentSourceAgeMin <= ttlMin;
  const currentSourceFresh = brokerChildrenComplete || (currentSourceApplied && currentMetadataFresh);
  const selectedSourceFresh = sourceLineage.freshAtEvaluation;
  const selectedSourceDispatchValid = sourceLineage.dispatchValid;
  const selectedStop = toNum(refreshRow?.selectedSource?.stopPrice);
  const selectedTarget = toNum(refreshRow?.selectedSource?.targetPrice);
  const selectedCurrent = toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice);
  const producerReportedGeometryValid = refreshRow?.selectedSourceGeometryValid;
  const selectedSourceGeometryValid = refreshRow?.selectedSourceGeometryValid === true || (
    refreshRow?.selectedSourceGeometryValid == null &&
    selectedStop != null && selectedCurrent != null && selectedTarget != null &&
    selectedStop < selectedCurrent && selectedCurrent < selectedTarget
  );
  const recoverySourceReady = refreshRow?.refreshReady === true && selectedSourceFresh &&
    selectedSourceGeometryValid && selectedSourceDispatchValid;
  const recoveryStatus =
    protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE && currentSourceFresh && recoverySourceReady
      ? RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY
      : currentSourceFresh
        ? RECOVERY_STATUSES.CURRENT_SOURCE_FRESH
        : selectedSourceFresh && selectedSourceDispatchValid &&
          (!selectedSourceGeometryValid || protectionLane === PROTECTION_LANES.INVALID_GUARD_GEOMETRY_NO_REPAIR)
          ? RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY
          : recoverySourceReady
            ? RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED
            : RECOVERY_STATUSES.NO_FRESH_SOURCE_AVAILABLE;
  const idempotencyStatus = protectionRow?.idempotencyStatus || refreshRow?.lineage?.idempotencyBrokerStatus || "not_recorded";
  const idempotencyPass = idempotencyReady(idempotencyStatus);
  const ownershipClassification = refreshRow?.ownershipClassification || protectionRow?.ownershipClassification || null;
  const ownershipPass = ownershipClassification === "SIDECAR_MANAGED_FILLED";
  const fillStateConfirmed =
    fillStateRow?.reconciliationDecision === "FILL_STATE_CONFIRMED" &&
    fillStateRow?.requiresLedgerTerminalizationReview !== true;
  const repairEligibleNow =
    recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY &&
    protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE &&
    protectionRow?.repairEligible !== false &&
    protectionRow?.geometry?.valid !== false &&
    currentSourceApplied &&
    currentSourceFresh &&
    selected?.type !== "position_lifecycle_revalidated_guard" &&
    sourceLineage.positionLineageMatchesCurrentPosition &&
    ownershipPass &&
    fillStateConfirmed &&
    idempotencyPass &&
    decision.repairEligibleNow;
  const recoveryGeometry = recoveryGeometryEvidence({
    producerReportedValid: producerReportedGeometryValid,
    valid: selectedSourceGeometryValid,
    stopPrice: selectedStop,
    currentPrice: selectedCurrent,
    targetPrice: selectedTarget
  });
  const materializationPrerequisites = stateMaterializationPrerequisites({
    recoveryStatus,
    selected,
    selectedSourceFresh,
    selectedSourceDispatchValid,
    sourceLineage,
    recoveryGeometry,
    idempotencyPass,
    ownershipPass,
    fillStatePass: fillStateConfirmed,
    currentSourceFresh
  });
  const sourceAgeMin = sourceLineage.ageMin;
  const precedence = sourcePrecedenceEvidence(refreshRow, sourcePriority);
  const normalizedRootCause = recoveryRootCause({ status: recoveryStatus, sourceLineage });
  const disposition = recoveryDisposition({
    status: recoveryStatus,
    rootCause: normalizedRootCause,
    selected,
    sourceLineage,
    lifecycleRow,
    geometryValid: selectedSourceGeometryValid
  });
  const preservation = sourcePreservation({
    selected,
    lineage: sourceLineage,
    geometryValid: selectedSourceGeometryValid,
    previousRow,
    positionLineageKey,
    nowMs
  });
  const blockerSource =
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE" ||
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_NO_DYNAMIC_SOURCE_FOUND" ||
    decision.recoveryDecision === "BLOCK_INVALID_GUARD_GEOMETRY" ||
    decision.recoveryDecision === "BLOCKED_UNCLASSIFIED_GUARD_SOURCE_GAP"
      ? [...(refreshRow?.blockers || []), ...decision.blockers]
      : decision.blockers;
  if (sourceLineage.dispatchStatus === "MISMATCH") blockerSource.push("stage6_dispatch_mismatch");
  if (["NO_SOURCE", "SOURCE_LINEAGE_MISSING", "EXPECTED_LINEAGE_MISSING"].includes(sourceLineage.dispatchStatus) &&
      recoveryStatus === RECOVERY_STATUSES.NO_FRESH_SOURCE_AVAILABLE) {
    blockerSource.push("source_producer_missing");
  }
  const blockerDomain = protectionRow?.blockerDomain || (
    decision.recoveryDecision === "BLOCK_FILL_STATE_RECONCILIATION_FIRST"
      ? "ledger_fill_state"
      : protectionLane === PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED
        ? "ownership"
        : protectionLane === PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED
          ? "none"
          : "protection"
  );
  const owner = recoveryOwner({ blockerDomain, rootCause: normalizedRootCause, disposition });
  const nextAction = nextActionForRecovery(recoveryStatus, normalizedRootCause, disposition);
  return {
    symbol,
    positionLineageKey,
    currentPrice: toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice),
    qty: toNum(refreshRow?.qty ?? protectionRow?.qty ?? reconciliationRow?.qty),
    ownershipClassification,
    fillStateStatus: fillStateRow?.reconciliationDecision || refreshRow?.fillStateReconciliation?.status || protectionRow?.fillStateStatus || null,
    refreshDecision: refreshRow?.refreshDecision || null,
    lineageFreshnessStatus: lineageRow?.freshnessStatus || lineageRow?.lineageStatus || null,
    lineageRootCause: lineageRow?.rootCause || null,
    selectedSource: selected
      ? {
        type: selected.type || null,
        generatedAt: selected.generatedAt || null,
        receivedAt: refreshReceivedAt,
        ttlMin,
        expiresAt: sourceLineage.expiresAt,
        ageMin: sourceAgeMin,
        fresh: selectedSourceFresh,
        stopPrice: toNum(selected.stopPrice),
        targetPrice: toNum(selected.targetPrice),
        stage6Hash: selected.stage6Hash || null,
        stage6File: selected.stage6File || null
      }
      : null,
    currentSource: {
      type: protectionRow?.effectiveGuardSource || null,
      generatedAt: currentSourceGeneratedAt,
      ageMin: currentSourceAgeMin,
      ttlMin,
      expiresAt: addMinutes(currentSourceGeneratedAt, ttlMin),
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
    recoveryDisposition: disposition,
    recoveryOwner: owner,
    recoveryReady: recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY ||
      recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED,
    currentSourceFresh,
    recoverySourceReady,
    sourceLineage,
    sourcePreservation: preservation,
    stateMaterializationRequired: recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED,
    stateMaterializationPrerequisites: materializationPrerequisites,
    protectionLane,
    blockerDomain,
    repairEligibleNow,
    blockedReason: protectionRow?.blockedReason || decision.blockers[0] || null,
    nextAction,
    geometry: protectionRow?.geometry || null,
    recoveryGeometry,
    idempotencyStatus,
    idempotencyPass,
    repairEligibilityContract: {
      currentSourceAppliedAndFresh: currentSourceFresh,
      currentSourceApplied,
      recoverySourceFresh: selectedSourceFresh,
      recoverySourceDispatchValid: selectedSourceDispatchValid,
      sourceLineageMatchesCurrentPosition: sourceLineage.positionLineageMatchesCurrentPosition,
      recoverySourceGeometryValid: selectedSourceGeometryValid,
      idempotencyPass,
      ownershipPass,
      fillStatePass: fillStateConfirmed,
      previousPreservedSourceUsed: false,
      pass: repairEligibleNow
    },
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
  lines.push(`- source_root_causes: \`${JSON.stringify(report.summary.sourceRootCauseCounts)}\``);
  lines.push(`- recovery_dispositions: \`${JSON.stringify(report.summary.recoveryDispositionCounts)}\``);
  lines.push(`- materialization_prerequisites: \`rows=${report.summary.materializationPrerequisiteRows} reviewReady=${report.summary.materializationReviewReady} failures=${report.summary.materializationPrerequisiteFailures} unclassified=${report.summary.materializationPrerequisiteUnclassified}\``);
  lines.push(`- geometry_root_causes: \`${JSON.stringify(report.summary.geometryRootCauseCounts)}\``);
  lines.push(`- geometry_components: \`${JSON.stringify(report.summary.geometryInvalidComponentCounts)}\``);
  lines.push(`- source_preservation: \`${JSON.stringify(report.summary.sourcePreservationStatusCounts)}\``);
  lines.push(`- fresh_source_status_counts: \`${JSON.stringify(report.summary.freshSourceRecoveryStatusCounts)}\``);
  lines.push(`- blocker_count_consistency: \`${report.classificationConsistency.blockerCountMatchesRootCause ? "pass" : "fail"}\``);
  lines.push("- safety: `report-only; no broker mutation; no state mutation`");
  lines.push("| Symbol | Lane | Recovery Status | Root Cause | Disposition | Owner | Domain | Source | Produced / Received | TTL / Dispatch | Preservation | Current Fresh | Recovery Fresh | Materialize | Materialization Evidence | Geometry | Geometry Causes | Idempotency | Repair Eligible | Next Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.protectionLane || "N/A"} | ${row.recoveryStatus} | ${row.recoveryRootCause || "none"} | ${row.recoveryDisposition || "N/A"} | ${row.recoveryOwner || "N/A"} | ${row.blockerDomain || "N/A"} | ${row.selectedSource?.type || "N/A"} | ${row.sourceLineage.producedAt || "N/A"} / ${row.sourceLineage.receivedAt || "N/A"} | ${row.sourceLineage.ttlMin}m / ${row.sourceLineage.dispatchStatus} | ${row.sourcePreservation.status} | ${row.currentSourceFresh ? "yes" : "no"} | ${row.recoverySourceFreshness} | ${row.stateMaterializationRequired ? "yes" : "no"} | ${row.stateMaterializationPrerequisites ? `${row.stateMaterializationPrerequisites.reviewReady ? "review_ready" : "blocked"}:${row.stateMaterializationPrerequisites.missingEvidence.join(",")}` : "N/A"} | ${row.recoveryGeometry.valid ? "valid" : "invalid"} | ${row.recoveryGeometry.rootCauses.join(",") || "none"} | ${row.idempotencyStatus}/${row.idempotencyPass ? "pass" : "block"} | ${row.repairEligibleNow ? "yes" : "no"} | ${row.nextAction} |`
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
const valueCounts = (rows, selector) => rows.reduce((counts, row) => {
  const value = selector(row);
  if (value) counts[value] = (counts[value] || 0) + 1;
  return counts;
}, {});

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const previousPlan = readJson(OUTPUT_JSON);
  const performance = readJson(FILES.performance);
  const protectionAudit = readJson(FILES.protectionAudit);
  const guardRefresh = readJson(FILES.guardRefresh);
  const guardLineage = readJson(FILES.guardLineage);
  const lifecycleGuardSource = readJson(FILES.lifecycleGuardSource);
  const fillStateReconciliation = readJson(FILES.fillStateReconciliation);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const preview = readJson(FILES.preview);
  const sourcePriority = Array.isArray(guardRefresh?.config?.sourcePriority) && guardRefresh.config.sourcePriority.length
    ? guardRefresh.config.sourcePriority.map((value) => String(value || "").trim()).filter(Boolean)
    : SOURCE_PRIORITY;
  const ttlMinRaw = toNum(guardRefresh?.config?.refreshSourceMaxAgeMin);
  const ttlMin = ttlMinRaw != null && ttlMinRaw > 0 ? ttlMinRaw : 30;
  const refreshReceivedAt = guardRefresh?.generatedAt || generatedAt;

  const refreshRows = Array.isArray(guardRefresh?.rows) ? guardRefresh.rows : [];
  const previousBySymbol = indexRows(previousPlan?.rows);
  const protectionBySymbol = indexRows(protectionAudit?.rows);
  const lineageBySymbol = indexRows(guardLineage?.rows);
  const lifecycleBySymbol = indexRows(lifecycleGuardSource?.rows);
  const fillStateBySymbol = indexRows(fillStateReconciliation?.rows);
  const reconciliationBySymbol = indexRows(brokerChildReconciliation?.rows);
  const rows = refreshRows.map((refreshRow) => {
    const symbol = asSymbol(refreshRow?.symbol);
    return buildRow({
      refreshRow,
      protectionRow: protectionBySymbol.get(symbol) || null,
      lineageRow: lineageBySymbol.get(symbol) || null,
      lifecycleRow: lifecycleBySymbol.get(symbol) || null,
      fillStateRow: fillStateBySymbol.get(symbol) || null,
      reconciliationRow: reconciliationBySymbol.get(symbol) || null,
      preview,
      sourcePriority,
      previousRow: previousBySymbol.get(symbol) || null,
      refreshReceivedAt,
      ttlMin,
      nowMs
    });
  });
  const freshSourceRows = rows.filter((row) => row.protectionLane === PROTECTION_LANES.FRESH_GUARD_SOURCE_REQUIRED);
  const materializationRows = rows.filter((row) => row.recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED);
  const geometryRootCauseRows = rows.filter((row) => row.recoveryDisposition === RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE);

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
    sourceRootCauseCounts: valueCounts(rows, (row) => row.recoveryRootCause),
    recoveryDispositionCounts: valueCounts(rows, (row) => row.recoveryDisposition),
    sourcePreservationStatusCounts: valueCounts(rows, (row) => row.sourcePreservation?.status),
    recoveryStatusUnknown: count(rows, (row) => !Object.values(RECOVERY_STATUSES).includes(row.recoveryStatus)),
    sourceRootCauseUnknown: count(rows, (row) => row.recoveryRootCause && !Object.values(SOURCE_ROOT_CAUSES).includes(row.recoveryRootCause)),
    sourcePreservationUnknown: count(rows, (row) => !Object.values(PRESERVATION_STATUSES).includes(row.sourcePreservation?.status)),
    recoveryDispositionUnclassified: count(freshSourceRows, (row) => row.recoveryRootCause && !Object.values(RECOVERY_DISPOSITIONS).includes(row.recoveryDisposition)),
    repairEligibleWithoutAppliedFreshSource: count(rows, (row) => row.repairEligibleNow && row.repairEligibilityContract?.currentSourceAppliedAndFresh !== true),
    repairEligibleWithLineageMismatch: count(rows, (row) => row.repairEligibleNow && row.repairEligibilityContract?.sourceLineageMatchesCurrentPosition !== true),
    repairEligibleWithoutOwnershipPass: count(rows, (row) => row.repairEligibleNow && row.repairEligibilityContract?.ownershipPass !== true),
    repairEligibleWithoutFillStatePass: count(rows, (row) => row.repairEligibleNow && row.repairEligibilityContract?.fillStatePass !== true),
    dispatchMismatchRepairEligible: count(rows, (row) => row.recoveryRootCause === SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH && row.repairEligibleNow),
    ttlExpiredClassifiedCurrentSourceFresh: count(rows, (row) => row.recoveryRootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED && row.currentSourceFresh),
    producerMissingOwnershipLaneLeaks: count(rows, (row) =>
      row.recoveryRootCause === SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING &&
      row.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION" &&
      row.blockerDomain !== "ownership"
    ),
    materializationPrerequisiteRows: materializationRows.length,
    materializationReviewReady: count(materializationRows, (row) => row.stateMaterializationPrerequisites?.reviewReady === true),
    materializationPrerequisiteFailures: count(materializationRows, (row) => (row.stateMaterializationPrerequisites?.prerequisiteFailures || []).length > 0),
    materializationPrerequisiteUnclassified: count(materializationRows, (row) => !row.stateMaterializationPrerequisites),
    geometryRootCauseRows: geometryRootCauseRows.length,
    geometryRootCauseCounts: geometryRootCauseRows.reduce((counts, row) => {
      for (const reason of row.recoveryGeometry?.rootCauses || []) counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {}),
    geometryRootCauseUnclassified: count(geometryRootCauseRows, (row) => !(row.recoveryGeometry?.rootCauses || []).length),
    geometryInvalidComponentCounts: Object.fromEntries(
      ["stop", "current", "target", "producer"].map((component) => [
        component,
        count(geometryRootCauseRows, (row) => row.recoveryGeometry?.invalidComponents?.includes(component))
      ])
    ),
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
    freshSourceStatusCountMatchesLane: freshSourceStatusTotal === summary.freshSourceRequired,
    sourceRootCausesClassified: summary.sourceRootCauseUnknown === 0,
    sourcePreservationClassified: summary.sourcePreservationUnknown === 0,
    recoveryDispositionsClassified: summary.recoveryDispositionUnclassified === 0,
    repairEligibilityRequiresAppliedFreshSource: summary.repairEligibleWithoutAppliedFreshSource === 0
      && summary.repairEligibleWithLineageMismatch === 0
      && summary.repairEligibleWithoutOwnershipPass === 0
      && summary.repairEligibleWithoutFillStatePass === 0,
    rootCauseSafetyCountersPass: summary.dispatchMismatchRepairEligible === 0
      && summary.ttlExpiredClassifiedCurrentSourceFresh === 0
      && summary.producerMissingOwnershipLaneLeaks === 0,
    materializationPrerequisitesClassified: summary.materializationPrerequisiteUnclassified === 0,
    geometryRootCausesClassified: summary.geometryRootCauseUnclassified === 0
  };
  const overall = summary.unclassifiedRows > 0 || summary.recoveryStatusUnknown > 0 ||
    summary.sourceRootCauseUnknown > 0 || summary.sourcePreservationUnknown > 0 || summary.recoveryDispositionUnclassified > 0 ||
    summary.repairEligibleWithoutAppliedFreshSource > 0 || summary.repairEligibleWithLineageMismatch > 0 ||
    summary.repairEligibleWithoutOwnershipPass > 0 || summary.repairEligibleWithoutFillStatePass > 0 ||
    summary.dispatchMismatchRepairEligible > 0 || summary.ttlExpiredClassifiedCurrentSourceFresh > 0 ||
    summary.producerMissingOwnershipLaneLeaks > 0 || summary.materializationPrerequisiteUnclassified > 0 ||
    summary.geometryRootCauseUnclassified > 0 ||
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
    generatedAt,
    overall,
    scope: "portfolio_wide_dynamic_guard_source_recovery_plan_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      latestStage6Hash: preview?.stage6Hash || null,
      latestStage6File: preview?.stage6File || null,
      guardRefreshReceivedAt: refreshReceivedAt,
      sourceTtlMin: ttlMin,
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
