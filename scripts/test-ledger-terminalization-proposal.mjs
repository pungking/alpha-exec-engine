#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-terminalization-proposal-"));
const writeJson = (name, value) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const stage6File = "STAGE6_ALPHA_FINAL_fixture.json";
const stage6Hash = "fixture-stage6-hash";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ledger = (symbol, key, overrides = {}) => ({
  idempotencyKey: key,
  symbol,
  side: "buy",
  stage6File,
  stage6Hash,
  clientOrderId: `client-${symbol}`,
  brokerOrderId: `broker-${symbol}`,
  status: "submitted",
  createdAt: "2026-01-01T14:30:00.000Z",
  updatedAt: "2026-01-01T14:31:00.000Z",
  ...overrides,
});
const release = (symbol, key, overrides = {}) => ({
  key,
  symbol,
  side: "buy",
  stage6File,
  stage6Hash,
  clientOrderId: `client-${symbol}`,
  brokerOrderId: `broker-${symbol}`,
  brokerStatus: "filled",
  firstSeenAt: "2026-01-01T14:29:59.000Z",
  lastSeenAt: "2026-01-01T14:31:00.000Z",
  releasedAt: "2026-01-02T14:30:00.000Z",
  reason: "daily_reset",
  ...overrides,
});
const brokerEvidence = (symbol) => ({
  symbol,
  evidenceVerdict: "BROKER_FILLED_CONFIRMED",
  proposedTerminalState: "filled",
  confidence: "high",
  clientOrderId: `client-${symbol}`,
  brokerOrder: {
    id: `broker-${symbol}`,
    status: "filled",
    filledQty: 1,
    filledAt: "2026-01-01T14:31:00.000Z",
  },
  brokerPosition: { qty: 1 },
});

