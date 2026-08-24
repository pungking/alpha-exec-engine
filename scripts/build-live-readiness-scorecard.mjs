#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { PROTECTION_LANES } from "./lib/position-protection-classification.mjs";

const STATE_DIR = process.env.LIVE_READINESS_STATE_DIR || process.env.STATE_DIR || "state";
const OUTPUT_JSON = path.join(STATE_DIR, "live-readiness-scorecard.json");
const OUTPUT_MD = path.join(STATE_DIR, "live-readiness-scorecard.md");

const FINAL_VERDICTS = new Set(["BLOCKED", "PAPER_PILOT", "MICRO_LIVE_REVIEW_READY"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(fileName, fallback = null) {
  const filePath = path.join(STATE_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __readError: String(error?.message || error), __fileName: fileName };
  }
}

function writeJsonAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function asNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBool(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return Boolean(value);
}

function statusFrom({ blockers = [], warnings = [], passLabel = "pass", waitLabel = "waiting" }) {
  if (blockers.length > 0) return "block";
  if (warnings.length > 0) return waitLabel;
  return passLabel;
}

function scoreFrom(status, override = null) {
  if (override !== null) return override;
  if (status === "pass") return 100;
  if (status === "waiting") return 60;
  if (status === "partial") return 50;
  if (status === "block") return 0;
  return 40;
}

function ordersArray(container) {
  if (!container || typeof container !== "object") return [];
  if (Array.isArray(container.orders)) return container.orders;
  if (container.orders && typeof container.orders === "object") return Object.values(container.orders);
  return [];
}

function rowsArray(report) {
  if (!report || typeof report !== "object") return [];
  if (Array.isArray(report.rows)) return report.rows;
  if (Array.isArray(report.records)) return report.records;
  return [];
}

function hasReadError(...reports) {
  return reports.filter((report) => report?.__readError).map((report) => `${report.__fileName}:${report.__readError}`);
}

function stage6Identity({ preview, fillability, lastRun, reprice }) {
  const stage6Hash = preview?.stage6Hash || fillability?.summary?.stage6Hash || reprice?.summary?.stage6Hash || lastRun?.lastStage6Sha256 || null;
  const stage6File = preview?.stage6File || fillability?.summary?.stage6File || reprice?.summary?.stage6File || lastRun?.lastStage6FileName || null;
  const previewStale = preview?.source?.previewStale ?? preview?.stage6Contract?.previewStale ?? null;
  return {
    stage6Hash,
    stage6HashShort: stage6Hash ? String(stage6Hash).slice(0, 12) : null,
    stage6File,
    previewStale,
  };
}

function collectMutationSignals(reports) {
  const signals = [];
  const add = (name, attempted, submitted) => {
    signals.push({ name, attempted: asBool(attempted), submitted: asBool(submitted) });
  };
  add("preview.brokerSubmission", reports.preview?.brokerSubmission?.attempted, reports.preview?.brokerSubmission?.submitted);
  add("fillability", reports.fillability?.summary?.brokerAttempted, reports.fillability?.summary?.brokerSubmitted);
  add("openOrderReprice", reports.openOrderReprice?.summary?.brokerMutationAttempted, reports.openOrderReprice?.summary?.brokerMutationSubmitted);
  add("opsLaneStatus", reports.opsLaneStatus?.summary?.brokerMutationAttempted, reports.opsLaneStatus?.summary?.brokerMutationSubmitted);
  add("guardSourceRecovery", reports.guardSourceRecovery?.summary?.brokerMutationAttempted, reports.guardSourceRecovery?.summary?.brokerMutationSubmitted);
  add("guardMetadataLineage", reports.guardMetadataLineage?.summary?.brokerMutationAttempted, reports.guardMetadataLineage?.summary?.brokerMutationSubmitted);
  add("persistentOcoRepair", reports.persistentOcoRepair?.summary?.brokerMutationAttempted, reports.persistentOcoRepair?.summary?.brokerMutationSubmitted);
  add("performance.realizedPnl", reports.performance?.realizedPnl?.brokerMutationAttempted, reports.performance?.realizedPnl?.brokerMutationSubmitted);
  add("positionOwnershipStateMigrationReview", reports.positionOwnershipStateMigrationReview?.summary?.brokerMutationAttempted, reports.positionOwnershipStateMigrationReview?.summary?.brokerMutationSubmitted);
  add("multiOcoSubmitGate", reports.multiOcoSubmitGate?.summary?.brokerMutationAttempted, reports.multiOcoSubmitGate?.summary?.brokerMutationSubmitted);
  return signals;
}

function collectStateMutationSignals(reports) {
  const signals = [];
  const add = (name, attempted, applied) => {
    signals.push({ name, attempted: asBool(attempted), applied: asBool(applied) });
  };
  add("fillStateReconciliation", reports.fillStateReconciliation?.summary?.stateMutationAttempted, reports.fillStateReconciliation?.summary?.stateMutationApplied);
  add("guardSourceRecovery", reports.guardSourceRecovery?.summary?.stateMutationAttempted, reports.guardSourceRecovery?.summary?.stateMutationApplied);
  add("guardMetadataLineage", reports.guardMetadataLineage?.summary?.stateMutationAttempted, reports.guardMetadataLineage?.summary?.stateMutationApplied);
  add("persistentOcoRepair", reports.persistentOcoRepair?.summary?.stateMutationAttempted, reports.persistentOcoRepair?.summary?.stateMutationSubmitted);
  add("performance.realizedPnl", reports.performance?.realizedPnl?.stateMutationAttempted, reports.performance?.realizedPnl?.stateMutationSubmitted);
  add("positionOwnershipRecoveryDecision", reports.positionOwnershipRecoveryDecision?.summary?.stateMutationAttempted, reports.positionOwnershipRecoveryDecision?.summary?.stateMutationApplied);
  add("positionOwnershipStateMigrationReview", reports.positionOwnershipStateMigrationReview?.summary?.stateMutationAttempted, reports.positionOwnershipStateMigrationReview?.summary?.stateMutationApplied);
  return signals;
}

function uniqueSymbols(rows) {
  return [...new Set(rows.map((row) => String(row?.symbol || "").toUpperCase()).filter(Boolean))].sort();
}

function uniqueRowsBySymbol(rows) {
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    const symbol = String(row?.symbol || "").toUpperCase();
    const key = symbol || `row-${index}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function blockerGroup(name, reports, { status = "pass", count = 0, rows = [], nextAction, safetyGate }) {
  return {
    name,
    status,
    count,
    affectedSymbols: uniqueSymbols(rows).slice(0, 20),
    nextAction,
    safetyGate,
    opsHealthDetail: reports.opsHealth?.blockerGroups?.[name]?.detail || null,
  };
}

const OPEN_STATES = new Set(["open", "submitted", "accepted", "new", "pending_new", "partially_filled", "held"]);
const TERMINAL_STATES = new Set(["canceled", "cancelled", "expired", "rejected", "unfilled_terminal", "terminal_unfilled"]);
const EXIT_ACTIONS = new Set(["SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"]);
const RECONCILIATION_CATEGORIES = new Set([
  "TERMINAL_CONFLICT",
  "TERMINAL_RECONCILIATION_REQUIRED",
  "TERMINAL_SOURCE_MISSING",
  "STATE_DIVERGENCE",
]);
const LIFECYCLE_FILLABILITY_STATES = new Set(["FILLED", "OPEN_WAITING", "TERMINAL_UNFILLED", "IDEMPOTENCY_HELD"]);

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function evidenceTimestamp(row) {
  for (const value of [row?.updatedAt, row?.brokerCheckedAt, row?.lastSeenAt, row?.createdAt, row?.submittedAt, row?.generatedAt, row?.exitAt, row?.runDate]) {
    const parsed = Date.parse(value || "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function latestEvidenceBySymbol(rows) {
  const result = new Map();
  for (const row of rows) {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    const current = result.get(symbol);
    if (!current || evidenceTimestamp(row) > evidenceTimestamp(current)) result.set(symbol, row);
  }
  return result;
}

function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isExitEvidence(row) {
  const actionType = String(row?.actionType || "").trim().toUpperCase();
  return actionType ? EXIT_ACTIONS.has(actionType) : normalizedStatus(row?.executionSide) === "sell";
}

function statusClass(value) {
  const status = normalizedStatus(value);
  if (status === "filled") return "filled";
  if (OPEN_STATES.has(status)) return "open";
  if (TERMINAL_STATES.has(status)) return "terminal_unfilled";
  return status || null;
}

function hasIdempotencyConflict(ledgerRow, idempotencyRow) {
  if (!ledgerRow || !idempotencyRow) return false;
  const ledgerOrderId = String(ledgerRow?.brokerOrderId || "").trim();
  const idempotencyOrderId = String(idempotencyRow?.brokerOrderId || "").trim();
  if (ledgerOrderId && idempotencyOrderId && ledgerOrderId !== idempotencyOrderId) return true;
  const ledgerClass = statusClass(ledgerRow?.status);
  const idempotencyClass = statusClass(idempotencyRow?.brokerStatus || idempotencyRow?.status);
  return Boolean(ledgerClass && idempotencyClass && ledgerClass !== idempotencyClass);
}

function buildRealizedPnlEvidence(row, proxyRow = null) {
  if (!row) {
    return {
      status: proxyRow ? "SIMULATION_OR_PROXY_ONLY" : "NO_EXIT_PNL_EVIDENCE",
      source: "performance-dashboard.json",
      sourceType: proxyRow ? "SIMULATION_OR_PROXY" : null,
      entryPricePresent: false,
      exitPricePresent: false,
      quantityPresent: false,
      explicitFeePresent: false,
      grossFormulaMatches: null,
      netFormulaMatches: null,
      costDoubleCountViolation: false,
    };
  }
  const sourceType = String(row?.sourceType || "").trim().toUpperCase();
  const brokerFillSource = ["ALPACA_PAPER_BROKER_FILLS", "ALPACA_BROKER_FILLS"].includes(sourceType);
  if (!brokerFillSource) return buildRealizedPnlEvidence(null, row);
  const entryPrice = finiteNumber(row?.weightedEntryFillPrice);
  const exitPrice = finiteNumber(row?.weightedExitFillPrice);
  const quantity = finiteNumber(row?.matchedQuantity);
  const direction = ["long", "short"].includes(normalizedStatus(row?.direction)) ? normalizedStatus(row?.direction) : null;
  const explicitFees = finiteNumber(row?.explicitBrokerFees);
  const reportedGross = finiteNumber(row?.actualFillGrossPnl);
  const reportedNet = finiteNumber(row?.brokerNetRealizedPnl);
  const feeEvidenceStatus = String(row?.feeEvidenceStatus || "").trim().toUpperCase();
  const feeEvidenceValid = feeEvidenceStatus === "EXPLICIT_BROKER_FEE"
    || (sourceType === "ALPACA_PAPER_BROKER_FILLS" && feeEvidenceStatus === "PAPER_PLATFORM_COSTS_NOT_MODELED");
  const complete = [entryPrice, exitPrice, quantity, explicitFees, reportedGross, reportedNet].every((value) => value != null)
    && quantity > 0
    && Boolean(direction)
    && row?.entryOrderIdsPresent === true
    && row?.exitOrderIdsPresent === true
    && row?.terminalExit === true
    && row?.idempotencyVerdict === "PASS"
    && row?.actualPriceBasis === "BROKER_FILLED_AVG_PRICE"
    && feeEvidenceValid
    && row?.costDoubleCountViolation !== true;
  const calculatedGross = complete && direction
    ? (direction === "short" ? entryPrice - exitPrice : exitPrice - entryPrice) * quantity
    : null;
  const calculatedNet = calculatedGross != null ? calculatedGross - explicitFees : null;
  const grossFormulaMatches = calculatedGross != null ? Math.abs(calculatedGross - reportedGross) <= 0.01 : null;
  const netFormulaMatches = calculatedNet != null ? Math.abs(calculatedNet - reportedNet) <= 0.01 : null;
  const producerStatus = String(row?.status || "").trim().toUpperCase();
  const status = producerStatus === "PARTIAL_EXIT_PNL_ONLY"
    ? "PARTIAL_EXIT_PNL_ONLY"
    : producerStatus !== "VERIFIED_NET_REALIZED_PNL"
      ? producerStatus || "EXIT_FILL_EVIDENCE_INCOMPLETE"
      : complete && grossFormulaMatches && netFormulaMatches
        ? "VERIFIED_NET_REALIZED_PNL"
        : complete
          ? "REALIZED_PNL_COST_MISMATCH"
          : "EXIT_FILL_EVIDENCE_INCOMPLETE";
  return {
    status,
    source: "performance-dashboard.json",
    sourceType,
    direction,
    entryPricePresent: entryPrice != null,
    exitPricePresent: exitPrice != null,
    quantityPresent: quantity != null,
    explicitFeePresent: explicitFees != null,
    actualPriceBasis: row?.actualPriceBasis || null,
    feeEvidenceStatus: row?.feeEvidenceStatus || null,
    spreadAndSlippageAreAttributionOnly: true,
    grossFormulaMatches,
    netFormulaMatches,
    costDoubleCountViolation: row?.costDoubleCountViolation === true,
  };
}

function buildEntryOrderLifecycle({
  fillability,
  openOrderReprice,
  orderLedger,
  orderIdempotency,
  orderState,
  positionProtectionAudit,
  brokerChildReconciliation,
  performance,
}) {
  const stateBySymbol = latestEvidenceBySymbol(rowsArray(orderState).filter((row) =>
    row?.normalized
    || row?.terminalState
    || row?.ledger
    || row?.idempotency
    || row?.performance
    || LIFECYCLE_FILLABILITY_STATES.has(String(row?.fillability || "").toUpperCase())
    || row?.terminalReconciliationRequired === true
    || row?.terminalConflicts === true
    || String(row?.status || "").toUpperCase() === "FAIL"
  ));
  const fillBySymbol = latestEvidenceBySymbol(
    rowsArray(fillability).filter((row) => LIFECYCLE_FILLABILITY_STATES.has(String(row?.status || "").toUpperCase()))
  );
  const repriceBySymbol = latestEvidenceBySymbol(rowsArray(openOrderReprice));
  const ledgerRows = ordersArray(orderLedger);
  const idempotencyRows = ordersArray(orderIdempotency);
  const ledgerBySymbol = latestEvidenceBySymbol(ledgerRows.filter((row) => !isExitEvidence(row)));
  const exitLedgerBySymbol = latestEvidenceBySymbol(ledgerRows.filter(isExitEvidence));
  const idempotencyBySymbol = latestEvidenceBySymbol(idempotencyRows.filter((row) => !isExitEvidence(row)));
  const exitIdempotencyBySymbol = latestEvidenceBySymbol(idempotencyRows.filter(isExitEvidence));
  const protectionBySymbol = latestEvidenceBySymbol(rowsArray(positionProtectionAudit));
  const brokerChildrenBySymbol = latestEvidenceBySymbol(rowsArray(brokerChildReconciliation));
  const performanceBySymbol = latestEvidenceBySymbol(
    Array.isArray(performance?.realizedPnl?.rows) ? performance.realizedPnl.rows : []
  );
  const proxyPerformanceBySymbol = latestEvidenceBySymbol(
    Array.isArray(performance?.simulation?.rows) ? performance.simulation.rows : []
  );
  const symbols = [...new Set([
    ...stateBySymbol.keys(),
    ...fillBySymbol.keys(),
    ...repriceBySymbol.keys(),
    ...ledgerBySymbol.keys(),
    ...exitLedgerBySymbol.keys(),
    ...idempotencyBySymbol.keys(),
    ...exitIdempotencyBySymbol.keys(),
  ])].sort();

  const rows = symbols.map((symbol) => {
    const stateRow = stateBySymbol.get(symbol) || null;
    const fillRow = fillBySymbol.get(symbol) || null;
    const repriceRow = repriceBySymbol.get(symbol) || null;
    const ledgerRow = ledgerBySymbol.get(symbol) || null;
    const exitLedgerRow = exitLedgerBySymbol.get(symbol) || null;
    const idempotencyRow = idempotencyBySymbol.get(symbol) || null;
    const exitIdempotencyRow = exitIdempotencyBySymbol.get(symbol) || null;
    const protectionRow = protectionBySymbol.get(symbol) || null;
    const brokerChildrenRow = brokerChildrenBySymbol.get(symbol) || null;
    const performanceRow = performanceBySymbol.get(symbol) || null;
    const proxyPerformanceRow = proxyPerformanceBySymbol.get(symbol) || null;
    const orderStateStatus = String(stateRow?.status || "").toUpperCase() || null;
    const orderStateCategory = String(stateRow?.category || "").toUpperCase() || null;
    const normalizedState = normalizedStatus(stateRow?.normalized);
    const ledgerStatus = normalizedStatus(ledgerRow?.status || stateRow?.ledger);
    const idempotencyBrokerStatus = normalizedStatus(idempotencyRow?.brokerStatus || idempotencyRow?.status || stateRow?.idempotency);
    const exitLedgerStatus = normalizedStatus(exitLedgerRow?.status);
    const exitIdempotencyBrokerStatus = normalizedStatus(exitIdempotencyRow?.brokerStatus || exitIdempotencyRow?.status);
    const fillabilityStatus = String(fillRow?.status || stateRow?.fillability || "").toUpperCase() || null;
    const brokerOpenStatus = normalizedStatus(fillRow?.brokerOpenStatus || repriceRow?.brokerOpenStatus);
    const brokerClosedStatus = normalizedStatus(fillRow?.brokerClosedStatus);
    const filledQuantityEvidence = Math.max(
      asNumber(fillRow?.fillQty, 0),
      asNumber(fillRow?.brokerOpenFilledQty, 0),
      asNumber(fillRow?.brokerClosedFilledQty, 0),
      asNumber(ledgerRow?.filledQty, 0),
      asNumber(idempotencyRow?.filledQty, 0)
    );
    const orderQuantityEvidence = Math.max(
      asNumber(fillRow?.brokerOpenQty, 0),
      asNumber(repriceRow?.qty, 0),
      asNumber(ledgerRow?.qty, 0),
      asNumber(idempotencyRow?.qty, 0)
    );
    const entrySubmittedEvidence = Boolean(
      ledgerRow?.brokerOrderId
      || idempotencyRow?.brokerOrderId
      || (fillRow?.brokerOpenClientOrderId && brokerOpenStatus)
      || repriceRow?.orderId
      || repriceRow?.clientOrderId
    );
    const exitSubmittedEvidence = Boolean(exitLedgerRow?.brokerOrderId || exitIdempotencyRow?.brokerOrderId);
    const submittedEvidence = entrySubmittedEvidence || exitSubmittedEvidence;
    const duplicateOpen = repriceRow?.checks?.duplicateOpenCountOk === false
      || asNumber(repriceRow?.duplicateOpenCount, 0) > 1;
    const orderStateConflict = orderStateStatus === "FAIL"
      || stateRow?.terminalConflicts === true
      || RECONCILIATION_CATEGORIES.has(orderStateCategory);
    const entryIdempotencyConflict = hasIdempotencyConflict(ledgerRow, idempotencyRow);
    const exitIdempotencyConflict = hasIdempotencyConflict(exitLedgerRow, exitIdempotencyRow);
    const idempotencyConflict = entryIdempotencyConflict || exitIdempotencyConflict;
    const terminalLedgerMismatch = stateRow?.terminalReconciliationRequired === true || orderStateConflict;
    let terminalReconciliationRequired = terminalLedgerMismatch
      || idempotencyConflict;
    const terminalState = normalizedStatus(stateRow?.terminalState || brokerClosedStatus || (
      TERMINAL_STATES.has(normalizedState) ? normalizedState : ""
    ));
    const terminal = TERMINAL_STATES.has(terminalState)
      || fillabilityStatus === "TERMINAL_UNFILLED"
      || TERMINAL_STATES.has(ledgerStatus)
      || TERMINAL_STATES.has(idempotencyBrokerStatus);
    const openWaiting = OPEN_STATES.has(normalizedState)
      || OPEN_STATES.has(brokerOpenStatus)
      || fillabilityStatus === "OPEN_WAITING";
    const filled = [normalizedState, ledgerStatus, idempotencyBrokerStatus].includes("filled")
      || fillabilityStatus === "FILLED"
      || (orderQuantityEvidence > 0 && filledQuantityEvidence >= orderQuantityEvidence && !openWaiting);
    const exitOpen = OPEN_STATES.has(exitLedgerStatus) || OPEN_STATES.has(exitIdempotencyBrokerStatus);
    const exitFilled = exitLedgerStatus === "filled" || exitIdempotencyBrokerStatus === "filled";
    const exitTerminalUnfilled = TERMINAL_STATES.has(exitLedgerStatus) || TERMINAL_STATES.has(exitIdempotencyBrokerStatus);
    const exitActionType = String(exitLedgerRow?.actionType || exitIdempotencyRow?.actionType || "").trim().toUpperCase() || null;
    const partialExit = exitActionType === "SCALE_DOWN" || exitActionType === "EXIT_PARTIAL";
    const positionFillState = normalizedStatus(protectionRow?.normalizedFillState || brokerChildrenRow?.normalizedFillState);
    const positionObserved = Boolean(protectionRow || brokerChildrenRow)
      && !["expired", "canceled", "cancelled", "rejected"].includes(positionFillState);
    const brokerStopPresent = protectionRow?.brokerStopPresent === true || brokerChildrenRow?.brokerStopPresent === true;
    const brokerTargetPresent = protectionRow?.brokerTargetPresent === true || brokerChildrenRow?.brokerTargetPresent === true;
    const protectionConfirmed = positionObserved && brokerStopPresent && brokerTargetPresent;
    const realizedPnlEvidence = buildRealizedPnlEvidence(performanceRow, proxyPerformanceRow);
    const realizedPnlVerified = realizedPnlEvidence.status === "VERIFIED_NET_REALIZED_PNL";
    if (exitFilled && !partialExit && positionObserved) terminalReconciliationRequired = true;
    if (exitFilled && !partialExit && !positionObserved && !realizedPnlVerified) terminalReconciliationRequired = true;
    const plannedOnly = normalizedState === "planned"
      && !submittedEvidence
      && !filled
      && !terminal
      && !openWaiting
      && !terminalReconciliationRequired;
    if (plannedOnly) return null;

    let classification = "TERMINAL_RECONCILIATION_REQUIRED";
    if (terminalReconciliationRequired || duplicateOpen) classification = "TERMINAL_RECONCILIATION_REQUIRED";
    else if (exitOpen) classification = "EXIT_PENDING";
    else if (exitFilled && partialExit && positionObserved) {
      classification = protectionConfirmed ? "FILLED_PROTECTED" : "FILLED_UNPROTECTED";
    } else if (exitFilled && !positionObserved && realizedPnlVerified) {
      classification = "EXITED_TERMINAL_RECONCILED";
    } else if (filled) classification = protectionConfirmed ? "FILLED_PROTECTED" : "FILLED_UNPROTECTED";
    else if (terminal || exitTerminalUnfilled) classification = "EXPIRED_OR_CANCELED_RECONCILED";
    else if (openWaiting) classification = "OPEN_WAITING";
    else if (entrySubmittedEvidence) classification = "ENTRY_SUBMITTED";

    const blockers = [];
    const warnings = [];
    if (terminalReconciliationRequired) blockers.push("terminal_reconciliation_required");
    if (orderStateConflict) blockers.push("order_state_failure_or_conflict");
    if (duplicateOpen) blockers.push("duplicate_open_order");
    if (idempotencyConflict) blockers.push("idempotency_conflict");
    if (exitFilled && !partialExit && positionObserved) blockers.push("full_exit_filled_but_position_still_present");
    if (exitFilled && !partialExit && !positionObserved && !realizedPnlVerified) blockers.push("realized_pnl_or_cost_evidence_incomplete");
    if (classification === "TERMINAL_RECONCILIATION_REQUIRED" && blockers.length === 0) blockers.push("lifecycle_evidence_unclassifiable");
    if (classification === "OPEN_WAITING") warnings.push("valid_open_order_waiting_for_fill");
    if (classification === "ENTRY_SUBMITTED") warnings.push("entry_submitted_without_canonical_open_or_fill_state");
    if (classification === "EXIT_PENDING") warnings.push("exit_order_waiting_for_terminal_broker_event");
    if (classification === "FILLED_UNPROTECTED") warnings.push("protection_gap_owned_by_protective_order_domain");
    if (exitTerminalUnfilled && positionObserved) warnings.push("exit_terminal_unfilled_position_remains_open");
    if (Boolean(ledgerRow) !== Boolean(idempotencyRow)) warnings.push("ledger_idempotency_evidence_mismatch");
    if (Boolean(exitLedgerRow) !== Boolean(exitIdempotencyRow)) warnings.push("exit_ledger_idempotency_evidence_mismatch");
    if (repriceRow?.decision && repriceRow.decision !== "READY_FOR_APPROVAL") warnings.push(`reprice_not_ready:${repriceRow.decision}`);
    const status = blockers.length > 0
      ? "block"
      : ["ENTRY_SUBMITTED", "OPEN_WAITING", "FILLED_UNPROTECTED", "EXIT_PENDING"].includes(classification)
        ? "waiting"
        : "pass";
    const nextLifecycleAction = classification === "TERMINAL_RECONCILIATION_REQUIRED"
      ? "reconcile_terminal_state_report_only_before_reentry"
      : classification === "OPEN_WAITING"
          ? "wait_for_fill_or_terminal_broker_event"
          : classification === "ENTRY_SUBMITTED"
            ? "refresh_canonical_order_state_evidence"
            : classification === "EXIT_PENDING"
              ? "wait_for_exit_fill_or_terminal_broker_event"
              : classification === "FILLED_UNPROTECTED"
                ? "defer_to_protective_order_guard_metadata_domain"
                : "no_lifecycle_action_required";

    return {
      symbol,
      classification,
      status,
      orderStateStatus,
      orderStateCategory,
      normalizedState: normalizedState || null,
      ledgerStatus: ledgerStatus || null,
      idempotencyBrokerStatus: idempotencyBrokerStatus || null,
      exitLedgerStatus: exitLedgerStatus || null,
      exitIdempotencyBrokerStatus: exitIdempotencyBrokerStatus || null,
      exitActionType,
      fillabilityStatus,
      brokerOpenStatus: brokerOpenStatus || null,
      brokerClosedStatus: brokerClosedStatus || null,
      submittedEvidence,
      entrySubmittedEvidence,
      exitSubmittedEvidence,
      filledQuantityEvidence,
      orderQuantityEvidence,
      terminalReconciliationRequired,
      terminalLedgerMismatch,
      idempotencyConflict,
      positionObserved,
      brokerStopPresent,
      brokerTargetPresent,
      protectionConfirmed,
      realizedPnlEvidence,
      blockerDomain: blockers.length > 0 ? "lifecycle" : classification === "FILLED_UNPROTECTED" ? "protection" : "none",
      duplicateOpenStatus: duplicateOpen ? "DUPLICATE_OPEN_ORDER" : openWaiting ? "PASS" : "NOT_APPLICABLE",
      repriceDecision: repriceRow?.decision || null,
      blocker: blockers[0] || null,
      warning: warnings[0] || null,
      blockers,
      warnings,
      nextLifecycleAction,
    };
  }).filter(Boolean);

  const count = (classification) => rows.filter((row) => row.classification === classification).length;
  const summary = {
    totalLifecycleRows: rows.length,
    submittedEvidenceRows: rows.filter((row) => row.submittedEvidence).length,
    entryEvidenceRows: rows.filter((row) => row.entrySubmittedEvidence || row.filledQuantityEvidence > 0).length,
    exitEvidenceRows: rows.filter((row) => row.exitSubmittedEvidence).length,
    entrySubmittedRows: count("ENTRY_SUBMITTED"),
    openWaitingRows: count("OPEN_WAITING"),
    filledUnprotectedRows: count("FILLED_UNPROTECTED"),
    filledProtectedRows: count("FILLED_PROTECTED"),
    exitPendingRows: count("EXIT_PENDING"),
    exitedTerminalReconciledRows: count("EXITED_TERMINAL_RECONCILED"),
    expiredOrCanceledReconciledRows: count("EXPIRED_OR_CANCELED_RECONCILED"),
    terminalReconciliationRequiredRows: count("TERMINAL_RECONCILIATION_REQUIRED"),
    duplicateOpenRows: rows.filter((row) => row.duplicateOpenStatus === "DUPLICATE_OPEN_ORDER").length,
    idempotencyConflictRows: rows.filter((row) => row.idempotencyConflict).length,
    terminalLedgerMismatchRows: rows.filter((row) => row.terminalLedgerMismatch).length,
    realizedPnlVerifiedRows: rows.filter((row) => row.realizedPnlEvidence.status === "VERIFIED_NET_REALIZED_PNL").length,
    realizedPnlEvidenceGapRows: rows.filter((row) => row.exitSubmittedEvidence && row.realizedPnlEvidence.status !== "VERIFIED_NET_REALIZED_PNL").length,
    lifecycleUnknownRows: 0,
    unclassifiedRows: 0,
    lifecycleBlockerRows: rows.filter((row) => row.status === "block").length,
  };
  summary.filledCompleteRows = summary.filledUnprotectedRows + summary.filledProtectedRows;
  summary.consistentTerminalRows = summary.exitedTerminalReconciledRows + summary.expiredOrCanceledReconciledRows;
  summary.submittedEvidenceOnlyRows = summary.entrySubmittedRows;
  summary.closedLoopRows = summary.exitedTerminalReconciledRows;
  summary.entryAndExitEvidencePresent = summary.entryEvidenceRows > 0 && summary.exitEvidenceRows > 0;
  summary.buyOnlyLifecycle = summary.entryEvidenceRows > 0 && summary.exitEvidenceRows === 0;
  summary.closedLoopEvidenceStatus = summary.closedLoopRows > 0 && summary.realizedPnlVerifiedRows > 0
    ? "VERIFIED_CLOSED_LOOP_EVIDENCE"
    : summary.exitEvidenceRows > 0
      ? "EXIT_EVIDENCE_INCOMPLETE"
      : summary.entryEvidenceRows > 0
        ? "ENTRY_ONLY_EVIDENCE"
        : "NO_PAPER_LIFECYCLE_EVIDENCE";
  const status = summary.lifecycleBlockerRows > 0
    ? "block"
    : summary.openWaitingRows > 0 || summary.entrySubmittedRows > 0 || summary.filledUnprotectedRows > 0 || summary.exitPendingRows > 0
      ? "waiting"
      : "pass";
  const reportWarnings = rows.length === 0
    ? ["no_lifecycle_evidence_observed"]
    : summary.buyOnlyLifecycle
      ? ["closed_loop_exit_evidence_not_observed"]
      : [];
  return {
    sourceReport: "order-state-consistency-report.json",
    contractVersion: "paper-entry-exit-lifecycle-v1",
    contractScope: "entry_to_terminal_exit_with_realized_pnl",
    status,
    score: scoreFrom(status, status === "waiting" ? 60 : null),
    blockers: rows.flatMap((row) => row.blockers.map((blocker) => `${row.symbol}:${blocker}`)),
    warnings: [
      ...reportWarnings,
      ...rows.flatMap((row) => row.warnings.map((warning) => `${row.symbol}:${warning}`)),
    ],
    summary,
    rows,
  };
}

function buildPaperExitReadiness({
  preview,
  performance,
  positionProtectionAudit,
  brokerChildReconciliation,
  orderLedger,
  orderIdempotency,
  orderState,
}) {
  const requiredExitActions = [...EXIT_ACTIONS];
  const actionIntent = preview?.actionIntent && typeof preview.actionIntent === "object"
    ? preview.actionIntent
    : null;
  const allowedActionTypes = Array.isArray(actionIntent?.allowedActionTypes)
    ? [...new Set(actionIntent.allowedActionTypes.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))]
    : [];
  const missingExitActions = requiredExitActions.filter((action) => !allowedActionTypes.includes(action));
  const producerEnabled = actionIntent?.enabled === true;
  const producerPreviewOnly = actionIntent?.previewOnly !== false;
  const productionProducerReady = producerEnabled && !producerPreviewOnly && missingExitActions.length === 0;
  const shadowIntent = preview?.paperExitShadowIntent?.mode === "REPORT_ONLY_SHADOW"
    ? preview.paperExitShadowIntent
    : null;
  const shadowRows = Array.isArray(shadowIntent?.rows) ? shadowIntent.rows : [];
  const shadowCountMatches = Boolean(shadowIntent) && (
    asNumber(shadowIntent?.exitNotDueRows, 0)
    + asNumber(shadowIntent?.scaleDownDueRows, 0)
    + asNumber(shadowIntent?.exitPartialDueRows, 0)
    + asNumber(shadowIntent?.exitFullDueRows, 0)
    + asNumber(shadowIntent?.evidenceIncompleteRows, 0) === shadowRows.length
  );
  const shadowSafetyValid = shadowIntent?.wouldCreateBrokerPayload === false
    && shadowIntent?.brokerMutationAttempted === false
    && shadowIntent?.brokerMutationSubmitted === false
    && shadowIntent?.stateMutationAttempted === false
    && shadowIntent?.stateMutationSubmitted === false;
  const shadowProducerReady = Boolean(
    shadowIntent
    && shadowSafetyValid
    && shadowCountMatches
    && asNumber(shadowIntent?.evaluatedPositionRows, -1) === shadowRows.length
    && asNumber(shadowIntent?.unknownOrUnclassifiedRows, -1) === 0
    && shadowIntent?.status !== "HELD_POSITION_EVIDENCE_UNAVAILABLE"
  );
  const producerReady = productionProducerReady || shadowProducerReady;

  const payloadRows = Array.isArray(preview?.payloads) ? preview.payloads : [];
  const skippedRows = Array.isArray(preview?.skipped) ? preview.skipped : [];
  const exitIntentBySymbol = new Map();
  for (const [source, sourceRows] of [["skipped", skippedRows], ["payload", payloadRows]]) {
    for (const row of sourceRows) {
      const symbol = String(row?.symbol || "").trim().toUpperCase();
      const actionType = String(row?.actionType || "").trim().toUpperCase();
      if (symbol && EXIT_ACTIONS.has(actionType)) exitIntentBySymbol.set(symbol, { ...row, actionType, source });
    }
  }
  if (shadowIntent) {
    for (const row of shadowRows) {
      const symbol = String(row?.symbol || "").trim().toUpperCase();
      if (symbol) exitIntentBySymbol.set(symbol, { ...row, source: "shadow" });
    }
  }

  const protectionBySymbol = latestEvidenceBySymbol(rowsArray(positionProtectionAudit));
  const brokerChildrenBySymbol = latestEvidenceBySymbol(rowsArray(brokerChildReconciliation));
  const orderStateBySymbol = latestEvidenceBySymbol(rowsArray(orderState));
  const ledgerExitRows = ordersArray(orderLedger).filter(isExitEvidence);
  const idempotencyExitRows = ordersArray(orderIdempotency).filter(isExitEvidence);
  const ledgerExitBySymbol = latestEvidenceBySymbol(ledgerExitRows);
  const idempotencyExitBySymbol = latestEvidenceBySymbol(idempotencyExitRows);
  const livePositions = Array.isArray(performance?.live?.positions)
    ? performance.live.positions
    : rowsArray(positionProtectionAudit).filter((row) => normalizedStatus(row?.normalizedFillState) === "filled");
  const positionRows = livePositions.filter((row) => {
    const qty = finiteNumber(row?.qty ?? row?.quantity);
    return qty == null ? normalizedStatus(row?.normalizedFillState) === "filled" : qty !== 0;
  });
  const positions = uniqueRowsBySymbol([
    ...positionRows,
    ...shadowRows.map((row) => ({ symbol: row?.symbol })),
  ]).sort((a, b) => String(a?.symbol || "").localeCompare(String(b?.symbol || "")));

  const preflightCode = String(preview?.preflight?.code || "").trim().toUpperCase() || null;
  const rawShadowMarketStatus = String(shadowIntent?.marketSessionEvidence?.status || "").trim().toUpperCase();
  const shadowMarketOpen = shadowIntent?.marketSessionEvidence?.marketOpen;
  const shadowMarketSession = rawShadowMarketStatus === "MARKET_SESSION_RTH_ELIGIBLE" && shadowMarketOpen === true
    ? { status: rawShadowMarketStatus, eligible: true }
    : rawShadowMarketStatus === "MARKET_SESSION_CLOSED" && shadowMarketOpen === false
      ? { status: rawShadowMarketStatus, eligible: false }
      : rawShadowMarketStatus === "MARKET_SESSION_EVIDENCE_UNAVAILABLE" && shadowMarketOpen == null
        ? { status: rawShadowMarketStatus, eligible: null }
        : rawShadowMarketStatus === "MARKET_SESSION_CONTRACT_INVALID" && shadowMarketOpen == null
          ? { status: rawShadowMarketStatus, eligible: null }
          : rawShadowMarketStatus
            ? { status: "MARKET_SESSION_CONTRACT_INVALID", eligible: null }
            : { status: "MARKET_SESSION_EVIDENCE_UNAVAILABLE", eligible: null };
  const marketSessionEligible = shadowIntent
    ? shadowMarketSession.eligible
    : preflightCode === "PREFLIGHT_PASS"
      ? true
      : preflightCode === "PREFLIGHT_MARKET_CLOSED" || preview?.preflight?.blocking === true
        ? false
        : null;

  const rows = positions.map((position) => {
    const symbol = String(position?.symbol || "").trim().toUpperCase();
    const protection = protectionBySymbol.get(symbol) || null;
    const brokerChildren = brokerChildrenBySymbol.get(symbol) || null;
    const action = exitIntentBySymbol.get(symbol) || null;
    const ledgerExit = ledgerExitBySymbol.get(symbol) || null;
    const idempotencyExit = idempotencyExitBySymbol.get(symbol) || null;
    const terminalState = orderStateBySymbol.get(symbol) || null;
    const signedQty = finiteNumber(position?.qty ?? position?.quantity ?? protection?.qty);
    const sideToken = normalizedStatus(position?.side ?? position?.positionSide);
    const expectedShadowSide = action?.expectedExecutionSide === "buy"
      ? "short"
      : action?.expectedExecutionSide === "sell"
        ? "long"
        : null;
    const positionSide = sideToken === "short" || (signedQty != null && signedQty < 0)
      ? "short"
      : sideToken === "long" || (signedQty != null && signedQty > 0)
        ? "long"
        : expectedShadowSide;
    const ownershipClassification = protection?.ownershipClassification
      || brokerChildren?.ownershipClassification
      || null;
    const ownershipVerified = ownershipClassification === "SIDECAR_MANAGED_FILLED";
    const brokerStopPresent = protection?.brokerStopPresent === true || brokerChildren?.brokerStopPresent === true;
    const brokerTargetPresent = protection?.brokerTargetPresent === true || brokerChildren?.brokerTargetPresent === true;
    const protectionEvidencePresent = Boolean(protection || brokerChildren);
    const protectiveChildConflict = brokerStopPresent || brokerTargetPresent;
    const openExitRows = ledgerExitRows.filter((row) => String(row?.symbol || "").trim().toUpperCase() === symbol && OPEN_STATES.has(normalizedStatus(row?.status)));
    const duplicateOpenExit = openExitRows.length > 1;
    const idempotencyConflict = hasIdempotencyConflict(ledgerExit, idempotencyExit);
    const openExitOrderPresent = openExitRows.length > 0
      || OPEN_STATES.has(normalizedStatus(idempotencyExit?.brokerStatus || idempotencyExit?.status));
    const actionDue = EXIT_ACTIONS.has(String(action?.actionType || "").trim().toUpperCase());
    const shadowEvaluated = action?.source === "shadow" && action?.evaluationStatus === "EVALUATED";
    const actionPropagated = action?.source === "payload";
    const actionStage6File = action?.source === "shadow" ? action?.stage6File : preview?.stage6File;
    const actionStage6Hash = action?.source === "shadow" ? action?.stage6Hash : preview?.stage6Hash;
    const stage6LineagePresent = action?.source === "shadow"
      ? Boolean(
        String(actionStage6File || "").trim()
        && /^[a-f0-9]{64}$/i.test(String(actionStage6Hash || "").trim())
      )
      : Boolean(String(actionStage6File || "").trim() && String(actionStage6Hash || "").trim());
    const terminalReconciliationBlocked = terminalState?.terminalReconciliationRequired === true
      || String(terminalState?.category || "").trim().toUpperCase() === "TERMINAL_RECONCILIATION_REQUIRED";
    const heldPositionIdempotencyStatus = normalizedStatus(protection?.idempotencyStatus);
    const heldPositionIdempotencyUnresolved = heldPositionIdempotencyStatus === "not_recorded";
    const shadowLineageUnresolved = action?.source === "shadow" && (!shadowEvaluated || !stage6LineagePresent);
    const unresolvedHeldIdentity = heldPositionIdempotencyUnresolved || shadowLineageUnresolved;

    let baseClassification = "EXIT_EVIDENCE_INCOMPLETE";
    let blocker = "exit_action_producer_runtime_evidence_incomplete";
    if (action?.source === "shadow" && (!shadowEvaluated || !stage6LineagePresent)) {
      blocker = "held_position_stage6_lineage_incomplete";
    } else if (!actionDue && producerReady && (!shadowIntent || shadowEvaluated)) {
      baseClassification = "EXIT_NOT_DUE";
      blocker = null;
    } else if (actionDue && !ownershipVerified) {
      baseClassification = "EXIT_BLOCKED_OWNERSHIP";
      blocker = "ownership_proof_required";
    } else if (actionDue && (heldPositionIdempotencyUnresolved || duplicateOpenExit || idempotencyConflict || openExitOrderPresent)) {
      baseClassification = "EXIT_BLOCKED_LEDGER_OR_IDEMPOTENCY";
      blocker = heldPositionIdempotencyUnresolved
        ? "held_position_idempotency_evidence_unresolved"
        : duplicateOpenExit
          ? "duplicate_open_exit_order"
          : idempotencyConflict
            ? "exit_idempotency_conflict"
            : "open_exit_order_already_present";
    } else if (actionDue && terminalReconciliationBlocked) {
      baseClassification = "EXIT_BLOCKED_TERMINAL_RECONCILIATION";
      blocker = "terminal_reconciliation_required";
    } else if (actionDue && marketSessionEligible === false) {
      baseClassification = "EXIT_BLOCKED_MARKET_SESSION";
      blocker = "market_session_not_eligible";
    } else if (actionDue && protectiveChildConflict) {
      baseClassification = "EXIT_BLOCKED_PROTECTION_CONFLICT";
      blocker = "cancel_protective_children_before_direct_exit";
    } else if (
      actionDue
      && (actionPropagated || shadowEvaluated)
      && protectionEvidencePresent
      && positionSide
      && signedQty != null
      && signedQty !== 0
      && stage6LineagePresent
      && marketSessionEligible === true
    ) {
      baseClassification = "EXIT_READY_REPORT_ONLY";
      blocker = null;
    } else if (actionDue) {
      blocker = actionPropagated || shadowEvaluated
        ? "exit_safety_evidence_incomplete"
        : "exit_action_not_propagated_to_payload";
    }
    const classification = shadowIntent
      ? {
        EXIT_NOT_DUE: "EXIT_SHADOW_NOT_DUE",
        EXIT_READY_REPORT_ONLY: "EXIT_SHADOW_READY_REPORT_ONLY",
        EXIT_BLOCKED_PROTECTION_CONFLICT: "EXIT_SHADOW_BLOCKED_PROTECTION",
        EXIT_BLOCKED_OWNERSHIP: "EXIT_SHADOW_BLOCKED_OWNERSHIP",
        EXIT_BLOCKED_LEDGER_OR_IDEMPOTENCY: "EXIT_SHADOW_BLOCKED_LEDGER_OR_IDEMPOTENCY",
        EXIT_BLOCKED_TERMINAL_RECONCILIATION: "EXIT_SHADOW_BLOCKED_TERMINAL_RECONCILIATION",
        EXIT_BLOCKED_MARKET_SESSION: "EXIT_SHADOW_BLOCKED_MARKET_SESSION",
        EXIT_EVIDENCE_INCOMPLETE: "EXIT_SHADOW_EVIDENCE_INCOMPLETE",
      }[baseClassification]
      : baseClassification;

    const expectedExecutionSide = positionSide === "short" ? "buy" : positionSide === "long" ? "sell" : null;
    return {
      symbol,
      classification,
      ownershipClassification,
      positionSide,
      quantityEvidencePresent: signedQty != null && signedQty !== 0,
      stage6File: actionStage6File || null,
      stage6Hash: actionStage6Hash || null,
      positionLineageStatus: action?.positionLineageStatus || null,
      lineageSource: action?.lineageSource || null,
      signalEvaluationBasis: action?.signalEvaluationBasis || null,
      lineageCandidateCount: finiteNumber(action?.lineageCandidateCount),
      actionType: action?.actionType || null,
      actionReason: action?.actionReason || action?.reason || null,
      actionPropagatedAsPayload: actionPropagated,
      shadowEvaluated,
      brokerStopPresent,
      brokerTargetPresent,
      openExitOrderPresent,
      duplicateOpenExit,
      idempotencyConflict,
      terminalReconciliationBlocked,
      heldPositionIdempotencyStatus: heldPositionIdempotencyStatus || null,
      unresolvedHeldIdentity,
      expectedExecutionSide,
      expectedExitQuantityPolicy: action?.actionType === "EXIT_FULL"
        ? "FULL_CURRENT_ABSOLUTE_POSITION"
        : action?.actionType === "EXIT_PARTIAL"
          ? "CONFIGURED_EXIT_PARTIAL_RATIO"
          : action?.actionType === "SCALE_DOWN"
            ? "CONFIGURED_SCALE_DOWN_RATIO"
            : null,
      marketSessionEligible,
      blocker,
      nextAction: baseClassification === "EXIT_READY_REPORT_ONLY"
        ? "prepare_scoped_paper_exit_approval_only"
        : baseClassification === "EXIT_NOT_DUE"
          ? "wait_for_policy_exit_condition"
          : baseClassification === "EXIT_BLOCKED_PROTECTION_CONFLICT"
            ? "report_only_cancel_confirm_exit_residual_verify_plan"
            : "resolve_classified_blocker_before_exit_review",
      protectionSafeExitPlan: {
        childOrderIdsPresent: Boolean(protection?.brokerSellOrderCount || protection?.brokerNestedSellOrderCount || brokerStopPresent || brokerTargetPresent),
        cancelBeforeExitRequired: protectiveChildConflict,
        cancellationConfirmationGate: protectiveChildConflict ? "ALL_PROTECTIVE_CHILDREN_TERMINAL_BEFORE_EXIT_SUBMIT" : "NOT_REQUIRED",
        exitSubmissionGate: "EXACT_CONFIRM_LIVE_EXECUTION_PAPER_SCOPE_REQUIRED",
        residualQuantityVerification: "VERIFY_BROKER_POSITION_AFTER_TERMINAL_EXIT_EVENT",
        rollbackPlan: "if_cancel_succeeds_but_exit_fails_restore_protection_under_separate_approval",
        unprotectedRiskWindow: protectiveChildConflict ? "cancel_confirmation_to_exit_acceptance" : "none_created_by_cancel",
      },
    };
  });

  const count = (classification) => rows.filter((row) => row.classification === classification).length;
  const readyRows = rows.filter((row) =>
    row.classification === "EXIT_READY_REPORT_ONLY" || row.classification === "EXIT_SHADOW_READY_REPORT_ONLY"
  );
  const unresolvedHeldIdentityRows = rows.filter((row) => row.unresolvedHeldIdentity);
  const selected = unresolvedHeldIdentityRows.length === 0 ? readyRows[0] || null : null;
  const realizedPnlRows = Array.isArray(performance?.realizedPnl?.rows) ? performance.realizedPnl.rows : [];
  const verifiedPnlRows = realizedPnlRows.filter((row) => row?.status === "VERIFIED_NET_REALIZED_PNL");
  const partialPnlRows = realizedPnlRows.filter((row) => row?.status === "PARTIAL_EXIT_PNL_ONLY");
  const simulationProxyRows = Array.isArray(performance?.simulation?.rows)
    ? performance.simulation.rows.filter((row) => finiteNumber(row?.exitPrice) != null)
    : [];
  const primaryRootCause = rows.length === 0
    ? "HELD_POSITION_LINEAGE_MISSING"
    : shadowIntent && !shadowProducerReady
      ? shadowIntent?.primaryLivenessGap || "SHADOW_RESULT_NOT_PROPAGATED"
      : !producerReady
        ? "EXIT_ACTION_PRODUCER_DISABLED"
        : rows.every((row) => row.classification === "EXIT_NOT_DUE" || row.classification === "EXIT_SHADOW_NOT_DUE")
        ? "EXIT_CONDITION_NOT_REACHED"
          : rows.some((row) => row.blocker === "exit_action_not_propagated_to_payload")
            ? "EXIT_ACTION_NOT_PROPAGATED"
            : unresolvedHeldIdentityRows.length > 0
              ? "held_position_identity_evidence_unresolved"
              : readyRows.length > 0
              ? null
              : rows.find((row) => row.blocker)?.blocker || null;

  return {
    contractVersion: "paper-exit-readiness-v1",
    reportOnly: true,
    primaryRootCause,
    producerLiveness: {
      actionIntentEvidencePresent: Boolean(actionIntent),
      enabled: producerEnabled,
      previewOnly: producerPreviewOnly,
      allowedActionTypes,
      requiredExitActions,
      missingExitActions,
      productionRuntimeReadyForExitIntentGeneration: productionProducerReady,
      shadowRuntimeReadyForExitIntentGeneration: shadowProducerReady,
      runtimeReadyForExitIntentGeneration: producerReady,
      actionTypeConfigured: Object.fromEntries(requiredExitActions.map((action) => [action, productionProducerReady && allowedActionTypes.includes(action)])),
      shadowActionTypeEvaluated: Object.fromEntries(requiredExitActions.map((action) => [action, shadowProducerReady])),
    },
    shadowEvaluation: {
      mode: shadowIntent?.mode || null,
      status: shadowIntent?.status || "NOT_AVAILABLE",
      marketSessionStatus: shadowIntent ? shadowMarketSession.status : "NOT_APPLICABLE",
      marketSessionEligible: shadowIntent ? shadowMarketSession.eligible : null,
      countMatches: shadowCountMatches,
      evaluatedPositionRows: asNumber(shadowIntent?.evaluatedPositionRows, 0),
      exitNotDueRows: count("EXIT_SHADOW_NOT_DUE"),
      scaleDownDueRows: asNumber(shadowIntent?.scaleDownDueRows, 0),
      exitPartialDueRows: asNumber(shadowIntent?.exitPartialDueRows, 0),
      exitFullDueRows: asNumber(shadowIntent?.exitFullDueRows, 0),
      protectionBlockedRows: count("EXIT_SHADOW_BLOCKED_PROTECTION"),
      ownershipBlockedRows: count("EXIT_SHADOW_BLOCKED_OWNERSHIP"),
      ledgerOrIdempotencyBlockedRows: count("EXIT_SHADOW_BLOCKED_LEDGER_OR_IDEMPOTENCY"),
      terminalReconciliationBlockedRows: count("EXIT_SHADOW_BLOCKED_TERMINAL_RECONCILIATION"),
      marketSessionBlockedRows: count("EXIT_SHADOW_BLOCKED_MARKET_SESSION"),
      evidenceIncompleteRows: count("EXIT_SHADOW_EVIDENCE_INCOMPLETE"),
      unknownOrUnclassifiedRows: asNumber(shadowIntent?.unknownOrUnclassifiedRows, 0),
      wouldCreateBrokerPayload: shadowIntent?.wouldCreateBrokerPayload === true,
      brokerMutationAttempted: shadowIntent?.brokerMutationAttempted === true,
      brokerMutationSubmitted: shadowIntent?.brokerMutationSubmitted === true,
      stateMutationAttempted: shadowIntent?.stateMutationAttempted === true,
      stateMutationSubmitted: shadowIntent?.stateMutationSubmitted === true,
    },
    realizedPnlProducer: {
      status: performance?.realizedPnl?.status || "REALIZED_PNL_PRODUCER_GAP",
      brokerFillRows: realizedPnlRows.length,
      verifiedNetRows: verifiedPnlRows.length,
      partialExitRows: partialPnlRows.length,
      simulationProxyRowsIgnored: simulationProxyRows.length,
      costDoubleCountViolationRows: asNumber(performance?.realizedPnl?.summary?.costDoubleCountViolationRows, 0),
      requiredEvidence: ["verified_entry_fill", "verified_exit_fill", "matched_quantity", "direction", "explicit_broker_fee_contract", "terminal_exit", "idempotency_pass"],
      netFormula: "actual_fill_gross_pnl_minus_explicit_broker_fees",
      spreadAndSlippagePolicy: "reference_attribution_only_not_deducted_from_actual_fill_pnl",
    },
    summary: {
      filledPositionRows: rows.length,
      evaluatedPositionRows: asNumber(shadowIntent?.evaluatedPositionRows, 0),
      exitNotDueRows: count("EXIT_NOT_DUE"),
      exitReadyReportOnlyRows: count("EXIT_READY_REPORT_ONLY"),
      exitBlockedProtectionConflictRows: count("EXIT_BLOCKED_PROTECTION_CONFLICT"),
      exitBlockedOwnershipRows: count("EXIT_BLOCKED_OWNERSHIP"),
      exitBlockedLedgerOrIdempotencyRows: count("EXIT_BLOCKED_LEDGER_OR_IDEMPOTENCY"),
      exitBlockedTerminalReconciliationRows: count("EXIT_BLOCKED_TERMINAL_RECONCILIATION"),
      exitBlockedMarketSessionRows: count("EXIT_BLOCKED_MARKET_SESSION"),
      exitEvidenceIncompleteRows: count("EXIT_EVIDENCE_INCOMPLETE"),
      exitShadowNotDueRows: count("EXIT_SHADOW_NOT_DUE"),
      exitShadowReadyReportOnlyRows: count("EXIT_SHADOW_READY_REPORT_ONLY"),
      exitShadowBlockedProtectionRows: count("EXIT_SHADOW_BLOCKED_PROTECTION"),
      exitShadowBlockedOwnershipRows: count("EXIT_SHADOW_BLOCKED_OWNERSHIP"),
      exitShadowBlockedLedgerOrIdempotencyRows: count("EXIT_SHADOW_BLOCKED_LEDGER_OR_IDEMPOTENCY"),
      exitShadowBlockedTerminalReconciliationRows: count("EXIT_SHADOW_BLOCKED_TERMINAL_RECONCILIATION"),
      exitShadowBlockedMarketSessionRows: count("EXIT_SHADOW_BLOCKED_MARKET_SESSION"),
      exitShadowEvidenceIncompleteRows: count("EXIT_SHADOW_EVIDENCE_INCOMPLETE"),
      unresolvedHeldIdentityRows: unresolvedHeldIdentityRows.length,
      unknownRows: asNumber(shadowIntent?.unknownOrUnclassifiedRows, 0),
      selectedCandidateCount: selected ? 1 : 0,
    },
    rows,
    canaryApprovalPackage: selected ? {
      status: "REPORT_ONLY_PAPER_EXIT_CANARY_APPROVAL_PACKAGE_READY",
      selectedCandidateCount: 1,
      selectedSymbol: selected.symbol,
      selectedActionType: selected.actionType,
      expectedExecutionSide: selected.expectedExecutionSide,
      brokerMutationAllowed: false,
      stateMutationAllowed: false,
      approvalPhrase: `CONFIRM LIVE EXECUTION — PAPER only, selected dynamic exit row ${selected.symbol} 1개, ${selected.actionType}, max_orders=1, protection-child cancellation confirmation, idempotency/ledger verification, no auto-retry`,
    } : {
      status: "NO_SAFE_EXIT_CANARY_AVAILABLE",
      selectedCandidateCount: 0,
      brokerMutationAllowed: false,
      stateMutationAllowed: false,
      approvalPhrase: null,
    },
  };
}

function domain(name, status, score, blockers = [], warnings = [], evidence = {}) {
  return { name, status, score, blockers, warnings, evidence };
}

function buildReport() {
  const reports = {
    preview: readJson("last-dry-exec-preview.json", {}),
    fillability: readJson("fillability-report.json", {}),
    openOrderReprice: readJson("open-order-reprice-proposal.json", {}),
    orderLedger: readJson("order-ledger.json", {}),
    orderIdempotency: readJson("order-idempotency.json", {}),
    orderState: readJson("order-state-consistency-report.json", {}),
    performance: readJson("performance-dashboard.json", {}),
    terminalizationProposal: readJson("ledger-terminalization-proposal.json", {}),
    opsHealth: readJson("ops-health-report.json", {}),
    opsLaneStatus: readJson("ops-lane-status-report.json", {}),
    brokerChildReconciliation: readJson("broker-child-order-reconciliation.json", {}),
    positionProtectionAudit: readJson("position-protection-root-cause-audit.json", {}),
    guardMetadataLineage: readJson("guard-metadata-lineage-audit.json", {}),
    guardSourceRecovery: readJson("guard-source-recovery-plan.json", {}),
    persistentOcoRepair: readJson("persistent-oco-repair-plan.json", {}),
    fillStateReconciliation: readJson("fill-state-reconciliation-audit.json", {}),
    noActionableEvent: readJson("no-actionable-event-escalation.json", {}),
    lastRun: readJson("last-run.json", {}),
    lastOrderDecisionAudit: readJson("last-order-decision-audit.json", {}),
    positionOwnershipRecoveryDecision: readJson("position-ownership-recovery-decision.json", {}),
    positionOwnershipStateMigrationReview: readJson("position-ownership-state-migration-review-plan.json", {}),
    multiOcoSubmitGate: readJson("multi-oco-submit-safety-gate.json", {}),
    highPriceMinOneShare: readJson("high-price-min-one-share-canary-plan.json", {}),
  };

  const generatedAt = new Date().toISOString();
  const stage6 = stage6Identity(reports);
  const readErrors = hasReadError(...Object.values(reports));
  const mutationSignals = collectMutationSignals(reports);
  const stateMutationSignals = collectStateMutationSignals(reports);
  const currentBrokerMutationAttempted = mutationSignals.some((signal) => signal.attempted);
  const currentBrokerMutationSubmitted = mutationSignals.some((signal) => signal.submitted);
  const currentStateMutationAttempted = stateMutationSignals.some((signal) => signal.attempted);
  const currentStateMutationSubmitted = stateMutationSignals.some((signal) => signal.applied);
  const ledgerOrders = ordersArray(reports.orderLedger);
  const idempotencyOrders = ordersArray(reports.orderIdempotency);
  const submittedLedgerOrders = ledgerOrders.filter((order) => String(order?.status || "").toLowerCase() === "submitted" && order?.brokerOrderId);
  const submittedIdemOrders = idempotencyOrders.filter((order) => String(order?.brokerStatus || "").toLowerCase() === "submitted" && order?.brokerOrderId);
  const entryOrderLifecycle = buildEntryOrderLifecycle(reports);
  const paperExitReadiness = buildPaperExitReadiness(reports);

  const schedulerBlockers = [];
  const schedulerWarnings = [];
  if (!stage6.stage6Hash) schedulerBlockers.push("missing_stage6_hash");
  if (stage6.previewStale === true) schedulerBlockers.push("preview_stale_true");
  if (readErrors.length > 0) schedulerWarnings.push(...readErrors.map((error) => `read_error:${error}`));
  const schedulerStatus = statusFrom({ blockers: schedulerBlockers, warnings: schedulerWarnings });

  const submitWarnings = [];
  const submitBlockers = [];
  if (entryOrderLifecycle.summary.submittedEvidenceRows === 0) submitWarnings.push("no_paper_submit_evidence_found");
  if (reports.opsHealth?.metrics?.alpacaPayloadSchemaOverall && reports.opsHealth.metrics.alpacaPayloadSchemaOverall !== "pass") {
    submitBlockers.push(`alpaca_payload_schema_${reports.opsHealth.metrics.alpacaPayloadSchemaOverall}`);
  }
  const submitStatus = statusFrom({ blockers: submitBlockers, warnings: submitWarnings });

  const lifecycleBlockers = [...entryOrderLifecycle.blockers];
  const lifecycleWarnings = [...entryOrderLifecycle.warnings];
  const terminalRequired = asNumber(reports.orderState?.summary?.terminalReconciliationRequired, asNumber(reports.opsHealth?.metrics?.orderStateTerminalReconciliationRequired, 0));
  const terminalConflicts = asNumber(reports.orderState?.summary?.terminalConflicts, asNumber(reports.opsHealth?.metrics?.orderStateTerminalConflicts, 0));
  const orderStateFailures = asNumber(reports.orderState?.summary?.failures, asNumber(reports.opsHealth?.metrics?.orderStateFailures, 0));
  const lifecycleStatus = entryOrderLifecycle.status;

  const ledgerBlockers = [];
  const ledgerWarnings = [];
  if (terminalRequired > 0) ledgerBlockers.push(`ledger_terminal_reconciliation_required:${terminalRequired}`);
  if (submittedLedgerOrders.length !== submittedIdemOrders.length) ledgerWarnings.push("submitted_ledger_idempotency_count_mismatch_review");
  if (entryOrderLifecycle.summary.duplicateOpenRows > 0) {
    ledgerBlockers.push(`duplicate_open_orders:${entryOrderLifecycle.summary.duplicateOpenRows}`);
  }
  const terminalizationReady = asNumber(reports.terminalizationProposal?.summary?.proposalReady, asNumber(reports.opsHealth?.metrics?.ledgerTerminalizationReady, 0));
  const terminalizationEntryReady = asNumber(reports.terminalizationProposal?.summary?.entryTerminalUnfilledReady, 0);
  if (terminalRequired > 0 && terminalizationReady > 0) ledgerWarnings.push(`terminalization_proposal_ready:${terminalizationReady}`);
  const ledgerStatus = statusFrom({ blockers: ledgerBlockers, warnings: ledgerWarnings });

  const protectionBlockers = [];
  const protectionWarnings = [];
  const missingStops = asNumber(reports.brokerChildReconciliation?.summary?.missingStopChildren, asNumber(reports.opsHealth?.metrics?.brokerChildReconciliationMissingStops, 0));
  const missingTargets = asNumber(reports.brokerChildReconciliation?.summary?.missingTargetChildren, asNumber(reports.opsHealth?.metrics?.brokerChildReconciliationMissingTargets, 0));
  const guardMissing = asNumber(reports.positionProtectionAudit?.summary?.guardMetadataMissing, asNumber(reports.opsHealth?.metrics?.positionProtectionGuardMetadataMissing, 0));
  const guardStale = asNumber(reports.positionProtectionAudit?.summary?.guardMetadataStale, asNumber(reports.opsHealth?.metrics?.positionProtectionGuardMetadataStale, 0));
  const invalidGeometry = asNumber(reports.positionProtectionAudit?.summary?.invalidGeometry, asNumber(reports.opsHealth?.metrics?.positionProtectionInvalidGeometry, 0));
  const repairEligible = asNumber(reports.guardSourceRecovery?.summary?.repairEligibleNow, asNumber(reports.opsHealth?.metrics?.guardSourceRecoveryRepairEligible, 0));
  const recoveryStatusCounts = reports.guardSourceRecovery?.summary?.recoveryStatusCounts ||
    reports.opsHealth?.metrics?.guardSourceRecoveryStatusCounts || {};
  const freshSourceRecoveryStatusCounts = reports.guardSourceRecovery?.summary?.freshSourceRecoveryStatusCounts ||
    reports.opsHealth?.metrics?.guardSourceRecoveryFreshStatusCounts || {};
  const geometryDriftClassificationCounts = reports.guardSourceRecovery?.summary?.geometryDriftClassificationCounts || {};
  const geometryDriftOwnerCounts = reports.guardSourceRecovery?.summary?.geometryDriftOwnerCounts || {};
  const geometryDriftUnclassified = asNumber(reports.guardSourceRecovery?.summary?.geometryDriftUnclassified, 0);
  const recoveryStatusUnknown = asNumber(
    reports.guardSourceRecovery?.summary?.recoveryStatusUnknown,
    asNumber(reports.opsHealth?.metrics?.guardSourceRecoveryStatusUnknown, 0)
  );
  const recoverySourcePrecedenceViolations = asNumber(
    reports.guardSourceRecovery?.summary?.sourcePrecedenceViolations,
    asNumber(reports.opsHealth?.metrics?.guardSourceRecoveryPrecedenceViolations, 0)
  );
  const recoveryMaterializationRequired = asNumber(
    reports.guardSourceRecovery?.summary?.sourceMaterializationRequired,
    asNumber(reports.opsHealth?.metrics?.guardSourceRecoveryMaterializationRequired, 0)
  );
  const recoveryNoFreshSource = asNumber(
    reports.guardSourceRecovery?.summary?.noFreshSourceAvailable,
    asNumber(reports.opsHealth?.metrics?.guardSourceRecoveryNoFreshSource, 0)
  );
  const allProtectionRows = rowsArray(reports.positionProtectionAudit);
  const validProtectionLanes = new Set(Object.values(PROTECTION_LANES));
  const canonicalProtectionRows = allProtectionRows.filter((row) => validProtectionLanes.has(row?.protectionLane));
  const canonicalProtectionAvailable = canonicalProtectionRows.length > 0;
  const unclassifiedProtectionRows = canonicalProtectionAvailable
    ? allProtectionRows.filter((row) => !validProtectionLanes.has(row?.protectionLane)).length
    : asNumber(reports.positionProtectionAudit?.summary?.unclassifiedRows, 0);
  const protectionLaneCounts = Object.fromEntries(
    Object.values(PROTECTION_LANES).map((lane) => [
      lane,
      canonicalProtectionRows.filter((row) => row.protectionLane === lane).length
    ])
  );
  const canonicalProtectionBlockerRows = canonicalProtectionAvailable
    ? canonicalProtectionRows.filter((row) => row.blockerDomain === "protection").length
    : asNumber(reports.positionProtectionAudit?.summary?.protectionBlockerRows, 0);
  const reportProtectionBlockerCounts = {
    rootCause: reports.positionProtectionAudit?.summary?.protectionBlockerRows,
    guardSourceRecovery: reports.guardSourceRecovery?.summary?.protectionBlockerRows,
    persistentOcoRepair: reports.persistentOcoRepair?.summary?.protectionBlockerRows
  };
  const availableProtectionBlockerCounts = Object.values(reportProtectionBlockerCounts)
    .map((value) => asNumber(value, Number.NaN))
    .filter(Number.isFinite);
  const allAvailableProtectionCountsMatch =
    availableProtectionBlockerCounts.length <= 1 || new Set(availableProtectionBlockerCounts).size === 1;
  if (canonicalProtectionAvailable) {
    if (canonicalProtectionBlockerRows > 0) protectionBlockers.push(`protection_lane_blockers:${canonicalProtectionBlockerRows}`);
    if (unclassifiedProtectionRows > 0) protectionBlockers.push(`unclassified_protection_rows:${unclassifiedProtectionRows}`);
    if (!allAvailableProtectionCountsMatch) protectionBlockers.push("protection_report_blocker_count_mismatch");
  } else {
    if (missingStops > 0) protectionBlockers.push(`broker_stop_child_missing:${missingStops}`);
    if (missingTargets > 0) protectionBlockers.push(`broker_target_child_missing:${missingTargets}`);
    if (guardMissing > 0) protectionBlockers.push(`guard_metadata_missing:${guardMissing}`);
    if (invalidGeometry > 0) protectionBlockers.push(`guard_geometry_invalid:${invalidGeometry}`);
  }
  if (guardStale > 0) protectionWarnings.push(`guard_metadata_stale:${guardStale}`);
  if (repairEligible > 0) protectionWarnings.push(`repair_eligible_report_only:${repairEligible}`);
  if (recoveryMaterializationRequired > 0) {
    protectionWarnings.push(`recovery_source_materialization_required:${recoveryMaterializationRequired}`);
  }
  if (recoveryNoFreshSource > 0) protectionWarnings.push(`recovery_source_unavailable:${recoveryNoFreshSource}`);
  if (recoveryStatusUnknown > 0) protectionBlockers.push(`recovery_status_unknown:${recoveryStatusUnknown}`);
  if (geometryDriftUnclassified > 0) protectionBlockers.push(`geometry_drift_unclassified:${geometryDriftUnclassified}`);
  if (recoverySourcePrecedenceViolations > 0) {
    protectionBlockers.push(`recovery_source_precedence_violation:${recoverySourcePrecedenceViolations}`);
  }
  const protectionStatus = statusFrom({ blockers: protectionBlockers, warnings: protectionWarnings });

  const mutationBlockers = [];
  const mutationWarnings = [];
  if (currentBrokerMutationAttempted) mutationBlockers.push("current_run_broker_mutation_attempted");
  if (currentBrokerMutationSubmitted) mutationBlockers.push("current_run_broker_mutation_submitted");
  if (currentStateMutationAttempted) mutationBlockers.push("current_run_state_mutation_attempted");
  if (currentStateMutationSubmitted) mutationBlockers.push("current_run_state_mutation_submitted");
  const previewMode = reports.preview?.mode;
  const previewExplicitSafe = previewMode && typeof previewMode === "object"
    ? previewMode.readOnly === true && previewMode.execEnabled === false
    : typeof previewMode === "string"
      ? previewMode.includes("READ_ONLY=true") && previewMode.includes("EXEC_ENABLED=false")
      : true;
  const runtimeModeEvidence = previewMode && typeof previewMode === "object"
    ? {
        readOnly: previewMode.readOnly,
        execEnabled: previewMode.execEnabled,
        liveMode: previewMode.liveMode,
        simulationLiveParity: previewMode.simulationLiveParity,
        brokerSubmissionEnabled: reports.preview?.brokerSubmission?.enabled ?? null,
        brokerSubmissionActive: reports.preview?.brokerSubmission?.active ?? null,
        brokerSubmissionReason: reports.preview?.brokerSubmission?.reason ?? null,
      }
    : { raw: previewMode ?? null };
  if (!previewExplicitSafe) mutationWarnings.push("preview_mode_not_explicit_read_only");
  const mutationStatus = statusFrom({ blockers: mutationBlockers, warnings: mutationWarnings });

  const entryBlockers = [];
  const entryWarnings = [];
  const payloadExpectation = reports.preview?.orderDecisionAudit?.summary?.payloadExpectation?.status
    || String(reports.preview?.orderReadiness || "").match(/payloadExpectation=([^\s]+)/)?.[1]
    || null;
  const topSkipReasonCategories = reports.preview?.orderDecisionAudit?.summary?.topSkipReasonCategories
    || String(reports.preview?.orderReadiness || "").match(/topSkipCategory=([^\s]+)/)?.[1]
    || null;
  const payloadCount = asNumber(reports.preview?.payloadCount, asNumber(reports.fillability?.summary?.payloadCount, 0));
  const candidateCount = asNumber(reports.fillability?.summary?.candidateCount, 0);
  if (candidateCount > 0 && payloadCount === 0) entryWarnings.push("stage6_candidates_without_payload_review");
  if (String(payloadExpectation || "").includes("stale")) entryBlockers.push(`payload_expectation_${payloadExpectation}`);
  const entryStatus = statusFrom({ blockers: entryBlockers, warnings: entryWarnings });

  const repriceBlockers = [];
  const repriceWarnings = [];
  const openRepriceReady = asNumber(reports.openOrderReprice?.summary?.readyForApproval, asNumber(reports.opsHealth?.metrics?.openOrderRepriceReady, 0));
  if (openRepriceReady > 0) repriceWarnings.push(`open_order_reprice_ready_requires_confirm_live_execution:${openRepriceReady}`);
  if (reports.openOrderReprice?.summary?.brokerMutationAttempted || reports.openOrderReprice?.summary?.brokerMutationSubmitted) repriceBlockers.push("open_order_reprice_mutation_signal_detected");
  const lifecycleRepriceWaitRows = entryOrderLifecycle.rows.filter((row) => row.repriceDecision && row.repriceDecision !== "READY_FOR_APPROVAL");
  if (lifecycleRepriceWaitRows.length > 0) repriceWarnings.push(`open_order_reprice_wait:${lifecycleRepriceWaitRows.length}`);
  const repriceStatus = statusFrom({ blockers: repriceBlockers, warnings: repriceWarnings });

  const highPriceBlockers = [];
  const highPriceWarnings = [];
  const highPriceRows = rowsArray(reports.highPriceMinOneShare);
  const highPriceSummary = reports.highPriceMinOneShare?.summary || {};
  const highPriceCapScenarioCounts = highPriceSummary.capScenarioCounts || {};
  const highPriceApproval = reports.highPriceMinOneShare?.approvalGate || {};
  const highPriceExecution = reports.highPriceMinOneShare?.executionPolicy || {};
  const highPriceCandidates = asNumber(highPriceSummary.candidates, 0);
  const highPriceEligible = asNumber(highPriceSummary.eligible, 0);
  const highPriceReadyForBrokerSubmit = highPriceSummary.readyForBrokerSubmit === true || highPriceApproval.readyForBrokerSubmit === true;
  const highPriceAttempted = highPriceSummary.brokerMutationAttempted === true || highPriceExecution.brokerMutationAttempted === true;
  const highPriceSubmitted = highPriceSummary.brokerMutationSubmitted === true || highPriceExecution.brokerMutationSubmitted === true;
  const highPriceStateAttempted = highPriceSummary.stateMutationAttempted === true || highPriceExecution.stateMutationAttempted === true;
  const highPriceBlockedBy = [...new Set(highPriceRows.flatMap((row) => Array.isArray(row?.blockedBy) ? row.blockedBy : []))].sort();
  const highPriceCapPolicyReviewRequired = asNumber(
    highPriceSummary.capPolicyReviewRequired,
    highPriceRows.filter((row) => row?.capPolicyReview === "CAP_INCREASE_REQUIRED_BEFORE_MANUAL_SUBMIT_REVIEW").length
  );
  if (highPriceAttempted) highPriceBlockers.push("high_price_broker_mutation_attempted");
  if (highPriceSubmitted) highPriceBlockers.push("high_price_broker_mutation_submitted");
  if (highPriceStateAttempted) highPriceBlockers.push("high_price_state_mutation_attempted");
  if (highPriceReadyForBrokerSubmit) highPriceBlockers.push("high_price_broker_ready_from_report_only_lane");
  if (highPriceEligible > 0) highPriceWarnings.push(`high_price_manual_approval_candidate:${highPriceEligible}`);
  if (highPriceCandidates > 0 && highPriceEligible === 0) highPriceWarnings.push(`high_price_blocked_by_caps:${highPriceBlockedBy.join("|") || "unknown"}`);
  const highPriceStatus = statusFrom({ blockers: highPriceBlockers, warnings: highPriceWarnings });

  const domains = [
    domain("scheduler_fresh_hash", schedulerStatus, scoreFrom(schedulerStatus), schedulerBlockers, schedulerWarnings, stage6),
    domain("paper_submit_capability", submitStatus, scoreFrom(submitStatus, submitStatus === "pass" ? 100 : 50), submitBlockers, submitWarnings, {
      submittedLedgerOrders: submittedLedgerOrders.length,
      submittedIdempotencyOrders: submittedIdemOrders.length,
      submittedLifecycleEvidenceRows: entryOrderLifecycle.summary.submittedEvidenceRows,
    }),
    domain("open_fill_expired_canceled_lifecycle", lifecycleStatus, scoreFrom(lifecycleStatus, lifecycleStatus === "waiting" ? 55 : null), lifecycleBlockers, lifecycleWarnings, {
      terminalReconciliationRequired: terminalRequired,
      terminalConflicts,
      orderStateFailures,
      ...entryOrderLifecycle.summary,
    }),
    domain("ledger_idempotency_state", ledgerStatus, scoreFrom(ledgerStatus), ledgerBlockers, ledgerWarnings, {
      ledgerOrders: ledgerOrders.length,
      idempotencyOrders: idempotencyOrders.length,
      submittedLedgerOrders: submittedLedgerOrders.length,
      submittedIdempotencyOrders: submittedIdemOrders.length,
      duplicateOpenRows: entryOrderLifecycle.summary.duplicateOpenRows,
      terminalizationProposalReady: terminalizationReady,
      entryTerminalUnfilledReady: terminalizationEntryReady,
    }),
    domain("protective_order_guard_metadata", protectionStatus, scoreFrom(protectionStatus), protectionBlockers, protectionWarnings, {
      missingStops,
      missingTargets,
      guardMissing,
      guardStale,
      invalidGeometry,
      repairEligible,
      protectionBlockerRows: canonicalProtectionBlockerRows,
      protectionLaneCounts,
      unclassifiedProtectionRows,
      reportProtectionBlockerCounts,
      allAvailableProtectionCountsMatch,
    }),
    domain("broker_mutation_safety", mutationStatus, scoreFrom(mutationStatus), mutationBlockers, mutationWarnings, {
      currentBrokerMutationAttempted,
      currentBrokerMutationSubmitted,
      currentStateMutationAttempted,
      currentStateMutationSubmitted,
      runtimeMode: runtimeModeEvidence,
      mutationSignals,
      stateMutationSignals,
    }),
    domain("stage6_entry_payload_quality", entryStatus, scoreFrom(entryStatus, entryStatus === "waiting" ? 60 : null), entryBlockers, entryWarnings, {
      payloadCount,
      candidateCount,
      payloadExpectation,
      topSkipReasonCategories,
    }),
    domain("open_order_reprice_guard", repriceStatus, scoreFrom(repriceStatus, repriceStatus === "waiting" ? 60 : null), repriceBlockers, repriceWarnings, {
      openRepriceReady,
      lifecycleRepriceWaitRows: lifecycleRepriceWaitRows.length,
      brokerMutationAttempted: reports.openOrderReprice?.summary?.brokerMutationAttempted ?? false,
      brokerMutationSubmitted: reports.openOrderReprice?.summary?.brokerMutationSubmitted ?? false,
    }),
    domain("high_price_min_one_share_policy", highPriceStatus, scoreFrom(highPriceStatus, highPriceStatus === "waiting" ? 60 : null), highPriceBlockers, highPriceWarnings, {
      overall: reports.highPriceMinOneShare?.overall || null,
      candidates: highPriceCandidates,
      eligible: highPriceEligible,
      selectedSymbol: highPriceSummary.selectedSymbol || null,
      capPolicyReviewRequired: highPriceCapPolicyReviewRequired,
      capScenarioCounts: highPriceCapScenarioCounts,
      blockedBy: highPriceBlockedBy,
      readyForBrokerSubmit: highPriceReadyForBrokerSubmit,
      brokerMutationAttempted: highPriceAttempted,
      brokerMutationSubmitted: highPriceSubmitted,
      stateMutationAttempted: highPriceStateAttempted,
    }),
  ];

  const hardBlockers = domains.flatMap((item) => item.blockers.map((blocker) => `${item.name}:${blocker}`));
  const paperPilotEligible = hardBlockers.length === 0
    && entryOrderLifecycle.summary.submittedEvidenceRows > 0
    && ["pass", "waiting"].includes(entryOrderLifecycle.status)
    && mutationStatus === "pass";
  const microLiveReady = hardBlockers.length === 0
    && domains.every((item) => item.status === "pass")
    && entryOrderLifecycle.summary.closedLoopRows > 0
    && entryOrderLifecycle.summary.realizedPnlVerifiedRows > 0
    && entryOrderLifecycle.summary.terminalReconciliationRequiredRows === 0
    && entryOrderLifecycle.summary.duplicateOpenRows === 0
    && entryOrderLifecycle.summary.idempotencyConflictRows === 0
    && entryOrderLifecycle.summary.terminalLedgerMismatchRows === 0
    && entryOrderLifecycle.summary.lifecycleUnknownRows === 0;
  const finalVerdict = microLiveReady ? "MICRO_LIVE_REVIEW_READY" : paperPilotEligible ? "PAPER_PILOT" : "BLOCKED";
  if (!FINAL_VERDICTS.has(finalVerdict)) throw new Error(`Invalid final verdict ${finalVerdict}`);

  const categoryBlockers = {
    stage6Entry: domains.find((item) => item.name === "stage6_entry_payload_quality")?.blockers || [],
    protectiveGuardMetadata: domains.find((item) => item.name === "protective_order_guard_metadata")?.blockers || [],
    ledgerTerminal: [
      ...domains.find((item) => item.name === "open_fill_expired_canceled_lifecycle")?.blockers || [],
      ...domains.find((item) => item.name === "ledger_idempotency_state")?.blockers || [],
    ],
    schedulerFreshHash: domains.find((item) => item.name === "scheduler_fresh_hash")?.blockers || [],
    brokerMutationSafety: domains.find((item) => item.name === "broker_mutation_safety")?.blockers || [],
    highPriceSizing: domains.find((item) => item.name === "high_price_min_one_share_policy")?.blockers || [],
  };

  const stage6EntryRows = rowsArray(reports.lastOrderDecisionAudit).filter((row) => String(row?.status || "").toLowerCase() !== "payload");
  const protectionRows = canonicalProtectionAvailable
    ? canonicalProtectionRows.filter((row) => row.blockerDomain === "protection")
    : rowsArray(reports.brokerChildReconciliation).filter((row) =>
      row?.severity !== "pass" || row?.stopChildMissing || row?.targetChildMissing || row?.guardMetadataMissing || row?.guardGeometryInvalid
    );
  const guardLineageRows = rowsArray(reports.guardMetadataLineage).filter((row) =>
    !["LINEAGE_READY", "FRESH_VALID_SOURCE_AVAILABLE"].includes(row?.lineageStatus)
    || !["FRESH_VALID_SOURCE_AVAILABLE"].includes(row?.rootCause)
  );
  const fillStateRows = uniqueRowsBySymbol([
    ...canonicalProtectionRows.filter((row) => row.blockerDomain === "ledger_fill_state"),
    ...rowsArray(reports.fillStateReconciliation).filter((row) =>
      row?.requiresLedgerTerminalizationReview || row?.reconciliationDecision !== "FILL_STATE_CONFIRMED"
    ),
    ...rowsArray(reports.terminalizationProposal),
  ]);
  const ownershipRows = uniqueRowsBySymbol([
    ...canonicalProtectionRows.filter((row) => row.blockerDomain === "ownership"),
    ...rowsArray(reports.positionOwnershipStateMigrationReview),
    ...rowsArray(reports.positionOwnershipRecoveryDecision).filter((row) =>
      row?.manualExternalAdoptionReview || row?.stateRecoveryReviewReady || String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT")
    ),
  ]);
  const blockerGroupSeparation = {
    stage6_entry_tuning: blockerGroup("stage6_entry_tuning", reports, {
      status: reports.opsHealth?.blockerGroups?.stage6_entry_tuning?.status || entryStatus,
      count: stage6EntryRows.length,
      rows: stage6EntryRows,
      nextAction: "keep in Stage6/entry policy tuning; do not treat as ops-health protection failure",
      safetyGate: "analysis_only_no_broker_mutation",
    }),
    high_price_min_one_share: blockerGroup("high_price_min_one_share", reports, {
      status: highPriceStatus,
      count: highPriceRows.length,
      rows: highPriceRows,
      nextAction: "keep report-only; broker submit requires scoped CONFIRM LIVE EXECUTION and passing notional/risk/daily caps",
      safetyGate: "CONFIRM LIVE EXECUTION required for any paper broker submit",
    }),
    protection_guard_metadata: blockerGroup("protection_guard_metadata", reports, {
      status: reports.opsHealth?.blockerGroups?.protection_guard_metadata?.status || protectionStatus,
      count: protectionRows.length,
      rows: protectionRows,
      nextAction: "split child-missing into repair candidate, repair forbidden, or fresh-source-wait before any approval",
      safetyGate: "CONFIRM LIVE EXECUTION required for protective OCO repair submit",
    }),
    guard_metadata_lineage: blockerGroup("guard_metadata_lineage", reports, {
      status: guardLineageRows.length ? "warn" : "pass",
      count: guardLineageRows.length,
      rows: guardLineageRows,
      nextAction: "recover only with fresh Stage6, position lifecycle, ledger, or recommendation source plus ownership proof",
      safetyGate: "state-only review requires explicit CONFIRM STATE OWNERSHIP RECOVERY",
    }),
    ledger_fill_state: blockerGroup("ledger_fill_state", reports, {
      status: reports.opsHealth?.blockerGroups?.ledger_fill_state?.status || ledgerStatus,
      count: fillStateRows.length,
      rows: fillStateRows,
      nextAction: "proposal-only terminalization; require backup, diff, audit record, and post-verify before state apply",
      safetyGate: "CONFIRM STATE LEDGER MIGRATION required for state mutation",
    }),
    ownership: blockerGroup("ownership", reports, {
      status: reports.opsHealth?.blockerGroups?.ownership?.status || (ownershipRows.length ? "warn" : "pass"),
      count: ownershipRows.length,
      rows: ownershipRows,
      nextAction: "external/manual positions remain blocked from automatic adoption",
      safetyGate: "CONFIRM STATE OWNERSHIP RECOVERY required for state-only ownership migration",
    }),
    safety_mutation: blockerGroup("safety_mutation", reports, {
      status: currentBrokerMutationAttempted || currentBrokerMutationSubmitted || currentStateMutationAttempted || currentStateMutationSubmitted ? "fail" : "pass",
      count: mutationSignals.filter((row) => row.attempted || row.submitted).length + stateMutationSignals.filter((row) => row.attempted || row.applied).length,
      rows: [],
      nextAction: "keep all report-only lanes non-mutating",
      safetyGate: "no mutation allowed in this scorecard",
    }),
    scheduler_data: blockerGroup("scheduler_data", reports, {
      status: reports.opsHealth?.blockerGroups?.scheduler_data?.status || schedulerStatus,
      count: schedulerBlockers.length + schedulerWarnings.length,
      rows: [],
      nextAction: "refresh Stage6/hash only if scheduler or preview stale evidence appears",
      safetyGate: "analysis/dry-run only",
    }),
  };

  const observationStopRules = [
    {
      condition: "fresh_hash_same_no_actionable_event",
      action: "stop_after_one_safe_sidecar_run_and_do_not_poll_repeatedly",
      escalation: "if repeated, move to Stage6 producer policy tuning instead of waiting",
    },
    {
      condition: "repeated_zero_executable",
      action: "stop_observation_loop",
      escalation: "route to Stage6 target/risk_geometry/breakout_proof tuning",
    },
    {
      condition: "open_order_unchanged",
      action: "do_not_recheck_until_fill_expire_cancel_or_approved_replace_event",
      escalation: "open-order lifecycle event or explicit approval required",
    },
    {
      condition: "broker_or_state_mutation_requested",
      action: "block_until_exact_scope_and_confirmation_phrase",
      escalation: "requires CONFIRM LIVE EXECUTION or state-specific confirmation",
    },
  ];

  const boundedVerification = {
    mode: "symbol_agnostic_one_shot",
    tickerSymbolsAreEvidenceOnly: true,
    maxFreshSidecarChecksPerHash: 1,
    followUpOnlyWhen: [
      "fresh_hash_not_consumed_or_preview_stale",
      "decision_audit_missing_or_empty_when_candidates_exist",
      "payload_expectation_or_top_skip_categories_missing_or_opaque",
      "broker_or_state_mutation_signal_detected",
      "new_unclassified_lane_detected",
      "approval_ready_lane_detected"
    ],
    noEventResult: "stop_after_one_safe_run_return_to_stage6_or_protection_audits",
    repeatedNoExecutableAction: "stage6_producer_tuning_not_sidecar_polling"
  };

  const overallScore = Math.round(domains.reduce((sum, item) => sum + item.score, 0) / domains.length);
  const protectionClassification = {
    sourceReport: canonicalProtectionAvailable ? "position-protection-root-cause-audit.json" : "legacy_raw_blocker_fallback",
    classifiedRows: canonicalProtectionRows.length,
    unclassifiedRows: unclassifiedProtectionRows,
    protectionLaneCounts,
    protectionBlockerRows: canonicalProtectionBlockerRows,
    ownershipBlockerRows: canonicalProtectionRows.filter((row) => row.blockerDomain === "ownership").length,
    ledgerBlockerRows: canonicalProtectionRows.filter((row) => row.blockerDomain === "ledger_fill_state").length,
    manualApprovalCandidates: protectionLaneCounts[PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE] || 0,
    recoveryStatusCounts,
    freshSourceRecoveryStatusCounts,
    geometryDriftClassificationCounts,
    geometryDriftOwnerCounts,
    geometryDriftUnclassified,
    recoveryStatusUnknown,
    recoverySourcePrecedenceViolations,
    recoveryMaterializationRequired,
    recoveryNoFreshSource,
    reportConsistency: {
      counts: reportProtectionBlockerCounts,
      allAvailableCountsMatch: allAvailableProtectionCountsMatch
    }
  };
  return {
    schemaVersion: "3.0.0",
    generatedAt,
    stateDir: STATE_DIR,
    reportOnly: true,
    brokerMutationAttempted: currentBrokerMutationAttempted,
    brokerMutationSubmitted: currentBrokerMutationSubmitted,
    stateMutationAttempted: currentStateMutationAttempted,
    stateMutationSubmitted: currentStateMutationSubmitted,
    safety: {
      brokerMutationAllowed: false,
      stateMutationAllowed: false,
      multiSubmitAllowed: false,
      brokerMutationAttempted: currentBrokerMutationAttempted,
      brokerMutationSubmitted: currentBrokerMutationSubmitted,
      stateMutationAttempted: currentStateMutationAttempted,
      stateMutationSubmitted: currentStateMutationSubmitted,
      multiSubmitAttempted: false,
      multiSubmitSubmitted: false,
    },
    finalVerdict,
    overallScore,
    paperPilotStatus: entryOrderLifecycle.status,
    summary: {
      stage6File: stage6.stage6File,
      stage6Hash: stage6.stage6Hash,
      stage6HashShort: stage6.stage6HashShort,
      finalVerdict,
      overallScore,
      hardBlockers: hardBlockers.length,
      warnings: domains.reduce((sum, item) => sum + item.warnings.length, 0),
      entryOrderLifecycleStatus: entryOrderLifecycle.status,
      paperClosedLoopEvidenceStatus: entryOrderLifecycle.summary.closedLoopEvidenceStatus,
      paperClosedLoopRows: entryOrderLifecycle.summary.closedLoopRows,
      realizedPnlVerifiedRows: entryOrderLifecycle.summary.realizedPnlVerifiedRows,
      paperExitPrimaryRootCause: paperExitReadiness.primaryRootCause,
      paperExitCanaryStatus: paperExitReadiness.canaryApprovalPackage.status,
      paperSubmittedEvidence: entryOrderLifecycle.summary.submittedEvidenceRows > 0,
      currentBrokerMutationAttempted,
      currentBrokerMutationSubmitted,
      currentStateMutationAttempted,
      currentStateMutationSubmitted,
    },
    categoryBlockers,
    blockerGroupSeparation,
    protectionClassification,
    domains,
    entryOrderLifecycle,
    paperExitReadiness,
    observationStopRules,
    boundedVerification,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("## Live Readiness Scorecard");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- verdict: \`${report.finalVerdict}\``);
  lines.push(`- overallScore: \`${report.overallScore}/100\``);
  lines.push(`- reportOnly: \`${report.reportOnly}\``);
  lines.push(`- brokerMutation: \`attempted=${report.brokerMutationAttempted} submitted=${report.brokerMutationSubmitted}\``);
  lines.push(`- stateMutation: \`attempted=${report.stateMutationAttempted} submitted=${report.stateMutationSubmitted}\``);
  lines.push(`- stage6: \`${report.summary.stage6File || "N/A"}\` / \`${report.summary.stage6HashShort || "N/A"}\``);
  lines.push(`- boundedVerification: \`${report.boundedVerification.mode}; maxFreshSidecarChecksPerHash=${report.boundedVerification.maxFreshSidecarChecksPerHash}; symbols=evidence_only\``);
  lines.push("");
  lines.push("### Domain Scores");
  lines.push("| Domain | Status | Score | Blockers | Warnings |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const item of report.domains) {
    lines.push(`| ${item.name} | \`${item.status}\` | ${item.score} | ${item.blockers.length} | ${item.warnings.length} |`);
  }
  lines.push("");
  lines.push("### Protection Classification");
  lines.push(`- source: \`${report.protectionClassification.sourceReport}\``);
  lines.push(`- rows: \`classified=${report.protectionClassification.classifiedRows} unclassified=${report.protectionClassification.unclassifiedRows} protection=${report.protectionClassification.protectionBlockerRows} ownership=${report.protectionClassification.ownershipBlockerRows} ledger=${report.protectionClassification.ledgerBlockerRows}\``);
  lines.push(`- recovery: \`unknown=${report.protectionClassification.recoveryStatusUnknown} materialization=${report.protectionClassification.recoveryMaterializationRequired} noFresh=${report.protectionClassification.recoveryNoFreshSource} precedenceViolations=${report.protectionClassification.recoverySourcePrecedenceViolations}\``);
  lines.push(`- recoveryStatusCounts: \`${JSON.stringify(report.protectionClassification.recoveryStatusCounts)}\``);
  lines.push(`- reportCountConsistency: \`${report.protectionClassification.reportConsistency.allAvailableCountsMatch ? "pass" : "fail"}\``);
  lines.push("");
  lines.push("### PAPER Closed-Loop Lifecycle");
  const lifecycle = report.entryOrderLifecycle;
  lines.push(`- source: \`${lifecycle.sourceReport}\``);
  lines.push(`- contract: \`${lifecycle.contractVersion}\` / \`${lifecycle.contractScope}\``);
  lines.push(`- status: \`${lifecycle.status}\` | evidence=\`${lifecycle.summary.closedLoopEvidenceStatus}\` | rows=\`${lifecycle.summary.totalLifecycleRows}\` | closedLoop=\`${lifecycle.summary.closedLoopRows}\` | pnlVerified=\`${lifecycle.summary.realizedPnlVerifiedRows}\``);
  lines.push(`- integrity: \`duplicateOpen=${lifecycle.summary.duplicateOpenRows} idempotencyConflict=${lifecycle.summary.idempotencyConflictRows} terminalMismatch=${lifecycle.summary.terminalLedgerMismatchRows} unknown=${lifecycle.summary.lifecycleUnknownRows}\``);
  lines.push("- rowDetails: `private_json_only`");
  lines.push("");
  lines.push("### PAPER Exit Readiness");
  const exitReadiness = report.paperExitReadiness;
  lines.push(`- rootCause: \`${exitReadiness.primaryRootCause || "none"}\``);
  lines.push(`- producer: \`enabled=${exitReadiness.producerLiveness.enabled} previewOnly=${exitReadiness.producerLiveness.previewOnly} productionReady=${exitReadiness.producerLiveness.productionRuntimeReadyForExitIntentGeneration} shadowReady=${exitReadiness.producerLiveness.shadowRuntimeReadyForExitIntentGeneration} runtimeReady=${exitReadiness.producerLiveness.runtimeReadyForExitIntentGeneration} missing=${exitReadiness.producerLiveness.missingExitActions.join("/") || "none"}\``);
  lines.push(`- rows: \`filled=${exitReadiness.summary.filledPositionRows} evaluated=${exitReadiness.summary.evaluatedPositionRows} notDue=${exitReadiness.summary.exitNotDueRows + exitReadiness.summary.exitShadowNotDueRows} ready=${exitReadiness.summary.exitReadyReportOnlyRows + exitReadiness.summary.exitShadowReadyReportOnlyRows} protection=${exitReadiness.summary.exitBlockedProtectionConflictRows + exitReadiness.summary.exitShadowBlockedProtectionRows} ownership=${exitReadiness.summary.exitBlockedOwnershipRows + exitReadiness.summary.exitShadowBlockedOwnershipRows} ledger=${exitReadiness.summary.exitBlockedLedgerOrIdempotencyRows + exitReadiness.summary.exitShadowBlockedLedgerOrIdempotencyRows} terminal=${exitReadiness.summary.exitBlockedTerminalReconciliationRows + exitReadiness.summary.exitShadowBlockedTerminalReconciliationRows} market=${exitReadiness.summary.exitBlockedMarketSessionRows + exitReadiness.summary.exitShadowBlockedMarketSessionRows} incomplete=${exitReadiness.summary.exitEvidenceIncompleteRows + exitReadiness.summary.exitShadowEvidenceIncompleteRows} unknown=${exitReadiness.summary.unknownRows}\``);
  lines.push(`- shadowSafety: \`payload=${exitReadiness.shadowEvaluation.wouldCreateBrokerPayload} brokerAttempted=${exitReadiness.shadowEvaluation.brokerMutationAttempted} brokerSubmitted=${exitReadiness.shadowEvaluation.brokerMutationSubmitted} stateAttempted=${exitReadiness.shadowEvaluation.stateMutationAttempted} stateSubmitted=${exitReadiness.shadowEvaluation.stateMutationSubmitted}\``);
  lines.push(`- realizedPnlProducer: \`${exitReadiness.realizedPnlProducer.status}\``);
  lines.push(`- canary: \`${exitReadiness.canaryApprovalPackage.status}\` | selected=\`${exitReadiness.canaryApprovalPackage.selectedCandidateCount}\``);
  lines.push("");
  lines.push("### Blocker Split");
  for (const [name, blockers] of Object.entries(report.categoryBlockers)) {
    lines.push(`- ${name}: \`${blockers.length ? `${blockers.length} blocker(s); private_json_only` : "none"}\``);
  }
  lines.push("");
  lines.push("### Blocker Group Separation");
  lines.push("| Group | Status | Count | Next Action | Safety Gate |");
  lines.push("|---|---:|---:|---|---|");
  for (const group of Object.values(report.blockerGroupSeparation || {})) {
    lines.push(`| ${group.name} | \`${group.status}\` | ${group.count} | ${group.nextAction} | ${group.safetyGate} |`);
  }
  lines.push("");
  lines.push("### Observation Stop Rules");
  for (const rule of report.observationStopRules) {
    lines.push(`- ${rule.condition}: ${rule.action}; ${rule.escalation}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const report = buildReport();
writeJsonAtomic(OUTPUT_JSON, report);
writeTextAtomic(OUTPUT_MD, renderMarkdown(report));
console.log(`[LIVE_READINESS_SCORECARD] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} verdict=${report.finalVerdict} score=${report.overallScore} attempted=${report.brokerMutationAttempted} submitted=${report.brokerMutationSubmitted}`);
