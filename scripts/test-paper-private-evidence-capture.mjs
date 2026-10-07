#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { capturePrivateEvidence, inspectCaptureSource, CAPTURE_APPROVAL } from "./capture-paper-private-evidence.mjs";
import { buildLiveSummary, buildPublicDashboard } from "./build-performance-dashboard.mjs";
import { auditPrivateCloseoutEvidence } from "./audit-paper-closeout-private-evidence.mjs";

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
  function persist(reviewOnly = false) {
    const files = {};
    for (const [n, v] of Object.entries(data)) {
      const bytes = JSON.stringify(v); fs.writeFileSync(path.join(directory, n), bytes, { mode: 0o600 }); files[n] = sha(bytes);
    }
    const manifest = { schemaVersion: reviewOnly ? "paper-private-capture-source-v2" : "paper-private-capture-source-v1", environment: "PAPER", sourceRunId: "12345",
      evidenceBasis: "PRESERVED_STATE_SNAPSHOT", expectedPaperAccountSha256: sha("private-account"), files };
    if (reviewOnly) manifest.sourceUsage = "HISTORICAL_CONTEXT_ONLY_NO_EXECUTION";
    const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(directory, "source-manifest.json"), bytes, { mode: 0o600 });
    return sha(bytes);
  }
  return { directory, data, persist };
}
let cases = 0;
async function run({ change = () => {}, tamper = () => {}, response = () => {}, inspect = () => {}, config = {}, reviewOnly = false, expected = null, expectedRequests = 5 } = {}) {
  const s = source();
  if (reviewOnly) s.data["performance-dashboard.json"] = { generatedAt: originalAt,
    live: { positions: Object.values(s.data["order-ledger.json"].orders).map(r => ({ symbol: r.symbol, qty: 1 })) } };
  change(s.data); const pin = s.persist(reviewOnly); tamper(s.directory);
  const before = Object.fromEntries(fs.readdirSync(s.directory).map(n => [n, sha(fs.readFileSync(path.join(s.directory, n)))]));
  const output = path.join(root, `capture-${cases}`), calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.equal(new URL(url).origin, env.ALPACA_BASE_URL); calls.push(new URL(url).pathname + new URL(url).search);
    const group = new URL(url).pathname;
    let body = group === "/v2/account" ? { id: "private-account", account_number: "ACCOUNT_FIXTURE", status: "ACTIVE" }
      : group === "/v2/clock" ? { timestamp: now, is_open: true }
      : group === "/v2/positions" ? [...new Set(Object.values(s.data["order-ledger.json"].orders).map(r => r.symbol))].map(symbol => ({ symbol, qty: "1", side: "long", current_price: "100", avg_entry_price: "90" })) : [];
    const override = response({ url, group, body, calls, sourceDirectory: s.directory });
    if (override instanceof Error) throw override;
    if (override instanceof Response) return override;
    if (override?.body !== undefined) body = override.body;
    return new Response(JSON.stringify(body), { status: override?.status || 200 });
  };
  const result = await capturePrivateEvidence({ sourceDirectory: s.directory, sourceManifestSha256: pin, outputDirectory: output,
    approval: CAPTURE_APPROVAL, env, fetchImpl, now: () => new Date(now), ...config });
  assert.equal(result.status, expected || (reviewOnly ? "PAPER_PRIVATE_CAPTURE_REVIEW_ONLY_COMPLETE" : "PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED"));
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
    for (const n of Object.keys(s.data)) assert.equal(sha(fs.readFileSync(path.join(input, ...(reviewOnly ? ["preserved-source", n] : [n])))), before[n]);
    assert.equal(result.inputAuditStatus, reviewOnly ? "PRIVATE_OBSERVATION_REVIEW_VALID_EXECUTION_NOT_EVALUATED" : "PRIVATE_EVIDENCE_CONTRACT_VALID_CURRENT_PROOF_REQUIRED");
    if (reviewOnly) {
      assert.equal(result.executionReadinessEvaluated, false);
      assert.equal(result.historicalPayloadRows, s.data["last-dry-exec-preview.json"].payloads.length);
      assert.equal(sha(fs.readFileSync(path.join(input, "preserved-source", "source-manifest.json"))), pin);
      const work = path.join(output, "private-work");
      for (const n of ["last-dry-exec-preview.json", "fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json"]) {
        assert.equal(fs.existsSync(path.join(work, n)), false);
      }
      assert.equal(sha(fs.readFileSync(path.join(input, "last-dry-exec-preview.json"))), before["last-dry-exec-preview.json"]);
    }
    const dashboard = JSON.parse(fs.readFileSync(path.join(input, "performance-dashboard.json")));
    const protection = JSON.parse(fs.readFileSync(path.join(input, "position-protection-root-cause-audit.json")));
    const orderState = JSON.parse(fs.readFileSync(path.join(input, "order-state-consistency-report.json")));
    for (const target of manifest.targets) {
      const ledger = s.data["order-ledger.json"].orders[target.ledgerKey];
      assert.equal(dashboard.live.positions.find(p => p.symbol === ledger.symbol)?.plannedLedgerKey, target.ledgerKey);
      assert.equal(protection.rows.find(p => p.symbol === ledger.symbol)?.plannedLedgerKey, target.ledgerKey);
      assert.equal(orderState.rows.find(p => p.symbol === ledger.symbol)?.ledger, ledger.status);
    }
    assert.ok(!JSON.stringify(buildPublicDashboard(dashboard)).includes("private-key"));
    inspect({ dashboard, protection, orderState, input, output });
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
  const historicalContext = d => {
    d["last-dry-exec-preview.json"].payloads = [{ symbol: "PRIVATE_PAYLOAD_MARKER", actionType: "EXIT_FULL" }];
    for (const name of ["fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json"]) {
      d[name] = { rows: [{ symbol: "FIXTURE_0", status: "filled", stopPrice: 99999, originalMarker: "HISTORICAL_ONLY" }] };
    }
  };
  await run({ reviewOnly: true, change: historicalContext, inspect: ({ dashboard, protection, orderState, input }) => {
    for (const report of [dashboard, protection, orderState]) {
      assert.ok(!JSON.stringify(report).includes("HISTORICAL_ONLY"));
      assert.ok(!JSON.stringify(report).includes("PRIVATE_PAYLOAD_MARKER"));
    }
    assert.equal(protection.rows[0].brokerStopPresent, false);
    assert.equal(protection.rows[0].brokerTargetPresent, false);
    const manifest = JSON.parse(fs.readFileSync(path.join(input, "manifest.json")));
    const audit = auditPrivateCloseoutEvidence(input, sha(fs.readFileSync(path.join(input, "manifest.json"))));
    assert.equal(audit.status, "PRIVATE_OBSERVATION_REVIEW_VALID_EXECUTION_NOT_EVALUATED");
    assert.equal(audit.selectedCandidateCount, 0);
    assert.equal(audit.executionReadinessEvaluated, false);
    // V1 cannot silently acquire review-only semantics from the same seven files.
    manifest.schemaVersion = "paper-closeout-private-evidence-v1";
    const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(input, "manifest.json"), bytes);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(bytes)), /PRIVATE_SHADOW_CONTRACT_INVALID/);
  } });
  await run({ reviewOnly: true, inspect: ({ input }) => {
    const read = file => JSON.parse(fs.readFileSync(file));
    const write = (file, value) => { const bytes = JSON.stringify(value); fs.writeFileSync(file, bytes); return sha(bytes); };
    const manifestPath = path.join(input, "manifest.json"), manifest = read(manifestPath);
    const removed = manifest.targets.pop();
    const ledger = read(path.join(input, "order-ledger.json"));
    const symbol = ledger.orders[removed.ledgerKey].symbol;
    // A complete, hash-consistent four-identity package must still fail the v2 five-row boundary.
    const trim = value => {
      if (value.orders) { delete value.orders[removed.ledgerKey]; delete value.orders[removed.idempotencyKey]; }
      if (value.rows) value.rows = value.rows.filter(r => r.symbol !== symbol);
      if (value.live?.positions) value.live.positions = value.live.positions.filter(r => r.symbol !== symbol);
      if (value.privateCaptureTargets) value.privateCaptureTargets = manifest.targets;
      if (value.paperExitShadowIntent) {
        const shadow = value.paperExitShadowIntent;
        shadow.rows = shadow.rows.filter(r => r.symbol !== symbol);
        shadow.evaluatedPositionRows--; shadow.exitFullDueRows--;
      }
      return value;
    };
    for (const name of Object.keys(manifest.files)) {
      const file = path.join(input, name); manifest.files[name] = write(file, trim(read(file)));
    }
    const archive = path.join(input, "preserved-source"), sourcePath = path.join(archive, "source-manifest.json"), source = read(sourcePath);
    for (const name of Object.keys(source.files)) {
      const file = path.join(archive, name); source.files[name] = write(file, trim(read(file)));
    }
    manifest.sourceManifestSha256 = write(sourcePath, source);
    const pin = write(manifestPath, manifest);
    assert.throws(() => auditPrivateCloseoutEvidence(input, pin), /CAPTURE_TARGET_COUNT_INVALID/);
  } });
  for (const [name, field] of [
    ["position-protection-root-cause-audit.json", "fillability"],
    ["position-protection-root-cause-audit.json", "preview"],
    ["position-protection-root-cause-audit.json", "positionLifecycleGuardSourcePlan"],
    ["order-state-consistency-report.json", "fillability"],
    ["broker-child-order-reconciliation.json", "positionLifecycleGuardSourcePlan"],
  ]) for (const declared of [true, undefined]) await run({ reviewOnly: true, inspect: ({ input }) => {
    const file = path.join(input, name), report = JSON.parse(fs.readFileSync(file));
    report.files[field] = declared;
    const bytes = JSON.stringify(report); fs.writeFileSync(file, bytes);
    const manifestPath = path.join(input, "manifest.json"), manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.files[name] = sha(bytes);
    const manifestBytes = JSON.stringify(manifest); fs.writeFileSync(manifestPath, manifestBytes);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(manifestBytes)), /PRIVATE_REVIEW_ISOLATION_INVALID/);
  } });
  for (const [name, field] of [
    ["position-protection-root-cause-audit.json", "lifecycleGuardSourceOverall"],
    ["position-protection-root-cause-audit.json", "stage6File"],
    ["position-protection-root-cause-audit.json", "stage6Hash"],
    ["broker-child-order-reconciliation.json", "lifecycleGuardSourceOverall"],
  ]) for (const declared of ["HISTORICAL_SOURCE_MARKER", undefined]) await run({ reviewOnly: true, inspect: ({ input }) => {
    const file = path.join(input, name), report = JSON.parse(fs.readFileSync(file));
    report.source[field] = declared;
    const bytes = JSON.stringify(report); fs.writeFileSync(file, bytes);
    const manifestPath = path.join(input, "manifest.json"), manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.files[name] = sha(bytes);
    const manifestBytes = JSON.stringify(manifest); fs.writeFileSync(manifestPath, manifestBytes);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(manifestBytes)), /PRIVATE_REVIEW_ISOLATION_INVALID/);
  } });
  await run({ reviewOnly: true, change: d => { delete d["performance-dashboard.json"]; }, expected: "CAPTURE_SOURCE_FILE_SET_INVALID", expectedRequests: 0 });
  await run({ reviewOnly: true, change: d => {
    d["performance-dashboard.json"].live.positions.pop();
    const shadow = d["last-dry-exec-preview.json"].paperExitShadowIntent;
    shadow.rows.pop(); shadow.evaluatedPositionRows--; shadow.exitFullDueRows--;
  }, expected: "PRIVATE_SCOPED_POSITION_MISSING", expectedRequests: 0 });
  for (const change of [
    d => { d["performance-dashboard.json"].live.positions[0].qty = null; },
    d => { d["performance-dashboard.json"].live.positions[0].qty = -1; },
    d => { d["performance-dashboard.json"].live.positions.pop(); },
  ]) await run({ reviewOnly: true, change, expected: "CAPTURE_BASELINE_PORTFOLIO_INVALID", expectedRequests: 0 });
  await run({ reviewOnly: true, change: d => { d["last-dry-exec-preview.json"].mode.execEnabled = true; }, expected: "PRIVATE_SHADOW_CONTRACT_INVALID", expectedRequests: 0 });
  await run({ reviewOnly: true, change: d => { d["last-dry-exec-preview.json"].paperExitShadowIntent.brokerMutationSubmitted = true; }, expected: "PRIVATE_SHADOW_CONTRACT_INVALID", expectedRequests: 0 });
  await run({ reviewOnly: true, change: d => { d["order-idempotency.json"].orders["private-key-0"].entryAllowed = true; }, expected: "LIMITED_CONTROL_CONTRACT_INVALID", expectedRequests: 0 });
  await run({ reviewOnly: true, change: d => { d["performance-dashboard.json"].generatedAt = "2099-01-01T00:00:00Z"; }, expected: "CAPTURE_SOURCE_FUTURE_TIMESTAMP", expectedRequests: 0 });
  await run({ reviewOnly: true, config: { env: { ...env, ALPACA_KEY_ID: "" } }, expected: "CAPTURE_CREDENTIALS_MISSING", expectedRequests: 0 });
  await run({ reviewOnly: true, config: { env: { ...env, ALPACA_BASE_URL: "https://api.alpaca.markets" } }, expected: "CAPTURE_PAPER_ONLY_REQUIRED", expectedRequests: 0 });
  await run({ reviewOnly: true, response: ({ group }) => group === "/v2/account" ? { body: { id: "mismatch" } } : null, expected: "CAPTURE_ACCOUNT_MISMATCH", expectedRequests: 1 });
  await run({ reviewOnly: true, response: ({ group, body }) => group === "/v2/positions" ? { body: body.map(p => ({ ...p, qty: "2" })) } : null,
    expected: "CAPTURE_PREVIEW_PORTFOLIO_CHANGED", expectedRequests: 2 });
  await run({ reviewOnly: true, response: ({ group, body }) => group === "/v2/positions" ? { body: body.slice(1) } : null,
    expected: "CAPTURE_PREVIEW_PORTFOLIO_CHANGED", expectedRequests: 2 });
  await run({ change: d => { d["last-dry-exec-preview.json"].payloads = [{ actionType: "ENTRY_NEW" }]; }, expected: "PRIVATE_SHADOW_CONTRACT_INVALID", expectedRequests: 0 });
  const reviewBaseline = await run({ reviewOnly: true, change: historicalContext });
  assert.equal((await run({ reviewOnly: true, change: historicalContext })).captureInputSha256, reviewBaseline.captureInputSha256);
  await run({ reviewOnly: true, change: historicalContext, inspect: ({ input }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(input, "manifest.json")));
    const pin = sha(fs.readFileSync(path.join(input, "manifest.json")));
    fs.appendFileSync(path.join(input, "preserved-source", "fill-state-reconciliation-audit.json"), " ");
    assert.throws(() => auditPrivateCloseoutEvidence(input, pin), /PRIVATE_FILE_HASH_MISMATCH/);
    assert.equal(manifest.sourceUsage, "HISTORICAL_CONTEXT_ONLY_NO_EXECUTION");
  } });
  for (const mutate of [
    d => { d.sourceUsage = "EXECUTION_READY"; },
    d => { d.realizedPnl = { verified: true }; },
  ]) await run({ reviewOnly: true, inspect: ({ input, dashboard }) => {
    mutate(dashboard);
    const mf = path.join(input, "manifest.json"), manifest = JSON.parse(fs.readFileSync(mf));
    const bytes = JSON.stringify(dashboard); fs.writeFileSync(path.join(input, "performance-dashboard.json"), bytes);
    manifest.files["performance-dashboard.json"] = sha(bytes);
    const mb = JSON.stringify(manifest); fs.writeFileSync(mf, mb);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(mb)), /PRIVATE_REVIEW_ISOLATION_INVALID/);
  } });
  const preflightFixture = source();
  preflightFixture.data["performance-dashboard.json"] = { generatedAt: originalAt, live: {
    positions: Object.values(preflightFixture.data["order-ledger.json"].orders).map(r => ({ symbol: r.symbol, qty: 1 })) } };
  historicalContext(preflightFixture.data);
  const preflightPin = preflightFixture.persist(true);
  const beforePreflight = fs.readdirSync(preflightFixture.directory).map(n => [n, sha(fs.readFileSync(path.join(preflightFixture.directory, n)))]);
  const offline = inspectCaptureSource(preflightFixture.directory, preflightPin, () => new Date(now));
  assert.equal(offline.status, "PAPER_PRIVATE_CAPTURE_SOURCE_PREFLIGHT_PASS");
  assert.equal(offline.credentialsRead, false); assert.equal(offline.brokerRequests, 0);
  assert.deepEqual(inspectCaptureSource(preflightFixture.directory, preflightPin, () => new Date(now)), offline);
  const cli = spawnSync(process.execPath, ["scripts/capture-paper-private-evidence.mjs", "--preflight", preflightFixture.directory, preflightPin],
    { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(cli.status, 0); assert.equal(cli.stderr, "");
  assert.deepEqual(JSON.parse(cli.stdout), offline);
  for (const marker of ["PRIVATE_PAYLOAD_MARKER", "HISTORICAL_ONLY", "FIXTURE_", "private-key"]) assert.ok(!cli.stdout.includes(marker));
  assert.deepEqual(fs.readdirSync(preflightFixture.directory).map(n => [n, sha(fs.readFileSync(path.join(preflightFixture.directory, n)))]), beforePreflight);
  assert.equal(inspectCaptureSource(preflightFixture.directory, "0".repeat(64)).status, "PRIVATE_FILE_HASH_MISMATCH");
  cases++;
  const first = await run({ inspect: ({ dashboard, input }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(input, "manifest.json")));
    dashboard.live.positions[0].plannedLedgerKey = "different-private-key";
    const bytes = JSON.stringify(dashboard);
    fs.writeFileSync(path.join(input, "performance-dashboard.json"), bytes);
    manifest.files["performance-dashboard.json"] = sha(bytes);
    const manifestBytes = JSON.stringify(manifest); fs.writeFileSync(path.join(input, "manifest.json"), manifestBytes);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(manifestBytes)), /PRIVATE_REPORT_TARGET_MISMATCH/);
  } });
  assert.equal((await run()).captureInputSha256, first.captureInputSha256);
  for (const releaseOnly of [false, true]) await run({ inspect: ({ input }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(input, "manifest.json")));
    const file = "order-idempotency.json";
    const idem = JSON.parse(fs.readFileSync(path.join(input, file)));
    if (releaseOnly) idem.releases.push({ symbol: "FIXTURE_0", brokerOrderId: "unverified-broker", releasedAt: now });
    else idem.orders["conflicting-map-key"] = { symbol: "FIXTURE_0", idempotencyKey: "private-key-0", clientOrderId: "conflicting-client" };
    const bytes = JSON.stringify(idem); fs.writeFileSync(path.join(input, file), bytes); manifest.files[file] = sha(bytes);
    const manifestBytes = JSON.stringify(manifest); fs.writeFileSync(path.join(input, "manifest.json"), manifestBytes);
    assert.throws(() => auditPrivateCloseoutEvidence(input, sha(manifestBytes)),
      releaseOnly ? /PRIVATE_REPORT_IDENTITY_UNVERIFIED/ : /PRIVATE_IDENTITY_AMBIGUOUS/);
  } });
  await run({ change: d => {
    const rows = d["order-ledger.json"].orders;
    rows["legacy-map-key"] = rows["private-key-0"]; delete rows["private-key-0"];
  } });
  const baseline = source(); baseline.persist();
  const read = async route => ({ ok: true, data: route === "/v2/account" ? {}
    : route === "/v2/positions" ? [{ symbol: "FIXTURE_0", qty: "1", side: "long" }] : [] });
  const state = { ledger: baseline.data["order-ledger.json"], idempotency: baseline.data["order-idempotency.json"], fillability: {} };
  assert.deepEqual(await buildLiveSummary(read, state), await buildLiveSummary(read, { ...state, privateCaptureTargets: undefined }));
  cases++;
  await run({ change: d => {
    const extra = { ...d["order-ledger.json"].orders["private-key-1"], symbol: "FIXTURE_UNSCOPED",
      idempotencyKey: "unscoped-key", clientOrderId: "unscoped-client", brokerOrderId: "unscoped-broker" };
    d["order-ledger.json"].orders.unscoped = extra;
    d["order-idempotency.json"].orders["unscoped-key"] = extra;
    const shadow = d["last-dry-exec-preview.json"].paperExitShadowIntent;
    shadow.rows.push({ symbol: extra.symbol, evaluationStatus: "EVALUATED", actionType: "EXIT_FULL", stage6File: extra.stage6File, stage6Hash: extra.stage6Hash });
    shadow.evaluatedPositionRows++; shadow.exitFullDueRows++;
  }, inspect: ({ dashboard, protection, orderState }) => {
    assert.equal(dashboard.live.positions.length, 6); assert.equal(protection.rows.length, 6); assert.equal(orderState.rows.length, 6);
    assert.equal(dashboard.live.positions.find(r => r.symbol === "FIXTURE_UNSCOPED").plannedLedgerKey, "unscoped");
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
  for (const reverse of [false, true]) await run({ change: d => {
    const ledger = d["order-ledger.json"].orders;
    const historical = { ...ledger["private-key-0"], idempotencyKey: "other-key", clientOrderId: "other-client",
      brokerOrderId: "other-broker", status: "canceled", updatedAt: now, stage6Hash: "c".repeat(64) };
    d["order-ledger.json"].orders = reverse ? { extra: historical, ...ledger } : { ...ledger, extra: historical };
    d["order-idempotency.json"].orders["other-key"] = { ...historical, brokerStatus: "canceled" };
    d["order-idempotency.json"].releases.push({ ...historical, key: "other-key", releasedAt: now, brokerStatus: "canceled" });
  }, inspect: ({ dashboard, orderState }) => {
    assert.equal(dashboard.live.positions[0].plannedStage6Hash, "a".repeat(64));
    assert.notEqual(orderState.rows[0].idempotency, "canceled");
  } });
  await run({ change: d => { d["order-idempotency.json"].releases.push({ ...d["order-idempotency.json"].orders["private-key-0"],
    key: "private-key-0", releasedAt: now, brokerStatus: "canceled" }); }, inspect: ({ orderState }) => {
    assert.equal(orderState.rows[0].category, "TERMINAL_CONFLICT");
  } });
  for (const equalTime of [false, true]) for (const reverse of [false, true]) await run({ change: d => {
    const original = d["order-idempotency.json"].orders["private-key-0"];
    const releases = [
      { ...original, key: "private-key-0", releasedAt: equalTime ? now : originalAt, brokerStatus: "canceled" },
      { ...original, key: "private-key-0", releasedAt: now, brokerStatus: "filled" }
    ];
    d["order-idempotency.json"].releases.push(...(reverse ? releases.reverse() : releases));
  }, inspect: ({ orderState }) => {
    assert.equal(orderState.rows[0].category, "TERMINAL_CONFLICT");
    assert.equal(orderState.rows[0].status, "FAIL");
  } });
  await run({ change: d => { d["order-idempotency.json"].releases.push({ symbol: "FIXTURE_0", releasedAt: now }); },
    expected: "PRIVATE_REPORT_IDENTITY_UNVERIFIED", expectedRequests: 0 });
  await run({ change: d => { d["order-ledger.json"].orders.unbound = { symbol: "FIXTURE_0", status: "filled" }; },
    expected: "PRIVATE_REPORT_IDENTITY_UNVERIFIED", expectedRequests: 0 });
  await run({ change: d => { delete d["order-ledger.json"].orders["private-key-4"]; delete d["order-idempotency.json"].orders["private-key-4"]; },
    expected: "CAPTURE_TARGET_COUNT_INVALID", expectedRequests: 0 });
  await run({ change: d => { d["order-idempotency.json"].releases.push({ ...d["order-idempotency.json"].orders["private-key-0"],
    key: "private-key-0", clientOrderId: "conflicting-client", releasedAt: now }); },
    expected: "PRIVATE_REPORT_IDENTITY_CONFLICT", expectedRequests: 0 });
  for (const symbol of ["FIXTURE_0", "FIXTURE_OTHER"]) await run({ change: d => {
    d["order-idempotency.json"].orders["conflicting-map-key"] = { symbol, idempotencyKey: "private-key-0",
      clientOrderId: "conflicting-client", brokerStatus: "canceled", updatedAt: now };
  }, expected: "PRIVATE_IDENTITY_AMBIGUOUS", expectedRequests: 0 });
  await run({ change: d => { d["order-idempotency.json"].releases.push({ symbol: "FIXTURE_0",
    brokerOrderId: "unverified-broker", releasedAt: now, brokerStatus: "canceled" }); },
    expected: "PRIVATE_REPORT_IDENTITY_UNVERIFIED", expectedRequests: 0 });
  await run({ change: d => { d["order-idempotency.json"].releases.push({ symbol: "FIXTURE_1",
    brokerOrderId: "distinct-broker", releasedAt: now, brokerStatus: "canceled" }); } });
  for (const name of ["fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json"]) {
    await run({ change: d => { d[name] = { rows: [{ symbol: "FIXTURE_0", status: "filled" }] }; },
      expected: "PRIVATE_REPORT_IDENTITY_UNVERIFIED", expectedRequests: 0 });
  }
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
