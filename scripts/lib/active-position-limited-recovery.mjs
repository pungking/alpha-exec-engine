import { createHash } from "node:crypto";

export const ACTIVE_POSITION_LIMITED_RECOVERY_MODE = "ACTIVE_POSITION_LIMITED_CONTROL";

const DISPOSITIONS = new Set([
  "ACTIVE_RECOVERY_LEGACY_IDENTITY_EXACT",
  "ACTIVE_RECOVERY_BROKER_FILL_EXACT",
  "ACTIVE_RECOVERY_HISTORY_IRRECOVERABLE_LIMITED",
  "ACTIVE_RECOVERY_BLOCKED_OPEN_ORDER",
  "ACTIVE_RECOVERY_BLOCKED_PROTECTION",
  "ACTIVE_RECOVERY_BLOCKED_IDENTITY_AMBIGUOUS",
  "ACTIVE_RECOVERY_BLOCKED_CURRENT_EVIDENCE",
  "ACTIVE_RECOVERY_EXTERNAL_OR_MANUAL_POSITION",
]);

const isSha256 = (value) => /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0 ? value : null;
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
};
const sha256Canonical = (value) => createHash("sha256")
  .update(JSON.stringify(canonicalize(value)))
  .digest("hex");

const limitedControlSemantics = Object.freeze({
  recoveryMode: ACTIVE_POSITION_LIMITED_RECOVERY_MODE,
  recoveryRecordedAtIsOriginalTimestamp: false,
  entryAllowed: false,
  scaleInAllowed: false,
  riskIncreasingActionAllowed: false,
  reportOnlyExitEvaluationAllowed: true,
  brokerSubmitAllowed: false,
  realizedPnlVerified: false,
  historicalEvidenceNormalized: false,
});

const safeSourceEvidence = (row = {}) => ({
  identitySha256: String(row.identitySha256 || "").trim().toLowerCase(),
  identityCandidateCount: nonNegativeInteger(row.identityCandidateCount),
  currentPositionVerified: row.currentPositionVerified === true,
  currentEvidenceStatus: String(row.currentEvidenceStatus || "").trim().toUpperCase(),
  brokerFillVerified: row.brokerFillVerified === true,
  brokerFillIdentityExact: row.brokerFillIdentityExact === true,
  legacyIdentityExact: row.legacyIdentityExact === true,
  historicalEvidenceIrrecoverable: row.historicalEvidenceIrrecoverable === true,
  externalOrManualPosition: row.externalOrManualPosition === true,
  openOrderCount: nonNegativeInteger(row.openOrderCount),
  protectiveChildCount: nonNegativeInteger(row.protectiveChildCount),
  protectiveChildStateKnown: row.protectiveChildStateKnown === true,
  originalTimestampFabricated: row.originalTimestampFabricated === true,
});

export const classifyActivePositionLimitedRecoveryRow = (rawRow = {}) => {
  const row = safeSourceEvidence(rawRow);
  let disposition;

  if (!isSha256(row.identitySha256) || row.identityCandidateCount !== 1) {
    disposition = "ACTIVE_RECOVERY_BLOCKED_IDENTITY_AMBIGUOUS";
  } else if (
    row.currentEvidenceStatus !== "VERIFIED"
    || !row.currentPositionVerified
    || !row.brokerFillVerified
  ) {
    disposition = "ACTIVE_RECOVERY_BLOCKED_CURRENT_EVIDENCE";
  } else if (row.externalOrManualPosition) {
    disposition = "ACTIVE_RECOVERY_EXTERNAL_OR_MANUAL_POSITION";
  } else if (!row.protectiveChildStateKnown || (row.protectiveChildCount ?? 0) > 0) {
    disposition = "ACTIVE_RECOVERY_BLOCKED_PROTECTION";
  } else if ((row.openOrderCount ?? 0) > 0) {
    disposition = "ACTIVE_RECOVERY_BLOCKED_OPEN_ORDER";
  } else if (row.legacyIdentityExact) {
    disposition = "ACTIVE_RECOVERY_LEGACY_IDENTITY_EXACT";
  } else if (row.brokerFillIdentityExact) {
    disposition = "ACTIVE_RECOVERY_BROKER_FILL_EXACT";
  } else if (row.historicalEvidenceIrrecoverable) {
    disposition = "ACTIVE_RECOVERY_HISTORY_IRRECOVERABLE_LIMITED";
  } else {
    disposition = "ACTIVE_RECOVERY_BLOCKED_IDENTITY_AMBIGUOUS";
  }

  const originalIdempotencyEvidenceStatus = row.legacyIdentityExact
    ? "LEGACY_KEY_EXACT_MATCH"
    : row.historicalEvidenceIrrecoverable
      ? "HISTORICAL_EVIDENCE_IRRECOVERABLE"
      : row.brokerFillIdentityExact
        ? "ENTRY_ABSENT_BROKER_FILL_EXACT"
        : "ORIGINAL_IDEMPOTENCY_EVIDENCE_UNRESOLVED";
  const representationReady = Boolean(
    DISPOSITIONS.has(disposition)
    && isSha256(row.identitySha256)
    && row.identityCandidateCount === 1
    && row.currentEvidenceStatus === "VERIFIED"
    && row.currentPositionVerified
    && row.brokerFillVerified
    && !row.originalTimestampFabricated
  );

  return {
    sourceEvidence: row,
    identitySha256: row.identitySha256,
    disposition,
    originalIdempotencyEvidenceStatus,
    representationReady,
    ...limitedControlSemantics,
  };
};

