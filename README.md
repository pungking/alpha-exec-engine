# alpha-exec-engine (Sidecar)

Execution/simulation sidecar for `US_Alpha_Seeker`.

## Scope
- Reads Stage6 outputs and applies execution policy.
- Sends execution/simulation Telegram events.
- Does **not** modify the analysis engine logic.

## Current Dry-Run Behavior
- Loads the latest `STAGE6_ALPHA_FINAL_*.json` from `GDRIVE_STAGE6_FOLDER`.
- Prints source lock metadata (`fileId`, `md5`, `sha256`, candidates).
- Applies policy gate for action candidates (`BUY`, `STRONG_BUY` only).
- Builds Alpaca order payload previews only (no live order send in dry-run).
- Payload gate includes conviction floor + stop-distance sanity range.
- Optional entry-feasibility gate (default OFF) can skip entries that are too far from market or marked infeasible in Stage6 shadow fields.
- Stage6 contract gate (default ON) consumes `executionBucket/executionReason` and blocks `WATCHLIST` rows before payload build.
- Position lifecycle scaffold (Phase A) adds `actionType/actionReason` intent tags (`ENTRY_NEW/HOLD_WAIT` baseline) without changing live order behavior.
- Payload gate enforces total notional cap (`DRY_MAX_TOTAL_NOTIONAL`).
- Payload JSON is validated/normalized before use (2-decimal rounding, finite/non-negative checks, bracket geometry, `client_order_id` format).
- Supports regime auto profile switch by VIX (default/risk-off presets).
- Supports VIX source priority (`realtime_first` vs `snapshot_first`) with snapshot staleness guard.
- Realtime chain: `Finnhub -> CNBC Direct -> CNBC RapidAPI -> Snapshot`.
- Regime diagnostics are logged as `[REGIME_DIAG]` (priority, snapshot freshness, finnhub/cnbc fallback reasons).
- Data quality guard scores VIX source health/mismatch/staleness and can force defensive profile + block new entries.
- Regime hysteresis + minimum hold time reduce profile flapping (`risk_off` recovery only after on-threshold and hold).
- Optional guard-control enforcement reads `state/guard-control.json` and can block new entries in live mode.
- Adds market guard (P3-2) with L1/L2/L3 risk levels, de-escalation hold, cooldown, and observe/active mode.
- Market guard auto-tunes effective thresholds by profile/quality while keeping env guardrails as base bounds.
- Adds order-level idempotency key store (`stage6Hash:symbol:side`) at `state/order-idempotency.json`.
- Optional dry-run enforcement (`ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN=true`) converts duplicate keys to skip reasons.
- Adds preflight gate (`/v2/account`, `/v2/clock`) before send; in dry-run it reports only, in exec mode it blocks on fail.
- Adds lifecycle state machine ledger (`state/order-ledger.json`) with transition validation and history trail.
- Optional one-shot dedupe bypass (`FORCE_SEND_ONCE=true`) sends once per current `stage6Hash+mode`.
- Persists local run state in `state/last-run.json` and skips duplicate sends for same hash/mode.
- Optional one-line Telegram heartbeat on dedupe skip (`TELEGRAM_HEARTBEAT_ON_DEDUPE=true`).
- Saves dry-exec payload snapshot to `state/last-dry-exec-preview.json`.
- Saves HF evidence ledger to `state/hf-evidence-history.jsonl` for zero-credit replay/tuning review.
- Uses shared JSON parse guard (`src/json-utils.ts`) for Drive/state payloads (`NaN/Infinity -> null`) to reduce runtime parse breaks.

## Market Guard (P3-2)
- Separate runtime (`npm run guard`) for intraday guard checks.
- Evaluates VIX + index drop signals and derives risk level `L0..L3`.
- Signal chain (VIX): `Finnhub -> CNBC Direct -> CNBC RapidAPI -> Snapshot` with source-priority switch.
- Applies de-escalation hold + action cooldown to prevent action flapping.
- Active mode execution (P3-3) is safety-gated by runtime flags:
  - Executes only when `MARKET_GUARD_MODE=active`, `EXEC_ENABLED=true`, and `READ_ONLY=false`.
  - `halt_new_entries` writes `state/guard-control.json` for downstream entry blocking.
  - `cancel_open_entries` cancels open buy-side orders on Alpaca.
  - `tighten_stops` / `reduce_positions_50` / `flatten_if_triggered` are opt-in via dedicated env toggles.
