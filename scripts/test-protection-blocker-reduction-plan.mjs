#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "protection-blocker-reduction-"));
const writeJson = (name, payload) => fs.writeFileSync(path.join(stateDir, name), `${JSON.stringify(payload, null, 2)}\n`);

writeJson("live-readiness-scorecard.json", {
  finalVerdict: "BLOCKED",
  brokerMutationAttempted: false,
  brokerMutationSubmitted: false,
  stateMutationAttempted: false,
  stateMutationSubmitted: false,
  blockerGroupSeparation: {
    protection_guard_metadata: { status: "fail", count: 1, affectedSymbols: ["BBB"] },
  },
});
writeJson("broker-child-order-reconciliation.json", {
  summary: { missingStopChildren: 1, missingTargetChildren: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false },
  rows: [{ symbol: "BBB", brokerStopPresent: false, brokerTargetPresent: false, fillStateReconciliation: { repairBlocked: true } }],
});
writeJson("guarded-child-order-repair-plan.json", {
  summary: { candidates: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false },
  rows: [{ symbol: "BBB", readiness: "CANDIDATE_BLOCKED_REPORT_ONLY" }],
});
writeJson("persistent-oco-repair-plan.json", { summary: { eligible: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false } });
writeJson("guard-metadata-lineage-audit.json", {
  overall: "lineage_gaps_found",
  summary: { missingNoSource: 1, staleSourceOnly: 1, stateMutationAttempted: false },
  rows: [
    { symbol: "CCC", rootCause: "NO_SOURCE_WITH_STOP_TARGET" },
    { symbol: "DDD", rootCause: "SOURCE_AGE_EXCEEDED" },
  ],
});
writeJson("guard-source-recovery-plan.json", {
  summary: { recoveryReady: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false },
  rows: [{ symbol: "DDD", recoveryDecision: "FRESH_SOURCE_REQUIRED_WAIT" }],
});
writeJson("fill-state-reconciliation-audit.json", {
  summary: { ledgerTerminalizationReviewRequired: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false },
  rows: [{ symbol: "EEE", reconciliationDecision: "LEDGER_TERMINALIZATION_REVIEW_REQUIRED", requiresLedgerTerminalizationReview: true }],
});
writeJson("ledger-terminalization-proposal.json", {
  overall: "manual_state_migration_review_ready",
  summary: { proposalReady: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false },
  rows: [{ symbol: "EEE", proposalReady: true }],
});
writeJson("position-ownership-state-migration-review-plan.json", {
  overall: "blocked_external_adoption_evidence_required",
  summary: { externalAdoptionReview: 1, doNotAutoRecover: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false, stateMutationApplied: false },
  rows: [{ symbol: "GGG", currentDecision: "STATE_ONLY_RECOVERY_REVIEW_READY", sourceClassification: "manual_approval_candidate", migrationReviewReady: false, migrationApplyAllowed: false }],
});
writeJson("position-ownership-recovery-decision.json", {
  summary: { brokerMutationAttempted: false, brokerMutationSubmitted: false, stateMutationAttempted: false, stateMutationApplied: false },
  rows: [{ symbol: "FFF", ownershipRecoveryDecision: "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE", manualExternalAdoptionReview: true }],
});

execFileSync(process.execPath, ["scripts/build-protection-blocker-reduction-plan.mjs"], {
  env: { ...process.env, BLOCKER_REDUCTION_STATE_DIR: stateDir },
  stdio: "pipe",
});

const report = JSON.parse(fs.readFileSync(path.join(stateDir, "protection-blocker-reduction-plan.json"), "utf8"));
assert.equal(report.finalVerdict, "BLOCKED");
assert.equal(report.brokerMutationAttempted, false);
assert.equal(report.stateMutationAttempted, false);
assert.equal(report.priority[0].id, "fill_state_ledger_terminalization");
assert.equal(report.priority[0].requiredApprovalPhrase, "CONFIRM STATE LEDGER MIGRATION");
assert.deepEqual(report.guardSourceClassification.missingSource, ["CCC"]);
assert.deepEqual(report.guardSourceClassification.staleSource, ["DDD"]);
assert.deepEqual(report.childMissingClassification.manualRepairCandidate, ["BBB"]);
assert.deepEqual(report.ownershipClassification.externalManualBlocked, ["FFF"]);
assert.deepEqual(report.ownershipClassification.stateOnlyReviewCandidates, ["GGG"]);

console.log("[PROTECTION_BLOCKER_REDUCTION_TEST] pass");
