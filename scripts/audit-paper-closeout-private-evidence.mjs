#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildPaperExitReadiness } from "./build-live-readiness-scorecard.mjs";
import { ACTIVE_POSITION_LIMITED_RECOVERY_MODE, sha256Canonical } from "./lib/active-position-limited-recovery.mjs";

export const FILES = Object.freeze({
  preview: "last-dry-exec-preview.json",
  performance: "performance-dashboard.json",
  positionProtectionAudit: "position-protection-root-cause-audit.json",
  brokerChildReconciliation: "broker-child-order-reconciliation.json",
  orderState: "order-state-consistency-report.json",
  orderLedger: "order-ledger.json",
  orderIdempotency: "order-idempotency.json",
});
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string" && v.trim().length > 0;
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export class ContractError extends Error {}
const requireContract = (ok, code) => { if (!ok) throw new ContractError(code); };
const SAFETY = Object.freeze({
  readOnly: true, execEnabled: false, liveOrderSubmitEnabled: false, wouldCreateBrokerPayload: false,
  selectedCandidateCount: 0, entryAllowed: false, scaleInAllowed: false,
  riskIncreasingActionAllowed: false, reportOnlyExitEvaluationAllowed: true,
  brokerSubmitAllowed: false, realizedPnlVerified: false, historicalEvidenceNormalized: false,
  currentBrokerEvidenceVerified: false, stateMutationAttempted: false, brokerRequestCount: 0,
  cacheRestored: false, cacheSaved: false, privateEvidencePublished: false,
});

