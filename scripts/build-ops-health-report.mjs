import fs from "node:fs";

const STATE_DIR = String(process.env.OPS_HEALTH_STATE_DIR || "state").trim() || "state";
const OUTPUT_JSON = `${STATE_DIR}/ops-health-report.json`;
const OUTPUT_MD = `${STATE_DIR}/ops-health-report.md`;

const FILES = {
  preview: `${STATE_DIR}/last-dry-exec-preview.json`,
  guard: `${STATE_DIR}/last-market-guard.json`,
  guardControl: `${STATE_DIR}/guard-control.json`,
  perf: `${STATE_DIR}/performance-dashboard.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  markerAudit: `${STATE_DIR}/hf-marker-audit.json`
};

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

const toIso = (value) => {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
};

const short = (value, max = 120) => String(value ?? "").trim().slice(0, max);

const parseProgress = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const required = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(required) || required <= 0) return null;
  return { current, required };
};

const parseMarkerMissingKeys = (markerAudit) => {
  if (!markerAudit || typeof markerAudit !== "object") return [];
  const runEvent = String(markerAudit.runEvent || "").trim().toLowerCase();
  const ignoreDedupe = runEvent === "dedupe";
  const keys = [];
  for (const [key, raw] of Object.entries(markerAudit)) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    if (value === "missing") {
      keys.push(key);
      continue;
    }
    if (!ignoreDedupe && value.startsWith("n/a")) {
      keys.push(key);
    }
  }
  return keys.sort();
};

const determineKind = (explicit, preview, guard) => {
  const value = String(explicit || "").trim().toLowerCase();
  if (value === "dry_run" || value === "market_guard") return value;
  if (guard) return "market_guard";
  if (preview) return "dry_run";
  return "unknown";
};

const addCheck = (checks, status, id, detail) => {
  checks.push({
    id,
    status,
    detail: short(detail, 320)
  });
};

const fmt = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Sidecar Ops Health");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- kind: \`${report.kind}\``);
  lines.push(`- overall: \`${report.overall.toUpperCase()}\``);
  lines.push(
    `- files: \`preview=${report.files.preview ? "ok" : "missing"} guard=${report.files.guard ? "ok" : "missing"} guardControl=${report.files.guardControl ? "ok" : "missing"} perf=${report.files.perf ? "ok" : "missing"} fillability=${report.files.fillability ? "ok" : "missing"} markerAudit=${report.files.markerAudit ? "ok" : "missing"}\``
  );
  lines.push(
    `- key_metrics: \`stage6Hash=${report.metrics.stage6Hash || "N/A"} payloads/skipped=${report.metrics.payloadCount ?? "N/A"}/${report.metrics.skippedCount ?? "N/A"} perfGate=${report.metrics.perfGateProgress || "N/A"} simRows=${report.metrics.simulationRows ?? "N/A"} simSnapshot=${report.metrics.simulationSnapshotTrades ?? "N/A"} simGap=${report.metrics.simulationRowSnapshotGap ?? "N/A"} fillability=${report.metrics.fillabilityOverall ?? "N/A"} fills=${report.metrics.fillabilityFills ?? "N/A"} repricedWaiting=${report.metrics.fillabilityRepricedWaiting ?? "N/A"} openReprice=${report.metrics.fillabilityOpenReprice ?? "N/A"} openCancel=${report.metrics.fillabilityOpenCancel ?? "N/A"} entryTooFar=${report.metrics.fillabilityEntryTooFar ?? "N/A"} highPriceSize=${report.metrics.fillabilityHighPriceSize ?? "N/A"} hfAlert=${report.metrics.hfAlertTriggered ?? "N/A"} guardLevel=${report.metrics.guardLevel ?? "N/A"} haltNewEntries=${report.metrics.haltNewEntries ?? "N/A"} liveAvailable=${report.metrics.liveAvailable ?? "N/A"} liveReturnPct=${fmt(report.metrics.liveReturnPct)} brokerStopMissing=${report.metrics.liveBrokerStopMissingCount ?? "N/A"} brokerTargetMissing=${report.metrics.liveBrokerTargetMissingCount ?? "N/A"} liveGuardMissing=${report.metrics.liveGuardMissingCount ?? "N/A"} liveFillMismatch=${report.metrics.liveFillStateMismatchCount ?? "N/A"}\``
  );
  if (report.metrics.livePositionDetails) {
    lines.push(`- live_position_monitor: \`${report.metrics.livePositionDetails}\``);
  }
  if (report.metrics.hfAlertReason) {
    lines.push(`- hf_alert_reason: \`${report.metrics.hfAlertReason}\``);
  }
  lines.push("- checks:");
  for (const row of report.checks) {
    lines.push(`  - [${row.status.toUpperCase()}] ${row.id}: ${row.detail}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const preview = readJson(FILES.preview);
  const guard = readJson(FILES.guard);
  const guardControl = readJson(FILES.guardControl);
  const perf = readJson(FILES.perf);
  const fillability = readJson(FILES.fillability);
  const markerAudit = readJson(FILES.markerAudit);

  const kind = determineKind(process.env.OPS_HEALTH_KIND, preview, guard);
  const checks = [];

  if (kind === "dry_run" && !preview) {
    addCheck(checks, "fail", "dry_preview_missing", "state/last-dry-exec-preview.json not found");
  }
  if (kind === "market_guard" && !guard) {
    addCheck(checks, "fail", "guard_summary_missing", "state/last-market-guard.json not found");
  }
  if (!perf) {
    addCheck(checks, "warn", "perf_dashboard_missing", "state/performance-dashboard.json not found");
  }
  if (!fillability) {
    addCheck(checks, "warn", "fillability_report_missing", "state/fillability-report.json not found");
  }

  const payloadCount = toNum(preview?.payloadCount);
  const skippedCount = toNum(preview?.skippedCount);
  const stage6Hash = short(preview?.stage6Hash || "", 12) || null;
  const perfGateProgress =
    short(preview?.hfTuningPhase?.gateProgress || preview?.hfNextAction?.gateProgress || "", 32) || null;
  const tuningGateProgress = short(preview?.hfTuningPhase?.gateProgress || "", 32) || null;
  const nextActionGateProgress = short(preview?.hfNextAction?.gateProgress || "", 32) || null;
  const dailyVerdictGateProgress = short(preview?.hfDailyVerdict?.gateProgress || "", 32) || null;
  const perfGateParsed = parseProgress(perfGateProgress);
  const perfGateRemainingTrades = toNum(
    preview?.hfTuningPhase?.gateRemainingTrades ?? preview?.hfNextAction?.gateRemainingTrades
  );
  const tuningGateRemaining = toNum(preview?.hfTuningPhase?.gateRemainingTrades);
  const nextActionGateRemaining = toNum(preview?.hfNextAction?.gateRemainingTrades);
  const dailyVerdictGateRemaining = toNum(preview?.hfDailyVerdict?.gateRemainingTrades);
  const perfGateRemainingComputed =
    perfGateParsed != null ? Math.max(perfGateParsed.required - perfGateParsed.current, 0) : null;
  const hfAlertTriggered = preview?.hfAlert?.triggered;
  const hfAlertReason = short(preview?.hfAlert?.reason || "", 120) || null;
  const simulationRows = toNum(perf?.simulation?.totalRows);
  const simulationSnapshotTrades = toNum(perf?.simulation?.latestSnapshotTradeCount);
  const simulationRowSnapshotGap = toNum(perf?.simulation?.rowVsSnapshotGap);
  const simulationSnapshotCoveragePct = toNum(perf?.simulation?.snapshotCoveragePct);
  const fillabilityOverall = short(fillability?.summary?.overall || "", 32) || null;
  const fillabilityFills = toNum(fillability?.summary?.fillActivityCount);
  const fillabilityRepricedWaiting = toNum(fillability?.summary?.openRepricedWaiting);
  const fillabilityOpenReprice = toNum(fillability?.summary?.openReprice);
  const fillabilityOpenCancel = toNum(fillability?.summary?.openCancel);
  const fillabilityEntryTooFar = toNum(fillability?.summary?.entryTooFar);
  const fillabilityHighPriceSize = toNum(fillability?.summary?.highPriceSizeBlocked);

  if (fillabilityOverall === "warn") {
    addCheck(
      checks,
      "warn",
      "fillability_warn",
      short((fillability?.summary?.findings || []).join("; ") || "fillability report returned warn", 320)
    );
  }

  if (fillabilityEntryTooFar != null && fillabilityEntryTooFar > 0) {
    addCheck(
      checks,
      "warn",
      "entry_distance_block",
      `${fillabilityEntryTooFar} candidate(s) exceeded entry-distance policy; route to Stage6 entry/OTE calibration, not broker-submit debugging`
    );
  }

  if (fillabilityHighPriceSize != null && fillabilityHighPriceSize > 0) {
    addCheck(
      checks,
      "warn",
      "high_price_size_block",
      `${fillabilityHighPriceSize} candidate(s) exceeded fixed notional sizing; review min_one_share cap/risk settings before enabling higher-price entries`
    );
  }

  if (perfGateParsed && simulationRows != null && perfGateParsed.current !== simulationRows) {
    addCheck(
      checks,
      "warn",
      "perf_gate_progress_mismatch",
      `gateProgress current=${perfGateParsed.current} but simulation totalRows=${simulationRows}; run summary/dashboard may be out of sync`
    );
  }

  const progressPairs = [
    ["hfTuningPhase", tuningGateProgress],
    ["hfNextAction", nextActionGateProgress],
    ["hfDailyVerdict", dailyVerdictGateProgress]
  ].filter(([, value]) => value);
  const uniqueProgress = Array.from(new Set(progressPairs.map(([, value]) => String(value))));
  if (uniqueProgress.length > 1) {
    addCheck(
      checks,
      "warn",
      "gate_progress_source_mismatch",
      progressPairs.map(([source, value]) => `${source}:${value}`).join(", ")
    );
  }

  const remainingPairs = [
    ["hfTuningPhase", tuningGateRemaining],
    ["hfNextAction", nextActionGateRemaining],
    ["hfDailyVerdict", dailyVerdictGateRemaining]
  ].filter(([, value]) => value != null);
  const uniqueRemaining = Array.from(new Set(remainingPairs.map(([, value]) => Number(value))));
  if (uniqueRemaining.length > 1) {
    addCheck(
      checks,
      "warn",
      "gate_remaining_source_mismatch",
      remainingPairs.map(([source, value]) => `${source}:${value}`).join(", ")
    );
  }

  if (
    perfGateParsed &&
    perfGateRemainingTrades != null &&
    perfGateRemainingComputed != null &&
    perfGateRemainingTrades !== perfGateRemainingComputed
  ) {
    addCheck(
      checks,
      "warn",
      "perf_gate_remaining_mismatch",
      `gateRemainingTrades=${perfGateRemainingTrades} but computed=${perfGateRemainingComputed} from progress=${perfGateProgress}`
    );
  }

  const observedTrades = toNum(preview?.hfTuningPhase?.observedTrades);
  const requiredTrades = toNum(preview?.hfTuningPhase?.requiredTrades);
  if (perfGateParsed && observedTrades != null && observedTrades !== perfGateParsed.current) {
    addCheck(
      checks,
      "warn",
      "tuning_observed_trades_mismatch",
      `hfTuningPhase.observedTrades=${observedTrades} but gateProgress current=${perfGateParsed.current}`
    );
  }
  if (perfGateParsed && requiredTrades != null && requiredTrades !== perfGateParsed.required) {
    addCheck(
      checks,
      "warn",
      "tuning_required_trades_mismatch",
      `hfTuningPhase.requiredTrades=${requiredTrades} but gateProgress required=${perfGateParsed.required}`
    );
  }

  if (simulationRowSnapshotGap != null && simulationRowSnapshotGap >= 5) {
    addCheck(
      checks,
      "warn",
      "simulation_snapshot_lag",
      `simulation row/snapshot gap is ${simulationRowSnapshotGap} (coverage=${fmt(simulationSnapshotCoveragePct)}%); snapshot refresh may lag`
    );
  }

  if (hfAlertTriggered === true) {
    addCheck(
      checks,
      "warn",
      "hf_alert_triggered",
      `HF alert is active${hfAlertReason ? ` (${hfAlertReason})` : ""}; keep observe mode until cleared`
    );
  }

  const markerMissing = parseMarkerMissingKeys(markerAudit || preview?.hfMarkerAudit);
  if (markerMissing.length > 0) {
    addCheck(
      checks,
      "warn",
      "hf_marker_audit_gap",
      `marker status missing/non-applicable on keys: ${markerMissing.slice(0, 8).join(", ")}`
    );
  }

  const guardLevel = toNum(guard?.level);
  const haltNewEntries =
    typeof guardControl?.haltNewEntries === "boolean" ? guardControl.haltNewEntries : null;
  if (kind === "market_guard" && guard && guardLevel == null) {
    addCheck(checks, "warn", "guard_level_unknown", "market guard summary has no numeric level");
  }

  const liveAvailable =
    typeof perf?.live?.available === "boolean" ? perf.live.available : null;
  const liveReturnPct = toNum(perf?.live?.totals?.totalReturnPct);
  const liveBrokerStopMissingCount = toNum(perf?.live?.totals?.brokerStopMissingCount);
  const liveBrokerTargetMissingCount = toNum(perf?.live?.totals?.brokerTargetMissingCount);
  const liveGuardMissingCount = toNum(perf?.live?.totals?.guardMissingCount);
  const liveFillStateMismatchCount = toNum(perf?.live?.totals?.fillStateMismatchCount);
  const livePositionDetails = Array.isArray(perf?.live?.positions)
    ? perf.live.positions
      .slice(0, 10)
      .map((row) => {
        const symbol = short(row?.symbol || "N/A", 16).toUpperCase();
        return `${symbol}:tp=${fmt(toNum(row?.targetPrice))},sl=${fmt(toNum(row?.stopPrice))},uPnL=${fmt(toNum(row?.unrealizedPl))},status=${short(row?.positionStatus || "N/A", 48)},fill=${short(row?.normalizedFillState || "N/A", 32)}`;
      })
      .join("; ")
    : "";
  if (liveReturnPct != null && Math.abs(liveReturnPct) > 200) {
    addCheck(
      checks,
      "warn",
      "live_return_outlier",
      `live return looks extreme (${fmt(liveReturnPct)}%); verify percent scaling`
    );
  }

  if (liveBrokerStopMissingCount != null && liveBrokerStopMissingCount > 0) {
    addCheck(
      checks,
      "fail",
      "broker_stop_child_missing",
      `CRITICAL OBSERVE-ONLY: ${liveBrokerStopMissingCount} held position(s) have planned stop metadata but no broker-side stop child found via Alpaca open orders nested=true`
    );
  }

  if (liveBrokerTargetMissingCount != null && liveBrokerTargetMissingCount > 0) {
    addCheck(
      checks,
      "warn",
      "broker_target_child_missing",
      `${liveBrokerTargetMissingCount} held position(s) have planned target metadata but no broker-side target child found via Alpaca open orders nested=true`
    );
  }

  if (liveGuardMissingCount != null && liveGuardMissingCount > 0) {
    addCheck(
      checks,
      "warn",
      "live_position_guard_missing",
      `${liveGuardMissingCount} held position(s) missing stop/target guard metadata in performance dashboard`
    );
  }

  if (liveFillStateMismatchCount != null && liveFillStateMismatchCount > 0) {
    addCheck(
      checks,
      "warn",
      "live_fill_state_mismatch",
      `${liveFillStateMismatchCount} held position(s) disagree across order-ledger/idempotency/fillability state`
    );
  }

  if (checks.length === 0) {
    addCheck(checks, "pass", "pipeline_health", "no immediate blocker found");
  }

  const overall = checks.some((row) => row.status === "fail")
    ? "fail"
    : checks.some((row) => row.status === "warn")
      ? "warn"
      : "pass";

  const report = {
    generatedAt: toIso(Date.now()),
    kind,
    overall,
    files: {
      preview: Boolean(preview),
      guard: Boolean(guard),
      guardControl: Boolean(guardControl),
      perf: Boolean(perf),
      fillability: Boolean(fillability),
      markerAudit: Boolean(markerAudit || preview?.hfMarkerAudit)
    },
    metrics: {
      stage6Hash,
      payloadCount,
      skippedCount,
      perfGateProgress,
      perfGateCurrentTrades: perfGateParsed?.current ?? null,
      perfGateRequiredTrades: perfGateParsed?.required ?? null,
      perfGateRemainingTrades,
      perfGateRemainingComputed,
      hfAlertTriggered: typeof hfAlertTriggered === "boolean" ? hfAlertTriggered : null,
      hfAlertReason,
      simulationRows,
      simulationSnapshotTrades,
      simulationRowSnapshotGap,
      simulationSnapshotCoveragePct,
      fillabilityOverall,
      fillabilityFills,
      fillabilityRepricedWaiting,
      fillabilityOpenReprice,
      fillabilityOpenCancel,
      fillabilityEntryTooFar,
      fillabilityHighPriceSize,
      guardLevel,
      haltNewEntries,
      liveAvailable,
      liveReturnPct,
      liveBrokerStopMissingCount,
      liveBrokerTargetMissingCount,
      liveGuardMissingCount,
      liveFillStateMismatchCount,
      livePositionDetails: short(livePositionDetails, 1800) || null
    },
    checks
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");

  console.log(
    `[OPS_HEALTH] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} checks=${checks.length}`
  );
};

main();
