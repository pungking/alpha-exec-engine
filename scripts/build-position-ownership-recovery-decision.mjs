import fs from "node:fs";

const STATE_DIR = String(process.env.POSITION_OWNERSHIP_RECOVERY_STATE_DIR || "state").trim() || "state";
const FILES = {
  ownershipGuardGap: `${STATE_DIR}/position-ownership-guard-gap-audit.json`,
  guardLineage: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  orderIdempotency: `${STATE_DIR}/order-idempotency.json`,
  recommendationLedger: `${STATE_DIR}/recommendation-ledger.json`,
  persistentOcoRepairPlan: `${STATE_DIR}/persistent-oco-repair-plan.json`,
  limitedMultiOcoRepairPlan: `${STATE_DIR}/limited-multi-oco-repair-plan.json`,
  guardSourceRecoveryPlan: `${STATE_DIR}/guard-source-recovery-plan.json`
};
const OUTPUT_JSON = `${STATE_DIR}/position-ownership-recovery-decision.json`;
const OUTPUT_MD = `${STATE_DIR}/position-ownership-recovery-decision.md`;

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

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const short = (value, max = 320) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values) => Array.from(new Set(values.filter(Boolean))).sort();
const filledish = (value) => ["filled", "partially_filled"].includes(String(value || "").trim().toLowerCase());

const valuesBySymbol = (objectish) => {
  const out = new Map();
  for (const row of Object.values(objectish || {})) {
    const symbol = asSymbol(row?.symbol);
    if (!symbol) continue;
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol).push(row);
  }
  return out;
};
const arrayBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (!symbol) continue;
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol).push(row);
  }
  return out;
};
const firstBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol && !out.has(symbol)) out.set(symbol, row);
  }
  return out;
};

const ownershipGuardGap = readJson(FILES.ownershipGuardGap);
const guardLineage = readJson(FILES.guardLineage);
const orderLedger = readJson(FILES.orderLedger);
const orderIdempotency = readJson(FILES.orderIdempotency);
const recommendationLedger = readJson(FILES.recommendationLedger);
const persistentOcoRepairPlan = readJson(FILES.persistentOcoRepairPlan);
const limitedMultiOcoRepairPlan = readJson(FILES.limitedMultiOcoRepairPlan);
const guardSourceRecoveryPlan = readJson(FILES.guardSourceRecoveryPlan);

const gapRows = Array.isArray(ownershipGuardGap?.rows) ? ownershipGuardGap.rows : [];
const lineageBySymbol = firstBySymbol(guardLineage?.rows);
const persistentBySymbol = firstBySymbol(persistentOcoRepairPlan?.rows);
const limitedBySymbol = firstBySymbol(limitedMultiOcoRepairPlan?.rows);
const guardSourceRecoveryBySymbol = firstBySymbol(guardSourceRecoveryPlan?.rows);
const ledgerBySymbol = valuesBySymbol(orderLedger?.orders);
const idemBySymbol = valuesBySymbol(orderIdempotency?.orders);
const recBySymbol = arrayBySymbol(recommendationLedger?.recommendations || recommendationLedger?.rows || []);

