import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_CACHE_KEY = "sidecar-state-main-32742503181";
const ALLOWED_VERDICTS = new Set([
  "BROKER_FILLED_CONFIRMED",
  "BROKER_TERMINAL_UNFILLED_CONFIRMED",
  "POSITION_PRESENT_WITH_BROKER_ORDER_STILL_WORKING",
  "POSITION_PRESENT_BROKER_EVIDENCE_INCONCLUSIVE",
  "BROKER_ORDER_STILL_WORKING",
  "BROKER_TERMINAL_BUT_POSITION_REVIEW_REQUIRED",
  "BROKER_EVIDENCE_INCONCLUSIVE",
]);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, payload) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fail = (safeOutput, payload, status) => {
  writeJson(safeOutput, { ...payload, status });
  throw new Error(status);
};

export function initializeSafeEvidence({ safeOutput }) {
  const payload = {
    schemaVersion: "paper-five-row-broker-evidence-safe-v1",
    mode: "PAPER_BROKER_GET_ONLY_CACHE_RESTORE",
    status: "PREFLIGHT_PENDING",
    generatedAt: new Date().toISOString(),
    sourceCacheKey: SOURCE_CACHE_KEY,
    preservedBaselineRunId: 32734129649,
    cacheExactMatch: false,
    targetRows: null,
    brokerGetRequestCount: 0,
    requestBudgetCompliant: true,
    privateEvidenceUploaded: false,
    privateIdentifiersStoredInArtifact: false,
    rawBrokerResponseStored: false,
    stateMutationAttempted: false,
    brokerMutationAttempted: false,
    canonicalSourceChanged: false,
    policyImpact: "NONE_REPORT_ONLY",
  };
  writeJson(safeOutput, payload);
  return payload;
}

export function preflightSafeEvidence({ stateDir, safeOutput, preflightFile, cacheHit }) {
  const safe = readJson(safeOutput);
  if (!cacheHit) fail(safeOutput, safe, "PREFLIGHT_EXACT_CACHE_MISS");
  const auditPath = path.join(stateDir, "fill-state-reconciliation-audit.json");
  const ledgerPath = path.join(stateDir, "order-ledger.json");
  const idempotencyPath = path.join(stateDir, "order-idempotency.json");
  if (![auditPath, ledgerPath, idempotencyPath].every(fs.existsSync)) {
    fail(safeOutput, { ...safe, cacheExactMatch: true }, "PREFLIGHT_REQUIRED_STATE_MISSING");
  }
  const audit = readJson(auditPath);
  const rows = Array.isArray(audit.rows) ? audit.rows : [];
  const targets = rows.filter((row) =>
    row.requiresLedgerTerminalizationReview === true
    || row.reconciliationDecision === "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE"
  );
  const targetRows = targets.length;
  if (targetRows !== 5) {
    fail(safeOutput, { ...safe, cacheExactMatch: true, targetRows }, "PREFLIGHT_SCOPE_MISMATCH");
  }
  const identities = targets.map((row) => String(row.ledger?.key || row.idempotency?.key || "").trim());
  const uniqueIdentityRows = new Set(identities.filter(Boolean)).size;
  if (identities.some((identity) => !identity) || uniqueIdentityRows !== targetRows) {
    fail(
      safeOutput,
      { ...safe, cacheExactMatch: true, targetRows, uniqueIdentityRows },
      "PREFLIGHT_IDENTITY_SCOPE_INVALID",
    );
  }
  writeJson(preflightFile, {
    orderLedgerSha256: sha256(ledgerPath),
    idempotencySha256: sha256(idempotencyPath),
  });
  const result = {
    ...safe,
    status: "PREFLIGHT_PASS",
    cacheExactMatch: true,
    targetRows,
    uniqueIdentityRows,
  };
  writeJson(safeOutput, result);
  return result;
}

