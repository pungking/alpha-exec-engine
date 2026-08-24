#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-filled-public-evidence-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const privateSymbol = "PRIVATE_SYMBOL_FIXTURE";
const privateLedgerKey = "private-ledger-key";
const privateIdempotencyKey = "private-idempotency-key";

writeJson("ledger-filled-migration-apply-report.json", {
  generatedAt: "2026-08-25T00:00:00.000Z",
  overall: "apply_blocked_by_safety_gates",
  apply: { requested: true, approvalProvided: true, symbolFilter: [privateSymbol], maxRows: 1 },
  fileHashes: {
    before: { orderLedger: { sha256: "a".repeat(64) }, idempotency: { sha256: "b".repeat(64) } },
    after: { orderLedger: { sha256: "a".repeat(64) }, idempotency: { sha256: "b".repeat(64) } }
  },
  backup: { created: false },
  executionPolicy: {
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  },
  summary: { selectedRows: 1, readyRows: 0, blockedRows: 1, postVerifiedRows: 0, stateMutationAttempted: false, stateMutationApplied: false },
  rows: [{ symbol: privateSymbol, ledgerKey: privateLedgerKey, idempotencyKey: privateIdempotencyKey }]
});
writeJson("fill-state-reconciliation-audit.json", { overall: "reconciliation_required", summary: { ledgerTerminalizationReviewRequired: 1 } });
writeJson("ledger-terminalization-proposal.json", { overall: "manual_state_migration_review_ready", summary: { rows: 1, proposalReady: 1, blocked: 0 } });
writeJson("ops-lane-status-report.json", { overall: "blocked_lanes_present", summary: { blockedCount: 1 } });
writeJson("ops-health-report.json", { overall: "fail", blockerGroups: { safety_mutation: { status: "pass" } } });

execFileSync(process.execPath, ["scripts/build-ledger-filled-migration-public-evidence.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LEDGER_FILLED_MIGRATION_PUBLIC_STATE_DIR: stateDir, GITHUB_RUN_ID: "123", GITHUB_SHA: "c".repeat(40) },
  stdio: "pipe"
});

const jsonText = fs.readFileSync(path.join(stateDir, "ledger-filled-migration-public-evidence.json"), "utf8");
const markdown = fs.readFileSync(path.join(stateDir, "ledger-filled-migration-public-evidence.md"), "utf8");
const evidence = JSON.parse(jsonText);
for (const privateValue of [privateSymbol, privateLedgerKey, privateIdempotencyKey]) {
  assert.equal(jsonText.includes(privateValue), false);
  assert.equal(markdown.includes(privateValue), false);
}
assert.equal(evidence.schemaVersion, "ledger-filled-migration-public-evidence-v1");
assert.equal(evidence.scope.requestedRows, 1);
assert.equal(evidence.summary.selectedRows, 1);
assert.equal(evidence.redaction.privateIdentifiersStoredOrPrinted, false);
assert.equal(evidence.redaction.rawStateStored, false);

const workflow = fs.readFileSync(".github/workflows/ledger-filled-migration.yml", "utf8");
assert.equal(workflow.includes("selectedSymbols: [...selectedSymbols]"), false);
assert.equal(workflow.includes("terminal: terminal.summary, repairLane"), false);
assert.equal(workflow.includes("cat state/ledger-filled-migration-apply-report.md"), false);
assert.equal(workflow.includes("state/order-ledger.json"), false);
assert.equal(workflow.includes("state/order-idempotency.json"), false);
assert.equal(workflow.includes("state/ledger-filled-migration-public-evidence.json"), true);
assert.equal(workflow.includes("scopeParity"), true);
assert.equal(workflow.includes("selectedCountParity"), true);
assert.equal(workflow.includes("postVerifiedRows === selectedRows"), true);
console.log("[LEDGER_FILLED_MIGRATION_PUBLIC_EVIDENCE_TEST] pass");
