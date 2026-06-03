import fs from "node:fs";

const STATE_DIR = String(process.env.NO_ACTIONABLE_EVENT_STATE_DIR || "state").trim() || "state";
const LEDGER_PATH = `${STATE_DIR}/no-actionable-event-ledger.json`;
const OUTPUT_JSON = `${STATE_DIR}/no-actionable-event-escalation.json`;
const OUTPUT_MD = `${STATE_DIR}/no-actionable-event-escalation.md`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const DECISION_AUDIT_PATH = `${STATE_DIR}/last-order-decision-audit.json`;
const ENTRY_REPRICE_PATH = `${STATE_DIR}/entry-reprice-policy-decision.json`;
const OPEN_REPRICE_PATH = `${STATE_DIR}/open-order-reprice-proposal.json`;
const PERSISTENT_OCO_PATH = `${STATE_DIR}/persistent-oco-repair-plan.json`;
const OWNERSHIP_STATE_MIGRATION_PATH = `${STATE_DIR}/position-ownership-state-migration-review-plan.json`;
const MULTI_SUBMIT_GATE_PATH = `${STATE_DIR}/multi-oco-submit-safety-gate.json`;

const MAX_CONSECUTIVE_RUNS = Math.max(1, Number.parseInt(process.env.NO_ACTIONABLE_EVENT_MAX_CONSECUTIVE_RUNS || "5", 10));
const MAX_CONSECUTIVE_DAYS = Math.max(1, Number.parseInt(process.env.NO_ACTIONABLE_EVENT_MAX_CONSECUTIVE_DAYS || "3", 10));
const MAX_LEDGER_ENTRIES = Math.max(20, Number.parseInt(process.env.NO_ACTIONABLE_EVENT_LEDGER_MAX_ENTRIES || "120", 10));

const sourceHealth = [];
const readJson = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    sourceHealth.push({ label, path: filePath, status: "missing" });
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    sourceHealth.push({ label, path: filePath, status: "ok" });
    return parsed;
  } catch (error) {
    sourceHealth.push({
      label,
      path: filePath,
      status: "malformed_json",
      error: short(error?.message || error)
    });
    return null;
  }
};

const writeJson = (filePath, payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
};

const toNum = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const bool = (value) => value === true;
const dayKey = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
};

const preview = readJson(PREVIEW_PATH, "last_dry_exec_preview");
const decisionAudit = readJson(DECISION_AUDIT_PATH, "last_order_decision_audit");
const entryReprice = readJson(ENTRY_REPRICE_PATH, "entry_reprice_policy_decision");
const openReprice = readJson(OPEN_REPRICE_PATH, "open_order_reprice_proposal");
const persistentOco = readJson(PERSISTENT_OCO_PATH, "persistent_oco_repair_plan");
const ownershipMigration = readJson(OWNERSHIP_STATE_MIGRATION_PATH, "position_ownership_state_migration_review_plan");
const multiSubmitGate = readJson(MULTI_SUBMIT_GATE_PATH, "multi_oco_submit_safety_gate");
const ledger = readJson(LEDGER_PATH, "no_actionable_event_ledger") || { entries: [] };
const priorEntries = Array.isArray(ledger.entries) ? ledger.entries : [];
const ledgerIsMalformed = sourceHealth.some((entry) => entry.label === "no_actionable_event_ledger" && entry.status === "malformed_json");

const decisionSummary = decisionAudit?.summary || preview?.orderDecisionAudit?.summary || {};
const payloadExpectation = decisionSummary?.payloadExpectation || {};
const topSkipReasonCategories = decisionSummary?.topSkipReasonCategories || {};
const decisionAuditRows = Array.isArray(decisionAudit?.records)
  ? decisionAudit.records.length
  : Array.isArray(preview?.orderDecisionAudit?.records)
    ? preview.orderDecisionAudit.records.length
    : toNum(decisionSummary?.candidates, 0);