- Persists:
  - `state/last-market-guard.json`
  - `state/market-guard-state.json`
  - `state/guard-action-ledger.json`
  - `state/guard-control.json`

### P3-3 Test Checklist
- Step-by-step validation checklist: `docs/P3_3_ACTIVE_EXEC_TEST_CHECKLIST.md`

## Safety Defaults
- `EXEC_ENABLED=false`
- `READ_ONLY=true`

These defaults must stay until dry-run validation is complete.

## Quick Start
```bash
npm install
npm run build
node dist/src/index.js
# judgement unit tests (credit-free)
npm run test:hf
# one-shot local regression (tests + fixture replay)
npm run verify:hf
# zero-credit judgement replay (uses saved state files)
npm run replay:hf
# zero-credit regression replay against fixed fixture/baseline
npm run replay:hf:fixture
```

HF verification shortcuts:
- `npm run verify:hf`: CI-equivalent one-shot gate (build once + unit/replay checks).
- `npm run test:hf:dist`: run HF unit tests on existing `dist` build.
- `npm run replay:hf:fixture:dist`: run fixture replay on existing `dist` build.

## Environment
Use `.env.example` as baseline.

### Secrets (GitHub Actions)
- `ALPACA_KEY_ID`
- `ALPACA_SECRET_KEY`
- `TELEGRAM_TOKEN`
- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `FINNHUB_API_KEY` (optional fallback source for VIX)
- `CNBC_RAPIDAPI_KEY` (optional VIX fallback via RapidAPI)
- `RAPID_API_KEY` (optional alias for `CNBC_RAPIDAPI_KEY`)

