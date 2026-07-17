import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const STATE_APPROVAL_PHRASE = "CONFIRM STATE OWNERSHIP RECOVERY";
const MULTI_DESIGN_APPROVAL_PHRASE = "CONFIRM MULTI SUBMIT DESIGN REVIEW";

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const runNode = (scriptPath, env) => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`script failed: ${scriptPath}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return result;
};

const makeTempState = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ownership-gate-${name}-`));

const safePolicy = () => ({
  brokerMutationAllowed: false,
  brokerMutationAttempted: false,
  brokerMutationSubmitted: false,
  stateMutationAllowed: false,
  stateMutationAttempted: false,
  stateMutationApplied: false,
  multiSubmitLaneAllowed: false
});

const assertNoMutation = (report) => {
  assert.equal(report.executionPolicy?.brokerMutationAllowed, false);
  assert.equal(report.executionPolicy?.brokerMutationAttempted, false);
  assert.equal(report.executionPolicy?.brokerMutationSubmitted, false);
  assert.equal(report.executionPolicy?.stateMutationAllowed, false);
  assert.equal(report.executionPolicy?.stateMutationAttempted, false);
  assert.equal(report.executionPolicy?.stateMutationApplied, false);
  assert.equal(report.executionPolicy?.multiSubmitLaneAllowed, false);
  assert.equal(report.summary?.brokerMutationAttempted, false);
  assert.equal(report.summary?.brokerMutationSubmitted, false);
  assert.equal(report.summary?.stateMutationAttempted, false);
  assert.equal(report.summary?.stateMutationApplied, false);
};

const runStateMigrationReview = ({ decision, gate, env = {} }) => {
  const stateDir = makeTempState("state");
  writeJson(path.join(stateDir, "position-ownership-recovery-decision.json"), decision);
  writeJson(path.join(stateDir, "position-ownership-recovery-approval-gate.json"), gate);
  runNode("scripts/build-position-ownership-state-migration-review-plan.mjs", {
    POSITION_OWNERSHIP_STATE_MIGRATION_STATE_DIR: stateDir,
    ...env
  });
  return readJson(path.join(stateDir, "position-ownership-state-migration-review-plan.json"));
};

const baseDecision = (rows, overrides = {}) => ({
  overall: "fixture",
  executionPolicy: safePolicy(),
  summary: {
    rows: rows.length,
    stateRecoveryReviewReady: rows.filter((row) => row.stateRecoveryReviewReady).length,
    manualExternalAdoptionReview: rows.filter((row) => row.manualExternalAdoptionReview).length,
    doNotAutoRecover: rows.filter((row) => String(row.ownershipRecoveryDecision || "").startsWith("DO_NOT")).length,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  },
  rows,
  ...overrides
});

const baseGate = ({ authorized = false, external = 0, blocked = 0, rows = 1 }) => ({
  overall: authorized ? "state_recovery_review_authorized_report_only" : external || blocked ? "blocked_external_adoption_evidence_required" : "manual_state_approval_required",
  decision: {
    approvalProvided: authorized,
    stateRecoveryReviewAuthorized: authorized,
    requiredApprovalPhrase: STATE_APPROVAL_PHRASE
  },
  executionPolicy: {
    ...safePolicy(),
    approvalProvided: authorized,
    approvalUnlocksMutation: false
  },
  summary: {
    rows,
    stateRecoveryReviewReady: authorized || (!external && !blocked) ? 1 : 0,
    manualExternalAdoptionReview: external,
    doNotAutoRecover: blocked,
    approvalProvided: authorized,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  }
});

const externalDecision = baseDecision([
  {
    symbol: "EXT1",
    stateRecoveryReviewReady: false,
    manualExternalAdoptionReview: true,
    ownershipRecoveryDecision: "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE",
    hasFreshValidSource: false,
    proof: { sidecarOwnershipProof: false }
  }
]);
const externalReport = runStateMigrationReview({ decision: externalDecision, gate: baseGate({ external: 1, blocked: 1 }) });
assert.equal(externalReport.overall, "blocked_external_adoption_evidence_required");
assert.equal(externalReport.summary.externalAdoptionReview, 1);
assert.equal(externalReport.summary.migrationReviewRows, 0);
assertNoMutation(externalReport);

