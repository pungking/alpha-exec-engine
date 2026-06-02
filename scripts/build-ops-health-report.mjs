import fs from "node:fs";

const STATE_DIR = String(process.env.OPS_HEALTH_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/ops-health-report.json`;
const OUTPUT_MD = `${STATE_DIR}/ops-health-report.md`;

const FILES = {
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  guard: `${STATE_DIR}/last-market-guard.json`,
  guardControl: `${STATE_DIR}/guard-control.json`,
  perf: `${STATE_DIR}/performance-dashboard.json`,
  orderStateConsistency: `${STATE_DIR}/order-state-consistency-report.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`,
  positionProtectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardMetadataRefreshPlan: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  guardMetadataLineageAudit: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  guardSourceRecoveryPlan: `${STATE_DIR}/guard-source-recovery-plan.json`,
  fillStateReconciliationAudit: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  brokerFillStateEvidence: `${STATE_DIR}/broker-fill-state-evidence.json`,
  ledgerTerminalizationProposal: `${STATE_DIR}/ledger-terminalization-proposal.json`,
  ledgerFilledMigrationPlan: `${STATE_DIR}/ledger-filled-migration-plan.json`,
  ledgerFilledMigrationApply: `${STATE_DIR}/ledger-filled-migration-apply-report.json`,
  guardedRepairPlan: `${STATE_DIR}/guarded-child-order-repair-plan.json`,
  persistentOcoRepairPlan: `${STATE_DIR}/persistent-oco-repair-plan.json`,
  limitedMultiOcoRepairPlan: `${STATE_DIR}/limited-multi-oco-repair-plan.json`,
  persistentOcoOpenVerifyMulti: `${STATE_DIR}/persistent-oco-repair-open-verify-multi.json`,
  alpacaPayloadSchema: `${STATE_DIR}/alpaca-order-payload-schema-report.json`,
  alpacaOcoResponseFixture: `${STATE_DIR}/alpaca-oco-response-fixture-report.json`,
  paperOcoCanaryCandidate: `${STATE_DIR}/paper-oco-canary-candidate.json`,
  paperOcoApprovalGate: `${STATE_DIR}/paper-oco-canary-approval-gate.json`,
  paperOcoSubmitGate: `${STATE_DIR}/paper-oco-canary-submit-gate.json`,
  entryRepricePolicyDecision: `${STATE_DIR}/entry-reprice-policy-decision.json`,
  openOrderRepriceProposal: `${STATE_DIR}/open-order-reprice-proposal.json`,
  opsLaneStatus: `${STATE_DIR}/ops-lane-status-report.json`,
  highPriceMinOneShareCanaryPlan: `${STATE_DIR}/high-price-min-one-share-canary-plan.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  markerAudit: `${STATE_DIR}/hf-marker-audit.json`
};

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toIso = (value) => {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
};

const short = (value, max = 120) => String(value ?? "").trim().slice(0, max);

const compactCountMap = (raw, maxItems = 4) => {
  if (!raw || typeof raw !== "object") return null;
  const entries = Object.entries(raw)
    .map(([key, value]) => [String(key), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems);
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(",") : null;
};

const parseProgress = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const required = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(required) || required <= 0) return null;
  return { current, required };
};

const parseMarkerMissingKeys = (markerAudit) => {
  if (!markerAudit || typeof markerAudit !== "object") return [];
  const runEvent = String(markerAudit.runEvent || "").trim().toLowerCase();
  const ignoreDedupe = runEvent === "dedupe";
  const keys = [];
  for (const [key, raw] of Object.entries(markerAudit)) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    if (value === "missing") {
      keys.push(key);
      continue;
    }
    if (!ignoreDedupe && value.startsWith("n/a")) {
      keys.push(key);
    }
  }
  return keys.sort();
};

const determineKind = (explicit, preview, guard) => {
  const value = String(explicit || "").trim().toLowerCase();
  if (value === "dry_run" || value === "market_guard") return value;
  if (guard) return "market_guard";
  if (preview) return "dry_run";
  return "unknown";
};

const addCheck = (checks, status, id, detail) => {
  checks.push({
    id,
    status,
    detail: short(detail, 320)
  });
};

