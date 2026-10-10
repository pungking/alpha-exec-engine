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

export function validatePrivatePreview(preview, historicalContextOnly = false) {
  const shadow = preview.paperExitShadowIntent;
  validateShadow(shadow);
  requireContract(preview.mode?.readOnly === true && preview.mode?.execEnabled === false
    && preview.actionIntent?.previewOnly === true && Array.isArray(preview.payloads)
    && (historicalContextOnly || preview.payloads.length === 0)
    && shadow.mode === "REPORT_ONLY_SHADOW"
    && ["wouldCreateBrokerPayload", "brokerMutationAttempted", "brokerMutationSubmitted", "stateMutationAttempted", "stateMutationSubmitted"]
      .every(k => shadow[k] === false), "PRIVATE_SHADOW_CONTRACT_INVALID");
}

export const HISTORICAL_SOURCE_USAGE = "HISTORICAL_CONTEXT_ONLY_NO_EXECUTION";
export const HISTORICAL_AUXILIARY_FILES = Object.freeze([
  "fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json",
]);

export function validateHistoricalReviewSource(manifest, values) {
  requireContract(manifest.schemaVersion === "paper-private-capture-source-v2" && manifest.environment === "PAPER"
    && manifest.evidenceBasis === "PRESERVED_STATE_SNAPSHOT" && /^\d+$/.test(manifest.sourceRunId)
    && hash(manifest.expectedPaperAccountSha256) && manifest.sourceUsage === HISTORICAL_SOURCE_USAGE,
  "CAPTURE_SOURCE_MANIFEST_INVALID");
  const required = [FILES.preview, FILES.orderLedger, FILES.orderIdempotency, FILES.performance];
  requireContract(object(manifest.files) && required.every(n => Object.hasOwn(manifest.files, n))
    && Object.keys(manifest.files).every(n => [...required, ...HISTORICAL_AUXILIARY_FILES].includes(n)), "CAPTURE_SOURCE_FILE_SET_INVALID");
  const positions = uniqueReportRows(values[FILES.performance]?.live?.positions);
  requireContract(positions.every(r => r.qty != null && String(r.qty).trim()
    && Number.isFinite(Number(r.qty)) && Number(r.qty) > 0), "CAPTURE_BASELINE_PORTFOLIO_INVALID");
  validatePrivatePreview(values[FILES.preview], true);
  const symbols = rows => rows.map(r => r.symbol.trim().toUpperCase()).sort().join("\n");
  requireContract(symbols(positions) === symbols(values[FILES.preview].paperExitShadowIntent.rows), "CAPTURE_BASELINE_PORTFOLIO_INVALID");
  return positions;
}

function auditHistoricalReviewSource(directory, manifest, reports) {
  const archive = path.join(directory, "preserved-source");
  const stat = fs.lstatSync(archive);
  requireContract(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0, "PRIVATE_INPUT_PERMISSIONS_INVALID");
  const source = readPrivate(path.join(archive, "source-manifest.json"), manifest.sourceManifestSha256);
  requireContract(object(source.files), "CAPTURE_SOURCE_MANIFEST_INVALID");
  requireContract(Object.keys(source.files).every(n => [FILES.preview, FILES.orderLedger, FILES.orderIdempotency,
    FILES.performance, ...HISTORICAL_AUXILIARY_FILES].includes(n)), "CAPTURE_SOURCE_FILE_SET_INVALID");
  const values = Object.fromEntries(Object.entries(source.files).map(([name, pin]) => [name, readPrivate(path.join(archive, name), pin)]));
  const baseline = validateHistoricalReviewSource(source, values);
  requireContract([FILES.preview, FILES.orderLedger, FILES.orderIdempotency].every(n => manifest.files[n] === source.files[n]), "PRIVATE_FILE_HASH_MISMATCH");
  requireContract(manifest.sourceUsage === HISTORICAL_SOURCE_USAGE && reports.performance.sourceUsage === HISTORICAL_SOURCE_USAGE
    && Array.isArray(reports.performance.privateCaptureTargets), "PRIVATE_REVIEW_ISOLATION_INVALID");
  requireContract(reports.performance.realizedPnl === null && reports.performance.realizedPnlEvaluationStatus === "NOT_EVALUATED_REVIEW_ONLY",
    "PRIVATE_REVIEW_ISOLATION_INVALID");
  requireContract(["fillability", "preview", "positionLifecycleGuardSourcePlan"]
    .every(k => reports.positionProtectionAudit.files?.[k] === false)
    && reports.orderState.files?.fillability === false
    && reports.brokerChildReconciliation.files?.positionLifecycleGuardSourcePlan === false
    && ["lifecycleGuardSourceOverall", "stage6File", "stage6Hash"]
      .every(k => reports.positionProtectionAudit.source?.[k] === null)
    && reports.brokerChildReconciliation.source?.lifecycleGuardSourceOverall === null, "PRIVATE_REVIEW_ISOLATION_INVALID");
  const exposure = rows => rows.map(r => [r.symbol.toUpperCase(), Number(r.qty)]).sort((a, b) => a[0].localeCompare(b[0]));
  requireContract(sha256Canonical(exposure(baseline)) === sha256Canonical(exposure(reports.performance.live.positions)), "CAPTURE_PREVIEW_PORTFOLIO_CHANGED");
  return { historicalPayloadRows: values[FILES.preview].payloads.length,
    preservedSourceFileCount: Object.keys(source.files).length,
    quarantinedAuxiliaryFileCount: HISTORICAL_AUXILIARY_FILES.filter(n => Object.hasOwn(source.files, n)).length };
}

