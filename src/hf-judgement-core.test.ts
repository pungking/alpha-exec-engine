import test from "node:test";
import assert from "node:assert/strict";
import {
  describeHfLivePromotionRequiredMissingCore,
  deriveHfLivePromotionSummaryCore,
  deriveHfTuningAdviceCore,
  deriveHfTuningPhaseCore
} from "./hf-judgement-core.js";

const basePolicy = {
  requirePerfGateGo: true,
  requireFreezeFrozen: true,
  requireShadowStable: true,
  requirePayloadPathVerified: true
} as const;

test("describe required-missing maps token/text deterministically", () => {
  const summary = describeHfLivePromotionRequiredMissingCore(["perfGateGo", "freezeFrozen"]);
  assert.equal(summary.token, "wait_perf_gate_go+wait_freeze_frozen");
  assert.match(summary.text, /wait for perf gate GO/);
  assert.match(summary.text, /wait for HF freeze status FROZEN/);
});

test("live promotion PASS when all required checks pass", () => {
  const result = deriveHfLivePromotionSummaryCore({
    perfGate: { status: "GO", reason: "ok" },
    freeze: { enabled: true, status: "FROZEN", reason: "stable", maxShadowAlertRate: 0.1 },
    alert: { triggered: false, reason: "none" },
    shadowTrend: { comparedRuns: 5, alertTriggeredRate: 0 },
    payloadProbe: { active: false, requestedMode: "off" },
    payloadPath: {
      payloadPathVerified: true,
      payloadPathSource: "sticky",
      payloadPathVerifiedAt: "2026-03-28T00:00:00.000Z"
    },
    policy: basePolicy,
    now: "2026-03-28T00:00:00.000Z"
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.requiredMissing.length, 0);
  assert.equal(result.reason, "all_required_live_promotion_checks_passed");
});

test("live promotion BLOCK on alert regardless of other checks", () => {
  const result = deriveHfLivePromotionSummaryCore({
    perfGate: { status: "GO", reason: "ok" },
    freeze: { enabled: true, status: "FROZEN", reason: "stable", maxShadowAlertRate: 0.1 },
    alert: { triggered: true, reason: "shadow_spike" },
    shadowTrend: { comparedRuns: 5, alertTriggeredRate: 0 },
    payloadProbe: { active: false, requestedMode: "off" },
    payloadPath: {
      payloadPathVerified: true,
      payloadPathSource: "sticky",
      payloadPathVerifiedAt: "2026-03-28T00:00:00.000Z"
    },
    policy: basePolicy
  });
  assert.equal(result.status, "BLOCK");
  assert.match(result.reason, /hf_alert_triggered/);
});

test("live promotion HOLD when perf gate pending sample", () => {
  const result = deriveHfLivePromotionSummaryCore({
    perfGate: { status: "PENDING_SAMPLE", reason: "sample_insufficient" },
    freeze: { enabled: true, status: "FROZEN", reason: "stable", maxShadowAlertRate: 0.1 },
    alert: { triggered: false, reason: "none" },
    shadowTrend: { comparedRuns: 5, alertTriggeredRate: 0 },
    payloadProbe: { active: false, requestedMode: "off" },
    payloadPath: {
      payloadPathVerified: true,
      payloadPathSource: "sticky",
      payloadPathVerifiedAt: "2026-03-28T00:00:00.000Z"
    },
    policy: basePolicy
  });
  assert.equal(result.status, "HOLD");
  assert.equal(result.reason, "perf_gate_pending_sample");
  assert.deepEqual(result.requiredMissing, ["perfGateGo"]);
});

test("tuning phase OBSERVE_ONLY below required sample", () => {
  const result = deriveHfTuningPhaseCore({
    perfGate: { status: "PENDING_SAMPLE", progress: "11/20" },
    tradeCount: 11,
    alert: { triggered: false, reason: "none" },
    shadowTrend: { alertTriggeredRate: 0 },
    requiredTrades: 20
  });
  assert.equal(result.phase, "OBSERVE_ONLY");
  assert.equal(result.gateRemainingTrades, 9);
  assert.equal(result.gateProgressPct, 55.0);
});

test("tuning phase FREEZE_READY on GO + stable", () => {
  const result = deriveHfTuningPhaseCore({
    perfGate: { status: "GO", progress: "20/20" },
    tradeCount: 20,
    alert: { triggered: false, reason: "none" },
    shadowTrend: { alertTriggeredRate: 0.05 },
    requiredTrades: 20
  });
  assert.equal(result.phase, "FREEZE_READY");
  assert.equal(result.reason, "perf_gate_go_and_hf_stable");
});

test("tuning advice suggests article-count relax when lowArticleCount dominates", () => {
  const result = deriveHfTuningAdviceCore({
    tuningPhase: { phase: "REVIEW_ONLY", reason: "coverage_low" },
    hfSentimentGate: {
      explainLine: "checked=6 no_adjust blockers=lowArticleCount:4",
      scoreFloor: 0.55,
      minArticleCount: 2,
      maxNewsAgeHours: 24
    }
  });
  assert.equal(result.status, "ADJUST");
  assert.equal(result.variable, "HF_SENTIMENT_MIN_ARTICLE_COUNT");
  assert.equal(result.suggestedValue, 1);
});

test("tuning advice suggests freeze on FREEZE_READY", () => {
  const result = deriveHfTuningAdviceCore({
    tuningPhase: { phase: "FREEZE_READY", reason: "perf_gate_go_and_hf_stable" },
    hfSentimentGate: {
      explainLine: "checked=6 applied=1",
      scoreFloor: 0.55,
      minArticleCount: 2,
      maxNewsAgeHours: 24
    }
  });
  assert.equal(result.status, "FREEZE");
  assert.equal(result.action, "freeze_baseline");
});