const payloadCount = toNum(preview?.payloadCount ?? preview?.previewPayloads ?? preview?.summary?.payloadCount, 0);
const unheldExecutableCandidates = toNum(payloadExpectation?.unheldExecutableCandidates, 0);
const unheldExecutablePayloadReady = toNum(payloadExpectation?.unheldExecutablePayloadReady, 0);
const openOrderRepriceReady = toNum(openReprice?.summary?.readyForApproval, 0);
const entryRepriceReady = toNum(entryReprice?.summary?.entryRepriceReviewReady, 0);
const persistentRepairSelected = toNum(persistentOco?.summary?.selected ? 1 : persistentOco?.summary?.selectedRows, 0);
const stateRecoveryReady = toNum(ownershipMigration?.summary?.stateRecoveryReviewReady, 0);
const multiSubmitSelected = toNum(multiSubmitGate?.summary?.selected, 0);
const brokerAttempted = bool(preview?.brokerReality?.attempted) || toNum(preview?.brokerReality?.attempted, 0) > 0;
const brokerSubmitted = bool(preview?.brokerReality?.submitted) || toNum(preview?.brokerReality?.submitted, 0) > 0;
const stateMutationApplied = bool(ownershipMigration?.summary?.stateMutationApplied) || bool(ownershipMigration?.executionPolicy?.stateMutationApplied);
const multiSubmitAuthorized = bool(multiSubmitGate?.summary?.multiSubmitAuthorized) || bool(multiSubmitGate?.executionPolicy?.dryRunMaySubmitMulti);

const actionableSignals = [];
if (payloadCount > 0) actionableSignals.push("payload_present");
if (unheldExecutableCandidates > 0) actionableSignals.push("unheld_executable_present");
if (unheldExecutablePayloadReady > 0) actionableSignals.push("unheld_executable_payload_ready");
if (openOrderRepriceReady > 0) actionableSignals.push("open_order_reprice_ready");
if (entryRepriceReady > 0) actionableSignals.push("entry_reprice_policy_ready");
if (persistentRepairSelected > 0) actionableSignals.push("protective_repair_selected");
if (stateRecoveryReady > 0) actionableSignals.push("state_recovery_review_ready");
if (multiSubmitSelected > 0) actionableSignals.push("multi_submit_design_candidate");

const unsafeMutationSignals = [];
if (brokerAttempted) unsafeMutationSignals.push("broker_attempted");
if (brokerSubmitted) unsafeMutationSignals.push("broker_submitted");
if (stateMutationApplied) unsafeMutationSignals.push("state_mutation_applied");
if (multiSubmitAuthorized) unsafeMutationSignals.push("multi_submit_authorized");
const malformedSources = sourceHealth.filter((entry) => entry.status === "malformed_json");
if (malformedSources.length > 0) unsafeMutationSignals.push("state_source_malformed");

const generatedAt = new Date().toISOString();
const stage6Hash = short(preview?.stage6Hash || decisionSummary?.stage6Hash || "unknown", 96) || "unknown";
const stage6File = short(preview?.stage6File || decisionSummary?.stage6File || "unknown", 160) || "unknown";
const runKey = [stage6Hash, stage6File, short(preview?.generatedAt || generatedAt, 64)].join("|");
const eventStatus = unsafeMutationSignals.length > 0
  ? "unsafe_mutation_signal"
  : actionableSignals.length > 0
    ? "actionable_event_present"
    : "no_actionable_event";

const observation = {
  generatedAt,
  runKey,
  stage6Hash,
  stage6File,
  day: dayKey(preview?.generatedAt || generatedAt),
  eventStatus,
  actionableSignals,
  unsafeMutationSignals,
  payloadCount,
  decisionAuditRows,
  payloadExpectationStatus: short(payloadExpectation?.status || "unknown", 80),
  unheldExecutableCandidates,
  unheldExecutablePayloadReady,
  openOrderRepriceReady,
  entryRepriceReady,
  persistentRepairSelected,
  stateRecoveryReady,
  multiSubmitSelected,
  topSkipReasonCategories,
  brokerMutationAttempted: brokerAttempted,
  brokerMutationSubmitted: brokerSubmitted,
  stateMutationApplied,
  multiSubmitAuthorized
};

const nextEntries = [...priorEntries.filter((entry) => entry?.runKey !== runKey), observation]
  .sort((a, b) => String(a.generatedAt || "").localeCompare(String(b.generatedAt || "")))
  .slice(-MAX_LEDGER_ENTRIES);
const reversed = [...nextEntries].reverse();
let consecutiveNoActionableRuns = 0;
const noActionDays = new Set();
for (const entry of reversed) {
  if (entry?.eventStatus !== "no_actionable_event") break;
  consecutiveNoActionableRuns += 1;
  if (entry?.day) noActionDays.add(entry.day);
}
const consecutiveNoActionableDays = noActionDays.size;

