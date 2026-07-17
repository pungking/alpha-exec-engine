#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-source-recovery-status-"));
const now = new Date().toISOString();
const recent = new Date(Date.parse(now) - (10 * 60_000)).toISOString();
const stale = "2020-01-01T00:00:00.000Z";
const writeJson = (name, payload) => fs.writeFileSync(
  path.join(stateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

const fillStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fill-state-lineage-"));
const writeFillStateJson = (name, payload) => fs.writeFileSync(
  path.join(fillStateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);
const exactFillKey = "hash:SYN_EXACT:buy";
const newerFillKey = "hash:SYN_EXACT:replacement";
const fillPosition = {
  symbol: "SYN_EXACT",
  qty: 1,
  currentPrice: 100,
  normalizedFillState: "FILLED",
  positionStatus: "open",
  plannedLedgerKey: exactFillKey,
  plannedStage6Hash: "hash"
};
writeFillStateJson("performance-dashboard.json", { live: { available: true, positions: [fillPosition] } });
writeFillStateJson("order-ledger.json", { orders: {
  [exactFillKey]: { idempotencyKey: exactFillKey, symbol: "SYN_EXACT", status: "filled", updatedAt: stale },
  [newerFillKey]: { idempotencyKey: newerFillKey, symbol: "SYN_EXACT", status: "filled", updatedAt: now }
} });
writeFillStateJson("order-idempotency.json", { orders: {
  [exactFillKey]: { symbol: "SYN_EXACT", brokerStatus: "filled", brokerCheckedAt: stale },
  [newerFillKey]: { symbol: "SYN_EXACT", brokerStatus: "filled", brokerCheckedAt: now }
} });
execFileSync(process.execPath, ["scripts/build-fill-state-reconciliation-audit.mjs"], {
  env: { ...process.env, FILL_STATE_RECONCILIATION_STATE_DIR: fillStateDir },
  stdio: "pipe"
});
let fillStateReport = JSON.parse(fs.readFileSync(path.join(fillStateDir, "fill-state-reconciliation-audit.json"), "utf8"));
assert.equal(fillStateReport.rows[0]?.ledger?.key, exactFillKey);
assert.equal(fillStateReport.rows[0]?.idempotency?.key, exactFillKey);
assert.equal(fillStateReport.rows[0]?.reconciliationDecision, "FILL_STATE_CONFIRMED");

writeFillStateJson("performance-dashboard.json", {
  live: { available: true, positions: [{ ...fillPosition, plannedLedgerKey: "hash:SYN_EXACT:missing" }] }
});
execFileSync(process.execPath, ["scripts/build-fill-state-reconciliation-audit.mjs"], {
  env: { ...process.env, FILL_STATE_RECONCILIATION_STATE_DIR: fillStateDir },
  stdio: "pipe"
});
fillStateReport = JSON.parse(fs.readFileSync(path.join(fillStateDir, "fill-state-reconciliation-audit.json"), "utf8"));
assert.equal(fillStateReport.rows[0]?.reconciliationDecision, "FILL_STATE_UNKNOWN_REVIEW");
assert.equal(fillStateReport.rows[0]?.blockers?.includes("expected_position_ledger_key_missing"), true);

writeFillStateJson("performance-dashboard.json", {
  live: { available: true, positions: [{ ...fillPosition, plannedLedgerKey: null }] }
});
execFileSync(process.execPath, ["scripts/build-fill-state-reconciliation-audit.mjs"], {
  env: { ...process.env, FILL_STATE_RECONCILIATION_STATE_DIR: fillStateDir },
  stdio: "pipe"
});
fillStateReport = JSON.parse(fs.readFileSync(path.join(fillStateDir, "fill-state-reconciliation-audit.json"), "utf8"));
assert.equal(fillStateReport.rows[0]?.reconciliationDecision, "FILL_STATE_UNKNOWN_REVIEW");
assert.equal(fillStateReport.rows[0]?.blockers?.includes("expected_position_ledger_key_missing"), true);

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
  plannedLedgerKey: `latest-hash:${symbol}:buy`,
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
const previewFallback = source({
  type: "position_lifecycle_revalidated_guard",
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
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
  stage6Hash: "latest-hash",
  stage6File: "different-stage6.json"
});
const staleDispatchMismatch = source({
  type: "stage6_20trade_loop",
  generatedAt: stale,
  fresh: false,
  stage6Hash: "latest-hash",
  stage6File: "different-stage6.json"
});
const invalid = source({
  type: "stage6_20trade_loop",
  generatedAt: recent,
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
const producerInvalid = source({
  type: "stage6_20trade_loop",
  generatedAt: recent,
  stopPrice: 105,
  targetPrice: 120,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const lifecycleInvalid = source({
  type: "position_lifecycle_revalidated_guard",
  generatedAt: recent,
  stopPrice: 105,
  targetPrice: 120,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const basisInvalid = source({
  type: "stage6_20trade_loop",
  generatedAt: recent,
  stopPrice: 90,
  targetPrice: 95,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const evidenceMissingInvalid = source({
  type: "stage6_20trade_loop",
  generatedAt: recent,
  stopPrice: 90,
  targetPrice: 95,
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json"
});
const fileMismatchEvidence = source({
  type: "stage6_20trade_loop",
  generatedAt: recent,
  stopPrice: 90,
  targetPrice: 95,
  stage6Hash: "latest-hash",
  stage6File: "selected-stage6.json"
});

const geometrySymbols = ["BAD", "TTL_BAD", "SRC_BAD", "LIFE_BAD", "BASIS_BAD", "EVIDENCE_BAD"];
writeJson("performance-dashboard.json", {
  generatedAt: now,
  live: {
    available: true,
    positions: geometrySymbols.map((symbol) => ({
      symbol,
      currentPrice: 100,
      currentPriceObservedAt: now,
      currentPriceBasis: "broker_position_current_price",
      marketTimezone: "America/New_York",
      adjustmentType: symbol === "BASIS_BAD" ? "unadjusted" : "split_adjusted"
    }))
  }
});
writeJson("last-dry-exec-preview.json", { stage6Hash: "latest-hash", stage6File: "latest-stage6.json" });
writeJson("position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 16 },
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
    protectionRow("FALLBACK", {
      effectiveGuardSource: "position_lifecycle_revalidated_guard",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh",
      effectiveGuardGeneratedAt: stale,
      plannedStage6Hash: null,
      plannedStage6File: null
    }),
    protectionRow("NONE"),
    protectionRow("DISP"),
    protectionRow("STALE_DISP"),
    protectionRow("MIXED"),
    protectionRow("MISS", {
      ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION",
      protectionLane: "OWNERSHIP_PROOF_REQUIRED",
      blockerDomain: "ownership",
      blockedReason: "position_not_sidecar_managed",
      nextAction: "establish_sidecar_ownership_proof_before_guard_recovery"
    }),
    protectionRow("BAD"),
    protectionRow("TTL_BAD"),
    protectionRow("SRC_BAD"),
    protectionRow("LIFE_BAD"),
    protectionRow("BASIS_BAD"),
    protectionRow("EVIDENCE_BAD"),
    protectionRow("FILE_MISMATCH", { plannedStage6File: "selected-stage6.json" }),
    protectionRow("PROD")
  ]
});
const refreshPlan = {
  generatedAt: now,
  config: {
    refreshSourceMaxAgeMin: 30,
    sourcePriority: ["broker_children", "position_lifecycle_revalidated_guard", "stage6_20trade_loop", "recommendation_ledger", "order_ledger"]
  },
  rows: [
    refreshRow("CURR", current),
    refreshRow("READY", ready),
    refreshRow("MAT", materialization),
    refreshRow("LIFE", lifecycleMismatch),
    refreshRow("FALLBACK", previewFallback),
    refreshRow("NONE", unavailable, {
      sourceCandidates: [unavailable, { ...unavailable, generatedAt: null, fresh: false }]
    }),
    refreshRow("DISP", dispatchMismatch),
    refreshRow("STALE_DISP", staleDispatchMismatch, {
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_STALE",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_stale"]
    }),
    refreshRow("MIXED", dispatchMismatch, {
      sourceCandidates: [dispatchMismatch, unavailable]
    }),
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
    refreshRow("SRC_BAD", producerInvalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    }),
    refreshRow("LIFE_BAD", lifecycleInvalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    }),
    refreshRow("BASIS_BAD", basisInvalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    }),
    refreshRow("EVIDENCE_BAD", evidenceMissingInvalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    }),
    refreshRow("FILE_MISMATCH", fileMismatchEvidence, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
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
    { symbol: "FALLBACK", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "NONE", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "DISP", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "STALE_DISP", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "MIXED", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "MISS", lineageStatus: "LINEAGE_MISSING_NO_SOURCE", rootCause: "NO_SOURCE_WITH_STOP_TARGET" },
    { symbol: "BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "TTL_BAD", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "SRC_BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "LIFE_BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "BASIS_BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "EVIDENCE_BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
    { symbol: "FILE_MISMATCH", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" },
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
    },
    {
      symbol: "FALLBACK",
      lifecycleReady: true,
      lifecycleDecision: "POSITION_LIFECYCLE_GUARD_SOURCE_READY_REPORT_ONLY",
      lifecycleSource: {
        type: "position_lifecycle_revalidated_guard",
        generatedAt: now,
        originalSourceType: "order_ledger",
        originalGeneratedAt: stale,
        originalAgeMin: 999999,
        stage6Hash: previewFallback.stage6Hash,
        stage6File: previewFallback.stage6File
      }
    },
    {
      symbol: "LIFE_BAD",
      lifecycleReady: true,
      lifecycleDecision: "POSITION_LIFECYCLE_GUARD_SOURCE_READY_REPORT_ONLY",
      originalSource: {
        type: "stage6_20trade_loop",
        generatedAt: recent,
        stopPrice: 90,
        targetPrice: 120,
        stage6Hash: "latest-hash",
        stage6File: "latest-stage6.json"
      },
      lifecycleSource: {
        type: "position_lifecycle_revalidated_guard",
        generatedAt: recent,
        stopPrice: 105,
        targetPrice: 120,
        originalSourceType: "stage6_20trade_loop",
        originalGeneratedAt: recent,
        stage6Hash: "latest-hash",
        stage6File: "latest-stage6.json"
      }
    }
  ]
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: ["CURR", "READY", "MAT", "LIFE", "FALLBACK", "NONE", "DISP", "STALE_DISP", "MIXED", "MISS", "BAD", "TTL_BAD", "SRC_BAD", "LIFE_BAD", "BASIS_BAD", "EVIDENCE_BAD", "FILE_MISMATCH", "PROD"].map((symbol) => ({
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
      stopLossPrice: 89,
      takeProfitPrice: 120,
      updatedAt: stale
    },
    "latest-hash:MAT:replacement": {
      idempotencyKey: "latest-hash:MAT:replacement",
      symbol: "MAT",
      status: "filled",
      stage6Hash: "latest-hash",
      stage6File: "latest-stage6.json",
      stopLossPrice: 88,
      takeProfitPrice: 121,
      updatedAt: now
    },
    "latest-hash:TTL_BAD:buy": {
      idempotencyKey: "latest-hash:TTL_BAD:buy",
      symbol: "TTL_BAD",
      status: "filled",
      stage6Hash: "latest-hash",
      stage6File: "latest-stage6.json",
      limitPrice: 120,
      stopLossPrice: 105,
      takeProfitPrice: 130,
      createdAt: stale,
      updatedAt: stale,
      priceBasis: "order_limit_price",
      marketTimezone: "America/New_York",
      adjustmentType: "split_adjusted"
    }
  }
});
const filledIdempotency = {
  symbol: "MAT",
  brokerStatus: "filled",
  stage6Hash: "latest-hash",
  stage6File: "latest-stage6.json",
  clientOrderId: "fixture_mat",
  brokerOrderId: "fixture_broker_mat"
};
writeJson("order-idempotency.json", {
  orders: { "latest-hash:MAT:buy": filledIdempotency },
  releases: {},
  updatedAt: now
});
writeJson("recommendation-ledger.json", { rows: [] });
writeJson("stage6-20trade-loop.json", {
  rows: {
    "latest-hash:BAD:buy": {
      symbol: "BAD", stage6Hash: "latest-hash", stage6File: "latest-stage6.json", runDate: recent,
      entryPlanned: 92, stopPlanned: 90, targetPlanned: 95,
      priceBasis: "stage6_entry_planned", marketTimezone: "America/New_York", adjustmentType: "split_adjusted"
    },
    "latest-hash:SRC_BAD:buy": {
      symbol: "SRC_BAD", stage6Hash: "latest-hash", stage6File: "latest-stage6.json", runDate: recent,
      entryPlanned: 100, stopPlanned: 105, targetPlanned: 120,
      priceBasis: "stage6_entry_planned", marketTimezone: "America/New_York", adjustmentType: "split_adjusted"
    },
    "latest-hash:LIFE_BAD:buy": {
      symbol: "LIFE_BAD", stage6Hash: "latest-hash", stage6File: "latest-stage6.json", runDate: recent,
      entryPlanned: 100, stopPlanned: 90, targetPlanned: 120,
      priceBasis: "stage6_entry_planned", marketTimezone: "America/New_York", adjustmentType: "split_adjusted"
    },
    "latest-hash:BASIS_BAD:buy": {
      symbol: "BASIS_BAD", stage6Hash: "latest-hash", stage6File: "latest-stage6.json", runDate: recent,
      entryPlanned: 92, stopPlanned: 90, targetPlanned: 95,
      priceBasis: "stage6_entry_planned", marketTimezone: "America/New_York", adjustmentType: "split_adjusted"
    },
    "latest-hash:FILE_MISMATCH:buy": {
      symbol: "FILE_MISMATCH", stage6Hash: "latest-hash", stage6File: "wrong-stage6.json", runDate: recent,
      entryPlanned: 100, stopPlanned: 90, targetPlanned: 120,
      priceBasis: "stage6_entry_planned", marketTimezone: "America/New_York", adjustmentType: "split_adjusted"
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
assert.equal(bySymbol.get("FALLBACK")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
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
assert.equal(materializationPackage?.selectionContract?.symbol, "MAT");
assert.equal(materializationPackage?.selectionContract?.recordKey, "latest-hash:MAT:buy");
assert.equal(materializationPackage?.selectionContract?.expectedRecordKey, "latest-hash:MAT:buy");
assert.equal(materializationPackage?.selectionContract?.expectedStage6Hash, "latest-hash");
assert.equal(materializationPackage?.selectionContract?.selectedSourceType, "position_lifecycle_revalidated_guard");
assert.equal(materializationPackage?.selectionContract?.reviewReady, true);
assert.equal(materializationPackage?.selectionContract?.recoveryDisposition, "FRESH_SOURCE_MATERIALIZATION_REQUIRED");
assert.equal(materializationPackage?.selectionContract?.repairEligibleNow, false);
assert.equal(materializationPackage?.selectionContract?.dynamicSelection, true);
assert.equal(materializationPackage?.currentStateSnapshot?.stateFile, "order-ledger.json");
assert.equal(materializationPackage?.currentStateSnapshot?.recordKey, "latest-hash:MAT:buy");
assert.match(materializationPackage?.currentStateSnapshot?.recordSha256 || "", /^[a-f0-9]{64}$/);
assert.match(materializationPackage?.currentStateSnapshot?.fileSha256 || "", /^[a-f0-9]{64}$/);
assert.equal(materializationPackage?.selectedFreshSourceLineage?.sourceType, "position_lifecycle_revalidated_guard");
assert.equal(materializationPackage?.selectedFreshSourceLineage?.stage6Hash, "latest-hash");
assert.equal(materializationPackage?.selectedFreshSourceLineage?.dispatchBasis, "position_lineage");
assert.equal(materializationPackage?.selectedFreshSourceLineage?.positionLineageMatchesCurrentPosition, true);
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
assert.equal(materializationPackage?.evidence?.upstreamIdempotencyPass, true);
assert.equal(materializationPackage?.evidence?.selectedLedgerRecord?.identityMatches, true);
assert.equal(materializationPackage?.evidence?.selectedLedgerRecord?.filled, true);
assert.equal(materializationPackage?.evidence?.selectedIdempotencyRecord?.recordFound, true);
assert.equal(materializationPackage?.evidence?.selectedIdempotencyRecord?.identityMatches, true);
assert.equal(materializationPackage?.evidence?.selectedIdempotencyRecord?.filled, true);
assert.equal(materializationPackage?.evidence?.ownershipPass, true);
assert.equal(materializationPackage?.evidence?.ownershipClassification, "SIDECAR_MANAGED_FILLED");
assert.equal(materializationPackage?.evidence?.fillStatePass, true);
assert.equal(materializationPackage?.evidence?.fillStateStatus, "FILL_STATE_CONFIRMED");
assert.equal(materializationPackage?.requiredApprovalPhrase, "CONFIRM STATE GUARD MATERIALIZATION");
assert.equal(materializationPackage?.stateMutationAllowed, false);
assert.equal(materializationPackage?.stateMutationAttempted, false);
assert.equal(materializationPackage?.stateMutationSubmitted, false);
assert.equal(materializationPackage?.brokerMutationAttempted, false);
assert.equal(materializationPackage?.brokerMutationSubmitted, false);
assert.equal(materializationPackage?.packageBlocker, null);
for (const requiredReport of [
  "fill-state-reconciliation-audit",
  "position-lifecycle-guard-source-plan",
  "guard-metadata-refresh-plan",
  "guard-metadata-lineage-audit",
  "broker-child-order-reconciliation",
  "position-protection-root-cause-audit",
  "guard-source-recovery-plan"
]) {
  assert.equal(materializationPackage?.rollbackPlan?.rerunReports?.includes(requiredReport), true);
}
assert.equal(bySymbol.get("NONE")?.recoveryRootCause, "source_ttl_expired");
assert.equal(bySymbol.get("NONE")?.sourceCandidateLineage?.matchingTimestampMissingCount, 1);
assert.equal(bySymbol.get("NONE")?.recoveryDisposition, "NO_CURRENT_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("NONE")?.nextAction, "wait_for_fresh_stage6_or_lifecycle_guard_source");
assert.equal(bySymbol.get("DISP")?.recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(bySymbol.get("STALE_DISP")?.recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(bySymbol.get("STALE_DISP")?.sourceLineage?.freshnessStatus, "SOURCE_TTL_EXPIRED");
assert.equal(bySymbol.get("MIXED")?.recoveryRootCause, "source_ttl_expired");
assert.equal(bySymbol.get("MIXED")?.sourceCandidateLineage?.matchingCandidateCount, 1);
assert.equal(bySymbol.get("MIXED")?.sourceCandidateLineage?.freshMatchingCandidateCount, 0);
assert.equal(bySymbol.get("DISP")?.recoveryDisposition, "EXPECTED_STALE_SOURCE_BLOCK");
assert.equal(bySymbol.get("DISP")?.sourceLineage?.dispatchStatus, "MISMATCH");
assert.equal(bySymbol.get("LIFE")?.recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(bySymbol.get("LIFE")?.recoveryDisposition, "LIFECYCLE_LINEAGE_PROPAGATION_DEFECT");
assert.equal(bySymbol.get("LIFE")?.sourceLineage?.dispatchStatus, "MISMATCH");
assert.equal(bySymbol.get("LIFE")?.sourcePreservation?.lineageKeyMatchesCurrentPosition, false);
assert.equal(bySymbol.get("LIFE")?.repairEligibilityContract?.sourceLineageMatchesCurrentPosition, false);
assert.equal(bySymbol.get("LIFE")?.repairEligibleNow, false);
assert.equal(bySymbol.get("FALLBACK")?.recoveryRootCause, "lifecycle_lineage_missing");
assert.equal(bySymbol.get("FALLBACK")?.recoveryDisposition, "CURRENT_POSITION_LINEAGE_MISSING");
assert.equal(bySymbol.get("FALLBACK")?.sourceLineage?.dispatchBasis, "latest_preview_fallback");
assert.equal(bySymbol.get("FALLBACK")?.sourceLineage?.dispatchStatus, "EXPECTED_LINEAGE_MISSING");
assert.equal(bySymbol.get("FALLBACK")?.sourceLineage?.positionLineageMatchesCurrentPosition, false);
assert.equal(bySymbol.get("FALLBACK")?.stateMaterializationPackage, null);
assert.equal(bySymbol.get("FALLBACK")?.repairEligibleNow, false);
assert.equal(bySymbol.get("MISS")?.recoveryRootCause, "source_producer_missing");
assert.equal(bySymbol.get("MISS")?.recoveryOwner, "position_ownership_proof");
assert.equal(bySymbol.get("MISS")?.blockerDomain, "ownership");
assert.equal(bySymbol.get("BAD")?.recoveryRootCause, "source_geometry_unusable");
assert.equal(bySymbol.get("BAD")?.recoveryDisposition, "SOURCE_GEOMETRY_UNUSABLE");
assert.deepEqual(bySymbol.get("BAD")?.recoveryGeometry?.invalidComponents, ["target"]);
assert.deepEqual(bySymbol.get("BAD")?.recoveryGeometry?.rootCauses, ["target_not_above_current"]);
assert.equal(bySymbol.get("TTL_BAD")?.recoveryRootCause, "source_ttl_expired");
assert.equal(bySymbol.get("TTL_BAD")?.recoveryDisposition, "SOURCE_GEOMETRY_UNUSABLE");
assert.deepEqual(bySymbol.get("TTL_BAD")?.recoveryGeometry?.invalidComponents, ["stop"]);
assert.deepEqual(bySymbol.get("TTL_BAD")?.recoveryGeometry?.rootCauses, ["stop_not_below_current"]);
const expectedGeometryClassifications = {
  BAD: "CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE",
  TTL_BAD: "CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE",
  SRC_BAD: "STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE",
  LIFE_BAD: "POSITION_LIFECYCLE_TRANSFORM_DRIFT",
  BASIS_BAD: "SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH",
  EVIDENCE_BAD: "SOURCE_GEOMETRY_EVIDENCE_MISSING"
};
for (const [symbol, classification] of Object.entries(expectedGeometryClassifications)) {
  const row = bySymbol.get(symbol);
  assert.equal(row?.recoveryDisposition, "SOURCE_GEOMETRY_UNUSABLE");
  assert.equal(row?.geometryDriftAudit?.geometryDriftClassification, classification);
  assert.ok(row?.geometryDriftAudit?.geometryDriftOwner);
  assert.ok(row?.geometryDriftAudit?.blockedReason);
  assert.ok(row?.geometryDriftAudit?.nextAction);
  assert.equal(row?.repairEligibleNow, false);
}
assert.equal(bySymbol.get("BAD")?.geometryDriftAudit?.sourceGeometry?.valid, true);
assert.equal(bySymbol.get("BAD")?.geometryDriftAudit?.evaluationGeometry?.targetAboveCurrent, false);
assert.equal(bySymbol.get("TTL_BAD")?.geometryDriftAudit?.sourceGeometry?.valid, true);
assert.equal(bySymbol.get("TTL_BAD")?.geometryDriftAudit?.evaluationGeometry?.stopBelowCurrent, false);
assert.equal(bySymbol.get("SRC_BAD")?.geometryDriftAudit?.sourceGeometry?.valid, false);
assert.equal(bySymbol.get("SRC_BAD")?.geometryDriftAudit?.producerHandoff?.targetRepository, "US_Alpha_Seeker");
assert.equal(bySymbol.get("SRC_BAD")?.geometryDriftAudit?.producerHandoff?.mode, "report_only");
assert.equal(bySymbol.get("BAD")?.geometryDriftAudit?.producerHandoff, null);
assert.equal(bySymbol.get("LIFE_BAD")?.geometryDriftAudit?.sourceGeometry?.valid, true);
assert.equal(bySymbol.get("LIFE_BAD")?.geometryDriftAudit?.lifecycleTransform?.outputGeometry?.valid, false);
assert.equal(bySymbol.get("BASIS_BAD")?.geometryDriftAudit?.evidenceCompleteness, "INCOMPARABLE");
assert.equal(bySymbol.get("EVIDENCE_BAD")?.geometryDriftAudit?.evidenceCompleteness, "MISSING_CORE_EVIDENCE");
assert.equal(bySymbol.get("EVIDENCE_BAD")?.geometryDriftAudit?.sourceSnapshot?.stopPrice, 90);
assert.equal(bySymbol.get("EVIDENCE_BAD")?.geometryDriftAudit?.sourceSnapshot?.targetPrice, 95);
assert.equal(bySymbol.get("FILE_MISMATCH")?.geometryDriftAudit?.sourceSnapshot?.evidenceRecordFound, false);
assert.equal(bySymbol.get("FILE_MISMATCH")?.geometryDriftAudit?.sourceSnapshot?.stage6File, "selected-stage6.json");
assert.equal(
  bySymbol.get("EVIDENCE_BAD")?.geometryDriftAudit?.sourceSnapshot?.expiresAt,
  new Date(Date.parse(recent) + (30 * 60_000)).toISOString()
);
for (const symbol of [...Object.keys(expectedGeometryClassifications), "DISP", "MIXED", "MISS"]) {
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
assert.equal(report.summary.geometryRootCauseRows, 7);
assert.equal(report.summary.geometryRootCauseUnclassified, 0);
assert.deepEqual(report.summary.geometryInvalidComponentCounts, {
  stop: 3,
  current: 0,
  target: 4,
  producer: 0
});
assert.deepEqual(report.summary.geometryDriftClassificationCounts, {
  CURRENT_PRICE_DRIFT_AFTER_VALID_SOURCE: 2,
  STAGE6_PRODUCER_GEOMETRY_INVALID_AT_SOURCE: 1,
  POSITION_LIFECYCLE_TRANSFORM_DRIFT: 1,
  SOURCE_PRICE_BASIS_OR_TIMESTAMP_MISMATCH: 1,
  SOURCE_GEOMETRY_EVIDENCE_MISSING: 2
});
assert.equal(report.summary.geometryDriftUnclassified, 0);
assert.equal(report.classificationConsistency.geometryDriftClassified, true);
assert.equal(report.classificationConsistency.recoveryStatusCountMatchesRows, true);
assert.equal(report.classificationConsistency.freshSourceStatusCountMatchesLane, true);
assert.equal(report.summary.stateMutationAttempted, false);
assert.equal(report.summary.stateMutationSubmitted, false);
assert.equal(report.summary.brokerMutationAttempted, false);
assert.equal(report.summary.brokerMutationSubmitted, false);

writeJson("order-idempotency.json", {
  orders: {
    "latest-hash:MAT:buy": { ...filledIdempotency, brokerStatus: "submitted" }
  },
  releases: {},
  updatedAt: now
});
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const idempotencyBlocked = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const idempotencyBlockedPackage = idempotencyBlocked.rows.find((row) => row.symbol === "MAT")?.stateMaterializationPackage;
assert.equal(idempotencyBlockedPackage?.proposalStatus, "BLOCKED_EVIDENCE_INCOMPLETE");
assert.equal(idempotencyBlockedPackage?.packageBlocker, "package_idempotency_blocked");
assert.equal(idempotencyBlockedPackage?.evidence?.idempotencyPass, false);
assert.equal(idempotencyBlockedPackage?.evidenceMissing?.includes("selected_idempotency_record_not_filled"), true);
writeJson("order-idempotency.json", {
  orders: { "latest-hash:MAT:buy": filledIdempotency },
  releases: {},
  updatedAt: now
});
const noValueDiffLedger = JSON.parse(fs.readFileSync(path.join(stateDir, "order-ledger.json"), "utf8"));
noValueDiffLedger.orders["latest-hash:MAT:buy"].stopLossPrice = 90;
writeJson("order-ledger.json", noValueDiffLedger);
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const noValueDiffReport = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const noValueDiffPackage = noValueDiffReport.rows.find((row) => row.symbol === "MAT")?.stateMaterializationPackage;
assert.equal(noValueDiffPackage?.proposalStatus, "BLOCKED_NO_MATERIALIZATION_DIFF");
assert.equal(noValueDiffPackage?.packageBlocker, "package_evidence_incomplete");
assert.equal(noValueDiffPackage?.guardValueDiff?.length, 0);
assert.equal(noValueDiffPackage?.evidenceMissing?.includes("no_guard_metadata_value_diff"), true);
assert.equal(noValueDiffReport.summary.materializationPackagesBlocked, 1);
assert.equal(noValueDiffReport.summary.materializationPackageEvidenceMissing, 1);
assert.equal(noValueDiffReport.summary.materializationReadyPackageEvidenceMissing, 0);
assert.equal(noValueDiffReport.classificationConsistency.materializationPackagesComplete, true);
assert.notEqual(noValueDiffReport.overall, "classification_inconsistent");

const missingRecordKeyProtection = JSON.parse(fs.readFileSync(path.join(stateDir, "position-protection-root-cause-audit.json"), "utf8"));
missingRecordKeyProtection.rows = missingRecordKeyProtection.rows.map((row) => row.symbol === "MAT"
  ? { ...row, plannedLedgerKey: null }
  : row);
writeJson("position-protection-root-cause-audit.json", missingRecordKeyProtection);
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const missingRecordKeyReport = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const missingRecordKeyPackage = missingRecordKeyReport.rows.find((row) => row.symbol === "MAT")?.stateMaterializationPackage;
assert.equal(missingRecordKeyPackage?.proposalStatus, "BLOCKED_CURRENT_STATE_RECORD_MISSING");
assert.equal(missingRecordKeyPackage?.currentStateSnapshot, null);

refreshPlan.rows = refreshPlan.rows.map((row) => row.symbol === "NONE"
  ? refreshRow("NONE", { ...unavailable, generatedAt: null }, {
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_TIMESTAMP_MISSING",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_timestamp_missing"]
    })
  : row);
writeJson("guard-metadata-refresh-plan.json", refreshPlan);
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const missingTimestampReport = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const missingTimestampRow = missingTimestampReport.rows.find((row) => row.symbol === "NONE");
assert.equal(missingTimestampRow?.recoveryRootCause, "source_producer_missing");
assert.equal(missingTimestampRow?.sourceCandidateLineage?.matchingTimestampMissingCount, 1);
assert.equal(missingTimestampRow?.recoveryDecision, "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE");
assert.equal(missingTimestampRow?.nextAction, "rebuild_missing_guard_source_producer_report_only");

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

replayMat.sourcePreservation.source = {
  ...replayMat.sourcePreservation.source,
  positionLineageKey: replayMat.positionLineageKey,
  stage6Hash: "latest-hash",
  stage6File: "different-stage6.json"
};
writeJson("guard-source-recovery-plan.json", replay);
execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const preservationMismatch = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const preservationMismatchMat = preservationMismatch.rows.find((row) => row.symbol === "MAT");
assert.equal(preservationMismatchMat?.recoveryRootCause, "preservation_contract_mismatch");
assert.equal(preservationMismatchMat?.sourcePreservation?.priorEvidencePresent, true);
assert.equal(preservationMismatchMat?.sourcePreservation?.priorRejectionReason, "prior_stage6_identity_mismatch");
assert.equal(preservationMismatchMat?.repairEligibleNow, false);

execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
const preservationMismatchReplay = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
assert.equal(
  preservationMismatchReplay.rows.find((row) => row.symbol === "MAT")?.recoveryRootCause,
  "preservation_contract_mismatch"
);

console.log("[GUARD_SOURCE_RECOVERY_STATUS_TEST] pass");
