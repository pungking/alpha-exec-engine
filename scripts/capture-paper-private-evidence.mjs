#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { FILES, ContractError, readPrivate, readPrivateBytes, validateTargets, validateShadow, auditPrivateCloseoutEvidence } from "./audit-paper-closeout-private-evidence.mjs";
import { ACTIVE_POSITION_LIMITED_RECOVERY_MODE, sha256Canonical } from "./lib/active-position-limited-recovery.mjs";
import { buildLiveSummary, buildBrokerRealizedPnlSummary } from "./build-performance-dashboard.mjs";

export const CAPTURE_APPROVAL = "AUTHORIZE PAPER COMPLETE PRIVATE EVIDENCE READ-ONLY ONE-SHOT";
const PAPER = "https://paper-api.alpaca.markets";
const REQUIRED = [FILES.preview, FILES.orderLedger, FILES.orderIdempotency];
const OPTIONAL = ["fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json"];
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

function preflight(directory, pin) {
  privateDirectory(directory);
  const manifest = readPrivate(path.join(directory, "source-manifest.json"), pin);
  requireContract(manifest.schemaVersion === "paper-private-capture-source-v1" && manifest.environment === "PAPER"
    && manifest.evidenceBasis === "PRESERVED_STATE_SNAPSHOT" && /^\d+$/.test(manifest.sourceRunId)
    && hash(manifest.expectedPaperAccountSha256) && object(manifest.files), "CAPTURE_SOURCE_MANIFEST_INVALID");
  const names = Object.keys(manifest.files);
  requireContract(REQUIRED.every(n => names.includes(n)) && names.every(n => [...REQUIRED, ...OPTIONAL].includes(n)), "CAPTURE_SOURCE_FILE_SET_INVALID");
  const values = Object.fromEntries(names.map(n => [n, readPrivate(path.join(directory, n), manifest.files[n])]));
  const ledger = values[FILES.orderLedger], idem = values[FILES.orderIdempotency], preview = values[FILES.preview];
  requireContract(object(ledger.orders) && object(idem.orders), "PRIVATE_STATE_SCHEMA_INVALID");
  const targets = Object.entries(idem.orders).filter(([, r]) => r?.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE).map(([key, row]) => {
    const matches = Object.entries(ledger.orders).filter(([, l]) => l?.idempotencyKey === key);
    requireContract(matches.length === 1, matches.length ? "PRIVATE_IDENTITY_AMBIGUOUS" : "PRIVATE_EXACT_ENTRY_MISSING");
    return { ledgerKey: matches[0][0], idempotencyKey: key, ledgerRecordSha256: sha256Canonical(matches[0][1]), idempotencyRecordSha256: sha256Canonical(row) };
  }).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
  validateTargets(targets, { orderLedger: ledger, orderIdempotency: idem });
  // Existing report joins are symbol-based; never let another historical row replace an exact target.
  for (const { ledgerKey } of targets) {
    const symbol = ledger.orders[ledgerKey].symbol.toUpperCase();
    requireContract([ledger, idem].every(state => Object.values(state.orders)
      .filter(row => String(row?.symbol || "").toUpperCase() === symbol).length === 1), "CAPTURE_REPORT_IDENTITY_AMBIGUOUS");
  }
  validateShadow(preview.paperExitShadowIntent);
  requireContract(Number.isFinite(Date.parse(preview.generatedAt)) && preview.mode?.readOnly === true && preview.mode?.execEnabled === false
    && preview.actionIntent?.previewOnly === true && Array.isArray(preview.payloads) && preview.payloads.length === 0
    && preview.paperExitShadowIntent.mode === "REPORT_ONLY_SHADOW"
    && ["wouldCreateBrokerPayload", "brokerMutationAttempted", "brokerMutationSubmitted", "stateMutationAttempted", "stateMutationSubmitted"]
      .every(k => preview.paperExitShadowIntent[k] === false), "PRIVATE_SHADOW_CONTRACT_INVALID");
  return { manifest, values, targets };
}

