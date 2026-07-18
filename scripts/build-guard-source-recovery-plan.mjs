import crypto from "node:crypto";
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
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  orderIdempotency: `${STATE_DIR}/order-idempotency.json`,
  recommendationLedger: `${STATE_DIR}/recommendation-ledger.json`,
  stage6TradeLoop: `${STATE_DIR}/stage6-20trade-loop.json`,
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
const roundUp = (value, digits = 4) => {
  const n = toNum(value);
  if (n == null) return null;
  const factor = 10 ** digits;
  const floatNoise = Number.EPSILON * Math.max(1, Math.abs(n)) * 4;
  return Math.ceil((n - floatNoise) * factor) / factor;
};
const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
const MATERIALIZATION_FIELDS = Object.freeze([
  "stopLossPrice",
  "takeProfitPrice",
  "stage6Hash",
  "stage6File",
  "updatedAt"
]);
const GUARD_VALUE_FIELDS = Object.freeze(["stopLossPrice", "takeProfitPrice"]);
const MATERIALIZATION_PACKAGE_STATUSES = Object.freeze([
  "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY",
  "BLOCKED_CURRENT_STATE_RECORD_MISSING",
  "BLOCKED_NO_MATERIALIZATION_DIFF",
  "BLOCKED_EVIDENCE_INCOMPLETE"
]);
const REQUIRED_STATE_MATERIALIZATION_APPROVAL = "CONFIRM STATE GUARD MATERIALIZATION";

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
  LIFECYCLE_LINEAGE_MISSING: "lifecycle_lineage_missing",
  PRESERVATION_CONTRACT_MISMATCH: "preservation_contract_mismatch",
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
const GEOMETRY_DRIFT_CLASSIFICATIONS = Object.freeze({
  STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE: "STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE",
  POSITION_LIFECYCLE_TRANSFORM_DRIFT: "POSITION_LIFECYCLE_TRANSFORM_DRIFT",
  CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE: "CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE",
  SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH: "SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH",
  SOURCE_GEOMETRY_EVIDENCE_MISSING: "SOURCE_GEOMETRY_EVIDENCE_MISSING"
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
  const compareHash = expectedHash;
  const compareFile = expectedFile;
  const sourceHash = selected?.stage6Hash || null;
  const sourceFile = selected?.stage6File || null;
  const dispatchStatus = !selected
    ? "NO_SOURCE"
    : !dispatchRequired
      ? "NOT_REQUIRED"
      : dispatchBasis !== "position_lineage"
        ? "EXPECTED_LINEAGE_MISSING"
        : !sourceHash && !sourceFile
        ? "SOURCE_LINEAGE_MISSING"
        : !compareHash && !compareFile
          ? "EXPECTED_LINEAGE_MISSING"
          : (!compareHash || String(compareHash) === String(sourceHash || "")) &&
              (!compareFile || String(compareFile) === String(sourceFile || ""))
            ? "MATCH"
            : "MISMATCH";
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
    positionLineageMatchesCurrentPosition: !dispatchRequired
      ? Boolean(selected)
      : dispatchBasis === "position_lineage" && dispatchStatus === "MATCH",
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

const matchesExpectedStage6 = (candidate, expectedHash, expectedFile) => {
  if (!expectedHash && !expectedFile) return false;
  return (!expectedHash || String(candidate?.stage6Hash || "") === String(expectedHash)) &&
    (!expectedFile || String(candidate?.stage6File || "") === String(expectedFile));
};

const sourceCandidateLineageEvidence = ({ refreshRow, protectionRow, ttlMin, nowMs }) => {
  const expectedStage6Hash = protectionRow?.plannedStage6Hash || null;
  const expectedStage6File = protectionRow?.plannedStage6File || null;
  const expectedLineagePresent = Boolean(expectedStage6Hash || expectedStage6File);
  const candidates = (Array.isArray(refreshRow?.sourceCandidates) ? refreshRow.sourceCandidates : [])
    .filter((candidate) => candidate?.hasBothPrices === true && candidate?.type !== "broker_children");
  const matching = expectedLineagePresent
    ? candidates.filter((candidate) => matchesExpectedStage6(candidate, expectedStage6Hash, expectedStage6File))
    : [];
  const freshMatching = matching.filter((candidate) => {
    const ageMin = ageMinutes(candidate?.generatedAt, nowMs);
    return ageMin != null && ageMin >= -1 && ageMin <= ttlMin;
  });
  return {
    expectedStage6Hash,
    expectedStage6File,
    expectedLineagePresent,
    candidateCount: candidates.length,
    matchingCandidateCount: matching.length,
    freshMatchingCandidateCount: freshMatching.length,
    matchingTimestampMissingCount: matching.filter((candidate) => !Number.isFinite(Date.parse(String(candidate?.generatedAt || "")))).length,
    matchingTimestampedCount: matching.filter((candidate) => Number.isFinite(Date.parse(String(candidate?.generatedAt || "")))).length,
    matchingCandidateTypes: [...new Set(matching.map((candidate) => candidate?.type).filter(Boolean))],
    matchingCandidateNewestProducedAt: matching
      .map((candidate) => candidate?.generatedAt || null)
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null
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
  const prior = previousRow?.sourcePreservation?.source || previousRow?.sourcePreservation?.rejectedSource || null;
  const priorStage6Matches = Boolean(prior && matchesExpectedStage6(
    prior,
    lineage.expectedStage6Hash,
    lineage.expectedStage6File
  ));
  const priorRejectionReason = !prior
    ? null
    : !positionLineageKey
      ? "current_position_lineage_missing"
      : prior?.positionLineageKey !== positionLineageKey
        ? "prior_position_lineage_key_mismatch"
        : !priorStage6Matches
          ? "prior_stage6_identity_mismatch"
          : null;
  const previous = !priorRejectionReason
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
    rejectedSource: priorRejectionReason ? prior : null,
    priorEvidencePresent: Boolean(prior),
    priorRejectionReason,
    lineageKeyMatchesCurrentPosition: Boolean(
      source &&
      source.positionLineageKey === positionLineageKey &&
      matchesExpectedStage6(source, lineage.expectedStage6Hash, lineage.expectedStage6File)
    ),
    retainedForEvidenceOnly: Boolean(source),
    usedForRepairEligibility: false
  };
};

const sourcePrecedenceEvidence = (refreshRow, sourcePriority, candidateLineage) => {
  const rankOf = (type) => {
    const rank = sourcePriority.indexOf(String(type || ""));
    return rank >= 0 ? rank + 1 : sourcePriority.length + 1;
  };
  const selectedType = refreshRow?.selectedSource?.type || null;
  const ready = (Array.isArray(refreshRow?.sourceCandidates) ? refreshRow.sourceCandidates : [])
    .filter((candidate) => candidate?.fresh === true && candidate?.hasBothPrices === true)
    .filter((candidate) => candidate?.type === "broker_children" || !candidateLineage?.expectedLineagePresent ||
      matchesExpectedStage6(candidate, candidateLineage.expectedStage6Hash, candidateLineage.expectedStage6File))
    .sort((a, b) => rankOf(a?.type) - rankOf(b?.type));
  const expectedType = ready[0]?.type || selectedType;
  return {
    configuredPriority: sourcePriority,
    selectedType,
    selectedRank: selectedType ? rankOf(selectedType) : null,
    expectedType: expectedType || null,
    expectedRank: expectedType ? rankOf(expectedType) : null,
    currentPositionLineageFiltered: candidateLineage?.expectedLineagePresent === true,
    violation: Boolean(selectedType && expectedType && selectedType !== expectedType)
  };
};

const recoveryRootCause = ({ status, sourceLineage, candidateLineage, preservation }) => {
  if (status === RECOVERY_STATUSES.CURRENT_SOURCE_FRESH || status === RECOVERY_STATUSES.RECOVERY_SOURCE_READY_REPORT_ONLY) {
    return null;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED) {
    return SOURCE_ROOT_CAUSES.STATE_MATERIALIZATION_MISSING;
  }
  if (status === RECOVERY_STATUSES.RECOVERY_SOURCE_INVALID_GEOMETRY) {
    return SOURCE_ROOT_CAUSES.SOURCE_GEOMETRY_UNUSABLE;
  }
  if (!candidateLineage.expectedLineagePresent || sourceLineage.dispatchStatus === "EXPECTED_LINEAGE_MISSING") {
    return SOURCE_ROOT_CAUSES.LIFECYCLE_LINEAGE_MISSING;
  }
  if (sourceLineage.dispatchStatus === "MISMATCH" &&
    ["SOURCE_TIMESTAMP_MISSING", "SOURCE_TTL_EXPIRED"].includes(sourceLineage.freshnessStatus)) {
    return SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH;
  }
  if (preservation?.priorEvidencePresent && preservation?.priorRejectionReason && candidateLineage.candidateCount === 0) {
    return SOURCE_ROOT_CAUSES.PRESERVATION_CONTRACT_MISMATCH;
  }
  if (sourceLineage.freshnessStatus === "SOURCE_TIMESTAMP_MISSING") return SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING;
  if (sourceLineage.freshnessStatus === "SOURCE_TTL_EXPIRED") return SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED;
  if (candidateLineage.matchingCandidateCount > 0 && candidateLineage.freshMatchingCandidateCount === 0) {
    if (candidateLineage.matchingTimestampedCount === 0) return SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING;
    return SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED;
  }
  if (candidateLineage.candidateCount > 0 && candidateLineage.matchingCandidateCount === 0) {
    return SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH;
  }
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
  if (rootCause === SOURCE_ROOT_CAUSES.LIFECYCLE_LINEAGE_MISSING) {
    return RECOVERY_DISPOSITIONS.CURRENT_POSITION_LINEAGE_MISSING;
  }
  if (rootCause === SOURCE_ROOT_CAUSES.PRESERVATION_CONTRACT_MISMATCH) {
    return RECOVERY_DISPOSITIONS.EXPECTED_STALE_SOURCE_BLOCK;
  }
  if (rootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED) {
    if (!geometryValid) return RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE;
    const lifecycleLineageMatches = lifecycleRow?.lifecycleReady === true && matchesExpectedStage6(
      lifecycleRow?.lifecycleSource,
      sourceLineage.expectedStage6Hash,
      sourceLineage.expectedStage6File
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
  if (rootCause === SOURCE_ROOT_CAUSES.LIFECYCLE_LINEAGE_MISSING) return "position_lifecycle_lineage";
  if (rootCause === SOURCE_ROOT_CAUSES.PRESERVATION_CONTRACT_MISMATCH) return "guard_source_preservation_contract";
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
  if (rootCause === SOURCE_ROOT_CAUSES.LIFECYCLE_LINEAGE_MISSING) return "establish_current_position_stage6_lineage_report_only";
  if (rootCause === SOURCE_ROOT_CAUSES.PRESERVATION_CONTRACT_MISMATCH) return "reject_mismatched_preserved_source_and_wait_for_current_lineage_source";
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

const artifactRows = (payload, key) => {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
};

const sameStage6Identity = (row, selected) => {
  const rowHash = row?.stage6Hash || null;
  const rowFile = row?.stage6File || row?.latestStage6File || null;
  const selectedHash = selected?.stage6Hash || null;
  const selectedFile = selected?.stage6File || null;
  if (!selectedHash && !selectedFile) return false;
  return (!selectedHash || (rowHash && String(selectedHash) === String(rowHash))) &&
    (!selectedFile || (rowFile && String(selectedFile) === String(rowFile)));
};

const latestMatchingRow = (rows, symbol, selected, observedAt) => rows
  .filter((row) => asSymbol(row?.symbol) === symbol && sameStage6Identity(row, selected))
  .sort((a, b) => Date.parse(String(observedAt(b) || "")) - Date.parse(String(observedAt(a) || "")))[0] || null;

const sourceEvidenceRecord = ({ symbol, selected, recommendationLedger, stage6TradeLoop, orderLedger }) => {
  const loopRow = latestMatchingRow(
    artifactRows(stage6TradeLoop, "rows"), symbol, selected, (row) => row?.runDate
  );
  const recommendationRow = latestMatchingRow(
    artifactRows(recommendationLedger, "recommendations").length
      ? artifactRows(recommendationLedger, "recommendations")
      : artifactRows(recommendationLedger, "rows"),
    symbol,
    selected,
    (row) => row?.updatedAt || row?.lastSeenAt
  );
  const orderRow = latestMatchingRow(
    artifactRows(orderLedger, "orders"), symbol, selected, (row) => row?.filledAt || row?.createdAt || row?.updatedAt
  );
  const byType = {
    stage6_20trade_loop: loopRow,
    recommendation_ledger: recommendationRow,
    order_ledger: orderRow
  };
  const preferred = selected?.type === "position_lifecycle_revalidated_guard"
    ? loopRow || recommendationRow || orderRow
    : byType[selected?.type] || loopRow || recommendationRow || orderRow;
  if (!preferred) return null;
  if (preferred === loopRow) return { type: "stage6_20trade_loop", row: preferred };
  if (preferred === recommendationRow) return { type: "recommendation_ledger", row: preferred };
  return { type: "order_ledger", row: preferred };
};

const priceGeometry = ({ stopPrice, currentPrice, targetPrice }) => {
  const stop = toNum(stopPrice);
  const current = toNum(currentPrice);
  const target = toNum(targetPrice);
  const stopBelowCurrent = stop != null && current != null ? stop < current : null;
  const targetAboveCurrent = target != null && current != null ? target > current : null;
  const targetAboveStop = target != null && stop != null ? target > stop : null;
  const risk = stop != null && current != null ? current - stop : null;
  const reward = target != null && current != null ? target - current : null;
  return {
    stopPrice: stop,
    currentPrice: current,
    targetPrice: target,
    stopBelowCurrent,
    targetAboveCurrent,
    targetAboveStop,
    stopDistancePct: current > 0 && stop != null ? round(((current - stop) / current) * 100, 4) : null,
    targetDistancePct: current > 0 && target != null ? round(((target - current) / current) * 100, 4) : null,
    riskReward: risk > 0 && reward != null ? round(reward / risk, 4) : null,
    valid: stopBelowCurrent === true && targetAboveCurrent === true && targetAboveStop === true
  };
};

const guardValueProposalEvidence = ({ sourceGeometry, evaluationGeometry, sourceLineage, preview }) => {
  const currentPrice = toNum(evaluationGeometry?.currentPrice);
  const retainedStopPrice = toNum(evaluationGeometry?.stopPrice);
  const previousTargetPrice = toNum(evaluationGeometry?.targetPrice);
  const minRiskReward = toNum(preview?.entryPricePolicy?.minRr);
  const sourceRiskReward = toNum(sourceGeometry?.riskReward);
  const requiredRiskRewardCandidates = [minRiskReward, sourceRiskReward]
    .filter((value) => value != null && value > 0);
  const requiredRiskReward = requiredRiskRewardCandidates.length
    ? Math.max(...requiredRiskRewardCandidates)
    : null;
  const requiredTargetRaw = currentPrice != null && retainedStopPrice != null && requiredRiskReward != null && currentPrice > retainedStopPrice
    ? currentPrice + (requiredRiskReward * (currentPrice - retainedStopPrice))
    : null;
  const requiredTargetPrice = roundUp(requiredTargetRaw, 4);
  const resultingGeometry = requiredTargetPrice == null
    ? null
    : priceGeometry({ stopPrice: retainedStopPrice, currentPrice, targetPrice: requiredTargetPrice });
  const evidenceMissing = [
    ["current_price", currentPrice],
    ["retained_stop_price", retainedStopPrice],
    ["previous_target_price", previousTargetPrice],
    ["required_risk_reward", requiredRiskReward],
    ["required_target_price", requiredTargetPrice]
  ].filter(([, value]) => value == null).map(([field]) => field);
  const guardValueDiff = [];
  if (retainedStopPrice != null && retainedStopPrice !== toNum(sourceGeometry?.stopPrice)) {
    guardValueDiff.push({ field: "stopLossPrice", before: toNum(sourceGeometry?.stopPrice), after: retainedStopPrice });
  }
  if (requiredTargetPrice != null && requiredTargetPrice !== previousTargetPrice) {
    guardValueDiff.push({ field: "takeProfitPrice", before: previousTargetPrice, after: requiredTargetPrice });
  }
  const evidenceComplete = evidenceMissing.length === 0 && resultingGeometry?.valid === true && guardValueDiff.length > 0;
  return {
    status: evidenceComplete
      ? "REPORT_ONLY_GUARD_VALUE_PROPOSAL_READY_FOR_PRODUCER_REVIEW"
      : "REPORT_ONLY_GUARD_VALUE_PROPOSAL_EVIDENCE_INCOMPLETE",
    proposalKind: "minimum_risk_geometry_floor_not_alpha_target",
    policy: {
      minRiskReward,
      minRiskRewardSource: minRiskReward == null ? null : "last_dry_exec_preview.entryPricePolicy.minRr",
      sourceRiskReward,
      requiredRiskReward
    },
    inputs: {
      currentPrice,
      retainedStopPrice,
      previousTargetPrice,
      sourceProducedAt: sourceLineage?.producedAt || null,
      sourceExpiresAt: sourceLineage?.expiresAt || null,
      sourceFreshAtEvaluation: sourceLineage?.freshAtEvaluation === true,
      sourceLineageMatchesCurrentPosition: sourceLineage?.positionLineageMatchesCurrentPosition === true
    },
    computedGuardValues: requiredTargetPrice == null
      ? null
      : { stopLossPrice: retainedStopPrice, takeProfitPrice: requiredTargetPrice },
    computation: {
      formula: "requiredTarget=currentPrice+requiredRiskReward*(currentPrice-retainedStopPrice)",
      rounding: "ceil_4_decimal_report_only",
      requiredTargetRaw: round(requiredTargetRaw, 8)
    },
    guardValueDiff,
    resultingGeometry,
    evidenceComplete,
    evidenceMissing,
    requiresFreshProducerValidation: true,
    eligibleForStateMaterialization: false,
    eligibleForBrokerRepair: false,
    brokerMutationAllowed: false,
    stateMutationAllowed: false
  };
};

const noRepairReleaseContract = ({
  sourceLineage,
  evaluationGeometry,
  lifecycleTransform,
  idempotencyPass,
  ownershipPass,
  fillStatePass,
  preview
}) => {
  const minRiskReward = toNum(preview?.entryPricePolicy?.minRr);
  const actualGuardValueDiffPresent = lifecycleTransform?.changed === true;
  const releaseConditions = {
    freshCurrentPositionCompatibleSource: sourceLineage?.freshAtEvaluation === true &&
      sourceLineage?.positionLineageMatchesCurrentPosition === true,
    sourceTtlValid: sourceLineage?.freshAtEvaluation === true,
    sourceLineageMatchesCurrentPosition: sourceLineage?.positionLineageMatchesCurrentPosition === true,
    stopBelowCurrent: evaluationGeometry?.stopBelowCurrent === true,
    targetAboveCurrent: evaluationGeometry?.targetAboveCurrent === true,
    targetAboveStop: evaluationGeometry?.targetAboveStop === true,
    riskRewardMeetsFloor: minRiskReward != null && evaluationGeometry?.riskReward != null &&
      evaluationGeometry.riskReward >= minRiskReward,
    idempotencyPass: idempotencyPass === true,
    ownershipPass: ownershipPass === true,
    fillStatePass: fillStatePass === true,
    actualGuardValueDiffPresent
  };
  const blockerByCondition = {
    freshCurrentPositionCompatibleSource: "fresh_current_position_compatible_source_required",
    sourceTtlValid: "source_ttl_valid_required",
    sourceLineageMatchesCurrentPosition: "source_lineage_match_required",
    stopBelowCurrent: "stop_not_below_current",
    targetAboveCurrent: "target_not_above_current",
    targetAboveStop: "target_not_above_stop",
    riskRewardMeetsFloor: "risk_reward_floor_not_met_or_unverifiable",
    idempotencyPass: "idempotency_pass_required",
    ownershipPass: "ownership_proof_required",
    fillStatePass: "fill_state_confirmation_required",
    actualGuardValueDiffPresent: "actual_guard_value_diff_required"
  };
  const blockedBy = Object.entries(releaseConditions)
    .filter(([, pass]) => pass !== true)
    .map(([condition]) => blockerByCondition[condition]);
  const releaseReadyForReportOnlyReevaluation = blockedBy.length === 0;
  return {
    status: releaseReadyForReportOnlyReevaluation
      ? "NO_REPAIR_RELEASE_REEVALUATION_READY_REPORT_ONLY"
      : "NO_REPAIR_RELEASE_BLOCKED",
    releaseVerdict: releaseReadyForReportOnlyReevaluation
      ? "REVIEW_FRESH_GEOMETRY_REPORT_ONLY"
      : "REMAIN_NO_REPAIR",
    minRiskReward,
    releaseConditions,
    blockedBy,
    recheckTrigger: "fresh_current_position_guard_source_with_changed_guard_values",
    releaseReadyForReportOnlyReevaluation,
    eligibleForStateMaterialization: false,
    eligibleForBrokerRepair: false,
    brokerMutationAllowed: false,
    stateMutationAllowed: false
  };
};

const sourceSnapshot = ({ symbol, selected, sourceLineage, recommendationLedger, stage6TradeLoop, orderLedger, ttlMin }) => {
  const evidence = sourceEvidenceRecord({ symbol, selected, recommendationLedger, stage6TradeLoop, orderLedger });
  const row = evidence?.row || null;
  const type = evidence?.type || selected?.type || null;
  const currentPrice = type === "stage6_20trade_loop"
    ? toNum(row?.entryFilled ?? row?.entryPlanned)
    : type === "recommendation_ledger"
      ? toNum(row?.currentPrice ?? row?.entry)
      : type === "order_ledger"
        ? toNum(row?.avgFillPrice ?? row?.filledAvgPrice ?? row?.fillPrice ?? row?.limitPrice)
        : null;
  const stopPrice = type === "stage6_20trade_loop"
    ? toNum(row?.stopPlanned ?? selected?.stopPrice)
    : type === "recommendation_ledger"
      ? toNum(row?.stop ?? selected?.stopPrice)
      : type === "order_ledger"
        ? toNum(row?.stopLossPrice ?? selected?.stopPrice)
        : toNum(selected?.stopPrice);
  const targetPrice = type === "stage6_20trade_loop"
    ? toNum(row?.targetPlanned ?? selected?.targetPrice)
    : type === "recommendation_ledger"
      ? toNum(row?.target ?? selected?.targetPrice)
      : type === "order_ledger"
        ? toNum(row?.takeProfitPrice ?? selected?.targetPrice)
        : toNum(selected?.targetPrice);
  const producedAt = type === "stage6_20trade_loop"
    ? row?.runDate
    : type === "recommendation_ledger"
      ? row?.updatedAt || row?.lastSeenAt
      : type === "order_ledger"
        ? row?.filledAt || row?.createdAt || row?.updatedAt
        : selected?.generatedAt;
  const effectiveProducedAt = producedAt || selected?.generatedAt || null;
  return {
    sourceType: type,
    producedAt: effectiveProducedAt,
    receivedAt: sourceLineage?.receivedAt || null,
    ttlMin,
    expiresAt: addMinutes(effectiveProducedAt, ttlMin),
    stage6Hash: row?.stage6Hash || selected?.stage6Hash || null,
    stage6File: row?.stage6File || row?.latestStage6File || selected?.stage6File || null,
    dispatchStatus: sourceLineage?.dispatchStatus || null,
    stopPrice,
    currentPrice,
    targetPrice,
    priceBasis: row?.priceBasis || (type === "stage6_20trade_loop" ? "stage6_entry" : type === "recommendation_ledger" ? "recommendation_entry" : type === "order_ledger" ? "order_fill_or_limit" : null),
    marketTimezone: row?.marketTimezone || row?.market_timezone || null,
    adjustmentType: row?.adjustmentType || row?.adjustment_type || null,
    evidenceRecordFound: Boolean(row)
  };
};

const lifecycleTransformEvidence = ({ lifecycleRow, selected, source, evaluation }) => {
  const applied = selected?.type === "position_lifecycle_revalidated_guard" && lifecycleRow?.lifecycleReady === true;
  const input = lifecycleRow?.originalSource || source;
  const output = lifecycleRow?.lifecycleSource || null;
  const currentPrice = toNum(lifecycleRow?.currentPrice ?? evaluation?.currentPrice ?? source?.currentPrice);
  const inputGeometry = priceGeometry({
    stopPrice: input?.stopPrice ?? source?.stopPrice,
    currentPrice,
    targetPrice: input?.targetPrice ?? source?.targetPrice
  });
  const outputGeometry = output ? priceGeometry({
    stopPrice: output?.stopPrice,
    currentPrice,
    targetPrice: output?.targetPrice
  }) : null;
  const changed = Boolean(output && (
    toNum(input?.stopPrice ?? source?.stopPrice) !== toNum(output?.stopPrice) ||
    toNum(input?.targetPrice ?? source?.targetPrice) !== toNum(output?.targetPrice)
  ));
  return {
    applied,
    inputSourceType: input?.type || source?.sourceType || null,
    inputGeneratedAt: input?.generatedAt || source?.producedAt || null,
    outputSourceType: output?.type || null,
    outputGeneratedAt: output?.generatedAt || null,
    changed,
    inputGeometry,
    outputGeometry
  };
};

const geometryDriftAudit = ({
  disposition,
  symbol,
  selected,
  sourceLineage,
  lifecycleRow,
  performancePosition,
  performanceGeneratedAt,
  recommendationLedger,
  stage6TradeLoop,
  orderLedger,
  ttlMin,
  recoveryGeometry,
  preview,
  idempotencyPass,
  ownershipPass,
  fillStatePass
}) => {
  if (disposition !== RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE) return null;
  const source = sourceSnapshot({ symbol, selected, sourceLineage, recommendationLedger, stage6TradeLoop, orderLedger, ttlMin });
  const evaluation = {
    observedAt: performancePosition?.currentPriceObservedAt || performancePosition?.observedAt || performanceGeneratedAt || null,
    currentPrice: toNum(performancePosition?.currentPrice ?? recoveryGeometry?.currentPrice),
    priceBasis: performancePosition?.currentPriceBasis || "broker_position_current_price",
    marketTimezone: performancePosition?.marketTimezone || performancePosition?.market_timezone || null,
    adjustmentType: performancePosition?.adjustmentType || performancePosition?.adjustment_type || null,
    stopPrice: toNum(recoveryGeometry?.stopPrice),
    targetPrice: toNum(recoveryGeometry?.targetPrice)
  };
  const sourceGeometry = priceGeometry(source);
  const evaluationGeometry = priceGeometry(evaluation);
  const lifecycleTransform = lifecycleTransformEvidence({ lifecycleRow, selected, source, evaluation });
  const missingCore = [
    ["source_type", source.sourceType],
    ["source_produced_at", source.producedAt],
    ["source_received_at", source.receivedAt],
    ["source_stage6_identity", source.stage6Hash || source.stage6File],
    ["source_stop_price", source.stopPrice],
    ["source_current_price", source.currentPrice],
    ["source_target_price", source.targetPrice],
    ["evaluation_observed_at", evaluation.observedAt],
    ["evaluation_current_price", evaluation.currentPrice]
  ].filter(([, value]) => value == null).map(([field]) => field);
  const optionalMissing = [
    ["source_price_basis", source.priceBasis],
    ["source_market_timezone", source.marketTimezone],
    ["source_adjustment_type", source.adjustmentType],
    ["evaluation_price_basis", evaluation.priceBasis],
    ["evaluation_market_timezone", evaluation.marketTimezone],
    ["evaluation_adjustment_type", evaluation.adjustmentType]
  ].filter(([, value]) => value == null).map(([field]) => field);
  const sourceTime = Date.parse(String(source.producedAt || ""));
  const evaluationTime = Date.parse(String(evaluation.observedAt || ""));
  const timestampMismatch = Number.isFinite(sourceTime) && Number.isFinite(evaluationTime) && evaluationTime < sourceTime;
  const timezoneMismatch = Boolean(source.marketTimezone && evaluation.marketTimezone && source.marketTimezone !== evaluation.marketTimezone);
  const adjustmentMismatch = Boolean(source.adjustmentType && evaluation.adjustmentType && source.adjustmentType !== evaluation.adjustmentType);
  const mismatchReasons = [
    timestampMismatch ? "evaluation_precedes_source" : null,
    timezoneMismatch ? "market_timezone_mismatch" : null,
    adjustmentMismatch ? "adjustment_type_mismatch" : null
  ].filter(Boolean);
  let classification;
  if (missingCore.length) {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.SOURCE_GEOMETRY_EVIDENCE_MISSING;
  } else if (mismatchReasons.length) {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH;
  } else if (!sourceGeometry.valid && ["stage6_20trade_loop", "recommendation_ledger"].includes(source.sourceType)) {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE;
  } else if (sourceGeometry.valid && lifecycleTransform.applied && lifecycleTransform.changed && lifecycleTransform.outputGeometry?.valid === false) {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.POSITION_LIFECYCLE_TRANSFORM_DRIFT;
  } else if (sourceGeometry.valid && !evaluationGeometry.valid) {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE;
  } else {
    classification = GEOMETRY_DRIFT_CLASSIFICATIONS.SOURCE_GEOMETRY_EVIDENCE_MISSING;
    if (!missingCore.length) missingCore.push("attributable_geometry_transition");
  }
  const recalibrationEvidence = classification === GEOMETRY_DRIFT_CLASSIFICATIONS.CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE &&
    evaluationGeometry.stopBelowCurrent === true && evaluationGeometry.targetAboveCurrent === false
    ? guardValueProposalEvidence({ sourceGeometry, evaluationGeometry, sourceLineage, preview })
    : null;
  const releaseContract = classification === GEOMETRY_DRIFT_CLASSIFICATIONS.CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE &&
    evaluationGeometry.stopBelowCurrent === false
    ? noRepairReleaseContract({
        sourceLineage,
        evaluationGeometry,
        lifecycleTransform,
        idempotencyPass,
        ownershipPass,
        fillStatePass,
        preview
      })
    : null;
  const currentPriceDriftResolution = classification === GEOMETRY_DRIFT_CLASSIFICATIONS.CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE
    ? !evaluationGeometry.stopBelowCurrent
      ? {
          status: "NO_REPAIR_STOP_BREACHED_POSITION_RISK_REVIEW",
          guardRecalibrationRequired: false,
          noRepairUntilFreshGeometry: true,
          reason: "stop_not_below_current",
          owner: "position_risk_review",
          nextAction: "keep_no_repair_route_to_position_risk_review",
          guardValueProposalEvidence: null,
          noRepairReleaseContract: releaseContract
        }
      : !evaluationGeometry.targetAboveCurrent
        ? {
            status: "GUARD_RECALIBRATION_REQUIRED_REPORT_ONLY",
            guardRecalibrationRequired: true,
            noRepairUntilFreshGeometry: true,
            reason: "target_not_above_current",
            owner: "guard_geometry_producer",
            nextAction: "request_current_position_guard_recalibration_report_only",
            guardValueProposalEvidence: recalibrationEvidence,
            noRepairReleaseContract: null
          }
        : {
            status: "NO_REPAIR_CURRENT_GEOMETRY_INVALID",
            guardRecalibrationRequired: false,
            noRepairUntilFreshGeometry: true,
            reason: "current_geometry_invalid",
            owner: "position_risk_review",
            nextAction: "keep_no_repair_route_to_position_risk_review",
            guardValueProposalEvidence: null,
            noRepairReleaseContract: null
          }
    : null;
  const contract = {
    [GEOMETRY_DRIFT_CLASSIFICATIONS.STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE]: {
      owner: "us_alpha_seeker_stage6_producer",
      blockedReason: "canonical_stage6_geometry_invalid_at_source",
      nextAction: "handoff_stage6_geometry_evidence_report_only"
    },
    [GEOMETRY_DRIFT_CLASSIFICATIONS.POSITION_LIFECYCLE_TRANSFORM_DRIFT]: {
      owner: "alpha_exec_engine_position_lifecycle_transform",
      blockedReason: "position_lifecycle_transform_invalidated_geometry",
      nextAction: "fix_lifecycle_transform_before_recovery_review"
    },
    [GEOMETRY_DRIFT_CLASSIFICATIONS.CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE]: {
      owner: currentPriceDriftResolution?.owner || "position_risk_review",
      blockedReason: currentPriceDriftResolution?.reason || "current_geometry_invalid",
      nextAction: currentPriceDriftResolution?.nextAction || "keep_no_repair_route_to_position_risk_review"
    },
    [GEOMETRY_DRIFT_CLASSIFICATIONS.SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH]: {
      owner: "data_lineage_contract",
      blockedReason: mismatchReasons.join(",") || "source_price_basis_or_timestamp_mismatch",
      nextAction: "reconcile_price_basis_and_timestamp_before_geometry_review"
    },
    [GEOMETRY_DRIFT_CLASSIFICATIONS.SOURCE_GEOMETRY_EVIDENCE_MISSING]: {
      owner: "geometry_evidence_collection",
      blockedReason: `missing:${missingCore.join(",")}`,
      nextAction: "collect_source_time_geometry_evidence_before_attribution"
    }
  }[classification];
  return {
    geometryDriftClassification: classification,
    geometryDriftOwner: contract.owner,
    evidenceCompleteness: missingCore.length ? "MISSING_CORE_EVIDENCE" : mismatchReasons.length ? "INCOMPARABLE" : optionalMissing.length ? "PARTIAL_OPTIONAL_METADATA_MISSING" : "COMPLETE",
    evidenceMissing: [...missingCore, ...optionalMissing],
    comparisonMismatchReasons: mismatchReasons,
    sourceSnapshot: source,
    evaluationSnapshot: evaluation,
    lifecycleTransform,
    sourceGeometry,
    evaluationGeometry,
    currentPriceDriftResolution,
    producerHandoff: classification === GEOMETRY_DRIFT_CLASSIFICATIONS.STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE
      ? {
          mode: "report_only",
          targetRepository: "US_Alpha_Seeker",
          stage6Hash: source.stage6Hash,
          stage6File: source.stage6File,
          sourceProducedAt: source.producedAt,
          sourceGeometry,
          brokerMutationAllowed: false,
          stateMutationAllowed: false
        }
      : null,
    blockedReason: contract.blockedReason,
    nextAction: contract.nextAction,
    repairEligibleNow: false
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

const ledgerRecordForMaterialization = ({ orderLedger, symbol, expectedRecordKey, stage6Hash, stage6File }) => {
  const orders = orderLedger?.orders || {};
  if (!expectedRecordKey) return null;
  const record = orders[expectedRecordKey];
  const identityMatches = Boolean(
    record &&
    asSymbol(record?.symbol) === symbol &&
    matchesExpectedStage6(record, stage6Hash, stage6File)
  );
  return identityMatches ? { key: expectedRecordKey, record } : null;
};

const stateMaterializationPackage = ({
  symbol,
  prerequisites,
  disposition,
  repairEligibleNow,
  selected,
  sourceLineage,
  expectedRecordKey,
  orderLedger,
  orderLedgerFileSha256,
  orderIdempotency,
  orderIdempotencyFileSha256,
  idempotencyStatus,
  idempotencyPass,
  ownershipClassification,
  ownershipPass,
  fillStateStatus,
  fillStatePass,
  generatedAt
}) => {
  const dynamicallySelected = prerequisites?.reviewReady === true &&
    disposition === RECOVERY_DISPOSITIONS.FRESH_SOURCE_MATERIALIZATION_REQUIRED &&
    repairEligibleNow === false;
  if (!dynamicallySelected) return null;

  const current = ledgerRecordForMaterialization({
    orderLedger,
    symbol,
    expectedRecordKey,
    stage6Hash: sourceLineage.expectedStage6Hash,
    stage6File: sourceLineage.expectedStage6File
  });
  const before = current
    ? Object.fromEntries(MATERIALIZATION_FIELDS.map((field) => [field, current.record?.[field] ?? null]))
    : null;
  const after = {
    stopLossPrice: toNum(selected?.stopPrice),
    takeProfitPrice: toNum(selected?.targetPrice),
    stage6Hash: selected?.stage6Hash || null,
    stage6File: selected?.stage6File || null,
    updatedAt: selected?.generatedAt || null
  };
  const proposedDiff = before
    ? MATERIALIZATION_FIELDS
      .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map((field) => ({ field, before: before[field], after: after[field] }))
    : [];
  const guardValueDiff = proposedDiff.filter((change) => GUARD_VALUE_FIELDS.includes(change.field));
  const ledgerIdentityMatches = Boolean(
    current &&
    current.record?.idempotencyKey === current.key &&
    asSymbol(current.record?.symbol) === symbol &&
    matchesExpectedStage6(current.record, sourceLineage.expectedStage6Hash, sourceLineage.expectedStage6File)
  );
  const ledgerFilled = Boolean(current && idempotencyReady(current.record?.brokerStatus || current.record?.status));
  const selectedIdempotencyRecord = current ? orderIdempotency?.orders?.[current.key] || null : null;
  const idempotencyIdentityMatches = Boolean(
    selectedIdempotencyRecord &&
    asSymbol(selectedIdempotencyRecord?.symbol) === symbol &&
    matchesExpectedStage6(selectedIdempotencyRecord, sourceLineage.expectedStage6Hash, sourceLineage.expectedStage6File)
  );
  const idempotencyFilled = Boolean(
    selectedIdempotencyRecord && idempotencyReady(selectedIdempotencyRecord?.brokerStatus || selectedIdempotencyRecord?.status)
  );
  const boundIdempotencyPass = idempotencyPass && ledgerIdentityMatches && ledgerFilled && idempotencyIdentityMatches && idempotencyFilled;
  const evidenceMissing = [];
  if (!current) evidenceMissing.push("current_order_ledger_record_missing");
  if (current && guardValueDiff.length === 0) evidenceMissing.push("no_guard_metadata_value_diff");
  if (current && !ledgerIdentityMatches) evidenceMissing.push("selected_ledger_record_identity_mismatch");
  if (current && !ledgerFilled) evidenceMissing.push("selected_ledger_record_not_filled");
  if (current && !selectedIdempotencyRecord) evidenceMissing.push("selected_idempotency_record_missing");
  if (selectedIdempotencyRecord && !idempotencyIdentityMatches) evidenceMissing.push("selected_idempotency_record_identity_mismatch");
  if (selectedIdempotencyRecord && !idempotencyFilled) evidenceMissing.push("selected_idempotency_record_not_filled");
  if (!idempotencyPass) evidenceMissing.push("upstream_idempotency_evidence_blocked");
  const proposalStatus = !current
    ? "BLOCKED_CURRENT_STATE_RECORD_MISSING"
    : guardValueDiff.length === 0
      ? "BLOCKED_NO_MATERIALIZATION_DIFF"
      : evidenceMissing.length > 0
        ? "BLOCKED_EVIDENCE_INCOMPLETE"
      : "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY";
  const packageBlocker = proposalStatus === "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY"
    ? null
    : evidenceMissing.some((item) => item.includes("idempotency"))
      ? "package_idempotency_blocked"
      : "package_evidence_incomplete";
  const backupDir = `${STATE_DIR}/migration-backups/<timestamp>`;
  const currentRecordHash = current ? sha256(JSON.stringify({ key: current.key, record: current.record })) : null;
  const proposedRecordHash = current
    ? sha256(JSON.stringify({ key: current.key, record: { ...current.record, ...after } }))
    : null;

  return {
    proposalStatus,
    reportOnly: true,
    selectionContract: {
      symbol,
      expectedRecordKey: expectedRecordKey || null,
      recordKey: current?.key || null,
      expectedStage6Hash: sourceLineage.expectedStage6Hash,
      expectedStage6File: sourceLineage.expectedStage6File,
      selectedSourceType: sourceLineage.sourceType,
      reviewReady: true,
      recoveryDisposition: disposition,
      repairEligibleNow: false,
      dynamicSelection: true
    },
    currentStateSnapshot: current
      ? {
          stateFile: "order-ledger.json",
          recordKey: current.key,
          fileSha256: orderLedgerFileSha256,
          recordSha256: currentRecordHash,
          guardFields: before
        }
      : null,
    selectedFreshSourceLineage: {
      sourceType: sourceLineage.sourceType,
      producedAt: sourceLineage.producedAt,
      receivedAt: sourceLineage.receivedAt,
      ttlMin: sourceLineage.ttlMin,
      expiresAt: sourceLineage.expiresAt,
      stage6Hash: sourceLineage.stage6Hash,
      stage6File: sourceLineage.stage6File,
      expectedStage6Hash: sourceLineage.expectedStage6Hash,
      expectedStage6File: sourceLineage.expectedStage6File,
      dispatchBasis: sourceLineage.dispatchBasis,
      dispatchStatus: sourceLineage.dispatchStatus,
      positionLineageMatchesCurrentPosition: sourceLineage.positionLineageMatchesCurrentPosition,
      lifecycle: sourceLineage.lifecycle
    },
    materializationFields: [...MATERIALIZATION_FIELDS],
    proposedDiff,
    guardValueDiff,
    proposedRecordSha256: proposedRecordHash,
    evidence: {
      idempotencyStatus: selectedIdempotencyRecord?.brokerStatus || selectedIdempotencyRecord?.status || idempotencyStatus,
      idempotencyPass: boundIdempotencyPass,
      upstreamIdempotencyStatus: idempotencyStatus,
      upstreamIdempotencyPass: idempotencyPass,
      selectedLedgerRecord: {
        recordFound: Boolean(current),
        identityMatches: ledgerIdentityMatches,
        filled: ledgerFilled
      },
      selectedIdempotencyRecord: {
        recordFound: Boolean(selectedIdempotencyRecord),
        recordSha256: selectedIdempotencyRecord ? sha256(JSON.stringify({ key: current?.key, record: selectedIdempotencyRecord })) : null,
        fileSha256: orderIdempotencyFileSha256,
        identityMatches: idempotencyIdentityMatches,
        filled: idempotencyFilled
      },
      ownershipClassification,
      ownershipPass,
      fillStateStatus,
      fillStatePass
    },
    evidenceMissing,
    packageBlocker,
    backupPlan: {
      requiredBeforeApply: true,
      backupPathTemplate: `${backupDir}/order-ledger.json.before`,
      auditRecordPathTemplate: `${backupDir}/guard-source-materialization-audit.json`,
      preserveFailedStatePathTemplate: `${backupDir}/order-ledger.json.failed`
    },
    auditRecordPreview: {
      type: "guard_source_state_materialization",
      generatedAt,
      symbol,
      recordKey: current?.key || null,
      sourceType: sourceLineage.sourceType,
      sourceProducedAt: sourceLineage.producedAt,
      sourceStage6Hash: sourceLineage.stage6Hash,
      sourceStage6File: sourceLineage.stage6File,
      beforeRecordSha256: currentRecordHash,
      proposedRecordSha256: proposedRecordHash,
      changedFields: proposedDiff.map((change) => change.field),
      stateMutationApplied: false
    },
    postVerifyChecks: [
      "approved order-ledger record hash matched before write",
      "only proposed guard metadata fields changed",
      "idempotency, ownership, and fill-state evidence remained unchanged",
      "guard-source recovery no longer reports state materialization required for the selected row",
      "repairEligibleNow remains false until a separate protective repair review"
    ],
    rollbackPlan: {
      restoreAtomically: true,
      restoreFrom: `${backupDir}/order-ledger.json.before`,
      preserveFailedStateAt: `${backupDir}/order-ledger.json.failed`,
      rerunReports: [
        "performance-dashboard",
        "fill-state-reconciliation-audit",
        "position-lifecycle-guard-source-plan",
        "guard-metadata-refresh-plan",
        "guard-metadata-lineage-audit",
        "broker-child-order-reconciliation",
        "position-protection-root-cause-audit",
        "guard-source-recovery-plan"
      ]
    },
    requiredApprovalPhrase: REQUIRED_STATE_MATERIALIZATION_APPROVAL,
    approvalScope: "alpha-exec-engine state-only selected dynamic guard-source row; no broker mutation",
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false
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
  const timestampMissing = refreshDecision === "BLOCKED_REFRESH_SOURCE_TIMESTAMP_MISSING" ||
    (refreshRow?.blockers || []).includes("selected_source_timestamp_missing");
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
  if (timestampMissing) {
    return {
      recoveryDecision: "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE",
      recoveryReady: false,
      repairEligibleNow: false,
      methods: [
        "fresh_stage6_same_symbol_if_candidate_present",
        "position_lifecycle_guard_refresh_from_confirmed_fill",
        "manual_guard_metadata_review_only"
      ],
      blockers: ["selected_source_timestamp_missing"]
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
  performancePosition,
  performanceGeneratedAt,
  preview,
  sourcePriority,
  orderLedger,
  orderIdempotency,
  recommendationLedger,
  stage6TradeLoop,
  orderLedgerFileSha256,
  orderIdempotencyFileSha256,
  generatedAt,
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
    selectedSourceGeometryValid && selectedSourceDispatchValid && sourceLineage.positionLineageMatchesCurrentPosition;
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
  const fillStateStatus = fillStateRow?.reconciliationDecision || refreshRow?.fillStateReconciliation?.status || protectionRow?.fillStateStatus || null;
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
  const candidateLineage = sourceCandidateLineageEvidence({ refreshRow, protectionRow, ttlMin, nowMs });
  const sourceAgeMin = sourceLineage.ageMin;
  const precedence = sourcePrecedenceEvidence(refreshRow, sourcePriority, candidateLineage);
  const preservation = sourcePreservation({
    selected,
    lineage: sourceLineage,
    geometryValid: selectedSourceGeometryValid,
    previousRow,
    positionLineageKey,
    nowMs
  });
  const normalizedRootCause = recoveryRootCause({
    status: recoveryStatus,
    sourceLineage,
    candidateLineage,
    preservation
  });
  const disposition = recoveryDisposition({
    status: recoveryStatus,
    rootCause: normalizedRootCause,
    selected,
    sourceLineage,
    lifecycleRow,
    geometryValid: selectedSourceGeometryValid
  });
  const blockerSource =
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE" ||
    decision.recoveryDecision === "FRESH_SOURCE_REQUIRED_NO_DYNAMIC_SOURCE_FOUND" ||
    decision.recoveryDecision === "BLOCK_INVALID_GUARD_GEOMETRY" ||
    decision.recoveryDecision === "BLOCKED_UNCLASSIFIED_GUARD_SOURCE_GAP"
      ? [...(refreshRow?.blockers || []), ...decision.blockers]
      : decision.blockers;
  if (normalizedRootCause === SOURCE_ROOT_CAUSES.STAGE6_DISPATCH_MISMATCH) blockerSource.push("stage6_dispatch_mismatch");
  if (normalizedRootCause === SOURCE_ROOT_CAUSES.LIFECYCLE_LINEAGE_MISSING) blockerSource.push("lifecycle_lineage_missing");
  if (normalizedRootCause === SOURCE_ROOT_CAUSES.PRESERVATION_CONTRACT_MISMATCH) blockerSource.push("preservation_contract_mismatch");
  if (normalizedRootCause === SOURCE_ROOT_CAUSES.SOURCE_PRODUCER_MISSING) blockerSource.push("source_producer_missing");
  const blockerDomain = protectionRow?.blockerDomain || (
    decision.recoveryDecision === "BLOCK_FILL_STATE_RECONCILIATION_FIRST"
      ? "ledger_fill_state"
      : protectionLane === PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED
        ? "ownership"
        : protectionLane === PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED
          ? "none"
          : "protection"
  );
  const driftAudit = geometryDriftAudit({
    disposition,
    symbol,
    selected,
    sourceLineage,
    lifecycleRow,
    performancePosition,
    performanceGeneratedAt,
    recommendationLedger,
    stage6TradeLoop,
    orderLedger,
    ttlMin,
    recoveryGeometry,
    preview,
    idempotencyPass,
    ownershipPass,
    fillStatePass: fillStateConfirmed
  });
  const lifecycleRefreshApplies = disposition === RECOVERY_DISPOSITIONS.NO_CURRENT_SOURCE_AVAILABLE &&
    normalizedRootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED &&
    blockerDomain === "protection";
  const lifecycleProducerRefreshContract = lifecycleRefreshApplies
    ? lifecycleRow?.producerRefreshContract || {
          status: "LIFECYCLE_PRODUCER_EVIDENCE_MISSING",
          sourceProducer: "position_lifecycle_guard_source",
          owner: "position_lifecycle_guard_source_producer",
          lineageDecision: lifecycleRow?.lineageDecision || null,
          expectedStage6Hash: sourceLineage.expectedStage6Hash,
          expectedStage6File: sourceLineage.expectedStage6File,
          currentPositionLineageMatch: sourceLineage.positionLineageMatchesCurrentPosition,
          guardValueChangeRequired: false,
          actualGuardValueDiffRequired: true,
          timestampOnlyRefreshAllowed: false,
          materializationCandidateAllowed: false,
          blockers: ["lifecycle_producer_evidence_missing"],
          nextAction: "restore_lifecycle_producer_refresh_evidence_report_only"
        }
    : null;
  const owner = driftAudit?.geometryDriftOwner ||
    (lifecycleRefreshApplies ? lifecycleProducerRefreshContract?.owner : null) ||
    recoveryOwner({ blockerDomain, rootCause: normalizedRootCause, disposition });
  const nextAction = driftAudit?.nextAction ||
    (lifecycleRefreshApplies ? lifecycleProducerRefreshContract?.nextAction : null) ||
    nextActionForRecovery(recoveryStatus, normalizedRootCause, disposition);
  const materializationPackage = stateMaterializationPackage({
    symbol,
    prerequisites: materializationPrerequisites,
    disposition,
    repairEligibleNow,
    selected,
    sourceLineage,
    expectedRecordKey: protectionRow?.plannedLedgerKey || null,
    orderLedger,
    orderLedgerFileSha256,
    orderIdempotency,
    orderIdempotencyFileSha256,
    idempotencyStatus,
    idempotencyPass,
    ownershipClassification,
    ownershipPass,
    fillStateStatus,
    fillStatePass: fillStateConfirmed,
    generatedAt
  });
  return {
    symbol,
    positionLineageKey,
    currentPrice: toNum(refreshRow?.currentPrice ?? protectionRow?.currentPrice),
    qty: toNum(refreshRow?.qty ?? protectionRow?.qty ?? reconciliationRow?.qty),
    ownershipClassification,
    fillStateStatus,
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
    sourceCandidateLineage: candidateLineage,
    sourcePreservation: preservation,
    stateMaterializationRequired: recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED,
    stateMaterializationPrerequisites: materializationPrerequisites,
    stateMaterializationPackage: materializationPackage,
    protectionLane,
    blockerDomain,
    repairEligibleNow,
    blockedReason: driftAudit?.blockedReason || protectionRow?.blockedReason || decision.blockers[0] || null,
    nextAction,
    geometry: protectionRow?.geometry || null,
    recoveryGeometry,
    geometryDriftAudit: driftAudit,
    lifecycleProducerRefreshContract,
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
  lines.push(`- materialization_packages: \`rows=${report.summary.materializationPackageRows} ready=${report.summary.materializationPackagesReady} missing=${report.summary.materializationPackageMissing} evidenceMissing=${report.summary.materializationPackageEvidenceMissing} readyEvidenceMissing=${report.summary.materializationReadyPackageEvidenceMissing} excludedLeaks=${report.summary.materializationPackageExcludedLaneLeaks}\``);
  lines.push(`- geometry_root_causes: \`${JSON.stringify(report.summary.geometryRootCauseCounts)}\``);
  lines.push(`- geometry_components: \`${JSON.stringify(report.summary.geometryInvalidComponentCounts)}\``);
  lines.push(`- geometry_drift_classifications: \`${JSON.stringify(report.summary.geometryDriftClassificationCounts)}\``);
  lines.push(`- geometry_drift_owners: \`${JSON.stringify(report.summary.geometryDriftOwnerCounts)}\``);
  lines.push(`- guard_recalibration_proposals: \`rows=${report.summary.guardRecalibrationProposalRows} ready=${report.summary.guardRecalibrationProposalReady} unsafe=${report.summary.guardRecalibrationProposalUnsafeEligibility}\``);
  lines.push(`- no_repair_release_contracts: \`rows=${report.summary.noRepairReleaseContractRows} blocked=${report.summary.noRepairReleaseBlocked} missing=${report.summary.noRepairReleaseContractMissing} unsafe=${report.summary.noRepairReleaseUnsafeEligibility}\``);
  lines.push(`- source_preservation: \`${JSON.stringify(report.summary.sourcePreservationStatusCounts)}\``);
  lines.push(`- fresh_source_status_counts: \`${JSON.stringify(report.summary.freshSourceRecoveryStatusCounts)}\``);
  lines.push(`- blocker_count_consistency: \`${report.classificationConsistency.blockerCountMatchesRootCause ? "pass" : "fail"}\``);
  lines.push("- safety: `report-only; no broker mutation; no state mutation`");
  lines.push("| Symbol | Lane | Recovery Status | Root Cause | Disposition | Owner | Geometry Drift | Drift Resolution | Guard Proposal | No-Repair Release | Evidence | Domain | Source | Produced / Received | TTL / Dispatch | Preservation | Current Fresh | Recovery Fresh | Materialize | Materialization Evidence | Package | Geometry | Geometry Causes | Idempotency | Repair Eligible | Next Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    const driftResolution = row.geometryDriftAudit?.currentPriceDriftResolution;
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.protectionLane || "N/A"} | ${row.recoveryStatus} | ${row.recoveryRootCause || "none"} | ${row.recoveryDisposition || "N/A"} | ${row.recoveryOwner || "N/A"} | ${row.geometryDriftAudit?.geometryDriftClassification || "N/A"} | ${driftResolution?.status || "N/A"} | ${driftResolution?.guardValueProposalEvidence?.status || "N/A"} | ${driftResolution?.noRepairReleaseContract?.status || "N/A"} | ${row.geometryDriftAudit?.evidenceCompleteness || "N/A"} | ${row.blockerDomain || "N/A"} | ${row.selectedSource?.type || "N/A"} | ${row.sourceLineage.producedAt || "N/A"} / ${row.sourceLineage.receivedAt || "N/A"} | ${row.sourceLineage.ttlMin}m / ${row.sourceLineage.dispatchStatus} | ${row.sourcePreservation.status} | ${row.currentSourceFresh ? "yes" : "no"} | ${row.recoverySourceFreshness} | ${row.stateMaterializationRequired ? "yes" : "no"} | ${row.stateMaterializationPrerequisites ? `${row.stateMaterializationPrerequisites.reviewReady ? "review_ready" : "blocked"}:${row.stateMaterializationPrerequisites.missingEvidence.join(",")}` : "N/A"} | ${row.stateMaterializationPackage?.proposalStatus || "N/A"} | ${row.recoveryGeometry.valid ? "valid" : "invalid"} | ${row.recoveryGeometry.rootCauses.join(",") || "none"} | ${row.idempotencyStatus}/${row.idempotencyPass ? "pass" : "block"} | ${row.repairEligibleNow ? "yes" : "no"} | ${row.nextAction} |`
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
  const orderLedger = readJson(FILES.orderLedger);
  const orderIdempotency = readJson(FILES.orderIdempotency);
  const recommendationLedger = readJson(FILES.recommendationLedger);
  const stage6TradeLoop = readJson(FILES.stage6TradeLoop);
  const orderLedgerText = fs.existsSync(FILES.orderLedger) ? fs.readFileSync(FILES.orderLedger, "utf8") : null;
  const orderLedgerFileSha256 = orderLedgerText == null ? null : sha256(orderLedgerText);
  const orderIdempotencyText = fs.existsSync(FILES.orderIdempotency) ? fs.readFileSync(FILES.orderIdempotency, "utf8") : null;
  const orderIdempotencyFileSha256 = orderIdempotencyText == null ? null : sha256(orderIdempotencyText);
  const preview = readJson(FILES.preview);
  const sourcePriority = Array.isArray(guardRefresh?.config?.sourcePriority) && guardRefresh.config.sourcePriority.length
    ? guardRefresh.config.sourcePriority.map((value) => String(value || "").trim()).filter(Boolean)
    : SOURCE_PRIORITY;
  const ttlMinRaw = toNum(guardRefresh?.config?.refreshSourceMaxAgeMin);
  const ttlMin = ttlMinRaw != null && ttlMinRaw > 0 ? ttlMinRaw : 30;
  const refreshReceivedAt = guardRefresh?.generatedAt || generatedAt;

  const refreshRows = Array.isArray(guardRefresh?.rows) ? guardRefresh.rows : [];
  const previousBySymbol = indexRows(previousPlan?.rows);
  const performanceBySymbol = indexRows(performance?.live?.positions);
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
      performancePosition: performanceBySymbol.get(symbol) || null,
      performanceGeneratedAt: performance?.generatedAt || null,
      preview,
      sourcePriority,
      orderLedger,
      orderIdempotency,
      recommendationLedger,
      stage6TradeLoop,
      orderLedgerFileSha256,
      orderIdempotencyFileSha256,
      generatedAt,
      previousRow: previousBySymbol.get(symbol) || null,
      refreshReceivedAt,
      ttlMin,
      nowMs
    });
  });
  const freshSourceRows = rows.filter((row) => row.protectionLane === PROTECTION_LANES.FRESH_GUARD_SOURCE_REQUIRED);
  const materializationRows = rows.filter((row) => row.recoveryStatus === RECOVERY_STATUSES.RECOVERY_SOURCE_MATERIALIZATION_REQUIRED);
  const materializationPackages = rows.filter((row) => row.stateMaterializationPackage);
  const geometryRootCauseRows = rows.filter((row) => row.recoveryDisposition === RECOVERY_DISPOSITIONS.SOURCE_GEOMETRY_UNUSABLE);
  const guardRecalibrationRows = geometryRootCauseRows.filter((row) =>
    row.geometryDriftAudit?.currentPriceDriftResolution?.status === "GUARD_RECALIBRATION_REQUIRED_REPORT_ONLY"
  );
  const noRepairStopBreachedRows = geometryRootCauseRows.filter((row) =>
    row.geometryDriftAudit?.currentPriceDriftResolution?.status === "NO_REPAIR_STOP_BREACHED_POSITION_RISK_REVIEW"
  );
  const lifecycleRefreshRows = freshSourceRows.filter((row) =>
    row.recoveryDisposition === RECOVERY_DISPOSITIONS.NO_CURRENT_SOURCE_AVAILABLE &&
    row.recoveryRootCause === SOURCE_ROOT_CAUSES.SOURCE_TTL_EXPIRED
  );

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
    materializationPackageRows: materializationPackages.length,
    materializationPackagesReady: count(materializationPackages, (row) => row.stateMaterializationPackage?.proposalStatus === "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY"),
    materializationReadyWithoutGuardValueDiff: count(materializationPackages, (row) =>
      row.stateMaterializationPackage?.proposalStatus === "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY" &&
      (row.stateMaterializationPackage?.guardValueDiff || []).length === 0
    ),
    materializationPackagesBlocked: count(materializationPackages, (row) =>
      MATERIALIZATION_PACKAGE_STATUSES.includes(row.stateMaterializationPackage?.proposalStatus) &&
      row.stateMaterializationPackage?.proposalStatus !== "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY"
    ),
    materializationPackageBlockerCounts: valueCounts(materializationPackages, (row) => row.stateMaterializationPackage?.packageBlocker),
    materializationPackageMissing: count(materializationRows, (row) => row.stateMaterializationPrerequisites?.reviewReady === true && !row.stateMaterializationPackage),
    materializationPackageEvidenceMissing: count(materializationPackages, (row) =>
      (row.stateMaterializationPackage?.evidenceMissing || []).length > 0
    ),
    materializationReadyPackageEvidenceMissing: count(materializationPackages, (row) =>
      row.stateMaterializationPackage?.proposalStatus === "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY" &&
      (row.stateMaterializationPackage?.evidenceMissing || []).length > 0
    ),
    materializationPackageExcludedLaneLeaks: count(rows, (row) => row.stateMaterializationPackage && !(
      row.stateMaterializationPrerequisites?.reviewReady === true &&
      row.recoveryDisposition === RECOVERY_DISPOSITIONS.FRESH_SOURCE_MATERIALIZATION_REQUIRED &&
      row.repairEligibleNow === false
    )),
    materializationPackageDiffOutsideGuardFields: count(materializationPackages, (row) =>
      (row.stateMaterializationPackage?.proposedDiff || []).some((change) => !MATERIALIZATION_FIELDS.includes(change?.field))
    ),
    materializationPackageUnclassified: count(materializationPackages, (row) =>
      !MATERIALIZATION_PACKAGE_STATUSES.includes(row.stateMaterializationPackage?.proposalStatus)
    ),
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
    geometryDriftClassificationCounts: valueCounts(geometryRootCauseRows, (row) => row.geometryDriftAudit?.geometryDriftClassification),
    geometryDriftOwnerCounts: valueCounts(geometryRootCauseRows, (row) => row.geometryDriftAudit?.geometryDriftOwner),
    geometryDriftUnclassified: count(geometryRootCauseRows, (row) =>
      !Object.values(GEOMETRY_DRIFT_CLASSIFICATIONS).includes(row.geometryDriftAudit?.geometryDriftClassification)
    ),
    geometryDriftEvidenceMissing: count(geometryRootCauseRows, (row) =>
      row.geometryDriftAudit?.evidenceCompleteness === "MISSING_CORE_EVIDENCE"
    ),
    guardRecalibrationProposalRows: count(guardRecalibrationRows, (row) =>
      Boolean(row.geometryDriftAudit?.currentPriceDriftResolution?.guardValueProposalEvidence)
    ),
    guardRecalibrationProposalReady: count(guardRecalibrationRows, (row) =>
      row.geometryDriftAudit?.currentPriceDriftResolution?.guardValueProposalEvidence?.status ===
        "REPORT_ONLY_GUARD_VALUE_PROPOSAL_READY_FOR_PRODUCER_REVIEW"
    ),
    guardRecalibrationProposalMissing: count(guardRecalibrationRows, (row) =>
      !row.geometryDriftAudit?.currentPriceDriftResolution?.guardValueProposalEvidence
    ),
    guardRecalibrationProposalUnclassified: count(guardRecalibrationRows, (row) => ![
      "REPORT_ONLY_GUARD_VALUE_PROPOSAL_READY_FOR_PRODUCER_REVIEW",
      "REPORT_ONLY_GUARD_VALUE_PROPOSAL_EVIDENCE_INCOMPLETE"
    ].includes(row.geometryDriftAudit?.currentPriceDriftResolution?.guardValueProposalEvidence?.status)),
    guardRecalibrationProposalUnsafeEligibility: count(guardRecalibrationRows, (row) => {
      const evidence = row.geometryDriftAudit?.currentPriceDriftResolution?.guardValueProposalEvidence;
      return evidence?.eligibleForStateMaterialization === true || evidence?.eligibleForBrokerRepair === true ||
        evidence?.brokerMutationAllowed === true || evidence?.stateMutationAllowed === true;
    }),
    noRepairReleaseContractRows: count(noRepairStopBreachedRows, (row) =>
      Boolean(row.geometryDriftAudit?.currentPriceDriftResolution?.noRepairReleaseContract)
    ),
    noRepairReleaseBlocked: count(noRepairStopBreachedRows, (row) =>
      row.geometryDriftAudit?.currentPriceDriftResolution?.noRepairReleaseContract?.status === "NO_REPAIR_RELEASE_BLOCKED"
    ),
    noRepairReleaseContractMissing: count(noRepairStopBreachedRows, (row) =>
      !row.geometryDriftAudit?.currentPriceDriftResolution?.noRepairReleaseContract
    ),
    noRepairReleaseUnclassified: count(noRepairStopBreachedRows, (row) => ![
      "NO_REPAIR_RELEASE_BLOCKED",
      "NO_REPAIR_RELEASE_REEVALUATION_READY_REPORT_ONLY"
    ].includes(row.geometryDriftAudit?.currentPriceDriftResolution?.noRepairReleaseContract?.status)),
    noRepairReleaseUnsafeEligibility: count(noRepairStopBreachedRows, (row) => {
      const contract = row.geometryDriftAudit?.currentPriceDriftResolution?.noRepairReleaseContract;
      return contract?.eligibleForStateMaterialization === true || contract?.eligibleForBrokerRepair === true ||
        contract?.brokerMutationAllowed === true || contract?.stateMutationAllowed === true;
    }),
    lifecycleProducerRefreshStatusCounts: valueCounts(lifecycleRefreshRows, (row) => row.lifecycleProducerRefreshContract?.status),
    lifecycleProducerRefreshUnclassified: count(lifecycleRefreshRows, (row) => !row.lifecycleProducerRefreshContract?.status),
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
    materializationPackagesComplete: summary.materializationPackageMissing === 0 &&
      summary.materializationReadyPackageEvidenceMissing === 0 &&
      summary.materializationPackageExcludedLaneLeaks === 0 &&
      summary.materializationPackageDiffOutsideGuardFields === 0 &&
      summary.materializationPackageUnclassified === 0,
    materializationRequiresGuardValueDiff: summary.materializationReadyWithoutGuardValueDiff === 0,
    geometryRootCausesClassified: summary.geometryRootCauseUnclassified === 0,
    geometryDriftClassified: summary.geometryDriftUnclassified === 0,
    guardRecalibrationProposalsSafe: summary.guardRecalibrationProposalMissing === 0 &&
      summary.guardRecalibrationProposalUnclassified === 0 &&
      summary.guardRecalibrationProposalUnsafeEligibility === 0,
    noRepairReleaseContractsComplete: summary.noRepairReleaseContractMissing === 0 &&
      summary.noRepairReleaseUnclassified === 0 &&
      summary.noRepairReleaseUnsafeEligibility === 0,
    lifecycleProducerRefreshClassified: summary.lifecycleProducerRefreshUnclassified === 0
  };
  const overall = summary.unclassifiedRows > 0 || summary.recoveryStatusUnknown > 0 ||
    summary.sourceRootCauseUnknown > 0 || summary.sourcePreservationUnknown > 0 || summary.recoveryDispositionUnclassified > 0 ||
    summary.repairEligibleWithoutAppliedFreshSource > 0 || summary.repairEligibleWithLineageMismatch > 0 ||
    summary.repairEligibleWithoutOwnershipPass > 0 || summary.repairEligibleWithoutFillStatePass > 0 ||
    summary.dispatchMismatchRepairEligible > 0 || summary.ttlExpiredClassifiedCurrentSourceFresh > 0 ||
    summary.producerMissingOwnershipLaneLeaks > 0 || summary.materializationPrerequisiteUnclassified > 0 ||
    summary.materializationPackageMissing > 0 || summary.materializationReadyPackageEvidenceMissing > 0 ||
    summary.materializationPackageExcludedLaneLeaks > 0 || summary.materializationPackageDiffOutsideGuardFields > 0 ||
    summary.materializationPackageUnclassified > 0 || summary.materializationReadyWithoutGuardValueDiff > 0 ||
    summary.geometryRootCauseUnclassified > 0 || summary.geometryDriftUnclassified > 0 ||
    summary.guardRecalibrationProposalMissing > 0 || summary.guardRecalibrationProposalUnclassified > 0 ||
    summary.guardRecalibrationProposalUnsafeEligibility > 0 || summary.noRepairReleaseContractMissing > 0 ||
    summary.noRepairReleaseUnclassified > 0 || summary.noRepairReleaseUnsafeEligibility > 0 ||
    summary.lifecycleProducerRefreshUnclassified > 0 ||
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
