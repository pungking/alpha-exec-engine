import fs from "node:fs";

const STATE_DIR = String(process.env.GUARDED_CHILD_REPAIR_STATE_DIR || "state").trim() || "state";
const RECONCILIATION_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const ORDER_STATE_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const OUTPUT_JSON = `${STATE_DIR}/guarded-child-order-repair-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/guarded-child-order-repair-plan.md`;

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

const buildPositionMap = (performance) => {
  const rows = Array.isArray(performance?.live?.positions) ? performance.live.positions : [];
  return new Map(rows.map((row) => [String(row?.symbol || "").toUpperCase(), row]));
};

const hasAction = (row, action) => Array.isArray(row?.proposedActions) && row.proposedActions.includes(action);

const buildRepairRow = ({ reconciliationRow, performanceRow }) => {
  const symbol = String(reconciliationRow?.symbol || "").toUpperCase();
  const qty = toNum(reconciliationRow?.qty ?? performanceRow?.qty) ?? 0;
  const currentPrice = toNum(reconciliationRow?.currentPrice ?? performanceRow?.currentPrice);
  const plannedStopPrice = toNum(reconciliationRow?.plannedStopPrice ?? performanceRow?.plannedStopPrice ?? performanceRow?.stopPrice);
  const plannedTargetPrice = toNum(reconciliationRow?.plannedTargetPrice ?? performanceRow?.plannedTargetPrice ?? performanceRow?.targetPrice);
  const stopMissing = reconciliationRow?.stopChildMissing === true || hasAction(reconciliationRow, "REPORT_ONLY_CREATE_STOP_CHILD");
  const targetMissing = reconciliationRow?.targetChildMissing === true || hasAction(reconciliationRow, "REPORT_ONLY_CREATE_TARGET_CHILD");
  const guardMetadataMissing = reconciliationRow?.guardMetadataMissing === true || hasAction(reconciliationRow, "REPORT_ONLY_REVIEW_GUARD_METADATA");
  const futureIntent = [];
  const blockers = [];
  const warnings = [];

  if (guardMetadataMissing) blockers.push("missing_planned_guard_metadata");
  if (qty <= 0) blockers.push("no_open_long_position_qty");
  if (stopMissing) {
    if (plannedStopPrice == null || plannedStopPrice <= 0) blockers.push("invalid_planned_stop_price");
    else if (currentPrice != null && plannedStopPrice >= currentPrice) blockers.push("planned_stop_not_below_current_price");
    else futureIntent.push("FUTURE_CREATE_PROTECTIVE_STOP_CHILD");
  }
  if (targetMissing) {
    if (plannedTargetPrice == null || plannedTargetPrice <= 0) blockers.push("invalid_planned_target_price");
    else if (currentPrice != null && plannedTargetPrice <= currentPrice) blockers.push("planned_target_not_above_current_price");
    else futureIntent.push("FUTURE_CREATE_PROFIT_TARGET_CHILD");
  }
  if (stopMissing && targetMissing) warnings.push("future_submit_must_use_verified_oco_or_equivalent_to_avoid_duplicate_sell_exposure");
  if (futureIntent.length === 0 && blockers.length === 0) futureIntent.push("NO_REPAIR_INTENT");

  const stopDistancePct = currentPrice != null && plannedStopPrice != null ? pctDistance(currentPrice, plannedStopPrice) : null;
  const targetDistancePct = currentPrice != null && plannedTargetPrice != null ? pctDistance(currentPrice, plannedTargetPrice) : null;
  const reportOnlyBlockers = ["report_only_mode", "broker_mutation_disabled", "repair_endpoint_not_implemented"];
  const candidate = futureIntent.some((action) => action.startsWith("FUTURE_CREATE_")) && blockers.length === 0;

  return {
    symbol,
    sourceProtectionStatus: reconciliationRow?.protectionStatus || null,
    sourceSeverity: reconciliationRow?.severity || null,
    qty,
    currentPrice,
    plannedStopPrice,
    plannedTargetPrice,
    stopDistancePct,
    targetDistancePct,
    stopMissing,
    targetMissing,
    guardMetadataMissing,
    futureIntent,
    candidate,
    executionAllowed: false,
    readiness: candidate ? "CANDIDATE_BLOCKED_REPORT_ONLY" : blockers.length > 0 ? "BLOCKED_INPUT_GUARD" : "NO_REPAIR_REQUIRED",
    blockers: [...new Set([...blockers, ...reportOnlyBlockers])],
    warnings: [...new Set(warnings)],
    idempotencyKeyPreview: candidate
      ? `child-repair:${symbol}:qty=${qty}:stop=${plannedStopPrice ?? "na"}:target=${plannedTargetPrice ?? "na"}`
      : null,
    reason: short(
      candidate
        ? "repair candidate only; broker mutation disabled until separate execution-policy approval and API payload validation"
        : blockers.length > 0
          ? `blocked before repair consideration: ${blockers.join(",")}`
          : "no repair intent required",
      240
    )
  };
};

