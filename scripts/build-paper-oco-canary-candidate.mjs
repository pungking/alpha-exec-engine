import fs from "node:fs";
import { evaluateGuardMetadataRisk } from "./lib/guard-metadata-risk.mjs";

const STATE_DIR = String(process.env.PAPER_OCO_CANARY_STATE_DIR || "state").trim() || "state";
const GUARDED_PLAN_PATH = `${STATE_DIR}/guarded-child-order-repair-plan.json`;
const RECONCILIATION_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const ORDER_STATE_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const PAYLOAD_SCHEMA_PATH = `${STATE_DIR}/alpaca-order-payload-schema-report.json`;
const OCO_RESPONSE_PATH = `${STATE_DIR}/alpaca-oco-response-fixture-report.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const OUTPUT_JSON = `${STATE_DIR}/paper-oco-canary-candidate.json`;
const OUTPUT_MD = `${STATE_DIR}/paper-oco-canary-candidate.md`;

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

const fmt = (value, digits = 2) => {
  const n = toNum(value);
  if (n == null) return "N/A";
  return n.toFixed(digits);
};

const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const pctDistance = (from, to) => {
  const a = toNum(from);
  const b = toNum(to);
  if (a == null || b == null || a <= 0) return null;
  return ((b - a) / a) * 100;
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();

const indexBySymbol = (rows) => {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = asSymbol(row?.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const buildGlobalGates = ({ guardedPlan, reconciliation, performance, orderState, payloadSchema, ocoResponse, preview }) => {
  const gates = [
    {
      id: "guarded_repair_plan_present",
      status: guardedPlan ? "PASS" : "BLOCK",
      detail: guardedPlan ? "guarded child-order repair plan loaded" : "missing guarded-child-order-repair-plan.json"
    },
    {
      id: "broker_child_reconciliation_present",
      status: reconciliation ? "PASS" : "BLOCK",
      detail: reconciliation ? "broker child-order reconciliation loaded" : "missing broker-child-order-reconciliation.json"
    },
    {
      id: "performance_dashboard_present",
      status: performance ? "PASS" : "BLOCK",
      detail: performance ? "performance dashboard loaded" : "missing performance-dashboard.json"
    },
    {
      id: "order_state_consistency_pass",
      status: orderState?.overall === "PASS" ? "PASS" : "BLOCK",
      detail: `order-state overall=${orderState?.overall || "N/A"}`
    },
    {
      id: "payload_schema_fixture_pass",
      status: payloadSchema?.overall === "pass" ? "PASS" : "BLOCK",
      detail: `alpaca payload schema overall=${payloadSchema?.overall || "N/A"}`
    },
    {
      id: "oco_response_fixture_pass",
      status: ocoResponse?.overall === "pass" ? "PASS" : "BLOCK",
      detail: `alpaca OCO response fixture overall=${ocoResponse?.overall || "N/A"}`
    },
    {
      id: "nested_open_order_source_present",
      status: performance?.live?.totals?.openOrderNested === true ? "PASS" : "BLOCK",
      detail: `openOrderNested=${performance?.live?.totals?.openOrderNested ?? "N/A"}`
    },
    {
      id: "runtime_safe_flags_observed",
      status: preview?.mode?.readOnly === true && preview?.mode?.execEnabled === false ? "PASS" : "WARN",
      detail: `READ_ONLY=${preview?.mode?.readOnly ?? "N/A"} EXEC_ENABLED=${preview?.mode?.execEnabled ?? "N/A"}; selector is report-only and remains broker-non-mutating`
    },
    {
      id: "paper_canary_is_report_only",
      status: "PASS",
      detail: "selector does not call Alpaca, does not emit an executable payload, and does not mutate broker state"
    },
    {
      id: "future_broker_mutation_requires_approval",
      status: "BLOCK",
      detail: "future paper OCO submit requires a separate execution-policy approval gate and one manually selected symbol/qty"
    }
  ];
  return gates;
};

const buildCandidateRow = ({ repairRow, reconciliationRow, performanceRow, orderStateRow, stage6Hash, sourceGeneratedAt }) => {
  const symbol = asSymbol(repairRow?.symbol);
  const qty = toNum(repairRow?.qty ?? performanceRow?.qty) ?? 0;
  const currentPrice = toNum(repairRow?.currentPrice ?? reconciliationRow?.currentPrice ?? performanceRow?.currentPrice);
  const plannedStopPrice = toNum(
    repairRow?.effectiveStopPrice ?? reconciliationRow?.effectiveStopPrice ?? repairRow?.plannedStopPrice ?? reconciliationRow?.plannedStopPrice ?? performanceRow?.plannedStopPrice ?? performanceRow?.stopPrice
  );
  const plannedTargetPrice = toNum(
    repairRow?.effectiveTargetPrice ?? reconciliationRow?.effectiveTargetPrice ?? repairRow?.plannedTargetPrice ?? reconciliationRow?.plannedTargetPrice ?? performanceRow?.plannedTargetPrice ?? performanceRow?.targetPrice
  );
  const stopMissing = repairRow?.stopMissing === true || reconciliationRow?.stopChildMissing === true;
  const targetMissing = repairRow?.targetMissing === true || reconciliationRow?.targetChildMissing === true;
  const brokerStopPresent = reconciliationRow?.brokerStopPresent === true || performanceRow?.brokerStopPresent === true;
  const brokerTargetPresent = reconciliationRow?.brokerTargetPresent === true || performanceRow?.brokerTargetPresent === true;
  const canaryQty = qty >= 1 ? 1 : 0;
  const blockers = [];
  const warnings = [];

  if (!symbol) blockers.push("missing_symbol");
  if (repairRow?.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION" || reconciliationRow?.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION") {
    blockers.push("position_not_sidecar_managed");
  }
  if (repairRow?.fillStateReconciliation?.repairBlocked === true || reconciliationRow?.fillStateReconciliation?.repairBlocked === true) {
    blockers.push("fill_state_reconciliation_required");
  }
  if (repairRow?.candidate !== true || repairRow?.readiness !== "CANDIDATE_BLOCKED_REPORT_ONLY") {
    blockers.push("not_guarded_report_only_candidate");
  }
  if (repairRow?.executionAllowed !== false) blockers.push("repair_row_execution_flag_not_false");
  if (qty <= 0) blockers.push("no_open_long_position_qty");
  if (qty > 0 && qty < 1) blockers.push("canary_requires_at_least_one_whole_share");
  if (!stopMissing || !targetMissing) blockers.push("oco_canary_requires_both_stop_and_target_missing");
  if (brokerStopPresent || brokerTargetPresent) blockers.push("active_broker_child_already_present");
  if (currentPrice == null || currentPrice <= 0) blockers.push("invalid_current_price");
  if (plannedStopPrice == null || plannedStopPrice <= 0) blockers.push("invalid_planned_stop_price");
  if (plannedTargetPrice == null || plannedTargetPrice <= 0) blockers.push("invalid_planned_target_price");
  if (currentPrice != null && plannedStopPrice != null && plannedStopPrice >= currentPrice) {
    blockers.push("planned_stop_not_below_current_price");
  }
  if (currentPrice != null && plannedTargetPrice != null && plannedTargetPrice <= currentPrice) {
    blockers.push("planned_target_not_above_current_price");
  }
  if (plannedStopPrice != null && plannedTargetPrice != null && plannedTargetPrice <= plannedStopPrice) {
    blockers.push("invalid_target_stop_geometry");
  }
  if (orderStateRow?.status === "FAIL") blockers.push("order_state_symbol_failure");
  if (orderStateRow?.status === "WARN") warnings.push("order_state_symbol_warning");
  if (performanceRow?.positionStatus === "HOLD_MONITOR_GUARD_MISSING") blockers.push("missing_position_guard_metadata");
  const guardMetadataGeneratedAt =
    reconciliationRow?.effectiveGuardGeneratedAt ||
    reconciliationRow?.plannedLedgerUpdatedAt ||
    performanceRow?.plannedLedgerUpdatedAt ||
    sourceGeneratedAt ||
    null;
  const guardMetadataRisk = evaluateGuardMetadataRisk({
    generatedAt: guardMetadataGeneratedAt,
    currentPrice,
    plannedStopPrice,
    plannedTargetPrice
  });
  blockers.push(...guardMetadataRisk.blockers);
  if (reconciliationRow?.severity && reconciliationRow.severity !== "critical") {
    warnings.push(`source_severity_${reconciliationRow.severity}`);
  }

  const technicalEligible = blockers.length === 0;
  const stage6Short = short(stage6Hash || "unknown", 12).replace(/[^a-zA-Z0-9]/g, "") || "unknown";
  const idempotencyKeyPreview = technicalEligible
    ? `paper-oco-canary:${stage6Short}:${symbol}:qty=${canaryQty}:stop=${plannedStopPrice}:target=${plannedTargetPrice}`
    : null;
  const clientOrderIdPreview = technicalEligible
    ? `oco_canary_${stage6Short}_${symbol}_q${canaryQty}`.slice(0, 48)
    : null;

  return {
    symbol,
    technicalEligible,
    readiness: technicalEligible ? "ELIGIBLE_PENDING_MANUAL_SELECTION" : "BLOCKED",
    executionAllowed: false,
    canaryQty,
    sourceQty: qty,
    currentPrice,
    plannedStopPrice,
    plannedTargetPrice,
    stopDistancePct: currentPrice != null && plannedStopPrice != null ? pctDistance(currentPrice, plannedStopPrice) : null,
    targetDistancePct: currentPrice != null && plannedTargetPrice != null ? pctDistance(currentPrice, plannedTargetPrice) : null,
    stopMissing,
    targetMissing,
    brokerStopPresent,
    brokerTargetPresent,
    guardMetadataGeneratedAt,
    guardMetadataRisk,
    canaryNotional: canaryQty > 0 && currentPrice != null ? canaryQty * currentPrice : null,
    orderStateStatus: orderStateRow?.status || null,
    positionStatus: performanceRow?.positionStatus || null,
    normalizedFillState: performanceRow?.normalizedFillState || reconciliationRow?.normalizedFillState || null,
    ownershipClassification: repairRow?.ownershipClassification || reconciliationRow?.ownershipClassification || null,
    fillStateReconciliation: repairRow?.fillStateReconciliation || reconciliationRow?.fillStateReconciliation || null,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    idempotencyKeyPreview,
    clientOrderIdPreview,
    reason: technicalEligible
      ? "eligible for manual single-symbol paper OCO canary selection; still not executable without separate approval"
      : `blocked: ${blockers.join(",") || "unknown"}`
  };
};

const selectCandidate = (rows, requestedSymbol) => {
  const eligible = rows.filter((row) => row.technicalEligible);
  if (!eligible.length) return null;
  if (requestedSymbol) {
    const requested = eligible.find((row) => row.symbol === requestedSymbol);
    if (requested) return requested;
    return null;
  }
  return [...eligible].sort((a, b) => {
    const an = toNum(a.canaryNotional) ?? Number.POSITIVE_INFINITY;
    const bn = toNum(b.canaryNotional) ?? Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    return String(a.symbol).localeCompare(String(b.symbol));
  })[0];
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Paper OCO Canary Candidate Selector");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} eligible=${report.summary.eligible} selected=${report.summary.selectedSymbol || "N/A"} canaryQty=${report.summary.selectedCanaryQty ?? "N/A"} executionReady=${report.summary.executionReadyRows}\``
  );
  lines.push("- safety: `report-only selector; no broker calls; no executable payload; future paper submit requires separate approval`");
  lines.push("- gates:");
  for (const gate of report.gates) {
    lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  }
  if (report.selectedCandidate) {
    const row = report.selectedCandidate;
    lines.push(
      `- selected_candidate: \`${row.symbol} qty=${row.canaryQty} current=${fmt(row.currentPrice)} stop=${fmt(row.plannedStopPrice)} target=${fmt(row.plannedTargetPrice)} notional=${fmt(row.canaryNotional)}\``
    );
  }
  lines.push("| Symbol | Readiness | Qty | Current | Stop | Target | StopDist% | TargetDist% | GuardRisk | Blockers | Warnings |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.readiness} | ${fmt(row.canaryQty, 3)} | ${fmt(row.currentPrice)} | ${fmt(row.plannedStopPrice)} | ${fmt(row.plannedTargetPrice)} | ${fmt(row.stopDistancePct)} | ${fmt(row.targetDistancePct)} | ${row.guardMetadataRisk?.status || "N/A"} | ${short(row.blockers.join(","), 220) || "none"} | ${short(row.warnings.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const guardedPlan = readJson(GUARDED_PLAN_PATH);
  const reconciliation = readJson(RECONCILIATION_PATH);
  const performance = readJson(PERFORMANCE_PATH);
  const orderState = readJson(ORDER_STATE_PATH);
  const payloadSchema = readJson(PAYLOAD_SCHEMA_PATH);
  const ocoResponse = readJson(OCO_RESPONSE_PATH);
  const preview = readJson(PREVIEW_PATH);
  const requestedSymbol = asSymbol(process.env.PAPER_OCO_CANARY_SYMBOL);
  const globalGates = buildGlobalGates({ guardedPlan, reconciliation, performance, orderState, payloadSchema, ocoResponse, preview });
  const globalBlockers = globalGates
    .filter((gate) => gate.status === "BLOCK" && gate.id !== "future_broker_mutation_requires_approval")
    .map((gate) => gate.id);

  const reconciliationBySymbol = indexBySymbol(reconciliation?.rows);
  const performanceBySymbol = indexBySymbol(performance?.live?.positions);
  const orderStateBySymbol = indexBySymbol(orderState?.rows);
  const stage6Hash = guardedPlan?.source?.stage6Hash || preview?.stage6Hash || null;
  const repairRows = Array.isArray(guardedPlan?.rows) ? guardedPlan.rows : [];
  const rows = repairRows
    .filter((row) => row?.readiness === "CANDIDATE_BLOCKED_REPORT_ONLY" || row?.candidate === true)
    .map((row) => buildCandidateRow({
      repairRow: row,
      reconciliationRow: reconciliationBySymbol.get(asSymbol(row?.symbol)),
      performanceRow: performanceBySymbol.get(asSymbol(row?.symbol)),
      orderStateRow: orderStateBySymbol.get(asSymbol(row?.symbol)),
      stage6Hash,
      sourceGeneratedAt: reconciliation?.generatedAt || guardedPlan?.generatedAt || performance?.generatedAt || null
    }))
    .map((row) => {
      if (globalBlockers.length === 0) return row;
      return {
        ...row,
        technicalEligible: false,
        readiness: "BLOCKED_GLOBAL_GATE",
        blockers: [...new Set([...row.blockers, ...globalBlockers])],
        idempotencyKeyPreview: null,
        clientOrderIdPreview: null,
        reason: `blocked by global gates: ${globalBlockers.join(",")}`
      };
    });

  const selected = selectCandidate(rows, requestedSymbol);
  const selectedRows = rows.map((row) => {
    if (!selected || row.symbol !== selected.symbol) return row;
    return {
      ...row,
      readiness: "SELECTED_PENDING_SAFETY_APPROVAL",
      reason: "selected as the lowest-notional eligible single-symbol paper OCO canary candidate; broker mutation remains disabled"
    };
  });
  const selectedCandidate = selectedRows.find((row) => selected && row.symbol === selected.symbol) || null;
  const eligible = rows.filter((row) => row.technicalEligible);
  const requestedBlocked = requestedSymbol && !selected;
  const unsafe = selectedRows.some((row) => row.executionAllowed !== false);
  const overall = unsafe
    ? "fail"
    : selectedCandidate
      ? "manual_selection_ready"
      : requestedBlocked
        ? "requested_symbol_blocked"
        : rows.length > 0
          ? "blocked"
          : "no_candidate";

  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "portfolio_wide_dynamic_candidates_not_ticker_specific",
    requestedSymbol: requestedSymbol || null,
    files: {
      guardedRepairPlan: Boolean(guardedPlan),
      brokerChildReconciliation: Boolean(reconciliation),
      performanceDashboard: Boolean(performance),
      orderStateConsistency: Boolean(orderState),
      alpacaPayloadSchema: Boolean(payloadSchema),
      alpacaOcoResponseFixture: Boolean(ocoResponse),
      preview: Boolean(preview)
    },
    source: {
      stage6Hash,
      stage6File: guardedPlan?.source?.stage6File || preview?.stage6File || null,
      guardedRepairGeneratedAt: guardedPlan?.generatedAt || null,
      reconciliationGeneratedAt: reconciliation?.generatedAt || null,
      performanceDashboardGeneratedAt: performance?.generatedAt || null
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      autoRepairEnabled: false,
      emitsBrokerPayload: false,
      callsBrokerApi: false,
      executionReadyRows: 0,
      requiresSeparateApprovalForMutation: true
    },
    gates: globalGates,
    summary: {
      rows: selectedRows.length,
      eligible: eligible.length,
      blocked: selectedRows.filter((row) => row.readiness.startsWith("BLOCKED")).length,
      selectedSymbol: selectedCandidate?.symbol || null,
      selectedCanaryQty: selectedCandidate?.canaryQty ?? null,
      executionReadyRows: selectedRows.filter((row) => row.executionAllowed === true).length,
      brokerMutationAllowed: false,
      requestedSymbolFound: requestedSymbol ? rows.some((row) => row.symbol === requestedSymbol) : null,
      guardMetadataStale: selectedRows.filter((row) => row.guardMetadataRisk?.stale).length,
      guardMetadataBreached: selectedRows.filter((row) => row.guardMetadataRisk?.stopBreached || row.guardMetadataRisk?.targetBreached).length,
      guardMetadataNearBreached: selectedRows.filter((row) => row.guardMetadataRisk?.nearStopBreach || row.guardMetadataRisk?.nearTargetBreach).length
    },
    selectedCandidate,
    rows: selectedRows
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[PAPER_OCO_CANARY] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} rows=${selectedRows.length} eligible=${eligible.length} selected=${selectedCandidate?.symbol || "none"} executionReady=0`
  );
  if (unsafe) process.exit(1);
};

main();
