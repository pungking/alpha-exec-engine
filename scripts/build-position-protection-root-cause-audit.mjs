import fs from "node:fs";
import {
  PROTECTION_LANES,
  classifyProtectionLane,
  classifyProtectionOwnership,
  resolveEffectiveGuardMetadata
} from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.POSITION_PROTECTION_AUDIT_STATE_DIR || "state").trim() || "state";
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const RECONCILIATION_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const ORDER_STATE_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const ORDER_LEDGER_PATH = `${STATE_DIR}/order-ledger.json`;
const IDEMPOTENCY_PATH = `${STATE_DIR}/order-idempotency.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const FILL_STATE_RECONCILIATION_PATH = `${STATE_DIR}/fill-state-reconciliation-audit.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const LIFECYCLE_GUARD_SOURCE_PATH = `${STATE_DIR}/position-lifecycle-guard-source-plan.json`;
const OUTPUT_JSON = `${STATE_DIR}/position-protection-root-cause-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/position-protection-root-cause-audit.md`;

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

const boolEnv = (key, fallback = true) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};

const positiveEnv = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const nonNegativeEnv = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const asSymbol = (value) => String(value || "").trim().toUpperCase();
const round = (value, digits = 4) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(digits));
};
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};
const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / 60000;
};
const pct = (numerator, denominator) => {
  const a = toNum(numerator);
  const b = toNum(denominator);
  if (a == null || b == null || b === 0) return null;
  return (a / b) * 100;
};

const protectionConfig = () => ({
  guardMetadataStaleEnabled: boolEnv("POSITION_PROTECTION_GUARD_STALE_ENABLED", true),
  guardMetadataMaxAgeMin: positiveEnv(
    "POSITION_PROTECTION_GUARD_METADATA_MAX_AGE_MIN",
    positiveEnv("OCO_REPAIR_GUARD_METADATA_MAX_AGE_MIN", 30)
  ),
  nearBreachPct: nonNegativeEnv(
    "POSITION_PROTECTION_GUARD_NEAR_BREACH_PCT",
    nonNegativeEnv("OCO_REPAIR_GUARD_NEAR_BREACH_PCT", 1)
  )
});

const indexBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const findStateRow = (state, symbol, preferredKey, observedAt) => {
  const target = asSymbol(symbol);
  const rows = state?.orders || {};
  if (!preferredKey) return null;
  return rows[preferredKey] && asSymbol(rows[preferredKey]?.symbol) === target ? rows[preferredKey] : null;
};

const findLedgerRow = (ledger, symbol, preferredKey) =>
  findStateRow(ledger, symbol, preferredKey, (row) => row?.updatedAt || row?.createdAt);

const findIdempotencyRow = (idempotency, symbol, preferredKey) =>
  findStateRow(idempotency, symbol, preferredKey, (row) => row?.brokerCheckedAt || row?.lastSeenAt || row?.firstSeenAt);

const findFillabilityRow = (fillability, symbol) =>
  (Array.isArray(fillability?.rows) ? fillability.rows : []).find((row) => asSymbol(row?.symbol) === asSymbol(symbol)) || null;

