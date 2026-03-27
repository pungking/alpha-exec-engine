# HF Threshold Tuning Playbook

This guide is for iterative tuning after each sidecar dry-run result.

Scope:
- Sidecar HF soft gate
- Sidecar HF shadow compare
- Sidecar HF alert/drift telemetry

Out of scope:
- Web app UI tuning
- Stage6 model prompt tuning

---

## 0) Two-phase operating model (recommended)

Tune HF with `perf_loop_gate_progress` as a paired control signal.

- Phase A: **Observation tuning** (`progress < 20/20`)
  - Goal: stabilize telemetry and avoid false alerts.
  - Focus: `hf_soft_gate.explain`, `hf_shadow`, `hf_alert`, `hf_marker_audit`.
  - Do **not** freeze thresholds yet.
- Phase B: **Baseline freeze** (`progress >= 20/20`)
  - Goal: confirm behavior under sufficient sample.
  - Freeze default thresholds after review.
  - Only make changes for clear drift/noise regressions.

This avoids overtuning during low-sample periods.

---

## 1) Per-run checklist (copy/paste)

Use this block for every test result:

```text
run_at:
stage6_hash:
regime:
payloads/skipped:
skip_reasons:
perf_loop_gate_status:
perf_loop_gate_reason:
perf_loop_gate_progress:
perf_loop_latest_kpi:

hf_soft_gate:
hf_payload_probe:
hf_shadow:
hf_shadow_trend:
hf_tuning_phase:
hf_alert:
hf_marker_audit:

decision:
notes:
```

Minimum lines to capture:
- `hf_soft_gate`
- `hf_payload_probe`
- `hf_shadow`
- `hf_shadow_trend`
- `hf_tuning_phase`
- `hf_alert`
- `hf_marker_audit`
- `payloads/skipped` + `skip_reasons`
- `perf_loop_gate_progress` (+ status/reason)

---

## 2) How to read current output quickly

### hf_soft_gate
- `applied=0` can be normal if sentiment is neutral or blocked by policy.
- `explain=...` is the main reason line.
  - Example: `blockers=neutral:6` means HF labels are mostly neutral, so no adjustment is expected.

### hf_shadow
- `compared=true` means ON/OFF compare ran.
- `payloadDelta`, `notionalDelta`, `skipReasonDelta` show behavior difference.
  - All zero can be normal when market/guard gates block everything.

### hf_payload_probe
- Fast readiness check for payload-path HF validation.
- Key status meanings:
  - `PENDING_NO_PAYLOAD`: payload path not exercised yet.
  - `PENDING_NO_HF_ADJUST`: payload exists but HF adjustment did not apply.
  - `PASS_HF_APPLIED`: HF adjustment applied (size reduce may be disabled or tighten not triggered).
  - `PASS_SIZE_REDUCED`: tighten + size reduction observed as expected.
  - `WARN_SIZE_REDUCE_EXPECTED`: tighten happened but size reduction did not.

### hf_shadow_trend
- Rolling trend across recent runs.
- Watch these first:
  - `alertRate`
  - `avgAbsPayloadDelta`
  - `avgAbsNotionalDelta`
  - `zeroPayloadRate`
- During risk-off blocks, high `zeroPayloadRate` is expected.

### hf_tuning_phase
- Single-line operator cue for "should we tune now?"
- Phase meanings:
  - `OBSERVE_ONLY`: sample too small (`progress < 20/20`) -> collect runs first.
  - `REVIEW_ONLY`: enough sample but alert/noise condition present -> tune/review before freeze.
  - `FREEZE_READY`: gate stable + HF stable -> freeze baseline and monitor.

### hf_alert
- `triggered=false reason=none` is healthy.
- `triggered=true` means drift or shadow deltas crossed thresholds.

### hf_marker_audit
- All `ok` means logging/summaries are synchronized.
- Any `missing` means observability gap (warning-only by policy).

### perf_loop_gate_progress
- `x/20` means sample maturity toward go/no-go gate.
- While `x < 20`, prioritize observability/noise tuning over aggressive threshold changes.
- At `20/20`, decide freeze or targeted adjustment.

---

