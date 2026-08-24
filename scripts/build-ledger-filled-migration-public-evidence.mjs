#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.LEDGER_FILLED_MIGRATION_PUBLIC_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = path.join(STATE_DIR, "ledger-filled-migration-public-evidence.json");
const OUTPUT_MD = path.join(STATE_DIR, "ledger-filled-migration-public-evidence.md");
const readJson = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, name), "utf8"));
  } catch {
    return null;
  }
};
const writeAtomic = (filePath, text) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
};
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const apply = readJson("ledger-filled-migration-apply-report.json");
const fill = readJson("fill-state-reconciliation-audit.json");
const terminal = readJson("ledger-terminalization-proposal.json");
const lanes = readJson("ops-lane-status-report.json");
const health = readJson("ops-health-report.json");
const requestedRows = new Set(Array.isArray(apply?.apply?.symbolFilter) ? apply.apply.symbolFilter.filter(Boolean) : []).size;
const evidence = {
  schemaVersion: "ledger-filled-migration-public-evidence-v1",
  generatedAt: new Date().toISOString(),
  source: {
    workflowRunId: String(process.env.GITHUB_RUN_ID || "") || null,
    headSha: String(process.env.GITHUB_SHA || "") || null,
    sourceReportAvailable: Boolean(apply),
  },
  overall: apply?.overall || "public_evidence_source_incomplete",
  scope: {
    private: true,
    requestedRows,
    maxRows: number(apply?.apply?.maxRows),
  },
  summary: {
    selectedRows: number(apply?.summary?.selectedRows),
    readyRows: number(apply?.summary?.readyRows),
    blockedRows: number(apply?.summary?.blockedRows),
    postVerifiedRows: number(apply?.summary?.postVerifiedRows),
    stateMutationAttempted: apply?.summary?.stateMutationAttempted === true,
    stateMutationApplied: apply?.summary?.stateMutationApplied === true,
  },
  postAudit: {
    fillStateOverall: fill?.overall || null,
    terminalizationOverall: terminal?.overall || null,
    ledgerTerminalizationReviewRequired: number(fill?.summary?.ledgerTerminalizationReviewRequired),
    terminalizationProposalReadyRows: number(terminal?.summary?.proposalReady),
    blockedLaneCount: number(lanes?.summary?.blockedCount),
    healthOverall: health?.overall || null,
  },
  hashEvidence: {
    preWriteOrderLedgerSha256: apply?.fileHashes?.before?.orderLedger?.sha256 || null,
    preWriteIdempotencySha256: apply?.fileHashes?.before?.idempotency?.sha256 || null,
    postWriteOrderLedgerSha256: apply?.fileHashes?.after?.orderLedger?.sha256 || null,
    postWriteIdempotencySha256: apply?.fileHashes?.after?.idempotency?.sha256 || null,
  },
  backup: { created: apply?.backup?.created === true },
  executionPolicy: {
    brokerMutationAllowed: apply?.executionPolicy?.brokerMutationAllowed === true,
    brokerMutationAttempted: apply?.executionPolicy?.brokerMutationAttempted === true,
    brokerMutationSubmitted: apply?.executionPolicy?.brokerMutationSubmitted === true,
    stateMutationAttempted: apply?.executionPolicy?.stateMutationAttempted === true,
    stateMutationApplied: apply?.executionPolicy?.stateMutationApplied === true,
  },
  redaction: {
    privateIdentifiersStoredOrPrinted: false,
    symbolsStoredOrPrinted: false,
    ledgerKeysStoredOrPrinted: false,
    idempotencyKeysStoredOrPrinted: false,
    rawStateStored: false,
  },
};
const markdown = [
  "## Ledger Filled Migration — Redacted Evidence",
  `- overall: \`${evidence.overall}\``,
  `- scope: \`requested=${requestedRows} selected=${evidence.summary.selectedRows}\``,
  `- verification: \`ready=${evidence.summary.readyRows} blocked=${evidence.summary.blockedRows} postVerified=${evidence.summary.postVerifiedRows}\``,
  `- state mutation: \`attempted=${evidence.summary.stateMutationAttempted} applied=${evidence.summary.stateMutationApplied}\``,
  `- broker mutation: \`attempted=${evidence.executionPolicy.brokerMutationAttempted} submitted=${evidence.executionPolicy.brokerMutationSubmitted}\``,
  "- private identifiers: `redacted`",
  "",
].join("\n");
writeAtomic(OUTPUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`);
writeAtomic(OUTPUT_MD, markdown);
console.log(`[LEDGER_FILLED_MIGRATION_PUBLIC_EVIDENCE] overall=${evidence.overall} requested=${requestedRows} selected=${evidence.summary.selectedRows} postVerified=${evidence.summary.postVerifiedRows}`);