const readyRow = {
  symbol: "OWN1",
  stateRecoveryReviewReady: true,
  manualExternalAdoptionReview: false,
  ownershipRecoveryDecision: "STATE_ONLY_RECOVERY_REVIEW_READY",
  hasFreshValidSource: true,
  proof: { sidecarOwnershipProof: true, ledgerFilledRows: 1, idempotencyFilledRows: 1 }
};
const blockedApprovalReport = runStateMigrationReview({
  decision: baseDecision([readyRow]),
  gate: baseGate({ authorized: false, rows: 1 })
});
assert.equal(blockedApprovalReport.overall, "blocked_state_approval_required");
assert.equal(blockedApprovalReport.summary.migrationReviewRows, 1);
assert.equal(blockedApprovalReport.rows[0].migrationReviewReady, false);
assert.equal(blockedApprovalReport.rows[0].migrationApplyAllowed, false);
assertNoMutation(blockedApprovalReport);

const reviewReadyReport = runStateMigrationReview({
  decision: baseDecision([readyRow]),
  gate: baseGate({ authorized: true, rows: 1 })
});
assert.equal(reviewReadyReport.overall, "state_migration_review_ready_report_only");
assert.equal(reviewReadyReport.summary.migrationReviewRows, 1);
assert.equal(reviewReadyReport.rows[0].migrationReviewReady, true);
assert.equal(reviewReadyReport.rows[0].migrationApplyAllowed, false);
assertNoMutation(reviewReadyReport);

const unsafeReport = runStateMigrationReview({
  decision: baseDecision([], { executionPolicy: { ...safePolicy(), stateMutationAllowed: true } }),
  gate: baseGate({ rows: 0 })
});
assert.equal(unsafeReport.overall, "blocked_unsafe_input_mutation_signal");
assertNoMutation(unsafeReport);

const runMultiSubmitGate = ({ limitedPlan, env = {} }) => {
  const stateDir = makeTempState("multi");
  writeJson(path.join(stateDir, "limited-multi-oco-repair-plan.json"), limitedPlan);
  runNode("scripts/build-multi-oco-submit-safety-gate.mjs", {
    MULTI_OCO_SUBMIT_GATE_STATE_DIR: stateDir,
    ...env
  });
  return readJson(path.join(stateDir, "multi-oco-submit-safety-gate.json"));
};

const limitedPlan = {
  overall: "manual_approval_required",
  executionPolicy: {
    ...safePolicy(),
    maxRows: 2,
    maxQtyPerRow: 1
  },
  summary: {
    rows: 1,
    eligible: 1,
    selected: 1,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false
  },
  rows: [{ symbol: "BATCH1", eligibleForLimitedBatch: true, selectedForApprovalBatch: true }]
};

const multiBlockedReport = runMultiSubmitGate({ limitedPlan });
assert.equal(multiBlockedReport.overall, "blocked_multi_submit_design_approval_required");
assert.equal(multiBlockedReport.summary.selected, 1);
assert.equal(multiBlockedReport.summary.multiSubmitAuthorized, false);
assertNoMutation(multiBlockedReport);
assert.equal(multiBlockedReport.executionPolicy.dryRunMaySubmitMulti, false);

const multiDesignOnlyReport = runMultiSubmitGate({
  limitedPlan,
  env: { MULTI_OCO_SUBMIT_DESIGN_CONFIRMATION: MULTI_DESIGN_APPROVAL_PHRASE }
});
assert.equal(multiDesignOnlyReport.overall, "multi_submit_design_review_authorized_report_only");
assert.equal(multiDesignOnlyReport.summary.multiSubmitAuthorized, false);
assert.equal(multiDesignOnlyReport.executionPolicy.designApprovalUnlocksBrokerMutation, false);
assertNoMutation(multiDesignOnlyReport);
assert.equal(multiDesignOnlyReport.executionPolicy.dryRunMaySubmitMulti, false);

const multiUnsafeReport = runMultiSubmitGate({
  limitedPlan: {
    ...limitedPlan,
    executionPolicy: { ...limitedPlan.executionPolicy, brokerMutationAllowed: true }
  }
});
assert.equal(multiUnsafeReport.overall, "blocked_unsafe_limited_plan_mutation_signal");
assertNoMutation(multiUnsafeReport);

