import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { auditPrivateCloseoutEvidence } from "./audit-paper-closeout-private-evidence.mjs";
import { sha256Canonical } from "./lib/active-position-limited-recovery.mjs";

// Invoked by the mock-capture suite with its synthetic, fully pinned v2 bundle.
export function checkCloseoutApprovalBoundary({ input }) {
  const digest = v => createHash("sha256").update(v).digest("hex");
  const bytes = fs.readFileSync(path.join(input, "manifest.json"));
  const manifest = JSON.parse(bytes), pin = digest(bytes);
  const scope = { schemaVersion: "paper-limited-control-closeout-terms-v1", environment: "PAPER",
    manifestSha256: pin, accountSha256: digest("private-account"),
    riskLimits: { maxOrderNotional: 110, maxTotalNotional: 550, maxSpreadBps: 10, maxSlippageBps: 10, maxEvidenceAgeSeconds: 30 },
    targets: manifest.targets.map((t, n) => ({ ...t, action: "EXIT_FULL", executionSide: "sell", quantity: 1,
      exitIdempotencyKey: `fixture-boundary-exit-${n}` })) };
  const at = seconds => new Date(Date.parse("2026-01-05T15:00:00.000Z") + seconds * 1000).toISOString();
  const termsSha256 = sha256Canonical(scope);
  const state = { orderLedgerSha256: manifest.files["order-ledger.json"], orderIdempotencySha256: manifest.files["order-idempotency.json"] };
  const scenario = { schemaVersion: "paper-limited-closeout-boundary-simulation-v1", evidenceBasis: "SYNTHETIC_OFFLINE_SCENARIO",
    termsSha256, accountSha256: scope.accountSha256, ...state,
    orderContract: { type: "limit", timeInForce: "day", extendedHours: false, retry: false, cancel: false, replace: false },
    approval: { scope: "OFFLINE_CONFORMANCE_ONLY", termsSha256, accountSha256: scope.accountSha256,
      expiresAt: at(30), originalHistoryAdopted: false },
    rows: scope.targets.map((target, n) => {
      const orderSha256 = digest(`fixture-order-${n}`);
      return { exitIdempotencyKey: target.exitIdempotencyKey, currentQuantity: 1, bid: 100, ask: 100.05,
        bidSizeShares: 10, priceTick: 0.01, quantityIncrement: 1, limitPrice: 99.9, reviewedAt: at(n * 5), receivedAt: at(0),
        sourceContract: { evidenceSha256: digest(`source-${n}`), feedSha256: digest("synthetic-feed"), quoteSizeUnit: "SHARES",
          priceIncrementVerified: true, assetTradable: true, accountTradingAllowed: true, limitDaySupported: true,
          openOrdersComplete: true, protectiveChildrenComplete: true },
        evidenceAsOf: Object.fromEntries(["account", "position", "orders", "clock", "quote", "state"].map(k => [k, at(0)])),
        sessionOpenAt: "2026-01-05T14:30:00.000Z", sessionCloseAt: "2026-01-05T21:00:00.000Z",
        rthOpen: true, identityMatched: true, accountMatched: true, terminalConflict: false, idempotencyConflict: false,
        openOrderCount: 0, protectiveChildCount: 0,
        events: [
          { type: "RESERVED", at: at(n * 5), termsSha256, ...state, durable: true },
          { type: "ATTEMPT_RECORDED", at: at(n * 5 + 1), durable: true },
          { type: "ACCEPTED", at: at(n * 5 + 2), orderSha256, filledQuantity: 0 },
          { type: "FILLED", at: at(n * 5 + 3), orderSha256, filledQuantity: 1 },
          { type: "POST_VERIFY", at: at(n * 5 + 4), orderSha256, positionQuantity: 0, openOrderCount: 0, protectiveChildCount: 0 },
        ] };
    }) };
  const review = (s = scenario, terms = scope, options = {}) => auditPrivateCloseoutEvidence(input, pin,
    { limitedControlDryRun: true, scope: terms, approvalBoundary: s, ...options });
  const unchanged = fs.readdirSync(input).filter(n => fs.statSync(path.join(input, n)).isFile())
    .map(n => [n, digest(fs.readFileSync(path.join(input, n)))]);
  const valid = review();
  assert.equal(valid.status, "LIMITED_CLOSEOUT_OFFLINE_CONFORMANCE_PASS_EXECUTION_NOT_AUTHORIZED");
  assert.equal(valid.simulatedAttemptRows, 5);
  assert.equal(valid.simulatedFlatRows, 5);
  assert.equal(valid.simulatedAcceptedRows, 5);
  assert.equal(valid.simulatedFilledRows, 5);
  assert.equal(valid.boundaryScenarioSha256, sha256Canonical(scenario));
  for (const k of ["executionAuthorized", "brokerSubmitAllowed", "currentBrokerEvidenceVerified", "currentStateAuthenticityVerified",
    "realizedPnlVerified", "historicalEvidenceNormalized", "wouldCreateBrokerPayload", "stateMutationAttempted"])
    assert.equal(valid[k], false);
  for (const k of ["selectedCandidateCount", "brokerRequestCount", "brokerPayloadsGenerated", "exitIdempotencyReservationsCreated", "unknownOrUnclassifiedRows"])
    assert.equal(valid[k], 0);
  assert.deepEqual(review(), valid);
  let cases = 1;
  const bad = (change, code = "LIMITED_CLOSEOUT_BOUNDARY_INVALID") => {
    const s = structuredClone(scenario); change(s);
    assert.throws(() => review(s), e => e.message === code); cases++;
  };
  for (const field of ["termsSha256", "accountSha256", "orderLedgerSha256", "orderIdempotencySha256"])
    bad(s => { s[field] = "f".repeat(64); });
  bad(s => { s.evidenceBasis = "CURRENT_BROKER_PROOF"; });
  bad(s => { s.orderContract.type = "market"; });
  bad(s => { s.orderContract.timeInForce = "gtc"; });
  for (const key of ["extendedHours", "retry", "cancel", "replace"]) bad(s => { s.orderContract[key] = true; });
  for (const key of ["priceIncrementVerified", "assetTradable", "accountTradingAllowed", "limitDaySupported", "openOrdersComplete", "protectiveChildrenComplete"])
    bad(s => { s.rows[0].sourceContract[key] = false; });
  bad(s => { s.rows[0].sourceContract.quoteSizeUnit = "LOTS"; });
  bad(s => { s.rows[0].sourceContract.feedSha256 = null; });
  bad(s => { s.rows[0].quantityIncrement = 0.3; });
  bad(s => { s.approval.scope = "EXECUTE"; });
  bad(s => { s.approval.originalHistoryAdopted = true; });
  bad(s => { s.approval.termsSha256 = "f".repeat(64); });
  bad(s => { s.approval.accountSha256 = "f".repeat(64); });
  bad(s => { s.approval.expiresAt = at(0); });
  bad(s => { s.rows.pop(); });
  bad(s => { s.rows[4] = structuredClone(s.rows[0]); });
  bad(s => { s.rows[0].exitIdempotencyKey = "symbol-only"; });
  bad(s => { s.rows[0].currentQuantity = 2; });
  for (const field of ["rthOpen", "identityMatched", "accountMatched"]) bad(s => { s.rows[0][field] = false; });
  for (const field of ["terminalConflict", "idempotencyConflict"]) bad(s => { s.rows[0][field] = true; });
  for (const field of ["openOrderCount", "protectiveChildCount"]) bad(s => { s.rows[0][field] = 1; });
  bad(s => { s.rows[0].openOrderCount = null; });
  for (const field of Object.keys(scenario.rows[0].evidenceAsOf)) {
    bad(s => { s.rows[0].evidenceAsOf[field] = at(-31); });
    bad(s => { delete s.rows[0].evidenceAsOf[field]; });
    bad(s => { s.rows[0].evidenceAsOf[field] = at(1); });
  }
  bad(s => { s.rows[0].receivedAt = at(1); });
  bad(s => { s.rows[0].sessionCloseAt = at(1); }); // Submit must still be inside RTH.
  bad(s => { s.rows[0].sessionOpenAt = at(1); });
  bad(s => { s.rows[0].evidenceAsOf.quote = "2026-02-30T15:00:00.000Z"; });
  bad(s => { s.rows[0].ask = 100.2; });
  bad(s => { s.rows[0].ask = 99; });
  bad(s => { s.rows[0].bidSizeShares = 0.99; });
  bad(s => { s.rows[0].limitPrice = 99.89; });
  bad(s => { s.rows[0].limitPrice = 99.905; });
  bad(s => { s.rows[0].limitPrice = 100.01; });
  bad(s => { s.rows[0].priceTick = 0; });
  bad(s => { s.rows[0].bid = Infinity; });
  bad(s => { Object.assign(s.rows[0], { bid: 111, ask: 111.01, limitPrice: 110.9 }); });
  bad(s => { s.rows[0].events[0].orderIdempotencySha256 = "f".repeat(64); });
  bad(s => { s.rows[0].events[0].durable = false; });
  bad(s => { s.rows[0].events[1].durable = false; });
  bad(s => { s.rows[0].events.shift(); });
  bad(s => { s.rows[0].events.splice(2, 0, structuredClone(s.rows[0].events[1])); });
  bad(s => { s.rows[0].events[1].at = at(31); });
  bad(s => { s.rows[1].reviewedAt = at(0); }); // No overlapping attempts.
  bad(s => { s.rows[0].events[3].filledQuantity = 1.1; });
  bad(s => { s.rows[0].events[3].orderSha256 = "f".repeat(64); });
  bad(s => { for (const e of s.rows[1].events) if (e.orderSha256) e.orderSha256 = s.rows[0].events[2].orderSha256; });
  bad(s => { s.rows[0].events[4].positionQuantity = -1; });
  bad(s => { s.rows[0].events[2].type = "UNCLASSIFIED"; });
  bad(s => { s.rows[0].events[2].rawResponse = "PRIVATE"; });
  const stop = (events, inspect = () => {}) => {
    const s = structuredClone(scenario); s.rows[0].events = events;
    for (const row of s.rows.slice(1)) row.events = [];
    const result = review(s);
    assert.equal(result.status, "LIMITED_CLOSEOUT_OFFLINE_STOP_RECONCILIATION_REQUIRED");
    assert.ok(result.simulatedAttemptRows <= 1); assert.equal(result.simulatedFlatRows, 0);
    inspect(result); cases++;
    s.rows[1].events = scenario.rows[1].events;
    assert.throws(() => review(s), /LIMITED_CLOSEOUT_BOUNDARY_INVALID/); cases++;
  };
  stop([]); stop(scenario.rows[0].events.slice(0, 1)); stop(scenario.rows[0].events.slice(0, 2));
  stop(scenario.rows[0].events.slice(0, 3), r => assert.equal(r.simulatedAcceptedRows, 1));
  stop(scenario.rows[0].events.slice(0, 4), r => assert.equal(r.simulatedFilledRows, 1));
  for (const type of ["UNCERTAIN", "TIMEOUT", "HTTP_FAILURE", "REDIRECT_REJECTED", "REJECTED", "CANCELED", "EXPIRED"])
    stop([...scenario.rows[0].events.slice(0, 2), { type, at: at(2) }]);
  for (const type of ["UNCERTAIN", "TIMEOUT", "HTTP_FAILURE", "REDIRECT_REJECTED"])
    stop([...scenario.rows[0].events.slice(0, 4), { type, at: at(4) }], r => {
      assert.equal(r.simulatedAcceptedRows, 1); assert.equal(r.simulatedFilledRows, 1);
    });
  stop([...scenario.rows[0].events.slice(0, 3), { ...scenario.rows[0].events[3], type: "PARTIALLY_FILLED", filledQuantity: 0.5 }],
    r => assert.equal(r.simulatedPartialFillRows, 1));
  for (const [field, value] of [["positionQuantity", 0.5], ["openOrderCount", 1], ["protectiveChildCount", 1]]) {
    const events = structuredClone(scenario.rows[0].events); events[4][field] = value; stop(events);
  }
  assert.throws(() => review(scenario, scope, { limitedControlDryRun: false }), /LIMITED_CLOSEOUT_BOUNDARY_MODE_REQUIRED/); cases++;
  assert.throws(() => review(scenario, undefined, { scope: undefined }), /LIMITED_CLOSEOUT_BOUNDARY_TERMS_REQUIRED/); cases++;
  const partial = structuredClone(scope); partial.targets[0].action = "EXIT_PARTIAL"; partial.targets[0].quantity = 0.5;
  assert.throws(() => review(scenario, partial), /LIMITED_CLOSEOUT_BOUNDARY_FULL_EXIT_REQUIRED/); cases++;
  const totalCapped = structuredClone(scope); totalCapped.riskLimits.maxTotalNotional = 500;
  const cappedScenario = structuredClone(scenario); cappedScenario.termsSha256 = cappedScenario.approval.termsSha256 = sha256Canonical(totalCapped);
  for (const row of cappedScenario.rows) row.events[0].termsSha256 = cappedScenario.termsSha256;
  assert.throws(() => review(cappedScenario, totalCapped), /LIMITED_CLOSEOUT_BOUNDARY_INVALID/); cases++;
  const exactFloor = structuredClone(scenario);
  Object.assign(exactFloor.rows[0], { bid: 100.01, ask: 100.02, limitPrice: 99.91 });
  assert.equal(review(exactFloor).simulatedFlatRows, 5); cases++;
  exactFloor.rows[0].limitPrice = 99.90;
  assert.throws(() => review(exactFloor), /LIMITED_CLOSEOUT_BOUNDARY_INVALID/); cases++;
  for (const marker of ["FIXTURE_", "private-account", "private-key", "private-client", "fixture-boundary-exit", "fixture-order-"])
    assert.ok(!JSON.stringify(valid).includes(marker));
  const termsFile = path.join(input, "fixture-terms.json"), scenarioFile = path.join(input, "fixture-scenario.json");
  const termsBytes = JSON.stringify(scope), scenarioBytes = JSON.stringify(scenario);
  fs.writeFileSync(termsFile, termsBytes, { mode: 0o600 }); fs.writeFileSync(scenarioFile, scenarioBytes, { mode: 0o600 });
  const argv = ["scripts/audit-paper-closeout-private-evidence.mjs", input, pin, "--limited-control-dry-run", termsFile, digest(termsBytes),
    "--approval-boundary-simulation", scenarioFile, digest(scenarioBytes)];
  const cli = spawnSync(process.execPath, argv, { encoding: "utf8" });
  assert.equal(cli.status, 0); assert.deepEqual(JSON.parse(cli.stdout), valid); cases++;
  argv[argv.length - 1] = "f".repeat(64);
  const rejected = spawnSync(process.execPath, argv, { encoding: "utf8" });
  assert.equal(rejected.status, 1); assert.equal(JSON.parse(rejected.stdout).status, "PRIVATE_FILE_HASH_MISMATCH"); cases++;
  for (const [n, h] of unchanged) assert.equal(digest(fs.readFileSync(path.join(input, n))), h);
  fs.unlinkSync(termsFile); fs.unlinkSync(scenarioFile);
  return cases;
}
