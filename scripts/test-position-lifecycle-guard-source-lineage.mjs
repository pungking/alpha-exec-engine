#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "position-lifecycle-lineage-"));
const now = new Date().toISOString();
const stale = "2020-01-01T00:00:00.000Z";
const writeJson = (name, payload) => fs.writeFileSync(
  path.join(stateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

const position = {
  symbol: "FIX",
  qty: 1,
  currentPrice: 100,
  brokerStopPresent: false,
  brokerTargetPresent: false,
  plannedStopPrice: 90,
  plannedTargetPrice: 120,
  plannedStopSource: "order_ledger",
  plannedTargetSource: "order_ledger",
  plannedLedgerUpdatedAt: stale,
  plannedStage6Hash: "current-position-hash",
  plannedStage6File: "current-position-stage6.json",
  normalizedFillState: "filled"
};

writeJson("performance-dashboard.json", {
  generatedAt: now,
  live: { available: true, positions: [position] }
});
writeJson("broker-child-order-reconciliation.json", {
  rows: [{
    symbol: "FIX",
    qty: 1,
    currentPrice: 100,
    brokerStopPresent: false,
    brokerTargetPresent: false,
    plannedStopPrice: 90,
    plannedTargetPrice: 120,
    plannedLedgerUpdatedAt: stale,
    plannedStage6Hash: "current-position-hash",
    plannedStage6File: "current-position-stage6.json"
  }]
});
writeJson("position-protection-root-cause-audit.json", {
  rows: [{
    symbol: "FIX",
    ownershipClassification: "SIDECAR_MANAGED_FILLED",
    guardMetadataStale: true,
    fillStateReconciliation: { status: "confirmed_filled" }
  }]
});
writeJson("guard-metadata-refresh-plan.json", {
  rows: [{
    symbol: "FIX",
    qty: 1,
    currentPrice: 100,
    ownershipClassification: "SIDECAR_MANAGED_FILLED",
    fillStateReconciliation: { status: "confirmed_filled" },
    broker: { stopPresent: false, targetPresent: false },
    refreshDecision: "REFRESH_READY_THEN_REEVALUATE_REPAIR",
    selectedSource: {
      type: "position_lifecycle_revalidated_guard",
      generatedAt: now,
      stopPrice: 85,
      targetPrice: 130,
      stage6Hash: "different-position-hash",
      stage6File: "different-position-stage6.json"
    }
  }]
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: [{
    symbol: "FIX",
    reconciliationDecision: "FILL_STATE_CONFIRMED",
    requiresLedgerTerminalizationReview: false
  }]
});
writeJson("last-dry-exec-preview.json", {
  stage6Hash: "latest-unrelated-hash",
  stage6File: "latest-unrelated-stage6.json"
});

execFileSync(process.execPath, ["scripts/build-position-lifecycle-guard-source-plan.mjs"], {
  env: { ...process.env, POSITION_LIFECYCLE_GUARD_SOURCE_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "position-lifecycle-guard-source-plan.json"), "utf8"));
const row = report.rows[0];
assert.equal(row.lifecycleReady, true);
assert.equal(row.originalSource.type, "order_ledger");
assert.equal(row.lifecycleSource.stage6Hash, "current-position-hash");
assert.equal(row.lifecycleSource.stage6File, "current-position-stage6.json");
assert.equal(row.lineageDecision, "CURRENT_POSITION_LINEAGE_MATCH");
assert.equal(row.warnings.includes("report_only_lifecycle_source_rejected_as_revalidation_input"), true);
assert.equal(report.summary.lineageMismatchSourcesRejected, 1);
assert.equal(report.summary.brokerMutationAttempted, false);
assert.equal(report.summary.stateMutationAttempted, false);

console.log("[POSITION_LIFECYCLE_GUARD_SOURCE_LINEAGE_TEST] pass");
