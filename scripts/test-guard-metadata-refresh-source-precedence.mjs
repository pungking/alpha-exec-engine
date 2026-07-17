#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-refresh-precedence-"));
const generatedAt = new Date().toISOString();
const staleGeneratedAt = new Date(Date.parse(generatedAt) - (120 * 60_000)).toISOString();
const writeJson = (name, payload) => fs.writeFileSync(
  path.join(stateDir, name),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

writeJson("performance-dashboard.json", {
  generatedAt,
  live: {
    available: true,
    positions: [
      {
        symbol: "SYN_SRC",
        qty: 1,
        currentPrice: 100,
        plannedStage6Hash: "matching-stage6-hash",
        plannedStage6File: "matching-stage6.json"
      },
      {
        symbol: "SYN_LEDGER",
        qty: 1,
        currentPrice: 100,
        plannedStage6Hash: "ledger-matching-hash",
        plannedStage6File: "ledger-matching-stage6.json",
        plannedLedgerKey: "ledger-matching-hash:SYN_LEDGER:buy"
      },
      {
        symbol: "SYN_PARTIAL",
        qty: 1,
        currentPrice: 100,
        plannedStage6Hash: "partial-hash",
        plannedStage6File: "expected-partial-stage6.json"
      },
      {
        symbol: "SYN_TIMESTAMP",
        qty: 1,
        currentPrice: 100,
        plannedStage6Hash: "timestamp-hash",
        plannedStage6File: "timestamp-stage6.json"
      }
    ],
  },
});
writeJson("position-protection-root-cause-audit.json", {
  rows: ["SYN_SRC", "SYN_LEDGER", "SYN_PARTIAL", "SYN_TIMESTAMP"].map((symbol) => ({
    symbol,
    protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
    blockerDomain: "protection",
    ownershipClassification: "SIDECAR_MANAGED_FILLED"
  })),
});
writeJson("order-ledger.json", {
  orders: {
    "ledger-wrong-hash:SYN_LEDGER:buy": {
      idempotencyKey: "ledger-wrong-hash:SYN_LEDGER:buy",
      symbol: "SYN_LEDGER",
      status: "filled",
      stopLossPrice: 89,
      takeProfitPrice: 119,
      stage6Hash: "ledger-wrong-hash",
      stage6File: "ledger-wrong-stage6.json",
      updatedAt: generatedAt
    },
    "ledger-matching-hash:SYN_LEDGER:buy": {
      idempotencyKey: "ledger-matching-hash:SYN_LEDGER:buy",
      symbol: "SYN_LEDGER",
      status: "filled",
      stopLossPrice: 90,
      takeProfitPrice: 120,
      stage6Hash: "ledger-matching-hash",
      stage6File: "ledger-matching-stage6.json",
      updatedAt: staleGeneratedAt
    }
  }
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
    SYN_PARTIAL: {
      symbol: "SYN_PARTIAL",
      stop: 90,
      target: 120,
      updatedAt: generatedAt,
      stage6Hash: "partial-hash",
      latestStage6File: "wrong-partial-stage6.json"
    },
    SYN_TIMESTAMP: {
      symbol: "SYN_TIMESTAMP",
      stop: 90,
      target: 120,
      stage6Hash: "timestamp-hash",
      latestStage6File: "timestamp-stage6.json"
    }
  },
});
writeJson("stage6-20trade-loop.json", {
  rows: {
    "synthetic-row": {
      symbol: "SYN_SRC",
      stopPlanned: 91,
      targetPlanned: 121,
      runDate: staleGeneratedAt,
      stage6Hash: "matching-stage6-hash",
      stage6File: "matching-stage6.json",
    },
  },
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: ["SYN_SRC", "SYN_LEDGER", "SYN_PARTIAL", "SYN_TIMESTAMP"].map((symbol) => ({
    symbol,
    reconciliationDecision: "FILL_STATE_CONFIRMED",
    requiresLedgerTerminalizationReview: false
  }))
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
assert.equal(report.rows.length, 4);
const bySymbol = new Map(report.rows.map((row) => [row.symbol, row]));
assert.equal(bySymbol.get("SYN_SRC")?.selectedSource?.type, "stage6_20trade_loop");
assert.equal(bySymbol.get("SYN_SRC")?.selectedSource?.fresh, false);
assert.equal(bySymbol.get("SYN_SRC")?.sourceSelection?.lineageStatus, "CURRENT_POSITION_LINEAGE_MATCH");
assert.equal(bySymbol.get("SYN_SRC")?.sourceSelection?.matchingCandidateCount, 1);
assert.equal(bySymbol.get("SYN_SRC")?.blockers?.includes("selected_source_stale"), true);
assert.equal(bySymbol.get("SYN_LEDGER")?.selectedSource?.type, "order_ledger");
assert.equal(bySymbol.get("SYN_LEDGER")?.selectedSource?.stage6Hash, "ledger-matching-hash");
assert.equal(bySymbol.get("SYN_LEDGER")?.sourceSelection?.lineageStatus, "CURRENT_POSITION_LINEAGE_MATCH");
assert.equal(bySymbol.get("SYN_PARTIAL")?.sourceSelection?.lineageStatus, "NO_CURRENT_POSITION_LINEAGE_MATCH");
assert.equal(bySymbol.get("SYN_PARTIAL")?.sourceSelection?.matchingCandidateCount, 0);
assert.equal(bySymbol.get("SYN_PARTIAL")?.blockers?.includes("stage6_dispatch_mismatch"), true);
assert.equal(bySymbol.get("SYN_TIMESTAMP")?.blockers?.includes("selected_source_timestamp_missing"), true);
assert.equal(bySymbol.get("SYN_TIMESTAMP")?.blockers?.includes("selected_source_stale"), false);
assert.equal(report.executionPolicy.brokerMutationAttempted, false);
assert.equal(report.executionPolicy.brokerMutationSubmitted, false);
assert.equal(report.executionPolicy.stateMutationAttempted, false);
assert.equal(report.executionPolicy.stateMutationSubmitted, false);

console.log("[GUARD_METADATA_REFRESH_SOURCE_PRECEDENCE_TEST] pass");