### Variables (GitHub Actions)
- `ALPACA_BASE_URL`
- `EXEC_ENABLED`
- `READ_ONLY`
- `TZ`
- `DRY_NOTIONAL_PER_TRADE`
- `DRY_MAX_ORDERS`
- `DRY_MAX_TOTAL_NOTIONAL`
- `DRY_MIN_CONVICTION`
- `DRY_MIN_CONVICTION_FLOOR` (optional lower clamp for adaptive conviction gate)
- `DRY_MIN_CONVICTION_CEILING` (optional upper clamp for adaptive conviction gate)
- `DRY_MIN_STOP_DISTANCE_PCT`
- `DRY_MAX_STOP_DISTANCE_PCT`
- `ENTRY_FEASIBILITY_ENFORCE` (default `false`)
- `ENTRY_MAX_DISTANCE_PCT` (default `15`)
- `STAGE6_EXECUTION_BUCKET_ENFORCE` (default `true`)
- `ACTIONABLE_INCLUDE_SPECULATIVE_BUY` (default `false`; when `true`, actionable verdict set becomes `BUY/STRONG_BUY/SPECULATIVE_BUY`)
- `POSITION_LIFECYCLE_ENABLED` (default `false`; enables action intent scaffold logs)
- `POSITION_LIFECYCLE_PREVIEW_ONLY` (default `true`; scaffold stays telemetry-only)
- `POSITION_LIFECYCLE_ACTION_TYPES` (default `ENTRY_NEW,HOLD_WAIT`)
- `POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION` (default `82`; reserved for future `SCALE_UP` policy)
- `HF_SENTIMENT_SOFT_GATE_ENABLED` (default `false`; sentiment-based conviction floor adjustment)
- `HF_SENTIMENT_SCORE_FLOOR` (default `0.55`; minimum HF confidence to apply adjustment)
- `HF_SENTIMENT_MIN_ARTICLE_COUNT` (default `2`; minimum headline count required)
- `HF_SENTIMENT_MAX_NEWS_AGE_HOURS` (default `24`; newest headline must be within this age)
- `HF_EARNINGS_WINDOW_ENABLED` (default `true`; shrink/block HF sentiment near earnings)
- `HF_EARNINGS_WINDOW_BLOCK_DAYS` (default `1`; block when `|D| <= 1`)
- `HF_EARNINGS_WINDOW_REDUCE_DAYS` (default `3`; reduce when `1 < |D| <= 3`)
- `HF_EARNINGS_WINDOW_REDUCE_FACTOR` (default `0.3`; apply delta multiplier in reduce zone)
- `HF_SENTIMENT_POSITIVE_RELIEF_MAX` (default `1.0`; max conviction floor relief)
- `HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX` (default `2.0`; max conviction floor tighten)
- `HF_NEGATIVE_SIZE_REDUCTION_ENABLED` (default `false`; reduce order notional when HF negative tighten is applied)
- `HF_NEGATIVE_SIZE_REDUCTION_PCT` (default `0.15`; fixed notional reduction ratio, clamped `0~0.5`)
- `HF_SHADOW_ENABLED` (default `false`; writes HF on/off shadow comparison telemetry only)
- `HF_ALERT_ENABLED` (default `true`; enable shadow+drift anomaly warning telemetry)
- `HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS` (default `2`; abs payload-count delta threshold)
- `HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS` (default `1000`; abs notional delta threshold)
- `HF_ALERT_SHADOW_SKIPPED_DELTA_ABS` (default `2`; abs skipped-count delta threshold)
- `HF_DRIFT_ALERT_ENABLED` (default `true`; enable recent-run HF drift warning logs)
- `HF_DRIFT_ALERT_WINDOW_RUNS` (default `8`; rolling window size)
- `HF_DRIFT_ALERT_MIN_HISTORY` (default `4`; minimum baseline samples before alerting)
- `HF_DRIFT_ALERT_MIN_CANDIDATES` (default `3`; minimum checked candidates required)
- `HF_DRIFT_ALERT_NEGATIVE_RATIO_SPIKE` (default `0.75`; absolute negative-ratio spike threshold)
- `HF_DRIFT_ALERT_NEGATIVE_RATIO_DELTA` (default `0.35`; baseline delta threshold for negative ratio)
- `HF_DRIFT_ALERT_APPLIED_RATIO_DROP` (default `0.25`; baseline drop threshold for applied ratio)
- `HF_DRIFT_ALERT_APPLIED_RATIO_FLOOR` (default `0.15`; absolute low floor for applied ratio drop alerts)
- `ORDER_IDEMPOTENCY_ENABLED`
- `ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN`
- `ORDER_IDEMPOTENCY_TTL_DAYS`
- `PREFLIGHT_ENABLED`
- `DAILY_MAX_NOTIONAL`
- `ALLOW_ENTRY_OUTSIDE_RTH`
- `ORDER_LIFECYCLE_ENABLED`
- `ORDER_LEDGER_TTL_DAYS`
- `FORCE_SEND_ONCE` (one-shot override for current hash/mode)
- `TELEGRAM_HEARTBEAT_ON_DEDUPE`
- `TELEGRAM_MAX_MESSAGE_LENGTH` (optional, default `3900`; auto-chunk guard for long messages)
- `REGIME_AUTO_ENABLED`
- `REGIME_FORCE_PROFILE` (`auto|default|risk_off`)
- `REGIME_VIX_SOURCE_PRIORITY` (`realtime_first|snapshot_first`)
- `REGIME_SNAPSHOT_MAX_AGE_MIN` (set `0` to disable stale guard)
- `REGIME_QUALITY_GUARD_ENABLED`
- `REGIME_QUALITY_MIN_SCORE`
- `REGIME_HYSTERESIS_ENABLED`
- `REGIME_MIN_HOLD_MIN`
- `REGIME_VIX_MISMATCH_PCT`
- `GUARD_CONTROL_ENFORCE`
- `GUARD_CONTROL_MAX_AGE_MIN`
- `GUARD_QUALITY_MIN_SCORE`
- `VIX_RISK_ON_THRESHOLD`
- `VIX_RISK_OFF_THRESHOLD`
- `CNBC_RAPIDAPI_ENABLED` (recommended default: `false`; enable only if endpoint is verified)
- `CNBC_RAPIDAPI_HOST` (optional, default `cnbc.p.rapidapi.com`)
- `CNBC_RAPIDAPI_ENDPOINT` (optional, default `/market/get-quote`)
- `CNBC_RAPIDAPI_SYMBOL_PARAM` (optional, default `symbol`)
- `GDRIVE_ROOT_FOLDER_ID`
- `GDRIVE_MARKET_SNAPSHOT_FOLDER_ID` (optional explicit folder for `MARKET_REGIME_SNAPSHOT.json`)
- `GDRIVE_STAGE6_FOLDER`
- `GDRIVE_REPORT_FOLDER`
- `TELEGRAM_PRIMARY_CHAT_ID`
- `TELEGRAM_SIMULATION_CHAT_ID`
- `MARKET_GUARD_ENABLED`
- `MARKET_GUARD_MODE` (`observe|active`)
- `MARKET_GUARD_INTERVAL_MIN`
- `MARKET_GUARD_FORCE_SEND_ONCE`
- `GUARD_ALLOW_OUTSIDE_RTH`
- `GUARD_USE_INDEX_DROP`
- `GUARD_QUALITY_ESCALATE_ENABLED`
- `GUARD_FORCE_LEVEL` (`auto|l0|l1|l2|l3`)
- `GUARD_DEESCALATE_HOLD_MIN`
- `GUARD_ACTION_COOLDOWN_MIN`
- `GUARD_ACTION_LEDGER_TTL_DAYS`
- `GUARD_L1_VIX`
- `GUARD_L2_VIX`
- `GUARD_L3_VIX`
- `GUARD_L2_INDEX_DROP_PCT`
- `GUARD_L3_INDEX_DROP_PCT`
- `GUARD_TIGHTEN_STOP_PCT_L2`
- `GUARD_TIGHTEN_STOP_PCT_L3`
- `GUARD_MARKET_ORDER_TIF` (`day|gtc`)
- `GUARD_STOP_ORDER_TIF` (`day|gtc`)
- `GUARD_EXECUTE_TIGHTEN_STOPS` (`true|false`)
- `GUARD_EXECUTE_REDUCE_POSITIONS` (`true|false`)
- `GUARD_EXECUTE_FLATTEN` (`true|false`)

