import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "order-state-release-fixture-"));
const writeJson = (name, value) => {
  fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const key = "fixture-entry-key";
const symbol = "SYM_FIXTURE";
writeJson("order-ledger.json", {
  orders: {
    [key]: {
      idempotencyKey: key,
      symbol,
      status: "filled",
      statusReason: "broker_idempotency_reconcile:filled",
      updatedAt: "2026-08-10T14:00:00.000Z"
    }
  }
});
writeJson("order-idempotency.json", {
  orders: {},
  releases: [
    {
      key,
      symbol,
      brokerStatus: "filled",
      releasedAt: "2026-08-11T14:00:00.000Z",
      reason: "daily_reset"
    }
  ]
});
writeJson("fillability-report.json", {
  generatedAt: "2026-08-11T14:00:00.000Z",
  rows: [{ symbol, status: "NO_ACTIVE_ORDER", reason: "no_active_order" }]
});
writeJson("performance-dashboard.json", {
  generatedAt: "2026-08-11T14:00:00.000Z",
  live: { account: { accountNumber: "****0000" }, positions: [{ symbol, normalizedFillState: "filled" }] }
});

execFileSync(process.execPath, ["scripts/build-order-state-consistency-report.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, ORDER_STATE_CONSISTENCY_STATE_DIR: stateDir },
  stdio: "pipe"
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "order-state-consistency-report.json"), "utf8"));
assert.equal(report.overall, "PASS");
assert.equal(report.summary.failures, 0);
assert.equal(report.summary.warnings, 0);
assert.equal(report.summary.terminalReconciliationRequired, 0);
assert.equal(report.rows.length, 1);
assert.equal(report.rows[0].category, "TERMINAL_CONSISTENT");
assert.equal(report.rows[0].idempotency, "filled");

console.log("order-state release fixture: PASS");
