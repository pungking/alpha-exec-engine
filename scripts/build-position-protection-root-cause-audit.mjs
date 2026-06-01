import fs from "node:fs";
import { classifyProtectionOwnership, resolveEffectiveGuardMetadata } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.POSITION_PROTECTION_AUDIT_STATE_DIR || "state").trim() || "state";
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const RECONCILIATION_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const ORDER_STATE_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const ORDER_LEDGER_PATH = `${STATE_DIR}/order-ledger.json`;
const IDEMPOTENCY_PATH = `${STATE_DIR}/order-idempotency.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
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

const findLedgerRow = (ledger, symbol) => {
  const target = asSymbol(symbol);
  for (const row of Object.values(ledger?.orders || {})) {
    if (asSymbol(row?.symbol) === target) return row;
  }
  return null;
};

const findIdempotencyRow = (idempotency, symbol) => {
  const target = asSymbol(symbol);
  for (const row of Object.values(idempotency?.orders || {})) {
    if (asSymbol(row?.symbol) === target) return row;
  }
  return null;
};

const findFillabilityRow = (fillability, symbol) =>
  (Array.isArray(fillability?.rows) ? fillability.rows : []).find((row) => asSymbol(row?.symbol) === asSymbol(symbol)) || null;

const classifyRow = ({ position, reconciliationRow, orderStateRow, ledgerRow, idempotencyRow, fillabilityRow, performanceGeneratedAt, config, nowMs }) => {
  const symbol = asSymbol(position?.symbol);
  const qty = toNum(position?.qty) ?? 0;
  const currentPrice = toNum(position?.currentPrice);
  const brokerStopPresent = position?.brokerStopPresent === true || reconciliationRow?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true || reconciliationRow?.brokerTargetPresent === true;
  const effectiveGuard = resolveEffectiveGuardMetadata({ position, reconciliationRow, ledgerRow, performanceGeneratedAt });
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
    staleStateMetadataIgnored: effectiveGuard.staleStateMetadataIgnored,
    plannedStage6Hash: position?.plannedStage6Hash || reconciliationRow?.plannedStage6Hash || ledgerRow?.stage6Hash || null,
    plannedStage6File: position?.plannedStage6File || reconciliationRow?.plannedStage6File || ledgerRow?.stage6File || null,
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
    fillabilityStatus,
    orderStateStatus: orderStateRow?.status || null,
    ownershipClassification: ownership.ownershipClass,
    sidecarManaged: ownership.sidecarManaged,
    repairAllowedByOwnership: ownership.repairAllowedByOwnership,
    fillStateReconciliation: ownership.fillStateReconciliation,
    severity,
    rootCauses: [...new Set(rootCauses)],
    repairLaneDecision,
    nextActions: [...new Set(nextActions)],
    evidence: short(
      `source=${plannedStopSource || plannedTargetSource || "none"} ledgerUpdatedAt=${plannedLedgerUpdatedAt || "N/A"} stage6=${position?.plannedStage6File || ledgerRow?.stage6File || "N/A"} brokerStop=${brokerStopPresent} brokerTarget=${brokerTargetPresent}`,
      500
    )
  };
};

const countBy = (rows, predicate) => rows.filter(predicate).length;
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
    `- summary: \`positions=${report.summary.positions} critical=${report.summary.critical} warnings=${report.summary.warnings} guardMissing=${report.summary.guardMetadataMissing} guardStale=${report.summary.guardMetadataStale} invalidGeometry=${report.summary.invalidGeometry} brokerChildMissing=${report.summary.brokerChildMissing} fillRecon=${report.summary.fillStateReconciliationRequired} ownershipReview=${report.summary.positionOwnershipReviewRequired} brokerChildrenNoAction=${report.summary.brokerChildrenPresentNoAction} stopDrift=${report.summary.stopCurrentDrift}\``
  );
  lines.push(`- root_causes: \`${Object.entries(report.rootCauseCounts).map(([key, value]) => `${key}:${value}`).join(", ") || "none"}\``);
  lines.push("- safety: `report-only; no broker mutation; invalid or stale guard metadata blocks repair lanes`");
  lines.push("| Symbol | Severity | Repair Decision | Ownership | Fill State | Source | Current | Stop | Target | Guard Age Min | Geometry | Broker Stop | Broker Target | Root Causes | Next Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.severity.toUpperCase()} | ${row.repairLaneDecision} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || "N/A"} | ${row.effectiveGuardSource || "N/A"} | ${fmt(row.currentPrice)} | ${fmt(row.plannedStopPrice)} | ${fmt(row.plannedTargetPrice)} | ${fmt(row.metadataAgeMin)} | ${row.geometry.valid ? "valid" : "invalid"} | ${row.brokerStopPresent ? "present" : "missing"} | ${row.brokerTargetPresent ? "present" : "missing"} | ${short(row.rootCauses.join(","), 220)} | ${short(row.nextActions.join(","), 220)} |`
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
  const preview = readJson(PREVIEW_PATH);
  const config = protectionConfig();
  const nowMs = Date.now();
  const reconciliationBySymbol = indexBySymbol(reconciliation?.rows);
  const orderStateBySymbol = indexBySymbol(orderState?.rows);
  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const rows = positions
    .filter((row) => (toNum(row?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      return classifyRow({
        position,
        reconciliationRow: reconciliationBySymbol.get(symbol) || null,
        orderStateRow: orderStateBySymbol.get(symbol) || null,
        ledgerRow: findLedgerRow(ledger, symbol),
        idempotencyRow: findIdempotencyRow(idempotency, symbol),
        fillabilityRow: findFillabilityRow(fillability, symbol),
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
    )
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
      preview: Boolean(preview)
    },
    source: {
      performanceDashboardGeneratedAt: performance?.generatedAt || null,
      reconciliationGeneratedAt: reconciliation?.generatedAt || null,
      stage6Hash: preview?.stage6Hash || null,
      stage6File: preview?.stage6File || null
    },
    config,
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      blocksRepairOnInvalidGeometry: true,
      blocksRepairOnStaleGuardMetadata: true
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
