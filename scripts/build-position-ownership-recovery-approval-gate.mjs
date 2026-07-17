import fs from "node:fs";

const STATE_DIR = String(process.env.POSITION_OWNERSHIP_RECOVERY_GATE_STATE_DIR || "state").trim() || "state";
const DECISION_PATH = `${STATE_DIR}/position-ownership-recovery-decision.json`;
const OUTPUT_JSON = `${STATE_DIR}/position-ownership-recovery-approval-gate.json`;
const OUTPUT_MD = `${STATE_DIR}/position-ownership-recovery-approval-gate.md`;
const REQUIRED_STATE_APPROVAL_PHRASE = "CONFIRM STATE OWNERSHIP RECOVERY";

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

const short = (value, max = 320) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const asSymbol = (value) => String(value || "").trim().toUpperCase();

const addGate = (gates, id, status, detail) => {
  gates.push({ id, status, detail: short(detail, 500) });
};

const countRows = (rows, predicate) => rows.filter(predicate).length;
const uniqueSymbols = (rows) => Array.from(new Set(rows.map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();

const approvalPhrase = String(process.env.POSITION_OWNERSHIP_RECOVERY_CONFIRMATION || "").trim();
const approvalProvided = approvalPhrase === REQUIRED_STATE_APPROVAL_PHRASE;
const decision = readJson(DECISION_PATH);
const rows = Array.isArray(decision?.rows) ? decision.rows : [];
const stateReadyRows = rows.filter((row) =>
  row?.stateRecoveryReviewReady === true &&
  row?.repairEligibleAfterRecovery === true &&
  row?.canonicalGuardSourceRepairEligibleNow === true
);
const externalReviewRows = rows.filter((row) => row?.manualExternalAdoptionReview === true);
const doNotAutoRecoverRows = rows.filter((row) => String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT"));
const canonicalGuardSourceBlockRows = doNotAutoRecoverRows.filter((row) =>
  String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT_RECOVER_CANONICAL_GUARD_SOURCE_RECOVERY_") ||
  (row?.ownershipRecoveryDecision === "DO_NOT_RECOVER_NO_FRESH_GUARD_SOURCE" &&
    row?.manualExternalAdoptionReview !== true &&
    row?.ownershipClassification !== "EXTERNAL_OR_MANUAL_POSITION")
);
const externalDoNotAutoRecoverRows = doNotAutoRecoverRows.filter((row) =>
  row?.manualExternalAdoptionReview === true || row?.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION"
);
const alreadyProtectedRows = rows.filter((row) => row?.ownershipRecoveryDecision === "NO_RECOVERY_ALREADY_PROTECTED");
const unsafeDecision =
  decision?.executionPolicy?.brokerMutationAllowed === true ||
  decision?.executionPolicy?.brokerMutationAttempted === true ||
  decision?.executionPolicy?.brokerMutationSubmitted === true ||
  decision?.executionPolicy?.stateMutationAllowed === true ||
  decision?.executionPolicy?.stateMutationAttempted === true ||
  decision?.executionPolicy?.stateMutationApplied === true ||
  decision?.summary?.brokerMutationAttempted === true ||
  decision?.summary?.brokerMutationSubmitted === true ||
  decision?.summary?.stateMutationAttempted === true ||
  decision?.summary?.stateMutationApplied === true;

const gates = [];
addGate(gates, "decision_artifact_present", decision ? "PASS" : "BLOCK", decision ? "position ownership recovery decision loaded" : "missing position-ownership-recovery-decision.json");
addGate(gates, "decision_artifact_report_only", !unsafeDecision ? "PASS" : "BLOCK", `unsafeDecision=${unsafeDecision}`);
addGate(gates, "no_broker_mutation_in_gate", "PASS", "approval gate never calls broker APIs and never emits broker payloads");
addGate(gates, "no_state_mutation_in_gate", "PASS", "approval gate never applies ledger/metadata changes");
addGate(gates, "multi_submit_lane_forbidden", "PASS", "multi submit is not implemented or authorized by this gate");
addGate(gates, "state_recovery_candidates_present", stateReadyRows.length > 0 ? "PASS" : "INFO", `stateReady=${stateReadyRows.length}`);
addGate(gates, "canonical_guard_source_recovery_eligible", canonicalGuardSourceBlockRows.length === 0 ? "PASS" : "BLOCK", `canonicalGuardSourceBlocked=${canonicalGuardSourceBlockRows.length}`);
addGate(gates, "external_positions_not_auto_adopted", externalReviewRows.length === 0 && externalDoNotAutoRecoverRows.length === 0 ? "PASS" : "BLOCK", `externalAdoptionReview=${externalReviewRows.length} doNotAutoRecover=${externalDoNotAutoRecoverRows.length}`);
addGate(gates, "state_approval_phrase", stateReadyRows.length > 0 && approvalProvided ? "PASS" : stateReadyRows.length > 0 ? "BLOCK" : "INFO", `approvalProvided=${approvalProvided}; required=${REQUIRED_STATE_APPROVAL_PHRASE}`);
addGate(gates, "backup_diff_audit_post_verify_required", stateReadyRows.length > 0 ? "BLOCK" : "INFO", "separate state migration must provide backup, diff, audit record, and post-verify before applying any state change");

let overall = "monitoring";
let reviewDecision = "NO_STATE_RECOVERY_REVIEW_NEEDED";
let recommendedAction = "MONITOR_ONLY";
if (unsafeDecision) {
  overall = "blocked_unsafe_decision_artifact";
  reviewDecision = "BLOCK_UNSAFE_DECISION_ARTIFACT";
  recommendedAction = "STOP_AND_INSPECT_DECISION_ARTIFACT";
} else if (canonicalGuardSourceBlockRows.length > 0) {
  overall = "blocked_canonical_guard_source_recovery_required";
  reviewDecision = "CANONICAL_GUARD_SOURCE_RECOVERY_REQUIRED";
  recommendedAction = "REBUILD_CANONICAL_GUARD_SOURCE_RECOVERY_EVIDENCE_REPORT_ONLY";
} else if (externalReviewRows.length > 0 || externalDoNotAutoRecoverRows.length > 0) {
  overall = "blocked_external_adoption_evidence_required";
  reviewDecision = "DO_NOT_AUTO_RECOVER_EXTERNAL_OR_MANUAL_POSITION";
  recommendedAction = "REQUIRE_OWNERSHIP_PROOF_AND_FRESH_GUARD_SOURCE";
} else if (stateReadyRows.length > 0 && !approvalProvided) {
  overall = "manual_state_approval_required";
  reviewDecision = "STATE_RECOVERY_REVIEW_READY_BUT_NOT_APPROVED";
  recommendedAction = "REQUEST_EXACT_STATE_APPROVAL_PHRASE_BEFORE_SEPARATE_MIGRATION";
} else if (stateReadyRows.length > 0 && approvalProvided) {
  overall = "state_recovery_review_authorized_report_only";
  reviewDecision = "STATE_RECOVERY_REVIEW_AUTHORIZED";
  recommendedAction = "PREPARE_SEPARATE_STATE_ONLY_MIGRATION_WITH_BACKUP_DIFF_AUDIT_POST_VERIFY";
}

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "position_ownership_recovery_state_approval_gate_report_only",
  executionPolicy: {
    mode: "state_approval_gate_report_only",
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationApplied: false,
    multiSubmitLaneAllowed: false,
    dryRunMayApplyRecovery: false,
    requiredStateApprovalPhrase: REQUIRED_STATE_APPROVAL_PHRASE,
    approvalProvided,
    approvalUnlocksMutation: false
  },
  files: {
    positionOwnershipRecoveryDecision: Boolean(decision)
  },
  decision: {
    status: reviewDecision,
    recommendedAction,
    requiredStateApprovalPhrase: REQUIRED_STATE_APPROVAL_PHRASE,
    approvalProvided,
    stateRecoveryReviewAuthorized: stateReadyRows.length > 0 && approvalProvided,
    stateMutationAuthorized: false,
    brokerMutationAuthorized: false,
    multiSubmitAuthorized: false
  },
  summary: {
    rows: rows.length,
    alreadyProtectedNoRecovery: alreadyProtectedRows.length,
    stateRecoveryReviewReady: stateReadyRows.length,
    manualExternalAdoptionReview: externalReviewRows.length,
    doNotAutoRecover: doNotAutoRecoverRows.length,
    approvalProvided,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  },
  symbols: {
    stateReady: uniqueSymbols(stateReadyRows),
    externalAdoptionReview: uniqueSymbols(externalReviewRows),
    doNotAutoRecover: uniqueSymbols(doNotAutoRecoverRows),
    alreadyProtected: uniqueSymbols(alreadyProtectedRows)
  },
  gates,
  nextAction: recommendedAction
};

const lines = [
  "## Position Ownership Recovery Approval Gate",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- decision: \`${report.decision.status} / ${report.decision.recommendedAction}\``,
  `- summary: \`rows=${report.summary.rows} stateReady=${report.summary.stateRecoveryReviewReady} externalAdoptionReview=${report.summary.manualExternalAdoptionReview} doNotAutoRecover=${report.summary.doNotAutoRecover} approvalProvided=${report.summary.approvalProvided} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted} stateAttempted=${report.summary.stateMutationAttempted} stateApplied=${report.summary.stateMutationApplied}\``,
  "- safety: `report-only; no broker mutation; no state mutation; no multi-submit lane`",
  `- symbols: \`stateReady=${report.symbols.stateReady.join(",") || "none"} externalAdoption=${report.symbols.externalAdoptionReview.join(",") || "none"} doNotAutoRecover=${report.symbols.doNotAutoRecover.join(",") || "none"}\``,
  "- gates:"
];
for (const gate of gates) {
  lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
}
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[POSITION_OWNERSHIP_RECOVERY_APPROVAL_GATE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} stateReady=${stateReadyRows.length} externalAdoption=${externalReviewRows.length} approvalProvided=${approvalProvided} attempted=false submitted=false stateAttempted=false`);
