import fs from "node:fs";

const STATE_DIR = String(process.env.OPS_LANE_STATUS_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/ops-lane-status-report.json`;
const OUTPUT_MD = `${STATE_DIR}/ops-lane-status-report.md`;
const MAX_PREVIEW_AGE_MIN = Number(process.env.OPS_LANE_STATUS_MAX_PREVIEW_AGE_MIN || 1440);

const FILES = {
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  decisionAudit: `${STATE_DIR}/last-order-decision-audit.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`,
  positionProtectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  positionLifecycleGuardSourcePlan: `${STATE_DIR}/position-lifecycle-guard-source-plan.json`,
  guardMetadataRefreshPlan: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  guardMetadataLineageAudit: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  guardSourceRecoveryPlan: `${STATE_DIR}/guard-source-recovery-plan.json`,
  fillStateReconciliationAudit: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  brokerFillStateEvidence: `${STATE_DIR}/broker-fill-state-evidence.json`,
  ledgerTerminalizationProposal: `${STATE_DIR}/ledger-terminalization-proposal.json`,
  ledgerFilledMigrationPlan: `${STATE_DIR}/ledger-filled-migration-plan.json`,
  ledgerFilledMigrationApply: `${STATE_DIR}/ledger-filled-migration-apply-report.json`,
  persistentOcoRepairPlan: `${STATE_DIR}/persistent-oco-repair-plan.json`,
  highPriceMinOneShareCanaryPlan: `${STATE_DIR}/high-price-min-one-share-canary-plan.json`,
  entryRepricePolicyDecision: `${STATE_DIR}/entry-reprice-policy-decision.json`,
  openOrderRepriceProposal: `${STATE_DIR}/open-order-reprice-proposal.json`,
  limitedMultiOcoRepairPlan: `${STATE_DIR}/limited-multi-oco-repair-plan.json`,
  positionOwnershipGuardGapAudit: `${STATE_DIR}/position-ownership-guard-gap-audit.json`,
  positionOwnershipRecoveryDecision: `${STATE_DIR}/position-ownership-recovery-decision.json`,
  positionOwnershipRecoveryApprovalGate: `${STATE_DIR}/position-ownership-recovery-approval-gate.json`,
  positionOwnershipStateMigrationReviewPlan: `${STATE_DIR}/position-ownership-state-migration-review-plan.json`,
  multiOcoSubmitSafetyGate: `${STATE_DIR}/multi-oco-submit-safety-gate.json`,
  opsHealth: `${STATE_DIR}/ops-health-report.json`
};

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

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ageMinutes = (value) => {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60000);
};

const uniqueSymbols = (rows) =>
  Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();

const countRows = (rows, predicate) => (Array.isArray(rows) ? rows : []).filter(predicate).length;

const lane = ({ id, name, status, count, symbols, evidence, nextAction, safety }) => ({
  id,
  name,
  status,
  count: count ?? symbols?.length ?? 0,
  symbols: Array.isArray(symbols) ? symbols.slice(0, 20) : [],
  evidence: short(evidence, 500),
  nextAction: short(nextAction, 500),
  safety
});

const buildReport = () => {
  const preview = readJson(FILES.preview);
  const decisionAudit = readJson(FILES.decisionAudit);
  const fillability = readJson(FILES.fillability);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const positionProtectionAudit = readJson(FILES.positionProtectionAudit);
  const positionLifecycleGuardSourcePlan = readJson(FILES.positionLifecycleGuardSourcePlan);
  const guardMetadataRefreshPlan = readJson(FILES.guardMetadataRefreshPlan);
  const guardMetadataLineageAudit = readJson(FILES.guardMetadataLineageAudit);
  const guardSourceRecoveryPlan = readJson(FILES.guardSourceRecoveryPlan);
  const fillStateReconciliationAudit = readJson(FILES.fillStateReconciliationAudit);
  const brokerFillStateEvidence = readJson(FILES.brokerFillStateEvidence);
  const ledgerTerminalizationProposal = readJson(FILES.ledgerTerminalizationProposal);
  const ledgerFilledMigrationPlan = readJson(FILES.ledgerFilledMigrationPlan);
  const ledgerFilledMigrationApply = readJson(FILES.ledgerFilledMigrationApply);
  const persistentOcoRepairPlan = readJson(FILES.persistentOcoRepairPlan);
  const highPriceMinOneShareCanaryPlan = readJson(FILES.highPriceMinOneShareCanaryPlan);
  const entryRepricePolicyDecision = readJson(FILES.entryRepricePolicyDecision);
  const openOrderRepriceProposal = readJson(FILES.openOrderRepriceProposal);
  const limitedMultiOcoRepairPlan = readJson(FILES.limitedMultiOcoRepairPlan);
  const positionOwnershipGuardGapAudit = readJson(FILES.positionOwnershipGuardGapAudit);
  const positionOwnershipRecoveryDecision = readJson(FILES.positionOwnershipRecoveryDecision);
  const positionOwnershipRecoveryApprovalGate = readJson(FILES.positionOwnershipRecoveryApprovalGate);
  const positionOwnershipStateMigrationReviewPlan = readJson(FILES.positionOwnershipStateMigrationReviewPlan);
  const multiOcoSubmitSafetyGate = readJson(FILES.multiOcoSubmitSafetyGate);
  const opsHealth = readJson(FILES.opsHealth);

  const lineageRows = Array.isArray(guardMetadataLineageAudit?.rows) ? guardMetadataLineageAudit.rows : [];
  const guardRows = Array.isArray(guardMetadataRefreshPlan?.rows) ? guardMetadataRefreshPlan.rows : [];
  const guardSourceRows = Array.isArray(guardSourceRecoveryPlan?.rows) ? guardSourceRecoveryPlan.rows : [];
  const fillStateRows = Array.isArray(fillStateReconciliationAudit?.rows) ? fillStateReconciliationAudit.rows : [];
  const brokerEvidenceRows = Array.isArray(brokerFillStateEvidence?.rows) ? brokerFillStateEvidence.rows : [];
  const terminalizationRows = Array.isArray(ledgerTerminalizationProposal?.rows) ? ledgerTerminalizationProposal.rows : [];
  const filledMigrationRows = Array.isArray(ledgerFilledMigrationPlan?.rows) ? ledgerFilledMigrationPlan.rows : [];
  const filledMigrationApplyRows = Array.isArray(ledgerFilledMigrationApply?.rows) ? ledgerFilledMigrationApply.rows : [];
  const protectionRows = Array.isArray(positionProtectionAudit?.rows) ? positionProtectionAudit.rows : [];
  const lifecycleRows = Array.isArray(positionLifecycleGuardSourcePlan?.rows) ? positionLifecycleGuardSourcePlan.rows : [];
  const brokerRows = Array.isArray(brokerChildReconciliation?.rows) ? brokerChildReconciliation.rows : [];
  const persistentRows = Array.isArray(persistentOcoRepairPlan?.rows) ? persistentOcoRepairPlan.rows : [];
  const entryRepriceRows = Array.isArray(entryRepricePolicyDecision?.rows) ? entryRepricePolicyDecision.rows : [];
  const repriceRows = Array.isArray(openOrderRepriceProposal?.rows) ? openOrderRepriceProposal.rows : [];
  const orderDecisionRecords = Array.isArray(decisionAudit?.records)
    ? decisionAudit.records
    : Array.isArray(preview?.orderDecisionAudit?.records)
      ? preview.orderDecisionAudit.records
      : [];
  const previewAgeMin = ageMinutes(preview?.generatedAt);
  const previewStale = previewAgeMin != null && Number.isFinite(MAX_PREVIEW_AGE_MIN) && previewAgeMin > MAX_PREVIEW_AGE_MIN;
  const decisionAuditMissing = orderDecisionRecords.length === 0;

  const missingGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_NO_REFRESH_SOURCE");
  const staleGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_STALE");
  const invalidGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY");
  const missingLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_MISSING_NO_SOURCE");
  const staleLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_STALE_SOURCE_ONLY");
  const invalidLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_INVALID_GEOMETRY");
  const invalidProtectionRows = protectionRows.filter(
    (row) =>
      row.invalidGeometry === true ||
      row.stopCurrentDrift === true ||
      row.geometry?.valid === false ||
      row.geometry?.stopAboveOrAtCurrent === true ||
      row.geometry?.targetBelowOrAtCurrent === true ||
      row.geometry?.targetBelowOrAtStop === true
  );
  const brokerChildrenPresentRows = guardRows.filter(
    (row) => row.broker?.stopPresent === true && row.broker?.targetPresent === true
  );
  const repairAfterRefreshRows = guardRows.filter(
    (row) => row.afterRefreshRepairDecision === "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"
  );
  const freshSourceRequiredRows = guardSourceRows.filter((row) =>
    String(row.recoveryDecision || "").startsWith("FRESH_SOURCE_REQUIRED")
  );
  const fillStateReconciliationRows = fillStateRows.filter((row) => row.requiresLedgerTerminalizationReview === true);
  const terminalizationReadyRows = terminalizationRows.filter((row) => row.proposalReady === true);
  const terminalizationBlockedRows = terminalizationRows.filter((row) => row.proposalReady !== true);
  const filledMigrationReadyRows = filledMigrationRows.filter((row) => row.readyForApplyReview === true);
  const filledMigrationBlockedRows = filledMigrationRows.filter((row) => row.readyForApplyReview !== true);
  const filledMigrationAppliedRows = filledMigrationApplyRows.filter((row) => row.stateMutationApplied === true);
  const fillTerminalizationOpen =
    fillStateReconciliationRows.length > 0 ||
    terminalizationBlockedRows.length > 0 ||
    terminalizationReadyRows.length > 0 ||
    filledMigrationReadyRows.length > 0 ||
    filledMigrationBlockedRows.length > 0;
  const filledMigrationAppliedNeedsReaudit = filledMigrationAppliedRows.length > 0 && fillTerminalizationOpen;
  const repairPrereqFillBlocked = fillTerminalizationOpen || filledMigrationAppliedNeedsReaudit;
  const repairPrereqFreshBlocked = freshSourceRequiredRows.length > 0;
  const lifecycleReadyRows = lifecycleRows.filter((row) => row.lifecycleReady === true);
  const persistentEligibleRows = persistentRows.filter(
    (row) => row.eligible === true || row.readiness === "PERSISTENT_REPAIR_READY_FOR_APPROVAL"
  );
  const brokerMissingRows = brokerRows.filter(
    (row) =>
      row.brokerStopPresent === false ||
      row.brokerTargetPresent === false ||
      row.missingStopChild === true ||
      row.missingTargetChild === true
  );
  const repairCandidateSymbols = uniqueSymbols([...repairAfterRefreshRows, ...persistentEligibleRows, ...lifecycleReadyRows]);
  const repairLaneSymbols = repairCandidateSymbols.length
    ? repairCandidateSymbols
    : uniqueSymbols([...brokerMissingRows]);
  const openRepriceReadyRows = repriceRows.filter((row) => row.readyForApproval === true);
  const entryRepriceReadyRows = entryRepriceRows.filter((row) => row.policyDecision === "ENTRY_REPRICE_REVIEW_READY");
  const entryRepriceWaitRows = entryRepriceRows.filter((row) => String(row.policyDecision || "").startsWith("WAIT_PULLBACK"));
  const openRepriceReadyCount =
    toNum(openOrderRepriceProposal?.summary?.readyForApproval) ?? openRepriceReadyRows.length;
  const entryRepriceReadyCount =
    toNum(entryRepricePolicyDecision?.summary?.entryRepriceReviewReady) ?? entryRepriceReadyRows.length;
  const entryRepriceWaitCount =
    toNum(entryRepricePolicyDecision?.summary?.waitPullbackRows) ?? entryRepriceWaitRows.length;
  const limitedMultiSelectedCount = toNum(limitedMultiOcoRepairPlan?.summary?.selected) ?? 0;
  const limitedMultiEligibleCount = toNum(limitedMultiOcoRepairPlan?.summary?.eligible) ?? 0;
  const limitedMultiSelectedSymbols = Array.isArray(limitedMultiOcoRepairPlan?.summary?.selectedSymbols)
    ? limitedMultiOcoRepairPlan.summary.selectedSymbols
    : [];
  const limitedMultiUnsafe =
    limitedMultiOcoRepairPlan?.executionPolicy?.brokerMutationAllowed === true ||
    limitedMultiOcoRepairPlan?.summary?.brokerMutationAttempted === true ||
    limitedMultiOcoRepairPlan?.summary?.brokerMutationSubmitted === true;
  const ownershipGuardRows = Array.isArray(positionOwnershipGuardGapAudit?.rows)
    ? positionOwnershipGuardGapAudit.rows
    : [];
  const ownershipGuardUnsafe =
    positionOwnershipGuardGapAudit?.executionPolicy?.brokerMutationAllowed === true ||
    positionOwnershipGuardGapAudit?.summary?.brokerMutationAttempted === true ||
    positionOwnershipGuardGapAudit?.summary?.brokerMutationSubmitted === true;
  const ownershipGuardRootCauseRows = ownershipGuardRows.filter((row) =>
    [
      "external_position_and_guard_metadata_missing",
      "external_position_ownership_review",
      "guard_metadata_missing_source_gap"
    ].includes(String(row?.classification || ""))
  );
  const ownershipGuardManualRows = ownershipGuardRows.filter((row) => row?.classification === "manual_approval_candidate");
  const ownershipRecoveryRows = Array.isArray(positionOwnershipRecoveryDecision?.rows)
    ? positionOwnershipRecoveryDecision.rows
    : [];
  const ownershipRecoveryUnsafe =
    positionOwnershipRecoveryDecision?.executionPolicy?.brokerMutationAllowed === true ||
    positionOwnershipRecoveryDecision?.executionPolicy?.brokerMutationAttempted === true ||
    positionOwnershipRecoveryDecision?.executionPolicy?.brokerMutationSubmitted === true ||
    positionOwnershipRecoveryDecision?.executionPolicy?.stateMutationAllowed === true ||
    positionOwnershipRecoveryDecision?.executionPolicy?.stateMutationAttempted === true ||
    positionOwnershipRecoveryDecision?.summary?.brokerMutationAttempted === true ||
    positionOwnershipRecoveryDecision?.summary?.brokerMutationSubmitted === true ||
    positionOwnershipRecoveryDecision?.summary?.stateMutationAttempted === true ||
    positionOwnershipRecoveryDecision?.summary?.stateMutationApplied === true;
  const ownershipRecoveryStateReadyRows = ownershipRecoveryRows.filter(
    (row) => row?.stateRecoveryReviewReady === true
  );
  const ownershipRecoveryExternalAdoptionRows = ownershipRecoveryRows.filter(
    (row) => row?.manualExternalAdoptionReview === true
  );
  const ownershipRecoveryDoNotAutoRows = ownershipRecoveryRows.filter((row) =>
    String(row?.ownershipRecoveryDecision || "").startsWith("DO_NOT")
  );
  const ownershipRecoveryGateUnsafe =
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.brokerMutationAllowed === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.brokerMutationAttempted === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.brokerMutationSubmitted === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.stateMutationAllowed === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.stateMutationAttempted === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.stateMutationApplied === true ||
    positionOwnershipRecoveryApprovalGate?.executionPolicy?.multiSubmitLaneAllowed === true ||
    positionOwnershipRecoveryApprovalGate?.summary?.brokerMutationAttempted === true ||
    positionOwnershipRecoveryApprovalGate?.summary?.brokerMutationSubmitted === true ||
    positionOwnershipRecoveryApprovalGate?.summary?.stateMutationAttempted === true ||
    positionOwnershipRecoveryApprovalGate?.summary?.stateMutationApplied === true;
  const ownershipStateMigrationUnsafe =
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.brokerMutationAllowed === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.brokerMutationAttempted === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.stateMutationAllowed === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.stateMutationAttempted === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.stateMutationApplied === true ||
    positionOwnershipStateMigrationReviewPlan?.executionPolicy?.multiSubmitLaneAllowed === true ||
    positionOwnershipStateMigrationReviewPlan?.summary?.brokerMutationAttempted === true ||
    positionOwnershipStateMigrationReviewPlan?.summary?.brokerMutationSubmitted === true ||
    positionOwnershipStateMigrationReviewPlan?.summary?.stateMutationAttempted === true ||
    positionOwnershipStateMigrationReviewPlan?.summary?.stateMutationApplied === true;
  const multiOcoSubmitGateUnsafe =
    multiOcoSubmitSafetyGate?.executionPolicy?.brokerMutationAllowed === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.brokerMutationAttempted === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.brokerMutationSubmitted === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.stateMutationAllowed === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.stateMutationAttempted === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.stateMutationApplied === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.multiSubmitLaneAllowed === true ||
    multiOcoSubmitSafetyGate?.executionPolicy?.dryRunMaySubmitMulti === true ||
    multiOcoSubmitSafetyGate?.summary?.brokerMutationAttempted === true ||
    multiOcoSubmitSafetyGate?.summary?.brokerMutationSubmitted === true ||
    multiOcoSubmitSafetyGate?.summary?.stateMutationAttempted === true ||
    multiOcoSubmitSafetyGate?.summary?.stateMutationApplied === true ||
    multiOcoSubmitSafetyGate?.summary?.multiSubmitAuthorized === true;
  const combinedRepriceApprovalReady = openRepriceReadyCount > 0 && entryRepriceReadyCount > 0;
  const highPriceSkippedRows = orderDecisionRecords.filter((row) =>
    String(row?.reason || "").includes("entry_notional_below_limit_price")
  );
  const minOneShareSelectedSymbol = asSymbol(highPriceMinOneShareCanaryPlan?.summary?.selectedSymbol);
  const minOneShareEligible = toNum(highPriceMinOneShareCanaryPlan?.summary?.eligible) ?? 0;
  const minOneShareApprovalOverall = highPriceMinOneShareCanaryPlan?.approvalGate?.overall || "N/A";
  const minOneShareApprovalReady =
    highPriceMinOneShareCanaryPlan?.approvalGate?.readyForSafePayloadProbe === true ||
    highPriceMinOneShareCanaryPlan?.summary?.approvalCandidateReady === true;
  const minOneShareFutureAutoEligible =
    highPriceMinOneShareCanaryPlan?.approvalGate?.readyForFuturePaperAutoSubmit === true ||
    highPriceMinOneShareCanaryPlan?.summary?.readyForFuturePaperAutoSubmit === true;
  const minOneShareLaneStatus = minOneShareFutureAutoEligible
    ? "auto_eligible_report_only"
    : minOneShareApprovalOverall === "manual_review_required"
      ? "manual_review_required"
      : highPriceSkippedRows.length || highPriceMinOneShareCanaryPlan?.overall === "blocked"
        ? "blocked"
        : "clear";
  const payloadCount = toNum(preview?.payloadCount) ?? 0;
  const brokerAttempted = toNum(preview?.brokerSubmission?.attempted) ?? 0;
  const brokerSubmitted = toNum(preview?.brokerSubmission?.submitted) ?? 0;
  let openOrderRepriceLaneStatus = openOrderRepriceProposal?.overall || "unknown";
  let openOrderRepriceNextAction =
    "Keep report-only monitoring until an open order exists and passes risk-capped policy.";
  if (openOrderRepriceProposal?.overall === "no_open_orders") {
    openOrderRepriceLaneStatus = "no_open_orders";
  } else if (combinedRepriceApprovalReady) {
    openOrderRepriceLaneStatus = "manual_replace_approval_candidate";
    openOrderRepriceNextAction = "Require separate approval before any guarded replace.";
  } else if (openRepriceReadyCount > 0 && entryRepriceReadyCount <= 0) {
    openOrderRepriceLaneStatus = "wait_entry_policy_alignment";
    openOrderRepriceNextAction =
      "Do not request replace approval yet; wait until entry/reprice policy also reports ENTRY_REPRICE_REVIEW_READY.";
  } else if (entryRepriceReadyCount > 0 && openRepriceReadyCount <= 0) {
    openOrderRepriceLaneStatus = "wait_open_order_reprice_ready";
    openOrderRepriceNextAction =
      "Do not request replace approval yet; wait until open-order risk-capped proposal is ready.";
  }

  const lanes = [
    lane({
      id: "track_1_guard_metadata_missing",
      name: "Guard Metadata Missing Lane",
      status: missingGuardRows.length || missingLineageRows.length ? "blocked_root_cause_required" : "clear",
      symbols: uniqueSymbols([...missingGuardRows, ...missingLineageRows]),
      evidence: `guardRefresh=${guardMetadataRefreshPlan?.overall || "N/A"} noSource=${guardMetadataRefreshPlan?.summary?.noRefreshSource ?? "N/A"} lineage=${guardMetadataLineageAudit?.overall || "N/A"} lineageMissing=${guardMetadataLineageAudit?.summary?.missingNoSource ?? "N/A"}`,
      nextAction: missingGuardRows.length || missingLineageRows.length
        ? "Trace missing stop/target lineage through recommendation ledger, Stage6 loop, order ledger, and fillability state."
        : "No missing guard metadata lane action required.",
      safety: "report_only_no_broker_or_state_mutation"
    }),
    lane({
      id: "track_2_guard_metadata_stale",
      name: "Guard Metadata Stale Lane",
      status: staleGuardRows.length || staleLineageRows.length ? "waiting_fresh_guard_source" : "clear",
      symbols: uniqueSymbols([...staleGuardRows, ...staleLineageRows]),
      evidence: `guardRefresh=${guardMetadataRefreshPlan?.overall || "N/A"} staleSource=${guardMetadataRefreshPlan?.summary?.staleRefreshSource ?? "N/A"} lifecycle=${positionLifecycleGuardSourcePlan?.overall || "N/A"} lifecycleReady=${positionLifecycleGuardSourcePlan?.summary?.lifecycleReady ?? "N/A"} lineage=${guardMetadataLineageAudit?.overall || "N/A"} lineageStale=${guardMetadataLineageAudit?.summary?.staleSourceOnly ?? "N/A"}`,
      nextAction: staleGuardRows.length || staleLineageRows.length
        ? "Wait for fresh Stage6/position-lifecycle/order-ledger source before repair re-evaluation."
        : "No stale guard metadata lane action required.",
      safety: "report_only_no_broker_or_state_mutation"
    }),
    lane({
      id: "track_3_broker_children_present_monitor",
      name: "Broker Children Present Monitor Lane",
      status: brokerChildrenPresentRows.length ? "monitor_only" : "no_current_rows",
      symbols: uniqueSymbols(brokerChildrenPresentRows),
      evidence: `brokerChildrenSourceReady=${guardMetadataRefreshPlan?.summary?.brokerChildrenSourceReady ?? "N/A"}`,
      nextAction: "Continue GET-only nested visibility monitoring; do not create duplicate OCO children.",
      safety: "get_only_monitor_no_broker_mutation"
    }),
    lane({
      id: "track_4_fill_state_terminalization",
      name: "Fill-State Terminalization Lane",
      status:
        filledMigrationAppliedRows.length > 0 && !fillTerminalizationOpen
          ? "filled_migration_applied_reaudit_clear"
          : filledMigrationAppliedRows.length > 0
          ? "filled_migration_applied_pending_reaudit"
          : filledMigrationReadyRows.length > 0
          ? "manual_filled_migration_apply_review_ready"
          : terminalizationReadyRows.length > 0
            ? "manual_state_migration_review_ready"
          : fillStateReconciliationRows.length > 0
            ? brokerEvidenceRows.length > 0
              ? "blocked_no_terminalization_proposal"
              : "blocked_broker_evidence_required"
            : "clear",
      count: fillStateReconciliationRows.length || terminalizationRows.length || filledMigrationRows.length || filledMigrationApplyRows.length,
      symbols: uniqueSymbols([...fillStateReconciliationRows, ...brokerEvidenceRows, ...terminalizationRows, ...filledMigrationRows, ...filledMigrationApplyRows]),
      evidence: `fillState=${fillStateReconciliationAudit?.overall || "N/A"} terminalReview=${fillStateReconciliationAudit?.summary?.ledgerTerminalizationReviewRequired ?? "N/A"} brokerEvidence=${brokerFillStateEvidence?.overall || "N/A"} readAttempted=${brokerFillStateEvidence?.summary?.brokerReadAttempted ?? "N/A"} terminalization=${ledgerTerminalizationProposal?.overall || "N/A"} ready=${ledgerTerminalizationProposal?.summary?.proposalReady ?? "N/A"} blocked=${ledgerTerminalizationProposal?.summary?.blocked ?? "N/A"} filledMigration=${ledgerFilledMigrationPlan?.overall || "N/A"} migrationReady=${ledgerFilledMigrationPlan?.summary?.readyForApplyReview ?? "N/A"} migrationBlocked=${ledgerFilledMigrationPlan?.summary?.blocked ?? "N/A"} apply=${ledgerFilledMigrationApply?.overall || "N/A"} applied=${ledgerFilledMigrationApply?.summary?.stateMutationApplied ?? "N/A"} postVerified=${ledgerFilledMigrationApply?.summary?.postVerifiedRows ?? "N/A"}`,
      nextAction:
        filledMigrationAppliedRows.length > 0 && !fillTerminalizationOpen
          ? "Fill-state terminalization is clear after state migration; move to fresh guard source recovery and keep repair blocked while stale/missing guard source remains."
          : filledMigrationAppliedRows.length > 0
          ? "Rerun fill-state reconciliation, broker evidence, terminalization proposal, guard source recovery, and lane status before any repair re-entry."
          : filledMigrationReadyRows.length > 0
          ? "Review backup/diff/audit previews. Applying the migration requires a separate scoped state migration task; keep repair blocked until applied and re-audited."
          : terminalizationReadyRows.length > 0
          ? "Review report-only ledger/idempotency terminalization patch preview; applying it requires a separate scoped state migration task."
          : fillStateReconciliationRows.length > 0
            ? "Run/inspect broker GET-only fill-state evidence until filled/terminal status is proven; keep protective repair blocked."
            : "No fill-state terminalization lane action required.",
      safety: "report_only_no_broker_or_ledger_mutation"
    }),
    lane({
      id: "track_4_valid_guard_missing_child_repair_candidate",
      name: "Valid Guard + Missing Child Repair Candidate Lane",
      status:
        repairPrereqFillBlocked && repairPrereqFreshBlocked
          ? "blocked_mixed_fill_state_and_fresh_source_prerequisites"
          : repairPrereqFillBlocked
            ? "blocked_fill_state_reconciliation_required"
            : repairPrereqFreshBlocked
            ? "blocked_waiting_fresh_guard_source"
            : repairAfterRefreshRows.length || persistentEligibleRows.length
          ? "manual_approval_candidate"
          : brokerMissingRows.length
            ? "blocked_until_guard_refresh_valid"
            : "no_candidate",
      count: repairAfterRefreshRows.length || persistentEligibleRows.length || brokerMissingRows.length,
      symbols: repairLaneSymbols,
      evidence: `repairAfterRefresh=${guardMetadataRefreshPlan?.summary?.repairReevaluationCandidates ?? "N/A"} lifecycleReady=${positionLifecycleGuardSourcePlan?.summary?.lifecycleReady ?? "N/A"} persistentEligible=${persistentOcoRepairPlan?.summary?.eligible ?? "N/A"} brokerChildActions=${brokerChildReconciliation?.summary?.proposedActionRows ?? "N/A"} freshSourceRequired=${guardSourceRecoveryPlan?.summary?.freshSourceRequired ?? "N/A"} fillTerminalReview=${fillStateReconciliationAudit?.summary?.ledgerTerminalizationReviewRequired ?? "N/A"} terminalizationBlocked=${ledgerTerminalizationProposal?.summary?.blocked ?? "N/A"}`,
      nextAction:
        repairPrereqFillBlocked && repairPrereqFreshBlocked
          ? "Do not re-enter protective repair. Split prerequisites: resolve fill-state terminalization rows and wait for fresh guard source rows separately."
          : repairPrereqFillBlocked
            ? "Do not re-enter protective repair; fill-state terminalization must be resolved first."
            : repairPrereqFreshBlocked
            ? "Do not re-enter protective repair; wait for fresh Stage6 or position-lifecycle guard source."
            : repairAfterRefreshRows.length || persistentEligibleRows.length
          ? "Require separate approval before any paper repair submit."
          : "Do not submit repair until guard metadata is fresh and geometry-valid.",
      safety: "approval_required_for_any_broker_mutation"
    }),
    lane({
      id: "track_5_invalid_geometry_root_cause",
      name: "Invalid Geometry Root-Cause Lane",
      status: invalidGuardRows.length || invalidProtectionRows.length || invalidLineageRows.length ? "root_cause_required" : "clear",
      count: invalidGuardRows.length + invalidProtectionRows.length + invalidLineageRows.length,
      symbols: uniqueSymbols([...invalidGuardRows, ...invalidProtectionRows, ...invalidLineageRows]),
      evidence: `guardInvalid=${guardMetadataRefreshPlan?.summary?.invalidRefreshGeometry ?? "N/A"} protectionInvalid=${positionProtectionAudit?.summary?.invalidGeometry ?? "N/A"} lineageInvalid=${guardMetadataLineageAudit?.summary?.invalidGeometry ?? "N/A"} stopDrift=${positionProtectionAudit?.summary?.stopCurrentDrift ?? "N/A"}`,
      nextAction:
        invalidGuardRows.length || invalidProtectionRows.length || invalidLineageRows.length
          ? "Route to Stage6/guard metadata drift analysis; broker repair is blocked."
          : "No invalid geometry lane action required.",
      safety: "repair_blocked_when_geometry_invalid"
    }),
    lane({
      id: "track_6_open_order_risk_capped_reprice",
      name: "Open Order Risk-Capped Reprice Lane",
      status: openOrderRepriceLaneStatus,
      count: repriceRows.length,
      symbols: uniqueSymbols([...repriceRows, ...entryRepriceRows]),
      evidence: `entryOverall=${entryRepricePolicyDecision?.overall || "N/A"} entryReady=${entryRepriceReadyCount} entryWait=${entryRepriceWaitCount} openOverall=${openOrderRepriceProposal?.overall || "N/A"} openRows=${openOrderRepriceProposal?.summary?.rows ?? "N/A"} openReady=${openRepriceReadyCount} riskBreaches=${openOrderRepriceProposal?.summary?.suggestedRiskCapBreaches ?? "N/A"} attempted=${openOrderRepriceProposal?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${openOrderRepriceProposal?.summary?.brokerMutationSubmitted ?? "N/A"}`,
      nextAction: openOrderRepriceNextAction,
      safety: "report_only_no_replace_or_cancel"
    }),
    lane({
      id: "track_7_new_order_fillability_submit_path",
      name: "New Order / Fillability / Submit Path Lane",
      status:
        previewStale
          ? "stale_preview_wait_fresh_rth"
          : decisionAuditMissing
            ? "missing_decision_audit_wait_fresh_rth"
            : payloadCount > 0
              ? brokerSubmitted > 0
                ? "submitted"
                : brokerAttempted > 0
                  ? "attempted_not_submitted"
                  : "payload_ready_not_submitted"
              : minOneShareSelectedSymbol
                ? minOneShareApprovalReady
                  ? "manual_min_one_share_policy_approval_candidate"
                  : "safe_min_one_share_payload_probe_candidate"
                : highPriceSkippedRows.length
                  ? "blocked_high_price_sizing"
                  : "blocked_before_payload",
      count: orderDecisionRecords.length,
      symbols: uniqueSymbols(orderDecisionRecords),
      evidence: `previewAgeMin=${previewAgeMin == null ? "N/A" : previewAgeMin.toFixed(1)} maxPreviewAgeMin=${MAX_PREVIEW_AGE_MIN} decisionAuditRows=${orderDecisionRecords.length} payloads=${payloadCount} skipped=${preview?.skippedCount ?? "N/A"} brokerAttempted=${brokerAttempted} brokerSubmitted=${brokerSubmitted} readiness=${short(preview?.orderReadiness, 240)} highPriceSkipped=${highPriceSkippedRows.length} minOneShareEligible=${minOneShareEligible} selected=${minOneShareSelectedSymbol || "N/A"} minOneShareApproval=${minOneShareApprovalOverall} fillability=${fillability?.summary?.overall || "N/A"}`,
      nextAction:
        previewStale
          ? "Wait for the next fresh RTH sidecar run before interpreting payload readiness or broker-submit route state."
          : decisionAuditMissing
            ? "Require last-order-decision-audit.json from the next sidecar run before classifying payload/topSkip routes."
            : payloadCount > 0
              ? "Verify preflight/idempotency/broker visibility according to approval scope."
              : minOneShareSelectedSymbol
                ? "Review high-price min_one_share policy scope, then run safe dry-run admission probe only; keep broker mutation disabled and verify payload generation."
                : highPriceSkippedRows.length
                  ? "Review high-price sizing policy/min-one-share constraints before tuning entry logic."
                  : "Route to orderReadiness/topSkip/fillability blocker classification.",
      safety: "safe_default_keeps_broker_submission_disabled_unless_approved"
    }),
    lane({
      id: "track_7b_high_price_min_one_share_policy_review",
      name: "High-Price Min-One-Share Policy Review Lane",
      status: minOneShareLaneStatus,
      count: minOneShareEligible || highPriceSkippedRows.length,
      symbols: minOneShareSelectedSymbol ? [minOneShareSelectedSymbol] : uniqueSymbols(highPriceSkippedRows),
      evidence: `overall=${highPriceMinOneShareCanaryPlan?.overall || "N/A"} approval=${minOneShareApprovalOverall} eligible=${minOneShareEligible} selected=${minOneShareSelectedSymbol || "N/A"} futureAuto=${minOneShareFutureAutoEligible} readyForSafeProbe=${minOneShareApprovalReady} readyForBrokerSubmit=${highPriceMinOneShareCanaryPlan?.approvalGate?.readyForBrokerSubmit ?? "N/A"} brokerAttempted=${highPriceMinOneShareCanaryPlan?.summary?.brokerMutationAttempted ?? "N/A"} brokerSubmitted=${highPriceMinOneShareCanaryPlan?.summary?.brokerMutationSubmitted ?? "N/A"}`,
      nextAction: minOneShareFutureAutoEligible
        ? "Report-only checks passed; paper broker submit still needs a separate CONFIRM LIVE EXECUTION scope."
        : minOneShareApprovalReady
        ? "Manual policy review may run a safe min_one_share payload probe only. Broker submit remains unauthorized until a separate CONFIRM LIVE EXECUTION scope."
        : highPriceSkippedRows.length
          ? "Keep default skip until one-share notional/risk caps prove feasible."
          : "No high-price sizing lane action required.",
      safety: "report_only_no_broker_or_state_mutation_default_policy_skip"
    }),
    lane({
      id: "track_8_limited_multi_oco_repair_planner",
      name: "Limited Multi Persistent OCO Repair Planner Lane",
      status: limitedMultiUnsafe
        ? "blocked_unsafe_mutation_signal"
        : limitedMultiSelectedCount > 0
          ? "manual_batch_approval_candidate"
          : limitedMultiOcoRepairPlan?.overall === "blocked_no_eligible_row"
            ? "no_eligible_row"
            : limitedMultiOcoRepairPlan?.overall || "unknown",
      count: toNum(limitedMultiOcoRepairPlan?.summary?.rows) ?? 0,
      symbols: limitedMultiSelectedSymbols.length
        ? limitedMultiSelectedSymbols
        : uniqueSymbols(limitedMultiOcoRepairPlan?.rows || []),
      evidence: `overall=${limitedMultiOcoRepairPlan?.overall || "N/A"} eligible=${limitedMultiEligibleCount} selected=${limitedMultiSelectedCount} alreadyProtected=${limitedMultiOcoRepairPlan?.summary?.alreadyProtectedNoAction ?? "N/A"} ownershipReview=${limitedMultiOcoRepairPlan?.summary?.positionOwnershipReviewRequired ?? "N/A"} guardMissing=${limitedMultiOcoRepairPlan?.summary?.guardMetadataMissing ?? "N/A"} attempted=${limitedMultiOcoRepairPlan?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${limitedMultiOcoRepairPlan?.summary?.brokerMutationSubmitted ?? "N/A"}`,
      nextAction: limitedMultiSelectedCount > 0
        ? "Review selected batch candidates only; any broker mutation still requires a separate exact approval and submit lane."
        : "No multi-repair submit action. Monitor protected rows and keep ownership/guard-missing rows on root-cause lanes.",
      safety: "report_only_no_multi_submit_no_broker_mutation"
    }),
    lane({
      id: "track_9_position_ownership_guard_gap",
      name: "Position Ownership + Guard Metadata Gap Lane",
      status: ownershipGuardUnsafe
        ? "blocked_unsafe_mutation_signal"
        : ownershipGuardManualRows.length > 0
          ? "manual_approval_candidate"
          : ownershipGuardRootCauseRows.length > 0
            ? "root_cause_review_required"
            : positionOwnershipGuardGapAudit?.overall || "unknown",
      count: ownershipGuardRows.length,
      symbols: uniqueSymbols(ownershipGuardRootCauseRows.length ? ownershipGuardRootCauseRows : ownershipGuardRows),
      evidence: `overall=${positionOwnershipGuardGapAudit?.overall || "N/A"} protected=${positionOwnershipGuardGapAudit?.summary?.alreadyProtectedNoAction ?? "N/A"} externalAndGuardMissing=${positionOwnershipGuardGapAudit?.summary?.externalPositionAndGuardMissing ?? "N/A"} ownershipReview=${positionOwnershipGuardGapAudit?.summary?.externalPositionOwnershipReview ?? "N/A"} guardMissing=${positionOwnershipGuardGapAudit?.summary?.guardMetadataMissingSourceGap ?? "N/A"} repairEligible=${positionOwnershipGuardGapAudit?.summary?.repairEligible ?? "N/A"} multiEligible=${positionOwnershipGuardGapAudit?.summary?.multiPlannerEligible ?? "N/A"} attempted=${positionOwnershipGuardGapAudit?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${positionOwnershipGuardGapAudit?.summary?.brokerMutationSubmitted ?? "N/A"}`,
      nextAction: ownershipGuardRootCauseRows.length > 0
        ? "Resolve position ownership evidence and fresh guard source gaps before any repair approval."
        : "No ownership/guard source gap action required; keep monitor-only rows separate from repair lanes.",
      safety: "report_only_no_broker_or_state_mutation"
    }),
    lane({
      id: "track_10_position_ownership_recovery_decision",
      name: "Position Ownership Recovery Decision Lane",
      status: ownershipRecoveryUnsafe
        ? "blocked_unsafe_mutation_signal"
        : ownershipRecoveryStateReadyRows.length > 0
          ? "state_recovery_review_ready"
          : ownershipRecoveryExternalAdoptionRows.length > 0
            ? "manual_external_adoption_review_required"
            : positionOwnershipRecoveryDecision?.overall || "unknown",
      count: ownershipRecoveryRows.length,
      symbols: uniqueSymbols(
        ownershipRecoveryStateReadyRows.length || ownershipRecoveryExternalAdoptionRows.length
          ? [...ownershipRecoveryStateReadyRows, ...ownershipRecoveryExternalAdoptionRows]
          : ownershipRecoveryRows
      ),
      evidence: `overall=${positionOwnershipRecoveryDecision?.overall || "N/A"} stateReady=${positionOwnershipRecoveryDecision?.summary?.stateRecoveryReviewReady ?? "N/A"} externalAdoption=${positionOwnershipRecoveryDecision?.summary?.manualExternalAdoptionReview ?? "N/A"} doNotAutoRecover=${positionOwnershipRecoveryDecision?.summary?.doNotAutoRecover ?? "N/A"} repairEligibleAfterRecovery=${positionOwnershipRecoveryDecision?.summary?.repairEligibleAfterRecovery ?? "N/A"} attempted=${positionOwnershipRecoveryDecision?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${positionOwnershipRecoveryDecision?.summary?.brokerMutationSubmitted ?? "N/A"} stateAttempted=${positionOwnershipRecoveryDecision?.summary?.stateMutationAttempted ?? "N/A"}`,
      nextAction: ownershipRecoveryUnsafe
        ? "Stop: ownership recovery decision lane emitted a mutation signal, which is forbidden in this report-only path."
        : ownershipRecoveryStateReadyRows.length > 0
          ? "Prepare a separate state-only recovery migration review with backup, diff, audit, and post-verify; do not mutate state from dry-run."
          : ownershipRecoveryExternalAdoptionRows.length > 0 || ownershipRecoveryDoNotAutoRows.length > 0
            ? "Do not auto-adopt external/manual positions. Require sidecar ownership proof and fresh guard source before any state-only recovery review."
            : "Monitor only; keep broker repair and state recovery separated.",
      safety: "report_only_no_broker_or_state_mutation_no_multi_submit"
    }),
    lane({
      id: "track_11_position_ownership_recovery_approval_gate",
      name: "Position Ownership Recovery Approval Gate Lane",
      status: ownershipRecoveryGateUnsafe
        ? "blocked_unsafe_mutation_signal"
        : positionOwnershipRecoveryApprovalGate?.overall || "unknown",
      count: positionOwnershipRecoveryApprovalGate?.summary?.rows ?? 0,
      symbols: [
        ...new Set([
          ...(positionOwnershipRecoveryApprovalGate?.symbols?.stateReady || []),
          ...(positionOwnershipRecoveryApprovalGate?.symbols?.externalAdoptionReview || []),
          ...(positionOwnershipRecoveryApprovalGate?.symbols?.doNotAutoRecover || [])
        ])
      ].sort(),
      evidence: `overall=${positionOwnershipRecoveryApprovalGate?.overall || "N/A"} stateReady=${positionOwnershipRecoveryApprovalGate?.summary?.stateRecoveryReviewReady ?? "N/A"} externalAdoption=${positionOwnershipRecoveryApprovalGate?.summary?.manualExternalAdoptionReview ?? "N/A"} doNotAutoRecover=${positionOwnershipRecoveryApprovalGate?.summary?.doNotAutoRecover ?? "N/A"} approvalProvided=${positionOwnershipRecoveryApprovalGate?.summary?.approvalProvided ?? "N/A"} attempted=${positionOwnershipRecoveryApprovalGate?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${positionOwnershipRecoveryApprovalGate?.summary?.brokerMutationSubmitted ?? "N/A"} stateAttempted=${positionOwnershipRecoveryApprovalGate?.summary?.stateMutationAttempted ?? "N/A"} stateApplied=${positionOwnershipRecoveryApprovalGate?.summary?.stateMutationApplied ?? "N/A"}`,
      nextAction: ownershipRecoveryGateUnsafe
        ? "Stop: recovery approval gate emitted a mutation signal, which is forbidden in this report-only path."
        : positionOwnershipRecoveryApprovalGate?.overall === "blocked_external_adoption_evidence_required"
          ? "Do not auto-recover external/manual rows. Wait for sidecar ownership proof and fresh guard source before any state approval review."
          : positionOwnershipRecoveryApprovalGate?.overall === "manual_state_approval_required"
            ? "A separate state-only migration review may be requested only with exact CONFIRM STATE OWNERSHIP RECOVERY and backup/diff/audit/post-verify scope."
            : "Monitor only; no broker repair and no state migration are authorized by this dry-run gate.",
      safety: "report_only_no_state_apply_no_broker_mutation_no_multi_submit"
    }),
    lane({
      id: "track_12_position_ownership_state_migration_review",
      name: "Position Ownership State Migration Review Plan Lane",
      status: ownershipStateMigrationUnsafe
        ? "blocked_unsafe_mutation_signal"
        : positionOwnershipStateMigrationReviewPlan?.overall || "unknown",
      count: positionOwnershipStateMigrationReviewPlan?.summary?.rows ?? 0,
      symbols: [
        ...new Set([
          ...(positionOwnershipStateMigrationReviewPlan?.symbols?.reviewReady || []),
          ...(positionOwnershipStateMigrationReviewPlan?.symbols?.externalAdoptionReview || []),
          ...(positionOwnershipStateMigrationReviewPlan?.symbols?.doNotAutoRecover || [])
        ])
      ].sort(),
      evidence: `overall=${positionOwnershipStateMigrationReviewPlan?.overall || "N/A"} stateReady=${positionOwnershipStateMigrationReviewPlan?.summary?.stateRecoveryReviewReady ?? "N/A"} reviewRows=${positionOwnershipStateMigrationReviewPlan?.summary?.migrationReviewRows ?? "N/A"} externalAdoption=${positionOwnershipStateMigrationReviewPlan?.summary?.externalAdoptionReview ?? "N/A"} doNotAutoRecover=${positionOwnershipStateMigrationReviewPlan?.summary?.doNotAutoRecover ?? "N/A"} reviewAuthorized=${positionOwnershipStateMigrationReviewPlan?.summary?.reviewAuthorized ?? "N/A"} attempted=${positionOwnershipStateMigrationReviewPlan?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${positionOwnershipStateMigrationReviewPlan?.summary?.brokerMutationSubmitted ?? "N/A"} stateAttempted=${positionOwnershipStateMigrationReviewPlan?.summary?.stateMutationAttempted ?? "N/A"} stateApplied=${positionOwnershipStateMigrationReviewPlan?.summary?.stateMutationApplied ?? "N/A"}`,
      nextAction: ownershipStateMigrationUnsafe
        ? "Stop: state migration review plan emitted a mutation signal, which is forbidden in this report-only path."
        : positionOwnershipStateMigrationReviewPlan?.overall === "state_migration_review_ready_report_only"
          ? "Prepare a separate migration package only; applying state still requires an explicit state migration task with backup/diff/audit/post-verify."
          : "Keep monitor-only. State migration review remains blocked until ownership proof, fresh guard source, and exact state approval are all present.",
      safety: "report_only_no_state_apply_no_broker_mutation_no_multi_submit"
    }),
    lane({
      id: "track_13_multi_oco_submit_safety_gate",
      name: "Multi OCO Submit Safety Gate Lane",
      status: multiOcoSubmitGateUnsafe
        ? "blocked_unsafe_mutation_signal"
        : multiOcoSubmitSafetyGate?.overall || "unknown",
      count: multiOcoSubmitSafetyGate?.summary?.rows ?? 0,
      symbols: Array.isArray(multiOcoSubmitSafetyGate?.summary?.selectedSymbols)
        ? multiOcoSubmitSafetyGate.summary.selectedSymbols
        : [],
      evidence: `overall=${multiOcoSubmitSafetyGate?.overall || "N/A"} eligible=${multiOcoSubmitSafetyGate?.summary?.eligible ?? "N/A"} selected=${multiOcoSubmitSafetyGate?.summary?.selected ?? "N/A"} designApproval=${multiOcoSubmitSafetyGate?.summary?.designApprovalProvided ?? "N/A"} attempted=${multiOcoSubmitSafetyGate?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${multiOcoSubmitSafetyGate?.summary?.brokerMutationSubmitted ?? "N/A"} multiAuthorized=${multiOcoSubmitSafetyGate?.summary?.multiSubmitAuthorized ?? "N/A"}`,
      nextAction: multiOcoSubmitGateUnsafe
        ? "Stop: multi submit gate emitted a mutation/authorization signal, which is forbidden."
        : multiOcoSubmitSafetyGate?.overall === "multi_submit_design_review_authorized_report_only"
          ? "Design review only; no broker mutation is authorized and a separate broker approval phrase is still required before any future submit."
          : "Keep multi submit lane forbidden. Future design requires a separate safety gate and approval scope.",
      safety: "report_only_multi_submit_forbidden_no_broker_mutation"
    })
  ];

  const unsafe = lanes.some((row) => row.status === "submitted" || row.status === "attempted_not_submitted");
  const blockedCount = lanes.filter((row) => {
    const status = String(row.status);
    return (
      status.startsWith("blocked") ||
      status.startsWith("stale") ||
      status.startsWith("missing") ||
      status.includes("required")
    );
  }).length;
  const manualApprovalCandidates = lanes.filter((row) => row.status.includes("approval_candidate")).length;
  const report = {
    generatedAt: new Date().toISOString(),
    overall: unsafe ? "review_broker_activity" : blockedCount ? "blocked_lanes_present" : "monitoring",
    scope: "symbol_agnostic_status_lane_team_report",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      stage6Hash: preview?.stage6Hash || null,
      stage6File: preview?.stage6File || null,
      previewGeneratedAt: preview?.generatedAt || null,
      previewAgeMin,
      previewStale,
      maxPreviewAgeMin: MAX_PREVIEW_AGE_MIN,
      decisionAuditRows: orderDecisionRecords.length,
      opsHealthOverall: opsHealth?.overall || null
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    summary: {
      lanes: lanes.length,
      blockedCount,
      manualApprovalCandidates,
      reportOnly: true,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    lanes
  };
  return report;
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ops Lane Status Report");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`lanes=${report.summary.lanes} blocked=${report.summary.blockedCount} manualApprovalCandidates=${report.summary.manualApprovalCandidates} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``
  );
  lines.push("- safety: `report-only; symbol-agnostic; no broker mutation; no state mutation`");
  lines.push("| Track | Lane | Status | Count | Symbols | Next Action |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const row of report.lanes) {
    lines.push(
      `| ${row.id} | ${row.name} | ${row.status} | ${row.count} | ${row.symbols.join(",") || "none"} | ${row.nextAction} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  const report = buildReport();
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[OPS_LANE_STATUS] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} lanes=${report.summary.lanes} blocked=${report.summary.blockedCount} manualApprovalCandidates=${report.summary.manualApprovalCandidates} attempted=false submitted=false`
  );
};

main();
