#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REQUIRED_APPROVAL = "AUTHORIZE PAPER FIVE-ROW ACTIVE LIMITED STATE RECOVERY ONE-SHOT";
const EXPECTED_CACHE_KEY = "sidecar-state-main-32742503181";
const TARGET_ROWS = 5;

class RecoveryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new RecoveryError(code); };
const isSha256 = (value) => /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
const isCanonicalIso = (value) => {
  const text = String(value || "").trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === text;
};
const readText = (file) => fs.readFileSync(file, "utf8");
const readJson = (file) => JSON.parse(readText(file));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const writeTextAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
  fs.renameSync(tmp, file);
};
const writeJsonAtomic = (file, value) => writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

const exactLineage = (candidate, ledger) => {
  if (!candidate || typeof candidate !== "object") return false;
  for (const field of ["symbol", "side", "stage6Hash", "stage6File", "clientOrderId"]) {
    if (String(candidate[field] || "") !== String(ledger[field] || "")) return false;
  }
  const candidateBroker = candidate.brokerOrderId == null ? null : String(candidate.brokerOrderId);
  const ledgerBroker = ledger.brokerOrderId == null ? null : String(ledger.brokerOrderId);
  return candidateBroker === ledgerBroker;
};

const validateEvidence = (evidence, actualSha, expectedSha) => {
  if (!isSha256(expectedSha) || actualSha !== expectedSha.toLowerCase()) fail("RECOVERY_EVIDENCE_HASH_MISMATCH");
  const required = [
    evidence?.schemaVersion === "paper-five-row-broker-evidence-safe-v1",
    evidence?.status === "PAPER_FIVE_ROW_BROKER_EVIDENCE_AGGREGATE_READY",
    evidence?.sourceCacheKey === EXPECTED_CACHE_KEY,
    evidence?.cacheExactMatch === true,
    evidence?.targetRows === TARGET_ROWS,
    evidence?.uniqueIdentityRows === TARGET_ROWS,
    evidence?.activePositionRows === TARGET_ROWS,
    evidence?.brokerFilledConfirmedRows === TARGET_ROWS,
    evidence?.zeroOrNotFoundPositionRows === 0,
    evidence?.terminalEvidenceRows === 0,
    evidence?.inconclusiveEvidenceRows === 0,
    evidence?.unknownOrUnclassifiedRows === 0,
    evidence?.orderLedgerHashParity === true,
    evidence?.idempotencyHashParity === true,
    evidence?.requestBudgetCompliant === true,
    evidence?.stateMutationAttempted === false,
    evidence?.brokerMutationAttempted === false,
    evidence?.privateEvidenceUploaded === false,
    evidence?.rawBrokerResponseStored === false,
  ];
  if (required.some((value) => !value)) fail("RECOVERY_EVIDENCE_CONTRACT_INVALID");
};

const targetAuditRows = (audit) => (Array.isArray(audit?.rows) ? audit.rows : []).filter((row) =>
  row?.requiresLedgerTerminalizationReview === true
  || row?.reconciliationDecision === "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE"
);

const makeLimitedRecord = (ledger, current, originalIdempotencyEvidenceStatus, evidenceSha, recordedAt) => ({
  ...(current || {
    symbol: ledger.symbol,
    side: ledger.side,
    executionSide: ledger.executionSide ?? null,
    actionType: ledger.actionType ?? "ENTRY_NEW",
    submittedQty: Number.isFinite(Number(ledger.submittedQty)) ? Number(ledger.submittedQty) : null,
    stage6Hash: ledger.stage6Hash,
    stage6File: ledger.stage6File,
    firstSeenAt: null,
    lastSeenAt: null,
    clientOrderId: ledger.clientOrderId,
    brokerOrderId: ledger.brokerOrderId ?? null,
    brokerStatus: null,
  }),
  recoveryMode: "ACTIVE_POSITION_LIMITED_CONTROL",
  originalIdempotencyEvidenceStatus,
  recoveryEvidenceSha256: evidenceSha,
  recoveryRecordedAt: recordedAt,
  recoveryRecordedAtIsOriginalTimestamp: false,
  entryAllowed: false,
  scaleInAllowed: false,
  riskIncreasingActionAllowed: false,
  reportOnlyExitEvaluationAllowed: true,
  brokerSubmitAllowed: false,
  realizedPnlVerified: false,
  historicalEvidenceNormalized: false,
});

