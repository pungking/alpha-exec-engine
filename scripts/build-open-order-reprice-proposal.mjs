import fs from "node:fs";

const STATE_DIR = String(process.env.OPEN_ORDER_REPRICE_STATE_DIR || "state").trim() || "state";
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const CONSISTENCY_PATH = `${STATE_DIR}/order-state-consistency-report.json`;
const OUTPUT_JSON = `${STATE_DIR}/open-order-reprice-proposal.json`;
const OUTPUT_MD = `${STATE_DIR}/open-order-reprice-proposal.md`;

const OPEN_BROKER_STATUSES = new Set(["new", "accepted", "pending_new", "partially_filled"]);

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

const toBool = (value) => value === true || String(value ?? "").trim().toLowerCase() === "true";

const short = (value, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const money = (value) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(2);
};

const pct = (value) => {
  const n = toNum(value);
  return n == null ? "N/A" : `${n.toFixed(2)}%`;
};

const roundToCent = (value) => {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(2));
};

const readDecisionRecords = (preview) => {
  if (Array.isArray(preview?.orderDecisionAudit?.records)) return preview.orderDecisionAudit.records;
  if (Array.isArray(preview?.decisionAudit)) return preview.decisionAudit;
  return [];
};

const indexBySymbol = (rows) => {
  const out = new Map();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    if (symbol) out.set(symbol, row);
  }
  return out;
};

const computeRiskReward = (entry, stop, target) => {
  const e = toNum(entry);
  const s = toNum(stop);
  const t = toNum(target);
  if (e == null || s == null || t == null || e <= s) return null;
  return (t - e) / (e - s);
};

const determineDecision = (checks) => {
  if (!checks.reportOnly) return "BLOCK_UNSAFE_MODE";
  if (!checks.hasOpenOrder) return "BLOCK_NO_OPEN_ORDER";
  if (!checks.brokerOrderOpen) return "BLOCK_BROKER_ORDER_NOT_OPEN";
  if (!checks.duplicateOpenCountOk) return "BLOCK_DUPLICATE_OPEN_ORDER";
  if (!checks.ledgerConsistencyPass) return "BLOCK_LEDGER_CONSISTENCY";
  if (!checks.validGeometry) return "BLOCK_INVALID_GEOMETRY";
  if (!checks.hasRiskRoom) return "BLOCK_NO_RISK_ROOM";
  if (!checks.deltaMeetsMinimum) return "BLOCK_DELTA_BELOW_MIN";
  if (!checks.rrAtRiskCappedAboveFloor) return "BLOCK_RR_BELOW_FLOOR_AT_RISK_CAP";
  if (!checks.riskDollarsWithinCap) return "BLOCK_RISK_CAP";
  if (!checks.policyRepriceCandidate) return "WAIT_POLICY_NOT_REPRICE_CANDIDATE";
  if (!checks.riskCappedLimitNearMarket) return "WAIT_RISK_CAPPED_LIMIT_BELOW_MARKET";
  return "READY_FOR_MANUAL_REPLACE_APPROVAL";
};

