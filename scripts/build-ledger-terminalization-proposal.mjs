import fs from "node:fs";

const STATE_DIR = String(process.env.LEDGER_TERMINALIZATION_PROPOSAL_STATE_DIR || "state").trim() || "state";
const FILES = {
  brokerEvidence: `${STATE_DIR}/broker-fill-state-evidence.json`,
  fillStateAudit: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`,
  guardSourceRecovery: `${STATE_DIR}/guard-source-recovery-plan.json`
};
const OUTPUT_JSON = `${STATE_DIR}/ledger-terminalization-proposal.json`;
const OUTPUT_MD = `${STATE_DIR}/ledger-terminalization-proposal.md`;

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};

const latestObjectBySymbol = (object) => {
  const out = new Map();
  for (const [key, value] of Object.entries(object?.orders || {})) {
    const row = { key, ...value };
    const symbol = asSymbol(row?.symbol);
    if (!symbol) continue;
    const prev = out.get(symbol);
    const at = Date.parse(String(row?.updatedAt || row?.brokerCheckedAt || row?.lastSeenAt || row?.createdAt || ""));
    const prevAt = Date.parse(String(prev?.updatedAt || prev?.brokerCheckedAt || prev?.lastSeenAt || prev?.createdAt || ""));
    if (!prev || (Number.isFinite(at) && (!Number.isFinite(prevAt) || at >= prevAt))) out.set(symbol, row);
  }
  return out;
};
const indexRows = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const terminalUpdatePatch = ({ evidenceRow, ledgerRow, idempotencyRow, terminalState }) => {
  const nowReason = `report_only_broker_evidence_${terminalState}`;
  return {
    orderLedger: ledgerRow
      ? {
        key: ledgerRow.key || null,
        before: {
          status: ledgerRow.status || null,
          brokerStatus: ledgerRow.brokerStatus || null,
          updatedAt: ledgerRow.updatedAt || null
        },
        proposed: {
          status: terminalState,
          brokerStatus: terminalState,
          statusReason: nowReason,
          brokerEvidenceVerdict: evidenceRow.evidenceVerdict,
          brokerEvidenceGeneratedAt: evidenceRow.generatedAt || null
        }
      }
      : null,
    orderIdempotency: idempotencyRow
      ? {
        key: idempotencyRow.key || null,
        before: {
          brokerStatus: idempotencyRow.brokerStatus || null,
          status: idempotencyRow.status || null,
          brokerCheckedAt: idempotencyRow.brokerCheckedAt || null
        },
        proposed: {
          brokerStatus: terminalState,
          terminal: terminalState !== "filled",
          releaseReason: terminalState === "filled" ? null : nowReason,
          brokerEvidenceVerdict: evidenceRow.evidenceVerdict
        }
      }
      : null
  };
};

const buildDecision = ({ evidenceRow, fillRow, ledgerRow, idempotencyRow, guardRecoveryRow }) => {
  const verdict = String(evidenceRow?.evidenceVerdict || "");
  const proposedState = String(evidenceRow?.proposedTerminalState || "").trim().toLowerCase();
  const positionQty = toNum(evidenceRow?.brokerPosition?.qty) ?? 0;
  if (verdict === "BROKER_FILLED_CONFIRMED" && proposedState === "filled") {
    return {
      proposalDecision: "PROPOSE_LEDGER_IDEMPOTENCY_MARK_FILLED",
      proposalReady: true,
      proposedTerminalState: "filled",
      blockers: [],
      nextAction: "manual_review_then_report_only_state_migration_task",
      patch: terminalUpdatePatch({ evidenceRow, ledgerRow, idempotencyRow, terminalState: "filled" })
    };
  }
  if (verdict === "BROKER_TERMINAL_UNFILLED_CONFIRMED" && proposedState && positionQty <= 0) {
    return {
      proposalDecision: "PROPOSE_LEDGER_IDEMPOTENCY_MARK_TERMINAL_UNFILLED",
      proposalReady: true,
      proposedTerminalState: proposedState,
      blockers: [],
      nextAction: "manual_review_then_report_only_state_migration_task",
      patch: terminalUpdatePatch({ evidenceRow, ledgerRow, idempotencyRow, terminalState: proposedState })
    };
  }
  if (verdict === "POSITION_PRESENT_WITH_BROKER_ORDER_STILL_WORKING" || verdict === "BROKER_ORDER_STILL_WORKING") {
    return {
      proposalDecision: "BLOCK_TERMINALIZATION_BROKER_ORDER_STILL_WORKING",
      proposalReady: false,
      proposedTerminalState: null,
      blockers: ["broker_order_still_working"],
      nextAction: "continue_get_only_monitor_until_filled_or_terminal",
      patch: null
    };
  }
  if (verdict === "BROKER_TERMINAL_BUT_POSITION_REVIEW_REQUIRED") {
    return {
      proposalDecision: "BLOCK_TERMINALIZATION_POSITION_PRESENT_WITH_TERMINAL_ORDER",
      proposalReady: false,
      proposedTerminalState: proposedState || null,
      blockers: ["position_present_with_terminal_order_requires_ownership_review"],
      nextAction: "classify_position_origin_before_ledger_write",
      patch: null
    };
  }
  if (verdict.includes("INCONCLUSIVE")) {
    return {
      proposalDecision: "BLOCK_TERMINALIZATION_BROKER_EVIDENCE_INCONCLUSIVE",
      proposalReady: false,
      proposedTerminalState: null,
      blockers: ["broker_evidence_inconclusive"],
      nextAction: "extend_read_only_lookback_or_manual_broker_activity_review",
      patch: null
    };
  }
  if (!evidenceRow) {
    return {
      proposalDecision: "BLOCK_TERMINALIZATION_NO_BROKER_EVIDENCE",
      proposalReady: false,
      proposedTerminalState: null,
      blockers: ["broker_evidence_missing"],
      nextAction: "run_broker_fill_state_evidence_first",
      patch: null
    };
  }
  return {
    proposalDecision: "BLOCK_TERMINALIZATION_UNCLASSIFIED",
    proposalReady: false,
    proposedTerminalState: null,
    blockers: ["unclassified_terminalization_case"],
    nextAction: "inspect_fill_state_and_guard_recovery_reports",
    patch: null
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ledger Terminalization Proposal");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} proposalReady=${report.summary.proposalReady} filledReady=${report.summary.markFilledReady} terminalUnfilledReady=${report.summary.markTerminalUnfilledReady} blocked=${report.summary.blocked}\``
  );
  lines.push("- safety: `proposal-only; no broker mutation; no ledger/idempotency write`");
  lines.push("| Symbol | Decision | Proposed State | Broker Verdict | Fill Decision | Guard Recovery | Ledger | Idempotency | Next Action | Blockers |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.proposalDecision} | ${row.proposedTerminalState || "N/A"} | ${row.brokerEvidenceVerdict || "N/A"} | ${row.fillStateDecision || "N/A"} | ${row.guardRecoveryDecision || "N/A"} | ${row.ledgerStatus || "N/A"} | ${row.idempotencyBrokerStatus || "N/A"} | ${row.nextAction} | ${short(row.blockers.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const brokerEvidence = readJson(FILES.brokerEvidence);
  const fillStateAudit = readJson(FILES.fillStateAudit);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.idempotency);
  const guardSourceRecovery = readJson(FILES.guardSourceRecovery);

  const evidenceBySymbol = indexRows(brokerEvidence?.rows);
  const fillRows = (Array.isArray(fillStateAudit?.rows) ? fillStateAudit.rows : [])
    .filter((row) => row.requiresLedgerTerminalizationReview === true || row.reconciliationDecision === "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE");
  const ledgerBySymbol = latestObjectBySymbol(orderLedger);
  const idempotencyBySymbol = latestObjectBySymbol(idempotency);
  const guardRecoveryBySymbol = indexRows(guardSourceRecovery?.rows);

  const rows = fillRows.map((fillRow) => {
    const symbol = asSymbol(fillRow?.symbol);
    const evidenceRow = evidenceBySymbol.get(symbol) || null;
    const ledgerRow = ledgerBySymbol.get(symbol) || null;
    const idempotencyRow = idempotencyBySymbol.get(symbol) || null;
    const guardRecoveryRow = guardRecoveryBySymbol.get(symbol) || null;
    const decision = buildDecision({ evidenceRow, fillRow, ledgerRow, idempotencyRow, guardRecoveryRow });
    return {
      symbol,
      fillStateDecision: fillRow?.reconciliationDecision || null,
      guardRecoveryDecision: guardRecoveryRow?.recoveryDecision || null,
      brokerEvidenceVerdict: evidenceRow?.evidenceVerdict || null,
      brokerEvidenceConfidence: evidenceRow?.confidence || null,
      brokerPositionQty: toNum(evidenceRow?.brokerPosition?.qty),
      ledgerKey: ledgerRow?.key || null,
      ledgerStatus: ledgerRow?.status || null,
      idempotencyKey: idempotencyRow?.key || null,
      idempotencyBrokerStatus: idempotencyRow?.brokerStatus || idempotencyRow?.status || null,
      proposalDecision: decision.proposalDecision,
      proposalReady: decision.proposalReady,
      proposedTerminalState: decision.proposedTerminalState,
      blockers: decision.blockers,
      nextAction: decision.nextAction,
      proposedPatchPreview: decision.patch,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    };
  });

  const summary = {
    rows: rows.length,
    proposalReady: count(rows, (row) => row.proposalReady),
    markFilledReady: count(rows, (row) => row.proposalDecision === "PROPOSE_LEDGER_IDEMPOTENCY_MARK_FILLED"),
    markTerminalUnfilledReady: count(rows, (row) => row.proposalDecision === "PROPOSE_LEDGER_IDEMPOTENCY_MARK_TERMINAL_UNFILLED"),
    blocked: count(rows, (row) => !row.proposalReady),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false
  };
  const overall = rows.length === 0
    ? "no_candidates"
    : summary.proposalReady > 0
      ? "manual_state_migration_review_ready"
      : "blocked_no_terminalization_proposal";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_ledger_terminalization_proposal_report_only_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      brokerEvidenceOverall: brokerEvidence?.overall || null,
      fillStateAuditOverall: fillStateAudit?.overall || null,
      guardSourceRecoveryOverall: guardSourceRecovery?.overall || null
    },
    executionPolicy: {
      mode: "proposal_only_report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      requiresSeparateApprovalForStateWrite: true
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[LEDGER_TERMINALIZATION_PROPOSAL] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} rows=${summary.rows} ready=${summary.proposalReady} blocked=${summary.blocked} attempted=false submitted=false`
  );
};

main();
