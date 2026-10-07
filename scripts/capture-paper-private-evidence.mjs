#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { FILES, ContractError, readPrivate, readPrivateBytes, validateTargets, validatePrivatePreview, validateHistoricalReviewSource,
  HISTORICAL_SOURCE_USAGE, HISTORICAL_AUXILIARY_FILES, buildExactPrivateReportState, auditPrivateCloseoutEvidence } from "./audit-paper-closeout-private-evidence.mjs";
import { ACTIVE_POSITION_LIMITED_RECOVERY_MODE, sha256Canonical } from "./lib/active-position-limited-recovery.mjs";
import { buildLiveSummary, buildBrokerRealizedPnlSummary } from "./build-performance-dashboard.mjs";

export const CAPTURE_APPROVAL = "AUTHORIZE PAPER COMPLETE PRIVATE EVIDENCE READ-ONLY ONE-SHOT";
const PAPER = "https://paper-api.alpaca.markets";
const REQUIRED = [FILES.preview, FILES.orderLedger, FILES.orderIdempotency];
const OPTIONAL = HISTORICAL_AUXILIARY_FILES;
const ROUTES = Object.freeze({ account: "/v2/account", positions: "/v2/positions",
  openOrders: "/v2/orders?status=open&nested=true&direction=desc&limit=500",
  closedOrders: "/v2/orders?status=closed&nested=true&direction=asc&limit=500", clock: "/v2/clock" });
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const requireContract = (ok, code) => { if (!ok) throw new ContractError(code); };
const SAFETY = Object.freeze({ readOnly: true, execEnabled: false, liveOrderSubmitEnabled: false,
  selectedCandidateCount: 0, currentBrokerEvidenceVerified: false, stateMutationAttempted: false,
  brokerSubmitAllowed: false, entryAllowed: false, scaleInAllowed: false, riskIncreasingActionAllowed: false,
  realizedPnlVerified: false, historicalEvidenceNormalized: false, privateEvidencePublished: false,
  rawResponseStored: false, cacheRestored: false, cacheSaved: false, retryCount: 0, paginationUsed: false });

function privateDirectory(dir) {
  const stat = fs.lstatSync(dir);
  requireContract(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0, "PRIVATE_INPUT_PERMISSIONS_INVALID");
  requireContract(fs.realpathSync(dir) === path.resolve(dir), "CAPTURE_SYMLINK_PATH_REJECTED");
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(tmp, file);
}

function validateObservedTimestamps(value, nowMs, source) {
  // Observation timestamps only: future scheduled expiries and next-open times are not observations.
  const keys = new Set(["generatedAt", "generated_at", "createdAt", "updatedAt", "observedAt", "retrievedAt", "capturedAt",
    "firstSeenAt", "lastSeenAt", "releasedAt", "recoveryRecordedAt", "brokerCheckedAt", "brokerFillTimestamp", "filledAt", "submittedAt",
    "originalGeneratedAt", "effectiveGuardGeneratedAt", "plannedLedgerUpdatedAt", "sourceAsOf", "timestamp",
    "idempotencyBrokerCheckedAt", "ledgerUpdatedAt", "lifecycleOriginalGeneratedAt", "performanceDashboardGeneratedAt", "reconciliationGeneratedAt",
    "created_at", "updated_at", "filled_at", "submitted_at", "canceled_at", "expired_at", "failed_at", "replaced_at"]);
  const visit = node => {
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      if (keys.has(key) && item != null && item !== "") {
        const isoWithZone = typeof item === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(item);
        const ms = isoWithZone ? Date.parse(item) : NaN;
        requireContract(Number.isFinite(ms), `CAPTURE_${source}_TIMESTAMP_INVALID`);
        requireContract(ms <= nowMs, `CAPTURE_${source}_FUTURE_TIMESTAMP`);
      } else if (item && typeof item === "object") visit(item);
    }
  };
  visit(value);
}

