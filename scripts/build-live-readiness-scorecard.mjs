#!/usr/bin/env node
import fs from "fs";
import path from "path";

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

function bySymbol(items, symbol) {
  const upper = String(symbol || "").toUpperCase();
  return items.filter((item) => String(item?.symbol || "").toUpperCase() === upper);
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
  add("positionOwnershipRecoveryDecision", reports.positionOwnershipRecoveryDecision?.summary?.stateMutationAttempted, reports.positionOwnershipRecoveryDecision?.summary?.stateMutationApplied);
  add("positionOwnershipStateMigrationReview", reports.positionOwnershipStateMigrationReview?.summary?.stateMutationAttempted, reports.positionOwnershipStateMigrationReview?.summary?.stateMutationApplied);
  return signals;
}

function uniqueSymbols(rows) {
  return [...new Set(rows.map((row) => String(row?.symbol || "").toUpperCase()).filter(Boolean))].sort();
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

function buildMliLifecycle({ fillability, openOrderReprice, orderLedger, orderIdempotency, orderState }) {
  const fillRows = bySymbol(rowsArray(fillability), "MLI");
  const repriceRows = bySymbol(rowsArray(openOrderReprice), "MLI");
  const ledgerRows = bySymbol(ordersArray(orderLedger), "MLI");
  const idemRows = bySymbol(ordersArray(orderIdempotency), "MLI");
  const stateRows = bySymbol(rowsArray(orderState), "MLI");
  const fillRow = fillRows[0] || null;
  const repriceRow = repriceRows[0] || null;
  const ledgerRow = ledgerRows[0] || null;
  const idemRow = idemRows[0] || null;
  const stateRow = stateRows[0] || null;
  const brokerOpenFilledQty = asNumber(fillRow?.brokerOpenFilledQty ?? fillRow?.fillQty, 0);
  const brokerOpenQty = asNumber(fillRow?.brokerOpenQty ?? repriceRow?.qty, 0);
  const duplicateOpenCountOk = repriceRow?.checks?.duplicateOpenCountOk !== false;
  const repriceReady = repriceRow?.decision === "READY_FOR_APPROVAL" || openOrderReprice?.summary?.readyForApproval > 0;
  const hasOpenWaiting = fillRow?.status === "OPEN_WAITING" || stateRow?.normalized === "open";
  const terminalState = String(stateRow?.terminalState || fillRow?.brokerClosedStatus || "").toLowerCase();
  const fillabilityStatus = String(fillRow?.status || "").toUpperCase();
  const filled = brokerOpenFilledQty > 0 || String(stateRow?.normalized || "").toLowerCase() === "filled";
  const terminal = fillabilityStatus === "TERMINAL_UNFILLED"
    || ["expired", "canceled", "cancelled", "rejected"].includes(terminalState)
    || stateRow?.terminalReconciliationRequired === true;
  const scoreLabel = filled
    ? "FILLED_COMPLETE"
    : terminal
      ? "TERMINAL_UNFILLED_RECONCILIATION_REQUIRED"
      : hasOpenWaiting
        ? "WAITING_OPEN_NOT_FILLED"
        : ledgerRow || idemRow
          ? "SUBMITTED_LEDGER_EVIDENCE_ONLY"
          : "NO_MLI_EVIDENCE";
  const status = terminal ? "block" : hasOpenWaiting || ledgerRow || idemRow ? "waiting" : "block";
  const blockers = [];
  const warnings = [];
  if (!duplicateOpenCountOk) blockers.push("duplicate_open_order_detected");
  if (terminal) blockers.push(`mli_terminal_state_requires_reconciliation:${terminalState || fillabilityStatus || "unknown"}`);
  if (!ledgerRow || !idemRow) warnings.push("mli_ledger_or_idempotency_evidence_missing");
  if (hasOpenWaiting && !filled) warnings.push("mli_submitted_open_waiting_not_filled");
  if (repriceRow?.decision && !repriceReady) warnings.push(`reprice_not_ready:${repriceRow.decision}`);
  return {
    symbol: "MLI",
    status,
    score: scoreFrom(status, status === "waiting" ? 55 : null),
    scoreLabel,
    submittedEvidence: Boolean(ledgerRow || idemRow),
    ledgerStatus: ledgerRow?.status || null,
    idempotencyBrokerStatus: idemRow?.brokerStatus || null,
    orderStateStatus: stateRow?.status || null,
    orderStateCategory: stateRow?.category || null,
    normalizedLifecycle: stateRow?.normalized || null,
    fillabilityStatus: fillRow?.status || null,
    terminalState: terminalState || null,
    terminalUnfilledTaxonomy: fillRow?.terminalUnfilledTaxonomy || [],
    reentryPolicyDecision: fillRow?.reentryPolicyDecision || null,
    monitorStatus: fillRow?.monitorStatus || repriceRow?.monitorStatus || null,
    monitorReason: fillRow?.monitorReason || repriceRow?.monitorReason || null,
    brokerOpenStatus: fillRow?.brokerOpenStatus || repriceRow?.brokerOpenStatus || null,
    brokerOpenQty,
    brokerOpenFilledQty,
    limitPrice: fillRow?.brokerOpenLimit ?? fillRow?.activeLimit ?? repriceRow?.limitPrice ?? ledgerRow?.limitPrice ?? null,
    currentPrice: fillRow?.currentPrice ?? repriceRow?.currentPrice ?? null,
    currentVsLimitPct: fillRow?.currentVsLimitPct ?? repriceRow?.distancePct ?? null,
    repriceDecision: repriceRow?.decision || null,
    repriceReadyForApproval: Boolean(repriceReady),
    duplicateOpenCountOk,
    blockers,
    warnings,
    nextCheckPolicy: terminal
      ? "do_not_reenter_same_stage6_hash_until_fresh_stage6_or_explicit_retry_approval"
      : hasOpenWaiting && !filled
        ? "stop_rechecking_until_fill_expire_cancel_or_replace_approval_event"
        : "evaluate_after_next_lifecycle_event",
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
    terminalizationProposal: readJson("ledger-terminalization-proposal.json", {}),
    opsHealth: readJson("ops-health-report.json", {}),
    opsLaneStatus: readJson("ops-lane-status-report.json", {}),
    brokerChildReconciliation: readJson("broker-child-order-reconciliation.json", {}),
    positionProtectionAudit: readJson("position-protection-root-cause-audit.json", {}),
    guardMetadataLineage: readJson("guard-metadata-lineage-audit.json", {}),
    guardSourceRecovery: readJson("guard-source-recovery-plan.json", {}),
    fillStateReconciliation: readJson("fill-state-reconciliation-audit.json", {}),
    noActionableEvent: readJson("no-actionable-event-escalation.json", {}),
    lastRun: readJson("last-run.json", {}),
    lastOrderDecisionAudit: readJson("last-order-decision-audit.json", {}),
    positionOwnershipRecoveryDecision: readJson("position-ownership-recovery-decision.json", {}),
    positionOwnershipStateMigrationReview: readJson("position-ownership-state-migration-review-plan.json", {}),
    multiOcoSubmitGate: readJson("multi-oco-submit-safety-gate.json", {}),
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
  const mliLifecycle = buildMliLifecycle(reports);

  const schedulerBlockers = [];
  const schedulerWarnings = [];
  if (!stage6.stage6Hash) schedulerBlockers.push("missing_stage6_hash");
  if (stage6.previewStale === true) schedulerBlockers.push("preview_stale_true");
  if (readErrors.length > 0) schedulerWarnings.push(...readErrors.map((error) => `read_error:${error}`));
  const schedulerStatus = statusFrom({ blockers: schedulerBlockers, warnings: schedulerWarnings });

  const submitWarnings = [];
  const submitBlockers = [];
  if (submittedLedgerOrders.length === 0 && submittedIdemOrders.length === 0) submitWarnings.push("no_paper_submit_evidence_found");
  if (reports.opsHealth?.metrics?.alpacaPayloadSchemaOverall && reports.opsHealth.metrics.alpacaPayloadSchemaOverall !== "pass") {
    submitBlockers.push(`alpaca_payload_schema_${reports.opsHealth.metrics.alpacaPayloadSchemaOverall}`);
  }
  const submitStatus = statusFrom({ blockers: submitBlockers, warnings: submitWarnings });

  const lifecycleBlockers = [];
  const lifecycleWarnings = [];
  const terminalRequired = asNumber(reports.orderState?.summary?.terminalReconciliationRequired, asNumber(reports.opsHealth?.metrics?.orderStateTerminalReconciliationRequired, 0));
  const terminalConflicts = asNumber(reports.orderState?.summary?.terminalConflicts, asNumber(reports.opsHealth?.metrics?.orderStateTerminalConflicts, 0));
  const orderStateFailures = asNumber(reports.orderState?.summary?.failures, asNumber(reports.opsHealth?.metrics?.orderStateFailures, 0));
  if (orderStateFailures > 0) lifecycleBlockers.push(`order_state_failures:${orderStateFailures}`);
  if (terminalConflicts > 0) lifecycleBlockers.push(`terminal_conflicts:${terminalConflicts}`);
  if (terminalRequired > 0) lifecycleBlockers.push(`terminal_reconciliation_required:${terminalRequired}`);
  if (mliLifecycle.status === "waiting") lifecycleWarnings.push("mli_open_waiting_not_filled");
  const lifecycleStatus = statusFrom({ blockers: lifecycleBlockers, warnings: lifecycleWarnings });

  const ledgerBlockers = [];
  const ledgerWarnings = [];
  if (terminalRequired > 0) ledgerBlockers.push(`ledger_terminal_reconciliation_required:${terminalRequired}`);
  if (submittedLedgerOrders.length !== submittedIdemOrders.length) ledgerWarnings.push("submitted_ledger_idempotency_count_mismatch_review");
  if (mliLifecycle.submittedEvidence && mliLifecycle.duplicateOpenCountOk !== true) ledgerBlockers.push("mli_duplicate_open_order_detected");
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
  if (missingStops > 0) protectionBlockers.push(`broker_stop_child_missing:${missingStops}`);
  if (missingTargets > 0) protectionBlockers.push(`broker_target_child_missing:${missingTargets}`);
  if (guardMissing > 0) protectionBlockers.push(`guard_metadata_missing:${guardMissing}`);
  if (invalidGeometry > 0) protectionBlockers.push(`guard_geometry_invalid:${invalidGeometry}`);
  if (guardStale > 0) protectionWarnings.push(`guard_metadata_stale:${guardStale}`);
  if (repairEligible > 0) protectionWarnings.push(`repair_eligible_report_only:${repairEligible}`);
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
  if (mliLifecycle.repriceDecision && mliLifecycle.repriceDecision !== "READY_FOR_APPROVAL") repriceWarnings.push(`mli_reprice_wait:${mliLifecycle.repriceDecision}`);
  const repriceStatus = statusFrom({ blockers: repriceBlockers, warnings: repriceWarnings });

  const domains = [
    domain("scheduler_fresh_hash", schedulerStatus, scoreFrom(schedulerStatus), schedulerBlockers, schedulerWarnings, stage6),
    domain("paper_submit_capability", submitStatus, scoreFrom(submitStatus, submitStatus === "pass" ? 100 : 50), submitBlockers, submitWarnings, {
      submittedLedgerOrders: submittedLedgerOrders.length,
      submittedIdempotencyOrders: submittedIdemOrders.length,
      mliSubmittedEvidence: mliLifecycle.submittedEvidence,
    }),
    domain("open_fill_expired_canceled_lifecycle", lifecycleStatus, scoreFrom(lifecycleStatus, lifecycleStatus === "waiting" ? 55 : null), lifecycleBlockers, lifecycleWarnings, {
      terminalReconciliationRequired: terminalRequired,
      terminalConflicts,
      orderStateFailures,
      mliScoreLabel: mliLifecycle.scoreLabel,
    }),
    domain("ledger_idempotency_state", ledgerStatus, scoreFrom(ledgerStatus), ledgerBlockers, ledgerWarnings, {
      ledgerOrders: ledgerOrders.length,
      idempotencyOrders: idempotencyOrders.length,
      submittedLedgerOrders: submittedLedgerOrders.length,
      submittedIdempotencyOrders: submittedIdemOrders.length,
      mliDuplicateOpenCountOk: mliLifecycle.duplicateOpenCountOk,
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
    }),
    domain("broker_mutation_safety", mutationStatus, scoreFrom(mutationStatus), mutationBlockers, mutationWarnings, {
      currentBrokerMutationAttempted,
      currentBrokerMutationSubmitted,
      currentStateMutationAttempted,
      currentStateMutationSubmitted,
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
      mliRepriceDecision: mliLifecycle.repriceDecision,
      brokerMutationAttempted: reports.openOrderReprice?.summary?.brokerMutationAttempted ?? false,
      brokerMutationSubmitted: reports.openOrderReprice?.summary?.brokerMutationSubmitted ?? false,
    }),
  ];

  const hardBlockers = domains.flatMap((item) => item.blockers.map((blocker) => `${item.name}:${blocker}`));
  const paperPilotEligible = hardBlockers.length === 0 && mliLifecycle.submittedEvidence && mliLifecycle.status === "waiting" && mutationStatus === "pass";
  const microLiveReady = hardBlockers.length === 0
    && domains.every((item) => item.status === "pass")
    && submittedLedgerOrders.length > 0
    && mliLifecycle.scoreLabel === "FILLED_COMPLETE";
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
  };

  const stage6EntryRows = rowsArray(reports.lastOrderDecisionAudit).filter((row) => String(row?.status || "").toLowerCase() !== "payload");
  const protectionRows = rowsArray(reports.brokerChildReconciliation).filter((row) =>
    row?.severity !== "pass" || row?.stopChildMissing || row?.targetChildMissing || row?.guardMetadataMissing || row?.guardGeometryInvalid
  );
  const guardLineageRows = rowsArray(reports.guardMetadataLineage).filter((row) =>
    !["LINEAGE_READY", "FRESH_VALID_SOURCE_AVAILABLE"].includes(row?.lineageStatus)
    || !["FRESH_VALID_SOURCE_AVAILABLE"].includes(row?.rootCause)
  );
  const fillStateRows = [
    ...rowsArray(reports.fillStateReconciliation).filter((row) =>
      row?.requiresLedgerTerminalizationReview || row?.reconciliationDecision !== "FILL_STATE_CONFIRMED"
    ),
    ...rowsArray(reports.terminalizationProposal),
  ];
  const ownershipRows = [
    ...rowsArray(reports.positionOwnershipStateMigrationReview),
    ...rowsArray(reports.positionOwnershipRecoveryDecision).filter((row) =>
      row?.manualExternalAdoptionReview || row?.stateRecoveryReviewReady || String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT")
    ),
  ];
  const blockerGroupSeparation = {
    stage6_entry_tuning: blockerGroup("stage6_entry_tuning", reports, {
      status: reports.opsHealth?.blockerGroups?.stage6_entry_tuning?.status || entryStatus,
      count: stage6EntryRows.length,
      rows: stage6EntryRows,
      nextAction: "keep in Stage6/entry policy tuning; do not treat as ops-health protection failure",
      safetyGate: "analysis_only_no_broker_mutation",
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
  return {
    schemaVersion: "1.0.0",
    generatedAt,
    stateDir: STATE_DIR,
    reportOnly: true,
    brokerMutationAttempted: currentBrokerMutationAttempted,
    brokerMutationSubmitted: currentBrokerMutationSubmitted,
    stateMutationAttempted: currentStateMutationAttempted,
    stateMutationSubmitted: currentStateMutationSubmitted,
    finalVerdict,
    overallScore,
    paperPilotStatus: mliLifecycle.scoreLabel === "WAITING_OPEN_NOT_FILLED" ? "active_open_order_waiting" : mliLifecycle.scoreLabel,
    summary: {
      stage6File: stage6.stage6File,
      stage6Hash: stage6.stage6Hash,
      stage6HashShort: stage6.stage6HashShort,
      finalVerdict,
      overallScore,
      hardBlockers: hardBlockers.length,
      warnings: domains.reduce((sum, item) => sum + item.warnings.length, 0),
      mliLifecycle: mliLifecycle.scoreLabel,
      paperSubmittedEvidence: submittedLedgerOrders.length > 0 || submittedIdemOrders.length > 0,
      currentBrokerMutationAttempted,
      currentBrokerMutationSubmitted,
      currentStateMutationAttempted,
      currentStateMutationSubmitted,
    },
    categoryBlockers,
    blockerGroupSeparation,
    domains,
    mliLifecycle,
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
  lines.push("### MLI Lifecycle");
  const mli = report.mliLifecycle;
  lines.push(`- scoreLabel: \`${mli.scoreLabel}\``);
  lines.push(`- status: \`${mli.status}\` | ledger=\`${mli.ledgerStatus || "N/A"}\` | idempotency=\`${mli.idempotencyBrokerStatus || "N/A"}\` | orderState=\`${mli.normalizedLifecycle || "N/A"}\``);
  lines.push(`- brokerOpen: \`status=${mli.brokerOpenStatus || "N/A"} qty=${mli.brokerOpenQty} filledQty=${mli.brokerOpenFilledQty}\``);
  lines.push(`- reprice: \`${mli.repriceDecision || "N/A"}\` | duplicateOpenCountOk=\`${mli.duplicateOpenCountOk}\``);
  lines.push(`- nextCheckPolicy: \`${mli.nextCheckPolicy}\``);
  lines.push("");
  lines.push("### Blocker Split");
  for (const [name, blockers] of Object.entries(report.categoryBlockers)) {
    lines.push(`- ${name}: \`${blockers.length ? blockers.join(",") : "none"}\``);
  }
  lines.push("");
  lines.push("### Blocker Group Separation");
  lines.push("| Group | Status | Count | Symbols | Next Action | Safety Gate |");
  lines.push("|---|---:|---:|---|---|---|");
  for (const group of Object.values(report.blockerGroupSeparation || {})) {
    lines.push(`| ${group.name} | \`${group.status}\` | ${group.count} | ${group.affectedSymbols.join(",") || "none"} | ${group.nextAction} | ${group.safetyGate} |`);
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
