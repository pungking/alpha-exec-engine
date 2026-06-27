#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-filled-apply-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const sha256 = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
const runApply = (env = {}) => execFileSync(process.execPath, ["scripts/apply-ledger-filled-migration.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LEDGER_FILLED_MIGRATION_APPLY_STATE_DIR: stateDir, ...env },
  stdio: "pipe"
});

const keyFor = (symbol) => `${symbol.toLowerCase()}:${symbol}:buy`;

const ledger = {
  orders: {
    "aaa:AAA:buy": { symbol: "AAA", status: "submitted", brokerStatus: null },
    "bbb:BBB:buy": { symbol: "BBB", status: "submitted", brokerStatus: null }
  }
};
const idem = {
  orders: {
    "aaa:AAA:buy": { symbol: "AAA", brokerStatus: "submitted" },
    "bbb:BBB:buy": { symbol: "BBB", brokerStatus: "submitted" }
  }
};
writeJson("order-ledger.json", ledger);
writeJson("order-idempotency.json", idem);
const ledgerText = fs.readFileSync(path.join(stateDir, "order-ledger.json"), "utf8");
const idemText = fs.readFileSync(path.join(stateDir, "order-idempotency.json"), "utf8");
writeJson("ledger-filled-migration-plan.json", {
  fileHashes: { orderLedger: { sha256: sha256(ledgerText) }, idempotency: { sha256: sha256(idemText) } },
  rows: ["BBB", "AAA"].map((symbol) => ({
    symbol,
    readyForApplyReview: true,
    proposedTerminalState: "filled",
    brokerEvidenceVerdict: "BROKER_FILLED_CONFIRMED",
    keys: { ledgerKey: keyFor(symbol), idempotencyKey: keyFor(symbol) },
    diffPreview: {
      orderLedger: { key: keyFor(symbol), after: { status: "filled", brokerStatus: "filled" } },
      orderIdempotency: { key: keyFor(symbol), after: { brokerStatus: "filled", terminal: false, releaseReason: null } }
    }
  }))
});

runApply({ LEDGER_FILLED_MIGRATION_APPLY: "true", LEDGER_FILLED_MIGRATION_APPROVAL: "WRONG", LEDGER_FILLED_MIGRATION_MAX_ROWS: "1" });
let report = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger-filled-migration-apply-report.json"), "utf8"));
assert.equal(report.overall, "apply_blocked_by_safety_gates");
assert.equal(report.summary.stateMutationApplied, false);

runApply({ LEDGER_FILLED_MIGRATION_APPLY: "true", LEDGER_FILLED_MIGRATION_APPROVAL: "CONFIRM STATE LEDGER MIGRATION", LEDGER_FILLED_MIGRATION_MAX_ROWS: "1" });
report = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger-filled-migration-apply-report.json"), "utf8"));
const postLedger = JSON.parse(fs.readFileSync(path.join(stateDir, "order-ledger.json"), "utf8"));
assert.equal(report.overall, "state_migration_applied_and_verified");
assert.equal(report.summary.selectedRows, 1);
assert.equal(report.rows[0].symbol, "AAA");
assert.equal(postLedger.orders["aaa:AAA:buy"].status, "filled");
assert.equal(postLedger.orders["bbb:BBB:buy"].status, "submitted");
console.log("[LEDGER_FILLED_MIGRATION_APPLY_TEST] pass");
