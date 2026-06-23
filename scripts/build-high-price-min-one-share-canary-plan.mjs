import fs from "node:fs";
import assert from "node:assert/strict";

const STATE_DIR = String(process.env.HIGH_PRICE_MIN_ONE_SHARE_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/high-price-min-one-share-canary-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/high-price-min-one-share-canary-plan.md`;

const FILES = {
  fillability: `${STATE_DIR}/fillability-report.json`,
  decisionAudit: `${STATE_DIR}/last-order-decision-audit.json`,
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  portfolioAdmission: `${STATE_DIR}/portfolio-admission-audit.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`
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
const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};

const boolish = (value) => value === true || String(value).toLowerCase() === "true";
const pass = (value) => value === true;

const detectTerminalOrActiveBrokerState = (row) => {
  const openStatus = String(row?.brokerOpenStatus || "").trim().toLowerCase();
  const closedStatus = String(row?.brokerClosedStatus || "").trim().toLowerCase();
  const fillQty = toNum(row?.fillQty) ?? 0;
  const openFilledQty = toNum(row?.brokerOpenFilledQty) ?? 0;
  const closedFilledQty = toNum(row?.brokerClosedFilledQty) ?? 0;
  const activeOpen = Boolean(openStatus) && !["canceled", "expired", "rejected", "filled"].includes(openStatus);
  const terminalSubmitted = Boolean(closedStatus) || openStatus === "filled" || fillQty > 0 || openFilledQty > 0 || closedFilledQty > 0;
  return { activeOpen, terminalSubmitted, openStatus, closedStatus, fillQty, openFilledQty, closedFilledQty };
};

const idempotencyHasActiveOrder = (idempotency, stage6Hash, symbol) => {
  const key = `${stage6Hash || ""}:${symbol || ""}:buy`;
  return Boolean(stage6Hash && symbol && idempotency?.orders?.[key]);
};

const buildCandidate = (row, context = {}) => {
  const broker = detectTerminalOrActiveBrokerState(row);
  const symbol = asSymbol(row?.symbol);
  const oneShareNotional = toNum(row?.oneShareNotional ?? row?.entryPrice ?? row?.activeLimit);
  const oneShareRiskDollars = toNum(row?.oneShareRiskDollars);
  const maxNotional = toNum(row?.minOneShareMaxNotional);
  const maxRisk = toNum(row?.maxRiskDollarsPerTrade);
  const dailyMaxNotionalCap = toNum(context.preview?.maxTotalNotional);
  const minRr = toNum(context.portfolioAdmission?.minAdmissionRr);
  const portfolioActiveSymbolsBefore = toNum(context.portfolioAdmission?.activeSymbolsBefore);
  const portfolioMaxActiveSymbolsTotal = toNum(context.portfolioAdmission?.maxActiveSymbolsTotal);
  const portfolioNewSymbolsTodayBefore = toNum(context.portfolioAdmission?.newSymbolsTodayBefore);
  const portfolioMaxNewSymbolsPerDay = toNum(context.portfolioAdmission?.maxNewSymbolsPerDay);
  const minOneShareMaxNotionalPass = oneShareNotional != null && maxNotional != null && oneShareNotional <= maxNotional;
  const dailyMaxNotionalPass =
    oneShareNotional != null && dailyMaxNotionalCap != null && oneShareNotional <= dailyMaxNotionalCap;
  const notionalCapPass = minOneShareMaxNotionalPass || dailyMaxNotionalPass;
  const riskCapPass = oneShareRiskDollars != null && maxRisk != null && oneShareRiskDollars <= maxRisk;
  const rrAtCurrent = toNum(row?.rrAtCurrent);
  const rrAtAdjustedEntry = toNum(row?.rrAtAdjustedEntry);
  const rrPass = rrAtCurrent != null && minRr != null && rrAtCurrent >= minRr;
  const quoteValid = boolish(row?.quoteValid);
  const portfolioCapacityPass =
    portfolioActiveSymbolsBefore != null &&
    portfolioMaxActiveSymbolsTotal != null &&
    portfolioNewSymbolsTodayBefore != null &&
    portfolioMaxNewSymbolsPerDay != null &&
    portfolioActiveSymbolsBefore < portfolioMaxActiveSymbolsTotal &&
    portfolioNewSymbolsTodayBefore < portfolioMaxNewSymbolsPerDay;
  const duplicateOrder = idempotencyHasActiveOrder(context.idempotency, context.stage6Hash, symbol);
  const idempotencyPass = !duplicateOrder;
  const guardAllowsEntry = context.preview?.guardControl?.blocked !== true && context.preview?.guardControl?.stale !== true;
  const status = String(row?.status || "").trim();
  const policySkippable = String(row?.highPricePolicy || "").trim() === "skip";
  const autoEligibilityChecks = {
    quoteValid,
    rrAtCurrentPass: rrPass,
    notionalCapPass,
    riskCapPass,
    dailyMaxNotionalPass,
    portfolioConcentrationPass: portfolioCapacityPass,
    idempotencyPass,
    guardAllowsEntry
  };
  const blockedBy = [];
  if (status !== "BLOCKED_HIGH_PRICE_SIZE") blockedBy.push(`status_${status || "missing"}`);
  if (!policySkippable) blockedBy.push("policy_change_not_allowed");
  if (!pass(quoteValid)) blockedBy.push("quote");
  if (!pass(rrPass)) blockedBy.push("rr");
  if (!pass(notionalCapPass)) blockedBy.push("notional_cap");
  if (!pass(riskCapPass)) blockedBy.push("risk_cap");
  if (!pass(dailyMaxNotionalPass)) blockedBy.push("daily_notional_cap");
  if (!pass(portfolioCapacityPass)) blockedBy.push("portfolio_cap");
  if (!pass(idempotencyPass)) blockedBy.push("idempotency");
  if (!pass(guardAllowsEntry)) blockedBy.push("guard_blocked");
  if (broker.activeOpen) blockedBy.push(`active_open_order_${broker.openStatus}`);
  if (broker.terminalSubmitted) blockedBy.push(`terminal_or_filled_${broker.closedStatus || broker.openStatus || "filled"}`);
  const eligible =
    status === "BLOCKED_HIGH_PRICE_SIZE" &&
    policySkippable &&
    Object.values(autoEligibilityChecks).every(Boolean) &&
    !broker.activeOpen &&
    !broker.terminalSubmitted;
  return {
    symbol,
    status,
    reason: short(row?.reason || "", 320),
    eligible,
    blockers: blockedBy,
    blockedBy,
    highPriceAutoEligibleReason: eligible ? "all_report_only_checks_passed" : null,
    readyForFuturePaperAutoSubmit: eligible,
    autoEligibilityChecks,
    currentPrice: toNum(row?.currentPrice),
    adjustedEntry: toNum(row?.adjustedEntry),
    activeLimit: toNum(row?.activeLimit),
    oneShareNotional,
    oneShareRiskDollars,
    requestedNotional: toNum(row?.requestedNotional),
    minOneShareMaxNotional: maxNotional,
    maxRiskDollarsPerTrade: maxRisk,
    maxNotional,
    maxRisk,
    dailyMaxNotionalCap,
    minAdmissionRr: minRr,
    portfolioActiveSymbolsBefore,
    portfolioMaxActiveSymbolsTotal,
    portfolioNewSymbolsTodayBefore,
    portfolioMaxNewSymbolsPerDay,
    rrAtAdjustedEntry,
    rrAtCurrent,
    currentVsLimitPct: toNum(row?.currentVsLimitPct),
    quoteValid,
    highPricePolicy: row?.highPricePolicy || null,
    highPricePolicyChangeWouldAllow: eligible,
    minOneShareFeasibleUnderCaps: notionalCapPass && riskCapPass,
    minOneShareMaxNotionalPass,
    accountPortfolioNotionalCapPass: dailyMaxNotionalPass,
    highPricePolicyChangeWouldAllowByAccountPortfolioCaps: notionalCapPass && riskCapPass,
    manualPolicyApprovalCandidate: false,
    approvalLane: eligible
      ? "AUTO_ELIGIBLE_REPORT_ONLY"
      : "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED",
    highPriceMinOneShareApprovalLane: eligible ? "AUTO_ELIGIBLE_REPORT_ONLY" : "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED",
    highPriceMinOneShareBrokerSubmitReady: false,
    approvalRequiredBeforeExecution: eligible ? "separate_CONFIRM_LIVE_EXECUTION_required_before_broker_submit" : null,
    brokerOpenStatus: broker.openStatus || null,
    brokerClosedStatus: broker.closedStatus || null,
    fillQty: broker.fillQty
  };
};

const rankCandidates = (a, b) => {
  const an = a.oneShareNotional ?? Number.POSITIVE_INFINITY;
  const bn = b.oneShareNotional ?? Number.POSITIVE_INFINITY;
  if (an !== bn) return an - bn;
  const ar = a.rrAtAdjustedEntry ?? Number.NEGATIVE_INFINITY;
  const br = b.rrAtAdjustedEntry ?? Number.NEGATIVE_INFINITY;
  if (ar !== br) return br - ar;
  return a.symbol.localeCompare(b.symbol);
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## High-Price Min-One-Share Canary Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`candidates=${report.summary.candidates} eligible=${report.summary.eligible} selected=${report.summary.selectedSymbol || "N/A"} wouldProbe=${report.summary.wouldGeneratePayloadProbe} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``
  );
  lines.push(
    `- approvalGate: \`overall=${report.approvalGate.overall} ready=${report.approvalGate.readyForSafePayloadProbe} brokerSubmitReady=${report.approvalGate.readyForBrokerSubmit} selected=${report.approvalGate.selectedSymbol || "N/A"}\``
  );
  lines.push("- safety: `report-only; no payload generation; no broker mutation`");
  lines.push("- default_policy: `ENTRY_HIGH_PRICE_POLICY=skip` remains unchanged; no automatic min_one_share promotion");
  lines.push("- recommended_safe_inputs: `run_verify_mode=safe_min_one_share_admission_probe run_entry_high_price_policy=min_one_share run_dry_max_orders_override=1 run_dry_max_total_notional_override=600 run_entry_min_one_share_max_notional=300 run_entry_max_risk_dollars_per_trade=25`");
  lines.push("| Symbol | Approval Lane | Future Paper Auto | One Share Notional | One Share Risk | Max Notional | Max Risk | RR@Current | Blocked By | Reason |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `| ${row.symbol} | ${row.approvalLane} | ${row.readyForFuturePaperAutoSubmit ? "yes" : "no"} | ${fmt(row.oneShareNotional)} | ${fmt(row.oneShareRiskDollars)} | ${fmt(row.minOneShareMaxNotional)} | ${fmt(row.maxRiskDollarsPerTrade)} | ${fmt(row.rrAtCurrent)} | ${row.blockedBy.join(",") || "none"} | ${short(row.reason, 90)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fillability = readJson(FILES.fillability);
  const decisionAudit = readJson(FILES.decisionAudit);
  const preview = readJson(FILES.preview);
  const portfolioAdmissionRaw = readJson(FILES.portfolioAdmission);
  const portfolioAdmission = portfolioAdmissionRaw?.summary || portfolioAdmissionRaw;
  const idempotency = readJson(FILES.idempotency);
  const stage6Hash = fillability?.summary?.stage6Hash || preview?.stage6Hash || null;
  const context = { preview, portfolioAdmission, idempotency, stage6Hash };
  const rows = (Array.isArray(fillability?.rows) ? fillability.rows : []).map((row) => buildCandidate(row, context));
  const eligibleRows = rows.filter((row) => row.eligible).sort(rankCandidates);
  const selected = eligibleRows[0] || null;
  const overall = selected ? "auto_eligible_report_only" : rows.length ? "blocked" : "no_fillability_rows";
  const brokerAttempted = false;
  const brokerSubmitted = false;
  const approvalGate = {
    overall: selected ? "auto_eligible_report_only" : "blocked",
    selectedSymbol: selected?.symbol || null,
    dynamicSelection: true,
    defaultPolicy: "ENTRY_HIGH_PRICE_POLICY=skip",
    proposedPolicy: "ENTRY_HIGH_PRICE_POLICY=min_one_share",
    automaticPolicyChangeAllowed: false,
    readyForSafePayloadProbe: false,
    readyForFuturePaperAutoSubmit: Boolean(selected),
    readyForBrokerSubmit: false,
    requiredBeforeSafeProbe: selected
      ? [
          "workflow_dispatch_scope_only",
          "READ_ONLY=true",
          "EXEC_ENABLED=false",
          "LIVE_ORDER_SUBMIT_ENABLED=false",
          "max_orders=1",
          "explicit_one_share_notional_and_risk_caps"
        ]
      : [],
    requiredBeforeBrokerSubmit: [
      "separate_safety_gate_warning",
      "exact_CONFIRM_LIVE_EXECUTION_scope",
      "preflight_pass",
      "idempotency_pass",
      "paper_broker_visibility_plan"
    ],
    blockedBy: selected
      ? ["broker_submit_not_authorized", "report_only_policy"]
      : [...new Set(rows.flatMap((row) => row.blockedBy))],
    nextAction: selected
      ? "Candidate is future paper-auto eligible by report-only checks; broker submit still requires a separate CONFIRM LIVE EXECUTION scope."
      : "Keep default skip policy; do not create payload until quote/RR/notional/risk/portfolio/idempotency/guard checks pass."
  };
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "symbol_agnostic_high_price_min_one_share_safe_dry_run_probe_not_submit",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      stage6Hash,
      stage6File: fillability?.summary?.stage6File || preview?.stage6File || null,
      payloadCount: toNum(fillability?.summary?.payloadCount ?? preview?.payloadCount) ?? null,
      skippedCount: toNum(fillability?.summary?.skippedCount ?? preview?.skippedCount) ?? null,
      topSkip: short(preview?.topSkip || preview?.orderReadiness?.topSkip || "", 240) || null,
      decisionAuditRows: Array.isArray(decisionAudit?.records) ? decisionAudit.records.length : null,
      portfolioAdmissionOverall: portfolioAdmission?.overall || null
    },
    recommendedSafeRunInputs: {
      run_verify_mode: "safe_min_one_share_admission_probe",
      run_entry_high_price_policy: "min_one_share",
      run_dry_max_orders_override: "1",
      run_dry_max_total_notional_override: "600",
      run_entry_min_one_share_max_notional: "300",
      run_entry_max_risk_dollars_per_trade: "25"
    },
    doneWhen: {
      safeDryRunPayloadCountAtLeast: selected ? 1 : 0,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      nextIfPayloadGenerated: "keep_attempted_false_submitted_false_then_request_separate_execution_approval_before_any_broker_submit",
      nextIfNoPayload: "inspect_orderReadiness_topSkip_fillability_and_portfolio_admission"
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: brokerAttempted,
      brokerMutationSubmitted: brokerSubmitted,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    approvalGate,
    summary: {
      candidates: rows.length,
      eligible: eligibleRows.length,
      selectedSymbol: selected?.symbol || null,
      selectedOneShareNotional: selected?.oneShareNotional ?? null,
      selectedOneShareRiskDollars: selected?.oneShareRiskDollars ?? null,
      manualPolicyApprovalCandidates: eligibleRows.length,
      autoEligibleReportOnly: eligibleRows.length,
      approvalCandidateReady: Boolean(selected),
      readyForFuturePaperAutoSubmit: Boolean(selected),
      readyForBrokerSubmit: false,
      wouldGeneratePayloadProbe: false,
      brokerMutationAttempted: brokerAttempted,
      brokerMutationSubmitted: brokerSubmitted,
      stateMutationAttempted: false
    },
    selected,
    rows
  };
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[HIGH_PRICE_MIN_ONE_SHARE_CANARY] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} candidates=${report.summary.candidates} eligible=${report.summary.eligible} selected=${report.summary.selectedSymbol || "N/A"} attempted=false submitted=false`
  );
};

const selfTest = () => {
  const context = {
    stage6Hash: "hash",
    preview: { maxTotalNotional: 600, guardControl: { blocked: false, stale: false } },
    portfolioAdmission: {
      minAdmissionRr: 1.8,
      activeSymbolsBefore: 1,
      maxActiveSymbolsTotal: 12,
      newSymbolsTodayBefore: 0,
      maxNewSymbolsPerDay: 2
    },
    idempotency: { orders: {} }
  };
  const blocked = buildCandidate(
    {
      symbol: "GOOG",
      status: "BLOCKED_HIGH_PRICE_SIZE",
      oneShareNotional: 346.76,
      oneShareRiskDollars: 39.93,
      minOneShareMaxNotional: 300,
      maxRiskDollarsPerTrade: 25,
      rrAtCurrent: 2,
      quoteValid: true,
      highPricePolicy: "skip"
    },
    context
  );
  assert.equal(blocked.approvalLane, "HIGH_PRICE_MIN_ONE_SHARE_BLOCKED");
  assert.deepEqual(blocked.blockedBy.filter((item) => ["risk_cap"].includes(item)), ["risk_cap"]);

  const eligible = buildCandidate(
    {
      symbol: "OK",
      status: "BLOCKED_HIGH_PRICE_SIZE",
      oneShareNotional: 250,
      oneShareRiskDollars: 20,
      minOneShareMaxNotional: 300,
      maxRiskDollarsPerTrade: 25,
      rrAtCurrent: 2,
      quoteValid: true,
      highPricePolicy: "skip"
    },
    context
  );
  assert.equal(eligible.approvalLane, "AUTO_ELIGIBLE_REPORT_ONLY");
  assert.equal(eligible.highPriceMinOneShareBrokerSubmitReady, false);
  assert.equal(eligible.readyForFuturePaperAutoSubmit, true);
  console.log("[HIGH_PRICE_MIN_ONE_SHARE_CANARY] self-test pass");
};

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
