import fs from "node:fs";

const STATE_DIR = String(process.env.STAGE6_FILLABILITY_MISMATCH_STATE_DIR || "state").trim() || "state";
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const DECISION_AUDIT_PATH = `${STATE_DIR}/last-order-decision-audit.json`;
const FILLABILITY_PATH = `${STATE_DIR}/fillability-report.json`;
const ENTRY_REPRICE_PATH = `${STATE_DIR}/entry-reprice-policy-decision.json`;
const OUTPUT_JSON = `${STATE_DIR}/stage6-fillability-mismatch-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/stage6-fillability-mismatch-audit.md`;

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

const isExecutable = (row) => {
  const finalDecision = String(row?.finalDecision || "").trim().toUpperCase();
  const executionBucket = String(row?.executionBucket || "").trim().toUpperCase();
  return finalDecision === "EXECUTABLE_NOW" || executionBucket === "EXECUTABLE";
};

const isHeldOrDedupe = (row) => {
  const reason = String(row?.reason || "");
  return reason.includes("portfolio_held") || reason.includes("already_held") || reason.includes("idempotency_duplicate");
};

const isFillabilityBelowFloor = (decision, fillRow) => {
  const reason = `${decision?.reason || ""} ${fillRow?.reason || ""}`;
  return reason.includes("portfolio_fillability_below_floor") || reason.includes("fillability_below_floor");
};

const classifyMismatch = (row, policy) => {
  if (!row.stage6Executable) return {
    mismatchVerdict: "NO_STAGE6_EXECUTABLE",
    action: "no_action",
    reason: "stage6_did_not_mark_executable"
  };
  if (row.payloadReady) return {
    mismatchVerdict: "PAYLOAD_READY",
    action: "no_mismatch",
    reason: "sidecar_generated_payload"
  };
  if (!row.fillabilityBelowFloor) return {
    mismatchVerdict: "BLOCKED_BY_OTHER_GATE",
    action: "route_to_top_skip_category",
    reason: short(row.skipReason || "non_fillability_skip", 80)
  };
  if (!row.validGeometry) return {
    mismatchVerdict: "STAGE6_GEOMETRY_REVIEW_REQUIRED",
    action: "route_to_stage6_stop_target_geometry_audit",
    reason: "entry_stop_target_or_current_geometry_invalid"
  };
  if (row.rrAtCurrent != null && row.rrAtCurrent < policy.minRr) return {
    mismatchVerdict: "WAIT_PULLBACK_RR_BELOW_MIN",
    action: "keep_stage6_limit_no_reprice",
    reason: `current_rr_${row.rrAtCurrent.toFixed(4)}_below_min_${policy.minRr.toFixed(2)}`
  };
  if (row.currentDistancePct != null && row.currentDistancePct > policy.maxPullbackDistancePct) return {
    mismatchVerdict: "WAIT_PULLBACK_DISTANCE_TOO_FAR",
    action: "keep_stage6_limit_or_recompute_entry",
    reason: `current_distance_${row.currentDistancePct.toFixed(2)}_above_pullback_${policy.maxPullbackDistancePct.toFixed(2)}`
  };
  if (row.currentDistancePct != null && row.currentDistancePct > policy.maxAdaptiveDistancePct) return {
    mismatchVerdict: "WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND",
    action: "route_to_stage6_entry_timing_policy_audit",
    reason: `current_distance_${row.currentDistancePct.toFixed(2)}_above_adaptive_${policy.maxAdaptiveDistancePct.toFixed(2)}_rr_preserved`
  };
  if (row.rrAtCurrent != null && row.rrAtCurrent >= policy.minRr) return {
    mismatchVerdict: "ENTRY_POLICY_REVIEW_READY",
    action: "manual_review_only_adaptive_current_entry_or_reprice_policy",
    reason: "current_price_within_adaptive_band_and_rr_preserved"
  };
  return {
    mismatchVerdict: "FILLABILITY_POLICY_REVIEW_REQUIRED",
    action: "route_to_stage6_sidecar_contract_review",
    reason: "insufficient_current_price_rr_evidence"
  };
};

