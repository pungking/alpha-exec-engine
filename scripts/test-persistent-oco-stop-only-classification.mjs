import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "persistent-oco-stop-only-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8"));

writeJson("broker-child-order-reconciliation.json", {
  overall: "report_only",
  generatedAt: "2026-06-29T15:00:00.000Z",
  rows: [{
    symbol: "TREE",
    qty: 2,
    currentPrice: 40,
    protectionStatus: "STOP_CHILD_MISSING",
    severity: "critical",
    stopChildMissing: true,
    targetChildMissing: false,
    brokerStopPresent: false,
    brokerTargetPresent: true,
    brokerSellOrderCount: 1,
    normalizedFillState: "filled",
    ownershipClassification: "SIDECAR_MANAGED_FILLED",
    plannedStopPrice: 32,
    plannedTargetPrice: 66,
    effectiveStopPrice: 32,
    effectiveTargetPrice: 66,
    plannedLedgerUpdatedAt: "2026-06-29T15:00:00.000Z",
    fillStateReconciliation: { repairBlocked: false, status: "confirmed_filled" }
  }]
});
writeJson("position-lifecycle-guard-source-plan.json", { overall: "none", rows: [] });

execFileSync(process.execPath, ["scripts/build-persistent-oco-repair-plan.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PERSISTENT_OCO_REPAIR_STATE_DIR: stateDir },
  stdio: "pipe"
});
const report = readJson("persistent-oco-repair-plan.json");
const row = report.rows.find((item) => item.symbol === "TREE");
assert.equal(report.summary.stopOnlyRepairReviewReady, 1);
assert.equal(row.childRepairPattern, "stop_only_missing_target_present");
assert.equal(row.stopOnlyRepairReviewReady, true);
assert.equal(row.readiness, "BLOCKED");
assert.equal(row.payloadPreview, null);
assert.ok(row.blockers.includes("stop_only_repair_requires_separate_lane"));