const basePersistentRepairRow = (symbol, repairEligible) => ({
  symbol,
  readiness: "PERSISTENT_REPAIR_READY_FOR_APPROVAL",
  executionAllowed: false,
  blockers: [],
  ownershipClassification: "SIDECAR_MANAGED_POSITION",
  normalizedFillState: "FILLED",
  protectionLane: repairEligible ? "MANUAL_APPROVAL_CANDIDATE" : "FRESH_GUARD_SOURCE_REQUIRED",
  repairEligible,
  repairQty: 1,
  payloadPreview: {
    symbol,
    qty: "1",
    time_in_force: "gtc",
    order_class: "oco"
  }
});

const runLimitedRepairPlan = ({ symbol, guardSourceRepairEligibleNow, persistentRepairEligible }) => {
  const stateDir = makeTempState("limited-contract");
  writeJson(path.join(stateDir, "persistent-oco-repair-plan.json"), {
    overall: "manual_approval_required",
    executionPolicy: safePolicy(),
    summary: { eligible: 1, brokerMutationAttempted: false, brokerMutationSubmitted: false },
    rows: [basePersistentRepairRow(symbol, persistentRepairEligible)]
  });
  writeJson(path.join(stateDir, "broker-child-order-reconciliation.json"), {
    overall: "fixture",
    rows: [{ symbol, brokerStopPresent: false, brokerTargetPresent: false }]
  });
  writeJson(path.join(stateDir, "persistent-oco-repair-open-verify-multi.json"), {
    overall: "fixture",
    executionPolicy: safePolicy(),
    summary: { brokerMutationAttempted: false, brokerMutationSubmitted: false }
  });
  writeJson(path.join(stateDir, "guard-source-recovery-plan.json"), {
    overall: "fixture",
    summary: { repairEligibleNow: guardSourceRepairEligibleNow ? 1 : 0 },
    rows: [{
      symbol,
      recoveryStatus: guardSourceRepairEligibleNow ? "RECOVERY_SOURCE_READY_REPORT_ONLY" : "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED",
      recoveryRootCause: guardSourceRepairEligibleNow ? null : "state_materialization_missing",
      repairEligibleNow: guardSourceRepairEligibleNow
    }]
  });
  runNode("scripts/build-limited-multi-oco-repair-plan.mjs", {
    LIMITED_MULTI_OCO_REPAIR_STATE_DIR: stateDir
  });
  return { stateDir, report: readJson(path.join(stateDir, "limited-multi-oco-repair-plan.json")) };
};

const canonicalBlocked = runLimitedRepairPlan({
  symbol: "SAFE1",
  guardSourceRepairEligibleNow: false,
  persistentRepairEligible: true
});
assert.equal(canonicalBlocked.report.summary.eligible, 0);
assert.equal(canonicalBlocked.report.summary.selected, 0);
assert.equal(canonicalBlocked.report.rows[0].blockerGroup, "guard_source_recovery_required");
assert.equal(canonicalBlocked.report.rows[0].guardSourceRepairEligibleNow, false);
assert.equal(canonicalBlocked.report.executionPolicy.brokerMutationAttempted, false);
assert.equal(canonicalBlocked.report.executionPolicy.brokerMutationSubmitted, false);

const persistentBlocked = runLimitedRepairPlan({
  symbol: "SAFE2",
  guardSourceRepairEligibleNow: true,
  persistentRepairEligible: false
});
assert.equal(persistentBlocked.report.summary.eligible, 0);
assert.equal(persistentBlocked.report.summary.selected, 0);
assert.equal(persistentBlocked.report.rows[0].blockerGroup, "protection_classification_required");
assert.equal(persistentBlocked.report.rows[0].persistentProtectionEligible, false);

const canonicalReady = runLimitedRepairPlan({
  symbol: "SAFE3",
  guardSourceRepairEligibleNow: true,
  persistentRepairEligible: true
});
assert.equal(canonicalReady.report.summary.eligible, 1);
assert.equal(canonicalReady.report.summary.selected, 1);
assert.equal(canonicalReady.report.rows[0].guardSourceRepairEligibleNow, true);
assert.equal(canonicalReady.report.executionPolicy.brokerMutationAttempted, false);
assert.equal(canonicalReady.report.executionPolicy.brokerMutationSubmitted, false);