const buildSafetyGates = ({ reconciliation, performance, preview, orderState, rows }) => {
  const requestedMode = String(process.env.GUARDED_CHILD_REPAIR_MODE || "report_only").trim().toLowerCase() || "report_only";
  const mutationRequested = ["execute", "repair", "live", "paper"].includes(requestedMode);
  const gates = [
    {
      id: "report_only_mode_enforced",
      status: mutationRequested ? "BLOCK" : "PASS",
      detail: mutationRequested
        ? `requested mode ${requestedMode} is not allowed in this planner; report_only is enforced`
        : "planner is report-only"
    },
    {
      id: "broker_mutation_disabled",
      status: "PASS",
      detail: "planner does not call broker order endpoints"
    },
    {
      id: "source_reconciliation_present",
      status: reconciliation ? "PASS" : "BLOCK",
      detail: reconciliation ? "broker-child-order-reconciliation.json loaded" : "missing broker-child-order-reconciliation.json"
    },
    {
      id: "nested_open_order_source_present",
      status: performance?.live?.totals?.openOrderNested === true ? "PASS" : "WARN",
      detail: `openOrderNested=${performance?.live?.totals?.openOrderNested ?? "N/A"}`
    },
    {
      id: "order_state_consistency_pass",
      status: orderState?.overall === "PASS" ? "PASS" : "WARN",
      detail: `order-state overall=${orderState?.overall || "N/A"}`
    },
    {
      id: "runtime_safe_flags_observed",
      status: preview?.mode?.readOnly === true && preview?.mode?.execEnabled === false ? "PASS" : "WARN",
      detail: `READ_ONLY=${preview?.mode?.readOnly ?? "N/A"} EXEC_ENABLED=${preview?.mode?.execEnabled ?? "N/A"}`
    },
    {
      id: "future_execution_requires_approval",
      status: "BLOCK",
      detail: "any broker child repair execution requires a separate safety-gated task and explicit approval before implementation"
    },
    {
      id: "api_payload_validation_required",
      status: "BLOCK",
      detail: "no Alpaca repair payload is emitted; exact child/OCO payload semantics must be verified before any execution lane"
    },
    {
      id: "idempotency_required",
      status: "BLOCK",
      detail: "future repair execution must persist a deterministic repair idempotency key before broker submission"
    }
  ];

  if (rows.some((row) => row.executionAllowed !== false)) {
    gates.push({
      id: "row_execution_flag_violation",
      status: "BLOCK",
      detail: "one or more rows are executable; this is not allowed in report-only planner"
    });
  }
  return gates;
};

const summarize = (rows, gates) => {
  const candidateRows = rows.filter((row) => row.candidate);
  return {
    rows: rows.length,
    candidates: candidateRows.length,
    stopRepairCandidates: candidateRows.filter((row) => row.stopMissing).length,
    targetRepairCandidates: candidateRows.filter((row) => row.targetMissing).length,
    blockedInputGuard: rows.filter((row) => row.readiness === "BLOCKED_INPUT_GUARD").length,
    blockedByReportOnly: rows.filter((row) => row.readiness === "CANDIDATE_BLOCKED_REPORT_ONLY").length,
    executionReadyRows: rows.filter((row) => row.executionAllowed === true).length,
    blockingGates: gates.filter((gate) => gate.status === "BLOCK").length,
    warningGates: gates.filter((gate) => gate.status === "WARN").length
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Guarded Child-Order Repair Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- mode: \`${report.executionPolicy.mode}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(
    `- summary: \`rows=${report.summary.rows} candidates=${report.summary.candidates} stopCandidates=${report.summary.stopRepairCandidates} targetCandidates=${report.summary.targetRepairCandidates} blockedReportOnly=${report.summary.blockedByReportOnly} executionReady=${report.summary.executionReadyRows}\``
  );
  lines.push("- safety: `design/report-only; no Alpaca order payload emitted; no broker mutation` ");
  lines.push("- gates:");
  for (const gate of report.safetyGates) {
    lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  }
  lines.push("| Symbol | Readiness | Intent | Stop | Target | Blockers | Warnings | Reason |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.readiness} | ${row.futureIntent.join(",")} | ${fmt(row.plannedStopPrice)} | ${fmt(row.plannedTargetPrice)} | ${short(row.blockers.join(","), 180) || "none"} | ${short(row.warnings.join(","), 180) || "none"} | ${short(row.reason, 160)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const reconciliation = readJson(RECONCILIATION_PATH);
  const performance = readJson(PERFORMANCE_PATH);
  const preview = readJson(PREVIEW_PATH);
  const orderState = readJson(ORDER_STATE_PATH);
  const performanceBySymbol = buildPositionMap(performance);
  const reconciliationRows = Array.isArray(reconciliation?.rows) ? reconciliation.rows : [];
  const rows = reconciliationRows
    .filter((row) => Array.isArray(row?.proposedActions) && row.proposedActions.some((action) => action !== "NO_ACTION"))
    .map((row) => buildRepairRow({
      reconciliationRow: row,
      performanceRow: performanceBySymbol.get(String(row?.symbol || "").toUpperCase())
    }));
  const safetyGates = buildSafetyGates({ reconciliation, performance, preview, orderState, rows });
  const summary = summarize(rows, safetyGates);
  const unsafe = summary.executionReadyRows > 0 || rows.some((row) => row.executionAllowed !== false);
  const overall = unsafe
    ? "fail"
    : summary.candidates > 0
      ? "report_only_blocked"
      : summary.blockedInputGuard > 0
        ? "needs_manual_review"
        : "pass";

  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    files: {
      reconciliation: Boolean(reconciliation),
      performanceDashboard: Boolean(performance),
      preview: Boolean(preview),
      orderStateConsistency: Boolean(orderState)
    },
    source: {
      reconciliationGeneratedAt: reconciliation?.generatedAt || null,
      performanceDashboardGeneratedAt: performance?.generatedAt || null,
      stage6Hash: preview?.stage6Hash || null,
      stage6File: preview?.stage6File || null
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      autoRepairEnabled: false,
      emitsBrokerPayload: false,
      requiresSeparateApprovalForMutation: true
    },
    safetyGates,
    summary,
    rows
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[GUARDED_REPAIR_PLAN] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} candidates=${summary.candidates} executionReady=${summary.executionReadyRows}`
  );
};

main();
