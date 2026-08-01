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
  actionIntent: { enabled: true, previewOnly: true, allowedActionTypes: ["ENTRY_NEW", "HOLD_WAIT"], counts: {} },
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
  orderDecisionAudit: {
    summary: { payloadExpectation: { status: "no_unheld_executable" }, topSkipReasonCategories: { quality_gate: 1 } },
  },
});
writeLifecycleFixtures(stateDir);
writeJson("performance-dashboard.json", { live: { available: true, positions: [{ symbol: lifecycleSymbols.filled, qty: 1, side: "long" }] }, simulation: { rows: [] } });
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
assert.equal(report.schemaVersion, "3.0.0");
assert.equal(Object.hasOwn(report, "mliLifecycle"), false);
assert.ok(report.entryOrderLifecycle);
assert.equal(report.entryOrderLifecycle.sourceReport, "order-state-consistency-report.json");
assert.deepEqual(
  report.entryOrderLifecycle.rows.map((row) => row.symbol),
  ["DUPL", "FILL", "OPEN", "SUBMIT", "TERM", "UNKNOWN", "UNREC"]
);
assert.equal(report.entryOrderLifecycle.contractVersion, "paper-entry-exit-lifecycle-v1");
assert.equal(report.entryOrderLifecycle.summary.totalLifecycleRows, 7);
assert.equal(report.entryOrderLifecycle.summary.entrySubmittedRows, 1);
assert.equal(report.entryOrderLifecycle.summary.openWaitingRows, 1);
assert.equal(report.entryOrderLifecycle.summary.filledUnprotectedRows, 1);
assert.equal(report.entryOrderLifecycle.summary.expiredOrCanceledReconciledRows, 1);
assert.equal(report.entryOrderLifecycle.summary.terminalReconciliationRequiredRows, 3);
assert.equal(report.entryOrderLifecycle.summary.duplicateOpenRows, 1);
assert.equal(report.entryOrderLifecycle.summary.lifecycleUnknownRows, 0);
assert.equal(report.entryOrderLifecycle.summary.unclassifiedRows, 0);
assert.equal(report.entryOrderLifecycle.summary.buyOnlyLifecycle, true);
assert.equal(report.entryOrderLifecycle.summary.closedLoopEvidenceStatus, "ENTRY_ONLY_EVIDENCE");
assert.equal(report.paperExitReadiness.primaryRootCause, "EXIT_ACTION_PRODUCER_DISABLED");
assert.deepEqual(report.paperExitReadiness.producerLiveness.missingExitActions, ["SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"]);
assert.equal(report.paperExitReadiness.summary.filledPositionRows, 1);
assert.equal(report.paperExitReadiness.summary.exitEvidenceIncompleteRows, 1);
assert.equal(report.paperExitReadiness.canaryApprovalPackage.status, "NO_SAFE_EXIT_CANARY_AVAILABLE");
assert.equal(report.paperExitReadiness.realizedPnlProducer.status, "REALIZED_PNL_PRODUCER_GAP");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "FILL").classification, "FILLED_UNPROTECTED");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "OPEN").classification, "OPEN_WAITING");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "TERM").classification, "EXPIRED_OR_CANCELED_RECONCILED");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "UNREC").classification, "TERMINAL_RECONCILIATION_REQUIRED");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "SUBMIT").classification, "ENTRY_SUBMITTED");
assert.equal(report.entryOrderLifecycle.rows.find((row) => row.symbol === "UNKNOWN").classification, "TERMINAL_RECONCILIATION_REQUIRED");
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
writeJsonAt(microLiveStateDir, "order-ledger.json", { orders: {
  "micro-entry": { symbol: "MICROX", actionType: "ENTRY_NEW", executionSide: "buy", status: "filled", brokerOrderId: "microx-entry", updatedAt: "2026-07-01T14:00:00Z" },
  "micro-exit": { symbol: "MICROX", actionType: "EXIT_FULL", executionSide: "sell", status: "filled", brokerOrderId: "microx-exit", updatedAt: "2026-07-02T14:00:00Z" },
} });
writeJsonAt(microLiveStateDir, "order-idempotency.json", { orders: {
  "micro-entry": { symbol: "MICROX", actionType: "ENTRY_NEW", executionSide: "buy", brokerStatus: "filled", brokerOrderId: "microx-entry", brokerCheckedAt: "2026-07-01T14:00:00Z" },
  "micro-exit": { symbol: "MICROX", actionType: "EXIT_FULL", executionSide: "sell", brokerStatus: "filled", brokerOrderId: "microx-exit", brokerCheckedAt: "2026-07-02T14:00:00Z" },
} });
writeJsonAt(microLiveStateDir, "performance-dashboard.json", { simulation: { rows: [{
  symbol: "MICROX",
  status: "closed",
  runDate: "2026-07-02T14:00:00Z",
  entryFilled: 100,
  exitPrice: 110,
  qty: 2,
  grossPnl: 20,
  spreadCost: 1,
  slippageCost: 0.5,
  commission: 0.5,
  realizedPnl: 18,
}] } });
const microLiveReport = runScorecard(microLiveStateDir);
assert.equal(microLiveReport.entryOrderLifecycle.status, "pass");
assert.equal(microLiveReport.entryOrderLifecycle.summary.exitedTerminalReconciledRows, 1);
assert.equal(microLiveReport.entryOrderLifecycle.summary.realizedPnlVerifiedRows, 1);
assert.equal(microLiveReport.entryOrderLifecycle.summary.closedLoopEvidenceStatus, "VERIFIED_CLOSED_LOOP_EVIDENCE");
assert.equal(microLiveReport.finalVerdict, "MICRO_LIVE_REVIEW_READY");

const activeLifecycleStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-active-closed-loop-"));
writeJsonAt(activeLifecycleStateDir, "last-dry-exec-preview.json", {
  stage6Hash: "active123",
  stage6File: "STAGE6_ALPHA_FINAL_ACTIVE.json",
  payloadCount: 0,
  mode: { readOnly: true, execEnabled: false },
  brokerSubmission: { attempted: false, submitted: false },
});
writeJsonAt(activeLifecycleStateDir, "order-state-consistency-report.json", {
  summary: { symbols: 2, failures: 0, terminalReconciliationRequired: 0, terminalConflicts: 0 },
  rows: ["PROTECTED", "EXITING"].map((symbol) => ({
    symbol,
    status: "PASS",
    category: "TERMINAL_CONSISTENT",
    normalized: "filled",
    terminalState: "filled",
    terminalReconciliationRequired: false,
    terminalConflicts: false,
    ledger: "filled",
    idempotency: "filled",
    fillability: "FILLED",
  })),
});
writeJsonAt(activeLifecycleStateDir, "fillability-report.json", {
  summary: { candidateCount: 0, payloadCount: 0, brokerAttempted: false, brokerSubmitted: false },
  rows: ["PROTECTED", "EXITING"].map((symbol) => ({ symbol, status: "FILLED", fillQty: 1, brokerClosedStatus: "filled" })),
});
writeJsonAt(activeLifecycleStateDir, "order-ledger.json", { orders: {
  "protected-entry": { symbol: "PROTECTED", actionType: "ENTRY_NEW", executionSide: "buy", status: "filled", brokerOrderId: "protected-entry" },
  "exiting-entry": { symbol: "EXITING", actionType: "ENTRY_NEW", executionSide: "buy", status: "filled", brokerOrderId: "exiting-entry" },
  "exiting-exit": { symbol: "EXITING", actionType: "EXIT_FULL", executionSide: "sell", status: "submitted", brokerOrderId: "exiting-exit" },
} });
writeJsonAt(activeLifecycleStateDir, "order-idempotency.json", { orders: {
  "protected-entry": { symbol: "PROTECTED", actionType: "ENTRY_NEW", executionSide: "buy", brokerStatus: "filled", brokerOrderId: "protected-entry" },
  "exiting-entry": { symbol: "EXITING", actionType: "ENTRY_NEW", executionSide: "buy", brokerStatus: "filled", brokerOrderId: "exiting-entry" },
  "exiting-exit": { symbol: "EXITING", actionType: "EXIT_FULL", executionSide: "sell", brokerStatus: "submitted", brokerOrderId: "exiting-exit" },
} });
writeJsonAt(activeLifecycleStateDir, "position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 0, ownershipBlockerRows: 0, ledgerBlockerRows: 0, classifiedRows: 2, unclassifiedRows: 0 },
  rows: ["PROTECTED", "EXITING"].map((symbol) => ({
    symbol,
    normalizedFillState: "filled",
    brokerStopPresent: true,
    brokerTargetPresent: true,
    protectionLane: "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED",
    blockerDomain: "none",
  })),
});
writeJsonAt(activeLifecycleStateDir, "broker-child-order-reconciliation.json", {
  summary: { missingStopChildren: 0, missingTargetChildren: 0 },
  rows: ["PROTECTED", "EXITING"].map((symbol) => ({
    symbol,
    normalizedFillState: "filled",
    brokerStopPresent: true,
    brokerTargetPresent: true,
  })),
});
const activeLifecycleReport = runScorecard(activeLifecycleStateDir);
assert.equal(activeLifecycleReport.entryOrderLifecycle.rows.find((row) => row.symbol === "PROTECTED").classification, "FILLED_PROTECTED");
assert.equal(activeLifecycleReport.entryOrderLifecycle.rows.find((row) => row.symbol === "EXITING").classification, "EXIT_PENDING");
assert.equal(activeLifecycleReport.entryOrderLifecycle.summary.idempotencyConflictRows, 0);
assert.equal(activeLifecycleReport.entryOrderLifecycle.summary.terminalLedgerMismatchRows, 0);

const exitReadinessStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-exit-readiness-"));
const exitSymbols = ["IDEMP", "LONG_FULL", "LONG_PART", "NO_DUE", "OWNER", "PROTECTED", "SCALE_SAFE", "SHORT_FULL"];
writeJsonAt(exitReadinessStateDir, "last-dry-exec-preview.json", {
  stage6Hash: "exit123",
  stage6File: "STAGE6_ALPHA_FINAL_EXIT.json",
  mode: { readOnly: true, execEnabled: false },
  preflight: { code: "PREFLIGHT_PASS", blocking: false },
  actionIntent: {
    enabled: true,
    previewOnly: false,
    allowedActionTypes: ["ENTRY_NEW", "HOLD_WAIT", "SCALE_UP", "SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"],
    counts: { SCALE_DOWN: 1, EXIT_PARTIAL: 1, EXIT_FULL: 5 },
  },
  brokerSubmission: { attempted: false, submitted: false },
  payloads: [
    { symbol: "IDEMP", actionType: "EXIT_FULL", actionReason: "blocked_risk" },
    { symbol: "LONG_FULL", actionType: "EXIT_FULL", actionReason: "loss_exit_full" },
    { symbol: "LONG_PART", actionType: "EXIT_PARTIAL", actionReason: "stage6_partial_exit_verdict" },
    { symbol: "OWNER", actionType: "EXIT_FULL", actionReason: "blocked_risk" },
    { symbol: "PROTECTED", actionType: "EXIT_FULL", actionReason: "loss_exit_full" },
    { symbol: "SCALE_SAFE", actionType: "SCALE_DOWN", actionReason: "stale_hold_scale_down" },
    { symbol: "SHORT_FULL", actionType: "EXIT_FULL", actionReason: "loss_exit_full" },
  ],
  skipped: [],
});
writeJsonAt(exitReadinessStateDir, "performance-dashboard.json", {
  live: { available: true, positions: exitSymbols.map((symbol) => ({ symbol, qty: symbol === "SHORT_FULL" ? -2 : 2, side: symbol === "SHORT_FULL" ? "short" : "long" })) },
  simulation: { rows: [] },
});
writeJsonAt(exitReadinessStateDir, "position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 1, ownershipBlockerRows: 1, ledgerBlockerRows: 0, classifiedRows: exitSymbols.length, unclassifiedRows: 0 },
  rows: exitSymbols.map((symbol) => ({
    symbol,
    normalizedFillState: "filled",
    ownershipClassification: symbol === "OWNER" ? "EXTERNAL_OR_MANUAL_POSITION" : "SIDECAR_MANAGED_FILLED",
    brokerStopPresent: symbol === "PROTECTED",
    brokerTargetPresent: symbol === "PROTECTED",
    protectionLane: symbol === "OWNER" ? "OWNERSHIP_PROOF_REQUIRED" : symbol === "PROTECTED" ? "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED" : "FRESH_GUARD_SOURCE_REQUIRED",
    blockerDomain: symbol === "OWNER" ? "ownership" : symbol === "PROTECTED" ? "none" : "protection",
  })),
});
writeJsonAt(exitReadinessStateDir, "broker-child-order-reconciliation.json", {
  summary: { missingStopChildren: 0, missingTargetChildren: 0 },
  rows: exitSymbols.map((symbol) => ({
    symbol,
    normalizedFillState: "filled",
    ownershipClassification: symbol === "OWNER" ? "EXTERNAL_OR_MANUAL_POSITION" : "SIDECAR_MANAGED_FILLED",
    brokerStopPresent: symbol === "PROTECTED",
    brokerTargetPresent: symbol === "PROTECTED",
  })),
});
writeJsonAt(exitReadinessStateDir, "order-ledger.json", { orders: {
  "idemp-exit": { symbol: "IDEMP", actionType: "EXIT_FULL", executionSide: "sell", status: "submitted", brokerOrderId: "ledger-exit" },
} });
writeJsonAt(exitReadinessStateDir, "order-idempotency.json", { orders: {
  "idemp-exit": { symbol: "IDEMP", actionType: "EXIT_FULL", executionSide: "sell", brokerStatus: "submitted", brokerOrderId: "idempotency-exit" },
} });
const exitReadinessReport = runScorecard(exitReadinessStateDir);
assert.equal(exitReadinessReport.paperExitReadiness.primaryRootCause, null);
assert.equal(exitReadinessReport.paperExitReadiness.producerLiveness.runtimeReadyForExitIntentGeneration, true);
assert.equal(exitReadinessReport.paperExitReadiness.summary.filledPositionRows, 8);
assert.equal(exitReadinessReport.paperExitReadiness.summary.exitReadyReportOnlyRows, 4);
assert.equal(exitReadinessReport.paperExitReadiness.summary.exitNotDueRows, 1);
assert.equal(exitReadinessReport.paperExitReadiness.summary.exitBlockedProtectionConflictRows, 1);
assert.equal(exitReadinessReport.paperExitReadiness.summary.exitBlockedOwnershipRows, 1);
assert.equal(exitReadinessReport.paperExitReadiness.summary.exitBlockedLedgerOrIdempotencyRows, 1);
assert.equal(exitReadinessReport.paperExitReadiness.summary.unknownRows, 0);
assert.equal(exitReadinessReport.paperExitReadiness.rows.find((row) => row.symbol === "SHORT_FULL").expectedExecutionSide, "buy");
assert.equal(exitReadinessReport.paperExitReadiness.rows.find((row) => row.symbol === "LONG_FULL").expectedExecutionSide, "sell");
assert.equal(exitReadinessReport.paperExitReadiness.rows.find((row) => row.symbol === "LONG_PART").expectedExitQuantityPolicy, "CONFIGURED_EXIT_PARTIAL_RATIO");
assert.equal(exitReadinessReport.paperExitReadiness.rows.find((row) => row.symbol === "SCALE_SAFE").expectedExitQuantityPolicy, "CONFIGURED_SCALE_DOWN_RATIO");
assert.equal(exitReadinessReport.paperExitReadiness.canaryApprovalPackage.status, "REPORT_ONLY_PAPER_EXIT_CANARY_APPROVAL_PACKAGE_READY");
assert.equal(exitReadinessReport.paperExitReadiness.canaryApprovalPackage.selectedCandidateCount, 1);
assert.equal(exitReadinessReport.paperExitReadiness.canaryApprovalPackage.brokerMutationAllowed, false);

const marketClosedStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-exit-market-closed-"));
for (const fileName of fs.readdirSync(exitReadinessStateDir)) {
  if (fileName.startsWith("live-readiness-scorecard.")) continue;
  fs.copyFileSync(path.join(exitReadinessStateDir, fileName), path.join(marketClosedStateDir, fileName));
}
const marketClosedPreview = JSON.parse(fs.readFileSync(path.join(marketClosedStateDir, "last-dry-exec-preview.json"), "utf8"));
marketClosedPreview.preflight = { code: "PREFLIGHT_MARKET_CLOSED", blocking: true };
writeJsonAt(marketClosedStateDir, "last-dry-exec-preview.json", marketClosedPreview);
const marketClosedReport = runScorecard(marketClosedStateDir);
assert.ok(marketClosedReport.paperExitReadiness.summary.exitBlockedMarketSessionRows >= 4);
assert.equal(marketClosedReport.paperExitReadiness.canaryApprovalPackage.status, "NO_SAFE_EXIT_CANARY_AVAILABLE");

const pnlMismatchStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-pnl-mismatch-"));
for (const fileName of fs.readdirSync(microLiveStateDir)) {
  if (fileName.startsWith("live-readiness-scorecard.")) continue;
  fs.copyFileSync(path.join(microLiveStateDir, fileName), path.join(pnlMismatchStateDir, fileName));
}
const mismatchedPerformance = JSON.parse(fs.readFileSync(path.join(pnlMismatchStateDir, "performance-dashboard.json"), "utf8"));
mismatchedPerformance.simulation.rows[0].realizedPnl = 17;
writeJsonAt(pnlMismatchStateDir, "performance-dashboard.json", mismatchedPerformance);
const pnlMismatchReport = runScorecard(pnlMismatchStateDir);
assert.equal(pnlMismatchReport.entryOrderLifecycle.rows[0].classification, "TERMINAL_RECONCILIATION_REQUIRED");
assert.equal(pnlMismatchReport.entryOrderLifecycle.rows[0].realizedPnlEvidence.status, "REALIZED_PNL_COST_MISMATCH");

const shortPnlStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-short-pnl-"));
for (const fileName of fs.readdirSync(microLiveStateDir)) {
  if (fileName.startsWith("live-readiness-scorecard.")) continue;
  fs.copyFileSync(path.join(microLiveStateDir, fileName), path.join(shortPnlStateDir, fileName));
}
const shortPerformance = JSON.parse(fs.readFileSync(path.join(shortPnlStateDir, "performance-dashboard.json"), "utf8"));
Object.assign(shortPerformance.simulation.rows[0], {
  positionSide: "short",
  entryFilled: 100,
  exitPrice: 90,
  qty: -2,
  grossPnl: 20,
  realizedPnl: 18,
});
writeJsonAt(shortPnlStateDir, "performance-dashboard.json", shortPerformance);
const shortPnlReport = runScorecard(shortPnlStateDir);
assert.equal(shortPnlReport.entryOrderLifecycle.rows[0].realizedPnlEvidence.direction, "short");
assert.equal(shortPnlReport.entryOrderLifecycle.rows[0].realizedPnlEvidence.status, "VERIFIED_NET_REALIZED_PNL");

const renamedExitStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-exit-renamed-"));
const renameSymbols = (value) => {
  if (Array.isArray(value)) return value.map(renameSymbols);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameSymbols(item)]));
  if (typeof value !== "string") return value;
  const index = exitSymbols.indexOf(value);
  return index >= 0 ? `RENAMED_${index}` : value;
};
for (const fileName of fs.readdirSync(exitReadinessStateDir)) {
  if (fileName.startsWith("live-readiness-scorecard.")) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(exitReadinessStateDir, fileName), "utf8"));
  writeJsonAt(renamedExitStateDir, fileName, renameSymbols(payload));
}
const renamedExitReport = runScorecard(renamedExitStateDir);
assert.deepEqual(renamedExitReport.paperExitReadiness.summary, exitReadinessReport.paperExitReadiness.summary);
assert.equal(renamedExitReport.paperExitReadiness.primaryRootCause, exitReadinessReport.paperExitReadiness.primaryRootCause);

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
