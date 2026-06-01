import fs from "node:fs";
import { classifyProtectionOwnership } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.GUARD_METADATA_LINEAGE_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/guard-metadata-lineage-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/guard-metadata-lineage-audit.md`;

const FILES = {
  performance: `${STATE_DIR}/performance-dashboard.json`,
  protectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardRefresh: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  recommendationLedger: `${STATE_DIR}/recommendation-ledger.json`,
  stage6Loop: `${STATE_DIR}/stage6-20trade-loop.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  orderIdempotency: `${STATE_DIR}/order-idempotency.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  preview: `${STATE_DIR}/last-dry-exec-preview.json`
};

const MAX_SOURCE_AGE_MIN = Number(process.env.GUARD_METADATA_LINEAGE_SOURCE_MAX_AGE_MIN || process.env.GUARD_METADATA_REFRESH_SOURCE_MAX_AGE_MIN || 30);

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
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};
const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / 60000;
};
const round = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(digits));
};

const indexArrayBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const valuesBySymbol = (object, symbol) => {
  const target = asSymbol(symbol);
  if (!object || typeof object !== "object") return null;
  for (const row of Object.values(object)) {
    if (asSymbol(row?.symbol) === target) return row;
  }
  return null;
};

const latestLoopRow = (loop, symbol) => {
  const target = asSymbol(symbol);
  const rows = Object.values(loop?.rows || {}).filter((row) => asSymbol(row?.symbol) === target);
  rows.sort((a, b) => Date.parse(b?.runDate || "") - Date.parse(a?.runDate || ""));
  return rows[0] || null;
};

const sourceProbe = ({ source, stop, target, generatedAt, stage6Hash, stage6File, detail, currentPrice }) => {
  const stopPrice = toNum(stop);
  const targetPrice = toNum(target);
  const current = toNum(currentPrice);
  const ageMin = ageMinutes(generatedAt);
  const hasStopTarget = stopPrice != null && targetPrice != null;
  const fresh = ageMin != null && Number.isFinite(MAX_SOURCE_AGE_MIN) && ageMin <= MAX_SOURCE_AGE_MIN;
  const geometryValid =
    hasStopTarget && current != null && stopPrice < current && current < targetPrice && targetPrice > stopPrice;
  const freshnessStatus = !hasStopTarget
    ? "no_stop_target"
    : ageMin == null
      ? "missing_generated_at"
      : fresh
        ? "fresh"
        : "stale_age_exceeded";
  const geometryStatus = !hasStopTarget
    ? "not_evaluated"
    : current == null
      ? "missing_current_price"
      : geometryValid
        ? "valid"
        : "invalid_stop_current_target";
  return {
    source,
    present: Boolean(detail || stopPrice != null || targetPrice != null || generatedAt || stage6Hash || stage6File),
    hasStopTarget,
    stopPrice,
    targetPrice,
    currentPrice: current,
    generatedAt: generatedAt || null,
    ageMin: round(ageMin),
    fresh,
    freshnessStatus,
    geometryValid,
    geometryStatus,
    stage6Hash: stage6Hash || null,
    stage6File: stage6File || null,
    detail: short(detail, 320)
  };
};

const buildRow = ({ position, protectionRow, guardRefreshRow, recommendation, loopRow, ledgerRow, idempotencyRow, fillabilityRow, previewRecord, performanceGeneratedAt }) => {
  const symbol = asSymbol(position?.symbol);
  const currentPrice = toNum(position?.currentPrice);
  const ownership = classifyProtectionOwnership({
    position,
    reconciliationRow: protectionRow,
    ledgerRow,
    idempotencyRow,
    fillabilityRow
  });
  const sources = [
    sourceProbe({
      source: "performance_dashboard_planned_guard",
      stop: position?.plannedStopPrice ?? position?.stopPrice,
      target: position?.plannedTargetPrice ?? position?.targetPrice,
      generatedAt: position?.plannedLedgerUpdatedAt,
      stage6Hash: position?.plannedStage6Hash,
      stage6File: position?.plannedStage6File,
      detail: `status=${position?.positionStatus || "N/A"} plannedSource=${position?.plannedStopSource || position?.plannedTargetSource || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "broker_children",
      stop: position?.brokerStopPrice,
      target: position?.brokerTargetPrice,
      generatedAt: position?.brokerStopPresent || position?.brokerTargetPresent ? performanceGeneratedAt : null,
      stage6Hash: position?.plannedStage6Hash,
      stage6File: position?.plannedStage6File,
      detail: `stopPresent=${position?.brokerStopPresent === true} targetPresent=${position?.brokerTargetPresent === true} sellOrders=${position?.brokerSellOrderCount ?? "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "recommendation_ledger",
      stop: recommendation?.stop,
      target: recommendation?.target,
      generatedAt: recommendation?.updatedAt || recommendation?.lastSeenAt,
      stage6Hash: recommendation?.stage6Hash,
      stage6File: recommendation?.latestStage6File,
      detail: `status=${recommendation?.status || "N/A"} decision=${recommendation?.finalDecision || "N/A"} reason=${recommendation?.decisionReason || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "stage6_20trade_loop",
      stop: loopRow?.stopPlanned,
      target: loopRow?.targetPlanned,
      generatedAt: loopRow?.runDate,
      stage6Hash: loopRow?.stage6Hash,
      stage6File: loopRow?.stage6File,
      detail: `rowId=${loopRow?.rowId || "N/A"} reason=${loopRow?.decisionReason || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "order_ledger",
      stop: ledgerRow?.stopLossPrice,
      target: ledgerRow?.takeProfitPrice,
      generatedAt: ledgerRow?.updatedAt || ledgerRow?.createdAt,
      stage6Hash: ledgerRow?.stage6Hash,
      stage6File: ledgerRow?.stage6File,
      detail: `status=${ledgerRow?.status || "N/A"} reason=${ledgerRow?.statusReason || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "order_idempotency",
      stop: null,
      target: null,
      generatedAt: idempotencyRow?.brokerCheckedAt || idempotencyRow?.lastSeenAt || idempotencyRow?.firstSeenAt,
      stage6Hash: idempotencyRow?.stage6Hash,
      stage6File: idempotencyRow?.stage6File,
      detail: `brokerStatus=${idempotencyRow?.brokerStatus || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "fillability",
      stop: fillabilityRow?.stop,
      target: fillabilityRow?.target,
      generatedAt: fillabilityRow?.generatedAt,
      stage6Hash: null,
      stage6File: null,
      detail: `status=${fillabilityRow?.status || "N/A"} reason=${fillabilityRow?.reason || "N/A"}`,
      currentPrice
    }),
    sourceProbe({
      source: "current_preview_decision",
      stop: previewRecord?.stop,
      target: previewRecord?.target,
      generatedAt: null,
      stage6Hash: null,
      stage6File: null,
      detail: `status=${previewRecord?.status || "N/A"} decision=${previewRecord?.finalDecision || "N/A"} reason=${previewRecord?.reason || "N/A"}`,
      currentPrice
    })
  ];

  const withStopTarget = sources.filter((row) => row.hasStopTarget);
  const freshValid = withStopTarget.filter((row) => row.fresh && row.geometryValid);
  const stale = withStopTarget.filter((row) => !row.fresh);
  const invalid = withStopTarget.filter((row) => row.fresh && !row.geometryValid);
  const disconnectPoint = freshValid.length
    ? "fresh_valid_source_available"
    : !withStopTarget.length
      ? "no_stop_target_source_found"
      : invalid.length
        ? "fresh_source_invalid_geometry"
        : stale.length
          ? "only_stale_sources_found"
          : "lineage_unclassified";
  const lineageStatus = freshValid.length
    ? "LINEAGE_READY"
    : !withStopTarget.length
      ? "LINEAGE_MISSING_NO_SOURCE"
      : invalid.length
        ? "LINEAGE_INVALID_GEOMETRY"
        : "LINEAGE_STALE_SOURCE_ONLY";
  const rootCause = freshValid.length
    ? "FRESH_VALID_SOURCE_AVAILABLE"
    : !withStopTarget.length
      ? "NO_SOURCE_WITH_STOP_TARGET"
      : invalid.length
        ? "FRESH_SOURCE_INVALID_GEOMETRY"
        : stale.some((row) => row.freshnessStatus === "missing_generated_at")
          ? "SOURCE_TIMESTAMP_MISSING"
          : "SOURCE_AGE_EXCEEDED";
  const freshnessDetails = withStopTarget.map((row) => {
    const age = row.ageMin == null ? "age=N/A" : `age=${row.ageMin}m`;
    return `${row.source}:${row.freshnessStatus}:${row.geometryStatus}:${age}`;
  });

  return {
    symbol,
    qty: toNum(position?.qty),
    currentPrice,
    positionStatus: position?.positionStatus || null,
    ownershipClassification: ownership.ownershipClass,
    fillStateReconciliation: ownership.fillStateReconciliation,
    protectionRootCauses: protectionRow?.rootCauses || [],
    protectionRepairDecision: protectionRow?.repairLaneDecision || protectionRow?.repairDecision || null,
    guardRefreshDecision: guardRefreshRow?.refreshDecision || null,
    guardRefreshAfterDecision: guardRefreshRow?.afterRefreshRepairDecision || null,
    lineageStatus,
    disconnectPoint,
    rootCause,
    freshValidSources: freshValid.map((row) => row.source),
    staleSources: stale.map((row) => row.source),
    invalidSources: invalid.map((row) => row.source),
    freshnessDetails,
    sourceSummary: {
      presentSources: sources.filter((row) => row.present).map((row) => row.source),
      sourcesWithStopTarget: withStopTarget.map((row) => row.source),
      sourceCount: sources.length
    },
    sourceProbes: sources,
    action: freshValid.length
      ? "monitor_or_repair_reevaluation_allowed_by_report_only_policy"
      : !withStopTarget.length
        ? "trace_signal_to_order_lineage_gap"
        : invalid.length
          ? "route_to_stage6_guard_geometry_root_cause"
          : "wait_for_fresh_stage6_or_lifecycle_guard_source"
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Guard Metadata Lineage Audit");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`positions=${report.summary.positions} ready=${report.summary.ready} missing=${report.summary.missingNoSource} stale=${report.summary.staleSourceOnly} invalid=${report.summary.invalidGeometry} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``
  );
  lines.push(`- root_causes: \`${JSON.stringify(report.summary.rootCauseCounts)}\``);
  lines.push("- safety: `report-only; no broker mutation; no state mutation`");
  lines.push("| Symbol | Lineage Status | Ownership | Fill State | Root Cause | Disconnect Point | Fresh Valid Sources | Stale Sources | Invalid Sources | Freshness Details | Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `| ${row.symbol} | ${row.lineageStatus} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || "N/A"} | ${row.rootCause} | ${row.disconnectPoint} | ${row.freshValidSources.join(",") || "none"} | ${row.staleSources.join(",") || "none"} | ${row.invalidSources.join(",") || "none"} | ${short(row.freshnessDetails.join("; "), 260) || "none"} | ${row.action} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const performance = readJson(FILES.performance);
  const protectionAudit = readJson(FILES.protectionAudit);
  const guardRefresh = readJson(FILES.guardRefresh);
  const recommendationLedger = readJson(FILES.recommendationLedger);
  const stage6Loop = readJson(FILES.stage6Loop);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.orderIdempotency);
  const fillability = readJson(FILES.fillability);
  const preview = readJson(FILES.preview);

  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const protectionBySymbol = indexArrayBySymbol(protectionAudit?.rows);
  const guardRefreshBySymbol = indexArrayBySymbol(guardRefresh?.rows);
  const fillabilityBySymbol = indexArrayBySymbol(fillability?.rows);
  const previewBySymbol = indexArrayBySymbol(preview?.orderDecisionAudit?.records);

  const rows = positions
    .filter((position) => (toNum(position?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      return buildRow({
        position,
        protectionRow: protectionBySymbol.get(symbol) || null,
        guardRefreshRow: guardRefreshBySymbol.get(symbol) || null,
        recommendation: recommendationLedger?.recommendations?.[symbol] || null,
        loopRow: latestLoopRow(stage6Loop, symbol),
        ledgerRow: valuesBySymbol(orderLedger?.orders, symbol),
        idempotencyRow: valuesBySymbol(idempotency?.orders, symbol),
        fillabilityRow: fillabilityBySymbol.get(symbol) || null,
        previewRecord: previewBySymbol.get(symbol) || null,
        performanceGeneratedAt: performance?.generatedAt || null
      });
    });

  const count = (status) => rows.filter((row) => row.lineageStatus === status).length;
  const summary = {
    positions: rows.length,
    ready: count("LINEAGE_READY"),
    missingNoSource: count("LINEAGE_MISSING_NO_SOURCE"),
    staleSourceOnly: count("LINEAGE_STALE_SOURCE_ONLY"),
    invalidGeometry: count("LINEAGE_INVALID_GEOMETRY"),
    rootCauseCounts: rows.reduce((acc, row) => {
      acc[row.rootCause] = (acc[row.rootCause] || 0) + 1;
      return acc;
    }, {}),
    freshnessStatusCounts: rows.reduce((acc, row) => {
      for (const probe of row.sourceProbes || []) {
        if (!probe.hasStopTarget) continue;
        acc[probe.freshnessStatus] = (acc[probe.freshnessStatus] || 0) + 1;
      }
      return acc;
    }, {}),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false
  };
  const overall = summary.invalidGeometry > 0
    ? "invalid_geometry"
    : summary.missingNoSource > 0 || summary.staleSourceOnly > 0
      ? "lineage_gaps_found"
      : "ready";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_guard_metadata_lineage_not_ticker_specific",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    config: {
      maxSourceAgeMin: MAX_SOURCE_AGE_MIN
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[GUARD_METADATA_LINEAGE_AUDIT] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} positions=${summary.positions} ready=${summary.ready} missing=${summary.missingNoSource} stale=${summary.staleSourceOnly} invalid=${summary.invalidGeometry} attempted=false submitted=false`
  );
};

main();