### Ops Presets (2 profiles)
- `DRY_DEFAULT_*` : market normal profile
- `DRY_RISK_OFF_*` : high-volatility defensive profile

If profile-specific vars are empty, runtime falls back to legacy `DRY_*` values.

### Adaptive Conviction Gate
- Sidecar applies an adaptive conviction floor from:
  - base profile floor (`DRY_DEFAULT_MIN_CONVICTION` / `DRY_RISK_OFF_MIN_CONVICTION`)
  - market tighten term (VIX-linked)
  - quality relief term (regime quality score-linked)
  - actionable sample cap (quantile cap)
- Optional clamps:
  - `DRY_DEFAULT_MIN_CONVICTION_FLOOR`, `DRY_DEFAULT_MIN_CONVICTION_CEILING`
  - `DRY_RISK_OFF_MIN_CONVICTION_FLOOR`, `DRY_RISK_OFF_MIN_CONVICTION_CEILING`
- Runtime logs expose `[CONV_POLICY] ...` for auditability.

### HF Sentiment Soft Gate (default OFF)
- Purpose: reflect Stage6 HF advisory signal in sidecar conviction floor without touching hard risk gates.
- Tuning guide: `docs/HF_THRESHOLD_TUNING_PLAYBOOK.md` (per-run checklist + threshold adjustment rules, paired with `perf_loop_gate_progress`)
- Env:
  - `HF_SENTIMENT_SOFT_GATE_ENABLED=false` -> no sentiment adjustment.
  - `HF_SENTIMENT_SOFT_GATE_ENABLED=true` -> per-symbol conviction floor is softly adjusted:
    - `positive`: floor relief up to `HF_SENTIMENT_POSITIVE_RELIEF_MAX`
    - `negative`: floor tighten up to `HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX`
  - `HF_SENTIMENT_SCORE_FLOOR=0.55` -> only applies when HF score is above this threshold.
  - `HF_SENTIMENT_MIN_ARTICLE_COUNT=2` -> only applies when article count meets minimum.
  - `HF_SENTIMENT_MAX_NEWS_AGE_HOURS=24` -> only applies when newest article is recent enough.
  - Earnings window:
    - `HF_EARNINGS_WINDOW_ENABLED=true`
    - `HF_EARNINGS_WINDOW_BLOCK_DAYS=1` -> HF adjustment blocked in `|D| <= 1`
    - `HF_EARNINGS_WINDOW_REDUCE_DAYS=3` + `HF_EARNINGS_WINDOW_REDUCE_FACTOR=0.3` -> reduced impact in `1 < |D| <= 3`
  - Optional size soft-reduce (default OFF):
    - `HF_NEGATIVE_SIZE_REDUCTION_ENABLED=true`
    - `HF_NEGATIVE_SIZE_REDUCTION_PCT=0.15` -> when negative tighten is applied, payload notional is reduced by fixed ratio.
  - Optional A/B shadow compare (default OFF):
    - `HF_SHADOW_ENABLED=true` -> computes on/off diff in-process and persists `state/hf-shadow-last.json` (no external API call).
  - Simulation telegram/report now includes:
    - `HF Live Promotion: ... missing=... hint=...` for operator-friendly blocker interpretation.