const buildPlan = ({ audit, orderLedger, idempotency, evidenceSha, recordedAt, ledgerSha, idempotencySha }) => {
  const auditRows = targetAuditRows(audit);
  if (auditRows.length !== TARGET_ROWS) fail("TARGET_SCOPE_NOT_EXACTLY_FIVE");
  if (!orderLedger?.orders || !idempotency?.orders || !Array.isArray(idempotency?.releases)) {
    fail("STATE_SCHEMA_INVALID");
  }

  const seenLedgerKeys = new Set();
  const seenIdempotencyKeys = new Set();
  const proposal = [];
  for (const auditRow of auditRows) {
    const ledgerKey = String(auditRow?.ledger?.key || "").trim();
    if (!ledgerKey || seenLedgerKeys.has(ledgerKey)) fail("LEDGER_IDENTITY_SCOPE_INVALID");
    seenLedgerKeys.add(ledgerKey);
    const ledger = orderLedger.orders[ledgerKey];
    if (!ledger || typeof ledger !== "object") fail("EXACT_ORDER_LEDGER_ROW_MISSING");
    const idempotencyKey = String(ledger.idempotencyKey || "").trim();
    if (!idempotencyKey || seenIdempotencyKeys.has(idempotencyKey)) fail("IDEMPOTENCY_IDENTITY_SCOPE_INVALID");
    seenIdempotencyKeys.add(idempotencyKey);
    if (auditRow?.idempotency?.key && String(auditRow.idempotency.key) !== idempotencyKey) {
      fail("AUDIT_IDEMPOTENCY_LINEAGE_MISMATCH");
    }
    if (
      String(ledger.side || "") !== "buy"
      || !isSha256(ledger.stage6Hash)
      || !String(ledger.stage6File || "").trim()
      || !String(ledger.symbol || "").trim()
      || !String(ledger.clientOrderId || "").trim()
    ) {
      fail("ORDER_LEDGER_IMMUTABLE_LINEAGE_INVALID");
    }

    const current = idempotency.orders[idempotencyKey] || null;
    if (current?.recoveryMode === "ACTIVE_POSITION_LIMITED_CONTROL") fail("LIMITED_RECOVERY_ALREADY_APPLIED");
    if (current && !exactLineage(current, ledger)) fail("CURRENT_IDEMPOTENCY_LINEAGE_MISMATCH");
    const releases = idempotency.releases.filter((row) => row?.key === idempotencyKey);
    if (releases.length > 1) fail("LEGACY_IDEMPOTENCY_LINEAGE_AMBIGUOUS");
    if (releases.length === 1 && !exactLineage(releases[0], ledger)) fail("LEGACY_IDEMPOTENCY_LINEAGE_MISMATCH");
    const originalIdempotencyEvidenceStatus = current
      ? "EXACT_ENTRY_EXISTS"
      : releases.length === 1
        ? "LEGACY_KEY_EXACT_MATCH"
        : "HISTORICAL_EVIDENCE_IRRECOVERABLE";
    const identitySha256 = sha256(canonicalJson({
      ledgerKey,
      idempotencyKey,
      clientOrderId: ledger.clientOrderId,
      brokerOrderId: ledger.brokerOrderId ?? null,
    }));
    proposal.push({
      identitySha256,
      idempotencyKey,
      before: current,
      after: makeLimitedRecord(ledger, current, originalIdempotencyEvidenceStatus, evidenceSha, recordedAt),
      originalIdempotencyEvidenceStatus,
    });
  }
  proposal.sort((left, right) => left.identitySha256.localeCompare(right.identitySha256));
  if (new Set(proposal.map((row) => row.identitySha256)).size !== TARGET_ROWS) {
    fail("RECOVERY_IDENTITY_HASH_SCOPE_INVALID");
  }
  const deterministicProposalSha256 = sha256(canonicalJson({
    schemaVersion: "paper-active-position-limited-recovery-apply-v1",
    recoveryEvidenceSha256: evidenceSha,
    recoveryRecordedAt: recordedAt,
    preWriteOrderLedgerSha256: ledgerSha,
    preWriteIdempotencySha256: idempotencySha,
    rows: proposal.map((row) => ({ identitySha256: row.identitySha256, after: row.after })),
  }));
  return { proposal, deterministicProposalSha256 };
};