function preflight(directory, pin, nowMs) {
  privateDirectory(directory);
  const manifest = readPrivate(path.join(directory, "source-manifest.json"), pin);
  const historicalContextOnly = manifest.schemaVersion === "paper-private-capture-source-v2";
  requireContract(["paper-private-capture-source-v1", "paper-private-capture-source-v2"].includes(manifest.schemaVersion) && manifest.environment === "PAPER"
    && manifest.evidenceBasis === "PRESERVED_STATE_SNAPSHOT" && /^\d+$/.test(manifest.sourceRunId)
    && hash(manifest.expectedPaperAccountSha256) && object(manifest.files), "CAPTURE_SOURCE_MANIFEST_INVALID");
  const names = Object.keys(manifest.files);
  const required = historicalContextOnly ? [...REQUIRED, FILES.performance] : REQUIRED;
  requireContract(required.every(n => names.includes(n)) && names.every(n => [...required, ...OPTIONAL].includes(n)), "CAPTURE_SOURCE_FILE_SET_INVALID");
  const values = Object.fromEntries(names.map(n => [n, readPrivate(path.join(directory, n), manifest.files[n])]));
  const ledger = values[FILES.orderLedger], idem = values[FILES.orderIdempotency], preview = values[FILES.preview];
  requireContract(object(ledger.orders) && object(idem.orders), "PRIVATE_STATE_SCHEMA_INVALID");
  const targets = Object.entries(idem.orders).filter(([, r]) => r?.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE).map(([key, row]) => {
    const matches = Object.entries(ledger.orders).filter(([, l]) => l?.idempotencyKey === key);
    requireContract(matches.length === 1, matches.length ? "PRIVATE_IDENTITY_AMBIGUOUS" : "PRIVATE_EXACT_ENTRY_MISSING");
    return { ledgerKey: matches[0][0], idempotencyKey: key, ledgerRecordSha256: sha256Canonical(matches[0][1]), idempotencyRecordSha256: sha256Canonical(row) };
  }).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
  requireContract(targets.length === 5, "CAPTURE_TARGET_COUNT_INVALID");
  const { symbols } = validateTargets(targets, { orderLedger: ledger, orderIdempotency: idem });
  buildExactPrivateReportState({ ledger, idempotency: idem }, targets);
  // Optional historical reports have no proven exact-target join contract. Never override a pinned target with them.
  for (const name of historicalContextOnly ? [] : OPTIONAL) {
    requireContract(!(values[name]?.rows || []).some(row => symbols.has(String(row?.symbol || "").toUpperCase())),
      "PRIVATE_REPORT_IDENTITY_UNVERIFIED");
  }
  validatePrivatePreview(preview, historicalContextOnly);
  requireContract(Number.isFinite(Date.parse(preview.generatedAt)), "PRIVATE_SHADOW_CONTRACT_INVALID");
  requireContract(Date.parse(preview.generatedAt) <= nowMs, "CAPTURE_SOURCE_FUTURE_TIMESTAMP");
  validateObservedTimestamps(values, nowMs, "SOURCE");
  const baselinePositions = historicalContextOnly ? validateHistoricalReviewSource(manifest, values) : null;
  if (baselinePositions) requireContract([...symbols].every(symbol => baselinePositions.some(r => r.symbol.toUpperCase() === symbol)), "PRIVATE_SCOPED_POSITION_MISSING");
  return { manifest, values, targets, historicalContextOnly, baselinePositions };
}