- Notes:
  - Adjustment is bounded and audit-logged (`[HF_SOFT_GATE] ...`).
  - Explainability line is fixed in report/logs via `HF Explain: ...` and `hf_soft_explain=...`.
  - Capacity checks (`max_orders`, `max_total_notional`) remain based on base `notionalPerOrder` for stable rollout behavior.
  - Core sidecar risk chain (market guard, preflight, regime guard, exposure caps) remains unchanged.
  - Drift monitor (log-only):
    - `[HF_DRIFT] ...` warns when recent `N` runs show sudden negative-ratio spikes or applied-ratio drops.
    - State is persisted at `state/hf-drift-state.json`.
  - Shadow monitor (log-only):
    - `[HF_SHADOW] ...` emits HF on/off payload/notional deltas for current run.
    - State is persisted at `state/hf-shadow-last.json`.
    - History is appended to `state/hf-shadow-history.jsonl` (rolling retention).
  - Combined anomaly alert (log-only):
    - `[HF_ALERT] ...` combines drift trigger + shadow deltas using abs thresholds.
    - Summary marker: `[HF_ALERT_SUMMARY] ...` and `[RUN_SUMMARY] ... hf_alert=...`.
  - Tuning timing guidance:
    - `[HF_TUNING_PHASE] ...` emits phase/reason/recommendation using perf loop maturity + HF stability.
    - Summary marker: `[RUN_SUMMARY] ... hf_tuning_phase=...`.
  - Tuning advice (suggestion-only):
    - `[HF_TUNING_ADVICE] ...` emits one-variable adjustment advice (or hold/freeze).
    - Summary marker: `[RUN_SUMMARY] ... hf_tuning_advice=...`.
  - Freeze/unfreeze assistant (stateful, suggestion-only):
    - `[HF_FREEZE] ...` emits `OBSERVE/CANDIDATE/FROZEN/UNFREEZE_REVIEW`.
    - State is persisted at `state/hf-tuning-freeze.json`.
    - Summary marker: `[RUN_SUMMARY] ... hf_freeze=...`.
    - Env:
      - `HF_TUNING_FREEZE_ENABLED=false`
      - `HF_TUNING_FREEZE_STABLE_RUNS=3`
      - `HF_TUNING_UNFREEZE_ALERT_STREAK=2`
      - `HF_TUNING_FREEZE_REQUIRE_PROGRESS=20`
      - `HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE=0.10`
  - Live promotion checklist (suggestion-only):
    - `[HF_LIVE_PROMOTION] ...` emits `BLOCK/HOLD/PASS` with checklist pass ratio.
    - Summary marker: `[RUN_SUMMARY] ... hf_live_promotion=...`.
    - Payload-path verification is sticky per Stage6 hash via `state/hf-live-promotion-state.json`.
    - Policy env (all default `true`):
      - `HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO`
      - `HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN`
      - `HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE`
      - `HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED`