const buildRows = ({ preview, fillability, consistency }) => {
  const readOnly = preview?.mode?.readOnly === true;
  const execEnabled = preview?.mode?.execEnabled === true;
  const reportOnly = readOnly === true && execEnabled === false;
  const maxRiskDollarsPerTrade =
    toNum(preview?.entrySizingPolicy?.maxRiskDollarsPerTrade) ??
    toNum(process.env.ENTRY_MAX_RISK_DOLLARS_PER_TRADE) ??
    25;
  const minRr = toNum(preview?.entryPricePolicy?.minRr) ?? toNum(process.env.ENTRY_PRICE_MIN_RR) ?? 1.8;
  const repriceDistancePct = toNum(process.env.ENTRY_OPEN_ORDER_MONITOR_REPRICE_DISTANCE_PCT) ?? 2.5;
  const repriceAfterMinutes = toNum(process.env.ENTRY_OPEN_ORDER_MONITOR_REPRICE_AFTER_MINUTES) ?? 60;
  const minRepriceDeltaPct = toNum(process.env.ENTRY_OPEN_ORDER_MONITOR_MIN_REPRICE_DELTA_PCT) ?? 0.25;
  const nearMarketPct = toNum(process.env.OPEN_ORDER_REPRICE_PROPOSAL_NEAR_MARKET_PCT) ?? 0.5;

  const decisionBySymbol = indexBySymbol(readDecisionRecords(preview));
  const fillBySymbol = indexBySymbol(fillability?.rows || []);
  const consistencyBySymbol = indexBySymbol(consistency?.rows || []);
  const records = preview?.openOrderMonitor?.records || {};
  const rows = [];

  for (const [rawSymbol, monitor] of Object.entries(records)) {
    const symbol = String(rawSymbol || monitor?.symbol || "").trim().toUpperCase();
    if (!symbol || !monitor?.orderId) continue;

    const decision = decisionBySymbol.get(symbol) || {};
    const fill = fillBySymbol.get(symbol) || {};
    const consistencyRow = consistencyBySymbol.get(symbol) || {};
    const limitPrice = toNum(monitor.limitPrice ?? fill.brokerOpenLimit ?? fill.activeLimit);
    const currentPrice = toNum(monitor.currentPrice ?? fill.currentPrice);
    const quoteBid = toNum(fill.quoteBid);
    const quoteAsk = toNum(fill.quoteAsk);
    const qty = toNum(monitor.qty ?? fill.brokerOpenQty ?? decision.brokerQty) ?? 1;
    const stopPrice = toNum(decision.stop ?? fill.stop ?? decision?.payload?.stop_loss?.stop_price);
    const targetPrice = toNum(decision.target ?? fill.target ?? decision?.payload?.take_profit?.limit_price);
    const suggestedLimitPrice = toNum(monitor.suggestedLimitPrice);
    const distancePct = toNum(monitor.distancePct ?? fill.currentVsLimitPct);
    const ageMinutes = toNum(monitor.ageMinutes);
    const duplicateOpenCount = toNum(monitor.duplicateOpenCount) ?? 0;
    const brokerOpenStatus = String(fill.brokerOpenStatus || monitor.orderStatus || "").trim().toLowerCase();

    const rawRiskCapLimit =
      stopPrice != null && qty > 0 && maxRiskDollarsPerTrade > 0
        ? stopPrice + maxRiskDollarsPerTrade / qty
        : null;
    const riskCapLimitPrice = roundToCent(rawRiskCapLimit);
    const riskCappedSuggestedLimitPrice = roundToCent(
      Math.min(
        ...[suggestedLimitPrice, riskCapLimitPrice].filter((value) => value != null && Number.isFinite(value))
      )
    );
    const riskDollarsAtLimit =
      limitPrice != null && stopPrice != null && qty > 0 ? (limitPrice - stopPrice) * qty : null;
    const riskDollarsAtSuggestedLimit =
      suggestedLimitPrice != null && stopPrice != null && qty > 0
        ? (suggestedLimitPrice - stopPrice) * qty
        : null;
    const riskDollarsAtRiskCappedLimit =
      riskCappedSuggestedLimitPrice != null && stopPrice != null && qty > 0
        ? (riskCappedSuggestedLimitPrice - stopPrice) * qty
        : null;
    const rrAtSuggestedLimit = computeRiskReward(suggestedLimitPrice, stopPrice, targetPrice);
    const rrAtRiskCappedLimit = computeRiskReward(riskCappedSuggestedLimitPrice, stopPrice, targetPrice);
    const riskCappedDeltaPct =
      riskCappedSuggestedLimitPrice != null && limitPrice != null && limitPrice > 0
        ? ((riskCappedSuggestedLimitPrice - limitPrice) / limitPrice) * 100
        : null;
    const riskCappedLimitToMarketPct =
      riskCappedSuggestedLimitPrice != null && currentPrice != null && currentPrice > 0
        ? ((currentPrice - riskCappedSuggestedLimitPrice) / currentPrice) * 100
        : null;

    const checks = {
      reportOnly,
      policyRepriceCandidate: monitor.status === "REPRICE_CANDIDATE",
      hasOpenOrder: Boolean(monitor.orderId),
      brokerOrderOpen: OPEN_BROKER_STATUSES.has(brokerOpenStatus),
      duplicateOpenCountOk: duplicateOpenCount === 1,
      ledgerConsistencyPass: consistencyRow.status === "PASS",
      validGeometry:
        limitPrice != null && stopPrice != null && targetPrice != null && limitPrice > stopPrice && targetPrice > limitPrice,
      hasRiskRoom:
        riskCapLimitPrice != null && limitPrice != null && riskCapLimitPrice > limitPrice,
      deltaMeetsMinimum:
        riskCappedDeltaPct != null && riskCappedDeltaPct >= minRepriceDeltaPct,
      rrAtSuggestedAboveFloor: rrAtSuggestedLimit != null && rrAtSuggestedLimit >= minRr,
      rrAtRiskCappedAboveFloor: rrAtRiskCappedLimit != null && rrAtRiskCappedLimit >= minRr,
      suggestedRiskWithinCap:
        riskDollarsAtSuggestedLimit != null && riskDollarsAtSuggestedLimit <= maxRiskDollarsPerTrade + 0.005,
      riskDollarsWithinCap:
        riskDollarsAtRiskCappedLimit != null && riskDollarsAtRiskCappedLimit <= maxRiskDollarsPerTrade + 0.005,
      ageMeetsPolicy: ageMinutes != null && ageMinutes >= repriceAfterMinutes,
      distanceMeetsPolicy: distancePct != null && distancePct >= repriceDistancePct,
      riskCappedLimitNearMarket:
        riskCappedLimitToMarketPct != null && riskCappedLimitToMarketPct <= nearMarketPct
    };

    rows.push({
      symbol,
      decision: determineDecision(checks),
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      orderId: String(monitor.orderId || ""),
      clientOrderId: String(monitor.clientOrderId || fill.brokerOpenClientOrderId || "") || null,
      brokerOpenStatus: brokerOpenStatus || null,
      qty,
      limitPrice,
      currentPrice,
      quoteBid,
      quoteAsk,
      distancePct,
      ageMinutes,
      monitorStatus: monitor.status || null,
      monitorReason: monitor.reason || null,
      suggestedLimitPrice,
      riskCapLimitPrice,
      riskCappedSuggestedLimitPrice,
      riskCappedDeltaPct: riskCappedDeltaPct == null ? null : Number(riskCappedDeltaPct.toFixed(4)),
      riskCappedLimitToMarketPct:
        riskCappedLimitToMarketPct == null ? null : Number(riskCappedLimitToMarketPct.toFixed(4)),
      stopPrice,
      targetPrice,
      maxRiskDollarsPerTrade,
      minRr,
      repriceAfterMinutes,
      repriceDistancePct,
      minRepriceDeltaPct,
      nearMarketPct,
      rrAtLimit: toNum(monitor.rrAtLimit ?? fill.rrAtAdjustedEntry),
      rrAtCurrent: toNum(monitor.rrAtCurrent ?? fill.rrAtCurrent),
      rrAtSuggestedLimit: rrAtSuggestedLimit == null ? null : Number(rrAtSuggestedLimit.toFixed(4)),
      rrAtRiskCappedLimit: rrAtRiskCappedLimit == null ? null : Number(rrAtRiskCappedLimit.toFixed(4)),
      riskDollarsAtLimit: riskDollarsAtLimit == null ? null : Number(riskDollarsAtLimit.toFixed(2)),
      riskDollarsAtSuggestedLimit:
        riskDollarsAtSuggestedLimit == null ? null : Number(riskDollarsAtSuggestedLimit.toFixed(2)),
      riskDollarsAtRiskCappedLimit:
        riskDollarsAtRiskCappedLimit == null ? null : Number(riskDollarsAtRiskCappedLimit.toFixed(2)),
      checks
    });
  }

  rows.sort((a, b) => {
    const rank = (row) => {
      if (row.decision === "READY_FOR_MANUAL_REPLACE_APPROVAL") return 0;
      if (row.decision.startsWith("WAIT_")) return 1;
      return 2;
    };
    return rank(a) - rank(b) || String(a.symbol).localeCompare(String(b.symbol));
  });
  return rows;
};

