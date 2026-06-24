import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerScript = path.join(__dirname, "build-high-price-min-one-share-canary-plan.mjs");

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const makeStateDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `high-price-${name}-`));

const runPlanner = (stateDir) => {
  execFileSync(process.execPath, [plannerScript], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, HIGH_PRICE_MIN_ONE_SHARE_STATE_DIR: stateDir },
    stdio: "pipe"
  });
  return JSON.parse(fs.readFileSync(path.join(stateDir, "high-price-min-one-share-canary-plan.json"), "utf8"));
};

const writeCommonInputs = (stateDir, { rows, maxTotalNotional = 600, activeSymbolsBefore = 1 } = {}) => {
  writeJson(path.join(stateDir, "fillability-report.json"), {
    summary: {
      overall: "pass",
      stage6File: "STAGE6_ALPHA_FINAL_FIXTURE.json",
      stage6Hash: "fixture_hash",
      payloadCount: 0,
      skippedCount: rows.length,
      highPriceSizeBlocked: rows.filter((row) => row.status === "BLOCKED_HIGH_PRICE_SIZE").length
    },
    rows
  });
  writeJson(path.join(stateDir, "last-dry-exec-preview.json"), {
    stage6File: "STAGE6_ALPHA_FINAL_FIXTURE.json",
    stage6Hash: "fixture_hash",
    payloadCount: 0,
    maxTotalNotional,
    guardControl: { blocked: false, stale: false, reason: "halt_new_entries_false" }
  });
  writeJson(path.join(stateDir, "portfolio-admission-audit.json"), {
    summary: {
      minAdmissionRr: 1.8,
      activeSymbolsBefore,
      maxActiveSymbolsTotal: 12,
      newSymbolsTodayBefore: 0,
      maxNewSymbolsPerDay: 2
    }
  });
  writeJson(path.join(stateDir, "order-idempotency.json"), { orders: {} });
  writeJson(path.join(stateDir, "last-order-decision-audit.json"), { records: [{ symbol: "FIXTURE" }] });
};

const assertReportOnly = (report) => {
  assert.equal(report.executionPolicy.mode, "report_only");
  assert.equal(report.executionPolicy.brokerMutationAllowed, false);
  assert.equal(report.executionPolicy.brokerMutationAttempted, false);
  assert.equal(report.executionPolicy.brokerMutationSubmitted, false);
  assert.equal(report.executionPolicy.stateMutationAllowed, false);
  assert.equal(report.executionPolicy.stateMutationAttempted, false);
  assert.equal(report.summary.brokerMutationAttempted, false);
  assert.equal(report.summary.brokerMutationSubmitted, false);
  assert.equal(report.summary.readyForBrokerSubmit, false);
};

const assertHighPriceEvidenceFields = (row) => {
  for (const field of [
    "oneShareNotional",
    "oneShareRiskDollars",
    "requestedNotional",
    "minOneShareMaxNotional",
    "maxRiskDollarsPerTrade",
    "dailyMaxNotionalCap",
    "portfolioActiveSymbolsBefore",
    "portfolioMaxActiveSymbolsTotal",
    "portfolioNewSymbolsTodayBefore",
    "portfolioMaxNewSymbolsPerDay",
    "rrAtCurrent",
    "rrAtAdjustedEntry",
    "currentVsLimitPct",
    "quoteValid",
    "highPricePolicy",
    "minOneShareFeasibleUnderCaps",
    "highPricePolicyChangeWouldAllow",
    "highPriceMinOneShareApprovalLane",
    "highPriceMinOneShareBrokerSubmitReady",
    "highPriceAutoEligibleReason",
    "blockedBy",
    "accountPortfolioCapEvidence"
  ]) {
    assert.ok(Object.hasOwn(row, field), `missing high-price evidence field: ${field}`);
  }
};

