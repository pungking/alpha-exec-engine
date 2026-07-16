#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-refresh-precedence-"));
const generatedAt = new Date().toISOString();
const writeJson = (name, payload) => fs.writeFileSync(
  path.join(stateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

writeJson("performance-dashboard.json", {
  generatedAt,
  live: {
    available: true,
    positions: [{ symbol: "SYN_SRC", qty: 1, currentPrice: 100 }],
  },
});
writeJson("position-protection-root-cause-audit.json", {
  rows: [{
    symbol: "SYN_SRC",
    protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
    blockerDomain: "protection",
    ownershipClassification: "SIDECAR_MANAGED_FILLED",
  }],
});
writeJson("recommendation-ledger.json", {
  recommendations: {
    SYN_SRC: {
      symbol: "SYN_SRC",
      stop: 90,
      target: 120,
      updatedAt: generatedAt,
      stage6Hash: "recommendation-hash",
      latestStage6File: "recommendation-stage6.json",
    },
  },
});
writeJson("stage6-20trade-loop.json", {
  rows: {
    "synthetic-row": {
      symbol: "SYN_SRC",
      stopPlanned: 91,
      targetPlanned: 121,
      runDate: generatedAt,
      stage6Hash: "matching-stage6-hash",
      stage6File: "matching-stage6.json",
    },
  },
});

execFileSync(process.execPath, ["scripts/build-guard-metadata-refresh-plan.mjs"], {
  env: { ...process.env, GUARD_METADATA_REFRESH_STATE_DIR: stateDir },
  stdio: "pipe",
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "guard-metadata-refresh-plan.json"), "utf8"));
assert.deepEqual(report.config.sourcePriority, [
  "broker_children",
  "position_lifecycle_revalidated_guard",
  "stage6_20trade_loop",
  "recommendation_ledger",
  "order_ledger",
]);
assert.equal(report.rows.length, 1);
assert.equal(report.rows[0].selectedSource.type, "stage6_20trade_loop");
assert.equal(report.executionPolicy.brokerMutationAttempted, false);
assert.equal(report.executionPolicy.brokerMutationSubmitted, false);
assert.equal(report.executionPolicy.stateMutationAttempted, false);
assert.equal(report.executionPolicy.stateMutationSubmitted, false);

console.log("[GUARD_METADATA_REFRESH_SOURCE_PRECEDENCE_TEST] pass");
