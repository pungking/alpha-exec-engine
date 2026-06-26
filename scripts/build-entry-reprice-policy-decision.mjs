import fs from "node:fs";
import assert from "node:assert/strict";

const STATE_DIR = String(process.env.ENTRY_REPRICE_POLICY_STATE_DIR || "state").trim() || "state";
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const DECISION_AUDIT_PATH = `${STATE_DIR}/last-order-decision-audit.json`;
const PORTFOLIO_ADMISSION_PATH = `${STATE_DIR}/portfolio-admission-audit.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const OUTPUT_JSON = `${STATE_DIR}/entry-reprice-policy-decision.json`;
const OUTPUT_MD = `${STATE_DIR}/entry-reprice-policy-decision.md`;

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

const short = (value, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const fmt = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : n.toFixed(digits);
};

const pct = (value, digits = 2) => {
  const n = toNum(value);
  return n == null ? "N/A" : `${n.toFixed(digits)}%`;
};

const readDecisionRecords = (preview, audit) => {
  if (Array.isArray(audit?.records)) return audit.records;
  if (Array.isArray(preview?.orderDecisionAudit?.records)) return preview.orderDecisionAudit.records;
  if (Array.isArray(preview?.decisionAudit)) return preview.decisionAudit;
  const fallback = [];
  if (Array.isArray(preview?.payloads)) fallback.push(...preview.payloads);
  if (Array.isArray(preview?.skipped)) fallback.push(...preview.skipped);
  return fallback;
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

const parseReasonNumber = (reason, key) => {
  const match = String(reason || "").match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  return match ? toNum(match[1]) : null;
};

const computeRiskReward = (entry, target, stop) => {
  const e = toNum(entry);
  const t = toNum(target);
  const s = toNum(stop);
  if (e == null || t == null || s == null || e <= s) return null;
  return (t - e) / (e - s);
};

const computeDistancePct = (current, entry) => {
  const c = toNum(current);
  const e = toNum(entry);
  if (c == null || e == null || e <= 0) return null;
  return ((c - e) / e) * 100;
};

const isFillabilityBelowFloor = (decision, portfolioRow) => {
  const reason = `${decision?.reason || ""} ${portfolioRow?.reason || ""}`;
  return reason.includes("portfolio_fillability_below_floor") || reason.includes("fillability_below_floor");
};

const isHeldOrDedupeRoute = (decision) => {
  const reason = String(decision?.reason || "");
  return (
    reason.includes("portfolio_held") ||
    reason.includes("already_held") ||
    reason.includes("idempotency_duplicate")
  );
};

const classifyPolicy = (row, policy) => {
  if (!row.validGeometry) {
    return {
      decision: "BLOCK_PRICE_GEOMETRY",
      action: "do_not_reprice_route_to_stage6_geometry_review",
      reason: "entry_stop_target_geometry_invalid"
    };
  }
  if (!row.unheldExecutable) {
    return {
      decision: "NO_ACTION_NON_EXECUTABLE_OR_HELD",
      action: "do_not_reprice",
      reason: "candidate_is_not_unheld_executable"
    };
  }
  if (row.rrAtCurrent != null && row.rrAtCurrent < policy.minRr) {
    return {
      decision: "WAIT_PULLBACK_RR_BELOW_MIN",
      action: "keep_stage6_limit_wait_pullback",
      reason: `current_rr_${row.rrAtCurrent.toFixed(4)}_below_min_${policy.minRr.toFixed(2)}`
    };
  }
  if (row.currentDistancePct != null && row.currentDistancePct > policy.maxPullbackDistancePct) {
    return {
      decision: "WAIT_PULLBACK_DISTANCE_TOO_FAR",
      action: "keep_stage6_limit_wait_pullback",
      reason: `current_distance_${row.currentDistancePct.toFixed(2)}_above_pullback_${policy.maxPullbackDistancePct.toFixed(2)}`
    };
  }
  if (row.currentDistancePct != null && row.currentDistancePct > policy.maxAdaptiveDistancePct) {
    return {
      decision: "WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND",
      action: "keep_stage6_limit_wait_pullback",
      reason: `current_distance_${row.currentDistancePct.toFixed(2)}_above_adaptive_${policy.maxAdaptiveDistancePct.toFixed(2)}`
    };
  }
  if (row.currentDistancePct != null && row.currentDistancePct <= 0) {
    return {
      decision: "KEEP_STAGE6_LIMIT_OR_BETTER",
      action: "keep_stage6_limit_price",
      reason: "current_at_or_below_stage6_entry"
    };
  }
  if (row.rrAtCurrent != null && row.rrAtCurrent >= policy.minRr) {
    return {
      decision: "ENTRY_REPRICE_REVIEW_READY",
      action: "manual_review_only_reprice_or_adaptive_entry",
      reason: "current_price_within_adaptive_band_and_rr_preserved"
    };
  }
  return {
    decision: "NO_ACTION_REVIEW_OTHER_BLOCKER",
    action: "do_not_reprice",
    reason: "insufficient_price_rr_evidence"
  };
};

const classifyStatusTaxonomy = (row) => {
  if (row.policyDecision === "WAIT_PULLBACK_RR_BELOW_MIN") return "RR_AT_CURRENT_WEAK";
  if (String(row.policyDecision || "").startsWith("WAIT_PULLBACK")) return "WAIT_PULLBACK";
  if (row.unheldExecutable && row.status === "skipped") return "OPEN_WAITING";
  return "NO_ACTION";
};

const buildRows = ({ preview, audit, portfolioAdmission, fillability }) => {
  const minRr =
    toNum(preview?.entryPricePolicy?.minRr) ??
    toNum(preview?.portfolioAdmission?.minAdmissionRr) ??
    toNum(process.env.ENTRY_REPRICE_POLICY_MIN_RR) ??
    1.8;
  const maxAdaptiveDistancePct =
    toNum(process.env.ENTRY_REPRICE_POLICY_MAX_ADAPTIVE_DISTANCE_PCT) ??
    toNum(process.env.EXECUTION_OVERLAY_MAX_ADAPTIVE_DISTANCE_PCT) ??
    3;
  const maxPullbackDistancePct =
    toNum(process.env.ENTRY_REPRICE_POLICY_MAX_PULLBACK_DISTANCE_PCT) ??
    toNum(process.env.EXECUTION_OVERLAY_MAX_PULLBACK_DISTANCE_PCT) ??
    6;
  const minFillabilityScore =
    toNum(preview?.portfolioAdmission?.minFillabilityScore) ??
    toNum(process.env.PORTFOLIO_MIN_FILLABILITY_SCORE) ??
    60;
  const policy = {
    minRr,
    maxAdaptiveDistancePct,
    maxPullbackDistancePct,
    minFillabilityScore
  };

  const records = readDecisionRecords(preview, audit);
  const portfolioRows = indexBySymbol(portfolioAdmission?.summary?.records || preview?.portfolioAdmission?.records || []);
  const fillRows = indexBySymbol(fillability?.rows || []);

  const rows = records.map((decision) => {
    const symbol = String(decision?.symbol || "").trim().toUpperCase();
    const portfolioRow = portfolioRows.get(symbol) || {};
    const fillRow = fillRows.get(symbol) || {};
    const entry = toNum(decision?.entryAdjusted ?? decision?.entryPrice ?? decision?.entryOriginal ?? fillRow?.entryAdjusted);
    const current =
      toNum(decision?.executionOverlay?.currentPrice) ??
      toNum(decision?.openOrderMonitor?.currentPrice) ??
      toNum(fillRow?.currentPrice);
    const target = toNum(decision?.target ?? fillRow?.target);
    const stop = toNum(decision?.stop ?? fillRow?.stop);
    const currentDistancePct =
      toNum(decision?.executionOverlay?.currentDistancePct) ??
      toNum(portfolioRow?.fillabilityBreakdown?.effectiveDistancePct) ??
      computeDistancePct(current, entry);
    const rrAtCurrent =
      toNum(decision?.executionOverlay?.rrAtCurrent) ??
      toNum(portfolioRow?.rrAtCurrent) ??
      toNum(fillRow?.rrAtCurrent) ??
      computeRiskReward(current, target, stop);
    const rrAtEntry =
      toNum(decision?.riskRewardAfter) ??
      toNum(decision?.riskRewardBefore) ??
      toNum(fillRow?.rrAtAdjustedEntry) ??
      computeRiskReward(entry, target, stop);
    const fillabilityScore =
      toNum(portfolioRow?.fillabilityScore) ??
      parseReasonNumber(decision?.reason, "score");
    const fillabilityMin =
      parseReasonNumber(decision?.reason, "min") ??
      minFillabilityScore;
    const style = decision?.executionOverlay?.style ?? portfolioRow?.fillabilityBreakdown?.style ?? fillRow?.overlayStyle ?? null;
    const overlayReason = decision?.executionOverlay?.reason ?? fillRow?.overlayReason ?? null;
    const finalDecision = String(decision?.finalDecision || "").trim().toUpperCase();
    const executionBucket = String(decision?.executionBucket || "").trim().toUpperCase();
    const unheldExecutable =
      (finalDecision === "EXECUTABLE_NOW" || executionBucket === "EXECUTABLE") && !isHeldOrDedupeRoute(decision);
    const validGeometry =
      entry != null &&
      stop != null &&
      target != null &&
      entry > stop &&
      target > entry &&
      (current == null || current > stop);
    const priceRrCase =
      isFillabilityBelowFloor(decision, portfolioRow) ||
      String(overlayReason || "").includes("rr_below_floor") ||
      (currentDistancePct != null && currentDistancePct > 0 && rrAtCurrent != null && rrAtCurrent < minRr);

    const base = {
      symbol,
      status: decision?.status || "unknown",
      unheldExecutable,
      priceRrCase,
      finalDecision: decision?.finalDecision || null,
      executionBucket: decision?.executionBucket || null,
      decisionReason: decision?.decisionReason || decision?.executionReason || null,
      skipReason: decision?.reason || null,
      portfolioReason: portfolioRow?.reason || null,
      fillabilityScore,
      fillabilityMin,
      fillabilityBelowFloor: isFillabilityBelowFloor(decision, portfolioRow),
      fillabilityBreakdown: portfolioRow?.fillabilityBreakdown || null,
      entry,
      currentPrice: current,
      target,
      stop,
      currentDistancePct: currentDistancePct == null ? null : Number(currentDistancePct.toFixed(4)),
      rrAtCurrent: rrAtCurrent == null ? null : Number(rrAtCurrent.toFixed(4)),
      rrAtEntry: rrAtEntry == null ? null : Number(rrAtEntry.toFixed(4)),
      style,
      overlayReason,
      validGeometry,
      minRr,
      maxAdaptiveDistancePct,
      maxPullbackDistancePct,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    };
    const classified = classifyPolicy(base, policy);
    return {
      ...base,
      policyDecision: classified.decision,
      policyAction: classified.action,
      policyReason: classified.reason,
      statusTaxonomy: classifyStatusTaxonomy({ ...base, policyDecision: classified.decision }),
      fillabilityFloorAction: "KEEP_CURRENT_FLOOR",
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    };
  });

  rows.sort((a, b) => {
    const rank = (row) => {
      if (row.policyDecision === "ENTRY_REPRICE_REVIEW_READY") return 0;
      if (row.policyDecision.startsWith("WAIT_PULLBACK")) return 1;
      if (row.policyDecision === "WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND") return 2;
      if (row.policyDecision.startsWith("BLOCK_")) return 3;
      return 4;
    };
    return rank(a) - rank(b) || String(a.symbol).localeCompare(String(b.symbol));
  });

  return { rows, policy };
};

const summarize = ({ preview, rows }) => {
  const count = (predicate) => rows.filter(predicate).length;
  const decisions = rows.reduce((acc, row) => {
    acc[row.policyDecision] = (acc[row.policyDecision] || 0) + 1;
    return acc;
  }, {});
  const statusTaxonomyCounts = rows.reduce((acc, row) => {
    const key = row.statusTaxonomy || "NO_ACTION";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const brokerMutationAttempted = rows.some((row) => row.brokerMutationAttempted === true);
  const brokerMutationSubmitted = rows.some((row) => row.brokerMutationSubmitted === true);
  const entryRepriceReviewReady = count((row) => row.policyDecision === "ENTRY_REPRICE_REVIEW_READY");
  const waitPullbackRows = count((row) => row.policyDecision.startsWith("WAIT_PULLBACK"));
  const waitPullbackRrBelowMin = count((row) => row.policyDecision === "WAIT_PULLBACK_RR_BELOW_MIN");
  const waitPullbackDistanceRows = count((row) =>
    ["WAIT_PULLBACK_DISTANCE_TOO_FAR", "WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND"].includes(row.policyDecision)
  );
  const blockedGeometry = count((row) => row.policyDecision === "BLOCK_PRICE_GEOMETRY");
  const priceRrCaseRows = count((row) => row.priceRrCase);

  let overall = "report_only_no_price_rr_rows";
  if (entryRepriceReviewReady > 0) overall = "report_only_manual_review_available";
  else if (waitPullbackRows > 0) overall = "report_only_wait_pullback";
  else if (blockedGeometry > 0) overall = "report_only_blocked_geometry";
  else if (rows.length === 0) overall = "no_decision_rows";

  return {
    generatedAt: new Date().toISOString(),
    stage6File: preview?.stage6File || null,
    stage6Hash: preview?.stage6Hash || null,
    rows: rows.length,
    priceRrCaseRows,
    entryRepriceReviewReady,
    waitPullbackRows,
    waitPullbackRrBelowMin,
    waitPullbackDistanceRows,
    blockedGeometry,
    fillabilityBelowFloorRows: count((row) => row.fillabilityBelowFloor),
    fillabilityFloorChangeRecommended: false,
    brokerMutationAttempted,
    brokerMutationSubmitted,
    decisions,
    statusTaxonomyCounts
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Entry/Reprice Policy Decision");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- stage6: \`${report.stage6File || "N/A"} @ ${String(report.stage6Hash || "").slice(0, 12) || "N/A"}\``);
  lines.push(
    `- safety: \`report_only=true brokerMutationAllowed=false attempted=${report.brokerMutationAttempted} submitted=${report.brokerMutationSubmitted}\``
  );
  lines.push(
    `- policy: \`minRR=${fmt(report.policy.minRr)} adaptiveMax=${pct(report.policy.maxAdaptiveDistancePct)} pullbackMax=${pct(report.policy.maxPullbackDistancePct)} fillabilityFloor=${fmt(report.policy.minFillabilityScore, 1)} floorChangeRecommended=${report.summary.fillabilityFloorChangeRecommended}\``
  );
  lines.push(
    `- summary: \`rows=${report.summary.rows} priceRr=${report.summary.priceRrCaseRows} ready=${report.summary.entryRepriceReviewReady} wait=${report.summary.waitPullbackRows} rrBelow=${report.summary.waitPullbackRrBelowMin} distanceWait=${report.summary.waitPullbackDistanceRows} geometryBlocked=${report.summary.blockedGeometry}\``
  );
  lines.push(`- statusTaxonomy: \`${JSON.stringify(report.summary.statusTaxonomyCounts || {})}\``);
  lines.push("");
  lines.push("| Symbol | Decision | Action | Entry | Current | Dist | RR@Current | RR@Entry | Fillability | Style | Reason |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows.slice(0, 30)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.statusTaxonomy || "N/A"}:${row.policyDecision} | ${row.policyAction} | ${fmt(row.entry)} | ${fmt(row.currentPrice)} | ${pct(row.currentDistancePct)} | ${fmt(row.rrAtCurrent, 4)} | ${fmt(row.rrAtEntry, 4)} | ${fmt(row.fillabilityScore, 1)}/${fmt(row.fillabilityMin, 1)} | ${row.style || "N/A"} | ${short(row.policyReason || row.overlayReason || row.skipReason, 90) || "N/A"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const preview = readJson(PREVIEW_PATH);
  const audit = readJson(DECISION_AUDIT_PATH);
  const portfolioAdmission = readJson(PORTFOLIO_ADMISSION_PATH);
  const fillability = readJson(FILLABILITY_PATH);
  const { rows, policy } = buildRows({ preview, audit, portfolioAdmission, fillability });
  const summary = summarize({ preview, rows });
  const report = {
    generatedAt: summary.generatedAt,
    overall: summary.generatedAt && summary.entryRepriceReviewReady > 0
      ? "report_only_manual_review_available"
      : summary.waitPullbackRows > 0
        ? "report_only_wait_pullback"
        : summary.blockedGeometry > 0
          ? "report_only_blocked_geometry"
          : summary.rows > 0
            ? "report_only_no_price_rr_rows"
            : "no_decision_rows",
    executionPolicy: {
      reportOnly: true,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      approvalRequiredForMutation: true
    },
    stage6File: summary.stage6File,
    stage6Hash: summary.stage6Hash,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    policy,
    summary,
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[ENTRY_REPRICE_POLICY] overall=${report.overall} rows=${summary.rows} ready=${summary.entryRepriceReviewReady} wait=${summary.waitPullbackRows} rrBelow=${summary.waitPullbackRrBelowMin} attempted=false submitted=false`
  );
};

const selfCheck = () => {
  assert.equal(classifyStatusTaxonomy({ policyDecision: "WAIT_PULLBACK_RR_BELOW_MIN" }), "RR_AT_CURRENT_WEAK");
  assert.equal(classifyStatusTaxonomy({ policyDecision: "WAIT_PULLBACK_DISTANCE_TOO_FAR" }), "WAIT_PULLBACK");
  assert.equal(classifyStatusTaxonomy({ policyDecision: "NO_ACTION_REVIEW_OTHER_BLOCKER", unheldExecutable: true, status: "skipped" }), "OPEN_WAITING");
};

if (process.env.ENTRY_REPRICE_POLICY_SELF_CHECK === "1") {
  selfCheck();
  console.log("[ENTRY_REPRICE_POLICY_SELF_CHECK] pass");
} else {
  main();
}