const fmt = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Sidecar Ops Health");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- kind: \`${report.kind}\``);
  lines.push(`- overall: \`${report.overall.toUpperCase()}\``);
  lines.push(
    `- files: \`preview=${report.files.preview ? "ok" : "missing"} guard=${report.files.guard ? "ok" : "missing"} guardControl=${report.files.guardControl ? "ok" : "missing"} perf=${report.files.perf ? "ok" : "missing"} orderState=${report.files.orderStateConsistency ? "ok" : "missing"} brokerChildRec=${report.files.brokerChildReconciliation ? "ok" : "missing"} protectionAudit=${report.files.positionProtectionAudit ? "ok" : "missing"} guardRefresh=${report.files.guardMetadataRefreshPlan ? "ok" : "missing"} guardLineage=${report.files.guardMetadataLineageAudit ? "ok" : "missing"} guardSourceRecovery=${report.files.guardSourceRecoveryPlan ? "ok" : "missing"} fillStateRecon=${report.files.fillStateReconciliationAudit ? "ok" : "missing"} brokerFillEvidence=${report.files.brokerFillStateEvidence ? "ok" : "missing"} terminalizationProposal=${report.files.ledgerTerminalizationProposal ? "ok" : "missing"} filledMigration=${report.files.ledgerFilledMigrationPlan ? "ok" : "missing"} filledMigrationApply=${report.files.ledgerFilledMigrationApply ? "ok" : "missing"} guardedRepair=${report.files.guardedRepairPlan ? "ok" : "missing"} persistentOcoRepair=${report.files.persistentOcoRepairPlan ? "ok" : "missing"} limitedMultiOco=${report.files.limitedMultiOcoRepairPlan ? "ok" : "missing"} persistentOcoMultiVerify=${report.files.persistentOcoOpenVerifyMulti ? "ok" : "missing"} alpacaPayloadSchema=${report.files.alpacaPayloadSchema ? "ok" : "missing"} alpacaOcoResponse=${report.files.alpacaOcoResponseFixture ? "ok" : "missing"} paperOcoCanary=${report.files.paperOcoCanaryCandidate ? "ok" : "missing"} paperOcoGate=${report.files.paperOcoApprovalGate ? "ok" : "missing"} paperOcoSubmitGate=${report.files.paperOcoSubmitGate ? "ok" : "missing"} entryRepricePolicy=${report.files.entryRepricePolicyDecision ? "ok" : "missing"} openRepriceProposal=${report.files.openOrderRepriceProposal ? "ok" : "missing"} laneStatus=${report.files.opsLaneStatus ? "ok" : "missing"} minOneShareCanary=${report.files.highPriceMinOneShareCanaryPlan ? "ok" : "missing"} fillability=${report.files.fillability ? "ok" : "missing"} markerAudit=${report.files.markerAudit ? "ok" : "missing"}\``
  );
  lines.push(
      `- key_metrics: \`stage6Hash=${report.metrics.stage6Hash || "N/A"} payloads/skipped=${report.metrics.payloadCount ?? "N/A"}/${report.metrics.skippedCount ?? "N/A"} perfGate=${report.metrics.perfGateProgress || "N/A"} simRows=${report.metrics.simulationRows ?? "N/A"} simSnapshot=${report.metrics.simulationSnapshotTrades ?? "N/A"} simGap=${report.metrics.simulationRowSnapshotGap ?? "N/A"} fillability=${report.metrics.fillabilityOverall ?? "N/A"} fills=${report.metrics.fillabilityFills ?? "N/A"} repricedWaiting=${report.metrics.fillabilityRepricedWaiting ?? "N/A"} openReprice=${report.metrics.fillabilityOpenReprice ?? "N/A"} openCancel=${report.metrics.fillabilityOpenCancel ?? "N/A"} entryTooFar=${report.metrics.fillabilityEntryTooFar ?? "N/A"} highPriceSize=${report.metrics.fillabilityHighPriceSize ?? "N/A"} invalidQuotes=${report.metrics.fillabilityInvalidQuoteCount ?? "N/A"} expiredTaxonomy=${report.metrics.fillabilityTerminalUnfilledTaxonomy ?? "N/A"} reentryReview=${report.metrics.fillabilityReentryReviewRequired ?? "N/A"} orderState=${report.metrics.orderStateOverall ?? "N/A"} orderStateFailWarn=${report.metrics.orderStateFailures ?? "N/A"}/${report.metrics.orderStateWarnings ?? "N/A"} orderStateTerminalRecon=${report.metrics.orderStateTerminalReconciliationRequired ?? "N/A"} minOneShareCanary=${report.metrics.highPriceMinOneShareOverall ?? "N/A"} minOneShareEligible=${report.metrics.highPriceMinOneShareEligible ?? "N/A"} minOneShareSelected=${report.metrics.highPriceMinOneShareSelectedSymbol ?? "N/A"} hfAlert=${report.metrics.hfAlertTriggered ?? "N/A"} guardLevel=${report.metrics.guardLevel ?? "N/A"} haltNewEntries=${report.metrics.haltNewEntries ?? "N/A"} liveAvailable=${report.metrics.liveAvailable ?? "N/A"} liveReturnPct=${fmt(report.metrics.liveReturnPct)} brokerChildRec=${report.metrics.brokerChildReconciliationOverall ?? "N/A"} brokerChildActions=${report.metrics.brokerChildReconciliationProposedRows ?? "N/A"} protectionAudit=${report.metrics.positionProtectionAuditOverall ?? "N/A"} protectionMissing=${report.metrics.positionProtectionGuardMetadataMissing ?? "N/A"} protectionStale=${report.metrics.positionProtectionGuardMetadataStale ?? "N/A"} protectionInvalidGeometry=${report.metrics.positionProtectionInvalidGeometry ?? "N/A"} protectionBrokerChildMissing=${report.metrics.positionProtectionBrokerChildMissing ?? "N/A"} guardRefresh=${report.metrics.guardMetadataRefreshOverall ?? "N/A"} guardRefreshReady=${report.metrics.guardMetadataRefreshReady ?? "N/A"} guardRefreshBlocked=${report.metrics.guardMetadataRefreshBlocked ?? "N/A"} guardRefreshNoSource=${report.metrics.guardMetadataRefreshNoSource ?? "N/A"} guardRefreshStaleSource=${report.metrics.guardMetadataRefreshStaleSource ?? "N/A"} guardRefreshInvalidGeometry=${report.metrics.guardMetadataRefreshInvalidGeometry ?? "N/A"} guardRefreshRepairAfterRefresh=${report.metrics.guardMetadataRefreshRepairAfterRefresh ?? "N/A"} guardRefreshAttempted=${report.metrics.guardMetadataRefreshAttempted ?? "N/A"} guardRefreshSubmitted=${report.metrics.guardMetadataRefreshSubmitted ?? "N/A"} guardLineage=${report.metrics.guardMetadataLineageOverall ?? "N/A"} guardLineageMissing=${report.metrics.guardMetadataLineageMissing ?? "N/A"} guardLineageStale=${report.metrics.guardMetadataLineageStale ?? "N/A"} guardLineageInvalid=${report.metrics.guardMetadataLineageInvalid ?? "N/A"} guardLineageRoot=${report.metrics.guardMetadataLineageRootCauses ?? "N/A"} laneStatus=${report.metrics.opsLaneStatusOverall ?? "N/A"} laneBlocked=${report.metrics.opsLaneBlockedCount ?? "N/A"} laneManualApproval=${report.metrics.opsLaneManualApprovalCandidates ?? "N/A"} guardedRepair=${report.metrics.guardedRepairPlanOverall ?? "N/A"} guardedCandidates=${report.metrics.guardedRepairCandidates ?? "N/A"} guardedExecReady=${report.metrics.guardedRepairExecutionReadyRows ?? "N/A"} persistentOcoRepair=${report.metrics.persistentOcoRepairPlanOverall ?? "N/A"} persistentEligible=${report.metrics.persistentOcoRepairEligible ?? "N/A"} persistentSelected=${report.metrics.persistentOcoRepairSelectedSymbol ?? "N/A"} persistentAttempted=${report.metrics.persistentOcoRepairAttempted ?? "N/A"} persistentSubmitted=${report.metrics.persistentOcoRepairSubmitted ?? "N/A"} persistentMultiVerify=${report.metrics.persistentOcoOpenVerifyMultiOverall ?? "N/A"} persistentMultiSymbols=${report.metrics.persistentOcoOpenVerifyMultiSymbols ?? "N/A"} persistentMultiPassFail=${report.metrics.persistentOcoOpenVerifyMultiPassCount ?? "N/A"}/${report.metrics.persistentOcoOpenVerifyMultiFailCount ?? "N/A"} alpacaPayloadSchema=${report.metrics.alpacaPayloadSchemaOverall ?? "N/A"} alpacaFixtureFail=${report.metrics.alpacaPayloadSchemaFailCount ?? "N/A"} alpacaOcoResponse=${report.metrics.alpacaOcoResponseOverall ?? "N/A"} alpacaOcoFail=${report.metrics.alpacaOcoResponseFailCount ?? "N/A"} paperOcoCanary=${report.metrics.paperOcoCanaryOverall ?? "N/A"} paperOcoEligible=${report.metrics.paperOcoCanaryEligible ?? "N/A"} paperOcoSelected=${report.metrics.paperOcoCanarySelectedSymbol ?? "N/A"} paperOcoGate=${report.metrics.paperOcoApprovalGateOverall ?? "N/A"} paperOcoDecision=${report.metrics.paperOcoApprovalGateDecision ?? "N/A"} paperOcoSubmit=${report.metrics.paperOcoSubmitGateOverall ?? "N/A"} paperOcoSubmitDecision=${report.metrics.paperOcoSubmitGateDecision ?? "N/A"} paperOcoSubmitAttempted=${report.metrics.paperOcoSubmitGateAttempted ?? "N/A"} paperOcoSubmitSubmitted=${report.metrics.paperOcoSubmitGateSubmitted ?? "N/A"} entryRepricePolicy=${report.metrics.entryRepricePolicyOverall ?? "N/A"} entryRepriceReady=${report.metrics.entryRepricePolicyReady ?? "N/A"} entryRepriceWait=${report.metrics.entryRepricePolicyWaitPullback ?? "N/A"} entryRepriceRrBelow=${report.metrics.entryRepricePolicyRrBelowMin ?? "N/A"} entryRepriceAttempted=${report.metrics.entryRepricePolicyAttempted ?? "N/A"} entryRepriceSubmitted=${report.metrics.entryRepricePolicySubmitted ?? "N/A"} openRepriceProposal=${report.metrics.openOrderRepriceProposalOverall ?? "N/A"} openRepriceRows=${report.metrics.openOrderRepriceRows ?? "N/A"} openRepriceReady=${report.metrics.openOrderRepriceReady ?? "N/A"} openRepriceRiskBreaches=${report.metrics.openOrderRepriceSuggestedRiskBreaches ?? "N/A"} openRepriceAttempted=${report.metrics.openOrderRepriceAttempted ?? "N/A"} openRepriceSubmitted=${report.metrics.openOrderRepriceSubmitted ?? "N/A"} brokerStopMissing=${report.metrics.liveBrokerStopMissingCount ?? "N/A"} brokerTargetMissing=${report.metrics.liveBrokerTargetMissingCount ?? "N/A"} liveGuardMissing=${report.metrics.liveGuardMissingCount ?? "N/A"} liveFillMismatch=${report.metrics.liveFillStateMismatchCount ?? "N/A"}\``
  );
  if (report.metrics.livePositionDetails) {
    lines.push(`- live_position_monitor: \`${report.metrics.livePositionDetails}\``);
  }
  lines.push(
    `- guard_source_recovery: \`overall=${report.metrics.guardSourceRecoveryOverall ?? "N/A"} freshRequired=${report.metrics.guardSourceRecoveryFreshRequired ?? "N/A"} fillRecon=${report.metrics.guardSourceRecoveryFillRecon ?? "N/A"} ownershipReview=${report.metrics.guardSourceRecoveryOwnershipReview ?? "N/A"} repairEligible=${report.metrics.guardSourceRecoveryRepairEligible ?? "N/A"} attempted=${report.metrics.guardSourceRecoveryAttempted ?? "N/A"} submitted=${report.metrics.guardSourceRecoverySubmitted ?? "N/A"}\``
  );
  lines.push(
    `- fill_state_reconciliation: \`overall=${report.metrics.fillStateReconciliationOverall ?? "N/A"} openLedger=${report.metrics.fillStateReconciliationOpenLedger ?? "N/A"} terminalReview=${report.metrics.fillStateReconciliationTerminalReview ?? "N/A"} confirmedFilled=${report.metrics.fillStateReconciliationConfirmedFilled ?? "N/A"} external=${report.metrics.fillStateReconciliationExternal ?? "N/A"} attempted=${report.metrics.fillStateReconciliationAttempted ?? "N/A"} submitted=${report.metrics.fillStateReconciliationSubmitted ?? "N/A"}\``
  );
  lines.push(
    `- broker_fill_state_evidence: \`overall=${report.metrics.brokerFillStateEvidenceOverall ?? "N/A"} candidates=${report.metrics.brokerFillStateEvidenceCandidates ?? "N/A"} readAttempted=${report.metrics.brokerFillStateEvidenceReadAttempted ?? "N/A"} filled=${report.metrics.brokerFillStateEvidenceFilled ?? "N/A"} terminal=${report.metrics.brokerFillStateEvidenceTerminal ?? "N/A"} working=${report.metrics.brokerFillStateEvidenceWorking ?? "N/A"} inconclusive=${report.metrics.brokerFillStateEvidenceInconclusive ?? "N/A"} attempted=${report.metrics.brokerFillStateEvidenceAttempted ?? "N/A"} submitted=${report.metrics.brokerFillStateEvidenceSubmitted ?? "N/A"}\``
  );
  lines.push(
    `- ledger_terminalization: \`overall=${report.metrics.ledgerTerminalizationOverall ?? "N/A"} ready=${report.metrics.ledgerTerminalizationReady ?? "N/A"} filledReady=${report.metrics.ledgerTerminalizationFilledReady ?? "N/A"} terminalReady=${report.metrics.ledgerTerminalizationUnfilledReady ?? "N/A"} blocked=${report.metrics.ledgerTerminalizationBlocked ?? "N/A"} attempted=${report.metrics.ledgerTerminalizationAttempted ?? "N/A"} submitted=${report.metrics.ledgerTerminalizationSubmitted ?? "N/A"}\``
  );
  lines.push(
    `- ledger_filled_migration: \`overall=${report.metrics.ledgerFilledMigrationOverall ?? "N/A"} rows=${report.metrics.ledgerFilledMigrationRows ?? "N/A"} ready=${report.metrics.ledgerFilledMigrationReady ?? "N/A"} blocked=${report.metrics.ledgerFilledMigrationBlocked ?? "N/A"} backupRequired=${report.metrics.ledgerFilledMigrationBackupRequired ?? "N/A"} diffRows=${report.metrics.ledgerFilledMigrationDiffRows ?? "N/A"} auditRows=${report.metrics.ledgerFilledMigrationAuditRows ?? "N/A"} stateApplied=${report.metrics.ledgerFilledMigrationStateApplied ?? "N/A"}\``
  );
  lines.push(
    `- ledger_filled_migration_apply: \`overall=${report.metrics.ledgerFilledMigrationApplyOverall ?? "N/A"} selected=${report.metrics.ledgerFilledMigrationApplySelectedRows ?? "N/A"} postVerified=${report.metrics.ledgerFilledMigrationApplyPostVerifiedRows ?? "N/A"} backupCreated=${report.metrics.ledgerFilledMigrationApplyBackupCreated ?? "N/A"} attempted=${report.metrics.ledgerFilledMigrationApplyAttempted ?? "N/A"} stateApplied=${report.metrics.ledgerFilledMigrationApplyStateApplied ?? "N/A"}\``
  );
  lines.push(
    `- limited_multi_oco_repair: \`overall=${report.metrics.limitedMultiOcoRepairPlanOverall ?? "N/A"} rows=${report.metrics.limitedMultiOcoRepairRows ?? "N/A"} eligible=${report.metrics.limitedMultiOcoRepairEligible ?? "N/A"} selected=${report.metrics.limitedMultiOcoRepairSelected ?? "N/A"} symbols=${report.metrics.limitedMultiOcoRepairSelectedSymbols ?? "N/A"} alreadyProtected=${report.metrics.limitedMultiOcoRepairAlreadyProtected ?? "N/A"} ownershipReview=${report.metrics.limitedMultiOcoRepairOwnershipReview ?? "N/A"} guardMissing=${report.metrics.limitedMultiOcoRepairGuardMissing ?? "N/A"} attempted=${report.metrics.limitedMultiOcoRepairAttempted ?? "N/A"} submitted=${report.metrics.limitedMultiOcoRepairSubmitted ?? "N/A"}\``
  );
  if (report.metrics.hfAlertReason) {
    lines.push(`- hf_alert_reason: \`${report.metrics.hfAlertReason}\``);
  }
  lines.push("- checks:");
  for (const row of report.checks) {
    lines.push(`  - [${row.status.toUpperCase()}] ${row.id}: ${row.detail}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const preview = readJson(FILES.preview);
  const guard = readJson(FILES.guard);
  const guardControl = readJson(FILES.guardControl);
  const perf = readJson(FILES.perf);
  const orderStateConsistency = readJson(FILES.orderStateConsistency);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const positionProtectionAudit = readJson(FILES.positionProtectionAudit);
  const guardMetadataRefreshPlan = readJson(FILES.guardMetadataRefreshPlan);
  const guardMetadataLineageAudit = readJson(FILES.guardMetadataLineageAudit);
  const guardSourceRecoveryPlan = readJson(FILES.guardSourceRecoveryPlan);
  const fillStateReconciliationAudit = readJson(FILES.fillStateReconciliationAudit);
  const brokerFillStateEvidence = readJson(FILES.brokerFillStateEvidence);
  const ledgerTerminalizationProposal = readJson(FILES.ledgerTerminalizationProposal);
  const ledgerFilledMigrationPlan = readJson(FILES.ledgerFilledMigrationPlan);
  const ledgerFilledMigrationApply = readJson(FILES.ledgerFilledMigrationApply);
  const guardedRepairPlan = readJson(FILES.guardedRepairPlan);
  const persistentOcoRepairPlan = readJson(FILES.persistentOcoRepairPlan);
  const limitedMultiOcoRepairPlan = readJson(FILES.limitedMultiOcoRepairPlan);
  const persistentOcoOpenVerifyMulti = readJson(FILES.persistentOcoOpenVerifyMulti);
  const alpacaPayloadSchema = readJson(FILES.alpacaPayloadSchema);
  const alpacaOcoResponseFixture = readJson(FILES.alpacaOcoResponseFixture);
  const paperOcoCanaryCandidate = readJson(FILES.paperOcoCanaryCandidate);
  const paperOcoApprovalGate = readJson(FILES.paperOcoApprovalGate);
  const paperOcoSubmitGate = readJson(FILES.paperOcoSubmitGate);
  const entryRepricePolicyDecision = readJson(FILES.entryRepricePolicyDecision);
  const openOrderRepriceProposal = readJson(FILES.openOrderRepriceProposal);
  const opsLaneStatus = readJson(FILES.opsLaneStatus);
  const highPriceMinOneShareCanaryPlan = readJson(FILES.highPriceMinOneShareCanaryPlan);
  const fillability = readJson(FILES.fillability);
  const markerAudit = readJson(FILES.markerAudit);

  const kind = determineKind(process.env.OPS_HEALTH_KIND, preview, guard);
  const checks = [];

  if (kind === "dry_run" && !preview) {
    addCheck(checks, "fail", "dry_preview_missing", "state/last-dry-exec-preview.json not found");
  }
  if (kind === "market_guard" && !guard) {
    addCheck(checks, "fail", "guard_summary_missing", "state/last-market-guard.json not found");
  }
  if (!perf) {
    addCheck(checks, "warn", "perf_dashboard_missing", "state/performance-dashboard.json not found");
  }
  if (!fillability) {
    addCheck(checks, "warn", "fillability_report_missing", "state/fillability-report.json not found");
  }
  if (fillability && !orderStateConsistency) {
    addCheck(
      checks,
      "warn",
      "order_state_consistency_missing",
      "state/order-state-consistency-report.json not found; ledger/idempotency/fillability/performance consistency was not audited"
    );
  }
  if (perf && !brokerChildReconciliation) {
    addCheck(
      checks,
      "warn",
      "broker_child_reconciliation_missing",
      "state/broker-child-order-reconciliation.json not found; broker child stop/target planner did not run"
    );
  }
  if (brokerChildReconciliation && !positionProtectionAudit) {
    addCheck(
      checks,
      "warn",
      "position_protection_audit_missing",
      "state/position-protection-root-cause-audit.json not found; stop/current/target drift and child-missing root causes are not separated"
    );
  }
  if (positionProtectionAudit && !guardMetadataRefreshPlan) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_refresh_plan_missing",
      "state/guard-metadata-refresh-plan.json not found; stale/missing guard metadata has no report-only refresh route"
    );
  }
  if (guardMetadataRefreshPlan && !guardMetadataLineageAudit) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_lineage_audit_missing",
      "state/guard-metadata-lineage-audit.json not found; missing/stale guard metadata source lineage was not proven"
    );
  }
  if (brokerChildReconciliation && !guardedRepairPlan) {
    addCheck(
      checks,
      "warn",
      "guarded_repair_plan_missing",
      "state/guarded-child-order-repair-plan.json not found; guarded repair lane planner did not run"
    );
  }
  if (guardedRepairPlan && !alpacaPayloadSchema) {
    addCheck(
      checks,
      "warn",
      "alpaca_payload_schema_missing",
      "state/alpaca-order-payload-schema-report.json not found; child/OCO fixture schema validation did not run"
    );
  }
  if (brokerChildReconciliation && !persistentOcoRepairPlan) {
    addCheck(
      checks,
      "warn",
      "persistent_oco_repair_plan_missing",
      "state/persistent-oco-repair-plan.json not found; persistent protective OCO repair candidate was not planned"
    );
  }
  if (alpacaPayloadSchema && !alpacaOcoResponseFixture) {
    addCheck(
      checks,
      "warn",
      "alpaca_oco_response_fixture_missing",
      "state/alpaca-oco-response-fixture-report.json not found; future OCO paper canary response shape is not validated"
    );
  }
  if (alpacaOcoResponseFixture && !paperOcoCanaryCandidate) {
    addCheck(
      checks,
      "warn",
      "paper_oco_canary_candidate_missing",
      "state/paper-oco-canary-candidate.json not found; future OCO paper canary target selection is not audited"
    );
  }
  if (paperOcoCanaryCandidate && !paperOcoApprovalGate) {
    addCheck(
      checks,
      "warn",
      "paper_oco_approval_gate_missing",
      "state/paper-oco-canary-approval-gate.json not found; selected paper OCO canary row has no approval gate"
    );
  }
  if (paperOcoApprovalGate && !paperOcoSubmitGate) {
    addCheck(
      checks,
      "warn",
      "paper_oco_submit_gate_missing",
      "state/paper-oco-canary-submit-gate.json not found; paper OCO canary submit safety gate did not run"
    );
  }
  if (fillability && !highPriceMinOneShareCanaryPlan) {
    addCheck(
      checks,
      "warn",
      "high_price_min_one_share_canary_missing",
      "state/high-price-min-one-share-canary-plan.json not found; high-price sizing has no safe dry-run probe planner"
    );
  }
  if (fillability && !entryRepricePolicyDecision) {
    addCheck(
      checks,
      "warn",
      "entry_reprice_policy_decision_missing",
      "state/entry-reprice-policy-decision.json not found; current-price/RR deterioration was not separated from fillability floor policy"
    );
  }

  const payloadCount = toNum(preview?.payloadCount);
  const skippedCount = toNum(preview?.skippedCount);
  const stage6Hash = short(preview?.stage6Hash || "", 12) || null;
  const perfGateProgress =
    short(preview?.hfTuningPhase?.gateProgress || preview?.hfNextAction?.gateProgress || "", 32) || null;
  const tuningGateProgress = short(preview?.hfTuningPhase?.gateProgress || "", 32) || null;
  const nextActionGateProgress = short(preview?.hfNextAction?.gateProgress || "", 32) || null;
  const dailyVerdictGateProgress = short(preview?.hfDailyVerdict?.gateProgress || "", 32) || null;
  const perfGateParsed = parseProgress(perfGateProgress);
  const perfGateRemainingTrades = toNum(
    preview?.hfTuningPhase?.gateRemainingTrades ?? preview?.hfNextAction?.gateRemainingTrades
  );
  const tuningGateRemaining = toNum(preview?.hfTuningPhase?.gateRemainingTrades);
  const nextActionGateRemaining = toNum(preview?.hfNextAction?.gateRemainingTrades);
  const dailyVerdictGateRemaining = toNum(preview?.hfDailyVerdict?.gateRemainingTrades);
  const perfGateRemainingComputed =
    perfGateParsed != null ? Math.max(perfGateParsed.required - perfGateParsed.current, 0) : null;
  const hfAlertTriggered = preview?.hfAlert?.triggered;
  const hfAlertReason = short(preview?.hfAlert?.reason || "", 120) || null;
  const simulationRows = toNum(perf?.simulation?.totalRows);
  const simulationSnapshotTrades = toNum(perf?.simulation?.latestSnapshotTradeCount);
  const simulationRowSnapshotGap = toNum(perf?.simulation?.rowVsSnapshotGap);
  const simulationSnapshotCoveragePct = toNum(perf?.simulation?.snapshotCoveragePct);
  const fillabilityOverall = short(fillability?.summary?.overall || "", 32) || null;
  const fillabilityFills = toNum(fillability?.summary?.fillActivityCount);
  const fillabilityRepricedWaiting = toNum(fillability?.summary?.openRepricedWaiting);
  const fillabilityOpenReprice = toNum(fillability?.summary?.openReprice);
  const fillabilityOpenCancel = toNum(fillability?.summary?.openCancel);
  const fillabilityEntryTooFar = toNum(fillability?.summary?.entryTooFar);
  const fillabilityHighPriceSize = toNum(fillability?.summary?.highPriceSizeBlocked);
  const fillabilityInvalidQuoteCount = toNum(fillability?.summary?.invalidQuoteCount);
  const fillabilityTerminalUnfilledTaxonomy =
    short(fillability?.summary?.terminalUnfilledTaxonomySummary || compactCountMap(fillability?.summary?.terminalUnfilledTaxonomyCounts), 160) || null;
  const fillabilityExpiredLimitNotReached = toNum(fillability?.summary?.expiredLimitNotReached);
  const fillabilityExpiredQuoteInvalid = toNum(fillability?.summary?.expiredQuoteInvalid);
  const fillabilityExpiredPullbackNotFilled = toNum(fillability?.summary?.expiredPullbackNotFilled);
  const fillabilityReentryReviewRequired = toNum(fillability?.summary?.reentryReviewRequired);
  const orderStateOverall = short(orderStateConsistency?.overall || "", 48) || null;
  const orderStateFailures = toNum(orderStateConsistency?.summary?.failures);
  const orderStateWarnings = toNum(orderStateConsistency?.summary?.warnings);
  const orderStateTerminalReconciliationRequired = toNum(
    orderStateConsistency?.summary?.terminalReconciliationRequired
  );
  const orderStateTerminalConflicts = toNum(orderStateConsistency?.summary?.terminalConflicts);
  const orderStateAccountRedaction = short(orderStateConsistency?.accountRedaction?.status || "", 24) || null;
  const orderStateExitOnFail = orderStateConsistency?.executionPolicy?.exitOnStateFail === true;
  const orderStateBrokerMutationAllowed = orderStateConsistency?.executionPolicy?.brokerMutationAllowed === true;
  const orderStateBrokerMutationAttempted = orderStateConsistency?.executionPolicy?.brokerMutationAttempted === true;
  const orderStateBrokerMutationSubmitted = orderStateConsistency?.executionPolicy?.brokerMutationSubmitted === true;
  const brokerChildReconciliationOverall =
    short(brokerChildReconciliation?.overall || "", 32) || null;
  const brokerChildReconciliationCriticalCount =
    toNum(brokerChildReconciliation?.summary?.criticalCount);
  const brokerChildReconciliationWarningCount =
    toNum(brokerChildReconciliation?.summary?.warningCount);
  const brokerChildReconciliationProposedRows =
    toNum(brokerChildReconciliation?.summary?.proposedActionRows);
  const brokerChildReconciliationMissingStops =
    toNum(brokerChildReconciliation?.summary?.missingStopChildren);
  const brokerChildReconciliationMissingTargets =
    toNum(brokerChildReconciliation?.summary?.missingTargetChildren);
  const positionProtectionAuditOverall = short(positionProtectionAudit?.overall || "", 48) || null;
  const positionProtectionPositions = toNum(positionProtectionAudit?.summary?.positions);
  const positionProtectionCritical = toNum(positionProtectionAudit?.summary?.critical);
  const positionProtectionWarnings = toNum(positionProtectionAudit?.summary?.warnings);
  const positionProtectionGuardMetadataMissing = toNum(positionProtectionAudit?.summary?.guardMetadataMissing);
  const positionProtectionGuardMetadataStale = toNum(positionProtectionAudit?.summary?.guardMetadataStale);
  const positionProtectionInvalidGeometry = toNum(positionProtectionAudit?.summary?.invalidGeometry);
  const positionProtectionStopCurrentDrift = toNum(positionProtectionAudit?.summary?.stopCurrentDrift);
  const positionProtectionBrokerChildMissing = toNum(positionProtectionAudit?.summary?.brokerChildMissing);
  const positionProtectionBrokerStopMissing = toNum(positionProtectionAudit?.summary?.brokerStopMissing);
  const positionProtectionBrokerTargetMissing = toNum(positionProtectionAudit?.summary?.brokerTargetMissing);
  const guardMetadataRefreshOverall = short(guardMetadataRefreshPlan?.overall || "", 48) || null;
  const guardMetadataRefreshReady = toNum(guardMetadataRefreshPlan?.summary?.refreshReady);
  const guardMetadataRefreshBlocked = toNum(guardMetadataRefreshPlan?.summary?.blocked);
  const guardMetadataRefreshNoSource = toNum(guardMetadataRefreshPlan?.summary?.noRefreshSource);
  const guardMetadataRefreshStaleSource = toNum(guardMetadataRefreshPlan?.summary?.staleRefreshSource);
  const guardMetadataRefreshInvalidGeometry = toNum(guardMetadataRefreshPlan?.summary?.invalidRefreshGeometry);
  const guardMetadataRefreshRepairAfterRefresh = toNum(
    guardMetadataRefreshPlan?.summary?.repairReevaluationCandidates
  );
  const guardMetadataRefreshAttempted =
    guardMetadataRefreshPlan?.executionPolicy?.brokerMutationAttempted === true ||
    guardMetadataRefreshPlan?.summary?.brokerMutationAttempted === true ||
    guardMetadataRefreshPlan?.executionPolicy?.stateMutationAttempted === true ||
    guardMetadataRefreshPlan?.summary?.stateMutationAttempted === true;
  const guardMetadataRefreshSubmitted =
    guardMetadataRefreshPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    guardMetadataRefreshPlan?.summary?.brokerMutationSubmitted === true;
  const guardMetadataRefreshBrokerMutationAllowed =
    guardMetadataRefreshPlan?.executionPolicy?.brokerMutationAllowed === true;
  const guardMetadataRefreshStateMutationAllowed =
    guardMetadataRefreshPlan?.executionPolicy?.stateMutationAllowed === true;
  const guardMetadataLineageOverall = short(guardMetadataLineageAudit?.overall || "", 48) || null;
  const guardMetadataLineageReady = toNum(guardMetadataLineageAudit?.summary?.ready);
  const guardMetadataLineageMissing = toNum(guardMetadataLineageAudit?.summary?.missingNoSource);
  const guardMetadataLineageStale = toNum(guardMetadataLineageAudit?.summary?.staleSourceOnly);
  const guardMetadataLineageInvalid = toNum(guardMetadataLineageAudit?.summary?.invalidGeometry);
  const guardMetadataLineageRootCauses =
    compactCountMap(guardMetadataLineageAudit?.summary?.rootCauseCounts) || null;
  const guardMetadataLineageFreshnessStatuses =
    compactCountMap(guardMetadataLineageAudit?.summary?.freshnessStatusCounts) || null;
  const guardMetadataLineageAttempted =
    guardMetadataLineageAudit?.executionPolicy?.brokerMutationAttempted === true ||
    guardMetadataLineageAudit?.summary?.brokerMutationAttempted === true ||
    guardMetadataLineageAudit?.executionPolicy?.stateMutationAttempted === true ||
    guardMetadataLineageAudit?.summary?.stateMutationAttempted === true;
  const guardMetadataLineageSubmitted =
    guardMetadataLineageAudit?.executionPolicy?.brokerMutationSubmitted === true ||
    guardMetadataLineageAudit?.summary?.brokerMutationSubmitted === true;
  const guardMetadataLineageBrokerMutationAllowed =
    guardMetadataLineageAudit?.executionPolicy?.brokerMutationAllowed === true;
  const guardMetadataLineageStateMutationAllowed =
    guardMetadataLineageAudit?.executionPolicy?.stateMutationAllowed === true;
  const guardSourceRecoveryOverall = short(guardSourceRecoveryPlan?.overall || "", 48) || null;
  const guardSourceRecoveryFreshRequired = toNum(guardSourceRecoveryPlan?.summary?.freshSourceRequired);
  const guardSourceRecoveryFillRecon = toNum(guardSourceRecoveryPlan?.summary?.fillStateReconciliationRequired);
  const guardSourceRecoveryOwnershipReview = toNum(guardSourceRecoveryPlan?.summary?.positionOwnershipReviewRequired);
  const guardSourceRecoveryInvalidGeometry = toNum(guardSourceRecoveryPlan?.summary?.invalidGeometry);
  const guardSourceRecoveryRepairEligible = toNum(guardSourceRecoveryPlan?.summary?.repairEligibleNow);
  const guardSourceRecoveryAttempted =
    guardSourceRecoveryPlan?.executionPolicy?.brokerMutationAttempted === true ||
    guardSourceRecoveryPlan?.summary?.brokerMutationAttempted === true ||
    guardSourceRecoveryPlan?.executionPolicy?.stateMutationAttempted === true ||
    guardSourceRecoveryPlan?.summary?.stateMutationAttempted === true;
  const guardSourceRecoverySubmitted =
    guardSourceRecoveryPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    guardSourceRecoveryPlan?.summary?.brokerMutationSubmitted === true;
  const guardSourceRecoveryBrokerMutationAllowed =
    guardSourceRecoveryPlan?.executionPolicy?.brokerMutationAllowed === true;
  const guardSourceRecoveryStateMutationAllowed =
    guardSourceRecoveryPlan?.executionPolicy?.stateMutationAllowed === true;
  const fillStateReconciliationOverall = short(fillStateReconciliationAudit?.overall || "", 48) || null;
  const fillStateReconciliationConfirmedFilled = toNum(fillStateReconciliationAudit?.summary?.confirmedFilled);
  const fillStateReconciliationOpenLedger = toNum(fillStateReconciliationAudit?.summary?.positionPresentOpenLedger);
  const fillStateReconciliationTerminalNotFilled = toNum(
    fillStateReconciliationAudit?.summary?.positionPresentTerminalNotFilled
  );
  const fillStateReconciliationDivergence = toNum(fillStateReconciliationAudit?.summary?.fillStateDivergence);
  const fillStateReconciliationExternal = toNum(fillStateReconciliationAudit?.summary?.externalOwnershipReview);
  const fillStateReconciliationTerminalReview = toNum(
    fillStateReconciliationAudit?.summary?.ledgerTerminalizationReviewRequired
  );
  const fillStateReconciliationAttempted =
    fillStateReconciliationAudit?.executionPolicy?.brokerMutationAttempted === true ||
    fillStateReconciliationAudit?.summary?.brokerMutationAttempted === true ||
    fillStateReconciliationAudit?.executionPolicy?.stateMutationAttempted === true ||
    fillStateReconciliationAudit?.summary?.stateMutationAttempted === true;
  const fillStateReconciliationSubmitted =
    fillStateReconciliationAudit?.executionPolicy?.brokerMutationSubmitted === true ||
    fillStateReconciliationAudit?.summary?.brokerMutationSubmitted === true;
  const fillStateReconciliationBrokerMutationAllowed =
    fillStateReconciliationAudit?.executionPolicy?.brokerMutationAllowed === true;
  const fillStateReconciliationStateMutationAllowed =
    fillStateReconciliationAudit?.executionPolicy?.stateMutationAllowed === true;
  const brokerFillStateEvidenceOverall = short(brokerFillStateEvidence?.overall || "", 48) || null;
  const brokerFillStateEvidenceCandidates = toNum(brokerFillStateEvidence?.summary?.candidates);
  const brokerFillStateEvidenceReadAttempted = brokerFillStateEvidence?.summary?.brokerReadAttempted === true;
  const brokerFillStateEvidenceFilled = toNum(brokerFillStateEvidence?.summary?.brokerFilledConfirmed);
  const brokerFillStateEvidenceTerminal = toNum(brokerFillStateEvidence?.summary?.brokerTerminalUnfilledConfirmed);
  const brokerFillStateEvidenceWorking = toNum(brokerFillStateEvidence?.summary?.brokerStillWorking);
  const brokerFillStateEvidenceInconclusive = toNum(brokerFillStateEvidence?.summary?.inconclusive);
  const brokerFillStateEvidenceAttempted =
    brokerFillStateEvidence?.executionPolicy?.brokerMutationAttempted === true ||
    brokerFillStateEvidence?.summary?.brokerMutationAttempted === true ||
    brokerFillStateEvidence?.executionPolicy?.stateMutationAttempted === true ||
    brokerFillStateEvidence?.summary?.stateMutationAttempted === true;
  const brokerFillStateEvidenceSubmitted =
    brokerFillStateEvidence?.executionPolicy?.brokerMutationSubmitted === true ||
    brokerFillStateEvidence?.summary?.brokerMutationSubmitted === true;
  const brokerFillStateEvidenceBrokerMutationAllowed =
    brokerFillStateEvidence?.executionPolicy?.brokerMutationAllowed === true;
  const brokerFillStateEvidenceStateMutationAllowed =
    brokerFillStateEvidence?.executionPolicy?.stateMutationAllowed === true;
  const ledgerTerminalizationOverall = short(ledgerTerminalizationProposal?.overall || "", 48) || null;
  const ledgerTerminalizationRows = toNum(ledgerTerminalizationProposal?.summary?.rows);
  const ledgerTerminalizationReady = toNum(ledgerTerminalizationProposal?.summary?.proposalReady);
  const ledgerTerminalizationFilledReady = toNum(ledgerTerminalizationProposal?.summary?.markFilledReady);
  const ledgerTerminalizationUnfilledReady = toNum(ledgerTerminalizationProposal?.summary?.markTerminalUnfilledReady);
  const ledgerTerminalizationBlocked = toNum(ledgerTerminalizationProposal?.summary?.blocked);
  const ledgerTerminalizationAttempted =
    ledgerTerminalizationProposal?.executionPolicy?.brokerMutationAttempted === true ||
    ledgerTerminalizationProposal?.summary?.brokerMutationAttempted === true ||
    ledgerTerminalizationProposal?.executionPolicy?.stateMutationAttempted === true ||
    ledgerTerminalizationProposal?.summary?.stateMutationAttempted === true;
  const ledgerTerminalizationSubmitted =
    ledgerTerminalizationProposal?.executionPolicy?.brokerMutationSubmitted === true ||
    ledgerTerminalizationProposal?.summary?.brokerMutationSubmitted === true;
  const ledgerTerminalizationBrokerMutationAllowed =
    ledgerTerminalizationProposal?.executionPolicy?.brokerMutationAllowed === true;
  const ledgerTerminalizationStateMutationAllowed =
    ledgerTerminalizationProposal?.executionPolicy?.stateMutationAllowed === true;
  const ledgerFilledMigrationOverall = short(ledgerFilledMigrationPlan?.overall || "", 64) || null;
  const ledgerFilledMigrationRows = toNum(ledgerFilledMigrationPlan?.summary?.rows);
  const ledgerFilledMigrationReady = toNum(ledgerFilledMigrationPlan?.summary?.readyForApplyReview);
  const ledgerFilledMigrationBlocked = toNum(ledgerFilledMigrationPlan?.summary?.blocked);
  const ledgerFilledMigrationBackupRequired = ledgerFilledMigrationPlan?.summary?.backupRequired === true;
  const ledgerFilledMigrationDiffRows = toNum(ledgerFilledMigrationPlan?.summary?.diffPreviewRows);
  const ledgerFilledMigrationAuditRows = toNum(ledgerFilledMigrationPlan?.summary?.auditPreviewRows);
  const ledgerFilledMigrationAttempted =
    ledgerFilledMigrationPlan?.executionPolicy?.brokerMutationAttempted === true ||
    ledgerFilledMigrationPlan?.summary?.brokerMutationAttempted === true ||
    ledgerFilledMigrationPlan?.executionPolicy?.stateMutationAttempted === true ||
    ledgerFilledMigrationPlan?.summary?.stateMutationAttempted === true;
  const ledgerFilledMigrationSubmitted =
    ledgerFilledMigrationPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    ledgerFilledMigrationPlan?.summary?.brokerMutationSubmitted === true;
  const ledgerFilledMigrationStateApplied =
    ledgerFilledMigrationPlan?.executionPolicy?.stateMutationApplied === true ||
    ledgerFilledMigrationPlan?.summary?.stateMutationApplied === true;
  const ledgerFilledMigrationBrokerMutationAllowed =
    ledgerFilledMigrationPlan?.executionPolicy?.brokerMutationAllowed === true;
  const ledgerFilledMigrationStateMutationAllowed =
    ledgerFilledMigrationPlan?.executionPolicy?.stateMutationAllowed === true;
  const ledgerFilledMigrationApplyOverall = short(ledgerFilledMigrationApply?.overall || "", 64) || null;
  const ledgerFilledMigrationApplySelectedRows = toNum(ledgerFilledMigrationApply?.summary?.selectedRows);
  const ledgerFilledMigrationApplyPostVerifiedRows = toNum(ledgerFilledMigrationApply?.summary?.postVerifiedRows);
  const ledgerFilledMigrationApplyBackupCreated = ledgerFilledMigrationApply?.backup?.created === true;
  const ledgerFilledMigrationApplyAttempted =
    ledgerFilledMigrationApply?.executionPolicy?.brokerMutationAttempted === true ||
    ledgerFilledMigrationApply?.executionPolicy?.brokerMutationSubmitted === true ||
    ledgerFilledMigrationApply?.summary?.stateMutationAttempted === true ||
    ledgerFilledMigrationApply?.executionPolicy?.stateMutationAttempted === true;
  const ledgerFilledMigrationApplySubmitted =
    ledgerFilledMigrationApply?.executionPolicy?.brokerMutationSubmitted === true;
  const ledgerFilledMigrationApplyStateApplied =
    ledgerFilledMigrationApply?.summary?.stateMutationApplied === true ||
    ledgerFilledMigrationApply?.executionPolicy?.stateMutationApplied === true;
  const ledgerFilledMigrationApplyBrokerMutationAllowed =
    ledgerFilledMigrationApply?.executionPolicy?.brokerMutationAllowed === true;
  const ledgerFilledMigrationApplyApprovalProvided =
    ledgerFilledMigrationApply?.apply?.approvalProvided === true;
  const guardedRepairPlanOverall = short(guardedRepairPlan?.overall || "", 48) || null;
  const guardedRepairCandidates = toNum(guardedRepairPlan?.summary?.candidates);
  const guardedRepairBlockedByReportOnly = toNum(guardedRepairPlan?.summary?.blockedByReportOnly);
  const guardedRepairExecutionReadyRows = toNum(guardedRepairPlan?.summary?.executionReadyRows);
  const guardedRepairBlockingGates = toNum(guardedRepairPlan?.summary?.blockingGates);
  const persistentOcoRepairPlanOverall = short(persistentOcoRepairPlan?.overall || "", 48) || null;
  const persistentOcoRepairRows = toNum(persistentOcoRepairPlan?.summary?.rows);
  const persistentOcoRepairEligible = toNum(persistentOcoRepairPlan?.summary?.eligible);
  const persistentOcoRepairSelectedSymbol =
    short(persistentOcoRepairPlan?.summary?.selectedSymbol || "", 24) || null;
  const persistentOcoRepairSelectedQty = toNum(persistentOcoRepairPlan?.summary?.selectedRepairQty);
  const persistentOcoRepairAttempted =
    persistentOcoRepairPlan?.summary?.brokerMutationAttempted === true;
  const persistentOcoRepairSubmitted =
    persistentOcoRepairPlan?.summary?.brokerMutationSubmitted === true;
  const persistentOcoRepairBrokerMutationAllowed =
    persistentOcoRepairPlan?.executionPolicy?.brokerMutationAllowed === true;
  const limitedMultiOcoRepairPlanOverall = short(limitedMultiOcoRepairPlan?.overall || "", 64) || null;
  const limitedMultiOcoRepairRows = toNum(limitedMultiOcoRepairPlan?.summary?.rows);
  const limitedMultiOcoRepairEligible = toNum(limitedMultiOcoRepairPlan?.summary?.eligible);
  const limitedMultiOcoRepairSelected = toNum(limitedMultiOcoRepairPlan?.summary?.selected);
  const limitedMultiOcoRepairSelectedSymbols = short(
    Array.isArray(limitedMultiOcoRepairPlan?.summary?.selectedSymbols)
      ? limitedMultiOcoRepairPlan.summary.selectedSymbols.join(",")
      : "",
    120
  ) || null;
  const limitedMultiOcoRepairAlreadyProtected = toNum(limitedMultiOcoRepairPlan?.summary?.alreadyProtectedNoAction);
  const limitedMultiOcoRepairOwnershipReview = toNum(limitedMultiOcoRepairPlan?.summary?.positionOwnershipReviewRequired);
  const limitedMultiOcoRepairGuardMissing = toNum(limitedMultiOcoRepairPlan?.summary?.guardMetadataMissing);
  const limitedMultiOcoRepairAttempted =
    limitedMultiOcoRepairPlan?.executionPolicy?.brokerMutationAttempted === true ||
    limitedMultiOcoRepairPlan?.summary?.brokerMutationAttempted === true;
  const limitedMultiOcoRepairSubmitted =
    limitedMultiOcoRepairPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    limitedMultiOcoRepairPlan?.summary?.brokerMutationSubmitted === true;
  const limitedMultiOcoRepairBrokerMutationAllowed =
    limitedMultiOcoRepairPlan?.executionPolicy?.brokerMutationAllowed === true;
  const persistentOcoOpenVerifyMultiOverall =
    short(persistentOcoOpenVerifyMulti?.overall || "", 48) || null;
  const persistentOcoOpenVerifyMultiReports = toNum(persistentOcoOpenVerifyMulti?.summary?.reports);
  const persistentOcoOpenVerifyMultiPassCount = toNum(persistentOcoOpenVerifyMulti?.summary?.passCount);
  const persistentOcoOpenVerifyMultiFailCount = toNum(persistentOcoOpenVerifyMulti?.summary?.failCount);
  const persistentOcoOpenVerifyMultiSymbols = short(
    Array.isArray(persistentOcoOpenVerifyMulti?.summary?.symbols)
      ? persistentOcoOpenVerifyMulti.summary.symbols.join(",")
      : "",
    120
  ) || null;
  const persistentOcoOpenVerifyMultiAttempted =
    persistentOcoOpenVerifyMulti?.summary?.brokerMutationAttempted === true;
  const persistentOcoOpenVerifyMultiSubmitted =
    persistentOcoOpenVerifyMulti?.summary?.brokerMutationSubmitted === true;
  const persistentOcoOpenVerifyMultiBrokerMutationAllowed =
    persistentOcoOpenVerifyMulti?.executionPolicy?.brokerMutationAllowed === true;
  const alpacaPayloadSchemaOverall = short(alpacaPayloadSchema?.overall || "", 32) || null;
  const alpacaPayloadSchemaFixtureCount = toNum(alpacaPayloadSchema?.summary?.fixtureCount);
  const alpacaPayloadSchemaFailCount = toNum(alpacaPayloadSchema?.summary?.failCount);
  const alpacaPayloadSchemaWarnCount = toNum(alpacaPayloadSchema?.summary?.warnCount);
  const alpacaOcoResponseOverall = short(alpacaOcoResponseFixture?.overall || "", 32) || null;
  const alpacaOcoResponseFixtureCount = toNum(alpacaOcoResponseFixture?.summary?.fixtureCount);
  const alpacaOcoResponseFailCount = toNum(alpacaOcoResponseFixture?.summary?.failCount);
  const alpacaOcoResponseWarnCount = toNum(alpacaOcoResponseFixture?.summary?.warnCount);
  const paperOcoCanaryOverall = short(paperOcoCanaryCandidate?.overall || "", 48) || null;
  const paperOcoCanaryRows = toNum(paperOcoCanaryCandidate?.summary?.rows);
  const paperOcoCanaryEligible = toNum(paperOcoCanaryCandidate?.summary?.eligible);
  const paperOcoCanaryExecutionReadyRows = toNum(paperOcoCanaryCandidate?.summary?.executionReadyRows);
  const paperOcoCanarySelectedSymbol = short(paperOcoCanaryCandidate?.summary?.selectedSymbol || "", 24) || null;
  const paperOcoCanaryBrokerMutationAllowed =
    paperOcoCanaryCandidate?.executionPolicy?.brokerMutationAllowed === true;
  const paperOcoApprovalGateOverall = short(paperOcoApprovalGate?.overall || "", 48) || null;
  const paperOcoApprovalGateDecision = short(paperOcoApprovalGate?.decision?.status || "", 64) || null;
  const paperOcoApprovalGateSelectedSymbol = short(paperOcoApprovalGate?.summary?.selectedSymbol || "", 24) || null;
  const paperOcoApprovalGateExecutionReadyRows = toNum(paperOcoApprovalGate?.summary?.executionReadyRows);
  const paperOcoApprovalGateBrokerMutationAllowed =
    paperOcoApprovalGate?.executionPolicy?.brokerMutationAllowed === true;
  const paperOcoSubmitGateOverall = short(paperOcoSubmitGate?.overall || "", 48) || null;
  const paperOcoSubmitGateDecision = short(paperOcoSubmitGate?.decision?.status || "", 64) || null;
  const paperOcoSubmitGateAttempted = paperOcoSubmitGate?.summary?.brokerMutationAttempted === true;
  const paperOcoSubmitGateSubmitted = paperOcoSubmitGate?.summary?.brokerMutationSubmitted === true;
  const entryRepricePolicyOverall = short(entryRepricePolicyDecision?.overall || "", 48) || null;
  const entryRepricePolicyRows = toNum(entryRepricePolicyDecision?.summary?.rows);
  const entryRepricePolicyPriceRrRows = toNum(entryRepricePolicyDecision?.summary?.priceRrCaseRows);
  const entryRepricePolicyReady = toNum(entryRepricePolicyDecision?.summary?.entryRepriceReviewReady);
  const entryRepricePolicyWaitPullback = toNum(entryRepricePolicyDecision?.summary?.waitPullbackRows);
  const entryRepricePolicyRrBelowMin = toNum(entryRepricePolicyDecision?.summary?.waitPullbackRrBelowMin);
  const entryRepricePolicyDistanceWait = toNum(entryRepricePolicyDecision?.summary?.waitPullbackDistanceRows);
  const entryRepricePolicyFloorChangeRecommended =
    entryRepricePolicyDecision?.summary?.fillabilityFloorChangeRecommended === true;
  const entryRepricePolicyBrokerMutationAllowed =
    entryRepricePolicyDecision?.executionPolicy?.brokerMutationAllowed === true ||
    entryRepricePolicyDecision?.summary?.brokerMutationAllowed === true;
  const entryRepricePolicyAttempted =
    entryRepricePolicyDecision?.executionPolicy?.brokerMutationAttempted === true ||
    entryRepricePolicyDecision?.summary?.brokerMutationAttempted === true;
  const entryRepricePolicySubmitted =
    entryRepricePolicyDecision?.executionPolicy?.brokerMutationSubmitted === true ||
    entryRepricePolicyDecision?.summary?.brokerMutationSubmitted === true;
  const openOrderRepriceProposalOverall = short(openOrderRepriceProposal?.overall || "", 48) || null;
  const openOrderRepriceRows = toNum(openOrderRepriceProposal?.summary?.rows);
  const openOrderRepriceReady = toNum(openOrderRepriceProposal?.summary?.readyForApproval);
  const openOrderRepriceWaitingPolicy = toNum(openOrderRepriceProposal?.summary?.waitingPolicy);
  const openOrderRepriceSuggestedRiskBreaches = toNum(openOrderRepriceProposal?.summary?.suggestedRiskCapBreaches);
  const openOrderRepriceNoRiskRoom = toNum(openOrderRepriceProposal?.summary?.blockedNoRiskRoom);
  const openOrderRepriceBrokerMutationAllowed =
    openOrderRepriceProposal?.executionPolicy?.brokerMutationAllowed === true ||
    openOrderRepriceProposal?.summary?.brokerMutationAllowed === true;
  const openOrderRepriceAttempted =
    openOrderRepriceProposal?.executionPolicy?.brokerMutationAttempted === true ||
    openOrderRepriceProposal?.summary?.brokerMutationAttempted === true;
  const openOrderRepriceSubmitted =
    openOrderRepriceProposal?.executionPolicy?.brokerMutationSubmitted === true ||
    openOrderRepriceProposal?.summary?.brokerMutationSubmitted === true;
  const entryOpenRepriceCombinedReady =
    (entryRepricePolicyReady ?? 0) > 0 && (openOrderRepriceReady ?? 0) > 0;
  const entryOpenRepriceBlockedByEntryPolicy =
    (openOrderRepriceReady ?? 0) > 0 && (entryRepricePolicyReady ?? 0) <= 0;
  const entryOpenRepriceBlockedByOpenOrder =
    (entryRepricePolicyReady ?? 0) > 0 && (openOrderRepriceReady ?? 0) <= 0;
  const opsLaneStatusOverall = short(opsLaneStatus?.overall || "", 48) || null;
  const opsLaneBlockedCount = toNum(opsLaneStatus?.summary?.blockedCount);
  const opsLaneManualApprovalCandidates = toNum(opsLaneStatus?.summary?.manualApprovalCandidates);
  const opsLaneAttempted =
    opsLaneStatus?.executionPolicy?.brokerMutationAttempted === true ||
    opsLaneStatus?.summary?.brokerMutationAttempted === true ||
    opsLaneStatus?.executionPolicy?.stateMutationAttempted === true ||
    opsLaneStatus?.summary?.stateMutationAttempted === true;
  const opsLaneSubmitted =
    opsLaneStatus?.executionPolicy?.brokerMutationSubmitted === true ||
    opsLaneStatus?.summary?.brokerMutationSubmitted === true;
  const highPriceMinOneShareOverall = short(highPriceMinOneShareCanaryPlan?.overall || "", 48) || null;
  const highPriceMinOneShareCandidates = toNum(highPriceMinOneShareCanaryPlan?.summary?.candidates);
  const highPriceMinOneShareEligible = toNum(highPriceMinOneShareCanaryPlan?.summary?.eligible);
  const highPriceMinOneShareSelectedSymbol =
    short(highPriceMinOneShareCanaryPlan?.summary?.selectedSymbol || "", 24) || null;
  const highPriceMinOneShareWouldProbe =
    highPriceMinOneShareCanaryPlan?.summary?.wouldGeneratePayloadProbe === true;
  const highPriceMinOneShareAttempted =
    highPriceMinOneShareCanaryPlan?.executionPolicy?.brokerMutationAttempted === true ||
    highPriceMinOneShareCanaryPlan?.summary?.brokerMutationAttempted === true ||
    highPriceMinOneShareCanaryPlan?.executionPolicy?.stateMutationAttempted === true ||
    highPriceMinOneShareCanaryPlan?.summary?.stateMutationAttempted === true;
  const highPriceMinOneShareSubmitted =
    highPriceMinOneShareCanaryPlan?.executionPolicy?.brokerMutationSubmitted === true ||
    highPriceMinOneShareCanaryPlan?.summary?.brokerMutationSubmitted === true;
  const highPriceMinOneShareBrokerMutationAllowed =
    highPriceMinOneShareCanaryPlan?.executionPolicy?.brokerMutationAllowed === true;
  const highPriceMinOneShareStateMutationAllowed =
    highPriceMinOneShareCanaryPlan?.executionPolicy?.stateMutationAllowed === true;

  if (fillabilityOverall === "warn") {
    addCheck(
      checks,
      "warn",
      "fillability_warn",
      short((fillability?.summary?.findings || []).join("; ") || "fillability report returned warn", 320)
    );
  }

  if (fillabilityEntryTooFar != null && fillabilityEntryTooFar > 0) {
    addCheck(
      checks,
      "warn",
      "entry_distance_block",
      `${fillabilityEntryTooFar} candidate(s) exceeded entry-distance policy; route to Stage6 entry/OTE calibration, not broker-submit debugging`
    );
  }

  if (fillabilityHighPriceSize != null && fillabilityHighPriceSize > 0) {
    addCheck(
      checks,
      "warn",
      "high_price_size_block",
      `${fillabilityHighPriceSize} candidate(s) exceeded fixed notional sizing; review min_one_share cap/risk settings before enabling higher-price entries`
    );
  }

  if (
    highPriceMinOneShareBrokerMutationAllowed ||
    highPriceMinOneShareStateMutationAllowed ||
    highPriceMinOneShareAttempted ||
    highPriceMinOneShareSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "high_price_min_one_share_canary_unsafe",
      `high-price min-one-share canary planner must remain report-only; brokerMutationAllowed=${highPriceMinOneShareBrokerMutationAllowed} stateMutationAllowed=${highPriceMinOneShareStateMutationAllowed} attempted=${highPriceMinOneShareAttempted} submitted=${highPriceMinOneShareSubmitted}`
    );
  }

  if (highPriceMinOneShareWouldProbe) {
    addCheck(
      checks,
      "warn",
      "high_price_min_one_share_safe_probe_candidate",
      `safe dry-run min_one_share payload probe candidate selected=${highPriceMinOneShareSelectedSymbol || "N/A"} eligible=${highPriceMinOneShareEligible ?? "N/A"}; broker mutation must stay disabled`
    );
  }

  if (fillabilityInvalidQuoteCount != null && fillabilityInvalidQuoteCount > 0) {
    addCheck(
      checks,
      "warn",
      "fillability_invalid_quote_fallback",
      `${fillabilityInvalidQuoteCount} latest quote(s) had invalid bid/ask and fell back to overlay/monitor price`
    );
  }

  if (fillabilityReentryReviewRequired != null && fillabilityReentryReviewRequired > 0) {
    addCheck(
      checks,
      "warn",
      "terminal_unfilled_reentry_review_required",
      `${fillabilityReentryReviewRequired} terminal unfilled order(s) require fresh Stage6 or explicit retry approval before any re-entry; taxonomy=${fillabilityTerminalUnfilledTaxonomy || "N/A"}`
    );
  }

  if ((fillabilityExpiredLimitNotReached ?? 0) > 0 || (fillabilityExpiredPullbackNotFilled ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "expired_fillability_pullback_not_filled",
      `expired/unfilled taxonomy: limitNotReached=${fillabilityExpiredLimitNotReached ?? 0} pullbackNotFilled=${fillabilityExpiredPullbackNotFilled ?? 0}; keep re-entry in approval/retry lane, not automatic same-hash resubmission`
    );
  }

  if (fillabilityExpiredQuoteInvalid != null && fillabilityExpiredQuoteInvalid > 0) {
    addCheck(
      checks,
      "warn",
      "expired_fillability_quote_invalid",
      `${fillabilityExpiredQuoteInvalid} expired/unfilled order(s) had invalid latest quote; do not use the quote as sole reprice evidence`
    );
  }

  if (orderStateBrokerMutationAllowed || orderStateBrokerMutationAttempted || orderStateBrokerMutationSubmitted) {
    addCheck(
      checks,
      "fail",
      "order_state_consistency_unsafe",
      `order-state consistency audit must remain non-mutating; brokerMutationAllowed=${orderStateBrokerMutationAllowed} attempted=${orderStateBrokerMutationAttempted} submitted=${orderStateBrokerMutationSubmitted}`
    );
  }

  if (orderStateAccountRedaction === "FAIL") {
    addCheck(
      checks,
      "fail",
      "order_state_account_redaction_fail",
      "order-state consistency audit found unredacted account identifier in performance dashboard"
    );
  }

  if ((orderStateFailures ?? 0) > 0) {
    addCheck(
      checks,
      "fail",
      "order_state_consistency_fail",
      `order-state consistency found failures=${orderStateFailures}; workflow step remains report-only unless ORDER_STATE_CONSISTENCY_EXIT_ON_FAIL=true`
    );
  } else if ((orderStateTerminalReconciliationRequired ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "order_state_terminal_reconciliation_required",
      `order-state found terminal reconciliation rows=${orderStateTerminalReconciliationRequired}; sync ledger/idempotency to terminal broker state before treating as clean`
    );
  } else if ((orderStateWarnings ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "order_state_consistency_warn",
      `order-state consistency found warnings=${orderStateWarnings}`
    );
  }

  if (brokerChildReconciliationCriticalCount != null && brokerChildReconciliationCriticalCount > 0) {
    addCheck(
      checks,
      "fail",
      "broker_child_reconciliation_critical",
      `CRITICAL OBSERVE-ONLY: broker child-order reconciliation found ${brokerChildReconciliationCriticalCount} critical held position(s), stopMissing=${brokerChildReconciliationMissingStops ?? "N/A"}, proposedRows=${brokerChildReconciliationProposedRows ?? "N/A"}`
    );
  }

  if (
    brokerChildReconciliationCriticalCount === 0 &&
    brokerChildReconciliationWarningCount != null &&
    brokerChildReconciliationWarningCount > 0
  ) {
    addCheck(
      checks,
      "warn",
      "broker_child_reconciliation_warn",
      `broker child-order reconciliation found ${brokerChildReconciliationWarningCount} warning row(s), targetMissing=${brokerChildReconciliationMissingTargets ?? "N/A"}`
    );
  }

  if (positionProtectionAuditOverall === "fail" || (positionProtectionCritical ?? 0) > 0) {
    addCheck(
      checks,
      "fail",
      "position_protection_root_cause_fail",
      `position protection audit found critical=${positionProtectionCritical ?? "N/A"}, guardMissing=${positionProtectionGuardMetadataMissing ?? "N/A"}, stale=${positionProtectionGuardMetadataStale ?? "N/A"}, invalidGeometry=${positionProtectionInvalidGeometry ?? "N/A"}, brokerChildMissing=${positionProtectionBrokerChildMissing ?? "N/A"}`
    );
  } else if (positionProtectionAuditOverall === "warn" || (positionProtectionWarnings ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "position_protection_root_cause_warn",
      `position protection audit found warnings=${positionProtectionWarnings ?? "N/A"}, guardMissing=${positionProtectionGuardMetadataMissing ?? "N/A"}, stale=${positionProtectionGuardMetadataStale ?? "N/A"}, brokerChildMissing=${positionProtectionBrokerChildMissing ?? "N/A"}`
    );
  }

  if (positionProtectionInvalidGeometry != null && positionProtectionInvalidGeometry > 0) {
    addCheck(
      checks,
      "fail",
      "position_protection_invalid_geometry",
      `${positionProtectionInvalidGeometry} held position(s) have invalid stop/current/target geometry; block repair and route to Stage6/guard metadata drift review`
    );
  }

  if (positionProtectionGuardMetadataMissing != null && positionProtectionGuardMetadataMissing > 0) {
    addCheck(
      checks,
      "warn",
      "position_protection_guard_metadata_missing",
      `${positionProtectionGuardMetadataMissing} held position(s) are missing planned stop/target guard metadata; route to lineage refresh before repair`
    );
  }

  if (positionProtectionGuardMetadataStale != null && positionProtectionGuardMetadataStale > 0) {
    addCheck(
      checks,
      "warn",
      "position_protection_guard_metadata_stale",
      `${positionProtectionGuardMetadataStale} held position(s) use stale planned stop/target metadata; refresh guard metadata before any protective repair submit`
    );
  }

  if (
    guardMetadataRefreshBrokerMutationAllowed ||
    guardMetadataRefreshStateMutationAllowed ||
    guardMetadataRefreshAttempted ||
    guardMetadataRefreshSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "guard_metadata_refresh_plan_unsafe",
      `guard metadata refresh plan must remain report-only; brokerMutationAllowed=${guardMetadataRefreshBrokerMutationAllowed} stateMutationAllowed=${guardMetadataRefreshStateMutationAllowed} attempted=${guardMetadataRefreshAttempted} submitted=${guardMetadataRefreshSubmitted}`
    );
  }

  if (guardMetadataRefreshRepairAfterRefresh != null && guardMetadataRefreshRepairAfterRefresh > 0) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_refresh_repair_reevaluation_ready",
      `${guardMetadataRefreshRepairAfterRefresh} held position(s) can be re-evaluated for protective repair after report-only guard metadata refresh; no broker/state mutation is allowed in this lane`
    );
  }

  if (guardMetadataRefreshNoSource != null && guardMetadataRefreshNoSource > 0) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_refresh_no_source",
      `${guardMetadataRefreshNoSource} held position(s) have no dynamic guard metadata source across broker children/recommendation ledger/Stage6 loop/order ledger`
    );
  }

  if (guardMetadataRefreshStaleSource != null && guardMetadataRefreshStaleSource > 0) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_refresh_stale_source",
      `${guardMetadataRefreshStaleSource} held position(s) only have stale guard metadata sources; wait for fresh Stage6/ledger refresh before repair`
    );
  }

  if (guardMetadataRefreshInvalidGeometry != null && guardMetadataRefreshInvalidGeometry > 0) {
    addCheck(
      checks,
      "fail",
      "guard_metadata_refresh_invalid_geometry",
      `${guardMetadataRefreshInvalidGeometry} held position(s) have invalid refreshed stop/current/target geometry; route to Stage6 guard metadata root-cause analysis`
    );
  }

  if (
    guardMetadataLineageBrokerMutationAllowed ||
    guardMetadataLineageStateMutationAllowed ||
    guardMetadataLineageAttempted ||
    guardMetadataLineageSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "guard_metadata_lineage_audit_unsafe",
      `guard metadata lineage audit must remain report-only; brokerMutationAllowed=${guardMetadataLineageBrokerMutationAllowed} stateMutationAllowed=${guardMetadataLineageStateMutationAllowed} attempted=${guardMetadataLineageAttempted} submitted=${guardMetadataLineageSubmitted}`
    );
  }

  if ((guardMetadataLineageMissing ?? 0) > 0 || (guardMetadataLineageStale ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "guard_metadata_lineage_gap",
      `guard lineage audit found missing=${guardMetadataLineageMissing ?? "N/A"} stale=${guardMetadataLineageStale ?? "N/A"}; source disconnect must be proven before repair`
    );
  }

  if ((guardMetadataLineageInvalid ?? 0) > 0) {
    addCheck(
      checks,
      "fail",
      "guard_metadata_lineage_invalid_geometry",
      `guard lineage audit found invalidGeometry=${guardMetadataLineageInvalid}; repair remains blocked until stop/current/target source is fixed`
    );
  }

  if (
    guardSourceRecoveryBrokerMutationAllowed ||
    guardSourceRecoveryStateMutationAllowed ||
    guardSourceRecoveryAttempted ||
    guardSourceRecoverySubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "guard_source_recovery_plan_unsafe",
      `guard source recovery plan must remain report-only; brokerMutationAllowed=${guardSourceRecoveryBrokerMutationAllowed} stateMutationAllowed=${guardSourceRecoveryStateMutationAllowed} attempted=${guardSourceRecoveryAttempted} submitted=${guardSourceRecoverySubmitted}`
    );
  }

  if ((guardSourceRecoveryFreshRequired ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "guard_source_recovery_fresh_source_required",
      `${guardSourceRecoveryFreshRequired} held position(s) require fresh Stage6 or position-lifecycle guard source before protective repair can be reconsidered`
    );
  }

  if ((guardSourceRecoveryFillRecon ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "guard_source_recovery_fill_state_first",
      `${guardSourceRecoveryFillRecon} held position(s) must complete fill-state reconciliation before guard source recovery or child-order repair`
    );
  }

  if ((guardSourceRecoveryInvalidGeometry ?? 0) > 0) {
    addCheck(
      checks,
      "fail",
      "guard_source_recovery_invalid_geometry",
      `${guardSourceRecoveryInvalidGeometry} held position(s) have invalid guard geometry; route to Stage6/guard metadata root-cause before repair`
    );
  }

  if ((guardSourceRecoveryRepairEligible ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "guard_source_recovery_repair_review_ready",
      `${guardSourceRecoveryRepairEligible} held position(s) have a fresh source and can move to separate report-only protective repair reevaluation`
    );
  }

  if (
    fillStateReconciliationBrokerMutationAllowed ||
    fillStateReconciliationStateMutationAllowed ||
    fillStateReconciliationAttempted ||
    fillStateReconciliationSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "fill_state_reconciliation_unsafe",
      `fill-state reconciliation audit must remain report-only; brokerMutationAllowed=${fillStateReconciliationBrokerMutationAllowed} stateMutationAllowed=${fillStateReconciliationStateMutationAllowed} attempted=${fillStateReconciliationAttempted} submitted=${fillStateReconciliationSubmitted}`
    );
  }

  if ((fillStateReconciliationTerminalReview ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "fill_state_reconciliation_required",
      `${fillStateReconciliationTerminalReview} held position(s) need ledger/idempotency terminal-or-filled reconciliation before any protective repair lane`
    );
  }

  if ((fillStateReconciliationExternal ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "fill_state_external_ownership_review",
      `${fillStateReconciliationExternal} held position(s) appear external/manual; do not attach sidecar protective repair without ownership proof`
    );
  }

  if (
    brokerFillStateEvidenceBrokerMutationAllowed ||
    brokerFillStateEvidenceStateMutationAllowed ||
    brokerFillStateEvidenceAttempted ||
    brokerFillStateEvidenceSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "broker_fill_state_evidence_unsafe",
      `broker fill-state evidence must remain GET-only; brokerMutationAllowed=${brokerFillStateEvidenceBrokerMutationAllowed} stateMutationAllowed=${brokerFillStateEvidenceStateMutationAllowed} attempted=${brokerFillStateEvidenceAttempted} submitted=${brokerFillStateEvidenceSubmitted}`
    );
  }

  if (brokerFillStateEvidenceOverall === "blocked_non_paper_base_url") {
    addCheck(
      checks,
      "warn",
      "broker_fill_state_evidence_non_paper_blocked",
      "broker fill-state read evidence is blocked unless ALPACA_BASE_URL is the paper endpoint"
    );
  } else if (brokerFillStateEvidenceOverall === "broker_credentials_missing") {
    addCheck(
      checks,
      "warn",
      "broker_fill_state_evidence_credentials_missing",
      "broker fill-state evidence could not query Alpaca because credentials are unavailable"
    );
  }

  if ((brokerFillStateEvidenceInconclusive ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "broker_fill_state_evidence_inconclusive",
      `${brokerFillStateEvidenceInconclusive} held position(s) still lack filled/terminal broker evidence after GET-only read`
    );
  }

  if ((brokerFillStateEvidenceWorking ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "broker_fill_state_evidence_working_order",
      `${brokerFillStateEvidenceWorking} held position(s) still show working broker order evidence; do not terminalize ledger yet`
    );
  }

  if ((brokerFillStateEvidenceFilled ?? 0) > 0 || (brokerFillStateEvidenceTerminal ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "broker_fill_state_terminal_or_filled_evidence_ready",
      `broker GET-only evidence found filled=${brokerFillStateEvidenceFilled ?? 0} terminalUnfilled=${brokerFillStateEvidenceTerminal ?? 0}; route to report-only terminalization proposal review`
    );
  }

  if (
    ledgerTerminalizationBrokerMutationAllowed ||
    ledgerTerminalizationStateMutationAllowed ||
    ledgerTerminalizationAttempted ||
    ledgerTerminalizationSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "ledger_terminalization_proposal_unsafe",
      `ledger terminalization proposal must never write state in this lane; brokerMutationAllowed=${ledgerTerminalizationBrokerMutationAllowed} stateMutationAllowed=${ledgerTerminalizationStateMutationAllowed} attempted=${ledgerTerminalizationAttempted} submitted=${ledgerTerminalizationSubmitted}`
    );
  }

  if ((ledgerTerminalizationReady ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "ledger_terminalization_manual_review_ready",
      `${ledgerTerminalizationReady} row(s) have report-only ledger/idempotency terminalization patches ready; applying them requires a separate scoped state migration task`
    );
  } else if ((ledgerTerminalizationRows ?? 0) > 0 && (ledgerTerminalizationBlocked ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "ledger_terminalization_blocked",
      `${ledgerTerminalizationBlocked} row(s) remain blocked from terminalization; keep protective repair blocked`
    );
  }

  if (
    ledgerFilledMigrationBrokerMutationAllowed ||
    ledgerFilledMigrationStateMutationAllowed ||
    ledgerFilledMigrationAttempted ||
    ledgerFilledMigrationSubmitted ||
    ledgerFilledMigrationStateApplied
  ) {
    addCheck(
      checks,
      "fail",
      "ledger_filled_migration_plan_unsafe",
      `ledger filled migration plan must remain report-first; brokerMutationAllowed=${ledgerFilledMigrationBrokerMutationAllowed} stateMutationAllowed=${ledgerFilledMigrationStateMutationAllowed} attempted=${ledgerFilledMigrationAttempted} submitted=${ledgerFilledMigrationSubmitted} stateApplied=${ledgerFilledMigrationStateApplied}`
    );
  }

  if ((ledgerFilledMigrationReady ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "ledger_filled_migration_apply_review_ready",
      `${ledgerFilledMigrationReady} filled migration row(s) have backup/diff/audit previews ready; state write is still blocked until a separate scoped migration task`
    );
  } else if ((ledgerFilledMigrationRows ?? 0) > 0 && (ledgerFilledMigrationBlocked ?? 0) > 0) {
    addCheck(
      checks,
      "warn",
      "ledger_filled_migration_blocked",
      `${ledgerFilledMigrationBlocked} filled migration row(s) are blocked by backup/diff/audit gates`
    );
  }

  if (ledgerFilledMigrationApplyBrokerMutationAllowed || ledgerFilledMigrationApplySubmitted) {
    addCheck(
      checks,
      "fail",
      "ledger_filled_migration_apply_broker_mutation_unsafe",
      `filled migration apply lane is state-only; brokerMutationAllowed=${ledgerFilledMigrationApplyBrokerMutationAllowed} brokerSubmitted=${ledgerFilledMigrationApplySubmitted}`
    );
  }

  if (
    ledgerFilledMigrationApplyStateApplied &&
    (!ledgerFilledMigrationApplyApprovalProvided ||
      !ledgerFilledMigrationApplyBackupCreated ||
      (ledgerFilledMigrationApplyPostVerifiedRows ?? 0) <= 0)
  ) {
    addCheck(
      checks,
      "fail",
      "ledger_filled_migration_apply_missing_safety_evidence",
      `stateApplied=true requires approval, backup, and post verification; approval=${ledgerFilledMigrationApplyApprovalProvided} backup=${ledgerFilledMigrationApplyBackupCreated} postVerified=${ledgerFilledMigrationApplyPostVerifiedRows ?? "N/A"}`
    );
  } else if (ledgerFilledMigrationApplyStateApplied) {
    addCheck(
      checks,
      "warn",
      "ledger_filled_migration_state_applied",
      `${ledgerFilledMigrationApplyPostVerifiedRows ?? 0} filled migration row(s) were state-applied with backup/audit/post verification; rerun fill-state and guard source recovery before repair`
    );
  } else if (ledgerFilledMigrationApplyOverall === "apply_not_requested_ready_rows_present") {
    addCheck(
      checks,
      "warn",
      "ledger_filled_migration_apply_not_requested",
      `${ledgerFilledMigrationApplySelectedRows ?? 0} filled migration row(s) are ready but apply was not requested`
    );
  } else if (ledgerFilledMigrationApplyOverall === "apply_blocked_by_safety_gates") {
    addCheck(
      checks,
      "warn",
      "ledger_filled_migration_apply_blocked",
      "filled migration apply was requested but blocked by approval/hash/scope gates"
    );
  }

  if (guardedRepairExecutionReadyRows != null && guardedRepairExecutionReadyRows > 0) {
    addCheck(
      checks,
      "fail",
      "guarded_repair_plan_unsafe",
      `guarded repair planner produced ${guardedRepairExecutionReadyRows} execution-ready row(s); report-only planner must never mark rows executable`
    );
  }

  if (guardedRepairCandidates != null && guardedRepairCandidates > 0) {
    addCheck(
      checks,
      "warn",
      "guarded_repair_plan_report_only",
      `guarded repair planner found ${guardedRepairCandidates} repair candidate row(s), blockedByReportOnly=${guardedRepairBlockedByReportOnly ?? "N/A"}, blockingGates=${guardedRepairBlockingGates ?? "N/A"}`
    );
  }

  if (persistentOcoRepairBrokerMutationAllowed || persistentOcoRepairAttempted || persistentOcoRepairSubmitted) {
    addCheck(
      checks,
      "fail",
      "persistent_oco_repair_plan_unsafe",
      `persistent OCO repair plan must remain non-mutating; brokerMutationAllowed=${persistentOcoRepairBrokerMutationAllowed} attempted=${persistentOcoRepairAttempted} submitted=${persistentOcoRepairSubmitted}`
    );
  }

  if (persistentOcoRepairPlanOverall === "manual_approval_required") {
    addCheck(
      checks,
      "warn",
      "persistent_oco_repair_manual_approval_required",
      `persistent OCO repair planner selected dynamic row=${persistentOcoRepairSelectedSymbol || "N/A"} qty=${persistentOcoRepairSelectedQty ?? "N/A"} from eligible=${persistentOcoRepairEligible ?? "N/A"}; no broker mutation is allowed without separate approval`
    );
  } else if (persistentOcoRepairPlanOverall === "blocked_no_eligible_row") {
    addCheck(
      checks,
      "warn",
      "persistent_oco_repair_no_eligible_row",
      `persistent OCO repair planner found no eligible row; rows=${persistentOcoRepairRows ?? "N/A"}`
    );
  }

  if (
    limitedMultiOcoRepairBrokerMutationAllowed ||
    limitedMultiOcoRepairAttempted ||
    limitedMultiOcoRepairSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "limited_multi_oco_repair_plan_unsafe",
      `limited multi OCO repair planner must remain non-mutating; brokerMutationAllowed=${limitedMultiOcoRepairBrokerMutationAllowed} attempted=${limitedMultiOcoRepairAttempted} submitted=${limitedMultiOcoRepairSubmitted}`
    );
  }

  if (limitedMultiOcoRepairPlanOverall === "manual_batch_approval_required") {
    addCheck(
      checks,
      "warn",
      "limited_multi_oco_repair_manual_batch_approval_required",
      `limited multi OCO planner selected ${limitedMultiOcoRepairSelected ?? "N/A"} row(s), symbols=${limitedMultiOcoRepairSelectedSymbols || "N/A"}; actual submit remains outside this planner and requires exact scoped approval`
    );
  } else if (limitedMultiOcoRepairPlanOverall === "blocked_no_eligible_row") {
    addCheck(
      checks,
      "warn",
      "limited_multi_oco_repair_no_eligible_row",
      `limited multi OCO planner found no eligible row; alreadyProtected=${limitedMultiOcoRepairAlreadyProtected ?? "N/A"} ownershipReview=${limitedMultiOcoRepairOwnershipReview ?? "N/A"} guardMissing=${limitedMultiOcoRepairGuardMissing ?? "N/A"}`
    );
  }

  if (
    persistentOcoOpenVerifyMultiBrokerMutationAllowed ||
    persistentOcoOpenVerifyMultiAttempted ||
    persistentOcoOpenVerifyMultiSubmitted
  ) {
    addCheck(
      checks,
      "fail",
      "persistent_oco_multi_verify_unsafe",
      `multi open verifier must remain GET-only; brokerMutationAllowed=${persistentOcoOpenVerifyMultiBrokerMutationAllowed} attempted=${persistentOcoOpenVerifyMultiAttempted} submitted=${persistentOcoOpenVerifyMultiSubmitted}`
    );
  }

  if (persistentOcoOpenVerifyMultiOverall === "fail" || (persistentOcoOpenVerifyMultiFailCount ?? 0) > 0) {
    addCheck(
      checks,
      "fail",
      "persistent_oco_multi_verify_failed",
      `persistent OCO multi open verifier failed for ${persistentOcoOpenVerifyMultiFailCount ?? "N/A"} row(s), symbols=${persistentOcoOpenVerifyMultiSymbols || "N/A"}`
    );
  } else if (persistentOcoOpenVerifyMultiOverall === "pass") {
    addCheck(
      checks,
      "pass",
      "persistent_oco_multi_verify_pass",
      `persistent OCO multi open verifier confirmed ${persistentOcoOpenVerifyMultiPassCount ?? "N/A"}/${persistentOcoOpenVerifyMultiReports ?? "N/A"} row(s), symbols=${persistentOcoOpenVerifyMultiSymbols || "N/A"}`
    );
  }

  if (alpacaPayloadSchemaFailCount != null && alpacaPayloadSchemaFailCount > 0) {
    addCheck(
      checks,
      "fail",
      "alpaca_payload_schema_fixture_fail",
      `Alpaca official-schema fixture validation failed for ${alpacaPayloadSchemaFailCount} fixture(s); keep guarded repair report-only`
    );
  }

  if (
    alpacaPayloadSchemaFailCount === 0 &&
    alpacaPayloadSchemaWarnCount != null &&
    alpacaPayloadSchemaWarnCount > 0
  ) {
    addCheck(
      checks,
      "warn",
      "alpaca_payload_schema_fixture_warn",
      `Alpaca payload fixture validation has ${alpacaPayloadSchemaWarnCount} warning(s); review before paper fixture submit`
    );
  }

  if (alpacaOcoResponseFailCount != null && alpacaOcoResponseFailCount > 0) {
    addCheck(
      checks,
      "fail",
      "alpaca_oco_response_fixture_fail",
      `Alpaca OCO response fixture validation failed for ${alpacaOcoResponseFailCount} fixture(s); do not run paper OCO canary`
    );
  }

  if (
    alpacaOcoResponseFailCount === 0 &&
    alpacaOcoResponseWarnCount != null &&
    alpacaOcoResponseWarnCount > 0
  ) {
    addCheck(
      checks,
      "warn",
      "alpaca_oco_response_fixture_warn",
      `Alpaca OCO response fixture validation has ${alpacaOcoResponseWarnCount} warning(s); review before paper canary`
    );
  }

  if (paperOcoCanaryBrokerMutationAllowed || (paperOcoCanaryExecutionReadyRows != null && paperOcoCanaryExecutionReadyRows > 0)) {
    addCheck(
      checks,
      "fail",
      "paper_oco_canary_selector_unsafe",
      `paper OCO canary selector must remain report-only; brokerMutationAllowed=${paperOcoCanaryBrokerMutationAllowed} executionReady=${paperOcoCanaryExecutionReadyRows ?? "N/A"}`
    );
  }

  if (paperOcoCanaryOverall === "manual_selection_ready") {
    addCheck(
      checks,
      "warn",
      "paper_oco_canary_manual_selection_ready",
      `paper OCO canary selector found ${paperOcoCanaryEligible ?? "N/A"} eligible dynamic candidate(s); selected=${paperOcoCanarySelectedSymbol || "N/A"} remains blocked pending separate approval`
    );
  } else if (paperOcoCanaryOverall === "blocked" || paperOcoCanaryOverall === "requested_symbol_blocked") {
    addCheck(
      checks,
      "warn",
      "paper_oco_canary_blocked",
      `paper OCO canary selector overall=${paperOcoCanaryOverall}; no symbol should be submitted`
    );
  }

  if (
    paperOcoApprovalGateBrokerMutationAllowed ||
    (paperOcoApprovalGateExecutionReadyRows != null && paperOcoApprovalGateExecutionReadyRows > 0)
  ) {
    addCheck(
      checks,
      "fail",
      "paper_oco_approval_gate_unsafe",
      `paper OCO approval gate must remain non-mutating; brokerMutationAllowed=${paperOcoApprovalGateBrokerMutationAllowed} executionReady=${paperOcoApprovalGateExecutionReadyRows ?? "N/A"}`
    );
  }

  if (paperOcoApprovalGateOverall === "manual_approval_required") {
    addCheck(
      checks,
      "warn",
      "paper_oco_approval_required",
      `paper OCO approval gate is ready for manual review only; selected=${paperOcoApprovalGateSelectedSymbol || "N/A"} decision=${paperOcoApprovalGateDecision || "N/A"}`
    );
  } else if (paperOcoApprovalGateOverall === "blocked") {
    addCheck(
      checks,
      "warn",
      "paper_oco_approval_blocked",
      `paper OCO approval gate blocked future submit; decision=${paperOcoApprovalGateDecision || "N/A"}`
    );
  } else if (paperOcoApprovalGateOverall === "fail") {
    addCheck(
      checks,
      "fail",
      "paper_oco_approval_gate_fail",
      `paper OCO approval gate failed safety checks; decision=${paperOcoApprovalGateDecision || "N/A"}`
    );
  }

  if (paperOcoSubmitGateSubmitted) {
    addCheck(
      checks,
      "warn",
      "paper_oco_submit_gate_submitted",
      `paper OCO canary submit gate reports submitted=true; verify nested visibility and manual rollback readiness immediately`
    );
  } else if (paperOcoSubmitGateAttempted) {
    addCheck(
      checks,
      "warn",
      "paper_oco_submit_gate_attempted_not_submitted",
      `paper OCO canary submit gate attempted broker mutation but submitted=false; decision=${paperOcoSubmitGateDecision || "N/A"}`
    );
  }

  if (paperOcoSubmitGateOverall === "fail") {
    addCheck(
      checks,
      "fail",
      "paper_oco_submit_gate_fail",
      `paper OCO canary submit gate failed; decision=${paperOcoSubmitGateDecision || "N/A"}`
    );
  }

  if (entryRepricePolicyBrokerMutationAllowed || entryRepricePolicyAttempted || entryRepricePolicySubmitted) {
    addCheck(
      checks,
      "fail",
      "entry_reprice_policy_unsafe",
      `entry/reprice policy decision must remain report-only; brokerMutationAllowed=${entryRepricePolicyBrokerMutationAllowed} attempted=${entryRepricePolicyAttempted} submitted=${entryRepricePolicySubmitted}`
    );
  }

  if (entryRepricePolicyFloorChangeRecommended) {
    addCheck(
      checks,
      "fail",
      "entry_reprice_policy_floor_change",
      "entry/reprice policy report recommended changing the fillability floor; this lane must classify price/RR routing without lowering the floor"
    );
  }

  if (entryOpenRepriceCombinedReady) {
    addCheck(
      checks,
      "warn",
      "entry_open_order_reprice_manual_approval_required",
      `entry/reprice policy and risk-capped open-order proposal are both ready; entryReady=${entryRepricePolicyReady} openRepriceReady=${openOrderRepriceReady}; no broker mutation is allowed without separate approval`
    );
  } else if (entryOpenRepriceBlockedByEntryPolicy) {
    addCheck(
      checks,
      "warn",
      "open_order_reprice_wait_entry_policy_alignment",
      `risk-capped open-order reprice proposal has ${openOrderRepriceReady} ready row(s), but entry/reprice policy ready=0; keep report-only wait-pullback route`
    );
  } else if (entryOpenRepriceBlockedByOpenOrder) {
    addCheck(
      checks,
      "warn",
      "entry_reprice_wait_open_order_reprice_ready",
      `entry/reprice policy has ${entryRepricePolicyReady} ready row(s), but open-order proposal ready=0; do not request replace approval yet`
    );
  }

  if (entryRepricePolicyRrBelowMin != null && entryRepricePolicyRrBelowMin > 0) {
    addCheck(
      checks,
      "warn",
      "entry_reprice_policy_wait_rr_below_min",
      `${entryRepricePolicyRrBelowMin} candidate(s) have current-price RR below policy floor; keep Stage6 pullback limit rather than lowering fillability floor`
    );
  }

  if (entryRepricePolicyDistanceWait != null && entryRepricePolicyDistanceWait > 0) {
    addCheck(
      checks,
      "warn",
      "entry_reprice_policy_wait_distance",
      `${entryRepricePolicyDistanceWait} candidate(s) are above adaptive/reprice distance band; keep wait-pullback route`
    );
  }

  if (openOrderRepriceBrokerMutationAllowed || openOrderRepriceAttempted || openOrderRepriceSubmitted) {
    addCheck(
      checks,
      "fail",
      "open_order_reprice_proposal_unsafe",
      `open-order reprice proposal must remain report-only; brokerMutationAllowed=${openOrderRepriceBrokerMutationAllowed} attempted=${openOrderRepriceAttempted} submitted=${openOrderRepriceSubmitted}`
    );
  }

  if (openOrderRepriceSuggestedRiskBreaches != null && openOrderRepriceSuggestedRiskBreaches > 0) {
    addCheck(
      checks,
      "warn",
      "open_order_reprice_suggested_risk_cap",
      `${openOrderRepriceSuggestedRiskBreaches} open order(s) would breach maxRisk if repriced to current/suggested; use risk-capped limit instead`
    );
  }

  if (openOrderRepriceNoRiskRoom != null && openOrderRepriceNoRiskRoom > 0) {
    addCheck(
      checks,
      "warn",
      "open_order_reprice_no_risk_room",
      `${openOrderRepriceNoRiskRoom} open order(s) have no risk-cap room above current limit`
    );
  }

  if (opsLaneAttempted || opsLaneSubmitted) {
    addCheck(
      checks,
      "fail",
      "ops_lane_status_unsafe",
      `ops lane status report must remain report-only; attempted=${opsLaneAttempted} submitted=${opsLaneSubmitted}`
    );
  }

  if (opsLaneBlockedCount != null && opsLaneBlockedCount > 0) {
    addCheck(
      checks,
      "warn",
      "ops_lane_status_blocked_lanes",
      `${opsLaneBlockedCount} status lane(s) are blocked or require root-cause review`
    );
  }

  if (perfGateParsed && simulationRows != null && perfGateParsed.current !== simulationRows) {
    addCheck(
      checks,
      "warn",
      "perf_gate_progress_mismatch",
      `gateProgress current=${perfGateParsed.current} but simulation totalRows=${simulationRows}; run summary/dashboard may be out of sync`
    );
  }

  const progressPairs = [
    ["hfTuningPhase", tuningGateProgress],
    ["hfNextAction", nextActionGateProgress],
    ["hfDailyVerdict", dailyVerdictGateProgress]
  ].filter(([, value]) => value);
  const uniqueProgress = Array.from(new Set(progressPairs.map(([, value]) => String(value))));
  if (uniqueProgress.length > 1) {
    addCheck(
      checks,
      "warn",
      "gate_progress_source_mismatch",
      progressPairs.map(([source, value]) => `${source}:${value}`).join(", ")
    );
  }

  const remainingPairs = [
    ["hfTuningPhase", tuningGateRemaining],
    ["hfNextAction", nextActionGateRemaining],
    ["hfDailyVerdict", dailyVerdictGateRemaining]
  ].filter(([, value]) => value != null);
  const uniqueRemaining = Array.from(new Set(remainingPairs.map(([, value]) => Number(value))));
  if (uniqueRemaining.length > 1) {
    addCheck(
      checks,
      "warn",
      "gate_remaining_source_mismatch",
      remainingPairs.map(([source, value]) => `${source}:${value}`).join(", ")
    );
  }

  if (
    perfGateParsed &&
    perfGateRemainingTrades != null &&
    perfGateRemainingComputed != null &&
    perfGateRemainingTrades !== perfGateRemainingComputed
  ) {
    addCheck(
      checks,
      "warn",
      "perf_gate_remaining_mismatch",
      `gateRemainingTrades=${perfGateRemainingTrades} but computed=${perfGateRemainingComputed} from progress=${perfGateProgress}`
    );
  }

  const observedTrades = toNum(preview?.hfTuningPhase?.observedTrades);
  const requiredTrades = toNum(preview?.hfTuningPhase?.requiredTrades);
  if (perfGateParsed && observedTrades != null && observedTrades !== perfGateParsed.current) {
    addCheck(
      checks,
      "warn",
      "tuning_observed_trades_mismatch",
      `hfTuningPhase.observedTrades=${observedTrades} but gateProgress current=${perfGateParsed.current}`
    );
  }
  if (perfGateParsed && requiredTrades != null && requiredTrades !== perfGateParsed.required) {
    addCheck(
      checks,
      "warn",
      "tuning_required_trades_mismatch",
      `hfTuningPhase.requiredTrades=${requiredTrades} but gateProgress required=${perfGateParsed.required}`
    );
  }

  if (simulationRowSnapshotGap != null && simulationRowSnapshotGap >= 5) {
    addCheck(
      checks,
      "warn",
      "simulation_snapshot_lag",
      `simulation row/snapshot gap is ${simulationRowSnapshotGap} (coverage=${fmt(simulationSnapshotCoveragePct)}%); snapshot refresh may lag`
    );
  }

  if (hfAlertTriggered === true) {
    addCheck(
      checks,
      "warn",
      "hf_alert_triggered",
      `HF alert is active${hfAlertReason ? ` (${hfAlertReason})` : ""}; keep observe mode until cleared`
    );
  }

  const markerMissing = parseMarkerMissingKeys(markerAudit || preview?.hfMarkerAudit);
  if (markerMissing.length > 0) {
    addCheck(
      checks,
      "warn",
      "hf_marker_audit_gap",
      `marker status missing/non-applicable on keys: ${markerMissing.slice(0, 8).join(", ")}`
    );
  }

  const guardLevel = toNum(guard?.level);
  const haltNewEntries =
    typeof guardControl?.haltNewEntries === "boolean" ? guardControl.haltNewEntries : null;
  if (kind === "market_guard" && guard && guardLevel == null) {
    addCheck(checks, "warn", "guard_level_unknown", "market guard summary has no numeric level");
  }

  const liveAvailable =
    typeof perf?.live?.available === "boolean" ? perf.live.available : null;
  const liveReturnPct = toNum(perf?.live?.totals?.totalReturnPct);
  const liveBrokerStopMissingCount = toNum(perf?.live?.totals?.brokerStopMissingCount);
  const liveBrokerTargetMissingCount = toNum(perf?.live?.totals?.brokerTargetMissingCount);
  const liveGuardMissingCount = toNum(perf?.live?.totals?.guardMissingCount);
  const liveFillStateMismatchCount = toNum(perf?.live?.totals?.fillStateMismatchCount);
  const livePositionDetails = Array.isArray(perf?.live?.positions)
    ? perf.live.positions
      .slice(0, 10)
      .map((row) => {
        const symbol = short(row?.symbol || "N/A", 16).toUpperCase();
        return `${symbol}:tp=${fmt(toNum(row?.targetPrice))},sl=${fmt(toNum(row?.stopPrice))},uPnL=${fmt(toNum(row?.unrealizedPl))},status=${short(row?.positionStatus || "N/A", 48)},fill=${short(row?.normalizedFillState || "N/A", 32)}`;
      })
      .join("; ")
    : "";
  if (liveReturnPct != null && Math.abs(liveReturnPct) > 200) {
    addCheck(
      checks,
      "warn",
      "live_return_outlier",
      `live return looks extreme (${fmt(liveReturnPct)}%); verify percent scaling`
    );
  }

  if (liveBrokerStopMissingCount != null && liveBrokerStopMissingCount > 0) {
    addCheck(
      checks,
      "fail",
      "broker_stop_child_missing",
      `CRITICAL OBSERVE-ONLY: ${liveBrokerStopMissingCount} held position(s) have planned stop metadata but no broker-side stop child found via Alpaca open orders nested=true`
    );
  }

  if (liveBrokerTargetMissingCount != null && liveBrokerTargetMissingCount > 0) {
    addCheck(
      checks,
      "warn",
      "broker_target_child_missing",
      `${liveBrokerTargetMissingCount} held position(s) have planned target metadata but no broker-side target child found via Alpaca open orders nested=true`
    );
  }

  if (liveGuardMissingCount != null && liveGuardMissingCount > 0) {
    addCheck(
      checks,
      "warn",
      "live_position_guard_missing",
      `${liveGuardMissingCount} held position(s) missing stop/target guard metadata in performance dashboard`
    );
  }

  if (liveFillStateMismatchCount != null && liveFillStateMismatchCount > 0) {
    addCheck(
      checks,
      "warn",
      "live_fill_state_mismatch",
      `${liveFillStateMismatchCount} held position(s) disagree across order-ledger/idempotency/fillability state`
    );
  }

  if (checks.length === 0) {
    addCheck(checks, "pass", "pipeline_health", "no immediate blocker found");
  }

  const overall = checks.some((row) => row.status === "fail")
    ? "fail"
    : checks.some((row) => row.status === "warn")
      ? "warn"
      : "pass";

  const report = {
    generatedAt: toIso(Date.now()),
    kind,
    overall,
    files: {
      preview: Boolean(preview),
      guard: Boolean(guard),
      guardControl: Boolean(guardControl),
      perf: Boolean(perf),
      orderStateConsistency: Boolean(orderStateConsistency),
      brokerChildReconciliation: Boolean(brokerChildReconciliation),
      positionProtectionAudit: Boolean(positionProtectionAudit),
      guardMetadataRefreshPlan: Boolean(guardMetadataRefreshPlan),
      guardMetadataLineageAudit: Boolean(guardMetadataLineageAudit),
      guardSourceRecoveryPlan: Boolean(guardSourceRecoveryPlan),
      fillStateReconciliationAudit: Boolean(fillStateReconciliationAudit),
      brokerFillStateEvidence: Boolean(brokerFillStateEvidence),
      ledgerTerminalizationProposal: Boolean(ledgerTerminalizationProposal),
      ledgerFilledMigrationPlan: Boolean(ledgerFilledMigrationPlan),
      ledgerFilledMigrationApply: Boolean(ledgerFilledMigrationApply),
      guardedRepairPlan: Boolean(guardedRepairPlan),
      persistentOcoRepairPlan: Boolean(persistentOcoRepairPlan),
      limitedMultiOcoRepairPlan: Boolean(limitedMultiOcoRepairPlan),
      persistentOcoOpenVerifyMulti: Boolean(persistentOcoOpenVerifyMulti),
      alpacaPayloadSchema: Boolean(alpacaPayloadSchema),
      alpacaOcoResponseFixture: Boolean(alpacaOcoResponseFixture),
      paperOcoCanaryCandidate: Boolean(paperOcoCanaryCandidate),
      paperOcoApprovalGate: Boolean(paperOcoApprovalGate),
      paperOcoSubmitGate: Boolean(paperOcoSubmitGate),
      entryRepricePolicyDecision: Boolean(entryRepricePolicyDecision),
      openOrderRepriceProposal: Boolean(openOrderRepriceProposal),
      opsLaneStatus: Boolean(opsLaneStatus),
      highPriceMinOneShareCanaryPlan: Boolean(highPriceMinOneShareCanaryPlan),
      fillability: Boolean(fillability),
      markerAudit: Boolean(markerAudit || preview?.hfMarkerAudit)
    },
    metrics: {
      stage6Hash,
      payloadCount,
      skippedCount,
      perfGateProgress,
      perfGateCurrentTrades: perfGateParsed?.current ?? null,
      perfGateRequiredTrades: perfGateParsed?.required ?? null,
      perfGateRemainingTrades,
      perfGateRemainingComputed,
      hfAlertTriggered: typeof hfAlertTriggered === "boolean" ? hfAlertTriggered : null,
      hfAlertReason,
      simulationRows,
      simulationSnapshotTrades,
      simulationRowSnapshotGap,
      simulationSnapshotCoveragePct,
      fillabilityOverall,
      fillabilityFills,
      fillabilityRepricedWaiting,
      fillabilityOpenReprice,
      fillabilityOpenCancel,
      fillabilityEntryTooFar,
      fillabilityHighPriceSize,
      fillabilityInvalidQuoteCount,
      fillabilityTerminalUnfilledTaxonomy,
      fillabilityExpiredLimitNotReached,
      fillabilityExpiredQuoteInvalid,
      fillabilityExpiredPullbackNotFilled,
      fillabilityReentryReviewRequired,
      orderStateOverall,
      orderStateFailures,
      orderStateWarnings,
      orderStateTerminalReconciliationRequired,
      orderStateTerminalConflicts,
      orderStateAccountRedaction,
      orderStateExitOnFail,
      brokerChildReconciliationOverall,
      brokerChildReconciliationCriticalCount,
      brokerChildReconciliationWarningCount,
      brokerChildReconciliationProposedRows,
      brokerChildReconciliationMissingStops,
      brokerChildReconciliationMissingTargets,
      positionProtectionAuditOverall,
      positionProtectionPositions,
      positionProtectionCritical,
      positionProtectionWarnings,
      positionProtectionGuardMetadataMissing,
      positionProtectionGuardMetadataStale,
      positionProtectionInvalidGeometry,
      positionProtectionStopCurrentDrift,
      positionProtectionBrokerChildMissing,
      positionProtectionBrokerStopMissing,
      positionProtectionBrokerTargetMissing,
      guardMetadataRefreshOverall,
      guardMetadataRefreshReady,
      guardMetadataRefreshBlocked,
      guardMetadataRefreshNoSource,
      guardMetadataRefreshStaleSource,
      guardMetadataRefreshInvalidGeometry,
      guardMetadataRefreshRepairAfterRefresh,
      guardMetadataRefreshAttempted,
      guardMetadataRefreshSubmitted,
      guardMetadataLineageOverall,
      guardMetadataLineageReady,
      guardMetadataLineageMissing,
      guardMetadataLineageStale,
      guardMetadataLineageInvalid,
      guardMetadataLineageRootCauses,
      guardMetadataLineageFreshnessStatuses,
      guardMetadataLineageAttempted,
      guardMetadataLineageSubmitted,
      guardSourceRecoveryOverall,
      guardSourceRecoveryFreshRequired,
      guardSourceRecoveryFillRecon,
      guardSourceRecoveryOwnershipReview,
      guardSourceRecoveryInvalidGeometry,
      guardSourceRecoveryRepairEligible,
      guardSourceRecoveryAttempted,
      guardSourceRecoverySubmitted,
      fillStateReconciliationOverall,
      fillStateReconciliationConfirmedFilled,
      fillStateReconciliationOpenLedger,
      fillStateReconciliationTerminalNotFilled,
      fillStateReconciliationDivergence,
      fillStateReconciliationExternal,
      fillStateReconciliationTerminalReview,
      fillStateReconciliationAttempted,
      fillStateReconciliationSubmitted,
      brokerFillStateEvidenceOverall,
      brokerFillStateEvidenceCandidates,
      brokerFillStateEvidenceReadAttempted,
      brokerFillStateEvidenceFilled,
      brokerFillStateEvidenceTerminal,
      brokerFillStateEvidenceWorking,
      brokerFillStateEvidenceInconclusive,
      brokerFillStateEvidenceAttempted,
      brokerFillStateEvidenceSubmitted,
      ledgerTerminalizationOverall,
      ledgerTerminalizationRows,
      ledgerTerminalizationReady,
      ledgerTerminalizationFilledReady,
      ledgerTerminalizationUnfilledReady,
      ledgerTerminalizationBlocked,
      ledgerTerminalizationAttempted,
      ledgerTerminalizationSubmitted,
      ledgerFilledMigrationOverall,
      ledgerFilledMigrationRows,
      ledgerFilledMigrationReady,
      ledgerFilledMigrationBlocked,
      ledgerFilledMigrationBackupRequired,
      ledgerFilledMigrationDiffRows,
      ledgerFilledMigrationAuditRows,
      ledgerFilledMigrationAttempted,
      ledgerFilledMigrationSubmitted,
      ledgerFilledMigrationStateApplied,
      ledgerFilledMigrationApplyOverall,
      ledgerFilledMigrationApplySelectedRows,
      ledgerFilledMigrationApplyPostVerifiedRows,
      ledgerFilledMigrationApplyBackupCreated,
      ledgerFilledMigrationApplyAttempted,
      ledgerFilledMigrationApplySubmitted,
      ledgerFilledMigrationApplyStateApplied,
      guardedRepairPlanOverall,
      guardedRepairCandidates,
      guardedRepairBlockedByReportOnly,
      guardedRepairExecutionReadyRows,
      guardedRepairBlockingGates,
      persistentOcoRepairPlanOverall,
      persistentOcoRepairRows,
      persistentOcoRepairEligible,
      persistentOcoRepairSelectedSymbol,
      persistentOcoRepairSelectedQty,
      persistentOcoRepairAttempted,
      persistentOcoRepairSubmitted,
      limitedMultiOcoRepairPlanOverall,
      limitedMultiOcoRepairRows,
      limitedMultiOcoRepairEligible,
      limitedMultiOcoRepairSelected,
      limitedMultiOcoRepairSelectedSymbols,
      limitedMultiOcoRepairAlreadyProtected,
      limitedMultiOcoRepairOwnershipReview,
      limitedMultiOcoRepairGuardMissing,
      limitedMultiOcoRepairAttempted,
      limitedMultiOcoRepairSubmitted,
      persistentOcoOpenVerifyMultiOverall,
      persistentOcoOpenVerifyMultiReports,
      persistentOcoOpenVerifyMultiPassCount,
      persistentOcoOpenVerifyMultiFailCount,
      persistentOcoOpenVerifyMultiSymbols,
      persistentOcoOpenVerifyMultiAttempted,
      persistentOcoOpenVerifyMultiSubmitted,
      alpacaPayloadSchemaOverall,
      alpacaPayloadSchemaFixtureCount,
      alpacaPayloadSchemaFailCount,
      alpacaPayloadSchemaWarnCount,
      alpacaOcoResponseOverall,
      alpacaOcoResponseFixtureCount,
      alpacaOcoResponseFailCount,
      alpacaOcoResponseWarnCount,
      paperOcoCanaryOverall,
      paperOcoCanaryRows,
      paperOcoCanaryEligible,
      paperOcoCanaryExecutionReadyRows,
      paperOcoCanarySelectedSymbol,
      paperOcoApprovalGateOverall,
      paperOcoApprovalGateDecision,
      paperOcoApprovalGateSelectedSymbol,
      paperOcoApprovalGateExecutionReadyRows,
      paperOcoSubmitGateOverall,
      paperOcoSubmitGateDecision,
      paperOcoSubmitGateAttempted,
      paperOcoSubmitGateSubmitted,
      entryRepricePolicyOverall,
      entryRepricePolicyRows,
      entryRepricePolicyPriceRrRows,
      entryRepricePolicyReady,
      entryRepricePolicyWaitPullback,
      entryRepricePolicyRrBelowMin,
      entryRepricePolicyDistanceWait,
      entryRepricePolicyFloorChangeRecommended,
      entryRepricePolicyAttempted,
      entryRepricePolicySubmitted,
      openOrderRepriceProposalOverall,
      openOrderRepriceRows,
      openOrderRepriceReady,
      openOrderRepriceWaitingPolicy,
      openOrderRepriceSuggestedRiskBreaches,
      openOrderRepriceNoRiskRoom,
      openOrderRepriceAttempted,
      openOrderRepriceSubmitted,
      entryOpenRepriceCombinedReady,
      entryOpenRepriceBlockedByEntryPolicy,
      entryOpenRepriceBlockedByOpenOrder,
      opsLaneStatusOverall,
      opsLaneBlockedCount,
      opsLaneManualApprovalCandidates,
      opsLaneAttempted,
      opsLaneSubmitted,
      highPriceMinOneShareOverall,
      highPriceMinOneShareCandidates,
      highPriceMinOneShareEligible,
      highPriceMinOneShareSelectedSymbol,
      highPriceMinOneShareWouldProbe,
      highPriceMinOneShareAttempted,
      highPriceMinOneShareSubmitted,
      guardLevel,
      haltNewEntries,
      liveAvailable,
      liveReturnPct,
      liveBrokerStopMissingCount,
      liveBrokerTargetMissingCount,
      liveGuardMissingCount,
      liveFillStateMismatchCount,
      livePositionDetails: short(livePositionDetails, 1800) || null
    },
    checks
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");

  console.log(
    `[OPS_HEALTH] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} checks=${checks.length}`
  );
};

main();