const exactFields = (value, fields) => object(value)
  && Object.keys(value).sort().join("\n") === [...fields].sort().join("\n");
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const TARGET_FIELDS = ["ledgerKey", "idempotencyKey", "ledgerRecordSha256", "idempotencyRecordSha256"];
const RISK_FIELDS = ["maxOrderNotional", "maxTotalNotional", "maxSpreadBps", "maxSlippageBps", "maxEvidenceAgeSeconds"];

// Compare decimal JSON-number representations exactly; no rounding or cap tolerance.
function decimalRatio(value) {
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const units = BigInt(whole + fraction), scale = fraction.length - Number(exponent);
  return scale >= 0 ? [units, 10n ** BigInt(scale)] : [units * 10n ** BigInt(-scale), 1n];
}
const withinCap = ([n, d], cap) => {
  const [cn, cd] = decimalRatio(cap);
  return n * cd <= cn * d;
};

function validateLimitedCloseoutTerms(scope, manifest, reports, manifestSha256, accountSha256) {
  requireContract(object(scope), "LIMITED_CLOSEOUT_TERMS_SCHEMA_INVALID");
  requireContract(Object.hasOwn(scope, "riskLimits"), "LIMITED_CLOSEOUT_RISK_LIMITS_INVALID");
  requireContract(exactFields(scope, ["schemaVersion", "environment", "manifestSha256", "accountSha256", "riskLimits", "targets"])
    && scope.schemaVersion === "paper-limited-control-closeout-terms-v1" && scope.environment === "PAPER", "LIMITED_CLOSEOUT_TERMS_SCHEMA_INVALID");
  requireContract(scope.manifestSha256 === manifestSha256, "LIMITED_CLOSEOUT_SCOPE_PIN_MISMATCH");
  requireContract(hash(scope.accountSha256) && scope.accountSha256 === accountSha256, "LIMITED_CLOSEOUT_ACCOUNT_PIN_MISMATCH");
  const limits = scope.riskLimits;
  requireContract(exactFields(limits, RISK_FIELDS) && RISK_FIELDS.every(k => positive(limits[k]))
    && limits.maxOrderNotional <= limits.maxTotalNotional, "LIMITED_CLOSEOUT_RISK_LIMITS_INVALID");
  requireContract(Array.isArray(scope.targets) && scope.targets.length === 5
    && scope.targets.every(object) && new Set(scope.targets.map(t => t.ledgerKey)).size === 5, "LIMITED_CLOSEOUT_EXACT_FIVE_SCOPE_REQUIRED");
  const existingKeys = new Set([...Object.keys(reports.orderLedger.orders), ...Object.keys(reports.orderIdempotency.orders),
    ...Object.values(reports.orderLedger.orders).map(r => r.idempotencyKey),
    ...Object.values(reports.orderIdempotency.orders).map(r => r.idempotencyKey),
    ...reports.orderIdempotency.releases.flatMap(r => [r.key, r.idempotencyKey])].filter(text));
  const newKeys = new Set();
  let total = [0n, 1n];
  for (const target of scope.targets) {
    const original = manifest.targets.find(t => t.ledgerKey === target.ledgerKey);
    requireContract(exactFields(target, [...TARGET_FIELDS, "action", "executionSide", "quantity", "exitIdempotencyKey"])
      && original && TARGET_FIELDS.every(k => target[k] === original[k]), "LIMITED_CLOSEOUT_TARGET_LINEAGE_INVALID");
    const positions = reports.performance.live.positions.filter(p => p.plannedLedgerKey === target.ledgerKey);
    requireContract(positions.length === 1 && positive(positions[0].qty) && positive(positions[0].currentPrice), "LIMITED_CLOSEOUT_SNAPSHOT_POSITION_INVALID");
    const position = positions[0];
    // v2 supports long snapshots only. No historical intent is promoted or new order is built.
    requireContract(target.executionSide === "sell" && positive(target.quantity)
      && ((target.action === "EXIT_FULL" && target.quantity === position.qty)
        || (target.action === "EXIT_PARTIAL" && target.quantity < position.qty)), "LIMITED_CLOSEOUT_EXIT_TERMS_INVALID");
    const key = target.exitIdempotencyKey;
    requireContract(text(key) && key === key.trim() && key.length <= 256 && !existingKeys.has(key) && !newKeys.has(key), "LIMITED_CLOSEOUT_EXIT_IDEMPOTENCY_CONFLICT");
    newKeys.add(key);
    const [qn, qd] = decimalRatio(target.quantity), [pn, pd] = decimalRatio(position.currentPrice);
    const notional = [qn * pn, qd * pd];
    total = [total[0] * notional[1] + notional[0] * total[1], total[1] * notional[1]];
    requireContract(withinCap(notional, limits.maxOrderNotional) && withinCap(total, limits.maxTotalNotional),
      "LIMITED_CLOSEOUT_SNAPSHOT_NOTIONAL_LIMIT_EXCEEDED");
  }
}

