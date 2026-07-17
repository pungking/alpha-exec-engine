import fs from "node:fs";
import { classifyProtectionOwnership } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.FILL_STATE_RECONCILIATION_STATE_DIR || "state").trim() || "state";
const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  orderState: `${STATE_DIR}/order-state-consistency-report.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`
};
const OUTPUT_JSON = `${STATE_DIR}/fill-state-reconciliation-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/fill-state-reconciliation-audit.md`;

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
const short = (value, max = 220) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
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

const latestBySymbol = (rows, dateSelector = (row) => row?.updatedAt || row?.createdAt || row?.brokerCheckedAt || row?.lastSeenAt) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (!symbol) continue;
    const prev = out.get(symbol);
    const at = Date.parse(String(dateSelector(row) || ""));
    const prevAt = Date.parse(String(dateSelector(prev) || ""));
    if (!prev || (Number.isFinite(at) && (!Number.isFinite(prevAt) || at >= prevAt))) out.set(symbol, row);
  }
  return out;
};

const objectRows = (object) => Object.entries(object?.orders || {}).map(([key, value]) => ({ ...value, key }));
const arrayRowsBySymbol = (rows) => latestBySymbol(rows);

const selectStateRow = (object, position, kind) => {
  const symbol = asSymbol(position?.symbol);
  const expectedKey = String(position?.plannedLedgerKey || "").trim();
  const candidates = objectRows(object).filter((row) => asSymbol(row?.symbol) === symbol);
  if (expectedKey) {
    const row = candidates.find((candidate) => candidate.key === expectedKey) || null;
    return {
      row,
      status: row ? "EXACT_POSITION_KEY" : "EXPECTED_POSITION_KEY_MISSING",
      blocker: row ? null : `expected_position_${kind}_key_missing`,
      candidateCount: candidates.length
    };
  }
  return {
    row: null,
    status: "EXPECTED_POSITION_KEY_MISSING",
    blocker: `expected_position_${kind}_key_missing`,
    candidateCount: candidates.length
  };
};

const buildDecision = ({ position, ownership, ledgerRow, idempotencyRow, orderStateRow, fillabilityRow, stateSelection }) => {
  const qty = toNum(position?.qty) ?? 0;
  const ledgerStatus = String(ledgerRow?.status || "").toLowerCase();
  const idempotencyStatus = String(idempotencyRow?.brokerStatus || idempotencyRow?.status || "").toLowerCase();
  const performanceFill = String(position?.normalizedFillState || "").toLowerCase();
  const orderStateCategory = String(orderStateRow?.category || "");
  const orderStateNormalized = String(orderStateRow?.normalized || "").toLowerCase();
  const workingEvidence = [ledgerStatus, idempotencyStatus, performanceFill, orderStateNormalized].some((value) =>
    ["open", "submitted", "accepted", "new", "pending_new", "held", "partially_filled"].includes(value)
  );
  const filledEvidence = [ledgerStatus, idempotencyStatus, performanceFill, orderStateNormalized].some((value) =>
    ["filled", "partially_filled"].includes(value)
  );
  const terminalNotFilledEvidence = [ledgerStatus, idempotencyStatus, orderStateNormalized].some((value) =>
    ["canceled", "cancelled", "expired", "rejected", "failed", "unfilled_terminal"].includes(value)
  );

  if (qty <= 0) {
    return {
      reconciliationDecision: "NO_OPEN_POSITION",
      requiresLedgerTerminalizationReview: false,
      blockers: ["no_open_position"],
      nextAction: "ignore_no_position"
    };
  }
  if (ownership.ownershipClass === "EXTERNAL_OR_MANUAL_POSITION") {
    return {
      reconciliationDecision: "EXTERNAL_POSITION_OWNERSHIP_REVIEW",
      requiresLedgerTerminalizationReview: false,
      blockers: ["position_not_sidecar_managed"],
      nextAction: "classify_ownership_before_sidecar_guard_repair"
    };
  }
  if (stateSelection.blockers.length > 0) {
    return {
      reconciliationDecision: "FILL_STATE_UNKNOWN_REVIEW",
      requiresLedgerTerminalizationReview: true,
      blockers: stateSelection.blockers,
      nextAction: "resolve_exact_position_ledger_and_idempotency_lineage"
    };
  }
  if (ownership.ownershipClass === "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED") {
    return {
      reconciliationDecision: "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE",
      requiresLedgerTerminalizationReview: true,
      blockers: ["position_present_but_ledger_or_idempotency_open"],
      nextAction: "report_only_broker_fill_activity_recheck_or_ledger_terminalization_review"
    };
  }
  if (terminalNotFilledEvidence && qty > 0) {
    return {
      reconciliationDecision: "POSITION_PRESENT_WITH_TERMINAL_NOT_FILLED_STATE",
      requiresLedgerTerminalizationReview: true,
      blockers: ["position_present_but_terminal_not_filled_state"],
      nextAction: "verify_broker_position_origin_before_any_repair"
    };
  }
  if (filledEvidence && ownership.ownershipClass === "SIDECAR_MANAGED_FILLED") {
    return {
      reconciliationDecision: "FILL_STATE_CONFIRMED",
      requiresLedgerTerminalizationReview: false,
      blockers: [],
      nextAction: "eligible_for_separate_guard_source_or_child_order_track"
    };
  }
  if (workingEvidence || orderStateCategory === "STATE_DIVERGENCE") {
    return {
      reconciliationDecision: "FILL_STATE_DIVERGENCE_REVIEW",
      requiresLedgerTerminalizationReview: true,
      blockers: ["fill_state_divergence"],
      nextAction: "compare_order_ledger_idempotency_fillability_and_broker_activity"
    };
  }
  return {
    reconciliationDecision: "FILL_STATE_UNKNOWN_REVIEW",
    requiresLedgerTerminalizationReview: true,
    blockers: ["fill_state_unknown"],
    nextAction: "collect_broker_fill_or_terminal_evidence"
  };
};