const verifyPostWrite = ({ before, after, plan, evidenceSha, recordedAt }) => {
  if (!after?.orders || !Array.isArray(after?.releases)) fail("POST_VERIFY_STATE_SCHEMA_INVALID");
  const targetKeys = new Set(plan.proposal.map((row) => row.idempotencyKey));
  const beforeOther = Object.fromEntries(Object.entries(before.orders).filter(([key]) => !targetKeys.has(key)));
  const afterOther = Object.fromEntries(Object.entries(after.orders).filter(([key]) => !targetKeys.has(key)));
  if (canonicalJson(beforeOther) !== canonicalJson(afterOther)) fail("POST_VERIFY_UNRELATED_ENTRY_CHANGED");
  if (canonicalJson(before.releases) !== canonicalJson(after.releases)) fail("POST_VERIFY_RELEASES_CHANGED");

  let verified = 0;
  for (const proposalRow of plan.proposal) {
    const current = after.orders[proposalRow.idempotencyKey];
    if (!current) fail("POST_VERIFY_TARGET_ENTRY_MISSING");
    const required = [
      current.recoveryMode === "ACTIVE_POSITION_LIMITED_CONTROL",
      current.recoveryEvidenceSha256 === evidenceSha,
      current.recoveryRecordedAt === recordedAt,
      current.recoveryRecordedAtIsOriginalTimestamp === false,
      current.entryAllowed === false,
      current.scaleInAllowed === false,
      current.riskIncreasingActionAllowed === false,
      current.reportOnlyExitEvaluationAllowed === true,
      current.brokerSubmitAllowed === false,
      current.realizedPnlVerified === false,
      current.historicalEvidenceNormalized === false,
      (proposalRow.before?.firstSeenAt ?? null) === (current.firstSeenAt ?? null),
      (proposalRow.before?.lastSeenAt ?? null) === (current.lastSeenAt ?? null),
      (proposalRow.after.brokerOrderId ?? null) === (current.brokerOrderId ?? null),
      (proposalRow.after.brokerStatus ?? null) === (current.brokerStatus ?? null),
    ];
    if (required.some((value) => !value)) fail("POST_VERIFY_TARGET_CONTRACT_INVALID");
    verified += 1;
  }
  if (verified !== TARGET_ROWS) fail("POST_VERIFY_SCOPE_MISMATCH");
  return verified;
};