export function readPrivateBytes(file, expectedHash) {
  requireContract(hash(expectedHash), "PRIVATE_HASH_PIN_REQUIRED");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    requireContract(stat.isFile() && stat.size <= 50 * 1024 * 1024, "PRIVATE_INPUT_TYPE_OR_SIZE_INVALID");
    requireContract((stat.mode & 0o077) === 0 && stat.uid === process.getuid(), "PRIVATE_INPUT_PERMISSIONS_INVALID");
    const bytes = fs.readFileSync(fd);
    requireContract(digest(bytes) === expectedHash, path.basename(file) === "manifest.json" ? "PRIVATE_MANIFEST_HASH_MISMATCH" : "PRIVATE_FILE_HASH_MISMATCH");
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function readPrivate(file, expectedHash) {
  const value = JSON.parse(readPrivateBytes(file, expectedHash));
  requireContract(object(value), "PRIVATE_INPUT_SCHEMA_INVALID");
  return value;
}

function uniqueReportRows(rows) {
  requireContract(Array.isArray(rows), "PRIVATE_REPORT_SCHEMA_INVALID");
  const symbols = rows.map(r => object(r) && text(r.symbol) ? r.symbol.trim().toUpperCase() : null);
  requireContract(symbols.every(Boolean) && new Set(symbols).size === symbols.length, "PRIVATE_REPORT_ROWS_AMBIGUOUS");
  return rows;
}

export function validateTargets(targets, reports) {
  const ledger = reports.orderLedger.orders;
  const idem = reports.orderIdempotency.orders;
  requireContract(object(ledger) && object(idem) && Array.isArray(reports.orderIdempotency.releases), "PRIVATE_STATE_SCHEMA_INVALID");
  requireContract(Array.isArray(targets) && targets.length > 0, "PRIVATE_SCOPE_INVALID");
  const keys = new Set(), idemKeys = new Set(), symbols = new Set();
  let missingOriginalBrokerIdRows = 0;
  for (const target of targets) {
    requireContract(object(target) && text(target.ledgerKey) && text(target.idempotencyKey), "PRIVATE_SCOPE_INVALID");
    const l = Object.hasOwn(ledger, target.ledgerKey) ? ledger[target.ledgerKey] : null;
    const i = Object.hasOwn(idem, target.idempotencyKey) ? idem[target.idempotencyKey] : null;
    requireContract(object(l) && object(i), "PRIVATE_EXACT_ENTRY_MISSING");
    requireContract(hash(target.ledgerRecordSha256) && hash(target.idempotencyRecordSha256)
      && sha256Canonical(l) === target.ledgerRecordSha256 && sha256Canonical(i) === target.idempotencyRecordSha256, "PRIVATE_RECORD_HASH_MISMATCH");
    requireContract(l.idempotencyKey === target.idempotencyKey && text(l.symbol) && text(l.clientOrderId)
      && (l.brokerOrderId == null || text(l.brokerOrderId))
      && ["buy", "sell"].includes(l.side) && text(l.stage6File) && hash(l.stage6Hash)
      && ["symbol", "side", "clientOrderId", "stage6File", "stage6Hash"].every(k => l[k] === i[k])
      && (l.brokerOrderId ?? null) === (i.brokerOrderId ?? null), "PRIVATE_IDENTITY_LINEAGE_INVALID");
    requireContract(!keys.has(target.ledgerKey) && !idemKeys.has(target.idempotencyKey) && !symbols.has(l.symbol.toUpperCase())
      && Object.values(ledger).filter(r => r?.clientOrderId === l.clientOrderId).length === 1
      && Object.values(ledger).filter(r => r?.idempotencyKey === target.idempotencyKey).length === 1
      && (!text(l.brokerOrderId) || (Object.values(ledger).filter(r => r?.brokerOrderId === l.brokerOrderId).length === 1
        && Object.values(idem).filter(r => r?.brokerOrderId === l.brokerOrderId).length === 1))
      && Object.values(idem).filter(r => r?.clientOrderId === l.clientOrderId).length === 1, "PRIVATE_IDENTITY_AMBIGUOUS");
    requireContract(i.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE && hash(i.recoveryEvidenceSha256)
      && i.recoveryRecordedAtIsOriginalTimestamp === false && i.reportOnlyExitEvaluationAllowed === true
      && ["entryAllowed", "scaleInAllowed", "riskIncreasingActionAllowed", "brokerSubmitAllowed", "realizedPnlVerified", "historicalEvidenceNormalized"].every(k => i[k] === false), "LIMITED_CONTROL_CONTRACT_INVALID");
    keys.add(target.ledgerKey); idemKeys.add(target.idempotencyKey); symbols.add(l.symbol.toUpperCase());
    if (!text(l.brokerOrderId)) missingOriginalBrokerIdRows++;
  }
  // Do not silently omit a limited-control record from a supposedly complete private scope.
  requireContract(Object.entries(idem).filter(([, r]) => r?.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE)
    .every(([k]) => idemKeys.has(k)), "PRIVATE_LIMITED_SCOPE_INCOMPLETE");
  return { symbols, missingOriginalBrokerIdRows };
}

export function buildExactPrivateReportState({ ledger, idempotency, fillability = {} }, targets) {
  if (targets === undefined) return { ledger, idempotency, fillability };
  const { symbols } = validateTargets(targets, { orderLedger: ledger, orderIdempotency: idempotency });
  requireContract(targets.every(t => Object.entries(idempotency.orders)
    .every(([key, row]) => key === t.idempotencyKey || row?.idempotencyKey !== t.idempotencyKey)), "PRIVATE_IDENTITY_AMBIGUOUS");
  const ledgerKeys = new Set(targets.map(t => t.ledgerKey)), idemKeys = new Set(targets.map(t => t.idempotencyKey));
  const bySymbol = new Map(targets.map(t => [ledger.orders[t.ledgerKey].symbol.toUpperCase(), t]));
  const scoped = row => symbols.has(String(row?.symbol || "").toUpperCase());
  // In-memory report selection only. All original state and exit-order evidence remain intact.
  const orders = (state, keys) => Object.fromEntries(Object.entries(state.orders)
    .filter(([key, row]) => {
      if (!scoped(row) || keys.has(key)) return true;
      requireContract(text(row.clientOrderId), "PRIVATE_REPORT_IDENTITY_UNVERIFIED");
      return false;
    }));
  const releases = idempotency.releases.filter(row => {
    const target = bySymbol.get(String(row?.symbol || "").toUpperCase());
    if (!target) return true;
    const original = ledger.orders[target.ledgerKey];
    const anchors = [["key", target.idempotencyKey], ["idempotencyKey", target.idempotencyKey],
      ["clientOrderId", original.clientOrderId], ["brokerOrderId", original.brokerOrderId]].filter(([k]) => row[k] != null);
    requireContract(anchors.length > 0 && anchors.every(([k]) => text(row[k])), "PRIVATE_REPORT_IDENTITY_UNVERIFIED");
    requireContract(anchors.some(([, expected]) => text(expected)), "PRIVATE_REPORT_IDENTITY_UNVERIFIED");
    if (!anchors.some(([k, expected]) => row[k] === expected)) return false;
    requireContract(anchors.every(([k, expected]) => row[k] === expected)
      && ["side", "stage6File", "stage6Hash"].every(k => row[k] == null || row[k] === original[k]), "PRIVATE_REPORT_IDENTITY_CONFLICT");
    return true; // A release of this exact identity must remain visible as a possible terminal conflict.
  });
  requireContract(!(fillability?.rows || []).some(scoped), "PRIVATE_REPORT_IDENTITY_UNVERIFIED");
  return { ledger: { ...ledger, orders: orders(ledger, ledgerKeys) },
    idempotency: { ...idempotency, orders: orders(idempotency, idemKeys), releases }, fillability };
}

export function validateShadow(shadow) {
  uniqueReportRows(shadow?.rows);
  const counts = { exitNotDueRows: 0, scaleDownDueRows: 0, exitPartialDueRows: 0, exitFullDueRows: 0, evidenceIncompleteRows: 0 };
  const actionCount = new Map([[null, "exitNotDueRows"], ["SCALE_DOWN", "scaleDownDueRows"], ["EXIT_PARTIAL", "exitPartialDueRows"], ["EXIT_FULL", "exitFullDueRows"]]);
  for (const row of shadow.rows) {
    requireContract(["EVALUATED", "STAGE6_LINEAGE_MISSING", "STAGE6_LINEAGE_AMBIGUOUS"].includes(row.evaluationStatus)
      && actionCount.has(row.actionType) && (row.evaluationStatus === "EVALUATED" || row.actionType === null), "PRIVATE_SHADOW_CONTRACT_INVALID");
    counts[row.evaluationStatus === "EVALUATED" ? actionCount.get(row.actionType) : "evidenceIncompleteRows"]++;
  }
  requireContract(shadow.unknownOrUnclassifiedRows === 0 && shadow.evaluatedPositionRows === shadow.rows.length
    && Object.entries(counts).every(([key, value]) => Number.isSafeInteger(shadow[key]) && shadow[key] === value), "PRIVATE_SHADOW_CONTRACT_INVALID");
}

export function auditPrivateCloseoutEvidence(directory, manifestSha256) {
  const root = fs.lstatSync(directory);
  requireContract(root.isDirectory() && !root.isSymbolicLink(), "PRIVATE_DIRECTORY_INVALID");
  requireContract((root.mode & 0o077) === 0 && root.uid === process.getuid(), "PRIVATE_INPUT_PERMISSIONS_INVALID");
  const manifest = readPrivate(path.join(directory, "manifest.json"), manifestSha256);
  requireContract(manifest.schemaVersion === "paper-closeout-private-evidence-v1" && manifest.environment === "PAPER"
    && manifest.evidenceBasis === "PRESERVED_SNAPSHOT" && object(manifest.files), "PRIVATE_MANIFEST_SCHEMA_INVALID");
  requireContract(Object.keys(manifest.files).sort().join("\n") === Object.values(FILES).sort().join("\n"), "PRIVATE_FILE_SET_INVALID");
  const reports = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readPrivate(path.join(directory, file), manifest.files[file])]));
  const { symbols, missingOriginalBrokerIdRows } = validateTargets(manifest.targets, reports);
  const positions = uniqueReportRows(reports.performance.live?.positions);
  for (const key of ["positionProtectionAudit", "brokerChildReconciliation", "orderState"]) uniqueReportRows(reports[key].rows);
  if (reports.performance.privateCaptureTargets !== undefined) {
    requireContract(sha256Canonical(reports.performance.privateCaptureTargets) === sha256Canonical(manifest.targets), "PRIVATE_REPORT_TARGET_MISMATCH");
    buildExactPrivateReportState({ ledger: reports.orderLedger, idempotency: reports.orderIdempotency }, manifest.targets);
    for (const target of manifest.targets) {
      const original = reports.orderLedger.orders[target.ledgerKey];
      const find = rows => rows.find(r => r.symbol.toUpperCase() === original.symbol.toUpperCase());
      for (const rows of [positions, reports.positionProtectionAudit.rows, reports.brokerChildReconciliation.rows]) {
        const row = find(rows);
        requireContract(row?.plannedLedgerKey === target.ledgerKey && row.plannedStage6File === original.stage6File
          && row.plannedStage6Hash === original.stage6Hash, "PRIVATE_REPORT_TARGET_MISMATCH");
      }
      const row = find(reports.orderState.rows);
      requireContract(row?.plannedLedgerKey === target.ledgerKey && row.plannedIdempotencyKey === target.idempotencyKey, "PRIVATE_REPORT_TARGET_MISMATCH");
    }
  }
  const shadow = reports.preview.paperExitShadowIntent;
  validateShadow(shadow);
  requireContract(reports.preview.mode?.readOnly === true && reports.preview.mode?.execEnabled === false
    && reports.preview.actionIntent?.previewOnly === true
    && Array.isArray(reports.preview.payloads) && reports.preview.payloads.length === 0
    && shadow.mode === "REPORT_ONLY_SHADOW"
    && ["wouldCreateBrokerPayload", "brokerMutationAttempted", "brokerMutationSubmitted", "stateMutationAttempted", "stateMutationSubmitted"].every(k => shadow[k] === false), "PRIVATE_SHADOW_CONTRACT_INVALID");
  const replay = buildPaperExitReadiness(reports);
  requireContract(replay.shadowEvaluation.countMatches && replay.shadowEvaluation.unknownOrUnclassifiedRows === 0
    && shadow.evaluatedPositionRows === shadow.rows.length, "PRIVATE_SHADOW_CONTRACT_INVALID");
  requireContract([...symbols].every(symbol => positions.some(r => r.symbol.toUpperCase() === symbol)), "PRIVATE_SCOPED_POSITION_MISSING");
  requireContract([...symbols].every(symbol => reports.positionProtectionAudit.rows.some(r =>
    r.symbol.toUpperCase() === symbol && r.idempotencyStatus === "active_position_limited_control")), "PRIVATE_LIMITED_REPORT_MISMATCH");
  const count = predicate => replay.rows.filter(predicate).length;
  // Symbol-based report joins are descriptive replay only, never identity or current broker proof.
  return {
    schemaVersion: "paper-closeout-private-evidence-audit-v1",
    status: "PRIVATE_EVIDENCE_CONTRACT_VALID_CURRENT_PROOF_REQUIRED",
    evidenceBasis: "PRESERVED_SNAPSHOT", manifestSha256, inputFileCount: Object.keys(FILES).length,
    exactLimitedIdentityRows: manifest.targets.length, missingOriginalBrokerIdRows,
    snapshotPositionRows: replay.rows.length,
    unscopedPositionRows: count(r => !symbols.has(r.symbol.toUpperCase())),
    snapshotExitDueRows: count(r => ["SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"].includes(r.actionType)),
    snapshotProtectionConflictRows: count(r => r.brokerStopPresent || r.brokerTargetPresent),
    snapshotTerminalBlockedRows: count(r => r.terminalReconciliationBlocked),
    snapshotOwnershipBlockedRows: count(r => r.ownershipClassification !== "SIDECAR_MANAGED_FILLED"),
    snapshotOpenExitOrIdempotencyConflictRows: count(r => r.openExitOrderPresent || r.duplicateOpenExit || r.idempotencyConflict),
    snapshotUnresolvedIdentityRows: count(r => r.unresolvedHeldIdentity),
    unknownOrUnclassifiedRows: 0,
    nextAction: "OBTAIN_SEPARATELY_APPROVED_CURRENT_PRIVATE_BROKER_AND_STATE_EVIDENCE",
    ...SAFETY,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireContract(process.argv.length === 4, "PRIVATE_ARGUMENTS_INVALID");
    console.log(JSON.stringify(auditPrivateCloseoutEvidence(process.argv[2], process.argv[3])));
  } catch (error) {
    // Never forward parser errors, paths, OS errors or private report strings to a public console.
    const status = error instanceof ContractError ? error.message : "PRIVATE_INPUT_UNAVAILABLE";
    console.log(JSON.stringify({ schemaVersion: "paper-closeout-private-evidence-audit-v1", status, ...SAFETY }));
    process.exitCode = 1;
  }
}