let escalationStatus = "observe";
let recommendedAction = "CHECK_NEXT_FRESH_RTH_RUN_ONLY";
if (eventStatus === "unsafe_mutation_signal") {
  escalationStatus = "blocked_unsafe_mutation_signal";
  recommendedAction = "STOP_AND_INSPECT_MUTATION_GATES";
} else if (eventStatus === "actionable_event_present") {
  escalationStatus = "actionable_event_present";
  recommendedAction = "RUN_TARGETED_BOTTLENECK_ANALYSIS_FOR_PRESENT_SIGNAL";
} else if (consecutiveNoActionableRuns >= MAX_CONSECUTIVE_RUNS || consecutiveNoActionableDays >= MAX_CONSECUTIVE_DAYS) {
  escalationStatus = "stage0_6_quality_audit_required";
  recommendedAction = "STOP_PASSIVE_OBSERVATION_AND_AUDIT_STAGE0_6_POLICY";
} else {
  escalationStatus = "no_actionable_event_observe_bounded";
  recommendedAction = "DO_NOT_KEEP_MONITORING_CONTINUOUSLY_WAIT_FOR_NEXT_FRESH_EVENT";
}

const report = {
  generatedAt,
  overall: escalationStatus,
  scope: "bounded_no_actionable_event_escalation_report_only",
  thresholds: {
    maxConsecutiveNoActionableRuns: MAX_CONSECUTIVE_RUNS,
    maxConsecutiveNoActionableDays: MAX_CONSECUTIVE_DAYS,
    maxLedgerEntries: MAX_LEDGER_ENTRIES
  },
  executionPolicy: {
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationApplied: false,
    multiSubmitLaneAllowed: false,
    observedBrokerMutationAttempted: brokerAttempted,
    observedBrokerMutationSubmitted: brokerSubmitted,
    observedStateMutationApplied: stateMutationApplied,
    observedMultiSubmitAuthorized: multiSubmitAuthorized,
    passiveObservationIsNotCompletionCriterion: true
  },
  current: observation,
  sourceHealth,
  summary: {
    eventStatus,
    consecutiveNoActionableRuns,
    consecutiveNoActionableDays,
    ledgerEntries: nextEntries.length,
    actionableSignals,
    unsafeMutationSignals,
    payloadCount,
    decisionAuditRows,
    payloadExpectationStatus: observation.payloadExpectationStatus,
    topSkipReasonCategories,
    recommendedAction
  },
  doneWhenPolicy: {
    noActionableEventSingleRun: "end current observation as no_actionable_event",
    repeatedNoActionableEvents: "escalate to Stage0-6 quality audit instead of indefinite monitoring",
    rthFirstRun: "inspect only if fresh Stage6/hash or payload/preflight/order/reprice/protection event exists",
    noBrokerMutationWithoutApproval: "CONFIRM LIVE EXECUTION required for broker mutation",
    noStateMutationWithoutApproval: "CONFIRM STATE OWNERSHIP RECOVERY required for state mutation"
  }
};

const lines = [
  "## No Actionable Event Escalation",
  `- generatedAt: \`${generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- current: \`event=${eventStatus} stage6=${stage6File} payloads=${payloadCount} decisionRows=${decisionAuditRows} payloadExpectation=${observation.payloadExpectationStatus}\``,
  `- consecutive: \`runs=${consecutiveNoActionableRuns}/${MAX_CONSECUTIVE_RUNS} days=${consecutiveNoActionableDays}/${MAX_CONSECUTIVE_DAYS}\``,
  `- actionableSignals: \`${actionableSignals.join(",") || "none"}\``,
  `- topSkipReasonCategories: \`${JSON.stringify(topSkipReasonCategories)}\``,
  `- recommendedAction: \`${recommendedAction}\``,
  "- safety: `report-only; no broker mutation; no state mutation; no multi-submit lane`",
  "",
  "### Policy",
  "- A single no-actionable run is not a failure; end the observation as `no_actionable_event`.",
  "- Repeated no-actionable runs must stop passive observation and move to Stage0-6 quality audit.",
  "- RTH observation is useful only when a fresh run carries a candidate, payload, reprice, order, or protection event.",
  ""
];

if (!ledgerIsMalformed) {
  writeJson(LEDGER_PATH, { generatedAt, entries: nextEntries });
}
writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[NO_ACTIONABLE_EVENT_ESCALATION] overall=${report.overall} event=${eventStatus} consecutiveRuns=${consecutiveNoActionableRuns}/${MAX_CONSECUTIVE_RUNS} consecutiveDays=${consecutiveNoActionableDays}/${MAX_CONSECUTIVE_DAYS} payloads=${payloadCount} decisionRows=${decisionAuditRows}`);
