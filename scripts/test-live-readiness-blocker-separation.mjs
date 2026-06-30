#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-readiness-blockers-"));
const writeJson = (name, payload) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(payload, null, 2)}\n`);

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
writeJson("fillability-report.json", { summary: { candidateCount: 1, payloadCount: 0, brokerAttempted: false, brokerSubmitted: false } });
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

execFileSync(process.execPath, ["scripts/build-live-readiness-scorecard.mjs"], {
  env: { ...process.env, LIVE_READINESS_STATE_DIR: stateDir },
  stdio: "pipe",
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "live-readiness-scorecard.json"), "utf8"));
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
assert.deepEqual(report.blockerGroupSeparation.stage6_entry_tuning.affectedSymbols, ["AAA"]);
assert.deepEqual(report.blockerGroupSeparation.protection_guard_metadata.affectedSymbols, ["BBB"]);
assert.deepEqual(report.blockerGroupSeparation.guard_metadata_lineage.affectedSymbols, ["CCC"]);
assert.deepEqual(report.blockerGroupSeparation.ledger_fill_state.affectedSymbols, ["DDD"]);
assert.deepEqual(report.blockerGroupSeparation.ownership.affectedSymbols, ["EEE"]);

console.log("[LIVE_READINESS_BLOCKER_SEPARATION_TEST] pass");