// This is the same complete source preflight used before runtime, with no credentials, writes or network capability.
export function inspectCaptureSource(sourceDirectory, sourceManifestSha256, now = () => new Date()) {
  try {
    const source = preflight(path.resolve(sourceDirectory), sourceManifestSha256, now().getTime());
    return { ...SAFETY, status: "PAPER_PRIVATE_CAPTURE_SOURCE_PREFLIGHT_PASS", sourceManifestSha256,
      sourceFileCount: Object.keys(source.manifest.files).length, exactLimitedIdentityRows: source.targets.length,
      historicalContextOnly: source.historicalContextOnly, historicalPayloadRows: source.values[FILES.preview].payloads.length,
      quarantinedAuxiliaryFileCount: source.historicalContextOnly ? OPTIONAL.filter(n => Object.hasOwn(source.manifest.files, n)).length : 0,
      baselinePositionRows: source.baselinePositions?.length ?? 0, executionReadinessEvaluated: false,
      currentStateAuthenticityVerified: false, brokerRequests: 0, credentialsRead: false };
  } catch (error) {
    return { ...SAFETY, status: error instanceof ContractError ? error.message : "CAPTURE_INPUT_OR_INTERNAL_CONTRACT_INVALID",
      brokerRequests: 0, credentialsRead: false };
  }
}

function validateBaselinePortfolio(baseline, positions) {
  const exposure = rows => rows.map(r => [r.symbol.toUpperCase(), Number(r.qty)]).sort((a, b) => a[0].localeCompare(b[0]));
  requireContract(sha256Canonical(exposure(baseline)) === sha256Canonical(exposure(positions)), "CAPTURE_PREVIEW_PORTFOLIO_CHANGED");
}

function validateResponse(group, data, manifest, nowMs, diagnostic) {
  if (group === "account") {
    requireContract(object(data) && typeof data.id === "string", "CAPTURE_BROKER_SCHEMA_INVALID");
    requireContract(digest(data.id) === manifest.expectedPaperAccountSha256, "CAPTURE_ACCOUNT_MISMATCH");
  } else if (group === "positions") {
    requireContract(Array.isArray(data) && data.every(p => object(p) && typeof p.symbol === "string" && p.symbol.trim()
      && p.qty != null && String(p.qty).trim() && Number.isFinite(Number(p.qty)) && Number(p.qty) !== 0
      && ["long", "short"].includes(p.side) && (Number(p.qty) > 0) === (p.side === "long"))
      && new Set(data.map(p => p.symbol.toUpperCase())).size === data.length, "CAPTURE_BROKER_SCHEMA_INVALID");
    // Existing protection reports are long-only. Never omit shorts or certify a buy-to-cover child through their sell-side mapper.
    requireContract(data.every(p => Number(p.qty) > 0), "CAPTURE_UNSUPPORTED_SHORT_PROTECTION");
  } else if (group === "clock") {
    const ms = Date.parse(data?.timestamp);
    diagnostic.validationFailure = !object(data) ? "CLOCK_OBJECT_INVALID"
      : typeof data.is_open !== "boolean" ? "CLOCK_IS_OPEN_INVALID"
      : data.timestamp == null || data.timestamp === "" ? "CLOCK_TIMESTAMP_MISSING"
      : !Number.isFinite(ms) ? "CLOCK_TIMESTAMP_UNPARSEABLE"
      : ms > nowMs ? "CLOCK_TIMESTAMP_AFTER_LOCAL_REFERENCE" : null;
    requireContract(object(data) && typeof data.is_open === "boolean" && Number.isFinite(ms) && ms <= nowMs, "CAPTURE_BROKER_SCHEMA_INVALID");
  } else {
    requireContract(Array.isArray(data), "CAPTURE_BROKER_SCHEMA_INVALID");
    requireContract(data.length < 500, "CAPTURE_RESPONSE_LIMIT_REACHED");
    const visit = (rows, depth = 0) => {
      requireContract(depth <= 4, "CAPTURE_BROKER_SCHEMA_INVALID");
      for (const order of rows) {
        requireContract(object(order) && typeof order.id === "string" && order.id && typeof order.symbol === "string" && order.symbol
          && ["buy", "sell"].includes(order.side) && typeof order.status === "string" && order.status, "CAPTURE_BROKER_SCHEMA_INVALID");
        if (order.legs != null) { requireContract(Array.isArray(order.legs), "CAPTURE_BROKER_SCHEMA_INVALID"); visit(order.legs, depth + 1); }
      }
    };
    visit(data);
  }
  validateObservedTimestamps(data, nowMs, "BROKER");
}

