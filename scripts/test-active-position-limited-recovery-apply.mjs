#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const SCRIPT = path.resolve("scripts/apply-active-position-limited-recovery.mjs");
const APPROVAL = "AUTHORIZE PAPER FIVE-ROW ACTIVE LIMITED STATE RECOVERY ONE-SHOT";
const RECORDED_AT = "2026-08-26T00:00:00.000Z";

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const makeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "active-limited-apply-"));
  const stateDir = path.join(root, "state");
  const output = path.join(root, "safe-output.json");
  const evidence = path.join(root, "broker-evidence-safe.json");
  const backupDir = path.join(root, "backup");
  const orders = {};
  const rows = [];
  for (let index = 1; index <= 5; index += 1) {
    const key = `fixture-idempotency-${index}`;
    orders[key] = {
      idempotencyKey: key,
      symbol: `FIXTURE${index}`,
      side: "buy",
      executionSide: "buy",
      actionType: "ENTRY_NEW",
      submittedQty: index,
      stage6Hash: String(index).repeat(64),
      stage6File: `STAGE6_FIXTURE_${index}.json`,
      mode: "PAPER",
      clientOrderId: `fixture-client-${index}`,
      status: "submitted",
      statusReason: "fixture",
      preflightCode: "PREFLIGHT_PASS",
      regimeProfile: "default",
      notional: 100,
      limitPrice: 10,
      takeProfitPrice: 12,
      stopLossPrice: 9,
      brokerOrderId: index === 5 ? null : `fixture-broker-${index}`,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:01:00.000Z",
      history: [],
    };
    rows.push({
      requiresLedgerTerminalizationReview: true,
      reconciliationDecision: "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE",
      ledger: { key },
      idempotency: index === 1 ? { key } : null,
    });
  }
  writeJson(path.join(stateDir, "order-ledger.json"), {
    orders,
    updatedAt: "2026-08-20T00:01:00.000Z",
  });
  writeJson(path.join(stateDir, "order-idempotency.json"), {
    orders: {
      "fixture-idempotency-1": {
        symbol: "FIXTURE1",
        side: "buy",
        executionSide: "buy",
        actionType: "ENTRY_NEW",
        submittedQty: 1,
        stage6Hash: "1".repeat(64),
        stage6File: "STAGE6_FIXTURE_1.json",
        clientOrderId: "fixture-client-1",
        brokerOrderId: "fixture-broker-1",
        brokerStatus: "accepted",
        firstSeenAt: "2026-08-20T00:00:00.000Z",
        lastSeenAt: "2026-08-20T00:01:00.000Z",
      },
    },
    releases: [{
      key: "fixture-idempotency-2",
      symbol: "FIXTURE2",
      side: "buy",
      stage6Hash: "2".repeat(64),
      stage6File: "STAGE6_FIXTURE_2.json",
      clientOrderId: "fixture-client-2",
      brokerOrderId: "fixture-broker-2",
      brokerStatus: "filled",
      firstSeenAt: "2026-08-20T00:00:00.000Z",
      lastSeenAt: "2026-08-20T00:01:00.000Z",
      releasedAt: "2026-08-21T00:00:00.000Z",
      reason: "fixture_release",
    }],
    updatedAt: "2026-08-20T00:01:00.000Z",
  });
  writeJson(path.join(stateDir, "fill-state-reconciliation-audit.json"), { rows });
  writeJson(evidence, {
    schemaVersion: "paper-five-row-broker-evidence-safe-v1",
    mode: "PAPER_BROKER_GET_ONLY_CACHE_RESTORE",
    status: "PAPER_FIVE_ROW_BROKER_EVIDENCE_AGGREGATE_READY",
    sourceCacheKey: "sidecar-state-main-32742503181",
    preservedBaselineRunId: 32734129649,
    cacheExactMatch: true,
    targetRows: 5,
    uniqueIdentityRows: 5,
    activePositionRows: 5,
    brokerFilledConfirmedRows: 5,
    zeroOrNotFoundPositionRows: 0,
    terminalEvidenceRows: 0,
    inconclusiveEvidenceRows: 0,
    unknownOrUnclassifiedRows: 0,
    orderLedgerHashParity: true,
    idempotencyHashParity: true,
    stateMutationAttempted: false,
    brokerMutationAttempted: false,
    requestBudgetCompliant: true,
    privateEvidenceUploaded: false,
    rawBrokerResponseStored: false,
  });
  return { root, stateDir, output, evidence, backupDir };
};

const envFor = (fixture, overrides = {}) => ({
  ...process.env,
  ACTIVE_LIMITED_RECOVERY_STATE_DIR: fixture.stateDir,
  ACTIVE_LIMITED_RECOVERY_OUTPUT: fixture.output,
  ACTIVE_LIMITED_RECOVERY_BACKUP_DIR: fixture.backupDir,
  ACTIVE_LIMITED_RECOVERY_EVIDENCE_FILE: fixture.evidence,
  ACTIVE_LIMITED_RECOVERY_EVIDENCE_SHA256: sha256File(fixture.evidence),
  ACTIVE_LIMITED_RECOVERY_EXPECTED_ORDER_LEDGER_SHA256: sha256File(path.join(fixture.stateDir, "order-ledger.json")),
  ACTIVE_LIMITED_RECOVERY_EXPECTED_IDEMPOTENCY_SHA256: sha256File(path.join(fixture.stateDir, "order-idempotency.json")),
  ACTIVE_LIMITED_RECOVERY_RECORDED_AT: RECORDED_AT,
  ACTIVE_LIMITED_RECOVERY_APPROVAL: APPROVAL,
  ACTIVE_LIMITED_RECOVERY_APPLY: "true",
  ...overrides,
});