const cases = [
  ["RELEASE", "release-key"],
  ["SYMBOL_ONLY", "symbol-only-key"],
  ["MULTIPLE", "multiple-key"],
  ["MISSING_IDS", "missing-ids-key"],
  ["STAGE6_MISMATCH", "stage6-mismatch-key"],
  ["BROKER_MISMATCH", "broker-mismatch-key"],
  ["TERMINAL_MISMATCH", "terminal-mismatch-key"],
  ["LEGACY_AMBIGUOUS", "legacy-ambiguous-key"],
  ["EMBEDDED_OVERRIDE", "embedded-storage-key"],
  ["ALIAS_MISMATCH", "alias-mismatch-key"],
  ["CURRENT", "current-key"],
];
const entryTerminal = ["ENTRY_TERMINAL", `${stage6Hash}:ENTRY_TERMINAL:buy`];
const entryMissingLineage = ["ENTRY_MISSING_LINEAGE", `${stage6Hash}:ENTRY_MISSING_LINEAGE:buy`];
const entryExitOnly = ["ENTRY_EXIT_ONLY", `${stage6Hash}:ENTRY_EXIT_ONLY:buy:exit_full`];
writeJson("order-ledger.json", {
  orders: Object.fromEntries([...cases, entryTerminal, entryMissingLineage, entryExitOnly].map(([symbol, key]) => [
    key,
    ledger(symbol, key, symbol === "MISSING_IDS"
      ? { clientOrderId: null, brokerOrderId: null }
      : symbol === "EMBEDDED_OVERRIDE"
        ? { key, idempotencyKey: "embedded-overridden-key" }
        : symbol === "ENTRY_EXIT_ONLY"
          ? { actionType: "EXIT_FULL" }
          : {}),
  ])),
});
writeJson("order-idempotency.json", {
  orders: {
    "wrong-key": release("SYMBOL_ONLY", "wrong-key"),
    "current-key": release("CURRENT", "current-key"),
    "terminal-mismatch-key": release("TERMINAL_MISMATCH", "terminal-mismatch-key"),
    "legacy-ambiguous-key": release("LEGACY_AMBIGUOUS", "legacy-ambiguous-key"),
    "embedded-storage-key": release("EMBEDDED_OVERRIDE", "embedded-storage-key"),
    [entryTerminal[1]]: release(entryTerminal[0], entryTerminal[1]),
    [entryMissingLineage[1]]: release(entryMissingLineage[0], entryMissingLineage[1]),
    [entryExitOnly[1]]: release(entryExitOnly[0], entryExitOnly[1], { actionType: "EXIT_FULL" }),
  },
  releases: [
    release("RELEASE", "release-key"),
    release("MULTIPLE", "multiple-key"),
    release("MULTIPLE", "multiple-key"),
    release("MISSING_IDS", "missing-ids-key", { clientOrderId: null, brokerOrderId: null }),
    release("STAGE6_MISMATCH", "stage6-mismatch-key", { stage6Hash: "wrong-stage6-hash" }),
    release("BROKER_MISMATCH", "broker-mismatch-key"),
    release("OLD_ALIAS", "alias-mismatch-key", {
      clientOrderId: "client-ALIAS_MISMATCH",
      brokerOrderId: "broker-ALIAS_MISMATCH",
    }),
  ],
});
writeJson("broker-fill-state-evidence.json", {
  rows: cases.map(([symbol]) => {
    if (symbol === "BROKER_MISMATCH") {
      return { ...brokerEvidence(symbol), brokerOrder: { id: "different-broker-order" } };
    }
    if (symbol === "TERMINAL_MISMATCH") {
      return {
        ...brokerEvidence(symbol),
        evidenceVerdict: "BROKER_TERMINAL_UNFILLED_CONFIRMED",
        proposedTerminalState: "canceled",
        brokerOrder: { id: "different-terminal-broker-order" },
        brokerPosition: { qty: 0 },
      };
    }
    if (symbol === "LEGACY_AMBIGUOUS") {
      return {
        ...brokerEvidence(symbol),
        brokerOrder: {
          id: `broker-${symbol}`,
          status: "accepted",
          filledQty: 0,
          filledAt: null,
        },
      };
    }
    return brokerEvidence(symbol);
  }),
});
writeJson("fill-state-reconciliation-audit.json", {
  rows: cases.map(([symbol, key]) => ({
    symbol,
    requiresLedgerTerminalizationReview: true,
    reconciliationDecision: "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE",
    ledger: { key },
  })),
});
writeJson("fillability-report.json", {
  summary: { stage6Hash, stage6File },
  rows: [entryTerminal, entryMissingLineage, entryExitOnly].map(([symbol]) => ({
    symbol,
    status: "TERMINAL_UNFILLED",
    reason: "canceled",
    brokerClosedStatus: "canceled",
    ...(symbol === entryMissingLineage[0] ? {} : {
      brokerClosedClientOrderIdSha256: sha256(`client-${symbol}`),
      brokerClosedOrderIdSha256: sha256(`broker-${symbol}`),
    }),
  })),
});
writeJson("order-state-consistency-report.json", {
  rows: [entryTerminal, entryMissingLineage, entryExitOnly].map(([symbol]) => ({
    symbol,
    terminalState: "canceled",
    terminalReconciliationRequired: true,
  })),
});
writeJson("guard-source-recovery-plan.json", { rows: [] });

execFileSync(process.execPath, ["scripts/build-broker-fill-state-evidence.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, BROKER_FILL_STATE_EVIDENCE_SELFTEST: "true" },
  stdio: "pipe",
});

