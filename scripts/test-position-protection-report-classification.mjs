#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "position-protection-report-"));
const now = new Date().toISOString();
const stale = "2020-01-01T00:00:00.000Z";
const writeJson = (name, payload) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(payload, null, 2)}\n`);
const managed = (symbol, overrides = {}) => ({
  symbol,
  qty: 1,
  currentPrice: 100,
  plannedStopPrice: 90,
  plannedTargetPrice: 120,
  plannedLedgerUpdatedAt: now,
  plannedStage6Hash: `hash-${symbol}`,
  normalizedFillState: "filled",
  ...overrides
});

writeJson("performance-dashboard.json", {
  generatedAt: now,
  live: {
    available: true,
    positions: [
      managed("AAA", { brokerStopPresent: true, brokerTargetPresent: true, brokerStopPrice: 90, brokerTargetPrice: 120 }),
      managed("BBB", { plannedLedgerUpdatedAt: stale }),
      managed("CCC", { plannedStopPrice: 105 }),
      { symbol: "DDD", qty: 1, currentPrice: 100 },
      managed("EEE", { normalizedFillState: "submitted", ledgerStatus: "submitted" }),
      managed("FFF")
    ]
  }
});
writeJson("broker-child-order-reconciliation.json", {
  generatedAt: now,
  rows: [{ symbol: "AAA", brokerStopPresent: true, brokerTargetPresent: true, brokerStopPrice: 90, brokerTargetPrice: 120 }]
});
writeJson("order-state-consistency-report.json", { rows: [] });
writeJson("order-ledger.json", { orders: {} });
writeJson("order-idempotency.json", { orders: {} });
writeJson("fillability-report.json", { rows: [] });
writeJson("last-dry-exec-preview.json", { stage6Hash: "fixture-hash", stage6File: "fixture.json" });
writeJson("position-lifecycle-guard-source-plan.json", { rows: [] });

execFileSync(process.execPath, ["scripts/build-position-protection-root-cause-audit.mjs"], {
  env: { ...process.env, POSITION_PROTECTION_AUDIT_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "position-protection-root-cause-audit.json"), "utf8"));
assert.equal(report.summary.classifiedRows, 6);
assert.equal(report.summary.unclassifiedRows, 0);
assert.deepEqual(report.summary.protectionLaneCounts, {
  BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED: 1,
  FRESH_GUARD_SOURCE_REQUIRED: 1,
  INVALID_GUARD_GEOMETRY_NO_REPAIR: 1,
  OWNERSHIP_PROOF_REQUIRED: 2,
  MANUAL_APPROVAL_CANDIDATE: 1
});
assert.equal(report.summary.protectionBlockerRows, 3);
assert.equal(report.summary.ownershipBlockerRows, 1);
assert.equal(report.summary.ledgerBlockerRows, 1);
assert.equal(report.summary.manualApprovalCandidates, 1);
assert.equal(report.executionPolicy.brokerMutationAttempted, false);
assert.equal(report.executionPolicy.brokerMutationSubmitted, false);
assert.equal(report.executionPolicy.stateMutationAttempted, false);
assert.equal(report.executionPolicy.stateMutationSubmitted, false);

for (const row of report.rows) {
  assert.ok(row.protectionLane);
  assert.ok(row.ownershipClassification);
  assert.equal(typeof row.brokerStopPresent, "boolean");
  assert.equal(typeof row.brokerTargetPresent, "boolean");
  assert.ok(row.guardSourceFreshness);
  assert.ok(row.sourcePrecedence);
  assert.ok(row.sourcePrecedenceClass);
  assert.ok([1, 2, 3, 4].includes(row.sourcePrecedenceRank));
  assert.equal(typeof row.geometry.valid, "boolean");
  assert.ok(row.idempotencyStatus);
  assert.equal(typeof row.repairEligible, "boolean");
  assert.ok(row.nextAction);
}

writeJson("broker-child-order-reconciliation.json", {
  generatedAt: now,
  overall: "fixture",
  summary: { criticalCount: 6, missingStopChildren: 5, proposedActionRows: 5 },
  rows: report.rows
});
writeJson("guard-metadata-refresh-plan.json", {
  rows: report.rows.map((row) => ({
    symbol: row.symbol,
    qty: row.qty,
    currentPrice: row.currentPrice,
    ownershipClassification: row.ownershipClassification,
    fillStateReconciliation: row.fillStateReconciliation,
    selectedSource: row.guardSourceFreshness === "missing" ? null : {
      type: row.effectiveGuardSource,
      generatedAt: row.plannedLedgerUpdatedAt,
      fresh: row.guardSourceFresh,
      stopPrice: row.plannedStopPrice,
      targetPrice: row.plannedTargetPrice
    },
    broker: { stopPresent: row.brokerStopPresent, targetPresent: row.brokerTargetPresent },
    refreshDecision:
      row.protectionLane === "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED" ? "FRESH_BROKER_CHILDREN_PRESENT_MONITOR_ONLY" :
      row.blockerDomain === "ledger_fill_state" ? "BLOCKED_FILL_STATE_RECONCILIATION" :
      row.blockerDomain === "ownership" ? "BLOCKED_POSITION_OWNERSHIP_REVIEW" :
      row.protectionLane === "FRESH_GUARD_SOURCE_REQUIRED" ? "BLOCKED_REFRESH_SOURCE_STALE" :
      row.protectionLane === "INVALID_GUARD_GEOMETRY_NO_REPAIR" ? "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY" :
      "FRESH_SOURCE_READY_REPORT_ONLY",
    refreshReady: row.protectionLane === "MANUAL_APPROVAL_CANDIDATE",
    afterRefreshRepairDecision: row.protectionLane === "MANUAL_APPROVAL_CANDIDATE"
      ? "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"
      : null,
    blockers: row.blockedReason ? [row.blockedReason] : []
  }))
});
writeJson("guard-metadata-lineage-audit.json", {
  rows: report.rows.map((row) => ({
    symbol: row.symbol,
    freshnessStatus: row.guardSourceFreshness === "stale" ? "STALE_SOURCE_ONLY" :
      row.guardSourceFreshness === "missing" ? "MISSING_NO_SOURCE" : "FRESH_VALID_SOURCE_AVAILABLE",
    rootCause: row.blockedReason
  }))
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: report.rows.map((row) => ({
    symbol: row.symbol,
    reconciliationDecision: row.blockerDomain === "ledger_fill_state" ? "REVIEW_REQUIRED" : "FILL_STATE_CONFIRMED",
    requiresLedgerTerminalizationReview: row.blockerDomain === "ledger_fill_state"
  }))
});

execFileSync(process.execPath, ["scripts/build-guard-source-recovery-plan.mjs"], {
  env: { ...process.env, GUARD_SOURCE_RECOVERY_STATE_DIR: stateDir },
  stdio: "pipe"
});
execFileSync(process.execPath, ["scripts/build-persistent-oco-repair-plan.mjs"], {
  env: { ...process.env, PERSISTENT_OCO_REPAIR_STATE_DIR: stateDir },
  stdio: "pipe"
});
execFileSync(process.execPath, ["scripts/build-ops-health-report.mjs"], {
  env: { ...process.env, OPS_HEALTH_STATE_DIR: stateDir, OPS_HEALTH_KIND: "dry_run" },
  stdio: "pipe"
});
execFileSync(process.execPath, ["scripts/build-live-readiness-scorecard.mjs"], {
  env: { ...process.env, LIVE_READINESS_STATE_DIR: stateDir },
  stdio: "pipe"
});

const recovery = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-source-recovery-plan.json"), "utf8"));
const persistent = JSON.parse(fs.readFileSync(path.join(stateDir, "persistent-oco-repair-plan.json"), "utf8"));
const opsHealth = JSON.parse(fs.readFileSync(path.join(stateDir, "ops-health-report.json"), "utf8"));
const liveReadiness = JSON.parse(fs.readFileSync(path.join(stateDir, "live-readiness-scorecard.json"), "utf8"));
assert.equal(recovery.summary.recoveryStatusUnknown, 0);
assert.equal(
  Object.values(recovery.summary.recoveryStatusCounts).reduce((sum, value) => sum + value, 0),
  recovery.summary.rows
);
assert.equal(opsHealth.metrics.guardSourceRecoveryStatusUnknown, 0);
assert.deepEqual(opsHealth.metrics.guardSourceRecoveryStatusCounts, recovery.summary.recoveryStatusCounts);
assert.deepEqual(liveReadiness.protectionClassification.recoveryStatusCounts, recovery.summary.recoveryStatusCounts);
assert.equal(liveReadiness.protectionClassification.recoveryStatusUnknown, 0);
for (const downstream of [recovery, persistent]) {
  assert.equal(downstream.summary.unclassifiedRows, 0);
  assert.equal(downstream.summary.protectionBlockerRows, report.summary.protectionBlockerRows);
  assert.deepEqual(downstream.summary.protectionLaneCounts, report.summary.protectionLaneCounts);
  assert.equal(downstream.summary.brokerMutationAttempted, false);
  assert.equal(downstream.summary.brokerMutationSubmitted, false);
  assert.equal(downstream.summary.stateMutationAttempted, false);
  assert.equal(downstream.summary.stateMutationSubmitted, false);
}
assert.equal(opsHealth.metrics.positionProtectionCanonicalAvailable, true);
assert.equal(opsHealth.metrics.positionProtectionUnclassifiedRows, 0);
assert.equal(opsHealth.metrics.positionProtectionBlockerRows, report.summary.protectionBlockerRows);
assert.equal(opsHealth.metrics.positionProtectionOwnershipBlockerRows, report.summary.ownershipBlockerRows);
assert.equal(opsHealth.metrics.positionProtectionLedgerBlockerRows, report.summary.ledgerBlockerRows);
assert.equal(opsHealth.metrics.positionProtectionReportCountsMatch, true);
assert.equal(opsHealth.blockerGroups.protection_guard_metadata.status, "fail");
assert.equal(opsHealth.blockerGroups.ownership.status, "warn");
assert.equal(opsHealth.blockerGroups.ledger_fill_state.status, "warn");
assert.equal(opsHealth.checks.some((row) => row.id === "broker_child_reconciliation_critical"), false);
assert.equal(liveReadiness.protectionClassification.unclassifiedRows, 0);
assert.equal(liveReadiness.protectionClassification.protectionBlockerRows, report.summary.protectionBlockerRows);
assert.equal(liveReadiness.protectionClassification.reportConsistency.allAvailableCountsMatch, true);
assert.equal(liveReadiness.brokerMutationAttempted, false);
assert.equal(liveReadiness.brokerMutationSubmitted, false);
assert.equal(liveReadiness.stateMutationAttempted, false);
assert.equal(liveReadiness.stateMutationSubmitted, false);

console.log("[POSITION_PROTECTION_REPORT_CLASSIFICATION_TEST] pass");
