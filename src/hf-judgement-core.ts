export type PerfGateStatus = "PENDING_SAMPLE" | "GO" | "NO_GO";
export type HfFreezeStatus = "DISABLED" | "OBSERVE" | "CANDIDATE" | "FROZEN" | "UNFREEZE_REVIEW";
export type HfPayloadProbeMode = "off" | "tighten" | "relief";
export type HfLivePromotionStatus = "BLOCK" | "HOLD" | "PASS";
export type HfTuningPhase = "OBSERVE_ONLY" | "REVIEW_ONLY" | "FREEZE_READY";
export type HfTuningAdviceStatus = "HOLD" | "ADJUST" | "FREEZE";

export type HfLivePromotionPolicyCore = {
  requirePerfGateGo: boolean;
  requireFreezeFrozen: boolean;
  requireShadowStable: boolean;
  requirePayloadPathVerified: boolean;
};

export type HfLivePromotionSummaryCore = {
  status: HfLivePromotionStatus;
  reason: string;
  recommendation: string;
  payloadPathSource: "none" | "current_live" | "current_probe" | "sticky";
  payloadPathVerifiedAt: string | null;
  policy: HfLivePromotionPolicyCore;
  checks: {
    perfGateGo: boolean;
    freezeFrozen: boolean;
    alertClear: boolean;
    shadowStable: boolean;
    payloadPathVerified: boolean;
    probeActive: boolean;
    probeMode: HfPayloadProbeMode;
  };
  requiredPass: number;
  requiredTotal: number;
  requiredMissing: string[];
  requiredHintToken: string;
  requiredHintText: string;
  checklistPass: number;
  checklistTotal: number;
  generatedAt: string;
};

export type HfTuningPhaseSummaryCore = {
  phase: HfTuningPhase;
  reason: string;
  recommendation: string;
  gateStatus: PerfGateStatus;
  gateProgress: string;
  gateRemainingTrades: number;
  gateProgressPct: number;
  observedTrades: number;
  requiredTrades: number;
  alertTriggered: boolean;
  shadowAlertRate: number;
  generatedAt: string;
};