function validateResponse(group, data, manifest, nowMs) {
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

async function brokerSnapshot({ fetchImpl, env, requestCounts, manifest, now }) {
  const results = {}, receipts = {};
  for (const [group, route] of Object.entries(ROUTES)) {
    requireContract(requestCounts[group] === 0 && requestCounts.total < 5, "CAPTURE_REQUEST_BUDGET_EXCEEDED");
    requestCounts[group]++; requestCounts.total++;
    let response, bytes;
    const requestedAt = now().toISOString();
    try {
      response = await fetchImpl(`${PAPER}${route}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET_KEY } });
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
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch { throw new ContractError("CAPTURE_BROKER_SCHEMA_INVALID"); }
    validateResponse(group, data, manifest, now().getTime());
    results[group] = { ok: true, status: response.status, data, reason: "ok" };
    receipts[group] = { requestedAt, retrievedAt: now().toISOString(), responseSha256: digest(bytes), httpStatus: response.status };
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
    source = preflight(sourceDirectory, sourceManifestSha256);
    requireContract(Date.parse(source.values[FILES.preview].generatedAt) <= now().getTime(), "CAPTURE_SOURCE_FUTURE_TIMESTAMP");
    validateObservedTimestamps(source.values, now().getTime(), "SOURCE");
    oldMask = process.umask(0o077);
    // Exclusive directory creation is the pre-network one-shot claim. Failures are never reset or retried here.
    try { fs.mkdirSync(outputDirectory, { mode: 0o700 }); } catch { throw new ContractError("CAPTURE_OUTPUT_ALREADY_EXISTS"); }
    ownedOutput = true;
    writeJson(path.join(outputDirectory, "attempt.json"), { status: "IN_PROGRESS", sourceManifestSha256, ...safe });
    const work = path.join(outputDirectory, "private-work"); fs.mkdirSync(work, { mode: 0o700 });
    for (const [name, expected] of Object.entries(source.manifest.files)) {
      const bytes = readPrivateBytes(path.join(sourceDirectory, name), expected);
      fs.writeFileSync(path.join(work, name), bytes, { flag: "wx", mode: 0o600 });
    }
    const startedAt = now().toISOString();
    const { results, receipts } = await brokerSnapshot({ fetchImpl, env, requestCounts, manifest: source.manifest, now });
    const orderLedger = source.values[FILES.orderLedger], orderIdempotency = source.values[FILES.orderIdempotency];
    const live = await buildLiveSummary(async route => results[Object.keys(ROUTES).find(k => ROUTES[k] === route)],
      { ledger: orderLedger, idempotency: orderIdempotency, fillability: source.values["fillability-report.json"] || {} });
    const dashboard = { generatedAt: now().toISOString(), live,
      realizedPnl: buildBrokerRealizedPnlSummary({ orderLedger, orderIdempotency, closedOrders: results.closedOrders.data,
        currentPositions: live.positions, paperMode: true, closedOrdersSourceComplete: false, positionsSourceComplete: true }) };
    writeJson(path.join(work, FILES.performance), dashboard);
    buildLocalReports(work);
    validatePortfolio(work, live.positions, source.values[FILES.preview]);
    const complete = path.join(outputDirectory, "complete"), staging = path.join(outputDirectory, "complete.pending");
    fs.mkdirSync(staging, { mode: 0o700 });
    const files = {};
    for (const name of Object.values(FILES)) {
      const bytes = fs.readFileSync(path.join(work, name));
      fs.writeFileSync(path.join(staging, name), bytes, { flag: "wx", mode: 0o600 }); files[name] = digest(bytes);
    }
    const manifest = { schemaVersion: "paper-closeout-private-evidence-v1", environment: "PAPER", evidenceBasis: "PRESERVED_SNAPSHOT",
      sourceManifestSha256, files, targets: source.targets };
    writeJson(path.join(staging, "manifest.json"), manifest);
    const manifestSha256 = digest(fs.readFileSync(path.join(staging, "manifest.json")));
    // Pin exact bytes before invoking the existing auditor once. This is integrity, not current eligibility.
    writeJson(path.join(outputDirectory, "manifest-pin.json"), { manifestSha256 });
    const audit = auditPrivateCloseoutEvidence(staging, manifestSha256);
    for (const [name, expected] of Object.entries(source.manifest.files)) {
      try {
        readPrivateBytes(path.join(sourceDirectory, name), expected);
        readPrivateBytes(path.join(work, name), expected);
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
    Object.assign(safe, { status: "PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED", completePackagePublished: true,
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
  const [, , sourceDirectory, sourceManifestSha256, outputDirectory] = process.argv;
  const result = await capturePrivateEvidence({ sourceDirectory, sourceManifestSha256, outputDirectory, approval: process.env.PAPER_PRIVATE_CAPTURE_APPROVAL });
  console.log(JSON.stringify(result));
  if (result.status !== "PAPER_PRIVATE_CAPTURE_COMPLETE_CURRENT_PROOF_REQUIRED") process.exitCode = 1;
}