const buildRows = ({ preview, audit, fillability, entryReprice }) => {
  const records = readDecisionRecords(preview, audit);
  const fillRows = indexBySymbol(fillability?.rows || []);
  const entryRows = indexBySymbol(entryReprice?.rows || []);
  const minRr =
    toNum(entryReprice?.policy?.minRr) ??
    toNum(preview?.entryPricePolicy?.minRr) ??
    toNum(process.env.STAGE6_FILLABILITY_MISMATCH_MIN_RR) ??
    1.8;
  const maxAdaptiveDistancePct =
    toNum(entryReprice?.policy?.maxAdaptiveDistancePct) ??
    toNum(process.env.STAGE6_FILLABILITY_MISMATCH_MAX_ADAPTIVE_DISTANCE_PCT) ??
    3;
  const maxPullbackDistancePct =
    toNum(entryReprice?.policy?.maxPullbackDistancePct) ??
    toNum(process.env.STAGE6_FILLABILITY_MISMATCH_MAX_PULLBACK_DISTANCE_PCT) ??
    6;
  const policy = { minRr, maxAdaptiveDistancePct, maxPullbackDistancePct };

  const rows = records.map((decision) => {
    const symbol = String(decision?.symbol || "").trim().toUpperCase();
    const fillRow = fillRows.get(symbol) || {};
    const entryRow = entryRows.get(symbol) || {};
    const entry = toNum(decision?.entryAdjusted ?? fillRow?.entryAdjusted ?? entryRow?.entry);
    const currentPrice =
      toNum(fillRow?.currentPrice) ??
      toNum(decision?.executionOverlay?.currentPrice) ??
      toNum(decision?.openOrderMonitor?.currentPrice) ??
      toNum(entryRow?.currentPrice);
    const target = toNum(decision?.target ?? fillRow?.target ?? entryRow?.target);
    const stop = toNum(decision?.stop ?? fillRow?.stop ?? entryRow?.stop);
    const rrAtCurrent =
      toNum(fillRow?.rrAtCurrent) ??
      toNum(decision?.executionOverlay?.rrAtCurrent) ??
      toNum(entryRow?.rrAtCurrent) ??
      computeRiskReward(currentPrice, target, stop);
    const rrAtEntry =
      toNum(fillRow?.rrAtAdjustedEntry) ??
      toNum(decision?.riskRewardAfter) ??
      toNum(entryRow?.rrAtEntry) ??
      computeRiskReward(entry, target, stop);
    const currentDistancePct =
      toNum(decision?.executionOverlay?.currentDistancePct) ??
      parseReasonNumber(decision?.reason, "dist") ??
      toNum(fillRow?.effectiveEntryDistancePct) ??
      toNum(entryRow?.currentDistancePct);
    const currentVsLimitPct = toNum(fillRow?.currentVsLimitPct);
    const fillabilityScore = parseReasonNumber(decision?.reason, "score") ?? toNum(entryRow?.fillabilityScore);
    const fillabilityMin = parseReasonNumber(decision?.reason, "min") ?? toNum(entryRow?.fillabilityMin) ?? 60;
    const payloadReady = String(decision?.status || "").trim().toLowerCase() === "payload";
    const stage6Executable = isExecutable(decision) && !isHeldOrDedupe(decision);
    const fillabilityBelowFloor = isFillabilityBelowFloor(decision, fillRow);
    const validGeometry =
      entry != null && stop != null && target != null && currentPrice != null && entry > stop && target > entry && currentPrice > stop;
    const base = {
      symbol,
      stage6Executable,
      payloadReady,
      fillabilityBelowFloor,
      sidecarBlocked: stage6Executable && !payloadReady,
      finalDecision: decision?.finalDecision || null,
      verdict: decision?.verdict || fillRow?.verdict || null,
      decisionReason: decision?.decisionReason || decision?.executionReason || fillRow?.executionReason || null,
      skipReason: decision?.reason || fillRow?.reason || null,
      entry,
      currentPrice,
      target,
      stop,
      currentDistancePct,
      currentVsLimitPct,
      rrAtCurrent,
      rrAtEntry,
      minRr,
      fillabilityScore,
      fillabilityMin,
      fillabilityScoreGap: fillabilityScore == null ? null : Number((fillabilityScore - fillabilityMin).toFixed(4)),
      overlayStyle: decision?.executionOverlay?.style || fillRow?.overlayStyle || null,
      overlayReason: decision?.executionOverlay?.reason || fillRow?.overlayReason || null,
      quoteValid: fillRow?.quoteValid === true,
      quoteInvalid: fillRow?.quoteInvalid === true,
      entryRepricePolicyDecision: entryRow?.policyDecision || null,
      entryRepricePolicyAction: entryRow?.policyAction || null,
      validGeometry,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    };
    const classified = classifyMismatch(base, policy);
    return { ...base, ...classified };
  });

  rows.sort((a, b) => {
    const rank = (row) => {
      if (row.mismatchVerdict === "ENTRY_POLICY_REVIEW_READY") return 0;
      if (row.mismatchVerdict.startsWith("WAIT_PULLBACK")) return 1;
      if (row.mismatchVerdict.includes("REVIEW")) return 2;
      if (row.mismatchVerdict === "PAYLOAD_READY") return 3;
      return 4;
    };
    return rank(a) - rank(b) || String(a.symbol).localeCompare(String(b.symbol));
  });

  return { rows, policy };
};

