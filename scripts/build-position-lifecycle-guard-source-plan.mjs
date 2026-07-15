import fs from "node:fs";
import { evaluateGuardMetadataRisk } from "./lib/guard-metadata-risk.mjs";

const STATE_DIR = String(process.env.POSITION_LIFECYCLE_GUARD_SOURCE_STATE_DIR || "state").trim() || "state";
const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`,
  protectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardRefresh: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  fillStateReconciliation: `${STATE_DIR}/fill-state-reconciliation-audit.json`,
  preview: `${STATE_DIR}/last-dry-exec-preview.json`
};
const OUTPUT_JSON = `${STATE_DIR}/position-lifecycle-guard-source-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/position-lifecycle-guard-source-plan.md`;

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
const short = (value, max = 360) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
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
const positiveEnv = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  maxPerformanceAgeMin: positiveEnv("POSITION_LIFECYCLE_GUARD_MAX_PERFORMANCE_AGE_MIN", 180),
  minStopDistancePct: positiveEnv("POSITION_LIFECYCLE_GUARD_MIN_STOP_DISTANCE_PCT", 1),
  minTargetDistancePct: positiveEnv("POSITION_LIFECYCLE_GUARD_MIN_TARGET_DISTANCE_PCT", 1)
};

const indexRows = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const pctDistance = (from, to) => {
  const a = toNum(from);
  const b = toNum(to);
  if (a == null || b == null || a <= 0) return null;
  return ((b - a) / a) * 100;
};

const sourceFromRefresh = (refreshRow) => {
  const selected = refreshRow?.selectedSource || null;
  if (!selected) return null;
  return {
    type: selected.type || null,
    stopPrice: toNum(selected.stopPrice),
    targetPrice: toNum(selected.targetPrice),
    generatedAt: selected.generatedAt || null,
    ageMin: selected.ageMin ?? round(ageMinutes(selected.generatedAt), 2),
    stage6Hash: selected.stage6Hash || null,
    stage6File: selected.stage6File || null,
    detail: selected.detail || null
  };
};

const hasGuardPrices = (source) => source?.stopPrice != null && source?.targetPrice != null;

const matchesPositionLineage = (source, expectedHash, expectedFile) => {
  if (!hasGuardPrices(source)) return false;
  if (expectedHash) return Boolean(source?.stage6Hash) && String(source.stage6Hash) === String(expectedHash);
  if (expectedFile) return Boolean(source?.stage6File) && String(source.stage6File) === String(expectedFile);
  return false;
};

const buildRow = ({ position, brokerRow, protectionRow, refreshRow, fillStateRow, generatedAt, performanceAgeMin }) => {
  const symbol = asSymbol(position?.symbol || refreshRow?.symbol || brokerRow?.symbol || protectionRow?.symbol);
  const qty = toNum(position?.qty ?? refreshRow?.qty ?? brokerRow?.qty) ?? 0;
  const currentPrice = toNum(position?.currentPrice ?? refreshRow?.currentPrice ?? brokerRow?.currentPrice ?? protectionRow?.currentPrice);
  const brokerStopPresent = position?.brokerStopPresent === true || refreshRow?.broker?.stopPresent === true || brokerRow?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true || refreshRow?.broker?.targetPresent === true || brokerRow?.brokerTargetPresent === true;
  const selectedSource = sourceFromRefresh(refreshRow);
  const expectedStage6Hash = position?.plannedStage6Hash || brokerRow?.plannedStage6Hash || null;
  const expectedStage6File = position?.plannedStage6File || brokerRow?.plannedStage6File || null;
  const positionSource = {
    type: position?.plannedStopSource || position?.plannedTargetSource || "performance_dashboard_planned_guard",
    stopPrice: toNum(position?.plannedStopPrice ?? position?.stopPrice),
    targetPrice: toNum(position?.plannedTargetPrice ?? position?.targetPrice),
    generatedAt: position?.plannedLedgerUpdatedAt || null,
    ageMin: round(ageMinutes(position?.plannedLedgerUpdatedAt), 2),
    stage6Hash: position?.plannedStage6Hash || null,
    stage6File: position?.plannedStage6File || null,
    detail: `positionStatus=${position?.positionStatus || "N/A"}`
  };
  const brokerSource = {
    type: brokerRow?.effectiveGuardSource || null,
    stopPrice: toNum(brokerRow?.effectiveStopPrice ?? brokerRow?.plannedStopPrice),
    targetPrice: toNum(brokerRow?.effectiveTargetPrice ?? brokerRow?.plannedTargetPrice),
    generatedAt: brokerRow?.effectiveGuardGeneratedAt || brokerRow?.plannedLedgerUpdatedAt || null,
    ageMin: round(ageMinutes(brokerRow?.effectiveGuardGeneratedAt || brokerRow?.plannedLedgerUpdatedAt), 2),
    stage6Hash: brokerRow?.plannedStage6Hash || null,
    stage6File: brokerRow?.plannedStage6File || null,
    detail: `protectionStatus=${brokerRow?.protectionStatus || "N/A"}`
  };
  const selectedIsReportOnlyLifecycle = selectedSource?.type === "position_lifecycle_revalidated_guard";
  const source = [selectedSource, positionSource, brokerSource].find((candidate) =>
    !((candidate === selectedSource) && selectedIsReportOnlyLifecycle) &&
    matchesPositionLineage(candidate, expectedStage6Hash, expectedStage6File)
  ) || null;
  const stop = toNum(source?.stopPrice);
  const target = toNum(source?.targetPrice);
  const stopBelowCurrent = stop != null && currentPrice != null && stop < currentPrice;
  const targetAboveCurrent = target != null && currentPrice != null && currentPrice < target;
  const targetAboveStop = stop != null && target != null && target > stop;
  const stopDistancePct = currentPrice != null && stop != null && currentPrice > 0 ? ((currentPrice - stop) / currentPrice) * 100 : null;
  const targetDistancePct = currentPrice != null && target != null && currentPrice > 0 ? ((target - currentPrice) / currentPrice) * 100 : null;
  const lifecycleRisk = evaluateGuardMetadataRisk({
    generatedAt,
    currentPrice,
    plannedStopPrice: stop,
    plannedTargetPrice: target
  });
  const fillConfirmed =
    fillStateRow?.reconciliationDecision === "FILL_STATE_CONFIRMED" ||
    refreshRow?.fillStateReconciliation?.status === "confirmed_filled" ||
    protectionRow?.fillStateReconciliation?.status === "confirmed_filled" ||
    String(position?.normalizedFillState || "").toLowerCase() === "filled";
  const ownership = refreshRow?.ownershipClassification || protectionRow?.ownershipClassification || brokerRow?.ownershipClassification || null;
  const staleGuardSource =
    refreshRow?.refreshDecision === "BLOCKED_REFRESH_SOURCE_STALE" ||
    protectionRow?.guardMetadataStale === true ||
    brokerRow?.protectionStatus === "STOP_AND_TARGET_CHILD_MISSING";
  const blockers = [];
  const warnings = [];

  if (selectedIsReportOnlyLifecycle) warnings.push("report_only_lifecycle_source_rejected_as_revalidation_input");

  if (!symbol) blockers.push("missing_symbol");
  if (qty <= 0) blockers.push("no_open_position");
  if (ownership !== "SIDECAR_MANAGED_FILLED") blockers.push("position_not_confirmed_sidecar_managed_filled");
  if (!fillConfirmed) blockers.push("fill_state_not_confirmed");
  if (performanceAgeMin == null || performanceAgeMin > config.maxPerformanceAgeMin) blockers.push("performance_dashboard_stale");
  if (!staleGuardSource) blockers.push("no_stale_guard_source_to_revalidate");
  if (!expectedStage6Hash && !expectedStage6File) blockers.push("current_position_stage6_lineage_missing");
  if (!source) blockers.push("no_existing_guard_source_with_stop_target");
  if (!stopBelowCurrent || !targetAboveCurrent || !targetAboveStop) blockers.push("invalid_stop_current_target_geometry");
  if (stopDistancePct != null && stopDistancePct < config.minStopDistancePct) blockers.push("stop_too_near_current_for_lifecycle_revalidation");
  if (targetDistancePct != null && targetDistancePct < config.minTargetDistancePct) blockers.push("target_too_near_current_for_lifecycle_revalidation");
  if (lifecycleRisk.blockers.some((blocker) => blocker !== "guard_metadata_stale")) blockers.push(...lifecycleRisk.blockers.filter((blocker) => blocker !== "guard_metadata_stale"));
  if (brokerStopPresent && brokerTargetPresent) warnings.push("broker_children_already_present_monitor_only");
  if (source?.generatedAt && ageMinutes(source.generatedAt) > config.maxPerformanceAgeMin) warnings.push("original_guard_source_was_stale_revalidated_by_lifecycle_only");

  const lifecycleReady = blockers.length === 0;
  return {
    symbol,
    qty,
    currentPrice,
    brokerChildren: {
      stopPresent: brokerStopPresent,
      targetPresent: brokerTargetPresent
    },
    ownershipClassification: ownership,
    fillStateStatus: fillConfirmed ? "FILL_STATE_CONFIRMED" : (fillStateRow?.reconciliationDecision || refreshRow?.fillStateReconciliation?.status || null),
    lineageDecision: source
      ? "CURRENT_POSITION_LINEAGE_MATCH"
      : expectedStage6Hash || expectedStage6File
        ? "SOURCE_LINEAGE_MISMATCH"
        : "CURRENT_POSITION_LINEAGE_MISSING",
    lineageEvidence: {
      expectedStage6Hash,
      expectedStage6File,
      selectedStage6Hash: selectedSource?.stage6Hash || null,
      selectedStage6File: selectedSource?.stage6File || null,
      selectedSourceRejectedAsReportOnlyLifecycle: selectedIsReportOnlyLifecycle
    },
    originalSource: source,
    lifecycleSource: lifecycleReady
      ? {
          type: "position_lifecycle_revalidated_guard",
          generatedAt,
          stopPrice: stop,
          targetPrice: target,
          stage6Hash: source?.stage6Hash || expectedStage6Hash,
          stage6File: source?.stage6File || expectedStage6File,
          originalSourceType: source?.type || null,
          originalGeneratedAt: source?.generatedAt || null,
          originalAgeMin: source?.ageMin ?? round(ageMinutes(source?.generatedAt), 2),
          validationBasis: "current_position_lifecycle_geometry_and_confirmed_fill_state"
        }
      : null,
    lifecycleReady,
    lifecycleDecision: lifecycleReady
      ? "POSITION_LIFECYCLE_GUARD_SOURCE_READY_REPORT_ONLY"
      : "POSITION_LIFECYCLE_GUARD_SOURCE_BLOCKED",
    geometry: {
      valid: stopBelowCurrent && targetAboveCurrent && targetAboveStop,
      stopBelowCurrent,
      targetAboveCurrent,
      targetAboveStop,
      stopDistancePct: round(stopDistancePct),
      targetDistancePct: round(targetDistancePct)
    },
    risk: lifecycleRisk,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false,
    reason: lifecycleReady
      ? "existing stale guard source revalidated by current position lifecycle; repair still requires separate approval"
      : `blocked:${blockers.join(",") || "unknown"}`
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Position Lifecycle Guard Source Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} lifecycleReady=${report.summary.lifecycleReady} blocked=${report.summary.blocked} staleRevalidated=${report.summary.staleSourcesRevalidated} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``
  );
  lines.push("- safety: `report-only; no broker mutation; no state mutation; protective repair still requires separate approval`");
  lines.push("| Symbol | Decision | Ownership | Fill State | Source | Current | Stop | Target | Stop Dist % | Target Dist % | Broker Children | Blockers |");
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.lifecycleDecision} | ${row.ownershipClassification || "N/A"} | ${row.fillStateStatus || "N/A"} | ${row.lifecycleSource?.type || row.originalSource?.type || "N/A"} | ${fmt(row.currentPrice)} | ${fmt(row.lifecycleSource?.stopPrice ?? row.originalSource?.stopPrice)} | ${fmt(row.lifecycleSource?.targetPrice ?? row.originalSource?.targetPrice)} | ${fmt(row.geometry?.stopDistancePct)} | ${fmt(row.geometry?.targetDistancePct)} | stop=${row.brokerChildren.stopPresent ? "present" : "missing"},target=${row.brokerChildren.targetPresent ? "present" : "missing"} | ${short(row.blockers.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const performance = readJson(FILES.performance);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const protectionAudit = readJson(FILES.protectionAudit);
  const guardRefresh = readJson(FILES.guardRefresh);
  const fillStateReconciliation = readJson(FILES.fillStateReconciliation);
  const preview = readJson(FILES.preview);

  const performanceAgeMin = round(ageMinutes(performance?.generatedAt), 2);
  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const brokerBySymbol = indexRows(brokerChildReconciliation?.rows);
  const protectionBySymbol = indexRows(protectionAudit?.rows);
  const refreshBySymbol = indexRows(guardRefresh?.rows);
  const fillBySymbol = indexRows(fillStateReconciliation?.rows);
  const rows = positions
    .filter((position) => (toNum(position?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      return buildRow({
        position,
        brokerRow: brokerBySymbol.get(symbol) || null,
        protectionRow: protectionBySymbol.get(symbol) || null,
        refreshRow: refreshBySymbol.get(symbol) || null,
        fillStateRow: fillBySymbol.get(symbol) || null,
        generatedAt,
        performanceAgeMin
      });
    });
  const summary = {
    rows: rows.length,
    lifecycleReady: rows.filter((row) => row.lifecycleReady).length,
    blocked: rows.filter((row) => !row.lifecycleReady).length,
    staleSourcesRevalidated: rows.filter((row) => row.lifecycleReady && row.warnings.includes("original_guard_source_was_stale_revalidated_by_lifecycle_only")).length,
    lineageMismatchSourcesRejected: rows.filter((row) => row.warnings.includes("report_only_lifecycle_source_rejected_as_revalidation_input")).length,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false
  };
  const overall = !performance?.live?.available
    ? "warn"
    : summary.lifecycleReady > 0
      ? "lifecycle_source_ready_report_only"
      : rows.length
        ? "blocked_no_lifecycle_source"
        : "no_positions";
  const report = {
    generatedAt,
    overall,
    scope: "portfolio_wide_dynamic_position_lifecycle_guard_source_recovery_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      performanceDashboardGeneratedAt: performance?.generatedAt || null,
      performanceAgeMin,
      latestStage6Hash: preview?.stage6Hash || null,
      latestStage6File: preview?.stage6File || null,
      guardRefreshOverall: guardRefresh?.overall || null,
      brokerChildReconciliationOverall: brokerChildReconciliation?.overall || null
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
      protectiveRepairRequiresSeparateApproval: true
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[POSITION_LIFECYCLE_GUARD_SOURCE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} ready=${summary.lifecycleReady} attempted=false submitted=false`
  );
};

main();
