import fs from "node:fs";

const STATE_DIR = String(process.env.HIGH_PRICE_MIN_ONE_SHARE_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/high-price-min-one-share-canary-plan.json`;
const OUTPUT_MD = `${STATE_DIR}/high-price-min-one-share-canary-plan.md`;

const FILES = {
  fillability: `${STATE_DIR}/fillability-report.json`,
  decisionAudit: `${STATE_DIR}/last-order-decision-audit.json`,
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  portfolioAdmission: `${STATE_DIR}/portfolio-admission-audit.json`
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

const buildCandidate = (row) => {
  const broker = detectTerminalOrActiveBrokerState(row);
  const oneShareNotional = toNum(row?.oneShareNotional ?? row?.entryPrice ?? row?.activeLimit);
  const oneShareRiskDollars = toNum(row?.oneShareRiskDollars);
  const maxNotional = toNum(row?.minOneShareMaxNotional);
  const maxRisk = toNum(row?.maxRiskDollarsPerTrade);
  const hasExplicitCaps = maxNotional != null && maxRisk != null;
  const feasibleByCaps =
    hasExplicitCaps &&
    (boolish(row?.minOneShareFeasibleUnderCaps) ||
      ((oneShareNotional != null && oneShareNotional <= maxNotional) &&
        (oneShareRiskDollars != null && oneShareRiskDollars <= maxRisk)));
  const status = String(row?.status || "").trim();
  const policyWouldAllow = boolish(row?.highPricePolicyChangeWouldAllow);
  const eligible =
    status === "BLOCKED_HIGH_PRICE_SIZE" &&
    policyWouldAllow &&
    feasibleByCaps &&
    !broker.activeOpen &&
    !broker.terminalSubmitted;
  const blockers = [];
  if (status !== "BLOCKED_HIGH_PRICE_SIZE") blockers.push(`status_${status || "missing"}`);
  if (!policyWouldAllow) blockers.push("policy_change_not_allowed");
  if (!hasExplicitCaps) blockers.push("missing_explicit_one_share_caps");
  if (!feasibleByCaps) blockers.push("one_share_caps_not_feasible");
  if (broker.activeOpen) blockers.push(`active_open_order_${broker.openStatus}`);
  if (broker.terminalSubmitted) blockers.push(`terminal_or_filled_${broker.closedStatus || broker.openStatus || "filled"}`);
  return {
    symbol: asSymbol(row?.symbol),
    status,
    reason: short(row?.reason || "", 320),
    eligible,
    blockers,
    currentPrice: toNum(row?.currentPrice),
    adjustedEntry: toNum(row?.adjustedEntry),
    activeLimit: toNum(row?.activeLimit),
    oneShareNotional,
    oneShareRiskDollars,
    maxNotional,
    maxRisk,
    rrAtAdjustedEntry: toNum(row?.rrAtAdjustedEntry),
    rrAtCurrent: toNum(row?.rrAtCurrent),
    highPricePolicy: row?.highPricePolicy || null,
    highPricePolicyChangeWouldAllow: policyWouldAllow,
    minOneShareFeasibleUnderCaps: feasibleByCaps,
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
  lines.push("- safety: `report-only; safe dry-run payload probe only; no broker mutation`");
  lines.push("- recommended_safe_inputs: `run_verify_mode=safe_min_one_share_admission_probe run_entry_high_price_policy=min_one_share run_dry_max_orders_override=1 run_dry_max_total_notional_override=600 run_entry_min_one_share_max_notional=300 run_entry_max_risk_dollars_per_trade=25`");
  lines.push("| Symbol | Eligible | One Share Notional | One Share Risk | Max Notional | Max Risk | RR | Blockers | Reason |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `| ${row.symbol} | ${row.eligible ? "yes" : "no"} | ${fmt(row.oneShareNotional)} | ${fmt(row.oneShareRiskDollars)} | ${fmt(row.maxNotional)} | ${fmt(row.maxRisk)} | ${fmt(row.rrAtAdjustedEntry)} | ${row.blockers.join(",") || "none"} | ${short(row.reason, 90)} |`
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
  const portfolioAdmission = readJson(FILES.portfolioAdmission);
  const rows = (Array.isArray(fillability?.rows) ? fillability.rows : []).map(buildCandidate);
  const eligibleRows = rows.filter((row) => row.eligible).sort(rankCandidates);
  const selected = eligibleRows[0] || null;
  const overall = selected ? "ready_for_safe_payload_probe" : rows.length ? "blocked_no_eligible_candidate" : "no_fillability_rows";
  const brokerAttempted = false;
  const brokerSubmitted = false;
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    scope: "symbol_agnostic_high_price_min_one_share_safe_dry_run_probe_not_submit",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      stage6Hash: fillability?.summary?.stage6Hash || preview?.stage6Hash || null,
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
      nextIfPayloadGenerated: "preflight_then_idempotency_then_broker_visibility_with_separate_execution_approval",
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
    summary: {
      candidates: rows.length,
      eligible: eligibleRows.length,
      selectedSymbol: selected?.symbol || null,
      selectedOneShareNotional: selected?.oneShareNotional ?? null,
      selectedOneShareRiskDollars: selected?.oneShareRiskDollars ?? null,
      wouldGeneratePayloadProbe: Boolean(selected),
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

main();