const classifyRow = ({ position, reconciliationRow, orderStateRow, ledgerRow, idempotencyRow, fillabilityRow, lifecycleRow, performanceGeneratedAt, config, nowMs }) => {
  const symbol = asSymbol(position?.symbol);
  const qty = toNum(position?.qty) ?? 0;
  const currentPrice = toNum(position?.currentPrice);
  const brokerStopPresent = position?.brokerStopPresent === true || reconciliationRow?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true || reconciliationRow?.brokerTargetPresent === true;
  const effectiveGuard = resolveEffectiveGuardMetadata({ position, reconciliationRow, ledgerRow, lifecycleRow, performanceGeneratedAt });
  const ownership = classifyProtectionOwnership({
    position,
    reconciliationRow,
    ledgerRow,
    idempotencyRow,
    orderStateRow,
    fillabilityRow
  });
  const plannedStopPrice = effectiveGuard.stopPrice;
  const plannedTargetPrice = effectiveGuard.targetPrice;
  const normalizedFillState = position?.normalizedFillState || reconciliationRow?.normalizedFillState || null;
  const ledgerStatus = ledgerRow?.status || position?.ledgerStatus || null;
  const idempotencyBrokerStatus = idempotencyRow?.brokerStatus || position?.idempotencyBrokerStatus || null;
  const fillabilityStatus = fillabilityRow?.status || position?.fillabilityStatus || null;
  const plannedStopSource = effectiveGuard.source;
  const plannedTargetSource = effectiveGuard.source;
  const plannedLedgerUpdatedAt =
    effectiveGuard.generatedAt || position?.plannedLedgerUpdatedAt || reconciliationRow?.plannedLedgerUpdatedAt || ledgerRow?.updatedAt || null;
  const metadataAgeMinRaw = ageMinutes(plannedLedgerUpdatedAt, nowMs);
  const metadataAgeMin = round(metadataAgeMinRaw, 2);
  const hasGuardMetadata = plannedStopPrice != null || plannedTargetPrice != null;
  const missingGuardMetadata = plannedStopPrice == null && plannedTargetPrice == null;
  const guardMetadataStale =
    config.guardMetadataStaleEnabled &&
    hasGuardMetadata &&
    (metadataAgeMinRaw == null || metadataAgeMinRaw > config.guardMetadataMaxAgeMin);
  const stopDistancePct = currentPrice != null && plannedStopPrice != null && currentPrice > 0
    ? ((currentPrice - plannedStopPrice) / currentPrice) * 100
    : null;
  const targetDistancePct = currentPrice != null && plannedTargetPrice != null && currentPrice > 0
    ? ((plannedTargetPrice - currentPrice) / currentPrice) * 100
    : null;
  const stopAboveOrAtCurrent = currentPrice != null && plannedStopPrice != null && plannedStopPrice >= currentPrice;
  const targetBelowOrAtCurrent = currentPrice != null && plannedTargetPrice != null && plannedTargetPrice <= currentPrice;
  const targetAtOrBelowStop =
    plannedStopPrice != null && plannedTargetPrice != null && plannedTargetPrice <= plannedStopPrice;
  const invalidGeometry = stopAboveOrAtCurrent || targetBelowOrAtCurrent || targetAtOrBelowStop;
  const nearStopBreach =
    stopDistancePct != null &&
    stopDistancePct >= 0 &&
    stopDistancePct <= config.nearBreachPct;
  const nearTargetBreach =
    targetDistancePct != null &&
    targetDistancePct >= 0 &&
    targetDistancePct <= config.nearBreachPct;
  const stopChildMissing = qty > 0 && plannedStopPrice != null && !brokerStopPresent;
  const targetChildMissing = qty > 0 && plannedTargetPrice != null && !brokerTargetPresent;
  const brokerChildMissing = stopChildMissing || targetChildMissing;
  const rootCauses = [];
  const nextActions = [];
  const fillStateRepairBlocked = ownership.fillStateReconciliation.repairBlocked;
  const brokerChildrenComplete = brokerStopPresent && brokerTargetPresent;

  if (qty <= 0) rootCauses.push("no_open_position");
  if (ownership.ownershipClass === "EXTERNAL_OR_MANUAL_POSITION") {
    rootCauses.push("position_not_sidecar_managed");
    nextActions.push("classify_position_ownership_before_repair");
  }
  if (fillStateRepairBlocked && ownership.ownershipClass !== "EXTERNAL_OR_MANUAL_POSITION") {
    rootCauses.push("fill_state_reconciliation_required");
    nextActions.push("reconcile_position_fill_state_before_child_repair");
  }
  if (missingGuardMetadata) {
    rootCauses.push("guard_metadata_missing");
    nextActions.push("rebuild_or_backfill_position_guard_metadata_before_repair");
  }
  if (guardMetadataStale && !brokerChildrenComplete) {
    rootCauses.push("guard_metadata_stale");
    nextActions.push("refresh_guard_metadata_from_current_stage6_or_position_lifecycle_before_repair");
  }
  if (stopAboveOrAtCurrent) {
    rootCauses.push("stop_current_drift_or_breached_stop");
    nextActions.push("do_not_repair_submit_route_to_stop_drift_root_cause");
  }
  if (targetBelowOrAtCurrent) {
    rootCauses.push("target_current_drift_or_breached_target");
    nextActions.push("do_not_repair_submit_route_to_target_drift_root_cause");
  }
  if (targetAtOrBelowStop) {
    rootCauses.push("target_stop_geometry_inverted");
    nextActions.push("do_not_repair_submit_route_to_stage6_guard_geometry_review");
  }
  if (stopChildMissing) {
    rootCauses.push("broker_stop_child_missing");
    nextActions.push("repair_candidate_only_after_fresh_valid_guard_metadata_and_approval");
  }
  if (targetChildMissing) {
    rootCauses.push("broker_target_child_missing");
    nextActions.push("repair_candidate_only_after_fresh_valid_guard_metadata_and_approval");
  }
  if (nearStopBreach) {
    rootCauses.push("near_stop_breach");
    nextActions.push("do_not_chase_repair_without_manual_risk_review");
  }
  if (nearTargetBreach) {
    rootCauses.push("near_target_breach");
    nextActions.push("do_not_chase_repair_without_manual_risk_review");
  }
  if (!rootCauses.length) {
    rootCauses.push("protected_or_no_action");
    nextActions.push("monitor_only");
  }

  const effectiveGuardMetadataStale = guardMetadataStale && !brokerChildrenComplete;
  const guardSourceFreshness = brokerChildrenComplete
    ? "fresh"
    : missingGuardMetadata
      ? "missing"
      : effectiveGuardMetadataStale
        ? "stale"
        : "fresh";
  const protectionClassification = classifyProtectionLane({
    qty,
    brokerStopPresent,
    brokerTargetPresent,
    ownershipClassification: ownership.ownershipClass,
    fillStateRepairBlocked,
    guardMetadataMissing: missingGuardMetadata,
    guardMetadataStale: effectiveGuardMetadataStale,
    geometryValid: !invalidGeometry,
    brokerChildMissing
  });
  const sourcePrecedenceClass = guardSourceFreshness !== "fresh"
    ? "stale_or_missing_metadata"
    : effectiveGuard.source === "broker_children"
      ? "broker_nested_evidence"
      : effectiveGuard.source === "position_lifecycle_revalidated_guard"
        ? "fresh_position_lifecycle"
        : ["recommendation_ledger", "stage6_20trade_loop", "order_ledger"].includes(effectiveGuard.source)
          ? "fresh_order_or_recommendation_lineage"
          : "fresh_state_metadata";
  const sourcePrecedenceRank = {
    broker_nested_evidence: 1,
    fresh_position_lifecycle: 2,
    fresh_order_or_recommendation_lineage: 3,
    fresh_state_metadata: 3,
    stale_or_missing_metadata: 4
  }[sourcePrecedenceClass];
  const severity = invalidGeometry || stopChildMissing
    ? "critical"
    : missingGuardMetadata || effectiveGuardMetadataStale || targetChildMissing || nearStopBreach || nearTargetBreach || fillStateRepairBlocked
      ? "warn"
      : "pass";
  let repairLaneDecision = "NO_ACTION";
  if (invalidGeometry) {
    repairLaneDecision = "BLOCK_REPAIR_INVALID_GEOMETRY";
  } else if (brokerChildrenComplete) {
    repairLaneDecision = "NO_ACTION_BROKER_CHILDREN_PRESENT";
  } else if (ownership.ownershipClass === "EXTERNAL_OR_MANUAL_POSITION") {
    repairLaneDecision = "BLOCK_REPAIR_POSITION_NOT_SIDECAR_MANAGED";
  } else if (fillStateRepairBlocked) {
    repairLaneDecision = "BLOCK_REPAIR_FILL_STATE_RECONCILIATION_REQUIRED";
  } else if (missingGuardMetadata) {
    repairLaneDecision = "BLOCK_REPAIR_GUARD_METADATA_MISSING";
  } else if (effectiveGuardMetadataStale) {
    repairLaneDecision = "BLOCK_REPAIR_GUARD_METADATA_STALE";
  } else if (brokerChildMissing) {
    repairLaneDecision = "REPORT_ONLY_REPAIR_CANDIDATE_REQUIRES_APPROVAL";
  }

  return {
    symbol,
    qty,
    currentPrice,
    plannedStopPrice,
    plannedTargetPrice,
    plannedStopSource,
    plannedTargetSource,
    effectiveGuardSource: effectiveGuard.source,
    effectiveGuardGeneratedAt: effectiveGuard.generatedAt,
    sourcePrecedence: effectiveGuard.sourcePrecedence,
    sourcePrecedenceClass,
    sourcePrecedenceRank,
    lifecycleGuardSourceReady: lifecycleRow?.lifecycleReady === true,
    lifecycleOriginalGuardSource: effectiveGuard.originalSourceType || null,
    lifecycleOriginalGeneratedAt: effectiveGuard.originalGeneratedAt || null,
    staleStateMetadataIgnored: effectiveGuard.staleStateMetadataIgnored,
    plannedStage6Hash: ledgerRow?.stage6Hash || reconciliationRow?.plannedStage6Hash || position?.plannedStage6Hash || null,
    plannedStage6File: ledgerRow?.stage6File || reconciliationRow?.plannedStage6File || position?.plannedStage6File || null,
    plannedLedgerKey: ledgerRow?.idempotencyKey || position?.plannedLedgerKey || reconciliationRow?.plannedLedgerKey || null,
    plannedLedgerUpdatedAt,
    metadataAgeMin,
    guardMetadataMaxAgeMin: config.guardMetadataMaxAgeMin,
    brokerStopPresent,
    brokerTargetPresent,
    brokerSellOrderCount: toNum(position?.brokerSellOrderCount ?? reconciliationRow?.brokerSellOrderCount) ?? 0,
    brokerNestedSellOrderCount: toNum(position?.brokerNestedSellOrderCount ?? reconciliationRow?.brokerNestedSellOrderCount) ?? 0,
    stopChildMissing,
    targetChildMissing,
    brokerChildMissing,
    missingGuardMetadata,
    guardMetadataStale: effectiveGuardMetadataStale,
    rawGuardMetadataStale: guardMetadataStale,
    guardSourceFreshness,
    guardSourceFresh: guardSourceFreshness === "fresh",
    geometry: {
      valid: !invalidGeometry,
      stopAboveOrAtCurrent,
      targetBelowOrAtCurrent,
      targetAtOrBelowStop,
      stopDistancePct: round(stopDistancePct),
      targetDistancePct: round(targetDistancePct),
      nearStopBreach,
      nearTargetBreach
    },
    positionStatus: position?.positionStatus || null,
    normalizedFillState,
    ledgerStatus,
    idempotencyBrokerStatus,
    idempotencyStatus: idempotencyBrokerStatus || (idempotencyRow ? "record_present_status_unknown" : "not_recorded"),
    fillabilityStatus,
    orderStateStatus: orderStateRow?.status || null,
    ownershipClassification: ownership.ownershipClass,
    sidecarManaged: ownership.sidecarManaged,
    repairAllowedByOwnership: ownership.repairAllowedByOwnership,
    fillStateReconciliation: ownership.fillStateReconciliation,
    severity,
    rootCauses: [...new Set(rootCauses)],
    repairLaneDecision,
    protectionLane: protectionClassification.protectionLane,
    blockerDomain: protectionClassification.blockerDomain,
    repairEligible: protectionClassification.repairEligible,
    blockedReason: protectionClassification.blockedReason,
    nextAction: protectionClassification.nextAction,
    nextActions: [...new Set(nextActions)],
    evidence: short(
      `source=${plannedStopSource || plannedTargetSource || "none"} ledgerUpdatedAt=${plannedLedgerUpdatedAt || "N/A"} stage6=${position?.plannedStage6File || ledgerRow?.stage6File || "N/A"} brokerStop=${brokerStopPresent} brokerTarget=${brokerTargetPresent}`,
      500
    )
  };
};

