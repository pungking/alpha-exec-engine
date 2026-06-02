import crypto from "node:crypto";
import fs from "node:fs";

const STATE_DIR = String(process.env.LEDGER_FILLED_MIGRATION_STATE_DIR || "state").trim() || "state";
const FILES = {
  terminalizationProposal: `${STATE_DIR}/ledger-terminalization-proposal.json`,
  brokerEvidence: `${STATE_DIR}/broker-fill-state-evidence.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`,
  guardSourceRecovery: `${STATE_DIR}/guard-source-recovery-plan.json`
};
const OUTPUT_JSON = `${STATE_DIR}/ledger-filled-migration-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/ledger-filled-migration-plan.md`;

const readText = (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null);
const readJson = (filePath) => {
  const text = readText(filePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const writeJson = (filePath, payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
};
const sha256 = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const fileMeta = (filePath) => {
  const text = readText(filePath);
  if (text == null) return { exists: false, path: filePath, bytes: 0, sha256: null };
  return { exists: true, path: filePath, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
};

const objectEntryByKey = (object, key) => object?.orders?.[key] || null;
const objectEntryBySymbol = (object, symbol) => {
  const target = asSymbol(symbol);
  let selected = null;
  let selectedAt = 0;
  for (const [key, value] of Object.entries(object?.orders || {})) {
    if (asSymbol(value?.symbol) !== target) continue;
    const at = Date.parse(String(value?.updatedAt || value?.brokerCheckedAt || value?.lastSeenAt || value?.createdAt || ""));
    if (!selected || (Number.isFinite(at) && at >= selectedAt)) {
      selected = { key, ...value };
      selectedAt = Number.isFinite(at) ? at : 0;
    }
  }
  return selected;
};
const indexRows = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const buildRow = ({ proposalRow, brokerEvidenceRow, guardRecoveryRow, orderLedger, idempotency, generatedAt }) => {
  const symbol = asSymbol(proposalRow?.symbol);
  const ledgerKey = proposalRow?.ledgerKey || proposalRow?.proposedPatchPreview?.orderLedger?.key || null;
  const idempotencyKey = proposalRow?.idempotencyKey || proposalRow?.proposedPatchPreview?.orderIdempotency?.key || null;
  const ledgerCurrent = ledgerKey ? objectEntryByKey(orderLedger, ledgerKey) : objectEntryBySymbol(orderLedger, symbol);
  const idempotencyCurrent = idempotencyKey ? objectEntryByKey(idempotency, idempotencyKey) : objectEntryBySymbol(idempotency, symbol);
  const proposedState = String(proposalRow?.proposedTerminalState || "").trim().toLowerCase();
  const patch = proposalRow?.proposedPatchPreview || null;
  const gates = [];
  const addGate = (id, pass, detail) => gates.push({ id, status: pass ? "PASS" : "BLOCK", detail: short(detail, 320) });

  addGate("proposal_ready", proposalRow?.proposalReady === true, `proposalReady=${proposalRow?.proposalReady ?? "N/A"}`);
  addGate("filled_state_only", proposedState === "filled", `proposedTerminalState=${proposedState || "N/A"}`);
  addGate("broker_filled_evidence", brokerEvidenceRow?.evidenceVerdict === "BROKER_FILLED_CONFIRMED", `evidence=${brokerEvidenceRow?.evidenceVerdict || "N/A"}`);
  addGate("ledger_key_present", Boolean(ledgerKey), `ledgerKey=${ledgerKey || "N/A"}`);
  addGate("idempotency_key_present", Boolean(idempotencyKey), `idempotencyKey=${idempotencyKey || "N/A"}`);
  addGate("ledger_current_entry_present", Boolean(ledgerCurrent), `ledger current entry ${ledgerCurrent ? "present" : "missing"}`);
  addGate("idempotency_current_entry_present", Boolean(idempotencyCurrent), `idempotency current entry ${idempotencyCurrent ? "present" : "missing"}`);
  addGate("patch_preview_present", Boolean(patch?.orderLedger?.proposed && patch?.orderIdempotency?.proposed), "proposal patch preview must include ledger and idempotency updates");
  addGate("guard_repair_still_blocked", guardRecoveryRow?.repairEligibleNow !== true, `guardRecovery=${guardRecoveryRow?.recoveryDecision || "N/A"} repairEligibleNow=${guardRecoveryRow?.repairEligibleNow ?? "N/A"}`);

  const ledgerBefore = ledgerCurrent
    ? {
      status: ledgerCurrent.status || null,
      brokerStatus: ledgerCurrent.brokerStatus || null,
      updatedAt: ledgerCurrent.updatedAt || null,
      statusReason: ledgerCurrent.statusReason || null
    }
    : null;
  const ledgerAfter = ledgerCurrent
    ? {
      ...ledgerBefore,
      status: "filled",
      brokerStatus: "filled",
      statusReason: "report_only_broker_evidence_filled",
      brokerEvidenceVerdict: brokerEvidenceRow?.evidenceVerdict || null,
      brokerEvidenceGeneratedAt: brokerEvidenceRow?.generatedAt || brokerEvidenceRow?.brokerOrder?.filledAt || generatedAt,
      filledAt: ledgerCurrent.filledAt || brokerEvidenceRow?.brokerOrder?.filledAt || brokerEvidenceRow?.fillActivity?.latest?.transactionTime || null
    }
    : null;
  const idempotencyBefore = idempotencyCurrent
    ? {
      brokerStatus: idempotencyCurrent.brokerStatus || null,
      status: idempotencyCurrent.status || null,
      brokerCheckedAt: idempotencyCurrent.brokerCheckedAt || null,
      releasedAt: idempotencyCurrent.releasedAt || null,
      releaseReason: idempotencyCurrent.releaseReason || null
    }
    : null;
  const idempotencyAfter = idempotencyCurrent
    ? {
      ...idempotencyBefore,
      brokerStatus: "filled",
      terminal: false,
      releaseReason: null,
      brokerEvidenceVerdict: brokerEvidenceRow?.evidenceVerdict || null,
      brokerEvidenceGeneratedAt: generatedAt
    }
    : null;

  const blockingGates = gates.filter((gate) => gate.status !== "PASS");
  const readyForApplyReview = blockingGates.length === 0;
  return {
    symbol,
    proposalDecision: proposalRow?.proposalDecision || null,
    proposedTerminalState: proposedState || null,
    brokerEvidenceVerdict: brokerEvidenceRow?.evidenceVerdict || null,
    guardRecoveryDecision: guardRecoveryRow?.recoveryDecision || null,
    readyForApplyReview,
    blockingGates: blockingGates.length,
    gates,
    keys: { ledgerKey, idempotencyKey },
    backupRequired: true,
    diffPreview: {
      orderLedger: { key: ledgerKey, before: ledgerBefore, after: ledgerAfter },
      orderIdempotency: { key: idempotencyKey, before: idempotencyBefore, after: idempotencyAfter }
    },
    auditRecordPreview: {
      type: "ledger_filled_terminalization",
      generatedAt,
      symbol,
      ledgerKey,
      idempotencyKey,
      brokerEvidenceVerdict: brokerEvidenceRow?.evidenceVerdict || null,
      brokerOrderStatus: brokerEvidenceRow?.brokerOrder?.status || null,
      brokerFillQty: toNum(brokerEvidenceRow?.fillActivity?.qty),
      previousLedgerStatus: ledgerBefore?.status || null,
      proposedLedgerStatus: ledgerAfter?.status || null,
      previousIdempotencyBrokerStatus: idempotencyBefore?.brokerStatus || null,
      proposedIdempotencyBrokerStatus: idempotencyAfter?.brokerStatus || null,
      stateMutationApplied: false
    },
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationApplied: false,
    reason: readyForApplyReview ? "manual_state_migration_review_ready" : `blocked:${blockingGates.map((gate) => gate.id).join(",")}`
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ledger Filled Migration Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} readyForApplyReview=${report.summary.readyForApplyReview} blocked=${report.summary.blocked} backupRequired=${report.summary.backupRequired} diffPreview=${report.summary.diffPreviewRows} auditPreview=${report.summary.auditPreviewRows}\``
  );
  lines.push("- safety: `report-first; no state mutation; applying requires separate scoped approval/migration task`");
  lines.push(`- backup_plan: \`orderLedger=${report.backupPlan.orderLedgerBackupPath} idempotency=${report.backupPlan.idempotencyBackupPath} audit=${report.backupPlan.auditRecordPath}\``);
  lines.push("| Symbol | Ready | Proposed State | Broker Evidence | Ledger Key | Idempotency Key | Gates Blocked | Reason |");
  lines.push("| --- | --- | --- | --- | --- | --- | ---: | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.readyForApplyReview ? "yes" : "no"} | ${row.proposedTerminalState || "N/A"} | ${row.brokerEvidenceVerdict || "N/A"} | ${row.keys.ledgerKey || "N/A"} | ${row.keys.idempotencyKey || "N/A"} | ${row.blockingGates} | ${short(row.reason, 180)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const terminalizationProposal = readJson(FILES.terminalizationProposal);
  const brokerEvidence = readJson(FILES.brokerEvidence);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.idempotency);
  const guardSourceRecovery = readJson(FILES.guardSourceRecovery);
  const evidenceBySymbol = indexRows(brokerEvidence?.rows);
  const guardBySymbol = indexRows(guardSourceRecovery?.rows);
  const proposalRows = (Array.isArray(terminalizationProposal?.rows) ? terminalizationProposal.rows : [])
    .filter((row) => row.proposalReady === true && String(row.proposedTerminalState || "").toLowerCase() === "filled");
  const rows = proposalRows.map((proposalRow) => {
    const symbol = asSymbol(proposalRow?.symbol);
    return buildRow({
      proposalRow,
      brokerEvidenceRow: evidenceBySymbol.get(symbol) || null,
      guardRecoveryRow: guardBySymbol.get(symbol) || null,
      orderLedger,
      idempotency,
      generatedAt
    });
  });
  const backupStamp = generatedAt.replace(/[:.]/g, "-");
  const backupDir = `${STATE_DIR}/migration-backups/${backupStamp}`;
  const summary = {
    rows: rows.length,
    readyForApplyReview: count(rows, (row) => row.readyForApplyReview),
    blocked: count(rows, (row) => !row.readyForApplyReview),
    backupRequired: rows.length > 0,
    backupPlanPresent: rows.length > 0,
    diffPreviewRows: count(rows, (row) => row.diffPreview?.orderLedger?.after && row.diffPreview?.orderIdempotency?.after),
    auditPreviewRows: count(rows, (row) => row.auditRecordPreview),
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  };
  const overall = rows.length === 0
    ? "no_filled_terminalization_rows"
    : summary.readyForApplyReview > 0 && summary.blocked === 0
      ? "manual_state_migration_apply_review_ready"
      : summary.readyForApplyReview > 0
        ? "partial_manual_state_migration_review_ready"
        : "blocked_migration_gates";
  const report = {
    generatedAt,
    overall,
    scope: "portfolio_wide_dynamic_order_ledger_idempotency_filled_migration_plan_report_first_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    fileHashes: {
      orderLedger: fileMeta(FILES.orderLedger),
      idempotency: fileMeta(FILES.idempotency)
    },
    source: {
      terminalizationProposalOverall: terminalizationProposal?.overall || null,
      brokerEvidenceOverall: brokerEvidence?.overall || null,
      guardSourceRecoveryOverall: guardSourceRecovery?.overall || null
    },
    backupPlan: {
      requiredBeforeApply: rows.length > 0,
      backupDir,
      orderLedgerBackupPath: `${backupDir}/order-ledger.json.before`,
      idempotencyBackupPath: `${backupDir}/order-idempotency.json.before`,
      auditRecordPath: `${backupDir}/ledger-filled-migration-audit.jsonl`,
      restorePlan: "copy *.before files back to state/ and preserve audit jsonl; never delete the failed post-migration files silently"
    },
    executionPolicy: {
      mode: "report_first_migration_plan_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      stateMutationApplied: false,
      requiresSeparateApprovalForStateWrite: true
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[LEDGER_FILLED_MIGRATION_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} rows=${summary.rows} ready=${summary.readyForApplyReview} blocked=${summary.blocked} stateMutationApplied=false`
  );
};

main();
