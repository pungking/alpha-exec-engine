#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.LEDGER_TERMINALIZATION_MIGRATION_PACKAGE_STATE_DIR || process.env.STATE_DIR || "state").trim() || "state";
const FILES = {
  protectionBlockerReduction: path.join(STATE_DIR, "protection-blocker-reduction-plan.json"),
  fillStateAudit: path.join(STATE_DIR, "fill-state-reconciliation-audit.json"),
  terminalizationProposal: path.join(STATE_DIR, "ledger-terminalization-proposal.json"),
  brokerEvidence: path.join(STATE_DIR, "broker-fill-state-evidence.json"),
  orderLedger: path.join(STATE_DIR, "order-ledger.json"),
  idempotency: path.join(STATE_DIR, "order-idempotency.json"),
  ownershipDecision: path.join(STATE_DIR, "position-ownership-recovery-decision.json"),
};
const OUTPUT_JSON = path.join(STATE_DIR, "ledger-terminalization-migration-package.json");
const OUTPUT_MD = path.join(STATE_DIR, "ledger-terminalization-migration-package.md");
const REQUIRED_APPROVAL = "CONFIRM STATE LEDGER MIGRATION";

const readText = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
const readJson = (filePath, fallback = {}) => {
  const text = readText(filePath);
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch (error) { return { __readError: String(error?.message || error) }; }
};
const writeAtomic = (filePath, text) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
};
const sha256 = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
const fileMeta = (filePath) => {
  const text = readText(filePath);
  return text == null
    ? { exists: false, path: filePath, bytes: 0, sha256: null }
    : { exists: true, path: filePath, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
};
const rows = (report) => Array.isArray(report?.rows) ? report.rows : Array.isArray(report?.records) ? report.records : [];
const sym = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const indexBySymbol = (items) => new Map(rows(items).map((row) => [sym(row?.symbol), row]).filter(([symbol]) => symbol));
const uniqueSymbols = (items) => [...new Set(items.map((item) => sym(item?.symbol || item)).filter(Boolean))].sort();

function classify({ proposalRow, fillRow, ownershipRow }) {
  const blockers = Array.isArray(proposalRow?.blockers) ? proposalRow.blockers.map(String) : [];
  const ownershipText = `${fillRow?.ownershipClassification || ""} ${ownershipRow?.ownershipClassification || ""} ${ownershipRow?.ownershipRecoveryDecision || ""}`;
  if (/EXTERNAL|MANUAL|DO_NOT_AUTO_RECOVER/.test(ownershipText)) return "ownership_recovery_track";
  if (proposalRow?.proposalReady === true) return "proposal_ready";
  if (blockers.some((b) => /broker_evidence|evidence|ledger_row_missing|idempotency_row_missing/i.test(b))) return "needs_broker_or_lifecycle_evidence";
  return "blocked";
}

function buildPackageRow({ proposalRow, fillRow, brokerRow, ownershipRow, generatedAt }) {
  const symbol = sym(proposalRow?.symbol);
  const packageDecision = classify({ proposalRow, fillRow, ownershipRow });
  const patch = proposalRow?.proposedPatchPreview || {};
  const affectedStateFiles = [
    patch.orderLedger ? "order-ledger.json" : null,
    patch.orderIdempotency ? "order-idempotency.json" : null,
  ].filter(Boolean);
  const proposedTerminalStatus = proposalRow?.proposedTerminalState || patch.orderLedger?.proposed?.status || patch.orderIdempotency?.proposed?.brokerStatus || null;
  const readyForMigrationReview = packageDecision === "proposal_ready" && affectedStateFiles.length > 0;
  return {
    symbol,
    packageDecision,
    readyForMigrationReview,
    currentLedgerStatus: proposalRow?.ledgerStatus || patch.orderLedger?.before?.status || null,
    brokerEvidenceStatus: proposalRow?.brokerEvidenceVerdict || brokerRow?.evidenceVerdict || null,
    proposedTerminalStatus,
    affectedStateFiles,
    backupRequired: true,
    diffPreview: {
      orderLedger: patch.orderLedger ? {
        key: patch.orderLedger.key || proposalRow?.ledgerKey || null,
        before: patch.orderLedger.before || null,
        after: patch.orderLedger.proposed || null,
      } : null,
      orderIdempotency: patch.orderIdempotency ? {
        key: patch.orderIdempotency.key || proposalRow?.idempotencyKey || null,
        before: patch.orderIdempotency.before || null,
        after: patch.orderIdempotency.proposed || null,
      } : null,
    },
    auditRecordPreview: {
      type: "ledger_terminalization_pre_migration_review",
      generatedAt,
      symbol,
      packageDecision,
      ledgerKey: proposalRow?.ledgerKey || patch.orderLedger?.key || null,
      idempotencyKey: proposalRow?.idempotencyKey || patch.orderIdempotency?.key || null,
      brokerEvidenceStatus: proposalRow?.brokerEvidenceVerdict || brokerRow?.evidenceVerdict || null,
      currentLedgerStatus: proposalRow?.ledgerStatus || patch.orderLedger?.before?.status || null,
      proposedTerminalStatus,
      requiredApprovalPhrase: REQUIRED_APPROVAL,
      stateMutationApplied: false,
    },
    postVerifyChecks: [
      "rerun npm run ops:fill-state-reconcile",
      "rerun npm run ops:ledger-terminalization-proposal",
      "rerun npm run ops:protection-blocker-reduction",
      "confirm changed symbol no longer appears in requiresTerminalizationReview",
      "confirm brokerMutationAttempted=false and state mutation is limited to approved migration task",
    ],
    mutationAllowed: false,
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
    requiredApprovalPhrase: REQUIRED_APPROVAL,
    blockers: Array.isArray(proposalRow?.blockers) ? proposalRow.blockers : [],
    nextAction: packageDecision === "proposal_ready"
      ? "manual_review_then_separate_state_migration_task"
      : packageDecision === "ownership_recovery_track"
        ? "move_to_ownership_recovery_track_before_ledger_migration"
        : packageDecision === "needs_broker_or_lifecycle_evidence"
          ? "collect_stronger_broker_or_position_lifecycle_evidence"
          : "keep_blocked_until_terminalization_blockers_clear",
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("## Ledger Terminalization Migration Package");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(`- safety: \`report-only; no broker mutation; no state ledger/idempotency mutation\``);
  lines.push(`- summary: \`rows=${report.summary.rows} ready=${report.summary.readyForMigrationReview} evidenceNeeded=${report.summary.needsBrokerOrLifecycleEvidence} blocked=${report.summary.blocked} ownershipTrack=${report.summary.ownershipRecoveryTrack}\``);
  lines.push(`- approval: \`${REQUIRED_APPROVAL}\` required before any state write`);
  lines.push("| Symbol | Package Decision | Ready | Current Ledger | Broker Evidence | Proposed Terminal | Files | Next Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 80)) {
    lines.push(`| ${row.symbol || "N/A"} | ${row.packageDecision} | ${row.readyForMigrationReview ? "yes" : "no"} | ${row.currentLedgerStatus || "N/A"} | ${row.brokerEvidenceStatus || "N/A"} | ${row.proposedTerminalStatus || "N/A"} | ${row.affectedStateFiles.join(",") || "N/A"} | ${short(row.nextAction, 160)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildReport() {
  const generatedAt = new Date().toISOString();
  const protection = readJson(FILES.protectionBlockerReduction);
  const fill = readJson(FILES.fillStateAudit);
  const proposal = readJson(FILES.terminalizationProposal);
  const broker = readJson(FILES.brokerEvidence);
  const ownership = readJson(FILES.ownershipDecision);
  const fillBySymbol = indexBySymbol(fill);
  const brokerBySymbol = indexBySymbol(broker);
  const ownershipBySymbol = indexBySymbol(ownership);
  const packageRows = rows(proposal).map((proposalRow) => {
    const symbol = sym(proposalRow?.symbol);
    return buildPackageRow({
      proposalRow,
      fillRow: fillBySymbol.get(symbol) || null,
      brokerRow: brokerBySymbol.get(symbol) || null,
      ownershipRow: ownershipBySymbol.get(symbol) || null,
      generatedAt,
    });
  });
  const count = (decision) => packageRows.filter((row) => row.packageDecision === decision).length;
  const summary = {
    rows: packageRows.length,
    readyForMigrationReview: packageRows.filter((row) => row.readyForMigrationReview).length,
    proposalReady: count("proposal_ready"),
    needsBrokerOrLifecycleEvidence: count("needs_broker_or_lifecycle_evidence"),
    blocked: count("blocked"),
    ownershipRecoveryTrack: count("ownership_recovery_track"),
    affectedSymbols: uniqueSymbols(packageRows),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
  };
  const overall = summary.rows === 0
    ? "no_terminalization_rows"
    : summary.readyForMigrationReview > 0
      ? "manual_state_migration_package_ready"
      : "blocked_no_ready_migration_package";
  return {
    schemaVersion: "1.0.0",
    generatedAt,
    overall,
    scope: "portfolio_wide_dynamic_ledger_terminalization_pre_migration_package_report_only_not_ticker_specific",
    reportOnly: true,
    mutationAllowed: false,
    requiredApprovalPhrase: REQUIRED_APPROVAL,
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    fileHashes: {
      orderLedger: fileMeta(FILES.orderLedger),
      orderIdempotency: fileMeta(FILES.idempotency),
    },
    source: {
      protectionOverall: protection?.finalVerdict || protection?.overall || null,
      fillStateOverall: fill?.overall || null,
      terminalizationOverall: proposal?.overall || null,
      brokerEvidenceOverall: broker?.overall || null,
      ownershipOverall: ownership?.overall || null,
    },
    backupPlan: {
      requiredBeforeApply: summary.readyForMigrationReview > 0,
      files: ["order-ledger.json", "order-idempotency.json"],
      backupPathTemplate: "state/migration-backups/<timestamp>/{order-ledger.json.before,order-idempotency.json.before}",
      auditRecordPathTemplate: "state/migration-backups/<timestamp>/ledger-terminalization-migration-audit.jsonl",
      restorePlan: "restore *.before files atomically and preserve failed post-migration files for audit",
    },
    executionPolicy: {
      mode: "report_only_pre_migration_package",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      stateMutationSubmitted: false,
      requiresSeparateApprovalForStateWrite: true,
    },
    summary,
    rows: packageRows,
  };
}

const report = buildReport();
writeAtomic(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeAtomic(OUTPUT_MD, renderMarkdown(report));
console.log(`[LEDGER_TERMINALIZATION_MIGRATION_PACKAGE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} rows=${report.summary.rows} ready=${report.summary.readyForMigrationReview} attempted=false submitted=false`);
