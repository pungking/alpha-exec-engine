import fs from "node:fs";

const STATE_DIR = String(process.env.PAPER_OCO_APPROVAL_GATE_STATE_DIR || "state").trim() || "state";
const CANDIDATE_PATH = `${STATE_DIR}/paper-oco-canary-candidate.json`;
const GUARDED_PLAN_PATH = `${STATE_DIR}/guarded-child-order-repair-plan.json`;
const RECONCILIATION_PATH = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const ORDER_STATE_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const PAYLOAD_SCHEMA_PATH = `${STATE_DIR}/alpaca-order-payload-schema-report.json`;
const OCO_RESPONSE_PATH = `${STATE_DIR}/alpaca-oco-response-fixture-report.json`;
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const OUTPUT_JSON = `${STATE_DIR}/paper-oco-canary-approval-gate.json`;
const OUTPUT_MD = `${STATE_DIR}/paper-oco-canary-approval-gate.md`;

const REQUIRED_APPROVAL_PHRASE = "CONFIRM LIVE EXECUTION";

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
const asSymbol = (value) => String(value || "").trim().toUpperCase();

const findSymbolRow = (rows, symbol) => {
  const target = asSymbol(symbol);
  return (Array.isArray(rows) ? rows : []).find((row) => asSymbol(row?.symbol) === target) || null;
};

const addGate = (gates, id, status, detail) => {
  gates.push({ id, status, detail: short(detail, 320) });
};

