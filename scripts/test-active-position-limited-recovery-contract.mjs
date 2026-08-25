#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  ACTIVE_POSITION_LIMITED_RECOVERY_MODE,
  buildActivePositionLimitedRecoveryPlan,
  classifyActivePositionLimitedRecoveryRow,
} from "./lib/active-position-limited-recovery.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const RECOVERY_EVIDENCE_SHA = "f".repeat(64);
const RECORDED_AT = "2026-08-25T08:00:00.000Z";

const baseRow = (identitySha256) => ({
  identitySha256,
  identityCandidateCount: 1,
  currentPositionVerified: true,
  currentEvidenceStatus: "VERIFIED",
  brokerFillVerified: true,
  brokerFillIdentityExact: true,
  legacyIdentityExact: false,
  historicalEvidenceIrrecoverable: false,
  externalOrManualPosition: false,
  openOrderCount: 0,
  protectiveChildCount: 0,
  protectiveChildStateKnown: true,
  originalTimestampFabricated: false,
});

const legacy = classifyActivePositionLimitedRecoveryRow({
  ...baseRow(HASH_A),
  legacyIdentityExact: true,
});
assert.equal(legacy.disposition, "ACTIVE_RECOVERY_LEGACY_IDENTITY_EXACT");

const brokerFill = classifyActivePositionLimitedRecoveryRow(baseRow(HASH_B));
assert.equal(brokerFill.disposition, "ACTIVE_RECOVERY_BROKER_FILL_EXACT");

const irrecoverable = classifyActivePositionLimitedRecoveryRow({
  ...baseRow(HASH_C),
  brokerFillIdentityExact: false,
  historicalEvidenceIrrecoverable: true,
});
assert.equal(irrecoverable.disposition, "ACTIVE_RECOVERY_HISTORY_IRRECOVERABLE_LIMITED");

const openOrder = classifyActivePositionLimitedRecoveryRow({
  ...baseRow(HASH_D),
  openOrderCount: 1,
});
assert.equal(openOrder.disposition, "ACTIVE_RECOVERY_BLOCKED_OPEN_ORDER");

const protection = classifyActivePositionLimitedRecoveryRow({
  ...baseRow(HASH_E),
  protectiveChildCount: 1,
});
assert.equal(protection.disposition, "ACTIVE_RECOVERY_BLOCKED_PROTECTION");

const staleCurrentEvidence = classifyActivePositionLimitedRecoveryRow({
  ...baseRow("1".repeat(64)),
  currentEvidenceStatus: "STALE",
});
assert.equal(staleCurrentEvidence.disposition, "ACTIVE_RECOVERY_BLOCKED_CURRENT_EVIDENCE");

for (const row of [legacy, brokerFill, irrecoverable, openOrder, protection]) {
  assert.equal(row.recoveryMode, ACTIVE_POSITION_LIMITED_RECOVERY_MODE);
  assert.equal(row.entryAllowed, false);
  assert.equal(row.scaleInAllowed, false);
  assert.equal(row.riskIncreasingActionAllowed, false);
  assert.equal(row.reportOnlyExitEvaluationAllowed, true);
  assert.equal(row.brokerSubmitAllowed, false);
  assert.equal(row.realizedPnlVerified, false);
  assert.equal(row.historicalEvidenceNormalized, false);
  assert.equal(row.recoveryRecordedAtIsOriginalTimestamp, false);
}

const planInput = {
  rows: [legacy, brokerFill, irrecoverable, openOrder, protection].map((row) => row.sourceEvidence),
  recoveryEvidenceSha256: RECOVERY_EVIDENCE_SHA,
  recoveryRecordedAt: RECORDED_AT,
  preWriteOrderLedgerSha256: HASH_A,
  preWriteIdempotencySha256: HASH_B,
};
const plan = buildActivePositionLimitedRecoveryPlan(planInput);
const rerun = buildActivePositionLimitedRecoveryPlan(planInput);
const reordered = buildActivePositionLimitedRecoveryPlan({
  ...planInput,
  rows: [...planInput.rows].reverse(),
});

assert.equal(plan.status, "PAPER_ACTIVE_LIMITED_RECOVERY_STATIC_READY");
assert.equal(plan.summary.targetRows, 5);
assert.equal(plan.summary.uniqueIdentityRows, 5);
assert.equal(plan.summary.currentBrokerPositionVerifiedRows, 5);
assert.equal(plan.summary.brokerFillLineageVerifiedRows, 5);
assert.equal(plan.summary.proposalReadyRows, 5);
assert.equal(plan.summary.unknownOrUnclassifiedRows, 0);
assert.equal(plan.summary.entryEligibleRows, 0);
assert.equal(plan.summary.scaleInEligibleRows, 0);
assert.equal(plan.summary.brokerSubmitAllowedRows, 0);
assert.equal(plan.summary.realizedPnlVerifiedRows, 0);
assert.equal(plan.summary.originalTimestampFabricationRows, 0);
assert.equal(plan.stateWriteAuthorized, false);
assert.equal(plan.brokerMutationAttempted, false);
assert.equal(plan.stateMutationAttempted, false);
assert.match(plan.deterministicProposalSha256, /^[a-f0-9]{64}$/);
assert.equal(plan.deterministicProposalSha256, rerun.deterministicProposalSha256);
assert.deepEqual(plan, rerun);
assert.equal(plan.deterministicProposalSha256, reordered.deterministicProposalSha256);
assert.deepEqual(plan.rows, reordered.rows);

const ambiguousPlan = buildActivePositionLimitedRecoveryPlan({
  ...planInput,
  rows: planInput.rows.map((row, index) => index === 0
    ? { ...row, identityCandidateCount: 2 }
    : row),
});
assert.equal(ambiguousPlan.status, "PAPER_ACTIVE_POSITION_RECOVERY_UNSAFE");
assert.equal(ambiguousPlan.summary.ambiguousIdentityRows, 1);
assert.equal(ambiguousPlan.summary.proposalReadyRows, 0);
assert.equal(ambiguousPlan.selectedCandidateCount, 0);

const serialized = JSON.stringify(plan);
for (const forbidden of [
  "symbol",
  "accountId",
  "quantity",
  "orderId",
  "clientOrderId",
  "brokerOrderId",
]) {
  assert.equal(serialized.includes(`\"${forbidden}\"`), false, `private field leaked: ${forbidden}`);
}

console.log("active_position_limited_recovery_contract_test=PASS");