function limitedCloseoutDryRun(directory, manifest, reports, audit, scope) {
  const snapshots = manifest.targets.map(target => {
    const matches = reports.performance.live.positions.filter(r => r.plannedLedgerKey === target.ledgerKey);
    const states = reports.orderState.rows.filter(r => r.plannedLedgerKey === target.ledgerKey && r.plannedIdempotencyKey === target.idempotencyKey);
    const p = matches[0], state = states[0];
    const unavailable = matches.length !== 1 || states.length !== 1
      || typeof p?.brokerStopPresent !== "boolean" || typeof p?.brokerTargetPresent !== "boolean"
      || !Number.isSafeInteger(p?.brokerSellOrderCount) || p.brokerSellOrderCount < 0
      || typeof state?.terminalReconciliationRequired !== "boolean" || typeof state?.terminalConflicts !== "boolean";
    return { unavailable, protection: p?.brokerStopPresent === true || p?.brokerTargetPresent === true,
      openSell: p?.brokerSellOrderCount > 0, terminal: state?.terminalReconciliationRequired === true || state?.terminalConflicts === true };
  });
  const count = predicate => snapshots.filter(predicate).length;
  const snapshotBlockingRows = count(r => r.unavailable || r.protection || r.openSell || r.terminal);
  const result = { ...audit, schemaVersion: "paper-limited-control-closeout-dry-run-v1",
    status: "LIMITED_CLOSEOUT_DRY_RUN_TERMS_REQUIRED", mode: "OFFLINE_REVIEW_ONLY_NO_SUBMISSION",
    termsValidatedRows: 0, allOrNothingTermsValidated: false, scopeSha256: null, scopeHashBasis: "CANONICAL_JSON",
    executionAuthorized: false, exitIdempotencyReservationsCreated: 0, brokerPayloadsGenerated: 0,
    snapshotBlockingRows, snapshotProtectionConflictRows: count(r => r.protection),
    snapshotOpenSellOrderRows: count(r => r.openSell), snapshotTerminalConflictRows: count(r => r.terminal),
    snapshotOrderEvidenceUnavailableRows: count(r => r.unavailable),
    marketSessionEligibilityVerified: false, completeOpenOrderAbsenceVerified: false,
    requiredBeforeAnySubmission: ["SEPARATE_EXPLICIT_EXECUTION_APPROVAL", "CURRENT_STATE_AUTHENTICITY_OR_EXPLICIT_MANAGEMENT_AUTHORITY",
      "FRESH_PINNED_PAPER_ACCOUNT_AND_SIGNED_POSITIONS", "FRESH_RTH_CLOCK", "COMPLETE_OPEN_ORDER_AND_PROTECTIVE_CHILD_EVIDENCE",
      "NO_PROTECTIVE_CHILD_OR_OPEN_EXIT_CONFLICT", "APPROVED_RISK_LIMITS_AND_FRESH_PRICE_SPREAD_LIQUIDITY",
      "FRESH_STATE_HASH_PARITY_AND_ATOMIC_DISTINCT_EXIT_RESERVATION", "NO_RETRY_ON_UNCERTAIN_SUBMISSION",
      "BROKER_FILL_RESIDUAL_POSITION_AND_TERMINAL_POSTVERIFY", "ORIGINAL_ENTRY_FILL_REQUIRED_FOR_VERIFIED_PNL"],
    rollbackContract: "ABORT_BEFORE_SUBMIT_STOP_AND_RECONCILE_AFTER_UNCERTAINTY_NO_AUTOMATIC_REVERSE_OR_CANCEL" };
  if (scope === undefined) return result;
  const source = readPrivate(path.join(directory, "preserved-source", "source-manifest.json"), manifest.sourceManifestSha256);
  validateLimitedCloseoutTerms(scope, manifest, reports, audit.manifestSha256, source.expectedPaperAccountSha256);
  return { ...result, status: snapshotBlockingRows > 0 ? "LIMITED_CLOSEOUT_DRY_RUN_SNAPSHOT_BLOCKED"
    : "LIMITED_CLOSEOUT_DRY_RUN_TERMS_VALID_CURRENT_PROOF_REQUIRED",
    termsValidatedRows: 5, allOrNothingTermsValidated: true, scopeSha256: sha256Canonical(scope) };
}

