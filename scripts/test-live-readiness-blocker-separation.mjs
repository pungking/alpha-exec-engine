#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-blockers-"));
const writeJsonAt = (dir, name, payload) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(payload, null, 2)}\n`);
const writeJson = (name, payload) => writeJsonAt(stateDir, name, payload);
const runScorecard = (dir) => {
  execFileSync(process.execPath, ["scripts/build-live-readiness-scorecard.mjs"], {
    env: { ...process.env, LIVE_READINESS_STATE_DIR: dir },
    stdio: "pipe",
  });
  return JSON.parse(fs.readFileSync(path.join(dir, "live-readiness-scorecard.json"), "utf8"));
};

const lifecycleSymbols = {
  filled: "FILL",
  open: "OPEN",
  terminal: "TERM",
  unreconciled: "UNREC",
  submittedOnly: "SUBMIT",
  duplicate: "DUPL",
  unknown: "UNKNOWN",
};

const writeLifecycleFixtures = (dir, symbols = lifecycleSymbols) => {
  writeJsonAt(dir, "order-state-consistency-report.json", {
    summary: { symbols: 6, failures: 0, terminalReconciliationRequired: 1, terminalConflicts: 0 },
    rows: [
      { symbol: symbols.filled, status: "PASS", category: "TERMINAL_CONSISTENT", normalized: "filled", terminalState: "filled", terminalReconciliationRequired: false, terminalConflicts: false, ledger: "filled", idempotency: "filled", fillability: "FILLED", performance: "filled" },
      { symbol: symbols.open, status: "PASS", category: "ACTIVE_CONSISTENT", normalized: "open", terminalState: null, terminalReconciliationRequired: false, terminalConflicts: false, ledger: "submitted", idempotency: "submitted", fillability: "OPEN_WAITING", performance: null },
      { symbol: symbols.terminal, status: "PASS", category: "TERMINAL_CONSISTENT", normalized: "expired", terminalState: "expired", terminalReconciliationRequired: false, terminalConflicts: false, ledger: "expired", idempotency: "expired", fillability: "TERMINAL_UNFILLED", performance: null },
      { symbol: symbols.unreconciled, status: "WARN", category: "TERMINAL_RECONCILIATION_REQUIRED", normalized: "mixed", terminalState: "expired", terminalReconciliationRequired: true, terminalConflicts: false, ledger: "submitted", idempotency: "expired", fillability: "TERMINAL_UNFILLED", performance: null },
      { symbol: symbols.duplicate, status: "PASS", category: "ACTIVE_CONSISTENT", normalized: "open", terminalState: null, terminalReconciliationRequired: false, terminalConflicts: false, ledger: "submitted", idempotency: "submitted", fillability: "OPEN_WAITING", performance: null },
      { symbol: symbols.unknown, status: "WARN", category: "STATE_UNKNOWN", normalized: "mystery", terminalState: null, terminalReconciliationRequired: false, terminalConflicts: false, ledger: null, idempotency: null, fillability: null, performance: null },
    ],
  });
  writeJsonAt(dir, "fillability-report.json", {
    summary: { candidateCount: 7, payloadCount: 0, brokerAttempted: false, brokerSubmitted: false },
    rows: [
      { symbol: symbols.filled, status: "FILLED", fillQty: 1, brokerClosedStatus: "filled" },
      { symbol: symbols.open, status: "OPEN_WAITING", brokerOpenStatus: "partially_filled", brokerOpenQty: 1, brokerOpenFilledQty: 0.5, brokerOpenClientOrderId: "paper-open" },
      { symbol: symbols.terminal, status: "TERMINAL_UNFILLED", brokerClosedStatus: "expired", brokerClosedFilledQty: 0 },
      { symbol: symbols.unreconciled, status: "TERMINAL_UNFILLED", brokerClosedStatus: "expired", brokerClosedFilledQty: 0 },
      { symbol: symbols.submittedOnly, status: "PAYLOAD_READY_NO_BROKER_MATCH" },
      { symbol: symbols.duplicate, status: "OPEN_WAITING", brokerOpenStatus: "accepted", brokerOpenQty: 1, brokerOpenFilledQty: 0, brokerOpenClientOrderId: "paper-duplicate" },
    ],
  });
  writeJsonAt(dir, "order-ledger.json", {
    orders: Object.fromEntries([
      [symbols.filled, { symbol: symbols.filled, status: "filled", brokerOrderId: "broker-filled" }],
      [symbols.open, { symbol: symbols.open, status: "submitted", brokerOrderId: "broker-open" }],
      [symbols.terminal, { symbol: symbols.terminal, status: "expired", brokerOrderId: "broker-terminal" }],
      [symbols.unreconciled, { symbol: symbols.unreconciled, status: "submitted", brokerOrderId: "broker-unreconciled" }],
      [symbols.submittedOnly, { symbol: symbols.submittedOnly, status: "submitted", brokerOrderId: "broker-submitted-only" }],
      [symbols.duplicate, { symbol: symbols.duplicate, status: "submitted", brokerOrderId: "broker-duplicate" }],
    ]),
  });
  writeJsonAt(dir, "order-idempotency.json", {
    orders: Object.fromEntries([
      [symbols.filled, { symbol: symbols.filled, brokerStatus: "filled", brokerOrderId: "broker-filled" }],
      [symbols.open, { symbol: symbols.open, brokerStatus: "submitted", brokerOrderId: "broker-open" }],
      [symbols.terminal, { symbol: symbols.terminal, brokerStatus: "expired", brokerOrderId: "broker-terminal" }],
      [symbols.unreconciled, { symbol: symbols.unreconciled, brokerStatus: "expired", brokerOrderId: "broker-unreconciled" }],
      [symbols.duplicate, { symbol: symbols.duplicate, brokerStatus: "submitted", brokerOrderId: "broker-duplicate" }],
    ]),
  });
  writeJsonAt(dir, "open-order-reprice-proposal.json", {
    summary: { readyForApproval: 0, brokerMutationAttempted: false, brokerMutationSubmitted: false },
    rows: [
      { symbol: symbols.open, decision: "REPORT_ONLY_NO_READY_REPRICE", brokerOpenStatus: "new", checks: { duplicateOpenCountOk: true } },
      { symbol: symbols.duplicate, decision: "BLOCK_DUPLICATE_OPEN_ORDER", brokerOpenStatus: "accepted", checks: { duplicateOpenCountOk: false } },
    ],
  });
};

writeJson("last-dry-exec-preview.json", {
  stage6Hash: "abc123",
  stage6File: "STAGE6_ALPHA_FINAL_TEST.json",
  payloadCount: 0,
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
  orderDecisionAudit: {
    summary: { payloadExpectation: { status: "no_unheld_executable" }, topSkipReasonCategories: { quality_gate: 1 } },
  },
});
writeLifecycleFixtures(stateDir);
writeJson("last-order-decision-audit.json", { records: [{ symbol: "AAA", status: "skipped", reason: "quality_gate" }] });
writeJson("ops-health-report.json", {
  overall: "fail",
  blockerGroups: {
    stage6_entry_tuning: { status: "warn", detail: "quality_gate=1" },
    protection_guard_metadata: { status: "fail", detail: "childMissing=1" },
    ledger_fill_state: { status: "warn", detail: "terminalReady=1" },
    ownership: { status: "warn", detail: "externalAdoption=1" },
    safety_mutation: { status: "pass", detail: "false" },
    scheduler_data: { status: "pass", detail: "fresh" },
  },
});
writeJson("broker-child-order-reconciliation.json", {
  summary: { missingStopChildren: 1, missingTargetChildren: 1 },
  rows: [{ symbol: "BBB", severity: "fail", stopChildMissing: true, targetChildMissing: true }],
});
writeJson("position-protection-root-cause-audit.json", {
  summary: {
    protectionBlockerRows: 2,
    ownershipBlockerRows: 1,
    ledgerBlockerRows: 1,
    classifiedRows: 4,
    unclassifiedRows: 0,
    protectionLaneCounts: {
      BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED: 0,
      FRESH_GUARD_SOURCE_REQUIRED: 1,
      INVALID_GUARD_GEOMETRY_NO_REPAIR: 0,
      OWNERSHIP_PROOF_REQUIRED: 2,
      MANUAL_APPROVAL_CANDIDATE: 1,
    },
  },
  rows: [
    { symbol: "FILL", protectionLane: "MANUAL_APPROVAL_CANDIDATE", blockerDomain: "protection", repairEligible: true },
    { symbol: "CCC", protectionLane: "FRESH_GUARD_SOURCE_REQUIRED", blockerDomain: "protection", repairEligible: false },
    { symbol: "DDD", protectionLane: "OWNERSHIP_PROOF_REQUIRED", blockerDomain: "ledger_fill_state", repairEligible: false },
    { symbol: "EEE", protectionLane: "OWNERSHIP_PROOF_REQUIRED", blockerDomain: "ownership", repairEligible: false },
  ],
});
writeJson("guard-source-recovery-plan.json", {
  summary: {
    protectionBlockerRows: 2,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
  },
  rows: [],
});
writeJson("persistent-oco-repair-plan.json", {
  summary: {
    protectionBlockerRows: 2,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
  },
  rows: [],
});
writeJson("guard-metadata-lineage-audit.json", {
  summary: { missingNoSource: 1, staleSourceOnly: 0, brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false },
  rows: [{ symbol: "CCC", lineageStatus: "LINEAGE_GAP", rootCause: "NO_SOURCE_WITH_STOP_TARGET" }],
});
writeJson("fill-state-reconciliation-audit.json", {
  summary: { brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false },
  rows: [{ symbol: "DDD", reconciliationDecision: "LEDGER_TERMINALIZATION_REVIEW_REQUIRED", requiresLedgerTerminalizationReview: true }],
});
writeJson("ledger-terminalization-proposal.json", { summary: { proposalReady: 1 }, rows: [{ symbol: "DDD" }] });
writeJson("position-ownership-recovery-decision.json", {
  summary: { stateMutationAttempted: false, stateMutationApplied: false },
  rows: [{ symbol: "EEE", ownershipRecoveryDecision: "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE", manualExternalAdoptionReview: true }],
});
writeJson("position-ownership-state-migration-review-plan.json", {
  summary: { stateMutationAttempted: false, stateMutationApplied: false },
  rows: [{ symbol: "EEE" }],
});
writeJson("high-price-min-one-share-canary-plan.json", {
  overall: "blocked",
  summary: {
    candidates: 1,
    eligible: 0,
    selectedSymbol: null,
    capPolicyReviewRequired: 1,
    capScenarioCounts: {
      current: { capEligible: 0, reportOnlyEligible: 0 },
      conservative: { capEligible: 0, reportOnlyEligible: 0 },
      aggressive: { capEligible: 1, reportOnlyEligible: 1 },
    },
    readyForBrokerSubmit: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
  },
  approvalGate: { readyForBrokerSubmit: false },
  executionPolicy: {
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
  },
  rows: [{
    symbol: "META",
    capPolicyReview: "CAP_INCREASE_REQUIRED_BEFORE_MANUAL_SUBMIT_REVIEW",
    capScenarios: [{
      name: "aggressive",
      capEligible: true,
      reportOnlyEligible: true,
      blockedBy: [],
    }],
    blockedBy: ["notional_cap", "risk_cap", "daily_notional_cap"],
  }],
});

const report = runScorecard(stateDir);
assert.equal(report.schemaVersion, "2.0.0");
assert.equal(Object.hasOwn(report, "mliLifecycle"), false);
assert.ok(report.entryOrderLifecycle);
assert.equal(report.entryOrderLifecycle.sourceReport, "order-state-consistency-report.json");
assert.deepEqual(
  report.entryOrderLifecycle.rows.map((row) => row.symbol),
  ["DUPL", "FILL", "OPEN", "SUBMIT", "TERM", "UNKNOWN", "UNREC"]
);
assert.deepEqual(report.entryOrderLifecycle.summary, {
  totalLifecycleRows: 7,
  submittedEvidenceRows: 6,
  filledCompleteRows: 1,
  openWaitingRows: 2,
  consistentTerminalRows: 1,
  terminalReconciliationRequiredRows: 1,
  submittedEvidenceOnlyRows: 1,
  duplicateOpenRows: 1,
  lifecycleUnknownRows: 1,
  lifecycleBlockerRows: 3,
});
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "FILL").classification, "FILLED_COMPLETE");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "OPEN").classification, "OPEN_WAITING");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "TERM").classification, "CONSISTENT_TERMINAL");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "UNREC").classification, "TERMINAL_RECONCILIATION_REQUIRED");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "SUBMIT").classification, "SUBMITTED_EVIDENCE_ONLY");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "UNKNOWN").classification, "NO_LIFECYCLE_EVIDENCE");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "DUPL").duplicateOpenStatus, "DUPLICATE_OPEN_ORDER");
assert.equal(report.finalVerdict, "BLOCKED");
assert.equal(report.brokerMutationAttempted, false);
assert.equal(report.brokerMutationSubmitted, false);
assert.equal(report.stateMutationAttempted, false);
assert.equal(report.stateMutationSubmitted, false);
assert.equal(report.safety.brokerMutationAllowed, false);
assert.equal(report.safety.stateMutationAllowed, false);
assert.equal(report.safety.multiSubmitAllowed, false);
assert.equal(report.safety.multiSubmitAttempted, false);
assert.equal(report.safety.multiSubmitSubmitted, false);
assert.equal(report.boundedVerification.mode, "symbol_agnostic_one_shot");
assert.equal(report.boundedVerification.tickerSymbolsAreEvidenceOnly, true);
assert.equal(report.boundedVerification.maxFreshSidecarChecksPerHash, 1);
assert.ok(report.boundedVerification.followUpOnlyWhen.includes("approval_ready_lane_detected"));
const requiredGroups = [
  "stage6_entry_tuning",
  "protection_guard_metadata",
  "ledger_fill_state",
  "ownership",
  "safety_mutation",
  "scheduler_data",
];
for (const group of requiredGroups) {
  assert.ok(report.blockerGroupSeparation[group], `missing blocker group ${group}`);
}
assert.equal(report.blockerGroupSeparation.protection_guard_metadata.status, "fail");
assert.equal(report.blockerGroupSeparation.protection_guard_metadata.count, 2);
assert.deepEqual(report.blockerGroupSeparation.stage6_entry_tuning.affectedSymbols, ["AAA"]);
assert.deepEqual(report.blockerGroupSeparation.protection_guard_metadata.affectedSymbols, ["CCC", "FILL"]);
assert.deepEqual(report.blockerGroupSeparation.guard_metadata_lineage.affectedSymbols, ["CCC"]);
assert.deepEqual(report.blockerGroupSeparation.ledger_fill_state.affectedSymbols, ["DDD"]);
assert.deepEqual(report.blockerGroupSeparation.ownership.affectedSymbols, ["EEE"]);
assert.deepEqual(report.blockerGroupSeparation.high_price_min_one_share.affectedSymbols, ["META"]);
const highPriceDomain = report.domains.find((item) => item.name === "high_price_min_one_share_policy");
assert.equal(highPriceDomain.status, "waiting");
assert.equal(highPriceDomain.evidence.capPolicyReviewRequired, 1);
assert.deepEqual(highPriceDomain.evidence.capScenarioCounts.aggressive, { capEligible: 1, reportOnlyEligible: 1 });
assert.deepEqual(highPriceDomain.evidence.blockedBy, ["daily_notional_cap", "notional_cap", "risk_cap"]);
assert.equal(highPriceDomain.evidence.brokerMutationAttempted, false);
assert.equal(highPriceDomain.evidence.brokerMutationSubmitted, false);
assert.equal(report.protectionClassification.unclassifiedRows, 0);
assert.equal(report.protectionClassification.protectionBlockerRows, 2);
assert.equal(report.protectionClassification.reportConsistency.allAvailableCountsMatch, true);
const protectionDomain = report.domains.find((item) => item.name === "protective_order_guard_metadata");
assert.deepEqual(protectionDomain.blockers, ["protection_lane_blockers:2"]);
const lifecycleBlockerSymbols = new Set(report.entryOrderLifecycle.rows.filter((row) => row.status === "block").map((row) => row.symbol));
assert.equal(lifecycleBlockerSymbols.has("FILL"), false, "filled protection blocker must not be duplicated into lifecycle blockers");

const emptyStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-empty-lifecycle-"));
writeJsonAt(emptyStateDir, "last-dry-exec-preview.json", {
  stage6Hash: "empty123",
  stage6File: "STAGE6_ALPHA_FINAL_EMPTY.json",
  payloadCount: 0,
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
});
const emptyReport = runScorecard(emptyStateDir);
assert.equal(emptyReport.entryOrderLifecycle.status, "pass");
assert.equal(emptyReport.entryOrderLifecycle.summary.totalLifecycleRows, 0);
assert.equal(emptyReport.entryOrderLifecycle.summary.lifecycleUnknownRows, 0);
assert.equal(emptyReport.entryOrderLifecycle.summary.lifecycleBlockerRows, 0);

const paperPilotStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-paper-pilot-"));
writeJsonAt(paperPilotStateDir, "last-dry-exec-preview.json", {
  stage6Hash: "paper123",
  stage6File: "STAGE6_ALPHA_FINAL_PAPER.json",
  payloadCount: 0,
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
});
writeJsonAt(paperPilotStateDir, "order-state-consistency-report.json", {
  summary: { symbols: 1, failures: 0, terminalReconciliationRequired: 0, terminalConflicts: 0 },
  rows: [{ symbol: "PAPERX", status: "PASS", category: "ACTIVE_CONSISTENT", normalized: "open", terminalReconciliationRequired: false, terminalConflicts: false, ledger: "submitted", idempotency: "submitted", fillability: "OPEN_WAITING" }],
});
writeJsonAt(paperPilotStateDir, "fillability-report.json", {
  summary: { candidateCount: 0, payloadCount: 0, brokerAttempted: false, brokerSubmitted: false },
  rows: [{ symbol: "PAPERX", status: "OPEN_WAITING", brokerOpenStatus: "new", brokerOpenClientOrderId: "paperx-open" }],
});
writeJsonAt(paperPilotStateDir, "order-ledger.json", { orders: { PAPERX: { symbol: "PAPERX", status: "submitted", brokerOrderId: "paperx-order" } } });
writeJsonAt(paperPilotStateDir, "order-idempotency.json", { orders: { PAPERX: { symbol: "PAPERX", brokerStatus: "submitted", brokerOrderId: "paperx-order" } } });
const paperPilotReport = runScorecard(paperPilotStateDir);
assert.equal(paperPilotReport.entryOrderLifecycle.status, "waiting");
assert.equal(paperPilotReport.finalVerdict, "PAPER_PILOT");

const microLiveStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-micro-live-"));
writeJsonAt(microLiveStateDir, "last-dry-exec-preview.json", {
  stage6Hash: "micro123",
  stage6File: "STAGE6_ALPHA_FINAL_MICRO.json",
  payloadCount: 0,
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
});
writeJsonAt(microLiveStateDir, "order-state-consistency-report.json", {
  summary: { symbols: 1, failures: 0, terminalReconciliationRequired: 0, terminalConflicts: 0 },
  rows: [{ symbol: "MICROX", status: "PASS", category: "TERMINAL_CONSISTENT", normalized: "filled", terminalState: "filled", terminalReconciliationRequired: false, terminalConflicts: false, ledger: "filled", idempotency: "filled", fillability: "FILLED", performance: "filled" }],
});
writeJsonAt(microLiveStateDir, "fillability-report.json", {
  summary: { candidateCount: 0, payloadCount: 0, brokerAttempted: false, brokerSubmitted: false },
  rows: [{ symbol: "MICROX", status: "FILLED", fillQty: 1, brokerClosedStatus: "filled" }],
});
writeJsonAt(microLiveStateDir, "order-ledger.json", { orders: { MICROX: { symbol: "MICROX", status: "filled", brokerOrderId: "microx-order" } } });
writeJsonAt(microLiveStateDir, "order-idempotency.json", { orders: { MICROX: { symbol: "MICROX", brokerStatus: "filled", brokerOrderId: "microx-order" } } });
const microLiveReport = runScorecard(microLiveStateDir);
assert.equal(microLiveReport.entryOrderLifecycle.status, "pass");
assert.equal(microLiveReport.entryOrderLifecycle.summary.filledCompleteRows, 1);
assert.equal(microLiveReport.finalVerdict, "MICRO_LIVE_REVIEW_READY");

const renamedStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-renamed-lifecycle-"));
for (const fileName of fs.readdirSync(stateDir)) {
  if (fileName.startsWith("live-readiness-scorecard.")) continue;
  fs.copyFileSync(path.join(stateDir, fileName), path.join(renamedStateDir, fileName));
}
writeLifecycleFixtures(renamedStateDir, {
  filled: "ZXA",
  open: "ZXB",
  terminal: "ZXC",
  unreconciled: "ZXD",
  submittedOnly: "ZXE",
  duplicate: "ZXF",
  unknown: "ZXG",
});
const renamedReport = runScorecard(renamedStateDir);
assert.deepEqual(renamedReport.entryOrderLifecycle.summary, report.entryOrderLifecycle.summary);
assert.equal(renamedReport.entryOrderLifecycle.status, report.entryOrderLifecycle.status);
assert.equal(renamedReport.finalVerdict, report.finalVerdict);

console.log("[LIVE_READINESS_BLOCKER_SEPARATION_TEST] pass");