execFileSync(process.execPath, ["scripts/build-ledger-terminalization-proposal.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LEDGER_TERMINALIZATION_PROPOSAL_STATE_DIR: stateDir },
  stdio: "pipe",
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger-terminalization-proposal.json"), "utf8"));
const bySymbol = new Map(report.rows.map((row) => [row.symbol, row]));

assert.equal(bySymbol.get("RELEASE").idempotencyEvidenceStatus, "IDEMPOTENCY_LEGACY_RELEASE_EXACT_MATCH");
assert.equal(bySymbol.get("RELEASE").idempotencyEvidenceSource, "legacy_release");
assert.equal(bySymbol.get("RELEASE").proposalReady, false);
assert.equal(bySymbol.get("RELEASE").proposedPatchPreview, null);

assert.equal(bySymbol.get("SYMBOL_ONLY").idempotencyEvidenceStatus, "IDEMPOTENCY_ENTRY_ABSENT");
assert.equal(bySymbol.get("SYMBOL_ONLY").proposalReady, false);
assert.equal(bySymbol.get("SYMBOL_ONLY").proposedPatchPreview, null);

assert.equal(bySymbol.get("MULTIPLE").idempotencyEvidenceStatus, "IDEMPOTENCY_MULTIPLE_CANDIDATES");
assert.equal(bySymbol.get("MULTIPLE").proposalReady, false);

assert.equal(bySymbol.get("MISSING_IDS").idempotencyEvidenceStatus, "IDEMPOTENCY_EXACT_KEY_IDENTITY_MISMATCH");
assert.equal(bySymbol.get("MISSING_IDS").proposalReady, false);

assert.equal(bySymbol.get("STAGE6_MISMATCH").idempotencyEvidenceStatus, "IDEMPOTENCY_EXACT_KEY_IDENTITY_MISMATCH");
assert.equal(bySymbol.get("STAGE6_MISMATCH").proposalReady, false);

assert.equal(bySymbol.get("BROKER_MISMATCH").idempotencyEvidenceStatus, "IDEMPOTENCY_LEGACY_RELEASE_EXACT_MATCH");
assert.equal(bySymbol.get("BROKER_MISMATCH").proposalReady, false);
assert.ok(bySymbol.get("BROKER_MISMATCH").blockers.includes("broker_fill_exact_lineage_mismatch"));

assert.equal(bySymbol.get("TERMINAL_MISMATCH").proposalReady, false);
assert.ok(bySymbol.get("TERMINAL_MISMATCH").blockers.includes("broker_fill_exact_lineage_mismatch"));

assert.equal(bySymbol.get("LEGACY_AMBIGUOUS").proposalReady, false);
assert.ok(bySymbol.get("LEGACY_AMBIGUOUS").blockers.includes("broker_filled_evidence_basis_unverified"));

assert.equal(bySymbol.get("EMBEDDED_OVERRIDE").proposalReady, false);
assert.ok(bySymbol.get("EMBEDDED_OVERRIDE").blockers.includes("order_ledger_exact_match_missing"));

assert.equal(bySymbol.get("ALIAS_MISMATCH").idempotencyEvidenceStatus, "IDEMPOTENCY_EXACT_KEY_IDENTITY_MISMATCH");
assert.equal(bySymbol.get("ALIAS_MISMATCH").proposalReady, false);

assert.equal(bySymbol.get("CURRENT").idempotencyEvidenceStatus, "IDEMPOTENCY_CURRENT_EXACT_MATCH");
assert.equal(bySymbol.get("CURRENT").idempotencyEvidenceSource, "current");
assert.equal(bySymbol.get("CURRENT").proposalReady, true);

assert.equal(bySymbol.get("ENTRY_TERMINAL").idempotencyEvidenceStatus, "IDEMPOTENCY_CURRENT_EXACT_MATCH");
assert.equal(bySymbol.get("ENTRY_TERMINAL").proposalReady, true);
assert.equal(bySymbol.get("ENTRY_MISSING_LINEAGE").proposalReady, false);
assert.ok(bySymbol.get("ENTRY_MISSING_LINEAGE").blockers.includes("fillability_exact_order_lineage_missing"));
assert.equal(bySymbol.get("ENTRY_EXIT_ONLY").proposalReady, false);
assert.equal(report.summary.unknownOrUnclassifiedRows, 0);

execFileSync(process.execPath, ["scripts/build-ledger-terminalization-proposal.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LEDGER_TERMINALIZATION_PROPOSAL_STATE_DIR: stateDir },
  stdio: "pipe",
});
const rerun = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger-terminalization-proposal.json"), "utf8"));
assert.deepEqual(rerun.rows, report.rows);
console.log("[LEDGER_TERMINALIZATION_PROPOSAL_TEST] pass");
