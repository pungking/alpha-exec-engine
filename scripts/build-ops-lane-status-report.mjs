import fs from "node:fs";

const STATE_DIR = String(process.env.OPS_LANE_STATUS_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/ops-lane-status-report.json`;
const OUTPUT_MD = `${STATE_DIR}/ops-lane-status-report.md`;

const FILES = {
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  brokerChildReconciliation: `${STATE_DIR}/broker-child-order-reconciliation.json`,
  positionProtectionAudit: `${STATE_DIR}/position-protection-root-cause-audit.json`,
  guardMetadataRefreshPlan: `${STATE_DIR}/guard-metadata-refresh-plan.json`,
  guardMetadataLineageAudit: `${STATE_DIR}/guard-metadata-lineage-audit.json`,
  persistentOcoRepairPlan: `${STATE_DIR}/persistent-oco-repair-plan.json`,
  highPriceMinOneShareCanaryPlan: `${STATE_DIR}/high-price-min-one-share-canary-plan.json`,
  openOrderRepriceProposal: `${STATE_DIR}/open-order-reprice-proposal.json`,
  opsHealth: `${STATE_DIR}/ops-health-report.json`
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

const uniqueSymbols = (rows) =>
  Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();

const countRows = (rows, predicate) => (Array.isArray(rows) ? rows : []).filter(predicate).length;

const lane = ({ id, name, status, count, symbols, evidence, nextAction, safety }) => ({
  id,
  name,
  status,
  count: count ?? symbols?.length ?? 0,
  symbols: Array.isArray(symbols) ? symbols.slice(0, 20) : [],
  evidence: short(evidence, 500),
  nextAction: short(nextAction, 500),
  safety
});

const buildReport = () => {
  const preview = readJson(FILES.preview);
  const fillability = readJson(FILES.fillability);
  const brokerChildReconciliation = readJson(FILES.brokerChildReconciliation);
  const positionProtectionAudit = readJson(FILES.positionProtectionAudit);
  const guardMetadataRefreshPlan = readJson(FILES.guardMetadataRefreshPlan);
  const guardMetadataLineageAudit = readJson(FILES.guardMetadataLineageAudit);
  const persistentOcoRepairPlan = readJson(FILES.persistentOcoRepairPlan);
  const highPriceMinOneShareCanaryPlan = readJson(FILES.highPriceMinOneShareCanaryPlan);
  const openOrderRepriceProposal = readJson(FILES.openOrderRepriceProposal);
  const opsHealth = readJson(FILES.opsHealth);

  const lineageRows = Array.isArray(guardMetadataLineageAudit?.rows) ? guardMetadataLineageAudit.rows : [];
  const guardRows = Array.isArray(guardMetadataRefreshPlan?.rows) ? guardMetadataRefreshPlan.rows : [];
  const protectionRows = Array.isArray(positionProtectionAudit?.rows) ? positionProtectionAudit.rows : [];
  const brokerRows = Array.isArray(brokerChildReconciliation?.rows) ? brokerChildReconciliation.rows : [];
  const persistentRows = Array.isArray(persistentOcoRepairPlan?.rows) ? persistentOcoRepairPlan.rows : [];
  const repriceRows = Array.isArray(openOrderRepriceProposal?.rows) ? openOrderRepriceProposal.rows : [];
  const orderDecisionRecords = Array.isArray(preview?.orderDecisionAudit?.records)
    ? preview.orderDecisionAudit.records
    : [];

  const missingGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_NO_REFRESH_SOURCE");
  const staleGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_STALE");
  const invalidGuardRows = guardRows.filter((row) => row.refreshDecision === "BLOCKED_REFRESH_SOURCE_INVALID_GEOMETRY");
  const missingLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_MISSING_NO_SOURCE");
  const staleLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_STALE_SOURCE_ONLY");
  const invalidLineageRows = lineageRows.filter((row) => row.lineageStatus === "LINEAGE_INVALID_GEOMETRY");
  const invalidProtectionRows = protectionRows.filter(
    (row) =>
      row.invalidGeometry === true ||
      row.stopCurrentDrift === true ||
      row.geometry?.valid === false ||
      row.geometry?.stopAboveOrAtCurrent === true ||
      row.geometry?.targetBelowOrAtCurrent === true ||
      row.geometry?.targetBelowOrAtStop === true
  );
  const brokerChildrenPresentRows = guardRows.filter(
    (row) => row.broker?.stopPresent === true && row.broker?.targetPresent === true
  );
  const repairAfterRefreshRows = guardRows.filter(
    (row) => row.afterRefreshRepairDecision === "REPORT_ONLY_REPAIR_REEVALUATION_CANDIDATE"
  );
  const persistentEligibleRows = persistentRows.filter((row) => row.eligible === true);
  const brokerMissingRows = brokerRows.filter(
    (row) =>
      row.brokerStopPresent === false ||
      row.brokerTargetPresent === false ||
      row.missingStopChild === true ||
      row.missingTargetChild === true
  );
  const openRepriceReadyRows = repriceRows.filter((row) => row.readyForApproval === true);
  const highPriceSkippedRows = orderDecisionRecords.filter((row) =>
    String(row?.reason || "").includes("entry_notional_below_limit_price")
  );
  const minOneShareSelectedSymbol = asSymbol(highPriceMinOneShareCanaryPlan?.summary?.selectedSymbol);
  const minOneShareEligible = toNum(highPriceMinOneShareCanaryPlan?.summary?.eligible) ?? 0;
  const payloadCount = toNum(preview?.payloadCount) ?? 0;
  const brokerAttempted = toNum(preview?.brokerSubmission?.attempted) ?? 0;
  const brokerSubmitted = toNum(preview?.brokerSubmission?.submitted) ?? 0;

  const lanes = [
    lane({
      id: "track_1_guard_metadata_missing",
      name: "Guard Metadata Missing Lane",
      status: missingGuardRows.length || missingLineageRows.length ? "blocked_root_cause_required" : "clear",
      symbols: uniqueSymbols([...missingGuardRows, ...missingLineageRows]),
      evidence: `guardRefresh=${guardMetadataRefreshPlan?.overall || "N/A"} noSource=${guardMetadataRefreshPlan?.summary?.noRefreshSource ?? "N/A"} lineage=${guardMetadataLineageAudit?.overall || "N/A"} lineageMissing=${guardMetadataLineageAudit?.summary?.missingNoSource ?? "N/A"}`,
      nextAction: missingGuardRows.length || missingLineageRows.length
        ? "Trace missing stop/target lineage through recommendation ledger, Stage6 loop, order ledger, and fillability state."
        : "No missing guard metadata lane action required.",
      safety: "report_only_no_broker_or_state_mutation"
    }),
    lane({
      id: "track_2_guard_metadata_stale",
      name: "Guard Metadata Stale Lane",
      status: staleGuardRows.length || staleLineageRows.length ? "waiting_fresh_guard_source" : "clear",
      symbols: uniqueSymbols([...staleGuardRows, ...staleLineageRows]),
      evidence: `guardRefresh=${guardMetadataRefreshPlan?.overall || "N/A"} staleSource=${guardMetadataRefreshPlan?.summary?.staleRefreshSource ?? "N/A"} lineage=${guardMetadataLineageAudit?.overall || "N/A"} lineageStale=${guardMetadataLineageAudit?.summary?.staleSourceOnly ?? "N/A"}`,
      nextAction: staleGuardRows.length || staleLineageRows.length
        ? "Wait for fresh Stage6/position-lifecycle/order-ledger source before repair re-evaluation."
        : "No stale guard metadata lane action required.",
      safety: "report_only_no_broker_or_state_mutation"
    }),
    lane({
      id: "track_3_broker_children_present_monitor",
      name: "Broker Children Present Monitor Lane",
      status: brokerChildrenPresentRows.length ? "monitor_only" : "no_current_rows",
      symbols: uniqueSymbols(brokerChildrenPresentRows),
      evidence: `brokerChildrenSourceReady=${guardMetadataRefreshPlan?.summary?.brokerChildrenSourceReady ?? "N/A"}`,
      nextAction: "Continue GET-only nested visibility monitoring; do not create duplicate OCO children.",
      safety: "get_only_monitor_no_broker_mutation"
    }),
    lane({
      id: "track_4_valid_guard_missing_child_repair_candidate",
      name: "Valid Guard + Missing Child Repair Candidate Lane",
      status:
        repairAfterRefreshRows.length || persistentEligibleRows.length
          ? "manual_approval_candidate"
          : brokerMissingRows.length
            ? "blocked_until_guard_refresh_valid"
            : "no_candidate",
      count: repairAfterRefreshRows.length || persistentEligibleRows.length || brokerMissingRows.length,
      symbols: uniqueSymbols([...repairAfterRefreshRows, ...persistentEligibleRows, ...brokerMissingRows]),
      evidence: `repairAfterRefresh=${guardMetadataRefreshPlan?.summary?.repairReevaluationCandidates ?? "N/A"} persistentEligible=${persistentOcoRepairPlan?.summary?.eligible ?? "N/A"} brokerChildActions=${brokerChildReconciliation?.summary?.proposedActionRows ?? "N/A"}`,
      nextAction:
        repairAfterRefreshRows.length || persistentEligibleRows.length
          ? "Require separate approval before any paper repair submit."
          : "Do not submit repair until guard metadata is fresh and geometry-valid.",
      safety: "approval_required_for_any_broker_mutation"
    }),
    lane({
      id: "track_5_invalid_geometry_root_cause",
      name: "Invalid Geometry Root-Cause Lane",
      status: invalidGuardRows.length || invalidProtectionRows.length || invalidLineageRows.length ? "root_cause_required" : "clear",
      count: invalidGuardRows.length + invalidProtectionRows.length + invalidLineageRows.length,
      symbols: uniqueSymbols([...invalidGuardRows, ...invalidProtectionRows, ...invalidLineageRows]),
      evidence: `guardInvalid=${guardMetadataRefreshPlan?.summary?.invalidRefreshGeometry ?? "N/A"} protectionInvalid=${positionProtectionAudit?.summary?.invalidGeometry ?? "N/A"} lineageInvalid=${guardMetadataLineageAudit?.summary?.invalidGeometry ?? "N/A"} stopDrift=${positionProtectionAudit?.summary?.stopCurrentDrift ?? "N/A"}`,
      nextAction:
        invalidGuardRows.length || invalidProtectionRows.length || invalidLineageRows.length
          ? "Route to Stage6/guard metadata drift analysis; broker repair is blocked."
          : "No invalid geometry lane action required.",
      safety: "repair_blocked_when_geometry_invalid"
    }),
    lane({
      id: "track_6_open_order_risk_capped_reprice",
      name: "Open Order Risk-Capped Reprice Lane",
      status:
        openOrderRepriceProposal?.overall === "no_open_orders"
          ? "no_open_orders"
          : openRepriceReadyRows.length
            ? "manual_replace_approval_candidate"
            : openOrderRepriceProposal?.overall || "unknown",
      count: repriceRows.length,
      symbols: uniqueSymbols(repriceRows),
      evidence: `overall=${openOrderRepriceProposal?.overall || "N/A"} rows=${openOrderRepriceProposal?.summary?.rows ?? "N/A"} ready=${openOrderRepriceProposal?.summary?.readyForApproval ?? "N/A"} riskBreaches=${openOrderRepriceProposal?.summary?.suggestedRiskCapBreaches ?? "N/A"} attempted=${openOrderRepriceProposal?.summary?.brokerMutationAttempted ?? "N/A"} submitted=${openOrderRepriceProposal?.summary?.brokerMutationSubmitted ?? "N/A"}`,
      nextAction: openRepriceReadyRows.length
        ? "Require separate approval before any guarded replace."
        : "Keep report-only monitoring until an open order exists and passes risk-capped policy.",
      safety: "report_only_no_replace_or_cancel"
    }),
    lane({
      id: "track_7_new_order_fillability_submit_path",
      name: "New Order / Fillability / Submit Path Lane",
      status:
        payloadCount > 0
          ? brokerSubmitted > 0
            ? "submitted"
            : brokerAttempted > 0
              ? "attempted_not_submitted"
              : "payload_ready_not_submitted"
          : minOneShareSelectedSymbol
            ? "safe_min_one_share_payload_probe_candidate"
            : highPriceSkippedRows.length
              ? "blocked_high_price_sizing"
            : "blocked_before_payload",
      count: orderDecisionRecords.length,
      symbols: uniqueSymbols(orderDecisionRecords),
      evidence: `payloads=${payloadCount} skipped=${preview?.skippedCount ?? "N/A"} brokerAttempted=${brokerAttempted} brokerSubmitted=${brokerSubmitted} readiness=${short(preview?.orderReadiness, 240)} highPriceSkipped=${highPriceSkippedRows.length} minOneShareEligible=${minOneShareEligible} selected=${minOneShareSelectedSymbol || "N/A"} fillability=${fillability?.summary?.overall || "N/A"}`,
      nextAction:
        payloadCount > 0
          ? "Verify preflight/idempotency/broker visibility according to approval scope."
          : minOneShareSelectedSymbol
            ? "Run safe dry-run min_one_share admission probe only; keep broker mutation disabled and verify payload generation."
            : highPriceSkippedRows.length
              ? "Review high-price sizing policy/min-one-share constraints before tuning entry logic."
            : "Route to orderReadiness/topSkip/fillability blocker classification.",
      safety: "safe_default_keeps_broker_submission_disabled_unless_approved"
    })
  ];

  const unsafe = lanes.some((row) => row.status === "submitted" || row.status === "attempted_not_submitted");
  const blockedCount = lanes.filter((row) => String(row.status).startsWith("blocked") || row.status.includes("required")).length;
  const manualApprovalCandidates = lanes.filter((row) => row.status.includes("approval_candidate")).length;
  const report = {
    generatedAt: new Date().toISOString(),
    overall: unsafe ? "review_broker_activity" : blockedCount ? "blocked_lanes_present" : "monitoring",
    scope: "symbol_agnostic_status_lane_team_report",
    files: Object.fromEntries(Object.entries(FILES).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    source: {
      stage6Hash: preview?.stage6Hash || null,
      stage6File: preview?.stage6File || null,
      opsHealthOverall: opsHealth?.overall || null
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: false,
      stateMutationAttempted: false
    },
    summary: {
      lanes: lanes.length,
      blockedCount,
      manualApprovalCandidates,
      reportOnly: true,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false
    },
    lanes
  };
  return report;
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ops Lane Status Report");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(
    `- summary: \`lanes=${report.summary.lanes} blocked=${report.summary.blockedCount} manualApprovalCandidates=${report.summary.manualApprovalCandidates} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted}\``
  );
  lines.push("- safety: `report-only; symbol-agnostic; no broker mutation; no state mutation`");
  lines.push("| Track | Lane | Status | Count | Symbols | Next Action |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const row of report.lanes) {
    lines.push(
      `| ${row.id} | ${row.name} | ${row.status} | ${row.count} | ${row.symbols.join(",") || "none"} | ${row.nextAction} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  const report = buildReport();
  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[OPS_LANE_STATUS] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} lanes=${report.summary.lanes} blocked=${report.summary.blockedCount} manualApprovalCandidates=${report.summary.manualApprovalCandidates} attempted=false submitted=false`
  );
};

main();
