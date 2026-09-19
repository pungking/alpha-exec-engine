#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-closeout-test-"));
const cli = path.resolve("scripts/audit-paper-closeout-private-evidence.mjs");
const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const recordHash = value => sha(JSON.stringify(canonical(value)));
const ledger = { symbol: "FIXTURE_PRIVATE", side: "buy", idempotencyKey: "private-entry",
  clientOrderId: "private-client", brokerOrderId: null, stage6File: "fixture-stage6.json", stage6Hash: "a".repeat(64) };
const limited = { ...ledger, recoveryMode: "ACTIVE_POSITION_LIMITED_CONTROL", recoveryEvidenceSha256: "b".repeat(64),
  recoveryRecordedAt: "2026-08-25T00:00:00Z", recoveryRecordedAtIsOriginalTimestamp: false,
  originalIdempotencyEvidenceStatus: "HISTORICAL_EVIDENCE_IRRECOVERABLE", firstSeenAt: null, lastSeenAt: null,
  entryAllowed: false, scaleInAllowed: false, riskIncreasingActionAllowed: false,
  reportOnlyExitEvaluationAllowed: true, brokerSubmitAllowed: false, realizedPnlVerified: false, historicalEvidenceNormalized: false };
const base = () => ({
  "order-ledger.json": { orders: { "private-ledger": structuredClone(ledger) } },
  "order-idempotency.json": { orders: { "private-entry": structuredClone(limited) }, releases: [] },
  "performance-dashboard.json": { live: { positions: [{ symbol: ledger.symbol, qty: 1, side: "long" }] } },
  "position-protection-root-cause-audit.json": { rows: [{ symbol: ledger.symbol, ownershipClassification: "SIDECAR_MANAGED_FILLED",
    idempotencyStatus: "active_position_limited_control", brokerStopPresent: false, brokerTargetPresent: false }] },
  "broker-child-order-reconciliation.json": { rows: [{ symbol: ledger.symbol, brokerStopPresent: false, brokerTargetPresent: false }] },
  "order-state-consistency-report.json": { rows: [{ symbol: ledger.symbol, terminalReconciliationRequired: false }] },
  "last-dry-exec-preview.json": { mode: { readOnly: true, execEnabled: false }, payloads: [],
    actionIntent: { enabled: true, previewOnly: true, allowedActionTypes: ["ENTRY_NEW", "HOLD_WAIT"] },
    paperExitShadowIntent: { mode: "REPORT_ONLY_SHADOW", evaluatedPositionRows: 1,
      exitNotDueRows: 0, scaleDownDueRows: 0, exitPartialDueRows: 0, exitFullDueRows: 1, evidenceIncompleteRows: 0,
      unknownOrUnclassifiedRows: 0, wouldCreateBrokerPayload: false, brokerMutationAttempted: false,
      brokerMutationSubmitted: false, stateMutationAttempted: false, stateMutationSubmitted: false,
      marketSessionEvidence: { source: "ALPACA_CLOCK", status: "MARKET_SESSION_RTH_ELIGIBLE", marketOpen: true },
      rows: [{ symbol: ledger.symbol, actionType: "EXIT_FULL", evaluationStatus: "EVALUATED", stage6File: ledger.stage6File, stage6Hash: ledger.stage6Hash }] } },
});
let cases = 0;
function run(change = () => {}, tamper = () => {}, expected = null, amendManifest = () => {}) {
  const dir = fs.mkdtempSync(path.join(root, "case-"));
  const data = base(); change(data);
  const files = Object.fromEntries(Object.entries(data).map(([name, value]) => {
    const bytes = JSON.stringify(value); fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 }); return [name, sha(bytes)];
  }));
  const manifest = { schemaVersion: "paper-closeout-private-evidence-v1", environment: "PAPER", evidenceBasis: "PRESERVED_SNAPSHOT",
    files, targets: [{ ledgerKey: "private-ledger", idempotencyKey: "private-entry",
      ledgerRecordSha256: recordHash(data["order-ledger.json"].orders["private-ledger"]),
      idempotencyRecordSha256: recordHash(data["order-idempotency.json"].orders["private-entry"]) }] };
  const manifestPath = path.join(dir, "manifest.json");
  amendManifest(manifest);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const pin = sha(fs.readFileSync(manifestPath)); tamper(dir, manifest);
  const before = Object.fromEntries(fs.readdirSync(dir).map(n => [n, sha(fs.readFileSync(path.join(dir, n)))]));
  const child = () => spawnSync(process.execPath, [cli, dir, pin], { cwd: root,
    env: { PATH: process.env.PATH, HOME: root, NODE_OPTIONS: `--require=${path.join(root, "offline.cjs")}` }, encoding: "utf8" });
  const result = child();
  assert.equal(result.status, expected ? 1 : 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, expected || "PRIVATE_EVIDENCE_CONTRACT_VALID_CURRENT_PROOF_REQUIRED");
  assert.equal(output.selectedCandidateCount, 0); assert.equal(output.brokerSubmitAllowed, false);
  assert.equal(output.stateMutationAttempted, false); assert.equal(output.brokerRequestCount, 0);
  for (const secret of [ledger.symbol, ledger.clientOrderId, "private-ledger", "private-entry", "SECRET_MARKER"]) {
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
  assert.deepEqual(Object.fromEntries(fs.readdirSync(dir).map(n => [n, sha(fs.readFileSync(path.join(dir, n)))])), before);
  assert.equal(child().stdout, result.stdout); cases++; return output;
}
try {
  fs.writeFileSync(path.join(root, "offline.cjs"), `const deny=()=>{throw Error('NETWORK_FORBIDDEN')};globalThis.fetch=deny;for(const n of ['http','https']){const m=require('node:'+n);m.request=deny;m.get=deny;}for(const n of ['net','tls']){const m=require('node:'+n);m.connect=deny;m.createConnection=deny;}`);
  const valid = run();
  assert.equal(valid.exactLimitedIdentityRows, 1); assert.equal(valid.missingOriginalBrokerIdRows, 1);
  assert.equal(valid.snapshotPositionRows, 1); assert.equal(valid.currentBrokerEvidenceVerified, false);
  assert.equal(valid.snapshotExitDueRows, 1); assert.equal(valid.entryAllowed, false);
  run(() => {}, dir => fs.appendFileSync(path.join(dir, "order-ledger.json"), " "), "PRIVATE_FILE_HASH_MISMATCH");
  run(() => {}, (dir, m) => { m.evidenceBasis = "CURRENT"; fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m)); }, "PRIVATE_MANIFEST_HASH_MISMATCH");
  run(() => {}, dir => fs.unlinkSync(path.join(dir, "order-ledger.json")), "PRIVATE_INPUT_UNAVAILABLE");
  run(() => {}, dir => fs.chmodSync(path.join(dir, "order-idempotency.json"), 0o644), "PRIVATE_INPUT_PERMISSIONS_INVALID");
  run(d => { d["order-idempotency.json"].orders["private-entry"].clientOrderId = "WRONG"; }, () => {}, "PRIVATE_IDENTITY_LINEAGE_INVALID");
  run(d => { d["order-ledger.json"].orders.duplicate = { ...ledger }; }, () => {}, "PRIVATE_IDENTITY_AMBIGUOUS");
  run(d => { d["order-idempotency.json"].orders["private-entry"].brokerSubmitAllowed = true; }, () => {}, "LIMITED_CONTROL_CONTRACT_INVALID");
  run(d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.wouldCreateBrokerPayload = true; }, () => {}, "PRIVATE_SHADOW_CONTRACT_INVALID");
  run(d => { d["position-protection-root-cause-audit.json"].rows.push({ ...d["position-protection-root-cause-audit.json"].rows[0] }); }, () => {}, "PRIVATE_REPORT_ROWS_AMBIGUOUS");
  run(() => {}, () => {}, "PRIVATE_MANIFEST_SCHEMA_INVALID", m => { m.environment = "LIVE"; });
  run(() => {}, () => {}, "PRIVATE_MANIFEST_SCHEMA_INVALID", m => { m.evidenceBasis = "CURRENT"; });
  run(() => {}, () => {}, "PRIVATE_FILE_SET_INVALID", m => { m.files["../SECRET_MARKER"] = "a".repeat(64); });
  run(() => {}, () => {}, "PRIVATE_EXACT_ENTRY_MISSING", m => { m.targets[0].ledgerKey = ledger.symbol; });
  run(() => {}, () => {}, "PRIVATE_RECORD_HASH_MISMATCH", m => { m.targets[0].ledgerRecordSha256 = "f".repeat(64); });
  run(() => {}, () => {}, "PRIVATE_IDENTITY_AMBIGUOUS", m => { m.targets.push({ ...m.targets[0] }); });
  run(d => { d["order-idempotency.json"].orders.extra = { ...limited, clientOrderId: "different" }; }, () => {}, "PRIVATE_LIMITED_SCOPE_INCOMPLETE");
  run(d => { d["order-ledger.json"].orders["private-ledger"].clientOrderId = null; }, () => {}, "PRIVATE_IDENTITY_LINEAGE_INVALID");
  run(d => { d["order-idempotency.json"].orders["private-entry"].stage6Hash = "d".repeat(64); }, () => {}, "PRIVATE_IDENTITY_LINEAGE_INVALID");
  run(d => { d["order-idempotency.json"].orders["private-entry"].brokerOrderId = "SECRET_MARKER"; }, () => {}, "PRIVATE_IDENTITY_LINEAGE_INVALID");
  run(() => {}, dir => {
    const file = path.join(dir, "order-ledger.json");
    fs.renameSync(file, path.join(dir, "saved.json")); fs.symlinkSync(path.join(dir, "saved.json"), file);
  }, "PRIVATE_INPUT_UNAVAILABLE");
  run(d => { d["order-state-consistency-report.json"] = { rows: [] }; });
  run(d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.marketSessionEvidence = { marketOpen: null, status: "MARKET_SESSION_EVIDENCE_UNAVAILABLE" }; });
  run(d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.rows[0].actionType = "UNKNOWN"; }, () => {}, "PRIVATE_SHADOW_CONTRACT_INVALID");
  run(d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.unknownOrUnclassifiedRows = "not-a-number"; }, () => {}, "PRIVATE_SHADOW_CONTRACT_INVALID");
  run(d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.exitNotDueRows = 1; d["last-dry-exec-preview.json"].paperExitShadowIntent.exitFullDueRows = 0; }, () => {}, "PRIVATE_SHADOW_CONTRACT_INVALID");
  run(d => { d["position-protection-root-cause-audit.json"].rows[0].idempotencyStatus = "recorded"; }, () => {}, "PRIVATE_LIMITED_REPORT_MISMATCH");
  run(d => { d["order-ledger.json"].orders.extra = { ...ledger, symbol: "OTHER", clientOrderId: "other" }; }, () => {}, "PRIVATE_IDENTITY_AMBIGUOUS");
  run(d => {
    d["order-ledger.json"].orders["private-ledger"].brokerOrderId = "same-broker";
    d["order-idempotency.json"].orders["private-entry"].brokerOrderId = "same-broker";
    d["order-ledger.json"].orders.extra = { ...ledger, clientOrderId: "other", idempotencyKey: "other", brokerOrderId: "same-broker" };
  }, () => {}, "PRIVATE_IDENTITY_AMBIGUOUS");
  for (const malformedId of [42, "", " "]) run(d => {
    d["order-ledger.json"].orders["private-ledger"].brokerOrderId = malformedId;
    d["order-idempotency.json"].orders["private-entry"].brokerOrderId = malformedId;
  }, () => {}, "PRIVATE_IDENTITY_LINEAGE_INVALID");
  const blocked = run(d => {
    d["broker-child-order-reconciliation.json"].rows[0].brokerStopPresent = true;
    d["order-state-consistency-report.json"].rows[0].terminalReconciliationRequired = true;
  });
  assert.equal(blocked.snapshotProtectionConflictRows, 1); assert.equal(blocked.snapshotTerminalBlockedRows, 1);
  const external = run(d => { d["performance-dashboard.json"].live.positions.push({ symbol: "EXTERNAL_FIXTURE", qty: 1 }); });
  assert.equal(external.snapshotPositionRows, 2); assert.equal(external.unscopedPositionRows, 1);
  // Importing the shared pure evaluator must not write scorecards or call a broker.
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `process.env=new Proxy(process.env,{get(t,k){if(['STATE_DIR','LIVE_READINESS_STATE_DIR'].includes(k))throw Error('ENV_READ');return t[k]}});await import(${JSON.stringify(path.resolve("scripts/build-live-readiness-scorecard.mjs"))})`], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ""); assert.equal(fs.existsSync(path.join(root, "state")), false);
  console.log(JSON.stringify({ status: "PASS", cases, brokerRequests: 0, realStateWrites: 0 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