### Entry Feasibility Gate (default OFF)
- Purpose: consume Stage6 `entryFeasible*/entryDistancePct*/tradePlanStatus*` hints in dry-run selection.
- Env:
  - `ENTRY_FEASIBILITY_ENFORCE=false` -> behavior unchanged (observe only)
  - `ENTRY_FEASIBILITY_ENFORCE=true` -> skips can include:
    - `entry_too_far_from_market`
    - `entry_feasibility_false`
    - `entry_invalid_geometry`
    - `entry_data_missing`
- Threshold:
  - `ENTRY_MAX_DISTANCE_PCT=15` (applies when distance metric exists)

### Stage6 Contract Gate (default ON)
- Purpose: align sidecar execution with Stage6 contract fields (`executionBucket`, `executionReason`).
- Env:
  - `STAGE6_EXECUTION_BUCKET_ENFORCE=true` -> `WATCHLIST` rows are skipped with explicit Stage6 reasons.
  - `STAGE6_EXECUTION_BUCKET_ENFORCE=false` -> legacy behavior (verdict + payload gates only).
- Actionable verdict policy:
  - default: `BUY/STRONG_BUY` only
  - optional: set `ACTIONABLE_INCLUDE_SPECULATIVE_BUY=true` to include `SPECULATIVE_BUY`
- Contract skip reasons:
  - `stage6_wait_pullback_too_deep`
  - `stage6_invalid_geometry`
  - `stage6_invalid_data`
  - `stage6_watchlist`

### Runtime Guard
`src/index.ts` validates required env keys at startup and exits with non-zero code on missing values.