const safeReport = ({ status, evidenceSha, recordedAt, ledgerSha, idempotencySha, plan = null }) => ({
  schemaVersion: "paper-active-position-limited-recovery-apply-safe-v1",
  mode: "PAPER_STATE_ONLY_ACTIVE_POSITION_LIMITED_RECOVERY",
  status,
  sourceCacheKey: EXPECTED_CACHE_KEY,
  preservedBrokerEvidenceRunId: 32821694326,
  recoveryEvidenceSha256: evidenceSha || null,
  recoveryRecordedAt: recordedAt || null,
  recoveryRecordedAtIsOriginalTimestamp: false,
  preWriteOrderLedgerSha256: ledgerSha || null,
  preWriteIdempotencySha256: idempotencySha || null,
  deterministicProposalSha256: plan?.deterministicProposalSha256 || null,
  postWriteOrderLedgerSha256: null,
  postWriteIdempotencySha256: null,
  backupSha256: null,
  summary: {
    targetRows: plan?.proposal.length ?? 0,
    uniqueIdentityRows: plan ? new Set(plan.proposal.map((row) => row.identitySha256)).size : 0,
    exactExistingEntryRows: plan?.proposal.filter((row) => row.originalIdempotencyEvidenceStatus === "EXACT_ENTRY_EXISTS").length ?? 0,
    legacyExactRows: plan?.proposal.filter((row) => row.originalIdempotencyEvidenceStatus === "LEGACY_KEY_EXACT_MATCH").length ?? 0,
    historyIrrecoverableLimitedRows: plan?.proposal.filter((row) => row.originalIdempotencyEvidenceStatus === "HISTORICAL_EVIDENCE_IRRECOVERABLE").length ?? 0,
    appliedRows: 0,
    postVerifiedRows: 0,
    originalTimestampFabricationRows: 0,
    entryEligibleRows: 0,
    scaleInEligibleRows: 0,
    brokerSubmitAllowedRows: 0,
    realizedPnlVerifiedRows: 0,
    unknownOrUnclassifiedRows: 0,
  },
  stateMutationAttempted: false,
  stateMutationApplied: false,
  orderLedgerMutationApplied: false,
  partialRecoveryApplied: false,
  rollbackApplied: false,
  brokerRequestAttempted: false,
  brokerMutationAttempted: false,
  privateIdentifiersStoredOrPrinted: false,
  rawBrokerResponseStored: false,
  stage6PolicyChanged: false,
});

