import fs from "node:fs";
import { classifyProtectionOwnership } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.GUARD_METADATA_REFRESH_STATE_DIR || "state").trim() || "state";
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const PROTECTION_AUDIT_PATH = `${STATE_DIR}/position-protection-root-cause-audit.json`;
const RECOMMENDATION_LEDGER_PATH = `${STATE_DIR}/recommendation-ledger.json`;
const STAGE6_LOOP_PATH = `${STATE_DIR}/stage6-20trade-loop.json`;
const ORDER_LEDGER_PATH = `${STATE_DIR}/order-ledger.json`;
const IDEMPOTENCY_PATH = `${STATE_DIR}/order-idempotency.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const LIFECYCLE_GUARD_SOURCE_PATH = `${STATE_DIR}/position-lifecycle-guard-source-plan.json`;
const OUTPUT_JSON = `${STATE_DIR}/guard-metadata-refresh-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/guard-metadata-refresh-plan.md`;

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

const positiveEnv = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};
const round = (value, digits = 4) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(digits));
};
const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / 60000;
};
const latestIso = (...values) => {
  const timestamps = values
    .map((value) => Date.parse(String(value || "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
};

const freshnessMaxAgeMin = positiveEnv(
  "GUARD_METADATA_REFRESH_SOURCE_MAX_AGE_MIN",
  positiveEnv("OCO_REPAIR_GUARD_METADATA_MAX_AGE_MIN", 30)
);

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

const sourceCandidate = ({ type, stop, target, generatedAt, stage6Hash, stage6File, detail }) => {
  const stopPrice = toNum(stop);
  const targetPrice = toNum(target);
  const ageMinRaw = ageMinutes(generatedAt);
  return {
    type,
    stopPrice,
    targetPrice,
    generatedAt: generatedAt || null,
    ageMin: round(ageMinRaw, 2),
    stage6Hash: stage6Hash || null,
    stage6File: stage6File || null,
    detail: short(detail, 300),
    hasBothPrices: stopPrice != null && targetPrice != null,
    fresh: ageMinRaw != null && ageMinRaw <= freshnessMaxAgeMin
  };
};

const buildSources = ({ position, recommendation, loopRow, ledgerRow, lifecycleRow, performanceGeneratedAt }) => {
  const sources = [];
  if (position?.brokerStopPresent === true || position?.brokerTargetPresent === true) {
    sources.push(sourceCandidate({
      type: "broker_children",
      stop: position?.brokerStopPrice,
      target: position?.brokerTargetPrice,
      generatedAt: performanceGeneratedAt,
      stage6Hash: position?.plannedStage6Hash,
      stage6File: position?.plannedStage6File,
      detail: "active Alpaca nested sell children observed in current performance dashboard"
    }));
  }
  if (lifecycleRow?.lifecycleReady === true && lifecycleRow?.lifecycleSource) {
    sources.push(sourceCandidate({
      type: lifecycleRow.lifecycleSource.type || "position_lifecycle_revalidated_guard",
      stop: lifecycleRow.lifecycleSource.stopPrice,
      target: lifecycleRow.lifecycleSource.targetPrice,
      generatedAt: lifecycleRow.lifecycleSource.generatedAt,
      stage6Hash: lifecycleRow.lifecycleSource.stage6Hash,
      stage6File: lifecycleRow.lifecycleSource.stage6File,
      detail: `original=${lifecycleRow.lifecycleSource.originalSourceType || "N/A"} originalAt=${lifecycleRow.lifecycleSource.originalGeneratedAt || "N/A"} decision=${lifecycleRow.lifecycleDecision || "N/A"}`
    }));
  }
  if (recommendation) {
    sources.push(sourceCandidate({
      type: "recommendation_ledger",
      stop: recommendation?.stop,
      target: recommendation?.target,
      generatedAt: recommendation?.updatedAt || recommendation?.lastSeenAt,
      stage6Hash: recommendation?.stage6Hash,
      stage6File: recommendation?.latestStage6File,
      detail: `status=${recommendation?.status || "N/A"} decision=${recommendation?.finalDecision || "N/A"} reason=${recommendation?.decisionReason || "N/A"}`
    }));
  }
  if (loopRow) {
    sources.push(sourceCandidate({
      type: "stage6_20trade_loop",
      stop: loopRow?.stopPlanned,
      target: loopRow?.targetPlanned,
      generatedAt: loopRow?.runDate,
      stage6Hash: loopRow?.stage6Hash,
      stage6File: loopRow?.stage6File,
      detail: `rowId=${loopRow?.rowId || "N/A"} reason=${loopRow?.decisionReason || "N/A"}`
    }));
  }
  if (ledgerRow) {
    sources.push(sourceCandidate({
      type: "order_ledger",
      stop: ledgerRow?.stopLossPrice,
      target: ledgerRow?.takeProfitPrice,
      generatedAt: ledgerRow?.updatedAt || ledgerRow?.createdAt,
      stage6Hash: ledgerRow?.stage6Hash,
      stage6File: ledgerRow?.stage6File,
      detail: `status=${ledgerRow?.status || "N/A"} reason=${ledgerRow?.statusReason || "N/A"}`
    }));
  }
  return sources;
};

const chooseSource = (sources) => {
  const priority = ["broker_children", "position_lifecycle_revalidated_guard", "recommendation_ledger", "stage6_20trade_loop", "order_ledger"];
  const ready = sources.filter((row) => row.hasBothPrices && row.fresh);
  ready.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  if (ready.length) return ready[0];
  const withPrices = sources.filter((row) => row.hasBothPrices);
  withPrices.sort((a, b) => (a.ageMin ?? Number.POSITIVE_INFINITY) - (b.ageMin ?? Number.POSITIVE_INFINITY));
  return withPrices[0] || null;
};

const buildRow = ({ position, protectionRow, recommendation, loopRow, ledgerRow, idempotencyRow, fillabilityRow, lifecycleRow, performanceGeneratedAt }) => {
  const symbol = asSymbol(position?.symbol);
  const qty = toNum(position?.qty) ?? 0;
  const currentPrice = toNum(position?.currentPrice);
  const sources = buildSources({ position, recommendation, loopRow, ledgerRow, lifecycleRow, performanceGeneratedAt });
  const selected = chooseSource(sources);
  const selectedFresh = selected?.hasBothPrices === true && selected?.fresh === true;
  const geometryValid =
    selected?.stopPrice != null &&
    selected?.targetPrice != null &&
    currentPrice != null &&
    selected.stopPrice < currentPrice &&
    currentPrice < selected.targetPrice &&
    selected.targetPrice > selected.stopPrice;
  const brokerStopPresent = position?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true;
  const brokerChildrenComplete = brokerStopPresent && brokerTargetPresent;
  const ownership = classifyProtectionOwnership({
    position,
    reconciliationRow: protectionRow,
    ledgerRow,
    idempotencyRow,
    fillabilityRow
  });
  const brokerChildMissingAfterRefresh = selectedFresh && geometryValid && (!brokerStopPresent || !brokerTargetPresent);
  const blockers = [];
  const warnings = [];

  if (qty <= 0) blockers.push("no_open_position");
  if (ownership.ownershipClass === "EXTERNAL_OR_MANUAL_POSITION") blockers.push("position_not_sidecar_managed");
  if (ownership.fillStateReconciliation.repairBlocked && ownership.ownershipClass !== "EXTERNAL_OR_MANUAL_POSITION") {
    blockers.push("fill_state_reconciliation_required");
  }
  if (!sources.length) blockers.push("no_guard_refresh_source");
  if (!selected) blockers.push("no_source_with_stop_target");
  if (selected && !selected.hasBothPrices) blockers.push("selected_source_missing_stop_or_target");
  if (selected && selected.hasBothPrices && !selected.fresh) blockers.push("selected_source_stale");
  if (selectedFresh && !geometryValid) blockers.push("selected_source_invalid_geometry");
  if (protectionRow?.missingGuardMetadata === true) warnings.push("current_guard_metadata_missing");
  if (protectionRow?.guardMetadataStale === true) warnings.push("current_guard_metadata_stale");
  if (protectionRow?.brokerChildMissing === true) warnings.push("broker_child_missing");
  if (brokerStopPresent && brokerTargetPresent) warnings.push("broker_children_already_present");

  const refreshReady = blockers.length === 0;
  let refreshDecision = "BLOCKED_REFRESH_INPUT";
  if (brokerChildrenComplete && selectedFresh && geometryValid) {
    refreshDecision = "FRESH_BROKER_CHILDREN_PRESENT_MONITOR_ONLY";
  } else if (blockers.includes("position_not_sidecar_managed")) {
    refreshDecision = "BLOCKED_POSITION_OWNERSHIP_REVIEW";
  } else if (blockers.includes("fill_state_reconciliation_required")) {
    refreshDecision = "BLOCKED_FILL_STATE_RECONCILIATION";
  } else if (refreshReady && brokerChildMissingAfterRefresh) {
    refreshDecision = "REFRESH_READY_THEN_REEVALUATE_REPAIR";
  } else if (refreshReady) {
    refreshDecision = "REFRESH_READY_MONITOR_ONLY";
  } else if (blockers.includes("no_guard_refresh_source") || blockers.includes("no_source_with_stop_target")) {
    refreshDecision = "BLOCKED_NO_REFRESH_SOURCE";
  } else if (blockers.includes("selected_source_stale")) {
    refreshDecision = "BLOCKED_REFRESH_SOURCE_STALE";
  } else if (blockers.includes("selected_source_invalid_geometry")) {
    refreshDecision = "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY";
  }

  const afterRefreshRepairDecision = brokerChildrenComplete
    ? "NO_REPAIR_NEEDED_BROKER_CHILDREN_PRESENT"
    : !refreshReady
      ? "NOT_EVALUATED_REFRESH_BLOCKED"
      : brokerChildMissingAfterRefresh
        ? "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"
        : "NO_REPAIR_NEEDED_AFTER_REFRESH";

  return {
    symbol,
    qty,
    currentPrice,
    currentGuard: {
      stopPrice: toNum(position?.plannedStopPrice ?? position?.stopPrice),
      targetPrice: toNum(position?.plannedTargetPrice ?? position?.targetPrice),
      source: position?.plannedStopSource || position?.plannedTargetSource || null,
      updatedAt: position?.plannedLedgerUpdatedAt || null,
      ageMin: round(ageMinutes(position?.plannedLedgerUpdatedAt))
    },
    broker: {
      stopPresent: brokerStopPresent,
      targetPresent: brokerTargetPresent,
      stopPrice: toNum(position?.brokerStopPrice),
      targetPrice: toNum(position?.brokerTargetPrice),
      sellOrderCount: toNum(position?.brokerSellOrderCount) ?? 0,
      nestedSellOrderCount: toNum(position?.brokerNestedSellOrderCount) ?? 0
    },
    selectedSource: selected,
    sourceCandidates: sources,
    selectedSourceFresh: selectedFresh,
    selectedSourceGeometryValid: geometryValid,
    ownershipClassification: ownership.ownershipClass,
    sidecarManaged: ownership.sidecarManaged,
    repairAllowedByOwnership: ownership.repairAllowedByOwnership,
    fillStateReconciliation: ownership.fillStateReconciliation,
    refreshReady,
    refreshDecision,
    afterRefreshRepairDecision,
    brokerChildMissingAfterRefresh,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    lineage: {
      recommendationStatus: recommendation?.status || null,
      recommendationUpdatedAt: recommendation?.updatedAt || null,
      loopRunDate: loopRow?.runDate || null,
      ledgerStatus: ledgerRow?.status || null,
      ledgerUpdatedAt: ledgerRow?.updatedAt || null,
      idempotencyBrokerStatus: idempotencyRow?.brokerStatus || null,
      fillabilityStatus: fillabilityRow?.status || null,
      latestObservedAt: latestIso(
        recommendation?.updatedAt,
        recommendation?.lastSeenAt,
        loopRow?.runDate,
        ledgerRow?.updatedAt,
        idempotencyRow?.brokerCheckedAt,
        fillabilityRow?.observedAt
      )
    },
    executionAllowed: false,
    brokerMutationAllowed: false,
    stateMutationAllowed: false,
    reason: refreshReady
      ? `selected ${selected.type}; report-only refresh candidate`
      : `blocked:${blockers.join(",") || "unknown"}`
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Guard Metadata Refresh Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`positions=${report.summary.positions} refreshReady=${report.summary.refreshReady} blocked=${report.summary.blocked} noSource=${report.summary.noRefreshSource} staleSource=${report.summary.staleRefreshSource} invalidGeometry=${report.summary.invalidRefreshGeometry} fillRecon=${report.summary.fillStateReconciliationRequired} ownershipReview=${report.summary.positionOwnershipReviewRequired} brokerChildrenMonitor=${report.summary.brokerChildrenMonitorOnly} repairAfterRefresh=${report.summary.repairReevaluationCandidates}\``
  );
  lines.push("- safety: `report-only; no broker mutation; no ledger mutation; future metadata write requires separate approval`");
  lines.push("| Symbol | Decision | Ownership | Fill State | Source | Fresh | Current | Stop | Target | Current Guard Age | Broker Children | After Refresh | Blockers |");
  lines.push("| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.refreshDecision} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || "N/A"} | ${row.selectedSource?.type || "N/A"} | ${row.selectedSourceFresh ? "yes" : "no"} | ${fmt(row.currentPrice)} | ${fmt(row.selectedSource?.stopPrice)} | ${fmt(row.selectedSource?.targetPrice)} | ${fmt(row.currentGuard.ageMin)} | stop=${row.broker.stopPresent ? "present" : "missing"},target=${row.broker.targetPresent ? "present" : "missing"} | ${row.afterRefreshRepairDecision} | ${short(row.blockers.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const count = (rows, predicate) => rows.filter(predicate).length;

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const performance = readJson(PERFORMANCE_PATH);
  const protectionAudit = readJson(PROTECTION_AUDIT_PATH);
  const recommendationLedger = readJson(RECOMMENDATION_LEDGER_PATH);
  const stage6Loop = readJson(STAGE6_LOOP_PATH);
  const orderLedger = readJson(ORDER_LEDGER_PATH);
  const idempotency = readJson(IDEMPOTENCY_PATH);
  const fillability = readJson(FILLABILITY_PATH);
  const preview = readJson(PREVIEW_PATH);
  const lifecyclePlan = readJson(LIFECYCLE_GUARD_SOURCE_PATH);
  const positions = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  const protectionBySymbol = indexArrayBySymbol(protectionAudit?.rows);
  const lifecycleBySymbol = indexArrayBySymbol(lifecyclePlan?.rows);
  const rows = positions
    .filter((position) => (toNum(position?.qty) ?? 0) > 0)
    .map((position) => {
      const symbol = asSymbol(position?.symbol);
      return buildRow({
        position,
        protectionRow: protectionBySymbol.get(symbol) || null,
        recommendation: recommendationLedger?.recommendations?.[symbol] || null,
        loopRow: latestLoopRow(stage6Loop, symbol),
        ledgerRow: valuesBySymbol(orderLedger?.orders, symbol),
        idempotencyRow: valuesBySymbol(idempotency?.orders, symbol),
        fillabilityRow: (Array.isArray(fillability?.rows) ? fillability.rows : []).find((row) => asSymbol(row?.symbol) === symbol) || null,
        lifecycleRow: lifecycleBySymbol.get(symbol) || null,
        performanceGeneratedAt: performance?.generatedAt || null
      });
    });
  const summary = {
    positions: rows.length,
    refreshReady: count(rows, (row) => row.refreshReady),
    blocked: count(rows, (row) => !row.refreshReady),
    noRefreshSource: count(rows, (row) => row.refreshDecision === "BLOCKED_NO_REFRESH_SOURCE"),
    staleRefreshSource: count(rows, (row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_STALE"),
    invalidRefreshGeometry: count(rows, (row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY"),
    fillStateReconciliationRequired: count(rows, (row) => row.refreshDecision === "BLOCKED_FILL_STATE_RECONCILIATION"),
    positionOwnershipReviewRequired: count(rows, (row) => row.refreshDecision === "BLOCKED_POSITION_OWNERSHIP_REVIEW"),
    brokerChildrenMonitorOnly: count(rows, (row) => row.refreshDecision === "FRESH_BROKER_CHILDREN_PRESENT_MONITOR_ONLY"),
    brokerChildrenSourceReady: count(rows, (row) => row.refreshReady && row.selectedSource?.type === "broker_children"),
    repairReevaluationCandidates: count(rows, (row) => row.afterRefreshRepairDecision === "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"),
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false
  };
  const overall = !performance?.live?.available
    ? "warn"
    : summary.repairReevaluationCandidates > 0
      ? "manual_review_ready"
      : summary.refreshReady > 0 && summary.blocked > 0
        ? "partial"
        : summary.refreshReady > 0
          ? "ready"
          : "blocked";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_guard_metadata_refresh_plan_not_ticker_specific",
    files: {
      performanceDashboard: Boolean(performance),
      positionProtectionAudit: Boolean(protectionAudit),
      recommendationLedger: Boolean(recommendationLedger),
      stage6Loop: Boolean(stage6Loop),
      orderLedger: Boolean(orderLedger),
      orderIdempotency: Boolean(idempotency),
      fillability: Boolean(fillability),
      preview: Boolean(preview),
      positionLifecycleGuardSourcePlan: Boolean(lifecyclePlan)
    },
    source: {
      performanceDashboardGeneratedAt: performance?.generatedAt || null,
      protectionAuditGeneratedAt: protectionAudit?.generatedAt || null,
      lifecycleGuardSourceOverall: lifecyclePlan?.overall || null,
      latestStage6Hash: preview?.stage6Hash || null,
      latestStage6File: preview?.stage6File || null
    },
    config: {
      refreshSourceMaxAgeMin: freshnessMaxAgeMin,
      sourcePriority: ["broker_children", "position_lifecycle_revalidated_guard", "recommendation_ledger", "stage6_20trade_loop", "order_ledger"]
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false,
      requiresSeparateApprovalForStateWrite: true
    },
    summary,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[GUARD_METADATA_REFRESH_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} positions=${summary.positions} ready=${summary.refreshReady} blocked=${summary.blocked} repairAfterRefresh=${summary.repairReevaluationCandidates} attempted=false submitted=false`
  );
};

main();
