import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stop-only-oco-conversion-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8"));

writeJson("broker-child-order-reconciliation.json", {
  overall: "critical",
  generatedAt: "2026-06-29T15:00:00.000Z",
  rows: [
    {
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
      brokerNestedSellOrderCount: 1,
      normalizedFillState: "filled",
      ownershipClassification: "SIDECAR_MANAGED_FILLED",
      plannedStopPrice: 32,
      plannedTargetPrice: 66,
      effectiveStopPrice: 32,
      effectiveTargetPrice: 66,
      plannedLedgerUpdatedAt: "2026-06-29T15:00:00.000Z",
      fillStateReconciliation: { repairBlocked: false, status: "confirmed_filled" }
    },
    {
      symbol: "BLOCK",
      qty: 1,
      currentPrice: 20,
      protectionStatus: "STOP_AND_TARGET_CHILD_MISSING",
      severity: "critical",
      stopChildMissing: true,
      targetChildMissing: true,
      brokerStopPresent: false,
      brokerTargetPresent: false,
      normalizedFillState: "filled",
      ownershipClassification: "SIDECAR_MANAGED_FILLED",
      effectiveStopPrice: 15,
      effectiveTargetPrice: 25,
      fillStateReconciliation: { repairBlocked: false, status: "confirmed_filled" }
    }
  ]
});

execFileSync(process.execPath, ["scripts/build-stop-only-oco-conversion-plan.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, STOP_ONLY_OCO_CONVERSION_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = readJson("stop-only-oco-conversion-plan.json");
const tree = report.rows.find((row) => row.symbol === "TREE");
const blocked = report.rows.find((row) => row.symbol === "BLOCK");

assert.equal(report.overall, "manual_review_required");
assert.equal(report.summary.reviewReady, 1);
assert.equal(report.summary.selectedSymbol, "TREE");
assert.equal(report.summary.brokerMutationAttempted, false);
assert.equal(report.summary.brokerMutationSubmitted, false);
assert.equal(tree.conversionDecision, "REPORT_ONLY_OCO_CONVERSION_REVIEW_READY");
assert.equal(tree.existingTargetChildConfirmed, true);
assert.equal(tree.standaloneStopAllowed, false);
assert.equal(tree.cancelExistingTargetRequired, true);
assert.equal(tree.newOcoSubmitRequired, true);
assert.equal(tree.readyForBrokerSubmit, false);
assert.equal(tree.brokerMutationAttempted, false);
assert.equal(tree.brokerMutationSubmitted, false);
assert.equal(tree.newOcoPayloadPreview.time_in_force, "gtc");
assert.equal(tree.newOcoPayloadPreview.order_class, "oco");
assert.ok(tree.idempotencyKeyPreview.includes("TREE"));
assert.ok(tree.rollbackPlan.length > 0);
assert.ok(tree.nestedVisibilityPlan.length > 0);
assert.equal(blocked.conversionDecision, "BLOCKED");
assert.ok(blocked.blockers.includes("not_stop_only_target_present_pattern"));

console.log("[STOP_ONLY_OCO_CONVERSION_PLAN_TEST] pass");