const boundaryAssert = ok => requireContract(ok, "LIMITED_CLOSEOUT_BOUNDARY_INVALID");
const BOUNDARY_ASOF = ["account", "position", "orders", "clock", "quote", "state"];
function boundaryTime(value) {
  boundaryAssert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  const time = Date.parse(value);
  boundaryAssert(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}

function validateBoundaryFreshness(row, at, expiresAt, limits) {
  boundaryAssert(at < expiresAt && boundaryTime(row.sessionOpenAt) <= at && at < boundaryTime(row.sessionCloseAt));
  const received = boundaryTime(row.receivedAt);
  boundaryAssert(exactFields(row.evidenceAsOf, BOUNDARY_ASOF) && received <= at);
  for (const key of BOUNDARY_ASOF) {
    const asOf = boundaryTime(row.evidenceAsOf[key]);
    boundaryAssert(asOf <= received && withinCap([BigInt(at - asOf), 1000n], limits.maxEvidenceAgeSeconds));
  }
}

function validateBoundaryQuote(row, limits) {
  const source = row.sourceContract;
  const checks = ["priceIncrementVerified", "assetTradable", "accountTradingAllowed", "limitDaySupported", "openOrdersComplete", "protectiveChildrenComplete"];
  boundaryAssert(exactFields(source, ["evidenceSha256", "feedSha256", "quoteSizeUnit", ...checks])
    && hash(source.evidenceSha256) && hash(source.feedSha256) && source.quoteSizeUnit === "SHARES" && checks.every(k => source[k] === true));
  boundaryAssert(["bid", "ask", "bidSizeShares", "priceTick", "quantityIncrement", "limitPrice", "currentQuantity"].every(k => positive(row[k]))
    && row.ask >= row.bid && row.bidSizeShares >= row.currentQuantity && row.limitPrice <= row.bid);
  const [bn, bd] = decimalRatio(row.bid), [an, ad] = decimalRatio(row.ask);
  const [ln, ld] = decimalRatio(row.limitPrice), [tn, td] = decimalRatio(row.priceTick);
  boundaryAssert((ln * td) % (ld * tn) === 0n
    && withinCap([20000n * (an * bd - bn * ad), an * bd + bn * ad], limits.maxSpreadBps)
    && withinCap([10000n * (bn * ld - ln * bd), bn * ld], limits.maxSlippageBps));
  const [qn, qd] = decimalRatio(row.currentQuantity);
  const [incr, scale] = decimalRatio(row.quantityIncrement);
  boundaryAssert((qn * scale) % (qd * incr) === 0n);
  const notional = [qn * an, qd * ad];
  boundaryAssert(withinCap(notional, limits.maxOrderNotional));
  return notional;
}

function simulateBoundaryEvents(row, target, scenario, limits, expiresAt, counts, previousEnd, seenOrders) {
  const reviewedAt = boundaryTime(row.reviewedAt);
  boundaryAssert(reviewedAt >= previousEnd && Array.isArray(row.events) && row.events.length <= 5);
  let phase = "START", lastAt = reviewedAt, orderHash = null;
  const failure = new Set(["UNCERTAIN", "TIMEOUT", "HTTP_FAILURE", "REDIRECT_REJECTED", "REJECTED", "CANCELED", "EXPIRED"]);
  for (const event of row.events) {
    boundaryAssert(object(event));
    const time = boundaryTime(event.at);
    boundaryAssert(time >= lastAt); lastAt = time;
    if (event.type === "RESERVED") {
      boundaryAssert(phase === "START" && exactFields(event, ["type", "at", "termsSha256", "orderLedgerSha256", "orderIdempotencySha256", "durable"])
        && event.durable === true && ["termsSha256", "orderLedgerSha256", "orderIdempotencySha256"].every(k => event[k] === scenario[k]));
      phase = "RESERVED";
    } else if (event.type === "ATTEMPT_RECORDED") {
      boundaryAssert(phase === "RESERVED" && exactFields(event, ["type", "at", "durable"]) && event.durable === true);
      validateBoundaryFreshness(row, time, expiresAt, limits);
      counts.simulatedAttemptRows++; phase = "ATTEMPTED";
    } else if (["ACCEPTED", "PARTIALLY_FILLED", "FILLED"].includes(event.type)) {
      boundaryAssert(exactFields(event, ["type", "at", "orderSha256", "filledQuantity"]) && hash(event.orderSha256));
      if (event.type === "ACCEPTED") {
        boundaryAssert(phase === "ATTEMPTED" && event.filledQuantity === 0 && !seenOrders.has(event.orderSha256));
        seenOrders.add(event.orderSha256);
        orderHash = event.orderSha256; counts.simulatedAcceptedRows++; phase = "ACCEPTED";
      } else {
        boundaryAssert(phase === "ACCEPTED" && event.orderSha256 === orderHash && positive(event.filledQuantity));
        if (event.type === "FILLED") {
          boundaryAssert(event.filledQuantity === target.quantity); counts.simulatedFilledRows++; phase = "FILLED";
        } else {
          boundaryAssert(event.filledQuantity < target.quantity); counts.simulatedPartialFillRows++; phase = "STOP";
        }
      }
    } else if (event.type === "POST_VERIFY") {
      boundaryAssert(phase === "FILLED" && exactFields(event, ["type", "at", "orderSha256", "positionQuantity", "openOrderCount", "protectiveChildCount"])
        && event.orderSha256 === orderHash && typeof event.positionQuantity === "number" && Number.isFinite(event.positionQuantity)
        && event.positionQuantity >= 0 && event.positionQuantity <= target.quantity
        && ["openOrderCount", "protectiveChildCount"].every(k => Number.isSafeInteger(event[k]) && event[k] >= 0));
      phase = event.positionQuantity === 0 && event.openOrderCount === 0 && event.protectiveChildCount === 0 ? "FLAT" : "STOP";
      if (phase === "FLAT") counts.simulatedFlatRows++;
    } else {
      const postVerifyFailure = phase === "FILLED" && ["UNCERTAIN", "TIMEOUT", "HTTP_FAILURE", "REDIRECT_REJECTED"].includes(event.type);
      boundaryAssert(failure.has(event.type) && (["ATTEMPTED", "ACCEPTED"].includes(phase) || postVerifyFailure)
        && exactFields(event, ["type", "at"]));
      phase = "STOP";
    }
  }
  return { end: lastAt, stopped: phase !== "FLAT" };
}

function simulateCloseoutApprovalBoundary(manifest, scope, audit, scenario) {
  requireContract(scope !== undefined && audit.allOrNothingTermsValidated === true, "LIMITED_CLOSEOUT_BOUNDARY_TERMS_REQUIRED");
  requireContract(scope.targets.every(t => t.action === "EXIT_FULL" && t.executionSide === "sell"), "LIMITED_CLOSEOUT_BOUNDARY_FULL_EXIT_REQUIRED");
  boundaryAssert(audit.snapshotBlockingRows === 0
    && exactFields(scenario, ["schemaVersion", "evidenceBasis", "termsSha256", "accountSha256", "orderLedgerSha256", "orderIdempotencySha256", "orderContract", "approval", "rows"])
    && scenario.schemaVersion === "paper-limited-closeout-boundary-simulation-v1"
    && scenario.evidenceBasis === "SYNTHETIC_OFFLINE_SCENARIO" && scenario.termsSha256 === audit.scopeSha256
    && scenario.accountSha256 === scope.accountSha256
    && scenario.orderLedgerSha256 === manifest.files[FILES.orderLedger]
    && scenario.orderIdempotencySha256 === manifest.files[FILES.orderIdempotency]);
  boundaryAssert(exactFields(scenario.orderContract, ["type", "timeInForce", "extendedHours", "retry", "cancel", "replace"])
    && scenario.orderContract.type === "limit" && scenario.orderContract.timeInForce === "day"
    && ["extendedHours", "retry", "cancel", "replace"].every(k => scenario.orderContract[k] === false));
  const approval = scenario.approval, limits = scope.riskLimits;
  boundaryAssert(exactFields(approval, ["scope", "termsSha256", "accountSha256", "expiresAt", "originalHistoryAdopted"])
    && approval.scope === "OFFLINE_CONFORMANCE_ONLY" && approval.originalHistoryAdopted === false
    && approval.termsSha256 === scenario.termsSha256 && approval.accountSha256 === scenario.accountSha256);
  const expiresAt = boundaryTime(approval.expiresAt);
  boundaryAssert(Array.isArray(scenario.rows) && scenario.rows.length === 5);
  let total = [0n, 1n];
  // Validate all five before inspecting any hypothetical attempt. These assertions are not broker attestations.
  for (const [n, row] of scenario.rows.entries()) {
    boundaryAssert(exactFields(row, ["exitIdempotencyKey", "currentQuantity", "bid", "ask", "bidSizeShares", "priceTick", "quantityIncrement", "limitPrice", "sourceContract",
      "reviewedAt", "receivedAt", "evidenceAsOf", "sessionOpenAt", "sessionCloseAt", "rthOpen", "identityMatched", "accountMatched",
      "terminalConflict", "idempotencyConflict", "openOrderCount", "protectiveChildCount", "events"])
      && row.exitIdempotencyKey === scope.targets[n].exitIdempotencyKey && row.currentQuantity === scope.targets[n].quantity
      && ["rthOpen", "identityMatched", "accountMatched"].every(k => row[k] === true)
      && ["terminalConflict", "idempotencyConflict"].every(k => row[k] === false)
      && row.openOrderCount === 0 && row.protectiveChildCount === 0);
    validateBoundaryFreshness(row, boundaryTime(row.reviewedAt), expiresAt, limits);
    const notional = validateBoundaryQuote(row, limits);
    total = [total[0] * notional[1] + notional[0] * total[1], total[1] * notional[1]];
    boundaryAssert(withinCap(total, limits.maxTotalNotional));
  }
  const counts = { simulatedAttemptRows: 0, simulatedAcceptedRows: 0, simulatedPartialFillRows: 0, simulatedFilledRows: 0, simulatedFlatRows: 0 };
  const seenOrders = new Set();
  let previousEnd = -Infinity, stopped = false;
  for (const [n, row] of scenario.rows.entries()) {
    if (stopped) { boundaryAssert(Array.isArray(row.events) && row.events.length === 0); continue; }
    const outcome = simulateBoundaryEvents(row, scope.targets[n], scenario, limits, expiresAt, counts, previousEnd, seenOrders);
    previousEnd = outcome.end; stopped = outcome.stopped;
  }
  return { ...audit, schemaVersion: "paper-limited-closeout-boundary-audit-v1", mode: "OFFLINE_SYNTHETIC_CONFORMANCE_ONLY",
    status: stopped ? "LIMITED_CLOSEOUT_OFFLINE_STOP_RECONCILIATION_REQUIRED"
      : "LIMITED_CLOSEOUT_OFFLINE_CONFORMANCE_PASS_EXECUTION_NOT_AUTHORIZED",
    boundaryScenarioSha256: sha256Canonical(scenario), boundaryHashBasis: "CANONICAL_JSON",
    ...counts, simulatedRemainingRows: 5 - counts.simulatedFlatRows,
    approvalAuthenticationVerified: false, atomicReservationVerified: false, brokerTransportVerified: false,
    verifiedClosedLoopRows: 0, telegramMessagesSent: 0, ...SAFETY };
}

export function auditPrivateCloseoutEvidence(directory, manifestSha256, options = {}) {
  requireContract(options.approvalBoundary === undefined || options.limitedControlDryRun === true, "LIMITED_CLOSEOUT_BOUNDARY_MODE_REQUIRED");
  const root = fs.lstatSync(directory);
  requireContract(root.isDirectory() && !root.isSymbolicLink(), "PRIVATE_DIRECTORY_INVALID");
  requireContract((root.mode & 0o077) === 0 && root.uid === process.getuid(), "PRIVATE_INPUT_PERMISSIONS_INVALID");
  const manifest = readPrivate(path.join(directory, "manifest.json"), manifestSha256);
  const historicalContextOnly = manifest.schemaVersion === "paper-closeout-private-evidence-v2";
  requireContract(options.limitedControlDryRun !== true || historicalContextOnly, "LIMITED_CLOSEOUT_V2_REQUIRED");
  requireContract(["paper-closeout-private-evidence-v1", "paper-closeout-private-evidence-v2"].includes(manifest.schemaVersion) && manifest.environment === "PAPER"
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
  validatePrivatePreview(reports.preview, historicalContextOnly);
  requireContract([...symbols].every(symbol => positions.some(r => r.symbol.toUpperCase() === symbol)), "PRIVATE_SCOPED_POSITION_MISSING");
  requireContract([...symbols].every(symbol => reports.positionProtectionAudit.rows.some(r =>
    r.symbol.toUpperCase() === symbol && r.idempotencyStatus === "active_position_limited_control")), "PRIVATE_LIMITED_REPORT_MISMATCH");
  if (historicalContextOnly) {
    requireContract(manifest.targets.length === 5, "CAPTURE_TARGET_COUNT_INVALID");
    // Mixed-time observations are not an exit-readiness replay. Original payloads remain opaque preserved evidence.
    const preserved = auditHistoricalReviewSource(directory, manifest, reports);
    const audit = { schemaVersion: "paper-closeout-private-evidence-audit-v2", status: "PRIVATE_OBSERVATION_REVIEW_VALID_EXECUTION_NOT_EVALUATED",
      evidenceBasis: "PRESERVED_SNAPSHOT_WITH_BOUNDED_OBSERVATIONS", manifestSha256, inputFileCount: Object.keys(FILES).length,
      exactLimitedIdentityRows: manifest.targets.length, missingOriginalBrokerIdRows, snapshotPositionRows: positions.length,
      unscopedPositionRows: positions.filter(r => !symbols.has(r.symbol.toUpperCase())).length,
      executionReadinessEvaluated: false, currentStateAuthenticityVerified: false, unknownOrUnclassifiedRows: 0,
      ...preserved, ...SAFETY };
    if (options.limitedControlDryRun !== true) return audit;
    const dryRun = limitedCloseoutDryRun(directory, manifest, reports, audit, options.scope);
    return options.approvalBoundary === undefined ? dryRun : simulateCloseoutApprovalBoundary(manifest, options.scope, dryRun, options.approvalBoundary);
  }
  const replay = buildPaperExitReadiness(reports);
  requireContract(replay.shadowEvaluation.countMatches && replay.shadowEvaluation.unknownOrUnclassifiedRows === 0
    && shadow.evaluatedPositionRows === shadow.rows.length, "PRIVATE_SHADOW_CONTRACT_INVALID");
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
    const dryRun = process.argv[4] === "--limited-control-dry-run";
    const boundary = process.argv.length === 10 && process.argv[7] === "--approval-boundary-simulation";
    requireContract(process.argv.length === 4 || (dryRun && ([5, 7].includes(process.argv.length) || boundary)), "PRIVATE_ARGUMENTS_INVALID");
    const scope = process.argv.length >= 7 ? readPrivate(process.argv[5], process.argv[6]) : undefined;
    const approvalBoundary = boundary ? readPrivate(process.argv[8], process.argv[9]) : undefined;
    console.log(JSON.stringify(auditPrivateCloseoutEvidence(process.argv[2], process.argv[3], { limitedControlDryRun: dryRun, scope, approvalBoundary })));
  } catch (error) {
    // Never forward parser errors, paths, OS errors or private report strings to a public console.
    const status = error instanceof ContractError ? error.message : "PRIVATE_INPUT_UNAVAILABLE";
    console.log(JSON.stringify({ schemaVersion: "paper-closeout-private-evidence-audit-v1", status, ...SAFETY }));
    process.exitCode = 1;
  }
}