async function brokerSnapshot({ fetchImpl, env, requestCounts, manifest, baselinePositions, now, onFailure }) {
  const results = {}, receipts = {};
  for (const [group, route] of Object.entries(ROUTES)) {
    requireContract(requestCounts[group] === 0 && requestCounts.total < 5, "CAPTURE_REQUEST_BUDGET_EXCEEDED");
    requestCounts[group]++; requestCounts.total++;
    let response, bytes;
    const requestedAt = now().toISOString();
    const diagnostic = { schemaVersion: "paper-private-capture-response-diagnostic-v1", endpointGroup: group,
      httpStatusCategory: "UNAVAILABLE", responseSha256: null, responseHashBasis: null, validationFailure: null };
    try {
      try {
        response = await fetchImpl(`${PAPER}${route}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET_KEY } });
        if (Number.isInteger(response.status) && response.status >= 100 && response.status < 600) {
          diagnostic.httpStatusCategory = `HTTP_${Math.floor(response.status / 100)}XX`;
        }
        requireContract(response.ok, "CAPTURE_BROKER_HTTP_FAILURE");
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length; requireContract(size <= 8 * 1024 * 1024, "CAPTURE_RESPONSE_TOO_LARGE"); chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError("CAPTURE_BROKER_TRANSPORT_FAILURE");
      }
      // Hash only the fully consumed bounded body; never publish a partial-body hash or raw response.
      diagnostic.responseSha256 = digest(bytes);
      diagnostic.responseHashBasis = "COMPLETE_RESPONSE_BYTES";
      let data;
      try { data = JSON.parse(bytes.toString("utf8")); } catch {
        diagnostic.validationFailure = "RESPONSE_JSON_INVALID";
        throw new ContractError("CAPTURE_BROKER_SCHEMA_INVALID");
      }
      validateResponse(group, data, manifest, now().getTime(), diagnostic);
      if (group === "positions" && baselinePositions) validateBaselinePortfolio(baselinePositions, data);
      results[group] = { ok: true, status: response.status, data, reason: "ok" };
      receipts[group] = { requestedAt, retrievedAt: now().toISOString(), responseSha256: diagnostic.responseSha256, httpStatus: response.status };
    } catch (error) {
      const reasons = { CAPTURE_BROKER_HTTP_FAILURE: "HTTP_NON_SUCCESS", CAPTURE_BROKER_TRANSPORT_FAILURE: "RESPONSE_TRANSPORT_FAILURE",
        CAPTURE_RESPONSE_TOO_LARGE: "RESPONSE_SIZE_LIMIT_EXCEEDED", CAPTURE_RESPONSE_LIMIT_REACHED: "RESPONSE_ROW_LIMIT_REACHED",
        CAPTURE_BROKER_TIMESTAMP_INVALID: "OBSERVATION_TIMESTAMP_INVALID", CAPTURE_BROKER_FUTURE_TIMESTAMP: "OBSERVATION_TIMESTAMP_AFTER_LOCAL_REFERENCE",
        CAPTURE_ACCOUNT_MISMATCH: "ACCOUNT_PIN_MISMATCH", CAPTURE_PREVIEW_PORTFOLIO_CHANGED: "PORTFOLIO_CHANGED",
        CAPTURE_UNSUPPORTED_SHORT_PROTECTION: "SHORT_PROTECTION_UNSUPPORTED" };
      diagnostic.validationFailure ??= Object.hasOwn(reasons, error?.message) ? reasons[error.message] : "RESPONSE_CONTRACT_INVALID";
      onFailure(diagnostic);
      throw error;
    }
  }
  return { results, receipts };
}

function buildLocalReports(stateDirectory) {
  for (const script of ["build-broker-child-order-reconciliation.mjs", "build-order-state-consistency-report.mjs", "build-position-protection-root-cause-audit.mjs"]) {
    const result = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { cwd: stateDirectory, encoding: "utf8", timeout: 30000,
      maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: stateDirectory,
        BROKER_CHILD_RECONCILIATION_STATE_DIR: stateDirectory, ORDER_STATE_CONSISTENCY_STATE_DIR: stateDirectory,
        POSITION_PROTECTION_AUDIT_STATE_DIR: stateDirectory, READ_ONLY: "true", EXEC_ENABLED: "false" } });
    // Producer output may contain identifiers; never forward stdout/stderr or OS errors.
    requireContract(result.status === 0, "CAPTURE_LOCAL_REPORT_PRODUCER_FAILED");
  }
}

function validatePortfolio(work, positions, preview) {
  const symbols = rows => rows.map(row => String(row.symbol).toUpperCase()).sort().join("\n");
  const expected = symbols(positions);
  requireContract(symbols(preview.paperExitShadowIntent.rows) === expected, "CAPTURE_PREVIEW_PORTFOLIO_CHANGED");
  for (const name of [FILES.positionProtectionAudit, FILES.brokerChildReconciliation]) {
    const report = JSON.parse(fs.readFileSync(path.join(work, name)));
    requireContract(Array.isArray(report.rows) && symbols(report.rows) === expected, "CAPTURE_REPORT_PORTFOLIO_INCOMPLETE");
  }
}

export async function capturePrivateEvidence({ sourceDirectory, sourceManifestSha256, outputDirectory, approval,
  env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const requestCounts = { account: 0, positions: 0, openOrders: 0, closedOrders: 0, clock: 0, total: 0 };
  let ownedOutput = false, source, oldMask;
  const safe = { ...SAFETY, requestCounts, requestBudgetCompliant: true, completePackagePublished: false };
  try {
    requireContract(approval === CAPTURE_APPROVAL, "CAPTURE_APPROVAL_REQUIRED");
    requireContract(env.READ_ONLY === "true" && env.EXEC_ENABLED === "false" && env.LIVE_ORDER_SUBMIT_ENABLED === "false", "CAPTURE_SAFE_FLAGS_REQUIRED");
    requireContract(env.ALPHA_ENV === "PAPER" && env.ALPACA_BASE_URL === PAPER, "CAPTURE_PAPER_ONLY_REQUIRED");
    requireContract(typeof env.ALPACA_KEY_ID === "string" && env.ALPACA_KEY_ID.trim()
      && typeof env.ALPACA_SECRET_KEY === "string" && env.ALPACA_SECRET_KEY.trim(), "CAPTURE_CREDENTIALS_MISSING");
    sourceDirectory = path.resolve(sourceDirectory); outputDirectory = path.resolve(outputDirectory);
    requireContract(!outputDirectory.startsWith(`${path.dirname(SCRIPTS)}${path.sep}`), "CAPTURE_OUTPUT_INSIDE_CHECKOUT_REJECTED");
    requireContract(!fs.existsSync(outputDirectory), "CAPTURE_OUTPUT_ALREADY_EXISTS");
    requireContract(!outputDirectory.startsWith(`${sourceDirectory}${path.sep}`) && !sourceDirectory.startsWith(`${outputDirectory}${path.sep}`), "CAPTURE_PATH_OVERLAP");
    privateDirectory(path.dirname(outputDirectory));
    source = preflight(sourceDirectory, sourceManifestSha256, now().getTime());
    oldMask = process.umask(0o077);
    // Exclusive directory creation is the pre-network one-shot claim. Failures are never reset or retried here.
    try { fs.mkdirSync(outputDirectory, { mode: 0o700 }); } catch { throw new ContractError("CAPTURE_OUTPUT_ALREADY_EXISTS"); }
    ownedOutput = true;
    writeJson(path.join(outputDirectory, "attempt.json"), { status: "IN_PROGRESS", sourceManifestSha256, ...safe });
    const work = path.join(outputDirectory, "private-work"); fs.mkdirSync(work, { mode: 0o700 });
    const preserved = source.historicalContextOnly ? path.join(outputDirectory, "preserved-source") : work;
    if (source.historicalContextOnly) {
      fs.mkdirSync(preserved, { mode: 0o700 });
      fs.writeFileSync(path.join(preserved, "source-manifest.json"), readPrivateBytes(path.join(sourceDirectory, "source-manifest.json"), sourceManifestSha256), { flag: "wx", mode: 0o600 });
    }
    for (const [name, expected] of Object.entries(source.manifest.files)) {
      const bytes = readPrivateBytes(path.join(sourceDirectory, name), expected);
      fs.writeFileSync(path.join(preserved, name), bytes, { flag: "wx", mode: 0o600 });
      if (source.historicalContextOnly && [FILES.orderLedger, FILES.orderIdempotency].includes(name)) {
        fs.writeFileSync(path.join(work, name), bytes, { flag: "wx", mode: 0o600 });
      }
    }
    const startedAt = now().toISOString();
    const { results, receipts } = await brokerSnapshot({ fetchImpl, env, requestCounts, manifest: source.manifest, baselinePositions: source.baselinePositions, now,
      onFailure: diagnostic => { safe.responseDiagnostic = diagnostic; } });
    const orderLedger = source.values[FILES.orderLedger], orderIdempotency = source.values[FILES.orderIdempotency];
    const live = await buildLiveSummary(async route => results[Object.keys(ROUTES).find(k => ROUTES[k] === route)],
      { ledger: orderLedger, idempotency: orderIdempotency, fillability: source.historicalContextOnly ? {} : source.values["fillability-report.json"] || {},
        privateCaptureTargets: source.targets });
    const dashboard = { generatedAt: now().toISOString(), live, privateCaptureTargets: source.targets,
      ...(source.historicalContextOnly ? { sourceUsage: HISTORICAL_SOURCE_USAGE, realizedPnlEvaluationStatus: "NOT_EVALUATED_REVIEW_ONLY" } : {}),
      realizedPnl: source.historicalContextOnly ? null : buildBrokerRealizedPnlSummary({ orderLedger, orderIdempotency, closedOrders: results.closedOrders.data,
        currentPositions: live.positions, paperMode: true, closedOrdersSourceComplete: false, positionsSourceComplete: true }) };
    writeJson(path.join(work, FILES.performance), dashboard);
    buildLocalReports(work);
    validatePortfolio(work, live.positions, source.values[FILES.preview]);
    const complete = path.join(outputDirectory, "complete"), staging = path.join(outputDirectory, "complete.pending");
    fs.mkdirSync(staging, { mode: 0o700 });
    const files = {};
    for (const name of Object.values(FILES)) {
      const bytes = fs.readFileSync(path.join(source.historicalContextOnly && name === FILES.preview ? preserved : work, name));
      fs.writeFileSync(path.join(staging, name), bytes, { flag: "wx", mode: 0o600 }); files[name] = digest(bytes);
    }
    if (source.historicalContextOnly) fs.renameSync(preserved, path.join(staging, "preserved-source"));
    const manifest = { schemaVersion: source.historicalContextOnly ? "paper-closeout-private-evidence-v2" : "paper-closeout-private-evidence-v1", environment: "PAPER", evidenceBasis: "PRESERVED_SNAPSHOT",
      ...(source.historicalContextOnly ? { sourceUsage: HISTORICAL_SOURCE_USAGE } : {}),
      sourceManifestSha256, files, targets: source.targets };
    writeJson(path.join(staging, "manifest.json"), manifest);
    const manifestSha256 = digest(fs.readFileSync(path.join(staging, "manifest.json")));
    // Pin exact bytes before invoking the existing auditor once. This is integrity, not current eligibility.
    writeJson(path.join(outputDirectory, "manifest-pin.json"), { manifestSha256 });
    const audit = auditPrivateCloseoutEvidence(staging, manifestSha256);
    for (const [name, expected] of Object.entries(source.manifest.files)) {
      try {
        readPrivateBytes(path.join(sourceDirectory, name), expected);
        readPrivateBytes(path.join(source.historicalContextOnly ? path.join(staging, "preserved-source") : work, name), expected);
        if (source.historicalContextOnly && [FILES.orderLedger, FILES.orderIdempotency].includes(name)) readPrivateBytes(path.join(work, name), expected);
      } catch { throw new ContractError("CAPTURE_SOURCE_CHANGED"); }
    }
    requireContract(digest(fs.readFileSync(path.join(sourceDirectory, "source-manifest.json"))) === sourceManifestSha256, "CAPTURE_SOURCE_CHANGED");
    writeJson(path.join(outputDirectory, "capture-provenance.json"), { schemaVersion: "paper-private-capture-provenance-v1",
      sourceManifestSha256, sourceRunId: source.manifest.sourceRunId, sourceFileHashes: source.manifest.files,
      startedAt, completedAt: now().toISOString(), requestReceipts: receipts,
      clock: { timestamp: results.clock.data.timestamp, is_open: results.clock.data.is_open },
      previewSourceAsOf: source.values[FILES.preview].generatedAt,
      previewRefreshed: false, currentStateAuthenticityVerified: false, currentBrokerEvidenceVerified: false,
      closedOrderHistoryCompletenessVerified: false,
      manifestSha256, sourceStateHashParity: true, ...SAFETY });
    Object.assign(safe, { status: source.historicalContextOnly ? "PAPER_PRIVATE_CAPTURE_REVIEW_ONLY_COMPLETE" : "PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED", completePackagePublished: true,
      ...(source.historicalContextOnly ? { executionReadinessEvaluated: false, currentStateAuthenticityVerified: false,
        historicalPayloadRows: audit.historicalPayloadRows, quarantinedAuxiliaryFileCount: audit.quarantinedAuxiliaryFileCount } : {}),
      inputFileCount: 7, exactLimitedIdentityRows: source.targets.length, snapshotPositionRows: audit.snapshotPositionRows,
      manifestSha256, sourceManifestSha256, inputAuditStatus: audit.status, sourceHashParity: true, unknownOrUnclassifiedRows: 0,
      captureInputSha256: sha256Canonical({ sourceManifestSha256,
        responseHashes: Object.fromEntries(Object.entries(receipts).map(([key, receipt]) => [key, receipt.responseSha256])) }) });
    writeJson(path.join(staging, "result-safe.json"), safe);
    writeJson(path.join(staging, "attempt-terminal.json"), { ...safe, captureStatus: safe.status, status: "COMPLETE" });
    // Publish the complete package and its terminal receipt together, never a partially persisted success.
    fs.renameSync(staging, complete);
    return safe;
  } catch (error) {
    safe.completePackagePublished = false;
    safe.status = error instanceof ContractError ? error.message : "CAPTURE_INPUT_OR_INTERNAL_CONTRACT_INVALID";
    if (ownedOutput) {
      try {
        writeJson(path.join(outputDirectory, "failure-safe.json"), safe);
      } catch { safe.failureReceiptPersisted = false; }
    }
    return safe;
  } finally { if (oldMask !== undefined) process.umask(oldMask); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const offline = process.argv[2] === "--preflight";
  const [sourceDirectory, sourceManifestSha256, outputDirectory] = process.argv.slice(offline ? 3 : 2);
  const result = offline ? inspectCaptureSource(sourceDirectory, sourceManifestSha256)
    : await capturePrivateEvidence({ sourceDirectory, sourceManifestSha256, outputDirectory, approval: process.env.PAPER_PRIVATE_CAPTURE_APPROVAL });
  console.log(JSON.stringify(result));
  if (!["PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED", "PAPER_PRIVATE_CAPTURE_REVIEW_ONLY_COMPLETE", "PAPER_PRIVATE_CAPTURE_SOURCE_PREFLIGHT_PASS"].includes(result.status)) process.exitCode = 1;
}
