import fs from "node:fs";
import assert from "node:assert/strict";

const STATE_DIR = String(process.env.HIGH_PRICE_MIN_ONE_SHARE_STATE_DIR || "state").trim() || "state";
const REPORT_PATH = `${STATE_DIR}/high-price-min-one-share-canary-plan.json`;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const allowedOverall = new Set([
  "no_fillability_rows",
  "no_high_price_rows",
  "blocked",
  "auto_eligible_report_only",
  "manual_review_required"
]);

const allowedLanes = new Set([
  "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED",
  "AUTO_ELIGIBLE_REPORT_ONLY",
  "MANUAL_REVIEW_REQUIRED"
]);

const requiredRowFields = [
  "oneShareNotional",
  "oneShareRiskDollars",
  "capPolicyReview",
  "capShortfalls",
  "requiredCapsForOneShare",
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
];

const assertFalse = (value, label) => {
  assert.equal(value, false, `${label} must be false in report-only high-price lane`);
};

const assertReportOnly = (report) => {
  assert.equal(report.executionPolicy?.mode, "report_only", "executionPolicy.mode must stay report_only");
  assertFalse(report.executionPolicy?.brokerMutationAllowed, "brokerMutationAllowed");
  assertFalse(report.executionPolicy?.brokerMutationAttempted, "brokerMutationAttempted");
  assertFalse(report.executionPolicy?.brokerMutationSubmitted, "brokerMutationSubmitted");
  assertFalse(report.executionPolicy?.stateMutationAllowed, "stateMutationAllowed");
  assertFalse(report.executionPolicy?.stateMutationAttempted, "stateMutationAttempted");
  assertFalse(report.summary?.brokerMutationAttempted, "summary.brokerMutationAttempted");
  assertFalse(report.summary?.brokerMutationSubmitted, "summary.brokerMutationSubmitted");
  assertFalse(report.summary?.readyForBrokerSubmit, "summary.readyForBrokerSubmit");
  assertFalse(report.approvalGate?.readyForBrokerSubmit, "approvalGate.readyForBrokerSubmit");
};

const assertRowContract = (row) => {
  for (const field of requiredRowFields) {
    assert.ok(Object.hasOwn(row, field), `missing row field: ${row.symbol || "UNKNOWN"}.${field}`);
  }
  assert.ok(Array.isArray(row.blockedBy), `${row.symbol}.blockedBy must be an array`);
  assert.ok(
    allowedLanes.has(row.highPriceMinOneShareApprovalLane),
    `${row.symbol}.highPriceMinOneShareApprovalLane has unexpected value: ${row.highPriceMinOneShareApprovalLane}`
  );
  assertFalse(row.highPriceMinOneShareBrokerSubmitReady, `${row.symbol}.highPriceMinOneShareBrokerSubmitReady`);
  assert.equal(
    typeof row.accountPortfolioCapEvidence,
    "object",
    `${row.symbol}.accountPortfolioCapEvidence must be an object`
  );
  assert.equal(typeof row.capShortfalls, "object", `${row.symbol}.capShortfalls must be an object`);
  assert.equal(typeof row.requiredCapsForOneShare, "object", `${row.symbol}.requiredCapsForOneShare must be an object`);
  assert.equal(
    row.highPricePolicyChangeWouldAllow,
    row.highPriceMinOneShareApprovalLane === "AUTO_ELIGIBLE_REPORT_ONLY",
    `${row.symbol}.highPricePolicyChangeWouldAllow must match AUTO_ELIGIBLE_REPORT_ONLY lane`
  );
  if (row.highPriceMinOneShareApprovalLane === "AUTO_ELIGIBLE_REPORT_ONLY") {
    assert.equal(row.readyForFuturePaperAutoSubmit, true, `${row.symbol}.readyForFuturePaperAutoSubmit must be true`);
    assert.equal(row.highPriceAutoEligibleReason, "all_report_only_checks_passed");
    assert.deepEqual(row.blockedBy, [], `${row.symbol}.blockedBy must be empty for auto-eligible report-only rows`);
  } else {
    assert.equal(row.readyForFuturePaperAutoSubmit, false, `${row.symbol}.readyForFuturePaperAutoSubmit must be false`);
    assert.ok(row.blockedBy.length > 0, `${row.symbol}.blockedBy must explain non-eligible high-price rows`);
  }
};

const main = () => {
  assert.ok(fs.existsSync(REPORT_PATH), `missing ${REPORT_PATH}`);
  const report = readJson(REPORT_PATH);
  assert.ok(allowedOverall.has(report.overall), `unexpected overall: ${report.overall}`);
  assertReportOnly(report);
  const rows = Array.isArray(report.rows) ? report.rows : [];
  assert.equal(report.summary?.candidates, rows.length, "summary.candidates must match rows.length");
  for (const row of rows) assertRowContract(row);
  console.log(
    `[HIGH_PRICE_MIN_ONE_SHARE_CONTRACT] pass overall=${report.overall} rows=${rows.length} attempted=false submitted=false`
  );
};

main();