const fixture = makeFixture();
const ledgerBefore = sha256File(path.join(fixture.stateDir, "order-ledger.json"));
const idempotencyBeforeText = fs.readFileSync(path.join(fixture.stateDir, "order-idempotency.json"), "utf8");
execFileSync(process.execPath, [SCRIPT], { env: envFor(fixture), stdio: "pipe" });

const report = JSON.parse(fs.readFileSync(fixture.output, "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(fixture.stateDir, "order-idempotency.json"), "utf8"));
assert.equal(report.status, "PAPER_ACTIVE_LIMITED_RECOVERY_APPLIED_AND_VERIFIED");
assert.equal(report.summary.targetRows, 5);
assert.equal(report.summary.uniqueIdentityRows, 5);
assert.equal(report.summary.appliedRows, 5);
assert.equal(report.summary.postVerifiedRows, 5);
assert.equal(report.summary.unknownOrUnclassifiedRows, 0);
assert.equal(report.summary.originalTimestampFabricationRows, 0);
assert.equal(report.stateMutationApplied, true);
assert.equal(report.orderLedgerMutationApplied, false);
assert.equal(report.partialRecoveryApplied, false);
assert.equal(report.brokerRequestAttempted, false);
assert.equal(report.brokerMutationAttempted, false);
assert.equal(sha256File(path.join(fixture.stateDir, "order-ledger.json")), ledgerBefore);
assert.notEqual(report.preWriteIdempotencySha256, report.postWriteIdempotencySha256);
assert.equal(fs.readFileSync(path.join(fixture.backupDir, "order-idempotency.json.before"), "utf8"), idempotencyBeforeText);
assert.equal(Object.keys(state.orders).length, 5);
for (let index = 1; index <= 5; index += 1) {
  const row = state.orders[`fixture-idempotency-${index}`];
  assert.equal(row.recoveryMode, "ACTIVE_POSITION_LIMITED_CONTROL");
  assert.equal(row.recoveryRecordedAt, RECORDED_AT);
  assert.equal(row.recoveryRecordedAtIsOriginalTimestamp, false);
  assert.equal(row.entryAllowed, false);
  assert.equal(row.scaleInAllowed, false);
  assert.equal(row.riskIncreasingActionAllowed, false);
  assert.equal(row.reportOnlyExitEvaluationAllowed, true);
  assert.equal(row.brokerSubmitAllowed, false);
  assert.equal(row.realizedPnlVerified, false);
  assert.equal(row.historicalEvidenceNormalized, false);
  if (index === 1) {
    assert.equal(row.firstSeenAt, "2026-08-20T00:00:00.000Z");
    assert.equal(row.lastSeenAt, "2026-08-20T00:01:00.000Z");
    assert.equal(row.brokerStatus, "accepted");
  } else {
    assert.equal(row.firstSeenAt, null);
    assert.equal(row.lastSeenAt, null);
    assert.equal(row.brokerStatus, null);
  }
}
const publicText = fs.readFileSync(fixture.output, "utf8");
for (const forbidden of ["FIXTURE1", "fixture-client", "fixture-broker", "fixture-idempotency"]) {
  assert.equal(publicText.includes(forbidden), false, `public evidence leaked: ${forbidden}`);
}

const driftFixture = makeFixture();
const driftBefore = fs.readFileSync(path.join(driftFixture.stateDir, "order-idempotency.json"), "utf8");
const drift = spawnSync(process.execPath, [SCRIPT], {
  env: envFor(driftFixture, { ACTIVE_LIMITED_RECOVERY_EXPECTED_IDEMPOTENCY_SHA256: "a".repeat(64) }),
  encoding: "utf8",
});
assert.notEqual(drift.status, 0);
assert.equal(fs.readFileSync(path.join(driftFixture.stateDir, "order-idempotency.json"), "utf8"), driftBefore);
assert.equal(JSON.parse(fs.readFileSync(driftFixture.output, "utf8")).stateMutationApplied, false);

const scopeFixture = makeFixture();
const scopeAudit = JSON.parse(fs.readFileSync(path.join(scopeFixture.stateDir, "fill-state-reconciliation-audit.json"), "utf8"));
scopeAudit.rows.pop();
writeJson(path.join(scopeFixture.stateDir, "fill-state-reconciliation-audit.json"), scopeAudit);
const scopeBefore = fs.readFileSync(path.join(scopeFixture.stateDir, "order-idempotency.json"), "utf8");
const scope = spawnSync(process.execPath, [SCRIPT], { env: envFor(scopeFixture), encoding: "utf8" });
assert.notEqual(scope.status, 0);
assert.equal(fs.readFileSync(path.join(scopeFixture.stateDir, "order-idempotency.json"), "utf8"), scopeBefore);

const workflow = fs.readFileSync(
  path.resolve(".github/workflows/paper-five-row-active-limited-state-recovery.yml"),
  "utf8",
);
assert.equal(workflow.includes("paper-active-limited-backup-main-${{ github.run_id }}"), true);
assert.equal(workflow.includes("ALPACA_KEY_ID"), false);
assert.equal(workflow.includes("ALPACA_SECRET_KEY"), false);
assert.equal(workflow.includes("restore-keys:"), false);
assert.equal(workflow.includes("broker POST"), false);

console.log("active_position_limited_recovery_apply_test=PASS");