export function buildAggregateSafeEvidence({ stateDir, safeOutput, preflightFile, brokerStepOutcome }) {
  const safe = readJson(safeOutput);
  const reportPath = path.join(stateDir, "broker-fill-state-evidence.json");
  if (!fs.existsSync(reportPath)) {
    fail(
      safeOutput,
      { ...safe, brokerStepOutcome, requestBudgetCompliant: false },
      "BROKER_EVIDENCE_UNAVAILABLE",
    );
  }
  const report = readJson(reportPath);
  const preflight = readJson(preflightFile);
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const count = (predicate) => rows.filter(predicate).length;
  const brokerGetRequestCount = rows.reduce((total, row) => total + 4 + (row.clientOrderId ? 1 : 0), 0);
  const orderLedgerHashParity = preflight.orderLedgerSha256 === sha256(path.join(stateDir, "order-ledger.json"));
  const idempotencyHashParity = preflight.idempotencySha256 === sha256(path.join(stateDir, "order-idempotency.json"));
  const stateMutationAttempted = report.executionPolicy?.stateMutationAttempted === true;
  const brokerMutationAttempted = report.executionPolicy?.brokerMutationAttempted === true;
  const unknownOrUnclassifiedRows = count((row) => !ALLOWED_VERDICTS.has(row.evidenceVerdict));
  const requestBudgetCompliant = rows.length === 5 && brokerGetRequestCount <= 25;
  const contractPass = brokerStepOutcome === "success"
    && requestBudgetCompliant
    && unknownOrUnclassifiedRows === 0
    && orderLedgerHashParity
    && idempotencyHashParity
    && !stateMutationAttempted
    && !brokerMutationAttempted;
  const aggregate = {
    ...safe,
    status: contractPass
      ? "PAPER_FIVE_ROW_BROKER_EVIDENCE_AGGREGATE_READY"
      : "PAPER_FIVE_ROW_BROKER_EVIDENCE_CONTRACT_BLOCKED",
    brokerStepOutcome,
    targetRows: rows.length,
    brokerGetRequestCount,
    maxBrokerGetRequests: 25,
    requestBudgetCompliant,
    activePositionRows: count((row) => {
      const qty = Number(row.brokerPosition?.qty);
      return Number.isFinite(qty) && qty !== 0;
    }),
    zeroOrNotFoundPositionRows: count((row) => {
      const qty = Number(row.brokerPosition?.qty);
      return (row.brokerPosition && Number.isFinite(qty) && qty === 0)
        || row.readStatus?.position?.status === 404;
    }),
    positionEvidenceUnavailableRows: count((row) =>
      !row.brokerPosition && row.readStatus?.position?.status !== 404
    ),
    openOrderEvidencePresentRows: count((row) => Number(row.readStatus?.openOrders?.count || 0) > 0),
    brokerFilledConfirmedRows: count((row) => row.evidenceVerdict === "BROKER_FILLED_CONFIRMED"),
    terminalEvidenceRows: count((row) => String(row.evidenceVerdict || "").includes("TERMINAL")),
    workingOrderEvidenceRows: count((row) => String(row.evidenceVerdict || "").includes("WORKING")),
    inconclusiveEvidenceRows: count((row) => String(row.evidenceVerdict || "").includes("INCONCLUSIVE")),
    unknownOrUnclassifiedRows,
    orderLedgerHashParity,
    idempotencyHashParity,
    stateMutationAttempted,
    brokerMutationAttempted,
    privateEvidenceUploaded: false,
    privateIdentifiersStoredInArtifact: false,
    rawBrokerResponseStored: false,
  };
  writeJson(safeOutput, aggregate);
  if (!contractPass) throw new Error(aggregate.status);
  return aggregate;
}

function runCli() {
  const phase = String(process.env.PAPER_FIVE_ROW_SAFE_PHASE || "").trim().toLowerCase();
  const safeOutput = process.env.SAFE_OUTPUT;
  if (!safeOutput) throw new Error("SAFE_OUTPUT_REQUIRED");
  if (phase === "initialize") {
    initializeSafeEvidence({ safeOutput });
    return;
  }
  const stateDir = process.env.BROKER_FILL_STATE_EVIDENCE_STATE_DIR;
  const preflightFile = process.env.PAPER_FIVE_ROW_PREFLIGHT_FILE;
  if (!stateDir || !preflightFile) throw new Error("PRIVATE_STATE_PREFLIGHT_PATH_REQUIRED");
  if (phase === "preflight") {
    const result = preflightSafeEvidence({
      stateDir,
      safeOutput,
      preflightFile,
      cacheHit: process.env.PAPER_FIVE_ROW_CACHE_HIT === "true",
    });
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "ready=true\n");
    console.log(`[PAPER_FIVE_ROW_PREFLIGHT] pass targetRows=${result.targetRows}`);
    return;
  }
  if (phase === "postflight") {
    const result = buildAggregateSafeEvidence({
      stateDir,
      safeOutput,
      preflightFile,
      brokerStepOutcome: process.env.PAPER_FIVE_ROW_BROKER_STEP_OUTCOME || "unknown",
    });
    console.log(
      `[PAPER_FIVE_ROW_POSTFLIGHT] status=${result.status} rows=${result.targetRows} brokerGets=${result.brokerGetRequestCount}`,
    );
    return;
  }
  throw new Error("PAPER_FIVE_ROW_SAFE_PHASE_INVALID");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(`[PAPER_FIVE_ROW_SAFE] ${error instanceof Error ? error.message : "SAFE_EVIDENCE_FAILED"}`);
    process.exit(1);
  }
}