const buildGates = ({ candidate, guardedPlan, reconciliation, orderState, payloadSchema, ocoResponse, preview }) => {
  const gates = [];
  const selected = candidate?.selectedCandidate || null;
  const selectedSymbol = asSymbol(selected?.symbol);
  const selectedRow = selectedSymbol ? findSymbolRow(candidate?.rows, selectedSymbol) : null;
  const orderStateRow = selectedSymbol ? findSymbolRow(orderState?.rows, selectedSymbol) : null;
  const repairRow = selectedSymbol ? findSymbolRow(guardedPlan?.rows, selectedSymbol) : null;
  const reconciliationRow = selectedSymbol ? findSymbolRow(reconciliation?.rows, selectedSymbol) : null;

  addGate(gates, "candidate_selector_present", candidate ? "PASS" : "BLOCK", candidate ? "paper OCO candidate selector loaded" : "missing paper-oco-canary-candidate.json");
  addGate(gates, "single_selected_candidate_present", selectedSymbol ? "PASS" : "BLOCK", selectedSymbol ? `selected=${selectedSymbol}` : "no selected candidate");
  addGate(gates, "selector_scope_portfolio_wide", candidate?.scope === "portfolio_wide_dynamic_candidates_not_ticker_specific" ? "PASS" : "BLOCK", `scope=${candidate?.scope || "N/A"}`);
  addGate(gates, "selected_row_matches_selector_rows", selectedRow ? "PASS" : "BLOCK", selectedRow ? "selected symbol exists in selector rows" : "selected symbol not found in selector rows");
  addGate(gates, "selected_is_not_executable", selected?.executionAllowed === false && selectedRow?.executionAllowed === false ? "PASS" : "BLOCK", `selected.executionAllowed=${selected?.executionAllowed ?? "N/A"} row.executionAllowed=${selectedRow?.executionAllowed ?? "N/A"}`);
  addGate(gates, "candidate_policy_report_only", candidate?.executionPolicy?.brokerMutationAllowed === false && candidate?.executionPolicy?.callsBrokerApi === false && candidate?.executionPolicy?.emitsBrokerPayload === false ? "PASS" : "BLOCK", `brokerMutationAllowed=${candidate?.executionPolicy?.brokerMutationAllowed ?? "N/A"} callsBrokerApi=${candidate?.executionPolicy?.callsBrokerApi ?? "N/A"} emitsBrokerPayload=${candidate?.executionPolicy?.emitsBrokerPayload ?? "N/A"}`);
  addGate(gates, "guarded_plan_present", guardedPlan ? "PASS" : "BLOCK", guardedPlan ? "guarded repair plan loaded" : "missing guarded-child-order-repair-plan.json");
  addGate(gates, "guarded_repair_row_report_only", repairRow?.readiness === "CANDIDATE_BLOCKED_REPORT_ONLY" && repairRow?.executionAllowed === false ? "PASS" : "BLOCK", `readiness=${repairRow?.readiness || "N/A"} executionAllowed=${repairRow?.executionAllowed ?? "N/A"}`);
  addGate(gates, "broker_child_reconciliation_present", reconciliation ? "PASS" : "BLOCK", reconciliation ? "broker child reconciliation loaded" : "missing broker-child-order-reconciliation.json");
  addGate(gates, "broker_children_missing_confirmed", reconciliationRow?.stopChildMissing === true && reconciliationRow?.targetChildMissing === true ? "PASS" : "BLOCK", `stopMissing=${reconciliationRow?.stopChildMissing ?? "N/A"} targetMissing=${reconciliationRow?.targetChildMissing ?? "N/A"}`);
  addGate(gates, "order_state_consistency_pass", orderState?.overall === "PASS" ? "PASS" : "BLOCK", `order-state overall=${orderState?.overall || "N/A"}`);
  addGate(gates, "selected_symbol_no_order_state_failure", orderStateRow?.status !== "FAIL" ? "PASS" : "BLOCK", `symbolOrderState=${orderStateRow?.status || "N/A"}`);
  addGate(gates, "payload_schema_fixture_pass", payloadSchema?.overall === "pass" ? "PASS" : "BLOCK", `payloadSchema=${payloadSchema?.overall || "N/A"}`);
  addGate(gates, "oco_response_fixture_pass", ocoResponse?.overall === "pass" ? "PASS" : "BLOCK", `ocoResponse=${ocoResponse?.overall || "N/A"}`);
  addGate(gates, "runtime_safe_flags_observed", preview?.mode?.readOnly === true && preview?.mode?.execEnabled === false ? "PASS" : "BLOCK", `READ_ONLY=${preview?.mode?.readOnly ?? "N/A"} EXEC_ENABLED=${preview?.mode?.execEnabled ?? "N/A"}`);
  addGate(gates, "whole_share_canary_qty", toNum(selected?.canaryQty) === 1 ? "PASS" : "BLOCK", `canaryQty=${selected?.canaryQty ?? "N/A"}`);
  addGate(gates, "price_geometry_valid", toNum(selected?.plannedStopPrice) != null && toNum(selected?.currentPrice) != null && toNum(selected?.plannedTargetPrice) != null && toNum(selected?.plannedStopPrice) < toNum(selected?.currentPrice) && toNum(selected?.currentPrice) < toNum(selected?.plannedTargetPrice) ? "PASS" : "BLOCK", `stop=${selected?.plannedStopPrice ?? "N/A"} current=${selected?.currentPrice ?? "N/A"} target=${selected?.plannedTargetPrice ?? "N/A"}`);
  addGate(gates, "approval_not_granted_in_this_lane", "BLOCK", `future broker order placement still requires exact phrase ${REQUIRED_APPROVAL_PHRASE} in a separate scoped task`);
  return gates;
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Paper OCO Canary Approval Gate");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- decision: \`${report.decision.status} / ${report.decision.recommendedAction}\``);
  lines.push(`- selected: \`${report.selected?.symbol || "N/A"} qty=${report.selected?.canaryQty ?? "N/A"} current=${fmt(report.selected?.currentPrice)} stop=${fmt(report.selected?.plannedStopPrice)} target=${fmt(report.selected?.plannedTargetPrice)}\``);
  lines.push("- safety: `approval gate is report-only; no broker endpoint calls; no executable payload`");
  lines.push("- gates:");
  for (const gate of report.gates) {
    lines.push(`  - [${gate.status}] ${gate.id}: ${short(gate.detail, 220)}`);
  }
  lines.push("- manual checklist:");
  for (const item of report.manualChecklist) {
    lines.push(`  - ${item}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const candidate = readJson(CANDIDATE_PATH);
  const guardedPlan = readJson(GUARDED_PLAN_PATH);
  const reconciliation = readJson(RECONCILIATION_PATH);
  const orderState = readJson(ORDER_STATE_PATH);
  const payloadSchema = readJson(PAYLOAD_SCHEMA_PATH);
  const ocoResponse = readJson(OCO_RESPONSE_PATH);
  const preview = readJson(PREVIEW_PATH);
  const selected = candidate?.selectedCandidate || null;
  const gates = buildGates({ candidate, guardedPlan, reconciliation, orderState, payloadSchema, ocoResponse, preview });
  const unsafe = selected?.executionAllowed === true || candidate?.executionPolicy?.brokerMutationAllowed === true || candidate?.executionPolicy?.callsBrokerApi === true || candidate?.executionPolicy?.emitsBrokerPayload === true;
  const blockingGates = gates.filter((gate) => gate.status === "BLOCK" && gate.id !== "approval_not_granted_in_this_lane");
  const approvalBlockPresent = gates.some((gate) => gate.id === "approval_not_granted_in_this_lane" && gate.status === "BLOCK");
  const overall = unsafe
    ? "fail"
    : blockingGates.length > 0
      ? "blocked"
      : approvalBlockPresent
        ? "manual_approval_required"
        : "pass";
  const decisionStatus = unsafe
    ? "UNSAFE_SELECTOR_STATE"
    : blockingGates.length > 0
      ? "DO_NOT_SUBMIT_BLOCKED"
      : "READY_FOR_MANUAL_APPROVAL";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    files: {
      candidateSelector: Boolean(candidate),
      guardedRepairPlan: Boolean(guardedPlan),
      brokerChildReconciliation: Boolean(reconciliation),
      orderStateConsistency: Boolean(orderState),
      alpacaPayloadSchema: Boolean(payloadSchema),
      alpacaOcoResponseFixture: Boolean(ocoResponse),
      preview: Boolean(preview)
    },
    executionPolicy: {
      mode: "approval_gate_report_only",
      brokerMutationAllowed: false,
      autoRepairEnabled: false,
      emitsBrokerPayload: false,
      callsBrokerApi: false,
      executionReadyRows: 0,
      requiresSeparateApprovalForMutation: true
    },
    selected: selected
      ? {
        symbol: selected.symbol || null,
        canaryQty: selected.canaryQty ?? null,
        canaryNotional: selected.canaryNotional ?? null,
        currentPrice: selected.currentPrice ?? null,
        plannedStopPrice: selected.plannedStopPrice ?? null,
        plannedTargetPrice: selected.plannedTargetPrice ?? null,
        readiness: selected.readiness || null,
        executionAllowed: selected.executionAllowed
      }
      : null,
    decision: {
      status: decisionStatus,
      recommendedAction: "DO_NOT_SUBMIT",
      nextAction:
        decisionStatus === "READY_FOR_MANUAL_APPROVAL"
          ? "request a separate, scoped broker-mutating PAPER canary task if the selected symbol should be tested"
          : "fix blockers before considering any paper OCO submit",
      requiredApprovalPhraseForFutureBrokerMutation: REQUIRED_APPROVAL_PHRASE,
      targetEnvironment: "PAPER",
      approvalRecordedInThisArtifact: false
    },
    summary: {
      selectedSymbol: selected?.symbol || null,
      selectedCanaryQty: selected?.canaryQty ?? null,
      blockingGates: blockingGates.length,
      executionReadyRows: 0,
      brokerMutationAllowed: false,
      callsBrokerApi: false
    },
    gates,
    manualChecklist: [
      "confirm selected symbol is still held in Alpaca paper immediately before any future submit",
      "re-fetch GET /v2/orders?status=open&nested=true&symbols=<SYMBOL> immediately before any future submit",
      "confirm no active protective sell stop/limit child already exists",
      "confirm stop/current/target geometry is still valid",
      "persist deterministic repair idempotency key before any future broker submit",
      `obtain exact approval phrase ${REQUIRED_APPROVAL_PHRASE} in a separate scoped task before implementing broker mutation`
    ]
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[PAPER_OCO_APPROVAL_GATE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} decision=${decisionStatus} selected=${selected?.symbol || "none"} executionReady=0`
  );
  if (unsafe) process.exit(1);
};

main();
