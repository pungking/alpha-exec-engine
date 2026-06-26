#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-terminalization-package-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

writeJson("protection-blocker-reduction-plan.json", { finalVerdict: "BLOCKED" });
writeJson("order-ledger.json", { orders: { "aaa:AAA:buy": { symbol: "AAA", status: "submitted" } } });
writeJson("order-idempotency.json", { orders: { "aaa:AAA:buy": { symbol: "AAA", brokerStatus: "submitted" } } });
writeJson("fill-state-reconciliation-audit.json", {
  rows: [
    { symbol: "AAA", ownershipClassification: "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED" },
    { symbol: "BBB", ownershipClassification: "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED" },
    { symbol: "CCC", ownershipClassification: "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED" },
    { symbol: "EXT", ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION" },
  ]
});
writeJson("broker-fill-state-evidence.json", {
  overall: "terminal_or_filled_evidence_ready",
  rows: [{ symbol: "AAA", evidenceVerdict: "BROKER_FILLED_CONFIRMED" }]
});
writeJson("position-ownership-recovery-decision.json", {
  rows: [{ symbol: "EXT", ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION", ownershipRecoveryDecision: "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE" }]
});
writeJson("ledger-terminalization-proposal.json", {
  overall: "manual_state_migration_review_ready",
  rows: [
    {
      symbol: "AAA",
      ledgerStatus: "submitted",
      brokerEvidenceVerdict: "BROKER_FILLED_CONFIRMED",
      proposedTerminalState: "filled",
      proposalReady: true,
      ledgerKey: "aaa:AAA:buy",
      idempotencyKey: "aaa:AAA:buy",
      blockers: [],
      proposedPatchPreview: {
        orderLedger: { key: "aaa:AAA:buy", before: { status: "submitted" }, proposed: { status: "filled" } },
        orderIdempotency: { key: "aaa:AAA:buy", before: { brokerStatus: "submitted" }, proposed: { brokerStatus: "filled" } }
      }
    },
    { symbol: "BBB", proposalReady: false, blockers: ["broker_evidence_missing"] },
    { symbol: "CCC", proposalReady: false, blockers: ["broker_order_still_working"] },
    {
      symbol: "EXT",
      proposalReady: true,
      proposedTerminalState: "filled",
      proposedPatchPreview: {
        orderLedger: { key: "ext:EXT:buy", before: { status: "submitted" }, proposed: { status: "filled" } },
        orderIdempotency: { key: "ext:EXT:buy", before: { brokerStatus: "submitted" }, proposed: { brokerStatus: "filled" } }
      }
    }
  ]
});

execFileSync(process.execPath, ["scripts/build-ledger-terminalization-migration-package.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LEDGER_TERMINALIZATION_MIGRATION_PACKAGE_STATE_DIR: stateDir },
  stdio: "pipe"
});
const report = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger-terminalization-migration-package.json"), "utf8"));
assert.equal(report.overall, "manual_state_migration_package_ready");
assert.equal(report.mutationAllowed, false);
assert.equal(report.executionPolicy.brokerMutationAttempted, false);
assert.equal(report.executionPolicy.stateMutationAttempted, false);
assert.equal(report.summary.readyForMigrationReview, 1);
assert.equal(report.summary.needsBrokerOrLifecycleEvidence, 1);
assert.equal(report.summary.blocked, 1);
assert.equal(report.summary.ownershipRecoveryTrack, 1);
const bySymbol = new Map(report.rows.map((row) => [row.symbol, row]));
assert.equal(bySymbol.get("AAA").packageDecision, "proposal_ready");
assert.equal(bySymbol.get("AAA").backupRequired, true);
assert.deepEqual(bySymbol.get("AAA").affectedStateFiles, ["order-ledger.json", "order-idempotency.json"]);
assert.equal(bySymbol.get("AAA").requiredApprovalPhrase, "CONFIRM STATE LEDGER MIGRATION");
assert.equal(bySymbol.get("BBB").packageDecision, "needs_broker_or_lifecycle_evidence");
assert.equal(bySymbol.get("CCC").packageDecision, "blocked");
assert.equal(bySymbol.get("EXT").packageDecision, "ownership_recovery_track");
console.log("[LEDGER_TERMINALIZATION_MIGRATION_PACKAGE_TEST] pass");
