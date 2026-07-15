#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-source-recovery-status-"));
const now = new Date().toISOString();
const stale = "2020-01-01T00:00:00.000Z";
const writeJson = (name, payload) => fs.writeFileSync(
  path.join(stateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

const source = ({
  type = "position_lifecycle_revalidated_guard",
  generatedAt = now,
  fresh = true,
  stopPrice = 90,
  targetPrice = 120,
  stage6Hash = `hash-${type}`,
  stage6File = `stage6-${type}.json`
} = {}) => ({
  type,
  generatedAt,
  ageMin: fresh ? 1 : 999999,
  fresh,
  hasBothPrices: true,
  stopPrice,
  targetPrice,
  stage6Hash,
  stage6File
});

const protectionRow = (symbol, overrides = {}) => ({
  symbol,
  qty: 1,
  currentPrice: 100,
  ownershipClassification: "SIDECAR_MANAGED_FILLED",
  fillStateStatus: "confirmed_filled",
  protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
  blockerDomain: "protection",
  guardSourceFresh: false,
  guardSourceFreshness: "stale",
  effectiveGuardGeneratedAt: now,
  plannedLedgerUpdatedAt: now,
  geometry: { valid: true },
  idempotencyStatus: "filled",
  plannedStage6Hash: "latest-hash",
  plannedStage6File: "latest-stage6.json",
  repairEligible: false,
  blockedReason: "guard_metadata_stale",
  nextAction: "obtain_fresh_guard_source_before_repair_review",
  ...overrides
});

const refreshRow = (symbol, selectedSource, overrides = {}) => ({
  symbol,
  qty: 1,
  currentPrice: 100,
  ownershipClassification: "SIDECAR_MANAGED_FILLED",
  fillStateReconciliation: { status: "confirmed_filled" },
  selectedSource,
  sourceCandidates: selectedSource ? [selectedSource] : [],
  selectedSourceFresh: selectedSource?.fresh === true,
  selectedSourceGeometryValid: selectedSource
    ? selectedSource.stopPrice < 100 && 100 < selectedSource.targetPrice
    : false,
  broker: { stopPresent: false, targetPresent: false },
  refreshReady: selectedSource?.fresh === true,
  refreshDecision: selectedSource?.fresh === true
    ? "REFRESH_READY_THEN_REEVALUATE_REPAIR"
    : "BLOCKED_REFRESH_SOURCE_STALE",
  afterRefreshRepairDecision: selectedSource?.fresh === true
    ? "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"
    : "NOT_EVALUATED_REFRESH_BLOCKED",
  blockers: selectedSource?.fresh === true ? [] : ["selected_source_stale"],
  lineage: { idempotencyBrokerStatus: "filled" },
  ...overrides
});

const current = source({ type: "recommendation_ledger" });
const ready = source({
  type: "order_ledger",
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const materialization = source({
  type: "position_lifecycle_revalidated_guard",
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const lifecycleMismatch = source({
  type: "position_lifecycle_revalidated_guard",
  stage6Hash: "different-lifecycle-hash",
  stage6File: "different-lifecycle-stage6.json"
});
const unavailable = source({
  type: "order_ledger",
  generatedAt: stale,
  fresh: false,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const dispatchMismatch = source({
  type: "stage6_20trade_loop",
  stage6Hash: "different-hash",
  stage6File: "different-stage6.json"
});
const invalid = source({
  type: "stage6_20trade_loop",
  stopPrice: 90,
  targetPrice: 95,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const ttlInvalid = source({
  type: "order_ledger",
  generatedAt: stale,
  fresh: false,
  stopPrice: 105,
  targetPrice: 130,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});

writeJson("performance-dashboard.json", { generatedAt: now, live: { available: true } });
writeJson("last-dry-exec-preview.json", { stage6Hash: "latest-hash", stage6File: "latest-stage6.json" });
writeJson("position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 8 },
  rows: [
    protectionRow("CURR", {
      effectiveGuardSource: "recommendation_ledger",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh"
    }),
    protectionRow("READY", {
      protectionLane: "MANUAL_APPROVAL_CANDIDATE",
      blockerDomain: "none",
      effectiveGuardSource: "order_ledger",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh",
      repairEligible: true,
      blockedReason: null,
      nextAction: "manual_approval_review_only"
    }),
    protectionRow("MAT", {
      effectiveGuardSource: "position_lifecycle_revalidated_guard",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh",
      effectiveGuardGeneratedAt: stale
    }),
    protectionRow("LIFE", {
      protectionLane: "MANUAL_APPROVAL_CANDIDATE",
      effectiveGuardSource: "position_lifecycle_revalidated_guard",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh",
      repairEligible: true,
      blockedReason: null,
      nextAction: "manual_approval_review_only"
    }),
    protectionRow("NONE"),
    protectionRow("DISP"),
    protectionRow("MISS", {
      ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION",
      protectionLane: "OWNERSHIP_PROOF_REQUIRED",
      blockerDomain: "ownership",
      blockedReason: "position_not_sidecar_managed",
      nextAction: "establish_sidecar_ownership_proof_before_guard_recovery"
    }),
    protectionRow("BAD"),
    protectionRow("TTL_BAD"),
    protectionRow("PROD")
  ]
});
const refreshPlan = {
  generatedAt: now,
  config: {
    refreshSourceMaxAgeMin: 30,
    sourcePriority: ["broker_children", "position_lifecycle_revalidated_guard", "recommendation_ledger", "stage6_20trade_loop", "order_ledger"]
  },
  rows: [
    refreshRow("CURR", current),
    refreshRow("READY", ready),
    refreshRow("MAT", materialization),
    refreshRow("LIFE", lifecycleMismatch),
    refreshRow("NONE", unavailable),
    refreshRow("DISP", dispatchMismatch),
    refreshRow("MISS", null, {
      ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION",
      refreshReady: false,
      refreshDecision: "BLOCKED_NO_REFRESH_SOURCE",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["no_guard_refresh_source"]
    }),
    refreshRow("BAD", invalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    }),
    refreshRow("TTL_BAD", ttlInvalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_STALE",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_stale", "selected_source_invalid_geometry"]
    }),
    refreshRow("PROD", null, {
      refreshReady: false,
      refreshDecision: "BLOCKED_NO_REFRESH_SOURCE",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["no_guard_refresh_source"]
    })
  ]
};
writeJson("guard-metadata-refresh-plan.json", refreshPlan);
writeJson("guard-metadata-lineage-audit.json", {
  rows: [
    { symbol: "CURR", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "READY", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "MAT", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "LIFE", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "NONE", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "DISP", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "MISS", lineageStatus: "LINEAGE_MISSING_NO_SOURCE", rootCause: "NO_SOURCE_WITH_STOP_TARGET" },
    { symbol: "BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "TTL_BAD", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "PROD", lineageStatus: "LINEAGE_MISSING_NO_SOURCE", rootCause: "NO_SOURCE_WITH_STOP_TARGET" }
  ]
});
writeJson("position-lifecycle-guard-source-plan.json", {
  rows: [
    {
      symbol: "MAT",
      lifecycleReady: true,
      lifecycleDecision: "POSITION_LIFECYCLE_GUARD_SOURCE_READY_REPORT_ONLY",
      lifecycleSource: {
        type: "position_lifecycle_revalidated_guard",
        generatedAt: now,
        originalSourceType: "order_ledger",
        originalGeneratedAt: stale,
        originalAgeMin: 999999,
        stage6Hash: materialization.stage6Hash,
        stage6File: materialization.stage6File
      }
    },
    {
      symbol: "LIFE",
      lifecycleReady: true,
      lifecycleDecision: "POSITION_LIFECYCLE_GUARD_SOURCE_READY_REPORT_ONLY",
      lifecycleSource: {
        type: "position_lifecycle_revalidated_guard",
        generatedAt: now,
        originalSourceType: "order_ledger",
        originalGeneratedAt: stale,
        originalAgeMin: 999999,
        stage6Hash: lifecycleMismatch.stage6Hash,
        stage6File: lifecycleMismatch.stage6File
      }
    }
  ]
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: ["CURR", "READY", "MAT", "LIFE", "NONE", "DISP", "MISS", "BAD", "TTL_BAD", "PROD"].map((symbol) => ({
    symbol,
    reconciliationDecision: "FILL_STATE_CONFIRMED",
    requiresLedgerTerminalizationReview: false
  }))
});
writeJson("broker-child-order-reconciliation.json", { rows: [] });
writeJson("order-ledger.json", {
  orders: {
    "latest-hash:MAT:buy": {
      idempotencyKey: "latest-hash:MAT:buy",
      symbol: "MAT",
      status: "filled",
      stage6Hash: "latest-hash",
      stage6File: "latest-stage6.json",
      stopLossPrice: 90,
      takeProfitPrice: 120,
      updatedAt: stale
    }
  }
});

execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const bySymbol = new Map(report.rows.map((row) => [row.symbol, row]));

assert.equal(bySymbol.get("CURR")?.recoveryStatus, "CURRENT_SOURCE_FRESH");
assert.equal(bySymbol.get("READY")?.recoveryStatus, "RECOVERY_SOURCE_READY_REPORT_ONLY");
assert.equal(bySymbol.get("MAT")?.recoveryStatus, "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED");
assert.equal(bySymbol.get("LIFE")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("NONE")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("DISP")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("MISS")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("BAD")?.recoveryStatus, "RECOVERY_SOURCE_INVALID_GEOMETRY");
assert.equal(bySymbol.get("MAT")?.recoveryReady, true);
assert.equal(bySymbol.get("MAT")?.currentSourceFresh, false);
assert.equal(bySymbol.get("MAT")?.repairEligibleNow, false);
assert.equal(bySymbol.get("MAT")?.stateMaterializationRequired, true);
assert.equal(bySymbol.get("MAT")?.recoveryRootCause, "state_materialization_missing");
assert.equal(bySymbol.get("MAT")?.recoveryDisposition, "FRESH_SOURCE_MATERIALIZATION_REQUIRED");
assert.deepEqual(bySymbol.get("MAT")?.stateMaterializationPrerequisites, {
  applicable: true,
  mode: "report_only",
  recoverySourceAvailable: true,
  recoverySourceFresh: true,
  recoverySourceDispatchValid: true,
  recoverySourceLineageMatchesCurrentPosition: true,
  recoverySourceGeometryValid: true,
  idempotencyPass: true,
  ownershipPass: true,
  fillStatePass: true,
  recoverySourceAppliedToCurrentState: false,
  prerequisiteFailures: [],
  missingEvidence: ["fresh_recovery_source_not_applied_to_current_state"],
  reviewReady: true,
  repairEligibleNow: false,
  stateMutationAllowed: false
});
const materializationPackage = bySymbol.get("MAT")?.stateMaterializationPackage;
assert.equal(materializationPackage?.proposalStatus, "REPORT_ONLY_STATE_MATERIALIZATION_PACKAGE_READY");
assert.deepEqual(materializationPackage?.selectionContract, {
  reviewReady: true,
  recoveryDisposition: "FRESH_SOURCE_MATERIALIZATION_REQUIRED",
  repairEligibleNow: false,
  dynamicSelection: true
});
assert.equal(materializationPackage?.currentStateSnapshot?.stateFile, "order-ledger.json");
assert.equal(materializationPackage?.currentStateSnapshot?.recordKey, "latest-hash:MAT:buy");
assert.match(materializationPackage?.currentStateSnapshot?.recordSha256 || "", /^[a-f0-9]{64}$/);
assert.match(materializationPackage?.currentStateSnapshot?.fileSha256 || "", /^[a-f0-9]{64}$/);
assert.equal(materializationPackage?.selectedFreshSourceLineage?.sourceType, "position_lifecycle_revalidated_guard");
assert.equal(materializationPackage?.selectedFreshSourceLineage?.stage6Hash, "latest-hash");
assert.deepEqual(materializationPackage?.materializationFields, [
  "stopLossPrice",
  "takeProfitPrice",
  "stage6Hash",
  "stage6File",
  "updatedAt"
]);
assert.ok(materializationPackage?.proposedDiff?.length > 0);
assert.equal(
  materializationPackage?.proposedDiff?.every((change) => materializationPackage.materializationFields.includes(change.field)),
  true
);
assert.equal(materializationPackage?.backupPlan?.requiredBeforeApply, true);
assert.match(materializationPackage?.backupPlan?.backupPathTemplate || "", /order-ledger\.json\.before$/);
assert.equal(materializationPackage?.auditRecordPreview?.stateMutationApplied, false);
assert.equal(materializationPackage?.auditRecordPreview?.sourceStage6Hash, "latest-hash");
assert.equal(materializationPackage?.postVerifyChecks?.length > 0, true);
assert.equal(materializationPackage?.rollbackPlan?.restoreAtomically, true);
assert.equal(materializationPackage?.evidence?.idempotencyPass, true);
assert.equal(materializationPackage?.evidence?.idempotencyStatus, "filled");
assert.equal(materializationPackage?.evidence?.ownershipPass, true);
assert.equal(materializationPackage?.evidence?.ownershipClassification, "SIDECAR_MANAGED_FILLED");
assert.equal(materializationPackage?.evidence?.fillStatePass, true);
assert.equal(materializationPackage?.evidence?.fillStateStatus, "FILL_STATE_CONFIRMED");
assert.equal(materializationPackage?.requiredApprovalPhrase, "CONFIRM STATE GUARD MATERIALIZATION");
assert.equal(materializationPackage?.stateMutationAllowed, false);
assert.equal(bySymbol.get("NONE")?.recoveryRootCause, "source_ttl_expired");
assert.equal(bySymbol.get("NONE")?.recoveryDisposition, "NO_CURRENT_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("NONE")?.nextAction, "wait_for_fresh_stage6_or_lifecycle_guard_source");
assert.equal(bySymbol.get("DISP")?.recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(bySymbol.get("DISP")?.recoveryDisposition, "EXPECTED_STALE_SOURCE_BLOCK");
assert.equal(bySymbol.get("DISP")?.sourceLineage?.dispatchStatus, "MISMATCH");
assert.equal(bySymbol.get("LIFE")?.recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(bySymbol.get("LIFE")?.recoveryDisposition, "LIFECYCLE_LINEAGE_PROPAGATION_DEFECT");
assert.equal(bySymbol.get("LIFE")?.sourceLineage?.dispatchStatus, "MISMATCH");
assert.equal(bySymbol.get("LIFE")?.sourcePreservation?.lineageKeyMatchesCurrentPosition, false);
assert.equal(bySymbol.get("LIFE")?.repairEligibilityContract?.sourceLineageMatchesCurrentPosition, false);
assert.equal(bySymbol.get("LIFE")?.repairEligibleNow, false);
assert.equal(bySymbol.get("MISS")?.recoveryRootCause, "source_producer_missing");
assert.equal(bySymbol.get("MISS")?.recoveryOwner, "position_ownership_proof");
assert.equal(bySymbol.get("MISS")?.blockerDomain, "ownership");
assert.equal(bySymbol.get("BAD")?.recoveryRootCause, "source_geometry_unusable");
assert.equal(bySymbol.get("BAD")?.recoveryDisposition, "SOURCE_GEOMETRY_UNUSABLE");
assert.deepEqual(bySymbol.get("BAD")?.recoveryGeometry?.invalidComponents, ["target"]);
assert.deepEqual(bySymbol.get("BAD")?.recoveryGeometry?.rootCauses, ["target_not_above_current"]);
assert.equal(bySymbol.get("TTL_BAD")?.recoveryRootCause, "source_ttl_expired");
assert.equal(bySymbol.get("TTL_BAD")?.recoveryDisposition, "SOURCE_GEOMETRY_UNUSABLE");
assert.equal(bySymbol.get("TTL_BAD")?.recoveryOwner, "guard_geometry_producer");
assert.deepEqual(bySymbol.get("TTL_BAD")?.recoveryGeometry?.invalidComponents, ["stop"]);
assert.deepEqual(bySymbol.get("TTL_BAD")?.recoveryGeometry?.rootCauses, ["stop_not_below_current"]);
assert.equal(bySymbol.get("TTL_BAD")?.nextAction, "route_to_guard_geometry_root_cause_no_repair");
for (const symbol of ["BAD", "TTL_BAD", "DISP", "MISS"]) {
  assert.equal(bySymbol.get(symbol)?.stateMaterializationPackage, null);
}
assert.equal(bySymbol.get("PROD")?.recoveryRootCause, "source_producer_missing");
assert.equal(bySymbol.get("PROD")?.blockerDomain, "protection");
assert.equal(bySymbol.get("MAT")?.sourceLineage?.producedAt, now);
assert.equal(bySymbol.get("MAT")?.sourceLineage?.receivedAt, now);
assert.equal(bySymbol.get("MAT")?.sourceLineage?.ttlMin, 30);
assert.equal(bySymbol.get("MAT")?.sourceLineage?.expiresAt, new Date(Date.parse(now) + (30 * 60_000)).toISOString());
assert.equal(bySymbol.get("MAT")?.sourceLineage?.dispatchStatus, "MATCH");
assert.equal(bySymbol.get("MAT")?.sourceLineage?.lifecycle?.ready, true);
assert.equal(bySymbol.get("MAT")?.sourceLineage?.lifecycle?.originalSourceType, "order_ledger");
assert.equal(bySymbol.get("MAT")?.sourcePreservation?.status, "PRESERVED_ACTIVE_REPORT_ONLY");
assert.equal(bySymbol.get("MAT")?.sourcePreservation?.lineageKeyMatchesCurrentPosition, true);
assert.equal(bySymbol.get("MAT")?.sourcePreservation?.usedForRepairEligibility, false);
assert.equal(bySymbol.get("READY")?.repairEligibilityContract?.currentSourceApplied, true);
assert.equal(bySymbol.get("READY")?.repairEligibilityContract?.ownershipPass, true);
assert.equal(bySymbol.get("READY")?.repairEligibilityContract?.fillStatePass, true);
assert.equal(report.summary.recoveryStatusUnknown, 0);
assert.equal(report.summary.sourceRootCauseUnknown, 0);
assert.equal(report.summary.sourcePreservationUnknown, 0);
assert.equal(report.summary.recoveryDispositionUnclassified, 0);
assert.equal(report.summary.sourcePrecedenceViolations, 0);
assert.equal(report.summary.repairEligibleWithLineageMismatch, 0);
assert.equal(report.summary.repairEligibleWithoutOwnershipPass, 0);
assert.equal(report.summary.repairEligibleWithoutFillStatePass, 0);
assert.equal(report.summary.dispatchMismatchRepairEligible, 0);
assert.equal(report.summary.ttlExpiredClassifiedCurrentSourceFresh, 0);
assert.equal(report.summary.producerMissingOwnershipLaneLeaks, 0);
assert.equal(report.summary.materializationPrerequisiteRows, 1);
assert.equal(report.summary.materializationReviewReady, 1);
assert.equal(report.summary.materializationPrerequisiteUnclassified, 0);
assert.equal(report.summary.materializationPackageRows, 1);
assert.equal(report.summary.materializationPackagesReady, 1);
assert.equal(report.summary.materializationPackageEvidenceMissing, 0);
assert.equal(report.summary.materializationPackageExcludedLaneLeaks, 0);
assert.equal(report.summary.geometryRootCauseRows, 2);
assert.equal(report.summary.geometryRootCauseUnclassified, 0);
assert.deepEqual(report.summary.geometryInvalidComponentCounts, {
  stop: 1,
  current: 0,
  target: 1,
  producer: 0
});
assert.equal(report.classificationConsistency.recoveryStatusCountMatchesRows, true);
assert.equal(report.classificationConsistency.freshSourceStatusCountMatchesLane, true);
assert.equal(report.summary.stateMutationAttempted, false);
assert.equal(report.summary.stateMutationSubmitted, false);
assert.equal(report.summary.brokerMutationAttempted, false);
assert.equal(report.summary.brokerMutationSubmitted, false);

refreshPlan.rows = refreshPlan.rows.map((row) => row.symbol === "MAT"
  ? refreshRow("MAT", null, {
      refreshReady: false,
      refreshDecision: "BLOCKED_NO_REFRESH_SOURCE",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["no_guard_refresh_source"]
    })
  : row);
writeJson("guard-metadata-refresh-plan.json", refreshPlan);
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});

const replay = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const replayMat = replay.rows.find((row) => row.symbol === "MAT");
assert.equal(replayMat?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(replayMat?.recoveryRootCause, "source_producer_missing");
assert.equal(replayMat?.sourcePreservation?.source?.type, "position_lifecycle_revalidated_guard");
assert.equal(replayMat?.sourcePreservation?.status, "PRESERVED_ACTIVE_REPORT_ONLY");
assert.equal(replayMat?.sourcePreservation?.usedForRepairEligibility, false);
assert.equal(replayMat?.repairEligibleNow, false);

console.log("[GUARD_SOURCE_RECOVERY_STATUS_TEST] pass");