const summarize = ({ preview, rows }) => {
  const count = (predicate) => rows.filter(predicate).length;
  const brokerMutationAttempted = rows.some((row) => row.brokerMutationAttempted === true);
  const brokerMutationSubmitted = rows.some((row) => row.brokerMutationSubmitted === true);
  return {
    generatedAt: new Date().toISOString(),
    stage6File: preview?.stage6File || null,
    stage6Hash: preview?.stage6Hash || null,
    readOnly: preview?.mode?.readOnly === true,
    execEnabled: preview?.mode?.execEnabled === true,
    brokerMutationAllowed: false,
    brokerMutationAttempted,
    brokerMutationSubmitted,
    rows: rows.length,
    readyForApproval: count((row) => row.decision === "READY_FOR_MANUAL_REPLACE_APPROVAL"),
    waitingPolicy: count((row) => row.decision === "WAIT_POLICY_NOT_REPRICE_CANDIDATE"),
    waitingRiskCappedBelowMarket: count((row) => row.decision === "WAIT_RISK_CAPPED_LIMIT_BELOW_MARKET"),
    blockedRiskCap: count((row) => row.decision === "BLOCK_RISK_CAP"),
    blockedNoRiskRoom: count((row) => row.decision === "BLOCK_NO_RISK_ROOM"),
    suggestedRiskCapBreaches: count((row) => row.checks?.suggestedRiskWithinCap === false),
    rrSafeAtRiskCap: count((row) => row.checks?.rrAtRiskCappedAboveFloor === true),
    policyRepriceCandidates: count((row) => row.checks?.policyRepriceCandidate === true),
    decisions: rows.reduce((acc, row) => {
      acc[row.decision] = (acc[row.decision] || 0) + 1;
      return acc;
    }, {})
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Open Order Risk-Capped Reprice Proposal");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- stage6: \`${report.stage6File || "N/A"}\``);
  lines.push(`- stage6Hash: \`${String(report.stage6Hash || "").slice(0, 12) || "N/A"}\``);
  lines.push(
    `- safety: \`report_only=true brokerMutationAllowed=false attempted=${report.brokerMutationAttempted} submitted=${report.brokerMutationSubmitted}\``
  );
  lines.push(
    `- summary: \`rows=${report.summary.rows} ready=${report.summary.readyForApproval} policyCandidates=${report.summary.policyRepriceCandidates} waitPolicy=${report.summary.waitingPolicy} waitBelowMarket=${report.summary.waitingRiskCappedBelowMarket} suggestedRiskBreaches=${report.summary.suggestedRiskCapBreaches} rrSafeAtRiskCap=${report.summary.rrSafeAtRiskCap}\``
  );
  lines.push("");
  lines.push(
    "| Symbol | Decision | Status | Age | Limit | Current | Suggested | Risk-Capped | Dist | RR Capped | Risk Capped | Risk Cap | Checks | Reason |"
  );
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows) {
    const checks = [
      `policy=${row.checks.policyRepriceCandidate}`,
      `rr=${row.checks.rrAtRiskCappedAboveFloor}`,
      `risk=${row.checks.riskDollarsWithinCap}`,
      `dup=${row.checks.duplicateOpenCountOk}`,
      `ledger=${row.checks.ledgerConsistencyPass}`,
      `near=${row.checks.riskCappedLimitNearMarket}`
    ].join(",");
    lines.push(
      `| ${row.symbol} | ${row.decision} | ${row.monitorStatus || "N/A"} | ${money(row.ageMinutes)} | ${money(row.limitPrice)} | ${money(row.currentPrice)} | ${money(row.suggestedLimitPrice)} | ${money(row.riskCappedSuggestedLimitPrice)} | ${pct(row.distancePct)} | ${money(row.rrAtRiskCappedLimit)} | ${money(row.riskDollarsAtRiskCappedLimit)} | ${money(row.maxRiskDollarsPerTrade)} | ${checks} | ${short(row.monitorReason, 80) || "N/A"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const preview = readJson(PREVIEW_PATH);
  const fillability = readJson(FILLABILITY_PATH);
  const consistency = readJson(CONSISTENCY_PATH);
  const rows = preview ? buildRows({ preview, fillability, consistency }) : [];
  const summary = summarize({ preview, rows });
  const report = {
    generatedAt: summary.generatedAt,
    overall:
      summary.readyForApproval > 0
        ? "manual_approval_required"
        : summary.rows > 0
          ? "report_only_no_ready_reprice"
          : "no_open_orders",
    executionPolicy: {
      reportOnly: true,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      approvalRequiredForMutation: true
    },
    stage6File: summary.stage6File,
    stage6Hash: summary.stage6Hash,
    readOnly: summary.readOnly,
    execEnabled: summary.execEnabled,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    summary,
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[OPEN_ORDER_REPRICE_PROPOSAL] overall=${report.overall} rows=${summary.rows} ready=${summary.readyForApproval} suggestedRiskBreaches=${summary.suggestedRiskCapBreaches} attempted=false submitted=false`
  );
};

main();