const proofForSymbol = (symbol) => {
  const ledgerRows = ledgerBySymbol.get(symbol) || [];
  const idemRows = idemBySymbol.get(symbol) || [];
  const recommendationRows = recBySymbol.get(symbol) || [];
  const ledgerFilledRows = ledgerRows.filter((row) => filledish(row?.status) || filledish(row?.brokerStatus));
  const idemFilledRows = idemRows.filter((row) => filledish(row?.status) || filledish(row?.brokerStatus));
  const stage6Files = unique([
    ...ledgerRows.map((row) => row?.stage6File),
    ...idemRows.map((row) => row?.stage6File),
    ...recommendationRows.map((row) => row?.latestStage6File || row?.stage6File)
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const stage6Hashes = unique([
    ...ledgerRows.map((row) => row?.stage6Hash),
    ...idemRows.map((row) => row?.stage6Hash),
    ...recommendationRows.map((row) => row?.stage6Hash)
  ].map((value) => String(value || "").trim()).filter(Boolean));
  return {
    ledgerRows: ledgerRows.length,
    idempotencyRows: idemRows.length,
    recommendationRows: recommendationRows.length,
    ledgerFilledRows: ledgerFilledRows.length,
    idempotencyFilledRows: idemFilledRows.length,
    stage6Files,
    stage6Hashes,
    sidecarOwnershipProof: ledgerFilledRows.length > 0 || idemFilledRows.length > 0,
    weakSidecarReference: ledgerRows.length > 0 || idemRows.length > 0 || recommendationRows.length > 0
  };
};

const classifyDecision = ({ gapRow, lineageRow, persistentRow, limitedRow, canonicalRecoveryRow, proof }) => {
  const protectedNoAction = gapRow?.classification === "already_protected_no_action" || gapRow?.brokerChildrenPresent === true;
  const external = gapRow?.classification === "external_position_and_guard_metadata_missing" || gapRow?.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION";
  const guardMissing = gapRow?.guardMetadataMissing === true;
  const freshGuardSource = gapRow?.hasFreshValidSource === true || Array.isArray(lineageRow?.freshValidSources) && lineageRow.freshValidSources.length > 0;
  const repairEligible = gapRow?.repairEligible === true || persistentRow?.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL" || limitedRow?.eligibleForLimitedBatch === true;
  const canonicalRecoveryEligible = canonicalRecoveryRow?.repairEligibleNow === true;
  const blockers = [];
  const requiredEvidence = [];
  let decision = "MONITOR_ONLY_NO_RECOVERY_NEEDED";
  let stateRecoveryReviewReady = false;
  let manualExternalAdoptionReview = false;

  if (protectedNoAction) {
    decision = "NO_RECOVERY_ALREADY_PROTECTED";
  } else if (external && guardMissing && !proof.sidecarOwnershipProof && !freshGuardSource) {
    decision = "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE";
    blockers.push("position_not_sidecar_managed", "guard_metadata_missing", "no_sidecar_ownership_proof", "no_fresh_guard_source");
    requiredEvidence.push("sidecar_order_ledger_or_idempotency_filled_proof", "fresh_stage6_or_lifecycle_stop_target_source");
    manualExternalAdoptionReview = true;
  } else if (external && !proof.sidecarOwnershipProof) {
    decision = "DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_PROOF";
    blockers.push("position_not_sidecar_managed", "no_sidecar_ownership_proof");
    requiredEvidence.push("sidecar_order_ledger_or_idempotency_filled_proof");
    manualExternalAdoptionReview = true;
  } else if (guardMissing && !freshGuardSource) {
    decision = "DO_NOT_RECOVER_NO_FRESH_GUARD_SOURCE";
    blockers.push("guard_metadata_missing", "no_fresh_guard_source");
    requiredEvidence.push("fresh_stage6_or_lifecycle_stop_target_source");
  } else if (!canonicalRecoveryRow) {
    decision = "DO_NOT_RECOVER_CANONICAL_GUARD_SOURCE_RECOVERY_MISSING";
    blockers.push("canonical_guard_source_recovery_missing");
    requiredEvidence.push("canonical_guard_source_recovery_row_with_repair_eligible_now_true");
  } else if (!canonicalRecoveryEligible) {
    decision = "DO_NOT_RECOVER_CANONICAL_GUARD_SOURCE_RECOVERY_NOT_ELIGIBLE";
    blockers.push("canonical_guard_source_recovery_not_eligible");
    requiredEvidence.push("canonical_guard_source_recovery_repair_eligible_now_true");
  } else if (proof.sidecarOwnershipProof && freshGuardSource) {
    decision = "STATE_ONLY_RECOVERY_REVIEW_READY";
    stateRecoveryReviewReady = true;
    requiredEvidence.push("backup_diff_audit_post_verify_required");
  } else if (repairEligible) {
    decision = "REPAIR_APPROVAL_PATH_ALREADY_HANDLED_ELSEWHERE";
  } else {
    decision = "RECOVERY_BLOCKED_UNCLASSIFIED_EVIDENCE_GAP";
    blockers.push("unclassified_evidence_gap");
    requiredEvidence.push("inspect_ownership_guard_gap_and_lineage_reports");
  }

  return {
    decision,
    blockers: unique(blockers),
    requiredEvidence: unique(requiredEvidence),
    stateRecoveryReviewReady,
    manualExternalAdoptionReview,
    repairEligibleAfterRecovery: stateRecoveryReviewReady && repairEligible && canonicalRecoveryEligible,
    nextAction: stateRecoveryReviewReady
      ? "prepare separate state-only ownership recovery migration review; do not mutate state in dry-run"
      : manualExternalAdoptionReview
        ? "do not auto-adopt external/manual position; require explicit user-supplied ownership and fresh guard source evidence first"
        : protectedNoAction
          ? "monitor only; do not duplicate broker children"
          : "keep repair blocked and continue source/ownership root-cause review"
  };
};

const rows = gapRows.map((gapRow) => {
  const symbol = asSymbol(gapRow?.symbol);
  const lineageRow = lineageBySymbol.get(symbol) || null;
  const persistentRow = persistentBySymbol.get(symbol) || null;
  const limitedRow = limitedBySymbol.get(symbol) || null;
  const canonicalRecoveryRow = guardSourceRecoveryBySymbol.get(symbol) || null;
  const proof = proofForSymbol(symbol);
  const decision = classifyDecision({ gapRow, lineageRow, persistentRow, limitedRow, canonicalRecoveryRow, proof });
  return {
    symbol,
    qty: toNum(gapRow?.qty),
    currentPrice: toNum(gapRow?.currentPrice),
    sourceClassification: gapRow?.classification || null,
    ownershipClassification: gapRow?.ownershipClassification || null,
    guardMetadataMissing: gapRow?.guardMetadataMissing === true,
    hasFreshValidSource: gapRow?.hasFreshValidSource === true,
    brokerChildrenPresent: gapRow?.brokerChildrenPresent === true,
    lineageStatus: gapRow?.lineageStatus || lineageRow?.lineageStatus || null,
    lineageRootCause: gapRow?.lineageRootCause || lineageRow?.rootCause || null,
    persistentReadiness: persistentRow?.readiness || gapRow?.persistentReadiness || null,
    limitedMultiGroup: limitedRow?.blockerGroup || gapRow?.limitedMultiGroup || null,
    canonicalGuardSourceRecoveryPresent: Boolean(canonicalRecoveryRow),
    canonicalGuardSourceRepairEligibleNow: canonicalRecoveryRow?.repairEligibleNow === true,
    canonicalGuardSourceRecoveryStatus: canonicalRecoveryRow?.recoveryStatus || null,
    proof,
    ownershipRecoveryDecision: decision.decision,
    blockers: decision.blockers,
    requiredEvidence: decision.requiredEvidence,
    stateRecoveryReviewReady: decision.stateRecoveryReviewReady,
    manualExternalAdoptionReview: decision.manualExternalAdoptionReview,
    repairEligibleAfterRecovery: decision.repairEligibleAfterRecovery,
    nextAction: decision.nextAction,
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    evidence: short(
      `classification=${gapRow?.classification || "N/A"} ownershipProof=${proof.sidecarOwnershipProof} ledgerFilled=${proof.ledgerFilledRows} idemFilled=${proof.idempotencyFilledRows} freshGuard=${gapRow?.hasFreshValidSource === true} lineage=${gapRow?.lineageStatus || lineageRow?.lineageStatus || "N/A"}`,
      500
    )
  };
});

const count = (predicate) => rows.filter(predicate).length;
const decisionCounts = rows.reduce((acc, row) => {
  acc[row.ownershipRecoveryDecision] = (acc[row.ownershipRecoveryDecision] || 0) + 1;
  return acc;
}, {});
const canonicalGuardSourceRecoveryBlocked = count((row) =>
  String(row.ownershipRecoveryDecision || "").startsWith("DO_NOT_RECOVER_CANONICAL_GUARD_SOURCE_RECOVERY_") ||
  (row.ownershipRecoveryDecision === "DO_NOT_RECOVER_NO_FRESH_GUARD_SOURCE" &&
    row.manualExternalAdoptionReview !== true &&
    row.ownershipClassification !== "EXTERNAL_OR_MANUAL_POSITION")
);
const unsafeUpstream =
  ownershipGuardGap?.executionPolicy?.brokerMutationAllowed === true ||
  ownershipGuardGap?.summary?.brokerMutationAttempted === true ||
  ownershipGuardGap?.summary?.brokerMutationSubmitted === true ||
  limitedMultiOcoRepairPlan?.executionPolicy?.brokerMutationAllowed === true ||
  limitedMultiOcoRepairPlan?.summary?.brokerMutationAttempted === true ||
  limitedMultiOcoRepairPlan?.summary?.brokerMutationSubmitted === true;
const overall = unsafeUpstream
  ? "blocked_unsafe_upstream_mutation_signal"
  : canonicalGuardSourceRecoveryBlocked > 0
    ? "blocked_canonical_guard_source_recovery_required"
    : count((row) => row.stateRecoveryReviewReady) > 0
      ? "state_recovery_review_ready"
    : count((row) => row.manualExternalAdoptionReview) > 0
      ? "manual_external_adoption_review_required"
      : "monitoring";

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "position_ownership_recovery_decision_report_only_symbol_agnostic",
  executionPolicy: {
    mode: "position_ownership_recovery_decision_report_only",
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    multiSubmitLaneAllowed: false,
    requiredStateApprovalPhrase: REQUIRED_STATE_APPROVAL_PHRASE,
    requiredBrokerApprovalPhrase: "CONFIRM LIVE EXECUTION",
    dryRunMayApplyRecovery: false
  },
  files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
  summary: {
    rows: rows.length,
    stateRecoveryReviewReady: count((row) => row.stateRecoveryReviewReady),
    manualExternalAdoptionReview: count((row) => row.manualExternalAdoptionReview),
    alreadyProtectedNoRecovery: count((row) => row.ownershipRecoveryDecision === "NO_RECOVERY_ALREADY_PROTECTED"),
    doNotAutoRecover: count((row) => String(row.ownershipRecoveryDecision).startsWith("DO_NOT")),
    repairEligibleAfterRecovery: count((row) => row.repairEligibleAfterRecovery),
    canonicalGuardSourceRecoveryMissing: count((row) => !row.canonicalGuardSourceRecoveryPresent),
    canonicalGuardSourceRecoveryBlocked,
    decisionCounts,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false
  },
  rows,
  doneWhen: [
    "external/manual rows without sidecar ownership proof are not auto-recovered",
    "guard-metadata-missing rows require fresh Stage6 or lifecycle stop/target source before recovery",
    "state recovery candidates require backup/diff/audit/post-verify and a separate state approval phrase",
    "canonical guard-source recovery must report repairEligibleNow=true before a state recovery candidate is produced",
    "multi planner remains report-only and no multi submit lane is authorized",
    "brokerMutationAllowed=false and stateMutationAllowed=false"
  ],
  nextAction: canonicalGuardSourceRecoveryBlocked > 0
    ? "rebuild canonical guard-source recovery evidence; do not route this block through external ownership adoption"
    : count((row) => row.stateRecoveryReviewReady) > 0
      ? "review state-only recovery candidates and run a separate approved state migration task only if needed"
    : count((row) => row.manualExternalAdoptionReview) > 0
      ? "do not recover automatically; require explicit external adoption evidence and fresh guard metadata first"
      : "monitor only"
};

const lines = [
  "## Position Ownership Recovery Decision",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- scope: \`${report.scope}\``,
  `- summary: \`rows=${report.summary.rows} stateReady=${report.summary.stateRecoveryReviewReady} externalAdoptionReview=${report.summary.manualExternalAdoptionReview} alreadyProtected=${report.summary.alreadyProtectedNoRecovery} doNotAutoRecover=${report.summary.doNotAutoRecover} repairEligibleAfterRecovery=${report.summary.repairEligibleAfterRecovery} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted} stateAttempted=${report.summary.stateMutationAttempted}\``,
  "- safety: `report-only; no broker mutation; no state mutation; no multi-submit lane; no external position adoption without explicit evidence`",
  "| Symbol | Recovery Decision | Source Class | Ownership Proof | Fresh Guard | State Ready | External Adoption Review | Required Evidence | Next Action |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
];
for (const row of rows) {
  lines.push(
    `| ${row.symbol} | ${row.ownershipRecoveryDecision} | ${row.sourceClassification || "N/A"} | ${row.proof.sidecarOwnershipProof ? "yes" : "no"} | ${row.hasFreshValidSource ? "yes" : "no"} | ${row.stateRecoveryReviewReady ? "yes" : "no"} | ${row.manualExternalAdoptionReview ? "yes" : "no"} | ${short(row.requiredEvidence.join(",") || "none", 180)} | ${short(row.nextAction, 180)} |`
  );
}
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[POSITION_OWNERSHIP_RECOVERY_DECISION] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} stateReady=${report.summary.stateRecoveryReviewReady} externalAdoption=${report.summary.manualExternalAdoptionReview} attempted=false submitted=false stateAttempted=false`);