const runOwnershipGapAudit = ({ stateDir, symbol }) => {
  writeJson(path.join(stateDir, "performance-dashboard.json"), {
    live: { positions: [{ symbol, qty: 1, positionStatus: "open" }] }
  });
  writeJson(path.join(stateDir, "position-protection-root-cause-audit.json"), {
    rows: [{
      symbol,
      qty: 1,
      sidecarManaged: true,
      ownershipClassification: "SIDECAR_MANAGED_POSITION",
      normalizedFillState: "FILLED",
      missingGuardMetadata: false,
      brokerStopPresent: false,
      brokerTargetPresent: false,
      rootCauses: []
    }]
  });
  writeJson(path.join(stateDir, "guard-metadata-lineage-audit.json"), {
    rows: [{
      symbol,
      ownershipClassification: "SIDECAR_MANAGED_POSITION",
      lineageStatus: "LINEAGE_PRESENT",
      freshValidSources: [],
      sourceSummary: { sourcesWithStopTarget: ["position_lifecycle"] },
      protectionRootCauses: []
    }]
  });
  runNode("scripts/build-position-ownership-guard-gap-audit.mjs", {
    POSITION_OWNERSHIP_GUARD_GAP_STATE_DIR: stateDir
  });
  return readJson(path.join(stateDir, "position-ownership-guard-gap-audit.json"));
};

const ownershipCanonicalBlocked = runOwnershipGapAudit({ stateDir: canonicalBlocked.stateDir, symbol: "SAFE1" });
assert.equal(ownershipCanonicalBlocked.summary.manualApprovalCandidates, 0);
assert.equal(ownershipCanonicalBlocked.summary.repairEligible, 0);
assert.equal(ownershipCanonicalBlocked.rows[0].guardSourceRepairEligibleNow, false);
assert.equal(ownershipCanonicalBlocked.rows[0].repairEligible, false);
assert.equal(ownershipCanonicalBlocked.executionPolicy.brokerMutationAttempted, false);
assert.equal(ownershipCanonicalBlocked.executionPolicy.stateMutationAttempted, false);

const ownershipCanonicalReady = runOwnershipGapAudit({ stateDir: canonicalReady.stateDir, symbol: "SAFE3" });
assert.equal(ownershipCanonicalReady.summary.manualApprovalCandidates, 1);
assert.equal(ownershipCanonicalReady.summary.repairEligible, 1);
assert.equal(ownershipCanonicalReady.rows[0].guardSourceRepairEligibleNow, true);
assert.equal(ownershipCanonicalReady.rows[0].persistentPlanRepairEligible, true);

writeJson(path.join(canonicalReady.stateDir, "persistent-oco-repair-plan.json"), {
  overall: "blocked_no_eligible_row",
  executionPolicy: safePolicy(),
  summary: { eligible: 0, brokerMutationAttempted: false, brokerMutationSubmitted: false },
  rows: []
});
const staleLimitedWithoutPersistent = runOwnershipGapAudit({ stateDir: canonicalReady.stateDir, symbol: "SAFE3" });
assert.equal(staleLimitedWithoutPersistent.summary.manualApprovalCandidates, 0);
assert.equal(staleLimitedWithoutPersistent.summary.repairEligible, 0);
assert.equal(staleLimitedWithoutPersistent.rows[0].limitedPlannerReady, true);
assert.equal(staleLimitedWithoutPersistent.rows[0].persistentRepairReady, false);

const runOwnershipRecoveryDecision = ({ canonicalRow, canonicalRows, gapRows }) => {
  const stateDir = makeTempState("canonical-recovery-decision");
  const rows = gapRows || [{
    symbol: "DEC1",
    qty: 1,
    currentPrice: 100,
    ownershipClassification: "SIDECAR_MANAGED_POSITION",
    guardMetadataMissing: true,
    hasFreshValidSource: true,
    brokerChildrenPresent: false
  }];
  writeJson(path.join(stateDir, "position-ownership-guard-gap-audit.json"), {
    rows
  });
  writeJson(path.join(stateDir, "order-ledger.json"), {
    orders: Object.fromEntries(rows.map((row) => [
      `decision-key:${row.symbol}`,
      { symbol: row.symbol, status: "filled", stage6Hash: "hash", stage6File: "stage6.json" }
    ]))
  });
  if (canonicalRows !== undefined || canonicalRow !== undefined) {
    writeJson(path.join(stateDir, "guard-source-recovery-plan.json"), {
      rows: canonicalRows ?? [canonicalRow]
    });
  }
  runNode("scripts/build-position-ownership-recovery-decision.mjs", {
    POSITION_OWNERSHIP_RECOVERY_STATE_DIR: stateDir
  });
  runNode("scripts/build-position-ownership-recovery-approval-gate.mjs", {
    POSITION_OWNERSHIP_RECOVERY_GATE_STATE_DIR: stateDir
  });
  return {
    decision: readJson(path.join(stateDir, "position-ownership-recovery-decision.json")),
    gate: readJson(path.join(stateDir, "position-ownership-recovery-approval-gate.json"))
  };
};