## 3) Tuning knobs and when to use them

## A. HF soft gate policy
- `HF_SENTIMENT_SCORE_FLOOR` (default `0.55`)
  - Increase when noisy low-confidence HF labels are over-influencing.
  - Decrease when almost nothing applies despite good articles.
- `HF_SENTIMENT_MIN_ARTICLE_COUNT` (default `2`)
  - Increase for stricter reliability.
  - Decrease (`1`) only when coverage is structurally thin.
- `HF_SENTIMENT_MAX_NEWS_AGE_HOURS` (default `24`)
  - Lower for stricter recency.
  - Raise only if stale block dominates and market context supports it.
- `HF_SENTIMENT_POSITIVE_RELIEF_MAX` / `HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX`
  - Use to shape asymmetry.
  - Typical conservative setup: negative tighten >= positive relief.

## B. Earnings window control
- `HF_EARNINGS_WINDOW_BLOCK_DAYS` (default `1`)
- `HF_EARNINGS_WINDOW_REDUCE_DAYS` (default `3`)
- `HF_EARNINGS_WINDOW_REDUCE_FACTOR` (default `0.3`)

Use these when earnings-adjacent behavior is too sensitive.

## C. Negative size soft-reduce
- `HF_NEGATIVE_SIZE_REDUCTION_ENABLED` (default `false`)
- `HF_NEGATIVE_SIZE_REDUCTION_PCT` (default `0.15`)

This reduces notional only when HF tighten actually applies.

## D. Shadow/alert tuning
- `HF_SHADOW_ENABLED` (default `false`)
- `HF_ALERT_ENABLED` (default `true`)
- `HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS` (default `2`)
- `HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS` (default `1000`)
- `HF_ALERT_SHADOW_SKIPPED_DELTA_ABS` (default `2`)
- Drift thresholds:
  - `HF_DRIFT_ALERT_*`

Raise alert thresholds if frequent false alarms.
Lower only after enough sample history.

---

## 4) Adjustment rules (safe sequence)

Change policy in this order:

1. **Observability first**
   - fix marker gaps before tuning strategy.
2. **Coverage gates**
   - article count / recency / score floor.
3. **Impact strength**
   - relief/tighten max.
4. **Risk sizing**
   - negative size reduction.
5. **Alert thresholds**
   - shadow + drift anomaly sensitivity.

Do not change everything at once.

Recommended change budget per batch:
- max 1~2 variables per batch
- run 2~3 observations before next adjustment

Progress gate policy:
- `progress < 20/20`: soft tuning only (alert sensitivity / explainability clarity).
- `progress >= 20/20`: allow baseline freeze and stricter threshold decisions.

---

## 5) Fast diagnosis map

### Symptom -> Action

- `explain` mostly `neutral:*`
  - No immediate change. This is often expected.
- `lowArticleCount` dominates for many runs
  - Consider `HF_SENTIMENT_MIN_ARTICLE_COUNT=1` (temporary), then re-evaluate.
- `stale` dominates
  - Review upstream news freshness first.
  - If needed, loosen `HF_SENTIMENT_MAX_NEWS_AGE_HOURS` slightly.
- `hf_alert triggered=true` too often but no real behavior drift
  - Increase `HF_ALERT_SHADOW_*` thresholds.
- shadow deltas consistently large and unstable
  - tighten HF impact (`NEGATIVE_TIGHTEN_MAX` down or `SCORE_FLOOR` up).

---

## 6) Environment sync rule

For sidecar tuning variables:
- Local: `.env` (sidecar runtime)
- GitHub Actions: `vars.*` for `dry-run.yml`

Vercel is not required for sidecar-only HF controls.

---

## 7) Definition of done (HF tuning cycle)

A tuning cycle is complete when:
- `hf_marker_audit` all `ok`
- `hf_alert` stable (no repeated false positives)
- `hf_soft_gate explain` is interpretable and consistent
- `perf_loop_gate_progress` reaches `20/20` and gate status is reviewed
- At least one payload-producing run validates:
  - `sizeReduced` and `sizeSavedNotional` behavior (when negative tighten occurs)
  - shadow deltas are explainable