export const buildActivePositionLimitedRecoveryPlan = ({
  rows = [],
  recoveryEvidenceSha256,
  recoveryRecordedAt,
  preWriteOrderLedgerSha256,
  preWriteIdempotencySha256,
} = {}) => {
  const recordedAt = String(recoveryRecordedAt || "").trim();
  const recordedAtValid = Number.isFinite(Date.parse(recordedAt)) && new Date(Date.parse(recordedAt)).toISOString() === recordedAt;
  const hashesValid = [recoveryEvidenceSha256, preWriteOrderLedgerSha256, preWriteIdempotencySha256].every(isSha256);
  const classifiedRows = (Array.isArray(rows) ? rows : [])
    .map(classifyActivePositionLimitedRecoveryRow)
    .sort((left, right) =>
      left.identitySha256.localeCompare(right.identitySha256)
      || left.disposition.localeCompare(right.disposition)
    );
  const identityHashes = classifiedRows.map((row) => row.identitySha256).filter(isSha256);
  const uniqueIdentityRows = new Set(identityHashes).size;
  const ambiguousIdentityRows = classifiedRows.filter((row) =>
    row.disposition === "ACTIVE_RECOVERY_BLOCKED_IDENTITY_AMBIGUOUS"
  ).length;
  const currentBrokerPositionVerifiedRows = classifiedRows.filter((row) =>
    row.sourceEvidence.currentPositionVerified && row.sourceEvidence.currentEvidenceStatus === "VERIFIED"
  ).length;
  const brokerFillLineageVerifiedRows = classifiedRows.filter((row) => row.sourceEvidence.brokerFillVerified).length;
  const originalTimestampFabricationRows = classifiedRows.filter((row) => row.sourceEvidence.originalTimestampFabricated).length;
  const representationReady = Boolean(
    classifiedRows.length === 5
    && uniqueIdentityRows === 5
    && currentBrokerPositionVerifiedRows === 5
    && brokerFillLineageVerifiedRows === 5
    && ambiguousIdentityRows === 0
    && originalTimestampFabricationRows === 0
    && hashesValid
    && recordedAtValid
    && classifiedRows.every((row) => row.representationReady)
  );
  const proposalRows = classifiedRows.map((row) => ({
    identitySha256: row.identitySha256,
    disposition: row.disposition,
    recoveryMode: row.recoveryMode,
    originalIdempotencyEvidenceStatus: row.originalIdempotencyEvidenceStatus,
    recoveryEvidenceSha256: String(recoveryEvidenceSha256 || "").trim().toLowerCase(),
    recoveryRecordedAt: recordedAt,
    recoveryRecordedAtIsOriginalTimestamp: false,
    entryAllowed: false,
    scaleInAllowed: false,
    riskIncreasingActionAllowed: false,
    reportOnlyExitEvaluationAllowed: true,
    brokerSubmitAllowed: false,
    realizedPnlVerified: false,
    historicalEvidenceNormalized: false,
  }));
  const deterministicProposalSha256 = sha256Canonical({
    schemaVersion: "paper-active-position-limited-recovery-v1",
    recoveryEvidenceSha256: String(recoveryEvidenceSha256 || "").trim().toLowerCase(),
    recoveryRecordedAt: recordedAt,
    preWriteOrderLedgerSha256: String(preWriteOrderLedgerSha256 || "").trim().toLowerCase(),
    preWriteIdempotencySha256: String(preWriteIdempotencySha256 || "").trim().toLowerCase(),
    rows: proposalRows,
  });

  return {
    schemaVersion: "paper-active-position-limited-recovery-v1",
    mode: "REPORT_ONLY_STATIC_CONTRACT",
    status: representationReady
      ? "PAPER_ACTIVE_LIMITED_RECOVERY_STATIC_READY"
      : "PAPER_ACTIVE_POSITION_RECOVERY_UNSAFE",
    recoveryMode: ACTIVE_POSITION_LIMITED_RECOVERY_MODE,
    recoveryEvidenceSha256: String(recoveryEvidenceSha256 || "").trim().toLowerCase(),
    recoveryRecordedAt: recordedAt,
    recoveryRecordedAtIsOriginalTimestamp: false,
    preWriteOrderLedgerSha256: String(preWriteOrderLedgerSha256 || "").trim().toLowerCase(),
    preWriteIdempotencySha256: String(preWriteIdempotencySha256 || "").trim().toLowerCase(),
    deterministicProposalSha256,
    summary: {
      targetRows: classifiedRows.length,
      uniqueIdentityRows,
      currentBrokerPositionVerifiedRows,
      brokerFillLineageVerifiedRows,
      legacyExactRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_LEGACY_IDENTITY_EXACT").length,
      brokerFillExactRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_BROKER_FILL_EXACT").length,
      historyIrrecoverableLimitedRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_HISTORY_IRRECOVERABLE_LIMITED").length,
      openOrderBlockedRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_BLOCKED_OPEN_ORDER").length,
      protectionBlockedRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_BLOCKED_PROTECTION").length,
      ambiguousIdentityRows,
      evidenceUnavailableRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_BLOCKED_CURRENT_EVIDENCE").length,
      externalOrManualRows: classifiedRows.filter((row) => row.disposition === "ACTIVE_RECOVERY_EXTERNAL_OR_MANUAL_POSITION").length,
      proposalReadyRows: representationReady ? 5 : 0,
      entryEligibleRows: 0,
      scaleInEligibleRows: 0,
      brokerSubmitAllowedRows: 0,
      realizedPnlVerifiedRows: 0,
      originalTimestampFabricationRows,
      unknownOrUnclassifiedRows: classifiedRows.filter((row) => !DISPOSITIONS.has(row.disposition)).length,
    },
    rows: proposalRows,
    selectedCandidateCount: 0,
    stateWriteAuthorized: false,
    brokerMutationAttempted: false,
    stateMutationAttempted: false,
    privateIdentifiersStoredOrPrinted: false,
  };
};