const countBy = (rows, predicate) => rows.filter(predicate).length;
const countProtectionLanes = (rows) => Object.fromEntries(
  Object.values(PROTECTION_LANES).map((lane) => [lane, countBy(rows, (row) => row.protectionLane === lane)])
);
const countCauses = (rows) => {
  const out = {};
  for (const row of rows) {
    for (const cause of row.rootCauses || []) {
      out[cause] = (out[cause] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Position Protection Root-Cause Audit");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`positions=${report.summary.positions} classified=${report.summary.classifiedRows} unclassified=${report.summary.unclassifiedRows} protectionBlockers=${report.summary.protectionBlockerRows} ownershipBlockers=${report.summary.ownershipBlockerRows} ledgerBlockers=${report.summary.ledgerBlockerRows} manualApproval=${report.summary.manualApprovalCandidates}\``
  );
  lines.push(`- lanes: \`${Object.entries(report.summary.protectionLaneCounts).map(([key, value]) => `${key}:${value}`).join(", ")}\``);
  lines.push(`- root_causes: \`${Object.entries(report.rootCauseCounts).map(([key, value]) => `${key}:${value}`).join(", ") || "none"}\``);
  lines.push("- safety: `report-only; no broker mutation; invalid or stale guard metadata blocks repair lanes`");
  lines.push("| Symbol | Lane | Domain | Ownership | Fill State | Source | Freshness | Current | Stop | Target | Geometry | Broker Stop | Broker Target | Idempotency | Eligible | Blocked Reason | Next Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.protectionLane} | ${row.blockerDomain} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || "N/A"} | ${row.effectiveGuardSource || "N/A"} | ${row.guardSourceFreshness} | ${fmt(row.currentPrice)} | ${fmt(row.plannedStopPrice)} | ${fmt(row.plannedTargetPrice)} | ${row.geometry.valid ? "valid" : "invalid"} | ${row.brokerStopPresent ? "present" : "missing"} | ${row.brokerTargetPresent ? "present" : "missing"} | ${row.idempotencyStatus} | ${row.repairEligible ? "yes" : "no"} | ${row.blockedReason || "none"} | ${row.nextAction} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const performance = readJson(PERFORMANCE_PATH);
  const reconciliation = readJson(RECONCILIATION_PATH);
  const orderState = readJson(ORDER_STATE_PATH);
  const ledger = readJson(ORDER_LEDGER_PATH);
  const idempotency = readJson(IDEMPOTENCY_PATH);
  const fillability = readJson(FILLABILITY_PATH);
  const fillStateReconciliation = readJson(FILL_STATE_RECONCILIATION_PATH);
  const preview = readJson(PREVIEW_PATH);
  const lifecyclePlan = readJson(LIFECYCLE_GUARD_SOURCE_PATH);
  const config = protectionConfig();
  const nowMs = Date.now();
  const reconciliationBySymbol = indexBySymbol(reconciliation?.rows);
  const orderStateBySymbol = indexBySymbol(orderState?.rows);
  const lifecycleBySymbol = indexBySymbol(lifecyclePlan?.rows);
  const fillStateBySymbol = indexBySymbol(fillStateReconciliation?.rows);
  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const rows = positions
    .filter((row) => (toNum(row?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      const fillStateRow = fillStateBySymbol.get(symbol) || null;
      const ledgerKey = fillStateRow?.ledger?.key || position?.plannedLedgerKey || null;
      const idempotencyKey = fillStateRow?.idempotency?.key || ledgerKey;
      return classifyRow({
        position,
        reconciliationRow: reconciliationBySymbol.get(symbol) || null,
        orderStateRow: orderStateBySymbol.get(symbol) || null,
        ledgerRow: findLedgerRow(ledger, symbol, ledgerKey),
        idempotencyRow: findIdempotencyRow(idempotency, symbol, idempotencyKey),
        fillabilityRow: findFillabilityRow(fillability, symbol),
        lifecycleRow: lifecycleBySymbol.get(symbol) || null,
        performanceGeneratedAt: performance?.generatedAt || null,
        config,
        nowMs
      });
    });
  const summary = {
    positions: rows.length,
    critical: countBy(rows, (row) => row.severity === "critical"),
    warnings: countBy(rows, (row) => row.severity === "warn"),
    pass: countBy(rows, (row) => row.severity === "pass"),
    guardMetadataMissing: countBy(rows, (row) => row.missingGuardMetadata),
    guardMetadataStale: countBy(rows, (row) => row.guardMetadataStale),
    invalidGeometry: countBy(rows, (row) => !row.geometry.valid),
    stopCurrentDrift: countBy(rows, (row) => row.geometry.stopAboveOrAtCurrent),
    targetCurrentDrift: countBy(rows, (row) => row.geometry.targetBelowOrAtCurrent),
    brokerChildMissing: countBy(rows, (row) => row.brokerChildMissing),
    brokerStopMissing: countBy(rows, (row) => row.stopChildMissing),
    brokerTargetMissing: countBy(rows, (row) => row.targetChildMissing),
    repairBlockedInvalidOrStale: countBy(
      rows,
      (row) => row.repairLaneDecision === "BLOCK_REPAIR_INVALID_GEOMETRY" || row.repairLaneDecision === "BLOCK_REPAIR_GUARD_METADATA_STALE"
    ),
    fillStateReconciliationRequired: countBy(
      rows,
      (row) => row.repairLaneDecision === "BLOCK_REPAIR_FILL_STATE_RECONCILIATION_REQUIRED"
    ),
    positionOwnershipReviewRequired: countBy(
      rows,
      (row) => row.repairLaneDecision === "BLOCK_REPAIR_POSITION_NOT_SIDECAR_MANAGED"
    ),
    brokerChildrenPresentNoAction: countBy(rows, (row) => row.repairLaneDecision === "NO_ACTION_BROKER_CHILDREN_PRESENT"),
    reportOnlyRepairCandidates: countBy(
      rows,
      (row) => row.repairLaneDecision === "REPORT_ONLY_REPAIR_CANDIDATE_REQUIRES_APPROVAL"
    ),
    classifiedRows: countBy(rows, (row) => Object.values(PROTECTION_LANES).includes(row.protectionLane)),
    unclassifiedRows: countBy(rows, (row) => !Object.values(PROTECTION_LANES).includes(row.protectionLane)),
    protectionLaneCounts: countProtectionLanes(rows),
    protectionBlockerRows: countBy(rows, (row) => row.blockerDomain === "protection"),
    ownershipBlockerRows: countBy(rows, (row) => row.blockerDomain === "ownership"),
    ledgerBlockerRows: countBy(rows, (row) => row.blockerDomain === "ledger_fill_state"),
    manualApprovalCandidates: countBy(rows, (row) => row.protectionLane === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE)
  };
  const overall = !performance?.live?.available
    ? "warn"
    : summary.critical > 0
      ? "fail"
      : summary.warnings > 0
        ? "warn"
        : "pass";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_position_protection_root_cause_not_ticker_specific",
    files: {
      performanceDashboard: Boolean(performance),
      brokerChildReconciliation: Boolean(reconciliation),
      orderStateConsistency: Boolean(orderState),
      orderLedger: Boolean(ledger),
      orderIdempotency: Boolean(idempotency),
      fillability: Boolean(fillability),
      preview: Boolean(preview),
      positionLifecycleGuardSourcePlan: Boolean(lifecyclePlan)
    },
    source: {
      performanceDashboardGeneratedAt: performance?.generatedAt || null,
      reconciliationGeneratedAt: reconciliation?.generatedAt || null,
      lifecycleGuardSourceOverall: lifecyclePlan?.overall || null,
      stage6Hash: preview?.stage6Hash || null,
      stage6File: preview?.stage6File || null
    },
    config,
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      stateMutationSubmitted: false,
      blocksRepairOnInvalidGeometry: true,
      blocksRepairOnStaleGuardMetadata: true
    },
    classificationContract: {
      version: "1.0.0",
      allowedLanes: Object.values(PROTECTION_LANES),
      sourcePrecedence: [
        "broker_nested_evidence",
        "fresh_position_lifecycle",
        "fresh_order_or_recommendation_lineage",
        "stale_or_missing_metadata"
      ],
      blockerDomains: ["none", "protection", "ownership", "ledger_fill_state"],
      singleLanePerRow: true,
      tickerSymbolsAreEvidenceOnly: true
    },
    summary,
    rootCauseCounts: countCauses(rows),
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[POSITION_PROTECTION_AUDIT] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} positions=${summary.positions} critical=${summary.critical} stale=${summary.guardMetadataStale} invalidGeometry=${summary.invalidGeometry} brokerChildMissing=${summary.brokerChildMissing}`
  );
};

main();