const summarize = ({ preview, audit, rows }) => {
  const count = (predicate) => rows.filter(predicate).length;
  const decisions = rows.reduce((acc, row) => {
    acc[row.mismatchVerdict] = (acc[row.mismatchVerdict] || 0) + 1;
    return acc;
  }, {});
  const mismatchRows = rows.filter((row) => row.stage6Executable && !row.payloadReady);
  const stage6QualityReviewReady = mismatchRows.length;
  const brokerMutationAttempted = rows.some((row) => row.brokerMutationAttempted === true);
  const brokerMutationSubmitted = rows.some((row) => row.brokerMutationSubmitted === true);
  let overall = "pass_no_stage6_sidecar_mismatch";
  if (rows.length === 0) overall = "no_decision_rows";
  else if (stage6QualityReviewReady > 0) overall = "stage6_quality_review_ready";
  else if (mismatchRows.length > 0) overall = "sidecar_blocked_stage6_executable_review";

  return {
    generatedAt: new Date().toISOString(),
    stage6File: preview?.stage6File || audit?.stage6File || null,
    stage6Hash: preview?.stage6Hash || audit?.stage6Hash || null,
    rows: rows.length,
    stage6ExecutableRows: count((row) => row.stage6Executable),
    sidecarPayloadReadyRows: count((row) => row.payloadReady),
    mismatchRows: mismatchRows.length,
    fillabilityBelowFloorRows: count((row) => row.fillabilityBelowFloor),
    rrCurrentPassRows: count((row) => row.rrAtCurrent != null && row.rrAtCurrent >= row.minRr),
    currentDistanceAboveAdaptiveRows: count((row) =>
      row.currentDistancePct != null && row.currentDistancePct > 0 && row.mismatchVerdict === "WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND"
    ),
    entryPolicyReviewReady: count((row) => row.mismatchVerdict === "ENTRY_POLICY_REVIEW_READY"),
    waitPullbackRows: count((row) => row.mismatchVerdict.startsWith("WAIT_PULLBACK")),
    geometryReviewRows: count((row) => row.mismatchVerdict === "STAGE6_GEOMETRY_REVIEW_REQUIRED"),
    stage6QualityReviewReady,
    brokerMutationAttempted,
    brokerMutationSubmitted,
    decisions,
    overall
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Stage6 / Fillability Mismatch Audit");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- stage6: \`${report.stage6File || "N/A"} @ ${String(report.stage6Hash || "").slice(0, 12) || "N/A"}\``);
  lines.push(
    `- safety: \`report_only=true brokerMutationAllowed=false attempted=${report.executionPolicy.brokerMutationAttempted} submitted=${report.executionPolicy.brokerMutationSubmitted}\``
  );
  lines.push(
    `- summary: \`rows=${report.summary.rows} executable=${report.summary.stage6ExecutableRows} payloadReady=${report.summary.sidecarPayloadReadyRows} mismatch=${report.summary.mismatchRows} fillabilityBlocked=${report.summary.fillabilityBelowFloorRows} stage6ReviewReady=${report.summary.stage6QualityReviewReady}\``
  );
  lines.push(
    `- policy: \`minRR=${fmt(report.policy.minRr)} adaptiveMax=${pct(report.policy.maxAdaptiveDistancePct)} pullbackMax=${pct(report.policy.maxPullbackDistancePct)}\``
  );
  lines.push("- interpretation: `Stage6 executable rows blocked by sidecar fillability are analysis-quality review items, not broker-submit items.`");
  lines.push("");
  lines.push("| Symbol | Verdict | Stage6 | Sidecar Block | Entry | Current | Dist | Cur/Lmt | RR@Current | Fillability | Mismatch Verdict | Action | Reason |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows.slice(0, 30)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.verdict || "N/A"} | ${row.finalDecision || "N/A"} | ${row.fillabilityBelowFloor ? "fillability" : short(row.skipReason, 24) || "N/A"} | ${fmt(row.entry)} | ${fmt(row.currentPrice)} | ${pct(row.currentDistancePct)} | ${pct(row.currentVsLimitPct)} | ${fmt(row.rrAtCurrent, 4)} | ${fmt(row.fillabilityScore, 1)}/${fmt(row.fillabilityMin, 1)} | ${row.mismatchVerdict} | ${row.action} | ${short(row.reason, 90) || "N/A"} |`
    );
  }
  lines.push("");
  lines.push("### Done-When Routing");
  lines.push("- `ENTRY_POLICY_REVIEW_READY`: separate approval-based entry/reprice review; no automatic broker mutation.");
  lines.push("- `WAIT_PULLBACK_*`: keep wait-pullback; send evidence to Stage6 entry timing calibration.");
  lines.push("- `STAGE6_GEOMETRY_REVIEW_REQUIRED`: fix Stage6 stop/current/target geometry before any repair or entry route.");
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const preview = readJson(PREVIEW_PATH);
  const audit = readJson(DECISION_AUDIT_PATH);
  const fillability = readJson(FILLABILITY_PATH);
  const entryReprice = readJson(ENTRY_REPRICE_PATH);
  const { rows, policy } = buildRows({ preview, audit, fillability, entryReprice });
  const summary = summarize({ preview, audit, rows });
  const report = {
    generatedAt: summary.generatedAt,
    overall: summary.overall,
    executionPolicy: {
      reportOnly: true,
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      approvalRequiredForMutation: true
    },
    stage6File: summary.stage6File,
    stage6Hash: summary.stage6Hash,
    policy,
    summary,
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[STAGE6_FILLABILITY_MISMATCH] overall=${report.overall} rows=${summary.rows} mismatch=${summary.mismatchRows} reviewReady=${summary.stage6QualityReviewReady} attempted=false submitted=false`
  );
};

main();
