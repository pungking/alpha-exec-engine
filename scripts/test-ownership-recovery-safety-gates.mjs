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

console.log("[OWNERSHIP_RECOVERY_SAFETY_GATES_TEST] pass cases=7 brokerMutation=false stateMutation=false multiSubmit=false");