export type HfTuningAdviceCore = {
  status: HfTuningAdviceStatus;
  action: string;
  variable: string | null;
  currentValue: number | null;
  suggestedValue: number | null;
  reason: string;
  confidence: "low" | "medium" | "high";
  generatedAt: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function describeHfLivePromotionRequiredMissingCore(requiredMissing: string[]): {
  token: string;
  text: string;
} {
  if (!requiredMissing.length) {
    return { token: "none", text: "none" };
  }

  const tokenByKey: Record<string, string> = {
    alertClear: "clear_hf_alert",
    perfGateGo: "wait_perf_gate_go",
    freezeFrozen: "wait_freeze_frozen",
    shadowStable: "stabilize_shadow_trend",
    payloadPathVerified: "verify_payload_path"
  };
  const textByKey: Record<string, string> = {
    alertClear: "clear HF alert first",
    perfGateGo: "wait for perf gate GO",
    freezeFrozen: "wait for HF freeze status FROZEN",
    shadowStable: "collect stable shadow trend",
    payloadPathVerified: "verify payload path via probe/live payload"
  };

  const normalized = Array.from(new Set(requiredMissing.filter((key) => key && key !== "none")));
  if (!normalized.length) {
    return { token: "none", text: "none" };
  }

  const token = normalized.map((key) => tokenByKey[key] ?? `check_${key}`).join("+");
  const text = normalized.map((key) => textByKey[key] ?? `check ${key}`).join("; ");
  return { token, text };
}

export function deriveHfLivePromotionSummaryCore(input: {
  perfGate: { status: PerfGateStatus; reason: string };
  freeze: { enabled: boolean; status: HfFreezeStatus; reason: string; maxShadowAlertRate: number };
  alert: { triggered: boolean; reason: string } | null;
  shadowTrend: { comparedRuns: number; alertTriggeredRate: number } | null;
  payloadProbe: { active: boolean; requestedMode: HfPayloadProbeMode };
  payloadPath: {
    payloadPathVerified: boolean;
    payloadPathSource: "none" | "current_live" | "current_probe" | "sticky";
    payloadPathVerifiedAt: string | null;
  };
  policy: HfLivePromotionPolicyCore;
  now?: string;
}): HfLivePromotionSummaryCore {
  const alertClear = !Boolean(input.alert?.triggered);
  const perfGateGo = input.perfGate.status === "GO";
  const freezeFrozen = input.freeze.enabled && input.freeze.status === "FROZEN";
  const shadowComparedRuns = Number(input.shadowTrend?.comparedRuns ?? 0);
  const shadowAlertRate = Number(input.shadowTrend?.alertTriggeredRate ?? 1);
  const shadowStable = shadowComparedRuns >= 3 && shadowAlertRate <= input.freeze.maxShadowAlertRate;
  const payloadPathVerified = input.payloadPath.payloadPathVerified;
  const checks = {
    perfGateGo,
    freezeFrozen,
    alertClear,
    shadowStable,
    payloadPathVerified,
    probeActive: input.payloadProbe.active,
    probeMode: input.payloadProbe.requestedMode
  };

  const requiredChecks: Array<{ key: string; enabled: boolean; pass: boolean }> = [
    { key: "alertClear", enabled: true, pass: checks.alertClear },
    { key: "perfGateGo", enabled: input.policy.requirePerfGateGo, pass: checks.perfGateGo },
    { key: "freezeFrozen", enabled: input.policy.requireFreezeFrozen, pass: checks.freezeFrozen },
    { key: "shadowStable", enabled: input.policy.requireShadowStable, pass: checks.shadowStable },
    {
      key: "payloadPathVerified",
      enabled: input.policy.requirePayloadPathVerified,
      pass: checks.payloadPathVerified
    }
  ];
  const requiredTotal = requiredChecks.filter((row) => row.enabled).length;
  const requiredPass = requiredChecks.filter((row) => row.enabled && row.pass).length;
  const requiredMissing = requiredChecks.filter((row) => row.enabled && !row.pass).map((row) => row.key);
  const requiredHint = describeHfLivePromotionRequiredMissingCore(requiredMissing);

  const checklistItems = [
    checks.perfGateGo,
    checks.freezeFrozen,
    checks.alertClear,
    checks.shadowStable,
    checks.payloadPathVerified
  ];
  const checklistPass = checklistItems.filter(Boolean).length;
  const checklistTotal = checklistItems.length;

  let status: HfLivePromotionStatus = "HOLD";
  let reason = "checklist_pending";
  let recommendation = "collect_more_evidence";

  if (!checks.alertClear) {
    status = "BLOCK";
    reason = `hf_alert_triggered(${input.alert?.reason ?? "unknown"})`;
    recommendation = "resolve_hf_alert_before_live";
  } else if (input.policy.requirePerfGateGo && input.perfGate.status === "NO_GO") {
    status = "BLOCK";
    reason = `perf_gate_no_go(${input.perfGate.reason})`;
    recommendation = "improve_perf_loop_metrics";
  } else if (input.freeze.status === "UNFREEZE_REVIEW") {
    status = "BLOCK";
    reason = `freeze_unstable(${input.freeze.reason})`;
    recommendation = "review_unfreeze_thresholds";
  } else if (requiredPass === requiredTotal) {
    status = "PASS";
    reason = "all_required_live_promotion_checks_passed";
    recommendation = "ready_for_live_promotion_review";
  } else if (input.policy.requirePerfGateGo && !checks.perfGateGo) {
    reason = `perf_gate_${String(input.perfGate.status || "unknown").toLowerCase()}`;
    recommendation = "wait_for_perf_gate_go";
  } else if (input.policy.requireFreezeFrozen && !checks.freezeFrozen) {
    reason = `freeze_status_${String(input.freeze.status || "unknown").toLowerCase()}`;
    recommendation = "wait_for_frozen_baseline";
  } else if (input.policy.requireShadowStable && !checks.shadowStable) {
    reason =
      shadowComparedRuns < 3
        ? `shadow_history_insufficient(compared=${shadowComparedRuns})`
        : `shadow_alert_rate_high(${shadowAlertRate.toFixed(4)}>${input.freeze.maxShadowAlertRate.toFixed(4)})`;
    recommendation = "stabilize_shadow_trend";
  } else if (input.policy.requirePayloadPathVerified && !checks.payloadPathVerified) {
    reason = "payload_path_unverified";
    recommendation = "run_payload_probe_or_wait_payload";
  }

  return {
    status,
    reason,
    recommendation,
    payloadPathSource: input.payloadPath.payloadPathSource,
    payloadPathVerifiedAt: input.payloadPath.payloadPathVerifiedAt,
    policy: input.policy,
    checks,
    requiredPass,
    requiredTotal,
    requiredMissing,
    requiredHintToken: requiredHint.token,
    requiredHintText: requiredHint.text,
    checklistPass,
    checklistTotal,
    generatedAt: input.now ?? new Date().toISOString()
  };
}

export function deriveHfTuningPhaseCore(input: {
  perfGate: { status: PerfGateStatus; progress: string };
  tradeCount: number;
  alert: { triggered: boolean; reason: string } | null;
  shadowTrend: { alertTriggeredRate: number } | null;
  requiredTrades?: number;
  now?: string;
}): HfTuningPhaseSummaryCore {
  const requiredTrades = input.requiredTrades ?? 20;
  const observedTrades = Number.isFinite(input.tradeCount) ? input.tradeCount : 0;
  const shadowAlertRate = input.shadowTrend?.alertTriggeredRate ?? 0;
  const alertTriggered = Boolean(input.alert?.triggered);

  let phase: HfTuningPhase = "OBSERVE_ONLY";
  let reason = "sample_insufficient";
  let recommendation = "collect_more_runs";

  if (observedTrades < requiredTrades || input.perfGate.status === "PENDING_SAMPLE") {
    phase = "OBSERVE_ONLY";
    reason = `sample_insufficient(${observedTrades}/${requiredTrades})`;
    recommendation = "observe_and_accumulate";
  } else if (alertTriggered) {
    phase = "REVIEW_ONLY";
    reason = `hf_alert_triggered(${input.alert?.reason ?? "unknown"})`;
    recommendation = "review_thresholds_before_freeze";
  } else if (shadowAlertRate >= 0.3) {
    phase = "REVIEW_ONLY";
    reason = `shadow_alert_rate_high(${shadowAlertRate.toFixed(4)})`;
    recommendation = "stabilize_shadow_deltas";
  } else if (input.perfGate.status === "GO") {
    phase = "FREEZE_READY";
    reason = "perf_gate_go_and_hf_stable";
    recommendation = "freeze_baseline_and_monitor";
  } else {
    phase = "REVIEW_ONLY";
    reason = `perf_gate_${input.perfGate.status.toLowerCase()}`;
    recommendation = "tune_and_retest";
  }

  const progressPct = Number(clamp((Math.min(observedTrades, requiredTrades) / requiredTrades) * 100, 0, 100).toFixed(1));

  return {
    phase,
    reason,
    recommendation,
    gateStatus: input.perfGate.status,
    gateProgress: input.perfGate.progress,
    gateRemainingTrades: Math.max(0, requiredTrades - observedTrades),
    gateProgressPct: progressPct,
    observedTrades,
    requiredTrades,
    alertTriggered,
    shadowAlertRate,
    generatedAt: input.now ?? new Date().toISOString()
  };
}

export function deriveHfTuningAdviceCore(input: {
  tuningPhase: { phase: HfTuningPhase; reason: string };
  hfSentimentGate: {
    explainLine: string;
    scoreFloor: number;
    minArticleCount: number;
    maxNewsAgeHours: number;
  };
  now?: string;
}): HfTuningAdviceCore {
  const explain = input.hfSentimentGate.explainLine || "n/a";
  const baseFloor = input.hfSentimentGate.scoreFloor;
  const baseMinArticles = input.hfSentimentGate.minArticleCount;
  const baseMaxNewsAge = input.hfSentimentGate.maxNewsAgeHours;

  if (input.tuningPhase.phase === "OBSERVE_ONLY") {
    return {
      status: "HOLD",
      action: "collect_more_runs",
      variable: null,
      currentValue: null,
      suggestedValue: null,
      reason: input.tuningPhase.reason,
      confidence: "high",
      generatedAt: input.now ?? new Date().toISOString()
    };
  }

  if (input.tuningPhase.phase === "FREEZE_READY") {
    return {
      status: "FREEZE",
      action: "freeze_baseline",
      variable: null,
      currentValue: null,
      suggestedValue: null,
      reason: input.tuningPhase.reason,
      confidence: "high",
      generatedAt: input.now ?? new Date().toISOString()
    };
  }

  if (explain.includes("lowArticleCount")) {
    const suggested = Math.max(1, baseMinArticles - 1);
    return {
      status: "ADJUST",
      action: "relax_min_article_count",
      variable: "HF_SENTIMENT_MIN_ARTICLE_COUNT",
      currentValue: baseMinArticles,
      suggestedValue: suggested,
      reason: "coverage_low_from_article_count_gate",
      confidence: "medium",
      generatedAt: input.now ?? new Date().toISOString()
    };
  }

  if (explain.includes("stale")) {
    const suggested = Math.min(72, baseMaxNewsAge + 6);
    return {
      status: "ADJUST",
      action: "relax_news_recency_window",
      variable: "HF_SENTIMENT_MAX_NEWS_AGE_HOURS",
      currentValue: baseMaxNewsAge,
      suggestedValue: suggested,
      reason: "coverage_low_from_stale_news_gate",
      confidence: "medium",
      generatedAt: input.now ?? new Date().toISOString()
    };
  }

  if (explain.includes("lowScore")) {
    const suggested = clamp(baseFloor - 0.03, 0.4, 0.9);
    return {
      status: "ADJUST",
      action: "relax_score_floor",
      variable: "HF_SENTIMENT_SCORE_FLOOR",
      currentValue: baseFloor,
      suggestedValue: Number(suggested.toFixed(4)),
      reason: "coverage_low_from_score_floor",
      confidence: "medium",
      generatedAt: input.now ?? new Date().toISOString()
    };
  }

  const suggested = clamp(baseFloor + 0.03, 0.4, 0.9);
  return {
    status: "ADJUST",
    action: "tighten_score_floor",
    variable: "HF_SENTIMENT_SCORE_FLOOR",
    currentValue: baseFloor,
    suggestedValue: Number(suggested.toFixed(4)),
    reason: input.tuningPhase.reason,
    confidence: "low",
    generatedAt: input.now ?? new Date().toISOString()
  };
}