const missingCanonicalRecovery = runOwnershipRecoveryDecision({ canonicalRow: undefined });
assert.equal(missingCanonicalRecovery.decision.rows[0]?.stateRecoveryReviewReady, false);
assert.equal(missingCanonicalRecovery.decision.rows[0]?.repairEligibleAfterRecovery, false);
assert.equal(missingCanonicalRecovery.decision.rows[0]?.blockers?.includes("canonical_guard_source_recovery_missing"), true);
assert.equal(missingCanonicalRecovery.gate.summary.stateRecoveryReviewReady, 0);

const canonicalRecoveryBlocked = runOwnershipRecoveryDecision({
  canonicalRow: { symbol: "DEC1", repairEligibleNow: false }
});
assert.equal(canonicalRecoveryBlocked.decision.rows[0]?.stateRecoveryReviewReady, false);
assert.equal(canonicalRecoveryBlocked.decision.rows[0]?.repairEligibleAfterRecovery, false);
assert.equal(canonicalRecoveryBlocked.decision.rows[0]?.blockers?.includes("canonical_guard_source_recovery_not_eligible"), true);
assert.equal(canonicalRecoveryBlocked.decision.overall, "blocked_canonical_guard_source_recovery_required");
assert.equal(canonicalRecoveryBlocked.gate.overall, "blocked_canonical_guard_source_recovery_required");
assert.equal(canonicalRecoveryBlocked.gate.decision.status, "CANONICAL_GUARD_SOURCE_RECOVERY_REQUIRED");

const mixedCanonicalRecovery = runOwnershipRecoveryDecision({
  gapRows: [
    {
      symbol: "MIX_READY",
      qty: 1,
      currentPrice: 100,
      ownershipClassification: "SIDECAR_MANAGED_POSITION",
      guardMetadataMissing: true,
      hasFreshValidSource: true,
      repairEligible: true,
      brokerChildrenPresent: false
    },
    {
      symbol: "MIX_BLOCK",
      qty: 1,
      currentPrice: 100,
      ownershipClassification: "SIDECAR_MANAGED_POSITION",
      guardMetadataMissing: true,
      hasFreshValidSource: true,
      brokerChildrenPresent: false
    }
  ],
  canonicalRows: [
    { symbol: "MIX_READY", repairEligibleNow: true },
    { symbol: "MIX_BLOCK", repairEligibleNow: false }
  ]
});
assert.equal(mixedCanonicalRecovery.decision.summary.stateRecoveryReviewReady, 1);
assert.equal(mixedCanonicalRecovery.decision.overall, "blocked_canonical_guard_source_recovery_required");
assert.equal(mixedCanonicalRecovery.decision.nextAction.includes("canonical guard-source recovery"), true);
assert.equal(mixedCanonicalRecovery.gate.overall, "blocked_canonical_guard_source_recovery_required");

const sidecarSourceBlocked = runOwnershipRecoveryDecision({
  gapRows: [{
    symbol: "SOURCE_BLOCK",
    qty: 1,
    currentPrice: 100,
    ownershipClassification: "SIDECAR_MANAGED_POSITION",
    guardMetadataMissing: true,
    hasFreshValidSource: false,
    brokerChildrenPresent: false
  }],
  canonicalRows: [{ symbol: "SOURCE_BLOCK", repairEligibleNow: false }]
});
assert.equal(sidecarSourceBlocked.decision.rows[0]?.ownershipRecoveryDecision, "DO_NOT_RECOVER_NO_FRESH_GUARD_SOURCE");
assert.equal(sidecarSourceBlocked.decision.overall, "blocked_canonical_guard_source_recovery_required");
assert.equal(sidecarSourceBlocked.gate.overall, "blocked_canonical_guard_source_recovery_required");
assert.equal(sidecarSourceBlocked.gate.summary.manualExternalAdoptionReview, 0);

console.log("[OWNERSHIP_RECOVERY_SAFETY_GATES_TEST] pass cases=19 brokerMutation=false stateMutation=false multiSubmit=false");