## Workflow
- `sidecar-ci`: typecheck/build gate on push/PR.
- `sidecar-dry-run`: manual + scheduled dry-run with state cache restore/save.
  - Publishes concise run summary to GitHub Step Summary.
  - Also supports `repository_dispatch` (`type=stage6_result_created`) for one-shot run right after a new Stage6 dump is generated.
    - Optional `client_payload`: `stage6Hash`, `stage6File`, `sourceRunId` (included in Step Summary trigger trace).
  - Default schedule is kept as low-frequency weekday fallback (once/day UTC) to reduce duplicate spend when dispatch auto-runs are enabled.
  - Manual dispatch inputs:
    - `validation_pack=true`: OFF/ON/STRICT entry feasibility validation in one run.
    - `payload_probe=true`: one-shot payload path probe with temporary `DRY_RISK_OFF_MIN_CONVICTION` override (`payload_probe_min_conviction`).
    - `payload_probe_mode=tighten|relief`: force HF path on a selected executable candidate (workflow_dispatch + preview-only safe lane).
  - Step Summary now includes `skip_reasons` distribution for faster `payload=0` diagnosis.
  - HF marker audit (warning-only):
    - Workflow stores marker status at `state/hf-marker-audit.json`.
    - Expected keywords in run log: `[HF_SOFT_GATE]`, `[HF_PAYLOAD_PROBE]`, `[HF_PAYLOAD_PROBE_STATUS]`, `[HF_PAYLOAD_PATH_STICKY]`, `[HF_EVIDENCE]`, `[HF_DRIFT]` or `[HF_DRIFT_SUMMARY]`, `[HF_SHADOW]`, `[HF_TUNING_PHASE]`, `[HF_TUNING_ADVICE]`, `[HF_FREEZE]`, `[HF_LIVE_PROMOTION]`, `[HF_NEXT_ACTION]`, `[HF_DAILY_VERDICT]`, `[HF_ALERT]` or `[HF_ALERT_SUMMARY]`, and `[RUN_SUMMARY] ... hf_payload_probe_forced=... hf_payload_probe_status=... hf_payload_path_sticky=... hf_evidence=... hf_drift=... hf_shadow=... hf_shadow_trend=... hf_tuning_phase=... hf_tuning_advice=... hf_freeze=... hf_live_promotion=... hf_next_action=... hf_daily_verdict=... hf_alert=...`.
    - Missing markers only emit warning (`[HF_MARKER_AUDIT] ...`), run still passes.
  - Step Summary includes:
    - `hf_soft_gate` (`enabled/applied/netDelta/earningsBlocked/earningsReduced/sizeReduced/explain`)
    - `hf_payload_probe` (`status/payloads/hfApplied/tighten/sizeReduced/reason`)
      - forced probe success statuses:
        - `PASS_FORCED_PATH`
        - `PASS_FORCED_SIZE_REDUCED`
    - `hf_payload_probe_forced` (`mode/active/modified/reason/symbol/basePayloads/baseApplied/baseTighten/baseRelief/baseSizeReduced/baseSizeSaved`)
    - `hf_payload_probe_status` (`status/reason/payloads/hfApplied/tighten/sizeReduced/savedNotional/forced`)
    - `hf_shadow` (`enabled/compared/reason/payloadDelta/notionalDelta`)
    - `hf_shadow_trend` (`history/window/compared/alertRate/avgAbsDelta/zeroPayloadRate`)
    - `hf_tuning_phase` (`phase/reason/recommendation/gate/progress/remainingTrades/progressPct/trades`)
    - `hf_tuning_advice` (`status/action/variable/current/suggested/reason/confidence`)
    - `hf_freeze` (`enabled/status/reason/recommendation/progress/stable/alert/shadowRate/frozenAt`)
    - `hf_live_promotion` (`status/reason/recommendation/required/requiredMissing/requiredHint/pass/checks` + `payloadPathSource/payloadPathVerifiedAt`)
    - `hf_next_action` (`status/action/reason/hint/requiredMissing/livePromotion/gate/progress/remainingTrades`)
    - `hf_daily_verdict` (`status/action/reason/requiredMissing/livePromotion/gate/progress/remainingTrades`)
    - `hf_payload_path_sticky` (`priorStage6Hash/stage6HashChanged/stickyEligible/stickyCarried/stickyReset/reason/current*/resolved*`)
    - `hf_evidence` (`history/latest*/window/pass/hold/block/alerts`)
    - `hf_tuning_comment` (`status/action/reason` operator cue for next step)
    - `hf_alert` (`enabled/triggered/reason/shadowCompared/payloadDelta/notionalDelta/skippedDelta/driftTriggered`)
    - `hf_marker_audit` (`soft/drift/runSummary/shadow/runSummaryShadow/runSummaryShadowTrend/tuningPhase/runSummaryTuningPhase/tuningAdvice/runSummaryTuningAdvice/freeze/runSummaryFreeze/payloadProbe/runSummaryPayloadProbe/alert/runSummaryAlert/livePromotion/runSummaryLivePromotion/nextAction/runSummaryNextAction/dailyVerdict/runSummaryDailyVerdict/payloadPathSticky/runSummaryPayloadPathSticky/evidence/runSummaryEvidence` as `ok|missing`)
  - Uploads `state/last-run.json`, `state/last-dry-exec-preview.json`, `state/hf-marker-audit.json`, `state/hf-shadow-last.json`, `state/hf-shadow-history.jsonl`, `state/hf-evidence-history.jsonl`, `state/hf-tuning-freeze.json`, `state/hf-live-promotion-state.json`, `state/last-run-output.log`, `state/order-idempotency.json`, `state/order-ledger.json`, `state/regime-guard-state.json` as run artifacts.
- `sidecar-market-guard`: manual + weekday 5-minute guard run.
  - Publishes level/signal/action summary to Step Summary.
  - Uploads guard state artifacts (`last-market-guard`, `market-guard-state`, `guard-action-ledger`) plus core state files.

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
