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
    protection_guard_metadata: { status: "fail", count: 2, affectedSymbols: ["SYN_MAT", "SYN_NONE"] },
  },
  protectionClassification: { protectionBlockerRows: 2 },
});
writeJson("position-protection-root-cause-audit.json", {
  summary: { protectionBlockerRows: 2, ownershipBlockerRows: 1, ledgerBlockerRows: 0 },
  rows: [
    {
      symbol: "SYN_MAT",
      blockerDomain: "protection",
      protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
      brokerStopPresent: false,
      brokerTargetPresent: false,
      ownershipClassification: "SIDECAR_MANAGED_FILLED",
      normalizedFillState: "filled",
      blockedReason: "guard_metadata_stale",
      nextAction: "prepare_separate_state_only_materialization_review_no_mutation",
    },
    {
      symbol: "SYN_NONE",
      blockerDomain: "protection",
      protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
      brokerStopPresent: false,
      brokerTargetPresent: false,
      ownershipClassification: "SIDECAR_MANAGED_FILLED",
      normalizedFillState: "filled",
      blockedReason: "guard_metadata_stale",
      nextAction: "retain_safe_block_until_position_lineage_source_matches",
    },
    {
      symbol: "SYN_OWN",
      blockerDomain: "ownership",
      protectionLane: "OWNERSHIP_PROOF_REQUIRED",
      brokerStopPresent: false,
      brokerTargetPresent: false,
      ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION",
      normalizedFillState: "filled",
    },
  ],
});
writeJson("broker-child-order-reconciliation.json", {
  summary: { missingStopChildren: 1, missingTargetChildren: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false },
  rows: [{ symbol: "BBB", brokerStopPresent: false, brokerTargetPresent: false, fillStateReconciliation: { repairBlocked: true } }],
});
writeJson("guarded-child-order-repair-plan.json", {
  summary: { candidates: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false },
  rows: [{ symbol: "BBB", readiness: "CANDIDATE_BLOCKED_REPORT_ONLY" }],
});
writeJson("persistent-oco-repair-plan.json", {
  summary: {
    eligible: 0,
    protectionBlockerRows: 2,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
  },
  rows: [
    { symbol: "SYN_MAT", blockerDomain: "protection", protectionLane: "FRESH_GUARD_SOURCE_REQUIRED", repairEligible: false },
    { symbol: "SYN_NONE", blockerDomain: "protection", protectionLane: "FRESH_GUARD_SOURCE_REQUIRED", repairEligible: false },
    { symbol: "SYN_FALSE", blockerDomain: "protection", protectionLane: "MANUAL_APPROVAL_CANDIDATE", repairEligible: false },
  ],
});
writeJson("guard-metadata-lineage-audit.json", {
  overall: "lineage_gaps_found",
  summary: { missingNoSource: 1, staleSourceOnly: 1, stateMutationAttempted: false },
  rows: [
    { symbol: "CCC", rootCause: "NO_SOURCE_WITH_STOP_TARGET" },
    { symbol: "DDD", rootCause: "SOURCE_AGE_EXCEEDED" },
  ],
});
writeJson("guard-source-recovery-plan.json", {
  summary: {
    recoveryReady: 1,
    repairEligibleNow: 0,
    protectionBlockerRows: 2,
    sourcePrecedenceViolations: 0,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
  },
  rows: [
    {
      symbol: "SYN_MAT",
      blockerDomain: "protection",
      protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
      recoveryDecision: "FRESH_SOURCE_READY_REPAIR_REEVALUATION_REPORT_ONLY",
      recoveryStatus: "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED",
      recoveryRootCause: "state_materialization_missing",
      recoveryDisposition: "FRESH_SOURCE_MATERIALIZATION_REQUIRED",
      selectedSource: { type: "position_lifecycle_revalidated_guard", fresh: true },
      sourcePrecedence: "state_guard_metadata",
      sourcePrecedenceClass: "stale_or_missing_metadata",
      sourcePrecedenceRank: 4,
      sourcePrecedenceEvidence: { violation: false },
      sourceLineage: {
        sourceType: "position_lifecycle_revalidated_guard",
        producedAt: "2026-07-16T14:50:16.116Z",
        receivedAt: "2026-07-16T14:50:16.672Z",
        ttlMin: 30,
        expiresAt: "2026-07-16T15:20:16.116Z",
        stage6Hash: "hash-mat",
        stage6File: "stage6-mat.json",
        dispatchStatus: "MATCH",
        positionLineageMatchesCurrentPosition: true,
      },
      sourcePreservation: { status: "PRESERVED_ACTIVE_REPORT_ONLY", lineageKeyMatchesCurrentPosition: true, usedForRepairEligibility: false },
      currentSourceFresh: false,
      recoverySourceFreshness: "fresh",
      stateMaterializationRequired: true,
      recoveryGeometry: { valid: true },
      idempotencyStatus: "filled",
      idempotencyPass: true,
      repairEligibleNow: false,
      repairEligibilityContract: {
        currentSourceAppliedAndFresh: false,
        recoverySourceGeometryValid: true,
        idempotencyPass: true,
        pass: false,
      },
      blockedReason: "guard_metadata_stale",
      nextAction: "prepare_separate_state_only_materialization_review_no_mutation",
    },
    {
      symbol: "SYN_NONE",
      blockerDomain: "protection",
      protectionLane: "FRESH_GUARD_SOURCE_REQUIRED",
      recoveryDecision: "FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE",
      recoveryStatus: "NO_FRESH_SOURCE_AVAILABLE",
      recoveryRootCause: "stage6_dispatch_mismatch",
      recoveryDisposition: "EXPECTED_STALE_SOURCE_BLOCK",
      selectedSource: { type: "recommendation_ledger", fresh: false },
      sourcePrecedence: "state_guard_metadata",
      sourcePrecedenceClass: "stale_or_missing_metadata",
      sourcePrecedenceRank: 4,
      sourcePrecedenceEvidence: { violation: false },
      sourceLineage: {
        sourceType: "recommendation_ledger",
        producedAt: "2026-07-10T19:41:47.185Z",
        receivedAt: "2026-07-16T14:50:16.672Z",
        ttlMin: 30,
        expiresAt: "2026-07-10T20:11:47.185Z",
        stage6Hash: "hash-none",
        stage6File: "stage6-none.json",
        dispatchStatus: "MISMATCH",
        positionLineageMatchesCurrentPosition: false,
      },
      sourcePreservation: { status: "PRESERVED_EXPIRED_EVIDENCE_ONLY", lineageKeyMatchesCurrentPosition: true, usedForRepairEligibility: false },
      currentSourceFresh: false,
      recoverySourceFreshness: "stale",
      stateMaterializationRequired: false,
      recoveryGeometry: { valid: true },
      idempotencyStatus: "filled",
      idempotencyPass: true,
      repairEligibleNow: true,
      repairEligibilityContract: {
        currentSourceAppliedAndFresh: false,
        recoverySourceGeometryValid: true,
        idempotencyPass: true,
        pass: false,
      },
      blockedReason: "guard_metadata_stale",
      nextAction: "retain_safe_block_until_position_lineage_source_matches",
    },
    { symbol: "DDD", blockerDomain: "none", recoveryDecision: "FRESH_SOURCE_REQUIRED_WAIT" },
  ],
});
writeJson("ops-health-report.json", {
  metrics: { positionProtectionBlockerRows: 2 },
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
assert.equal(report.schemaVersion, "2.0.0");
assert.equal(report.finalVerdict, "BLOCKED");
assert.equal(report.brokerMutationAttempted, false);
assert.equal(report.stateMutationAttempted, false);
assert.equal(report.priority[0].id, "fill_state_ledger_terminalization");
assert.equal(report.priority[0].requiredApprovalPhrase, "CONFIRM STATE LEDGER MIGRATION");
assert.deepEqual(report.guardSourceClassification.missingSource, ["CCC"]);
assert.deepEqual(report.guardSourceClassification.staleSource, ["DDD"]);
assert.deepEqual(report.childMissingClassification.manualRepairCandidate, []);
assert.deepEqual(report.ownershipClassification.externalManualBlocked, ["FFF"]);
assert.deepEqual(report.ownershipClassification.stateOnlyReviewCandidates, ["GGG"]);
assert.equal(report.canonicalProtectionClassification.canonicalCount, 2);
assert.equal(report.canonicalProtectionClassification.classifiedRows, 2);
assert.equal(report.canonicalProtectionClassification.unclassifiedRows, 0);
assert.equal(report.canonicalProtectionClassification.sourcePrecedenceViolations, 0);
assert.equal(report.canonicalProtectionClassification.domainOverlapRows, 0);
assert.equal(report.canonicalProtectionClassification.repairEligibleNow, 0);
assert.equal(report.canonicalProtectionClassification.repairEligibilityContractViolations, 1);
assert.equal(report.canonicalProtectionClassification.reportCountsMatch, true);
assert.deepEqual(report.canonicalProtectionClassification.missingReportCounts, []);
assert.deepEqual(report.canonicalProtectionClassification.statusCounts, {
  RECOVERY_SOURCE_MATERIALIZATION_REQUIRED: 1,
  NO_FRESH_SOURCE_AVAILABLE: 1,
});
assert.deepEqual(report.canonicalProtectionClassification.rows.map((row) => row.symbol), ["SYN_MAT", "SYN_NONE"]);
assert.equal(report.canonicalProtectionClassification.rows[0].repairEligibleNow, false);
assert.equal(report.canonicalProtectionClassification.rows[0].stateMaterializationRequired, true);
assert.equal(report.canonicalProtectionClassification.rows[0].sourceLineage.dispatchStatus, "MATCH");
assert.equal(report.canonicalProtectionClassification.rows[0].sourcePrecedenceEvidence.violation, false);
assert.equal(report.canonicalProtectionClassification.rows[1].recoveryRootCause, "stage6_dispatch_mismatch");
assert.equal(report.canonicalProtectionClassification.rows[1].sourcePreservation.usedForRepairEligibility, false);
assert.equal(report.canonicalProtectionClassification.rows[1].upstreamRepairEligibleNow, true);
assert.equal(report.canonicalProtectionClassification.rows[1].repairEligibleNow, false);
assert.equal(report.canonicalProtectionClassification.rows[1].repairEligibilityContractViolation, true);
assert.deepEqual(report.childMissingClassification.reportOnlyCandidate, ["BBB"]);
assert.equal(report.priority.find((row) => row.id === "protective_child_missing")?.currentStatus, "fresh_source_wait");

fs.unlinkSync(path.join(stateDir, "ops-health-report.json"));
execFileSync(process.execPath, ["scripts/build-protection-blocker-reduction-plan.mjs"], {
  env: { ...process.env, BLOCKER_REDUCTION_STATE_DIR: stateDir },
  stdio: "pipe",
});
const missingReport = JSON.parse(fs.readFileSync(path.join(stateDir, "protection-blocker-reduction-plan.json"), "utf8"));
assert.equal(missingReport.canonicalProtectionClassification.reportCountsMatch, false);
assert.deepEqual(missingReport.canonicalProtectionClassification.missingReportCounts, ["opsHealth"]);

console.log("[PROTECTION_BLOCKER_REDUCTION_TEST] pass");