const highPriceRow = (overrides = {}) => ({
  symbol: "GOOG",
  status: "BLOCKED_HIGH_PRICE_SIZE",
  reason: "entry_notional_below_limit_price",
  oneShareNotional: 346.76,
  oneShareRiskDollars: 39.93,
  requestedNotional: 100,
  minOneShareMaxNotional: 300,
  maxRiskDollarsPerTrade: 25,
  rrAtCurrent: 2.05,
  rrAtAdjustedEntry: 2.4,
  currentVsLimitPct: 3.2,
  quoteValid: true,
  highPricePolicy: "skip",
  ...overrides
});

const runNoHighPriceFixture = () => {
  const stateDir = makeStateDir("none");
  writeCommonInputs(stateDir, {
    rows: [
      {
        symbol: "AUPH",
        status: "NO_ACTIVE_ORDER",
        reason: "stage6_wait_structure_confirmation_required",
        oneShareNotional: 15,
        oneShareRiskDollars: 1,
        highPricePolicy: "skip"
      }
    ]
  });
  const report = runPlanner(stateDir);
  assert.equal(report.overall, "no_high_price_rows");
  assert.equal(report.summary.candidates, 0);
  assert.equal(report.rows.length, 0);
  assertReportOnly(report);
};

const runBlockedFixture = () => {
  const stateDir = makeStateDir("blocked");
  writeCommonInputs(stateDir, { rows: [highPriceRow()], maxTotalNotional: 200 });
  const report = runPlanner(stateDir);
  assert.equal(report.overall, "blocked");
  assert.equal(report.summary.candidates, 1);
  assert.equal(report.summary.eligible, 0);
  assertReportOnly(report);
  const row = report.rows[0];
  assertHighPriceEvidenceFields(row);
  assert.equal(row.symbol, "GOOG");
  assert.equal(row.approvalLane, "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED");
  assert.equal(row.highPriceMinOneShareApprovalLane, "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED");
  assert.equal(row.readyForFuturePaperAutoSubmit, false);
  assert.equal(row.highPriceMinOneShareBrokerSubmitReady, false);
  assert.ok(row.blockedBy.includes("notional_cap"));
  assert.ok(row.blockedBy.includes("risk_cap"));
  assert.ok(row.blockedBy.includes("daily_notional_cap"));
  assert.equal(row.accountPortfolioCapEvidence.wouldAllowUnderAccountPortfolioCaps, false);
};

const runEligibleFixture = () => {
  const stateDir = makeStateDir("eligible");
  writeCommonInputs(stateDir, {
    rows: [
      highPriceRow({
        symbol: "ELIG",
        oneShareNotional: 250,
        oneShareRiskDollars: 20,
        rrAtCurrent: 2.1,
        currentVsLimitPct: 1.2
      })
    ],
    maxTotalNotional: 600
  });
  const report = runPlanner(stateDir);
  assert.equal(report.overall, "auto_eligible_report_only");
  assert.equal(report.summary.candidates, 1);
  assert.equal(report.summary.eligible, 1);
  assert.equal(report.summary.readyForFuturePaperAutoSubmit, true);
  assertReportOnly(report);
  const row = report.rows[0];
  assertHighPriceEvidenceFields(row);
  assert.equal(row.symbol, "ELIG");
  assert.equal(row.approvalLane, "AUTO_ELIGIBLE_REPORT_ONLY");
  assert.equal(row.highPriceMinOneShareApprovalLane, "AUTO_ELIGIBLE_REPORT_ONLY");
  assert.equal(row.readyForFuturePaperAutoSubmit, true);
  assert.equal(row.highPriceMinOneShareBrokerSubmitReady, false);
  assert.equal(row.highPriceAutoEligibleReason, "all_report_only_checks_passed");
  assert.deepEqual(row.blockedBy, []);
  assert.equal(row.accountPortfolioCapEvidence.wouldAllowUnderAccountPortfolioCaps, true);
};

runNoHighPriceFixture();
runBlockedFixture();
runEligibleFixture();

console.log("[HIGH_PRICE_MIN_ONE_SHARE_FIXTURES] pass scenarios=no_high_price,blocked,eligible");