const main = () => {
  const stateDir = String(process.env.ACTIVE_LIMITED_RECOVERY_STATE_DIR || "state").trim();
  const output = String(process.env.ACTIVE_LIMITED_RECOVERY_OUTPUT || "safe-output/paper-active-limited-recovery-safe.json").trim();
  const backupDir = String(process.env.ACTIVE_LIMITED_RECOVERY_BACKUP_DIR || path.join(stateDir, "limited-recovery-backup")).trim();
  const evidenceFile = String(process.env.ACTIVE_LIMITED_RECOVERY_EVIDENCE_FILE || "").trim();
  const evidenceSha = String(process.env.ACTIVE_LIMITED_RECOVERY_EVIDENCE_SHA256 || "").trim().toLowerCase();
  const expectedLedgerSha = String(process.env.ACTIVE_LIMITED_RECOVERY_EXPECTED_ORDER_LEDGER_SHA256 || "").trim().toLowerCase();
  const expectedIdempotencySha = String(process.env.ACTIVE_LIMITED_RECOVERY_EXPECTED_IDEMPOTENCY_SHA256 || "").trim().toLowerCase();
  const recordedAt = String(process.env.ACTIVE_LIMITED_RECOVERY_RECORDED_AT || "").trim();
  const applyRequested = String(process.env.ACTIVE_LIMITED_RECOVERY_APPLY || "false").trim().toLowerCase() === "true";
  const approval = String(process.env.ACTIVE_LIMITED_RECOVERY_APPROVAL || "").trim();
  const files = {
    audit: path.join(stateDir, "fill-state-reconciliation-audit.json"),
    ledger: path.join(stateDir, "order-ledger.json"),
    idempotency: path.join(stateDir, "order-idempotency.json"),
  };
  let report = safeReport({ status: "PREFLIGHT_PENDING", evidenceSha, recordedAt, ledgerSha: expectedLedgerSha, idempotencySha: expectedIdempotencySha });
  let backupText = null;

  try {
    if (!evidenceFile || !Object.values(files).every(fs.existsSync) || !fs.existsSync(evidenceFile)) fail("REQUIRED_INPUT_MISSING");
    if (!isCanonicalIso(recordedAt)) fail("RECOVERY_RECORDED_AT_INVALID");
    if (!isSha256(expectedLedgerSha) || !isSha256(expectedIdempotencySha)) fail("EXPECTED_STATE_HASH_INVALID");
    const actualEvidenceSha = sha256File(evidenceFile);
    validateEvidence(readJson(evidenceFile), actualEvidenceSha, evidenceSha);
    const ledgerText = readText(files.ledger);
    const idempotencyText = readText(files.idempotency);
    const ledgerSha = sha256(Buffer.from(ledgerText));
    const idempotencySha = sha256(Buffer.from(idempotencyText));
    if (ledgerSha !== expectedLedgerSha || idempotencySha !== expectedIdempotencySha) fail("PRE_WRITE_STATE_HASH_DRIFT");
    const orderLedger = JSON.parse(ledgerText);
    const idempotency = JSON.parse(idempotencyText);
    const plan = buildPlan({
      audit: readJson(files.audit),
      orderLedger,
      idempotency,
      evidenceSha,
      recordedAt,
      ledgerSha,
      idempotencySha,
    });
    report = safeReport({
      status: applyRequested ? "APPLY_READY" : "PAPER_ACTIVE_LIMITED_RECOVERY_STATIC_READY",
      evidenceSha,
      recordedAt,
      ledgerSha,
      idempotencySha,
      plan,
    });
    if (!applyRequested) {
      writeJsonAtomic(output, report);
      console.log(`[ACTIVE_LIMITED_RECOVERY] status=${report.status} rows=${report.summary.targetRows}`);
      return;
    }
    if (approval !== REQUIRED_APPROVAL) fail("APPROVAL_PHRASE_MISMATCH");
    const backupFile = path.join(backupDir, "order-idempotency.json.before");
    if (fs.existsSync(backupFile)) fail("BACKUP_ALREADY_EXISTS");
    writeTextAtomic(backupFile, idempotencyText);
    backupText = idempotencyText;
    if (sha256File(backupFile) !== idempotencySha) fail("ATOMIC_BACKUP_VERIFY_FAILED");

    const next = JSON.parse(idempotencyText);
    for (const row of plan.proposal) next.orders[row.idempotencyKey] = row.after;
    next.updatedAt = recordedAt;
    report.stateMutationAttempted = true;
    writeJsonAtomic(files.idempotency, next);
    const post = readJson(files.idempotency);
    const postVerifiedRows = verifyPostWrite({ before: idempotency, after: post, plan, evidenceSha, recordedAt });
    const postLedgerSha = sha256File(files.ledger);
    if (postLedgerSha !== ledgerSha) fail("POST_VERIFY_ORDER_LEDGER_CHANGED");
    report = {
      ...report,
      status: "PAPER_ACTIVE_LIMITED_RECOVERY_APPLIED_AND_VERIFIED",
      postWriteOrderLedgerSha256: postLedgerSha,
      postWriteIdempotencySha256: sha256File(files.idempotency),
      backupSha256: sha256File(backupFile),
      summary: { ...report.summary, appliedRows: TARGET_ROWS, postVerifiedRows },
      stateMutationAttempted: true,
      stateMutationApplied: true,
    };
    writeJsonAtomic(output, report);
    console.log(`[ACTIVE_LIMITED_RECOVERY] status=${report.status} rows=${report.summary.appliedRows}`);
  } catch (error) {
    const code = error instanceof RecoveryError ? error.code : "UNEXPECTED_RECOVERY_ERROR";
    let rollbackApplied = false;
    if (backupText != null) {
      try {
        writeTextAtomic(files.idempotency, backupText);
        rollbackApplied = sha256File(files.idempotency) === expectedIdempotencySha;
      } catch {
        rollbackApplied = false;
      }
    }
    report = {
      ...report,
      status: rollbackApplied ? "RECOVERY_FAILED_ROLLED_BACK" : code,
      errorCategory: code,
      stateMutationApplied: false,
      partialRecoveryApplied: false,
      rollbackApplied,
    };
    try { writeJsonAtomic(output, report); } catch { /* runner logs only the safe category below */ }
    console.error(`[ACTIVE_LIMITED_RECOVERY] status=${report.status}`);
    process.exitCode = 1;
  }
};

main();
