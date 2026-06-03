import fs from "node:fs";

const STATE_DIR = String(process.env.POSITION_OWNERSHIP_STATE_MIGRATION_STATE_DIR || "state").trim() || "state";
const DECISION_PATH = `${STATE_DIR}/position-ownership-recovery-decision.json`;
const GATE_PATH = `${STATE_DIR}/position-ownership-recovery-approval-gate.json`;
const OUTPUT_JSON = `${STATE_DIR}/position-ownership-state-migration-review-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/position-ownership-state-migration-review-plan.md`;
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
const uniqueSymbols = (rows) => Array.from(new Set(rows.map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();

const decision = readJson(DECISION_PATH);
const gate = readJson(GATE_PATH);
const rows = Array.isArray(decision?.rows) ? decision.rows : [];
const stateReadyRows = rows.filter((row) => row?.stateRecoveryReviewReady === true);
const externalRows = rows.filter((row) => row?.manualExternalAdoptionReview === true);
const blockedRows = rows.filter((row) => String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT"));
const gateAuthorized = gate?.decision?.stateRecoveryReviewAuthorized === true;
const approvalProvided = gate?.decision?.approvalProvided === true || gate?.executionPolicy?.approvalProvided === true;
const unsafeInputs =
  decision?.executionPolicy?.brokerMutationAllowed === true ||
  decision?.executionPolicy?.stateMutationAllowed === true ||
  decision?.summary?.brokerMutationAttempted === true ||
  decision?.summary?.brokerMutationSubmitted === true ||
  decision?.summary?.stateMutationAttempted === true ||
  decision?.summary?.stateMutationApplied === true ||
  gate?.executionPolicy?.brokerMutationAllowed === true ||
  gate?.executionPolicy?.stateMutationAllowed === true ||
  gate?.executionPolicy?.multiSubmitLaneAllowed === true ||
  gate?.summary?.brokerMutationAttempted === true ||
  gate?.summary?.brokerMutationSubmitted === true ||
  gate?.summary?.stateMutationAttempted === true ||
  gate?.summary?.stateMutationApplied === true;

const reviewRows = stateReadyRows.map((row) => ({
  symbol: asSymbol(row?.symbol),
  currentDecision: row?.ownershipRecoveryDecision || null,
  sourceClassification: row?.sourceClassification || null,
  ownershipClassification: row?.ownershipClassification || null,
  sidecarOwnershipProof: row?.proof?.sidecarOwnershipProof === true,
  ledgerFilledRows: row?.proof?.ledgerFilledRows ?? null,
  idempotencyFilledRows: row?.proof?.idempotencyFilledRows ?? null,
  stage6Files: Array.isArray(row?.proof?.stage6Files) ? row.proof.stage6Files : [],
  stage6Hashes: Array.isArray(row?.proof?.stage6Hashes) ? row.proof.stage6Hashes : [],
  hasFreshValidSource: row?.hasFreshValidSource === true,
  migrationReviewReady: gateAuthorized,
  migrationApplyAllowed: false,
  requiredSafeguards: [
    "state_backup_before_change",
    "proposed_diff_before_change",
    "audit_record_with_run_id_and_reason",
    "post_verify_ledger_idempotency_and_guard_source",
    "no_broker_mutation"
  ],
  proposedStateScope: [
    "order-ledger.json",
    "order-idempotency.json",
    "recommendation-ledger.json",
    "position guard metadata lineage artifacts"
  ],
  nextAction: gateAuthorized
    ? "prepare separate state-only migration package with backup/diff/audit/post-verify; do not apply from dry-run"
    : "wait for exact state approval phrase and evidence gate before preparing migration review"
}));

let overall = "monitoring";
let recommendedAction = "MONITOR_ONLY";
if (unsafeInputs) {
  overall = "blocked_unsafe_input_mutation_signal";
  recommendedAction = "STOP_AND_INSPECT_INPUT_ARTIFACTS";
} else if (externalRows.length > 0 || blockedRows.length > 0) {
  overall = "blocked_external_adoption_evidence_required";
  recommendedAction = "WAIT_FOR_SIDECAR_OWNERSHIP_PROOF_AND_FRESH_GUARD_SOURCE";
} else if (stateReadyRows.length > 0 && !gateAuthorized) {
  overall = "blocked_state_approval_required";
  recommendedAction = "REQUIRE_EXACT_STATE_APPROVAL_BEFORE_REVIEW_PACKAGE";
} else if (stateReadyRows.length > 0 && gateAuthorized) {
  overall = "state_migration_review_ready_report_only";
  recommendedAction = "PREPARE_REVIEW_PACKAGE_ONLY_NO_STATE_APPLY";
}

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "position_ownership_state_migration_review_plan_report_only",
  executionPolicy: {
    mode: "state_migration_review_plan_report_only",
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationApplied: false,
    dryRunMayApplyRecovery: false,
    multiSubmitLaneAllowed: false,
    requiredStateApprovalPhrase: REQUIRED_STATE_APPROVAL_PHRASE,
    approvalProvided,
    reviewAuthorized: gateAuthorized,
    approvalUnlocksMutation: false
  },
  files: {
    positionOwnershipRecoveryDecision: Boolean(decision),
    positionOwnershipRecoveryApprovalGate: Boolean(gate)
  },
  summary: {
    rows: rows.length,
    stateRecoveryReviewReady: stateReadyRows.length,
    migrationReviewRows: reviewRows.length,
    externalAdoptionReview: externalRows.length,
    doNotAutoRecover: blockedRows.length,
    reviewAuthorized: gateAuthorized,
    approvalProvided,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  },
  symbols: {
    reviewReady: uniqueSymbols(reviewRows),
    externalAdoptionReview: uniqueSymbols(externalRows),
    doNotAutoRecover: uniqueSymbols(blockedRows)
  },
  rows: reviewRows,
  requiredBeforeApply: [
    "separate migration task",
    "backup of every touched state file",
    "machine-readable diff",
    "audit record with reason and source run",
    "post-run verification artifact",
    "no broker mutation"
  ],
  nextAction: recommendedAction
};

const lines = [
  "## Position Ownership State Migration Review Plan",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- summary: \`rows=${report.summary.rows} stateReady=${report.summary.stateRecoveryReviewReady} reviewRows=${report.summary.migrationReviewRows} externalAdoptionReview=${report.summary.externalAdoptionReview} doNotAutoRecover=${report.summary.doNotAutoRecover} reviewAuthorized=${report.summary.reviewAuthorized} approvalProvided=${report.summary.approvalProvided} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted} stateAttempted=${report.summary.stateMutationAttempted} stateApplied=${report.summary.stateMutationApplied}\``,
  "- safety: `report-only; no state apply; no broker mutation; no multi-submit lane`",
  `- symbols: \`reviewReady=${report.symbols.reviewReady.join(",") || "none"} externalAdoption=${report.symbols.externalAdoptionReview.join(",") || "none"} doNotAutoRecover=${report.symbols.doNotAutoRecover.join(",") || "none"}\``,
  "| Symbol | Ownership Proof | Fresh Guard | Review Authorized | State Apply Allowed | Next Action |",
  "| --- | --- | --- | --- | --- | --- |"
];
for (const row of reviewRows) {
  lines.push(
    `| ${row.symbol} | ${row.sidecarOwnershipProof ? "yes" : "no"} | ${row.hasFreshValidSource ? "yes" : "no"} | ${row.migrationReviewReady ? "yes" : "no"} | ${row.migrationApplyAllowed ? "yes" : "no"} | ${short(row.nextAction, 160)} |`
  );
}
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[POSITION_OWNERSHIP_STATE_MIGRATION_REVIEW_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} reviewRows=${reviewRows.length} attempted=false submitted=false stateAttempted=false`);
