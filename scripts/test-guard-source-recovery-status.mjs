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

const source = ({ type = "position_lifecycle_revalidated_guard", generatedAt = now, fresh = true, stopPrice = 90, targetPrice = 120 } = {}) => ({
  type,
  generatedAt,
  ageMin: fresh ? 1 : 999999,
  fresh,
  hasBothPrices: true,
  stopPrice,
  targetPrice,
  stage6Hash: `hash-${type}`,
  stage6File: `stage6-${type}.json`
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
  geometry: { valid: true },
  idempotencyStatus: "filled",
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
const ready = source({ type: "position_lifecycle_revalidated_guard" });
const materialization = source({ type: "position_lifecycle_revalidated_guard" });
const unavailable = source({ type: "order_ledger", generatedAt: stale, fresh: false });
const invalid = source({ type: "stage6_20trade_loop", stopPrice: 105, targetPrice: 130 });

writeJson("performance-dashboard.json", { generatedAt: now, live: { available: true } });
writeJson("last-dry-exec-preview.json", { stage6Hash: "latest-hash", stage6File: "latest-stage6.json" });
writeJson("position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 4 },
  rows: [
    protectionRow("CURR", { guardSourceFresh: true, guardSourceFreshness: "fresh" }),
    protectionRow("READY", {
      protectionLane: "MANUAL_APPROVAL_CANDIDATE",
      blockerDomain: "none",
      guardSourceFresh: true,
      guardSourceFreshness: "fresh",
      repairEligible: true,
      blockedReason: null,
      nextAction: "manual_approval_review_only"
    }),
    protectionRow("MAT"),
    protectionRow("NONE"),
    protectionRow("BAD")
  ]
});
writeJson("guard-metadata-refresh-plan.json", {
  rows: [
    refreshRow("CURR", current),
    refreshRow("READY", ready),
    refreshRow("MAT", materialization),
    refreshRow("NONE", unavailable),
    refreshRow("BAD", invalid, {
      selectedSourceGeometryValid: false,
      refreshReady: false,
      refreshDecision: "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY",
      afterRefreshRepairDecision: "NOT_EVALUATED_REFRESH_BLOCKED",
      blockers: ["selected_source_invalid_geometry"]
    })
  ]
});
writeJson("guard-metadata-lineage-audit.json", {
  rows: [
    { symbol: "CURR", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "READY", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "MAT", lineageStatus: "LINEAGE_READY", rootCause: "FRESH_VALID_SOURCE_AVAILABLE" },
    { symbol: "NONE", lineageStatus: "LINEAGE_STALE_SOURCE_ONLY", rootCause: "SOURCE_AGE_EXCEEDED" },
    { symbol: "BAD", lineageStatus: "LINEAGE_INVALID_GEOMETRY", rootCause: "FRESH_SOURCE_INVALID_GEOMETRY" }
  ]
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: ["CURR", "READY", "MAT", "NONE", "BAD"].map((symbol) => ({
    symbol,
    reconciliationDecision: "FILL_STATE_CONFIRMED",
    requiresLedgerTerminalizationReview: false
  }))
});
writeJson("broker-child-order-reconciliation.json", { rows: [] });

execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const bySymbol = new Map(report.rows.map((row) => [row.symbol, row]));

assert.equal(bySymbol.get("CURR")?.recoveryStatus, "CURRENT_SOURCE_FRESH");
assert.equal(bySymbol.get("READY")?.recoveryStatus, "RECOVERY_SOURCE_READY_REPORT_ONLY");
assert.equal(bySymbol.get("MAT")?.recoveryStatus, "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED");
assert.equal(bySymbol.get("NONE")?.recoveryStatus, "NO_FRESH_SOURCE_AVAILABLE");
assert.equal(bySymbol.get("BAD")?.recoveryStatus, "RECOVERY_SOURCE_INVALID_GEOMETRY");
assert.equal(bySymbol.get("MAT")?.recoveryReady, true);
assert.equal(bySymbol.get("MAT")?.repairEligibleNow, false);
assert.equal(bySymbol.get("MAT")?.stateMaterializationRequired, true);
assert.equal(bySymbol.get("NONE")?.recoveryRootCause, "source_timestamp_stale");
assert.equal(bySymbol.get("NONE")?.nextAction, "wait_for_fresh_stage6_or_lifecycle_guard_source");
assert.equal(bySymbol.get("BAD")?.recoveryRootCause, "source_geometry_unusable");
assert.equal(report.summary.recoveryStatusUnknown, 0);
assert.equal(report.summary.sourcePrecedenceViolations, 0);
assert.equal(report.classificationConsistency.recoveryStatusCountMatchesRows, true);
assert.equal(report.classificationConsistency.freshSourceStatusCountMatchesLane, true);
assert.equal(report.summary.stateMutationAttempted, false);
assert.equal(report.summary.stateMutationSubmitted, false);
assert.equal(report.summary.brokerMutationAttempted, false);
assert.equal(report.summary.brokerMutationSubmitted, false);

console.log("[GUARD_SOURCE_RECOVERY_STATUS_TEST] pass");
