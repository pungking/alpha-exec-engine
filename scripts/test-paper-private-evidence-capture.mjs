#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { capturePrivateEvidence, CAPTURE_APPROVAL } from "./capture-paper-private-evidence.mjs";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "private-capture-test-")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const now = "2026-01-05T15:00:00.000Z";
const originalAt = "2026-01-02T15:00:00.000Z";
globalThis.fetch = () => { throw new Error("Unexpected real network in fixture"); };
const env = { ALPHA_ENV: "PAPER", READ_ONLY: "true", EXEC_ENABLED: "false", LIVE_ORDER_SUBMIT_ENABLED: "false",
  ALPACA_BASE_URL: "https://paper-api.alpaca.markets", ALPACA_KEY_ID: "PRIVATE_KEY_FIXTURE", ALPACA_SECRET_KEY: "PRIVATE_SECRET_FIXTURE" };
function source() {
  const directory = fs.mkdtempSync(path.join(root, "source-"));
  const orders = {}, idem = {}, rows = [];
  for (let n = 0; n < 5; n++) {
    const row = { symbol: `FIXTURE_${n}`, clientOrderId: `private-client-${n}`, brokerOrderId: n ? `private-broker-${n}` : null,
      idempotencyKey: `private-key-${n}`, stage6File: "fixture-stage6.json", stage6Hash: "a".repeat(64), side: "buy", status: "filled", updatedAt: originalAt };
    orders[row.idempotencyKey] = row;
    idem[row.idempotencyKey] = { ...row, recoveryMode: "ACTIVE_POSITION_LIMITED_CONTROL", recoveryEvidenceSha256: "b".repeat(64),
      recoveryRecordedAt: originalAt, firstSeenAt: null, lastSeenAt: null, recoveryRecordedAtIsOriginalTimestamp: false,
      entryAllowed: false, scaleInAllowed: false, riskIncreasingActionAllowed: false, brokerSubmitAllowed: false,
      reportOnlyExitEvaluationAllowed: true, realizedPnlVerified: false, historicalEvidenceNormalized: false };
    rows.push({ symbol: row.symbol, evaluationStatus: "EVALUATED", actionType: "EXIT_FULL", stage6File: row.stage6File, stage6Hash: row.stage6Hash });
  }
  const data = {
    "order-ledger.json": { orders }, "order-idempotency.json": { orders: idem, releases: [] },
    "last-dry-exec-preview.json": { generatedAt: originalAt, mode: { readOnly: true, execEnabled: false }, payloads: [],
      actionIntent: { enabled: true, previewOnly: true, allowedActionTypes: ["ENTRY_NEW", "HOLD_WAIT"] },
      paperExitShadowIntent: { mode: "REPORT_ONLY_SHADOW", evaluatedPositionRows: 5, rows,
        exitNotDueRows: 0, scaleDownDueRows: 0, exitPartialDueRows: 0, exitFullDueRows: 5, evidenceIncompleteRows: 0,
        unknownOrUnclassifiedRows: 0, wouldCreateBrokerPayload: false, brokerMutationAttempted: false,
        brokerMutationSubmitted: false, stateMutationAttempted: false, stateMutationSubmitted: false } },
  };
  function persist() {
    const files = {};
    for (const [n, v] of Object.entries(data)) {
      const bytes = JSON.stringify(v); fs.writeFileSync(path.join(directory, n), bytes, { mode: 0o600 }); files[n] = sha(bytes);
    }
    const manifest = { schemaVersion: "paper-private-capture-source-v1", environment: "PAPER", sourceRunId: "12345",
      evidenceBasis: "PRESERVED_STATE_SNAPSHOT", expectedPaperAccountSha256: sha("private-account"), files };
    const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(directory, "source-manifest.json"), bytes, { mode: 0o600 });
    return sha(bytes);
  }
  return { directory, data, persist };
}
let cases = 0;
async function run({ change = () => {}, tamper = () => {}, response = () => {}, config = {}, expected = null, expectedRequests = 5 } = {}) {
  const s = source(); change(s.data); const pin = s.persist(); tamper(s.directory);
  const before = Object.fromEntries(fs.readdirSync(s.directory).map(n => [n, sha(fs.readFileSync(path.join(s.directory, n)))]));
  const output = path.join(root, `capture-${cases}`), calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.equal(new URL(url).origin, env.ALPACA_BASE_URL); calls.push(new URL(url).pathname + new URL(url).search);
    const group = new URL(url).pathname;
    let body = group === "/v2/account" ? { id: "private-account", account_number: "ACCOUNT_FIXTURE", status: "ACTIVE" }
      : group === "/v2/clock" ? { timestamp: now, is_open: true }
      : group === "/v2/positions" ? Object.values(s.data["order-ledger.json"].orders).map(r => ({ symbol: r.symbol, qty: "1", side: "long", current_price: "100", avg_entry_price: "90" })) : [];
    const override = response({ url, group, body, calls, sourceDirectory: s.directory });
    if (override instanceof Error) throw override;
    if (override instanceof Response) return override;
    if (override?.body !== undefined) body = override.body;
    return new Response(JSON.stringify(body), { status: override?.status || 200 });
  };
  const result = await capturePrivateEvidence({ sourceDirectory: s.directory, sourceManifestSha256: pin, outputDirectory: output,
    approval: CAPTURE_APPROVAL, env, fetchImpl, now: () => new Date(now), ...config });
  assert.equal(result.status, expected || "PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED");
  assert.equal(calls.length, expectedRequests);
  assert.equal(result.requestCounts.total, calls.length); assert.equal(result.selectedCandidateCount, 0);
  assert.equal(result.currentBrokerEvidenceVerified, false); assert.equal(result.stateMutationAttempted, false);
  assert.equal(result.brokerSubmitAllowed, false); assert.equal(result.requestBudgetCompliant, true);
  const publicText = JSON.stringify(result);
  for (const marker of ["FIXTURE_", "private-client", "private-broker", "private-key", "private-account", "ACCOUNT_FIXTURE", env.ALPACA_KEY_ID, env.ALPACA_SECRET_KEY]) assert.ok(!publicText.includes(marker));
  if (!expected) {
    const input = path.join(output, "complete");
    const manifest = JSON.parse(fs.readFileSync(path.join(input, "manifest.json")));
    assert.equal(Object.keys(manifest.files).length, 7); assert.equal(manifest.targets.length, 5);
    assert.equal(manifest.evidenceBasis, "PRESERVED_SNAPSHOT");
    for (const [n, h] of Object.entries(manifest.files)) {
      const file = path.join(input, n); assert.equal(sha(fs.readFileSync(file)), h); assert.equal(fs.statSync(file).mode & 0o077, 0);
    }
    assert.equal(fs.statSync(input).mode & 0o077, 0);
    for (const n of Object.keys(s.data)) assert.equal(sha(fs.readFileSync(path.join(input, n))), before[n]);
    assert.equal(result.inputAuditStatus, "PRIVATE_EVIDENCE_CONTRACT_VALID_CURRENT_PROOF_REQUIRED");
    const dashboard = JSON.parse(fs.readFileSync(path.join(input, "performance-dashboard.json")));
    const protection = JSON.parse(fs.readFileSync(path.join(input, "position-protection-root-cause-audit.json")));
    for (const target of manifest.targets) {
      const ledger = s.data["order-ledger.json"].orders[target.ledgerKey];
      assert.equal(dashboard.live.positions.find(p => p.symbol === ledger.symbol)?.plannedLedgerKey, target.ledgerKey);
      assert.equal(protection.rows.find(p => p.symbol === ledger.symbol)?.plannedLedgerKey, target.ledgerKey);
    }
    const terminal = JSON.parse(fs.readFileSync(path.join(input, "attempt-terminal.json")));
    assert.equal(terminal.status, "COMPLETE"); assert.equal(terminal.manifestSha256, result.manifestSha256);
    const provenance = JSON.parse(fs.readFileSync(path.join(output, "capture-provenance.json")));
    assert.equal(provenance.previewSourceAsOf, originalAt); assert.equal(provenance.previewRefreshed, false);
    assert.equal(provenance.closedOrderHistoryCompletenessVerified, false);
    const privateFiles = fs.readdirSync(output, { recursive: true }).map(n => path.join(output, n)).filter(n => fs.statSync(n).isFile());
    for (const file of privateFiles) {
      assert.equal(fs.statSync(file).mode & 0o077, 0);
      const content = fs.readFileSync(file, "utf8");
      for (const marker of [env.ALPACA_KEY_ID, env.ALPACA_SECRET_KEY, "RAW_BODY_MARKER"]) assert.ok(!content.includes(marker));
    }
    const duplicate = await capturePrivateEvidence({ sourceDirectory: s.directory, sourceManifestSha256: pin, outputDirectory: output, approval: CAPTURE_APPROVAL, env, fetchImpl });
    assert.equal(duplicate.status, "CAPTURE_OUTPUT_ALREADY_EXISTS"); assert.equal(duplicate.requestCounts.total, 0);
  } else {
    assert.ok(!fs.existsSync(path.join(output, "complete")));
    if (expectedRequests > 0) {
      const duplicate = await capturePrivateEvidence({ sourceDirectory: s.directory, sourceManifestSha256: pin,
        outputDirectory: output, approval: CAPTURE_APPROVAL, env, fetchImpl });
      assert.equal(duplicate.status, "CAPTURE_OUTPUT_ALREADY_EXISTS"); assert.equal(duplicate.requestCounts.total, 0);
      assert.equal(calls.length, expectedRequests);
    }
  }
  if (expected !== "CAPTURE_SOURCE_CHANGED") assert.deepEqual(Object.fromEntries(fs.readdirSync(s.directory).map(n => [n, sha(fs.readFileSync(path.join(s.directory, n)))])), before);
  cases++;
  return result;
}
try {
  const first = await run();
  assert.equal((await run()).captureInputSha256, first.captureInputSha256);
  await run({ change: d => {
    const rows = d["order-ledger.json"].orders;
    rows["legacy-map-key"] = rows["private-key-0"]; delete rows["private-key-0"];
  } });
  await run({ config: { approval: "wrong" }, expected: "CAPTURE_APPROVAL_REQUIRED", expectedRequests: 0 });
  await run({ config: { env: { ...env, ALPACA_SECRET_KEY: "" } }, expected: "CAPTURE_CREDENTIALS_MISSING", expectedRequests: 0 });
  await run({ config: { env: { ...env, ALPACA_BASE_URL: "https://api.alpaca.markets" } }, expected: "CAPTURE_PAPER_ONLY_REQUIRED", expectedRequests: 0 });
  await run({ config: { env: { ...env, READ_ONLY: "false" } }, expected: "CAPTURE_SAFE_FLAGS_REQUIRED", expectedRequests: 0 });
  await run({ tamper: dir => fs.appendFileSync(path.join(dir, "order-ledger.json"), " "), expected: "PRIVATE_FILE_HASH_MISMATCH", expectedRequests: 0 });
  await run({ tamper: dir => fs.chmodSync(path.join(dir, "order-ledger.json"), 0o644), expected: "PRIVATE_INPUT_PERMISSIONS_INVALID", expectedRequests: 0 });
  await run({ change: d => { delete d["last-dry-exec-preview.json"]; }, expected: "CAPTURE_SOURCE_FILE_SET_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["order-ledger.json"].orders.extra = { ...Object.values(d["order-ledger.json"].orders)[0] }; }, expected: "PRIVATE_IDENTITY_AMBIGUOUS", expectedRequests: 0 });
  await run({ change: d => { d["order-idempotency.json"].orders["private-key-0"].clientOrderId = "wrong"; }, expected: "PRIVATE_IDENTITY_LINEAGE_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["last-dry-exec-preview.json"].payloads = [{}]; }, expected: "PRIVATE_SHADOW_CONTRACT_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["last-dry-exec-preview.json"].generatedAt = "2099-01-01T00:00:00Z"; }, expected: "CAPTURE_SOURCE_FUTURE_TIMESTAMP", expectedRequests: 0 });
  for (const filename of ["order-ledger.json", "order-idempotency.json"]) {
    await run({ change: d => { d[filename].orders["private-key-0"].updatedAt = "2099-01-01T00:00:00Z"; }, expected: "CAPTURE_SOURCE_FUTURE_TIMESTAMP", expectedRequests: 0 });
  }
  await run({ change: d => { d["order-ledger.json"].orders["private-key-0"].updatedAt = "invalid"; }, expected: "CAPTURE_SOURCE_TIMESTAMP_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["order-ledger.json"].orders["private-key-0"].updatedAt = "2026-01-01T10:00:00"; }, expected: "CAPTURE_SOURCE_TIMESTAMP_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["order-idempotency.json"].releases = [{ ...d["order-idempotency.json"].orders["private-key-0"], releasedAt: "2099-01-01T00:00:00Z" }]; },
    expected: "CAPTURE_SOURCE_FUTURE_TIMESTAMP", expectedRequests: 0 });
  await run({ change: d => { d["order-ledger.json"].orders.extra = { ...d["order-ledger.json"].orders["private-key-0"],
    idempotencyKey: "other-key", clientOrderId: "other-client", brokerOrderId: "other-broker" }; }, expected: "CAPTURE_REPORT_IDENTITY_AMBIGUOUS", expectedRequests: 0 });
  await run({ config: { sourceManifestSha256: "a".repeat(64) }, expected: "PRIVATE_FILE_HASH_MISMATCH", expectedRequests: 0 });
  await run({ tamper: dir => fs.chmodSync(dir, 0o755), expected: "PRIVATE_INPUT_PERMISSIONS_INVALID", expectedRequests: 0 });
  for (const status of [401, 403, 429, 500]) await run({ response: () => ({ status }), expected: "CAPTURE_BROKER_HTTP_FAILURE", expectedRequests: 1 });
  await run({ response: () => new Error("PRIVATE_SECRET_FIXTURE transport"), expected: "CAPTURE_BROKER_TRANSPORT_FAILURE", expectedRequests: 1 });
  await run({ response: ({ group }) => group === "/v2/account" ? { body: { id: "wrong-account" } } : null, expected: "CAPTURE_ACCOUNT_MISMATCH", expectedRequests: 1 });
  await run({ response: ({ group }) => group === "/v2/positions" ? { body: {} } : null, expected: "CAPTURE_BROKER_SCHEMA_INVALID", expectedRequests: 2 });
  await run({ response: ({ group, body }) => group === "/v2/positions" ? { body: [...body, body[0]] } : null, expected: "CAPTURE_BROKER_SCHEMA_INVALID", expectedRequests: 2 });
  await run({ response: ({ group, body }) => group === "/v2/positions" ? { body: [{ ...body[0], qty: "-1", side: "short" }] } : null, expected: "CAPTURE_UNSUPPORTED_SHORT_PROTECTION", expectedRequests: 2 });
  await run({ response: ({ group }) => group === "/v2/orders" ? { body: Array.from({ length: 500 }, () => ({})) } : null, expected: "CAPTURE_RESPONSE_LIMIT_REACHED", expectedRequests: 3 });
  await run({ response: ({ url }) => url.includes("status=closed") ? { body: Array.from({ length: 500 }, () => ({})) } : null, expected: "CAPTURE_RESPONSE_LIMIT_REACHED", expectedRequests: 4 });
  await run({ response: () => new Response("not JSON PRIVATE_SECRET_FIXTURE"), expected: "CAPTURE_BROKER_SCHEMA_INVALID", expectedRequests: 1 });
  await run({ response: () => new Response("x".repeat(8 * 1024 * 1024 + 1)), expected: "CAPTURE_RESPONSE_TOO_LARGE", expectedRequests: 1 });
  await run({ response: ({ group, body }) => group === "/v2/account" ? { body: { ...body, raw: "RAW_BODY_MARKER" } }
    : group === "/v2/clock" ? { body: { timestamp: now, is_open: false, next_open: "2099-01-01T00:00:00Z", raw: "RAW_BODY_MARKER" } } : null });
  await run({ response: ({ group, body }) => group === "/v2/positions" ? { body: [...body, { symbol: "FIXTURE_NEW", qty: "1", side: "long" }] } : null,
    expected: "CAPTURE_PREVIEW_PORTFOLIO_CHANGED" });
  await run({ response: ({ url }) => url.includes("status=open") ? { body: [{ id: "private-child", symbol: "FIXTURE_0", side: "sell", status: "new", type: "stop", stop_price: "80" }] } : null });
  await run({ response: ({ url }) => url.includes("status=open") ? { body: [{ id: "private-child", symbol: "FIXTURE_0", side: "sell", status: "new",
    legs: [{ id: "private-nested-child", symbol: "FIXTURE_0", side: "sell", status: "new", updated_at: "2099-01-01T00:00:00Z" }] }] } : null,
    expected: "CAPTURE_BROKER_FUTURE_TIMESTAMP", expectedRequests: 3 });
  await run({ response: ({ group }) => group === "/v2/clock" ? { body: { timestamp: "bad", is_open: true } } : null, expected: "CAPTURE_BROKER_SCHEMA_INVALID" });
  await run({ response: ({ group }) => group === "/v2/clock" ? { body: { timestamp: "2099-01-01T00:00:00Z", is_open: true } } : null, expected: "CAPTURE_BROKER_SCHEMA_INVALID" });
  await run({ response: ({ group, sourceDirectory }) => { if (group === "/v2/clock") fs.appendFileSync(path.join(sourceDirectory, "order-idempotency.json"), " "); }, expected: "CAPTURE_SOURCE_CHANGED" });
  console.log(JSON.stringify({ status: "PASS", cases, realBrokerRequests: 0, productionStateWrites: 0 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