const buildRow = ({ position, reconciliationRow, ledgerRow, idempotencyRow, orderStateRow, fillabilityRow, stateSelection }) => {
  const ownership = classifyProtectionOwnership({
    position,
    reconciliationRow,
    ledgerRow,
    idempotencyRow,
    orderStateRow,
    fillabilityRow
  });
  const decision = buildDecision({ position, ownership, ledgerRow, idempotencyRow, orderStateRow, fillabilityRow, stateSelection });
  return {
    symbol: asSymbol(position?.symbol),
    qty: toNum(position?.qty),
    currentPrice: toNum(position?.currentPrice),
    ownershipClassification: ownership.ownershipClass,
    sidecarManaged: ownership.sidecarManaged,
    normalizedFillState: position?.normalizedFillState || null,
    positionStatus: position?.positionStatus || null,
    stateSelection,
    ledger: ledgerRow
      ? {
        key: ledgerRow.key || null,
        status: ledgerRow.status || null,
        updatedAt: ledgerRow.updatedAt || null,
        createdAt: ledgerRow.createdAt || null,
        clientOrderId: ledgerRow.clientOrderId || null
      }
      : null,
    idempotency: idempotencyRow
      ? {
        key: idempotencyRow.key || null,
        brokerStatus: idempotencyRow.brokerStatus || null,
        status: idempotencyRow.status || null,
        brokerCheckedAt: idempotencyRow.brokerCheckedAt || null,
        lastSeenAt: idempotencyRow.lastSeenAt || null,
        clientOrderId: idempotencyRow.clientOrderId || null
      }
      : null,
    orderState: orderStateRow
      ? {
        status: orderStateRow.status || null,
        category: orderStateRow.category || null,
        normalized: orderStateRow.normalized || null,
        terminalReconciliationRequired: orderStateRow.terminalReconciliationRequired === true
      }
      : null,
    fillability: fillabilityRow
      ? {
        status: fillabilityRow.status || null,
        reason: fillabilityRow.reason || null,
        brokerClosedStatus: fillabilityRow.brokerClosedStatus || null
      }
      : null,
    brokerChildren: {
      stopPresent: position?.brokerStopPresent === true || reconciliationRow?.brokerStopPresent === true,
      targetPresent: position?.brokerTargetPresent === true || reconciliationRow?.brokerTargetPresent === true
    },
    fillStateClassification: ownership.fillStateReconciliation,
    reconciliationDecision: decision.reconciliationDecision,
    requiresLedgerTerminalizationReview: decision.requiresLedgerTerminalizationReview,
    blockers: decision.blockers,
    nextAction: decision.nextAction,
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Fill-State Reconciliation Audit");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`positions=${report.summary.positions} confirmedFilled=${report.summary.confirmedFilled} positionPresentOpenLedger=${report.summary.positionPresentOpenLedger} terminalNotFilledPosition=${report.summary.positionPresentTerminalNotFilled} divergence=${report.summary.fillStateDivergence} external=${report.summary.externalOwnershipReview}\``
  );
  lines.push("- safety: `report-only; no broker mutation; no ledger mutation`");
  lines.push("| Symbol | Decision | Ownership | Qty | Perf Fill | Ledger | Idempotency | Order State | Fillability | Broker Children | Next Action | Blockers |");
  lines.push("| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.reconciliationDecision} | ${row.ownershipClassification || "N/A"} | ${fmt(row.qty, 4)} | ${row.normalizedFillState || "N/A"} | ${row.ledger?.status || "N/A"} | ${row.idempotency?.brokerStatus || row.idempotency?.status || "N/A"} | ${row.orderState?.normalized || row.orderState?.category || "N/A"} | ${row.fillability?.status || "N/A"} | stop=${row.brokerChildren.stopPresent ? "present" : "missing"},target=${row.brokerChildren.targetPresent ? "present" : "missing"} | ${row.nextAction} | ${short(row.blockers.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const performance = readJson(FILES.performance);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.idempotency);
  const fillability = readJson(FILES.fillability);
  const orderState = readJson(FILES.orderState);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);

  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const orderStateBySymbol = arrayRowsBySymbol(orderState?.rows);
  const fillabilityBySymbol = arrayRowsBySymbol(fillability?.rows);
  const reconciliationBySymbol = arrayRowsBySymbol(brokerChildReconciliation?.rows);

  const rows = positions
    .filter((position) => (toNum(position?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      const ledgerSelection = selectStateRow(orderLedger, position, "ledger");
      const idempotencySelection = selectStateRow(idempotency, position, "idempotency");
      const stateSelection = {
        expectedKey: String(position?.plannedLedgerKey || "").trim() || null,
        ledgerStatus: ledgerSelection.status,
        ledgerCandidateCount: ledgerSelection.candidateCount,
        idempotencyStatus: idempotencySelection.status,
        idempotencyCandidateCount: idempotencySelection.candidateCount,
        blockers: [ledgerSelection.blocker, idempotencySelection.blocker].filter(Boolean)
      };
      return buildRow({
        position,
        reconciliationRow: reconciliationBySymbol.get(symbol) || null,
        ledgerRow: ledgerSelection.row,
        idempotencyRow: idempotencySelection.row,
        orderStateRow: orderStateBySymbol.get(symbol) || null,
        fillabilityRow: fillabilityBySymbol.get(symbol) || null,
        stateSelection
      });
    });

  const summary = {
    positions: rows.length,
    confirmedFilled: count(rows, (row) => row.reconciliationDecision === "FILL_STATE_CONFIRMED"),
    positionPresentOpenLedger: count(rows, (row) => row.reconciliationDecision === "POSITION_PRESENT_WITH_OPEN_LEDGER_STATE"),
    positionPresentTerminalNotFilled: count(rows, (row) => row.reconciliationDecision === "POSITION_PRESENT_WITH_TERMINAL_NOT_FILLED_STATE"),
    fillStateDivergence: count(rows, (row) => row.reconciliationDecision === "FILL_STATE_DIVERGENCE_REVIEW"),
    fillStateUnknown: count(rows, (row) => row.reconciliationDecision === "FILL_STATE_UNKNOWN_REVIEW"),
    externalOwnershipReview: count(rows, (row) => row.reconciliationDecision === "EXTERNAL_POSITION_OWNERSHIP_REVIEW"),
    ledgerTerminalizationReviewRequired: count(rows, (row) => row.requiresLedgerTerminalizationReview),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false
  };
  const overall = !performance?.live?.available
    ? "warn"
    : summary.positionPresentOpenLedger > 0 || summary.positionPresentTerminalNotFilled > 0 || summary.fillStateDivergence > 0 || summary.fillStateUnknown > 0
      ? "reconciliation_required"
      : summary.externalOwnershipReview > 0
        ? "ownership_review_required"
        : "pass";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_fill_state_reconciliation_audit_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      requiresSeparateApprovalForLedgerTerminalization: true
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[FILL_STATE_RECONCILIATION] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} positions=${summary.positions} openLedger=${summary.positionPresentOpenLedger} terminalReview=${summary.ledgerTerminalizationReviewRequired} attempted=false submitted=false`
  );
};

main();
