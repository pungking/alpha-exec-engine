# alpha-exec-engine (Sidecar)

Execution/simulation sidecar for `US_Alpha_Seeker`.

## Scope
- Reads Stage6 outputs and applies execution policy.
- Sends execution/simulation Telegram events.
- Does **not** modify the analysis engine logic.

## Paper Trading Rollout Status
- "Simulation" in this sidecar context means **paper trading** on Alpaca paper endpoint.
- Current operational status, run evidence, and next steps are tracked in:
  - `docs/PAPER_TRADING_ROLLOUT_STATUS.md`

## Current Dry-Run Behavior
- Loads the latest `STAGE6_ALPHA_FINAL_*.json` from `GDRIVE_STAGE6_FOLDER`.
- Prints source lock metadata (`fileId`, `md5`, `sha256`, candidates).
- Applies policy gate for action candidates (`BUY`, `STRONG_BUY` only).
- Builds Alpaca order payload previews by default (`LIVE_ORDER_SUBMIT_ENABLED=false`).
- Optional live submit lane can POST Alpaca `/v2/orders` when all safety gates pass.
- Payload gate includes conviction floor + stop-distance sanity range.
- Optional entry-feasibility gate (default OFF) can skip entries that are too far from market or marked infeasible in Stage6 shadow fields.
- Stage6 contract gate (default ON) consumes `executionBucket/executionReason` and blocks `WATCHLIST` rows before payload build.
- Position lifecycle scaffold adds `actionType/actionReason` intent tags (`ENTRY_NEW/HOLD_WAIT` baseline).
- Live submit lane now applies held-position guard: existing symbols require `SCALE_UP` allowed + conviction threshold.
- Live submit lane supports lifecycle sell actions (`SCALE_DOWN`, `EXIT_PARTIAL`, `EXIT_FULL`) using live held-position qty.
- Live submit lane enforces `SCALE_UP` only when a held position exists (`scale_up_no_position` otherwise).
- Live submit lane now enforces one-symbol-one-open-entry guard (default ON) to prevent stacking duplicate open buy entries.
- Optional stale-open-entry cleanup can cancel aged open entry orders before refreshed submit, with replace delta/chase + cooldown/daily-cap guards to avoid cancel-repost churn (`ENTRY_OPEN_ORDER_STALE_CANCEL_ENABLED=true`).
- Optional adaptive entry price mode can apply bounded chase from Stage6 entry (`ENTRY_PRICE_MODE=adaptive`) while preserving RR floor and stop-distance guardrails.
- Held-position scale-up includes chase guards (avg-entry distance / intraday surge) to avoid momentum overpay during live adds.
- Lifecycle planner auto-generates held-symbol de-risk actions from Stage6 state (`WATCHLIST/BLOCKED/conviction` degradation).
- Lifecycle planner includes held symbols from full Stage6 universe (not only top picks) to improve held-position coverage.
- Approval queue gate targets entry-expansion intents (`ENTRY_NEW`, `SCALE_UP`) and does not block de-risk sell intents.
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
- Adds preflight gate (`/v2/account`, `/v2/clock`) before send; in exec mode it blocks on fail by default (`PREFLIGHT_BLOCKING_HARD_FAIL=true`).
- Adds lifecycle state machine ledger (`state/order-ledger.json`) with transition validation and history trail.
- Optional one-shot dedupe bypass (`FORCE_SEND_ONCE=true`) sends once per current `stage6Hash+mode`.
- Persists local run state in `state/last-run.json` and skips duplicate sends for same hash/mode.
- Optional Telegram send gate (`TELEGRAM_SEND_ENABLED=false`) disables Telegram delivery while keeping run telemetry.
- Optional one-line Telegram heartbeat on dedupe skip (`TELEGRAM_HEARTBEAT_ON_DEDUPE=true`).
- Optional watchdog workflow (`sidecar-dry-run-watchdog`) can trigger fallback dispatch when scheduled dry-run is stale/missed.
- Saves dry-exec payload snapshot to `state/last-dry-exec-preview.json`.
- Persists open-entry stale replace throttle ledger to `state/open-entry-replace-guard.json` (cooldown + per-day cap tracking).
- Saves HF evidence ledger to `state/hf-evidence-history.jsonl` for zero-credit replay/tuning review.
- Adds MCP Shadow Data Bus telemetry (Phase-1): Alpaca(read-only), Alpha Vantage, SEC EDGAR, Perplexity, Supabase toggles are recorded in startup/run summary/preview without changing trade path.
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
- Trading action policy matrix: `docs/TRADING_POLICY_MATRIX.md`
- Living development plan: `docs/DEVELOPMENT_PLAN_LIVING.md`

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
- `npm run check:json-parse-guard`: fail fast if raw `JSON.parse(...)` appears outside `src/json-utils.ts`.
- `npm run test:hf:dist`: run HF unit tests on existing `dist` build.
- `npm run replay:hf:fixture:dist`: run fixture replay on existing `dist` build.
- `npm run progress:overall`: print current progress ratio from `docs/OVERALL_PROGRESS_TRACKER.md`.
- `npm run progress:daily`: print current pending items + evidence completion from tracker/evidence docs.
- `npm run evidence:snippet`: print paste-ready validation/probe evidence snippets from local state files.
- `npm run dashboard:perf`: build simulation/live dashboard snapshot (`state/performance-dashboard.json`, `.md`).
- `npm run ops:health`: build ops health snapshot (`state/ops-health-report.json`, `.md`) with perf-gate vs dashboard consistency checks.
- `npm run ops:health:dry-run`: build dry-run focused health snapshot.
- `npm run ops:health:market-guard`: build market-guard focused health snapshot.
- `npm run ops:notion:audit`: audit latest Notion Daily Snapshot rows for required fields/duplicate run keys/staleness (`state/notion-ops-audit.json`, `.md`).
- `npm run ops:daily:report`: build consolidated daily ops report from GitHub workflow KPIs + Notion audit (`state/ops-daily-report.json`, `.md`).
- `npm run ops:daily:notion:sync`: upsert consolidated ops daily row into Notion Daily Snapshot (`state/notion-ops-daily-sync.json`, evidence URL required by default).
- `npm run backfill:notion:perf-pct:dry`: dry-run check for legacy Notion percent-scale rows.
- `npm run backfill:notion:perf-pct`: one-time fix for legacy Notion percent-scale rows.
- `npm run sync:notion:dry-run`: upsert `state/last-run.json + state/last-dry-exec-preview.json` into Notion (optional).
- `npm run sync:notion:market-guard`: upsert `state/last-market-guard.json` into Notion (optional).
- `npm run validation-pack:auto`: evaluate current gate state and dispatch one-shot `validation_pack=true` when auto-trigger conditions are met.

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
- `NOTION_TOKEN` (optional; required only for workflow Notion sync)
- `ALPHA_VANTAGE_API_KEY` (optional; shadow-lane readiness telemetry)
- `PERPLEXITY_API_KEY` (optional; shadow-lane readiness telemetry)
- `SUPABASE_URL` (optional; shadow-lane readiness telemetry)
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (optional; shadow-lane readiness telemetry)

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
- `ENTRY_PRICE_MODE` (default `strict`; `strict|adaptive`)
- `ENTRY_PRICE_MAX_CHASE_PCT` (default `2.5`; max upward chase from Stage6 entry in adaptive mode)
- `ENTRY_PRICE_DISTANCE_TRIGGER_PCT` (default `2`; adaptive mode only activates when `entryDistancePct` exceeds this)
- `ENTRY_PRICE_DISTANCE_SCALE` (default `0.4`; adaptive chase slope vs distance overflow)
- `ENTRY_PRICE_MIN_RR` (default `1.8`; adaptive mode keeps entry within minimum RR floor)
- `STAGE6_EXECUTION_BUCKET_ENFORCE` (default `true`)
- `ACTIONABLE_INCLUDE_SPECULATIVE_BUY` (default `false`; when `true`, actionable verdict set becomes `BUY/STRONG_BUY/SPECULATIVE_BUY`)
- `POSITION_LIFECYCLE_ENABLED` (default `false`; enables action intent scaffold logs)
- `POSITION_LIFECYCLE_PREVIEW_ONLY` (default `true`; scaffold stays telemetry-only)
- `POSITION_LIFECYCLE_ACTION_TYPES` (default `ENTRY_NEW,HOLD_WAIT`)
- `POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION` (default `82`; minimum conviction for live `SCALE_UP` on already-held symbols)
- `POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT` (default `0.03`; block `SCALE_UP` when current price is too far above avg-entry for held long, or too far below for held short)
- `POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT` (default `0.02`; block `SCALE_UP` when intraday gain already exceeds chase guard)
- `POSITION_LIFECYCLE_SCALE_DOWN_PCT` (default `0.35`; sell ratio applied for `SCALE_DOWN`)
- `POSITION_LIFECYCLE_EXIT_PARTIAL_PCT` (default `0.5`; sell ratio applied for `EXIT_PARTIAL`)
- `POSITION_LIFECYCLE_SCALE_DOWN_MAX_CONVICTION` (default `scale_up_min-8`; held-symbol auto `SCALE_DOWN` conviction trigger upper bound)
- `POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_CONVICTION` (default `scale_down_max-12`; held-symbol auto `EXIT_PARTIAL` conviction trigger upper bound)
- `POSITION_LIFECYCLE_EXIT_FULL_MAX_CONVICTION` (default `exit_partial_max-12`; held-symbol auto `EXIT_FULL` conviction trigger upper bound)
- `POSITION_LIFECYCLE_EXIT_ON_WATCHLIST` (default `true`; allow held-symbol de-risking when Stage6 is watchlist/WAIT)
- `POSITION_LIFECYCLE_EXIT_ON_BLOCKED` (default `true`; allow held-symbol forced de-risking on Stage6 BLOCKED/HARD-RISK decisions)
- `POSITION_LIFECYCLE_EXIT_FULL_MAX_LOSS_PCT` (default `0.08`; hard full-exit loss trigger for held symbols, tighter in risk-off profile)
- `POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_LOSS_PCT` (default `0.05`; partial-exit loss trigger for held symbols, tighter in risk-off profile)
- `POSITION_LIFECYCLE_SCALE_DOWN_MAX_LOSS_PCT` (default `0.03`; scale-down loss trigger for held symbols, tighter in risk-off profile)
- `POSITION_LIFECYCLE_RISK_OFF_INTRADAY_SHOCK_PCT` (default `0.025`; risk-off intraday shock threshold for forced de-risk)
- `POSITION_LIFECYCLE_TAKE_PROFIT_PARTIAL_PCT` (default `0.18`; held-symbol partial take-profit threshold)
- `POSITION_LIFECYCLE_STALE_HOLD_DAYS` (default `15`; stale holding-period threshold for scale-down when signal quality weakens)
- `LIFECYCLE_SELFTEST` (default `false`; emits deterministic logs for `scale_up_no_position` and multi-exit over-sell guard validation)
- `APPROVAL_REQUIRED` (default `false`; when `true`, execution requires approval queue pass)
- `APPROVAL_ENFORCE_IN_PREVIEW` (default `false`; keep preview lanes collecting payload unless explicitly enabled)
- `APPROVAL_QUEUE_FILE_NAME` (default `APPROVAL_QUEUE.json`)
- `APPROVAL_REQUEST_TTL_MINUTES` (default `180`; pending request auto-expire window)
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
- `HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS` (default `168`; carry verified payload path across stage hash refresh within TTL)
- `SHADOW_DATA_BUS_ENABLED` (default `false`; enables read-only MCP shadow lane telemetry)
- `SHADOW_SOURCE_ALPACA_ENABLED` (default `true`; includes Alpaca source in shadow lane)
- `SHADOW_SOURCE_ALPHA_VANTAGE_ENABLED` (default `true`; includes Alpha Vantage source in shadow lane)
- `SHADOW_SOURCE_SEC_EDGAR_ENABLED` (default `true`; includes SEC EDGAR source in shadow lane)
- `SHADOW_SOURCE_PERPLEXITY_ENABLED` (default `true`; includes Perplexity source in shadow lane)
- `SHADOW_SOURCE_SUPABASE_ENABLED` (default `false`; includes Supabase/Postgres source in shadow lane)
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
- `HF_DRIFT_ALERT_REQUIRE_PAYLOAD` (default `true`; skip drift alert evaluation when payload count is zero)
- `ORDER_IDEMPOTENCY_ENABLED`
- `ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN`
- `ORDER_IDEMPOTENCY_TTL_DAYS`
- `PREFLIGHT_ENABLED`
- `DAILY_MAX_NOTIONAL`
- `ALLOW_ENTRY_OUTSIDE_RTH`
- `PREFLIGHT_BLOCKING_HARD_FAIL` (default `true`; when `false`, keep run green and convert preflight block into payload skip + telemetry)
- `PREFLIGHT_SOFT_CODES` (comma-separated blocking codes to keep green even when hard-fail is enabled; default `PREFLIGHT_MARKET_CLOSED`)
- `ORDER_LIFECYCLE_ENABLED`
- `ORDER_LEDGER_TTL_DAYS`
- `LIVE_ORDER_SUBMIT_ENABLED` (default `false`; when `true`, submits payloads to Alpaca in exec mode after preflight pass)
- `LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO` (default `true`; blocks live submit unless current perf gate is `GO`)
- `LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS` (default `true`; blocks live submit unless current HF live promotion status is `PASS`)
- `ENTRY_OPEN_ORDER_GUARD_ENABLED` (default `true`; skip new entry when same symbol already has open buy entry order)
- `ENTRY_OPEN_ORDER_STALE_CANCEL_ENABLED` (default `false`; when `true`, cancel stale open entry order then allow refreshed submit)
- `ENTRY_OPEN_ORDER_STALE_MINUTES` (default `180`; stale threshold for open-entry cancellation)
- `ENTRY_OPEN_ORDER_REPLACE_MIN_DELTA_BPS` (default `10`; minimum absolute price delta vs existing open entry required before stale cancel+replace)
- `ENTRY_OPEN_ORDER_REPLACE_MAX_CHASE_BPS` (default `120`; maximum allowed upward replace chase for buy entries)
- `ENTRY_OPEN_ORDER_REPLACE_COOLDOWN_MINUTES` (default `10`; minimum cooldown between stale cancel+replace actions per symbol)
- `ENTRY_OPEN_ORDER_REPLACE_MAX_PER_SYMBOL_PER_DAY` (default `3`; max stale cancel+replace actions allowed per symbol per UTC day)
- `FORCE_SEND_ONCE` (one-shot override for current hash/mode)
- `TELEGRAM_SEND_ENABLED` (default `true`; set `false` for isolated verification lanes)
- `TELEGRAM_HEARTBEAT_ON_DEDUPE`
- `TELEGRAM_MAX_MESSAGE_LENGTH` (optional, default `3900`; auto-chunk guard for long messages)
- `SIDECAR_WATCHDOG_ENABLED` (default `true`; enables stale-run fallback dispatcher workflow)
- `SIDECAR_WATCHDOG_STALE_MINUTES` (default `30`; dispatch fallback when latest dry-run is older than this)
- `SIDECAR_WATCHDOG_LOOKBACK_MINUTES` (default `180`; summary lookback window used in watchdog telemetry)
- `SIDECAR_WATCHDOG_TARGET_WORKFLOW` (default `dry-run.yml`; workflow filename to dispatch)
- `SIDECAR_WATCHDOG_BRANCH` (default `main`; branch used for fallback dispatch)
- `SIDECAR_BRIDGE_STALE_MINUTES` (optional bridge override for watchdog stale threshold; falls back to `SIDECAR_WATCHDOG_STALE_MINUTES`)
- `SIDECAR_BRIDGE_LOOP_ENABLED` (optional, default `false`; enables watchdog self-healing requeue loop mode)
- `SIDECAR_BRIDGE_LOOP_INTERVAL_MIN` (optional, default `15`; self-healing loop interval in minutes)
- `SIDECAR_BRIDGE_LOOP_MAX_RUNS` (optional, default `48`; maximum chained watchdog runs before automatic stop)
- `VALIDATION_PACK_AUTO_TRIGGER_ENABLED` (default `false`; auto-dispatch one `validation_pack=true` run when gate reaches final `20/20`)
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
- `NOTION_DB_DAILY_SNAPSHOT` (optional; target DB for workflow summary rows)
- `NOTION_DB_GUARD_ACTION_LOG` (optional; target DB for market-guard action rows)
- `NOTION_DB_HF_TUNING_TRACKER` (optional; target DB for dry-run HF tuning rows)
- `NOTION_DB_PERFORMANCE_DASHBOARD` (optional; target DB for simulation/live dashboard rows)
- `NOTION_DB_AUTOMATION_INCIDENT_LOG` (optional; target DB for failure/incident rows)
- `NOTION_DB_KEY_ROTATION_LEDGER` (optional; target DB for key verification ledger rows)
- `NOTION_SIDECAR_SYNC_ENABLED` (optional, default `true`)
- `NOTION_SIDECAR_SYNC_REQUIRED` (optional, default `false`; when `true`, Notion sync failure fails workflow)
- `NOTION_MARKET_GUARD_SYNC_ENABLED` (optional, default `true`)
- `NOTION_MARKET_GUARD_SYNC_REQUIRED` (optional, default `false`; when `true`, Notion sync failure fails workflow)
- `NOTION_GUARD_ACTION_LOG_SYNC_ENABLED` (optional, default `true`)
- `NOTION_GUARD_ACTION_LOG_SYNC_REQUIRED` (optional, default `false`; when `true`, guard action log sync failure fails workflow)
- `NOTION_HF_TUNING_TRACKER_SYNC_ENABLED` (optional, default `true`)
- `NOTION_HF_TUNING_TRACKER_SYNC_REQUIRED` (optional, default `false`; when `true`, HF tuning tracker sync failure fails workflow)
- `NOTION_PERFORMANCE_DASHBOARD_SYNC_ENABLED` (optional, default `true`)
- `NOTION_PERFORMANCE_DASHBOARD_SYNC_REQUIRED` (optional, default `false`; when `true`, performance dashboard sync failure fails workflow)
- `NOTION_AUTOMATION_INCIDENT_LOG_SYNC_ENABLED` (optional, default `true`)
- `NOTION_AUTOMATION_INCIDENT_LOG_SYNC_REQUIRED` (optional, default `false`; when `true`, incident log sync failure fails workflow)
- `NOTION_AUTOMATION_INCIDENT_LOG_ROLLUP_ENABLED` (optional, default `true`; dedupe incidents by fingerprint and update existing open row)
- `NOTION_SYNC_MAX_RETRIES` (optional, default `2`; retry count for retryable Notion HTTP statuses `429/5xx`)
- `NOTION_AUDIT_PAGE_SIZE` (optional, default `40`; number of latest Notion rows to inspect in audit)
- `NOTION_AUDIT_RUNKEY_PREFIXES` (optional, default `sidecar-`; comma-separated prefixes included in audit scope)
- `NOTION_AUDIT_STALE_MINUTES` (optional, default `240`; warn threshold for latest row freshness)
- `NOTION_AUDIT_STRICT_FAIL` (optional, default `false`; when `true`, notion audit warning/fail exits non-zero)
- `NOTION_OPS_DAILY_SYNC_ENABLED` (optional, default `true`; enable consolidated ops daily row upsert)
- `NOTION_OPS_DAILY_SYNC_REQUIRED` (optional, default `false`; when `true`, ops daily Notion sync failure fails workflow)
- `NOTION_OPS_DAILY_REQUIRE_EVIDENCE_URL` (optional, default `true`; require evidence URL and matching property (`Evidence URL`/`Run URL`/`Workflow URL`) for ops daily Notion sync)
- `NOTION_OPS_DAILY_EVIDENCE_URL_PROPERTY` (optional; explicit Notion property name for primary evidence URL, e.g. `Run Link`)
- `NOTION_OPS_DAILY_EVIDENCE_LINKS_PROPERTY` (optional; explicit rich-text property name for full evidence link bundle; workflow default fallback is `Run Actions`)
- `OPS_REPORT_LOOKBACK_HOURS` (optional, default `24`; GitHub workflow KPI lookback window for ops daily report)
- `OPS_REPORT_MAX_RUNS` (optional, default `30`; max workflow runs fetched per pipeline)
- `OPS_REPORT_CANARY_VERIFY_MAX_RUNS` (optional, default `8`; max successful canary runs inspected for verify markers)
- `OPS_REPORT_CANARY_FRESH_MAX_MIN` (optional, default `360`; canary staleness threshold in minutes for ops daily warning)
- `OPS_REPORT_CANARY_REPO` (optional, default `pungking/US_Alpha_Seeker`; canary workflow owner repo)
- `OPS_REPORT_DRYRUN_REPO` (optional, default `pungking/alpha-exec-engine`; dry-run workflow owner repo)
- `OPS_REPORT_GUARD_REPO` (optional, default `pungking/alpha-exec-engine`; market-guard workflow owner repo)
- `OPS_REPORT_CANARY_WORKFLOW` (optional, default `sidecar-preflight-canary-recheck.yml`)
- `OPS_REPORT_DRYRUN_WORKFLOW` (optional, default `dry-run.yml`)
- `OPS_REPORT_GUARD_WORKFLOW` (optional, default `market-guard.yml`)
- `NOTION_KEY_ROTATION_LEDGER_SYNC_ENABLED` (optional, default `true`)
- `NOTION_KEY_ROTATION_LEDGER_SYNC_REQUIRED` (optional, default `false`; when `true`, key-rotation ledger sync failure fails workflow)
- `NOTION_PROJECT` (optional; project page ID pointer for workspace ops)
- `NOTION_WORK_LIST` (optional; work-list DB ID pointer for workspace ops)

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
    - Payload-path verification checks payload-path viability (`payloads > 0` with tighten/size-reduce integrity), not whether HF adjustment was applied.
    - Sticky carry is TTL-based via `state/hf-live-promotion-state.json`.
    - Policy env (all default `true`):
      - `HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO`
      - `HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN`
      - `HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE`
      - `HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED`
      - `HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS` (default `168`)

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

### Notion Workflow Sync (optional)
- Dry-run workflow writes one Notion upsert row per run key: `sidecar-dryrun-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`.
- Market-guard workflow writes one upsert row per run key: `sidecar-guard-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`.
- Sync script auto-populates extra Daily Snapshot columns (`Source`, `Engine`, `Stage6 File`, `Stage6 Hash`, `Payload Count`, `Skipped Count`, `Guard Level`, `HF Gate`, `HF Live Promotion`, `Action Reason`, `Run Actions`) **only when those columns exist**.
- Required secret:
  - `NOTION_TOKEN`
- Required variable:
  - `NOTION_DB_DAILY_SNAPSHOT`
- Optional secondary DB variables:
  - `NOTION_DB_GUARD_ACTION_LOG` (market guard only)
  - `NOTION_DB_HF_TUNING_TRACKER` (dry-run only)
  - `NOTION_DB_PERFORMANCE_DASHBOARD` (simulation/live dashboard row)
  - `NOTION_DB_AUTOMATION_INCIDENT_LOG` (incident triage rows: workflow fail, guard-action fail, HF alert, ops-health warn/fail)
  - `NOTION_DB_KEY_ROTATION_LEDGER` (key presence/verification heartbeat)
- Optional workspace pointers:
  - `NOTION_PROJECT` (Notion project page ID)
  - `NOTION_WORK_LIST` (Notion work-list database ID)
- Behavior:
  - default: warning-only (workflow does not fail on Notion API/network issues)
  - incident rollup: `NOTION_AUTOMATION_INCIDENT_LOG_ROLLUP_ENABLED=true` keeps one open row per fingerprint (updates count/last-seen instead of creating duplicates)
  - retry: `NOTION_SYNC_MAX_RETRIES=2` retries transient Notion errors (`429/5xx`) before failing
  - secondary DB syncs are non-blocking by default; only fail the workflow when each `*_SYNC_REQUIRED=true`
  - strict mode: set `NOTION_SIDECAR_SYNC_REQUIRED=true` / `NOTION_MARKET_GUARD_SYNC_REQUIRED=true`
  - per-DB strict mode:
    - `NOTION_GUARD_ACTION_LOG_SYNC_REQUIRED=true`
    - `NOTION_HF_TUNING_TRACKER_SYNC_REQUIRED=true`
    - `NOTION_PERFORMANCE_DASHBOARD_SYNC_REQUIRED=true`
    - `NOTION_AUTOMATION_INCIDENT_LOG_SYNC_REQUIRED=true`
    - `NOTION_KEY_ROTATION_LEDGER_SYNC_REQUIRED=true`
- Manual Notion schema/view tune-up checklist:
  - `docs/NOTION_WORKSPACE_TUNEUP_CHECKLIST.md` (repo root)
- 20-trade gate operations runbook:
  - `docs/OPS_RUNBOOK_20TRADE_GATE.md`
- Daily operations report template:
  - `docs/OPS_DAILY_REPORT_TEMPLATE.md`
- Scale-up chase guard tuning plan:
  - `docs/SCALE_UP_CHASE_GUARD_TUNING_PLAN.md`
- Knowledge system operating model (Notion/Obsidian/NotebookLM):
  - `docs/KNOWLEDGE_SYSTEM_OPERATING_MODEL.md`

## Workflow
- Workflow ownership (avoid path confusion):
  - Execution owner (real sidecar runs): `pungking/alpha-exec-engine/.github/workflows/dry-run.yml`.
  - Watchdog owner (real sidecar freshness checks): `pungking/alpha-exec-engine/.github/workflows/dry-run-watchdog.yml`.
  - Approval owner (real sidecar approval queue updates): `pungking/alpha-exec-engine/.github/workflows/approval-queue-action.yml`.
  - Template mirror path in this repository: `/sidecar-template/alpha-exec-engine/.github/workflows/*.yml`.
  - Webapp bridge layer in `US_Alpha_Seeker`: `/.github/workflows/schedule.yml`, `/.github/workflows/sidecar-dispatch-watchdog.yml`, `/.github/workflows/dry-run.yml`, `/.github/workflows/sidecar-approval-action-bridge.yml` (manual dispatch bridges only). `schedule.yml` also kicks watchdog cadence slots.
  - Emergency self-healing mode: run `Sidecar Dispatch Watchdog` with `loop_enabled=true` to keep requeueing watchdog checks at a fixed interval even when GitHub cron slots are missed.
  - These files are intentionally separated; execution logic stays in sidecar repo, bridge logic stays in webapp repo.
  - Integration status baseline (2026-04-22): `docs/AUTOMATION_PIPELINE_INTEGRATION_AUDIT_2026-04-22.md`.
  - Handoff strict-mode switch checklist: `docs/HANDOFF_OPERATIONAL_SWITCH_CHECKLIST.md`.
  - Approval one-click operations runbook: `docs/APPROVAL_QUEUE_ONE_CLICK_RUNBOOK.md`.
- `sidecar-ci`: typecheck/build gate on push/PR.
- `sidecar-dry-run`: manual + scheduled dry-run with state cache restore/save.
  - Publishes concise run summary to GitHub Step Summary.
  - Also supports `repository_dispatch` (`type=stage6_result_created`) for one-shot run right after a new Stage6 dump is generated.
    - Optional `client_payload`: `stage6Hash`, `stage6File`, `sourceRunId` (included in Step Summary trigger trace).
  - Default schedule runs weekday UTC `13-21` every 15 minutes (`5,20,35,50`) for simulation-for-live monitoring.
    - This single UTC window covers both EDT/EST seasons without manual cron edits.
    - Market-closed/entry-blocking cases are still controlled by preflight gate (`PREFLIGHT_*`).
    - Recommended lifecycle vars (simulation mode): `POSITION_LIFECYCLE_ENABLED=true`, `POSITION_LIFECYCLE_PREVIEW_ONLY=true`, `POSITION_LIFECYCLE_ACTION_TYPES=ENTRY_NEW,HOLD_WAIT,SCALE_UP,SCALE_DOWN,EXIT_PARTIAL,EXIT_FULL`.
  - Manual dispatch inputs:
    - `run_verify_mode=safe_default|submit_pass|guard_skip_pass|auto`:
      - `safe_default` (default): forces safe lane (`READ_ONLY=true`, `EXEC_ENABLED=false`, `SIMULATION_LIVE_PARITY=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`).
      - `submit_pass`: forces submit-verification lane (`READ_ONLY=false`, `EXEC_ENABLED=true`, `SIMULATION_LIVE_PARITY=true`, `LIVE_ORDER_SUBMIT_ENABLED=true`, `ENTRY_OPEN_ORDER_GUARD_ENABLED=false`).
      - `guard_skip_pass`: same as submit lane + open-entry guard strictness (`ENTRY_OPEN_ORDER_GUARD_ENABLED=true`, `ENTRY_OPEN_ORDER_STALE_CANCEL_ENABLED=false`).
      - `auto`: keeps repository variable defaults without verify-mode overrides.
    - `validation_pack=true`: OFF/ON/STRICT entry feasibility validation in one run.
      - Before pack execution, workflow runs `npm run verify:hf` (build-once unit+fixture regression gate).
    - `payload_probe=true`: one-shot payload path probe with temporary `DRY_RISK_OFF_MIN_CONVICTION` override (`payload_probe_min_conviction`).
      - Probe step is executed with temporary dry-safe overrides (`READ_ONLY=true`, `EXEC_ENABLED=false`, `SIMULATION_LIVE_PARITY=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`) to allow probe mutation without live-submit risk.
    - `payload_probe_mode=tighten|relief`: force HF path on a selected executable candidate (workflow_dispatch + preview-only safe lane).
    - `run_disable_order_idempotency=true`: disable idempotency gate for one manual validation run.
    - `run_dry_max_orders_override=<int>`: override `DRY_MAX_ORDERS` for one manual run.
    - `run_dry_max_total_notional_override=<number>`: override `DRY_MAX_TOTAL_NOTIONAL` for one manual run.
  - Non-`validation_pack` runs execute `npm run check:json-parse-guard` right after build.
  - Optional auto-dispatch (`VALIDATION_PACK_AUTO_TRIGGER_ENABLED=true`):
    - when `hf_tuning_phase.gateProgress` reaches `20/20` with final gate status (`GO` or `NO_GO`), dispatches a one-shot `validation_pack=true`.
    - skipped for manual `validation_pack=true` or `payload_probe=true` runs.
    - dedupe ledger: `state/validation-pack-auto-trigger.json` (`batchId + gateStatus + gateProgress` key).
  - Step Summary now includes `skip_reasons` distribution for faster `payload=0` diagnosis.
  - HF marker audit (warning-only):
    - Workflow stores marker status at `state/hf-marker-audit.json`.
    - Expected keywords in run log: `[HF_SOFT_GATE]`, `[HF_PAYLOAD_PROBE]`, `[HF_PAYLOAD_PROBE_STATUS]`, `[HF_PAYLOAD_PATH_STICKY]`, `[HF_EVIDENCE]`, `[HF_DRIFT]` or `[HF_DRIFT_SUMMARY]`, `[HF_SHADOW]`, `[HF_TUNING_PHASE]`, `[HF_TUNING_ADVICE]`, `[HF_FREEZE]`, `[HF_LIVE_PROMOTION]`, `[HF_NEXT_ACTION]`, `[HF_DAILY_VERDICT]`, `[HF_ALERT]` or `[HF_ALERT_SUMMARY]`, `[SHADOW_PARSE]`, and `[RUN_SUMMARY] ... hf_payload_probe_forced=... hf_payload_probe_status=... hf_payload_path_sticky=... hf_evidence=... hf_drift=... hf_shadow=... hf_shadow_trend=... hf_tuning_phase=... hf_tuning_advice=... hf_freeze=... hf_live_promotion=... hf_next_action=... hf_daily_verdict=... hf_alert=... shadow_data_bus=... shadow_parse=...`.
    - Missing markers only emit warning (`[HF_MARKER_AUDIT] ...`), run still passes.
  - Step Summary includes:
    - `hf_verify_gate` (`outcome/mode`; `validation_pack=true`일 때 verify gate 선행 실행 결과)
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
    - `shadow_data_bus` (`enabled/mode/sources/keyReadiness`)
    - `shadow_parse` (`total/av/sec coverage + symbol samples`)
    - `hf_marker_audit` (`soft/drift/runSummary/shadow/runSummaryShadow/runSummaryShadowTrend/tuningPhase/runSummaryTuningPhase/tuningAdvice/runSummaryTuningAdvice/freeze/runSummaryFreeze/payloadProbe/runSummaryPayloadProbe/alert/runSummaryAlert/livePromotion/runSummaryLivePromotion/nextAction/runSummaryNextAction/dailyVerdict/runSummaryDailyVerdict/payloadPathSticky/runSummaryPayloadPathSticky/evidence/runSummaryEvidence` as `ok|missing`)
  - Uploads `state/last-run.json`, `state/last-dry-exec-preview.json`, `state/hf-marker-audit.json`, `state/hf-shadow-last.json`, `state/hf-shadow-history.jsonl`, `state/hf-evidence-history.jsonl`, `state/hf-tuning-freeze.json`, `state/hf-live-promotion-state.json`, `state/last-run-output.log`, `state/order-idempotency.json`, `state/order-ledger.json`, `state/open-entry-replace-guard.json`, `state/regime-guard-state.json`, `state/validation-pack-auto-trigger.json` as run artifacts.
- `sidecar-payload-probe-isolated`: manual probe-only safe lane for payload path verification.
  - Forces dry preview mode (`READ_ONLY=true`, `EXEC_ENABLED=false`) with `HF_PAYLOAD_PROBE_MODE=tighten|relief`.
  - Disables Telegram sends in-lane (`TELEGRAM_SEND_ENABLED=false`) to avoid notification noise.
  - Does **not** restore/save `state` cache and does **not** sync Notion (no persistent baseline contamination).
  - Uploads probe artifacts only (`state/last-run.json`, `state/last-dry-exec-preview.json`, `state/payload-probe/**`).
- `sidecar-approval-queue-action`: one-click manual approve/reject workflow for `APPROVAL_QUEUE.json` (Drive) without JSON hand edits.
  - Inputs: `action`, `request_id` (preferred) or `symbol(+stage6_hash)`, optional `reason`, optional `dry_run=true`.
  - Updates only the latest matching `pending` row by default and stamps `resolvedAt/resolvedBy`.
- `sidecar-market-guard`: manual + weekday 5-minute guard run.
  - Publishes level/signal/action summary to Step Summary.
  - Uploads guard state artifacts (`last-market-guard`, `market-guard-state`, `guard-action-ledger`) plus core state files.

## Trading Dashboard Snapshot
- Both workflows now generate a dashboard snapshot after run summary:
  - `state/performance-dashboard.json` (chart-ready machine data)
  - `state/performance-dashboard.md` (human-readable summary appended to Step Summary)
- Simulation source:
  - `state/stage6-20trade-loop.json` (`rows` + `snapshots`)
  - `Sim Rows` = cumulative loop rows (history total), `latest snapshot tradeCount` = latest KPI snapshot count.
  - Snapshot is refreshed on every touched run and auto-resynced when row/snapshot counts drift.
  - KPI source marker (`kpiSource`) is included in snapshots:
    - `realized` = filled/closed telemetry available
    - `proxy_preflight` = fallback proxy from `preflight=PREFLIGHT_PASS` rows when realized telemetry is missing
    - `none` = insufficient KPI telemetry
- Live source (optional, auto-detected):
  - Alpaca `/v2/account`, `/v2/positions`, `/v2/orders?status=open`
  - When Alpaca credentials are unavailable, live section is marked `N/A` and run continues.
- Manual build:
  - `npm run dashboard:perf`
- Optional Notion sync:
  - `NOTION_DB_PERFORMANCE_DASHBOARD`
  - `NOTION_PERFORMANCE_DASHBOARD_SYNC_ENABLED` (default `true`)
  - `NOTION_PERFORMANCE_DASHBOARD_SYNC_REQUIRED` (default `false`)
  - Percent backfill controls (manual only):
    - `NOTION_PERF_PERCENT_BACKFILL_DRY_RUN` (default `true`)
    - `NOTION_PERF_PERCENT_BACKFILL_THRESHOLD` (default `1`; fix rows when `abs(value) > threshold`)
    - `NOTION_PERF_PERCENT_BACKFILL_ROUND_ALL` (default `false`; round in-range percent rows too)
    - `NOTION_PERF_PERCENT_BACKFILL_DISPLAY_DIGITS` (default `2`; visible percent digits target)
    - `NOTION_PERF_PERCENT_BACKFILL_PAGE_SIZE` (default `100`)
    - `NOTION_PERF_PERCENT_BACKFILL_MAX_PAGES` (default `50`)
  - Recommended DB columns:
    - `Run Key`(title), `Time`(date), `Kind`(select), `Status`(select), `Batch ID`(text)
    - `Sim Rows`, `Sim Snapshot Trades`(optional), `Sim Rows vs Snapshot Gap`(optional), `Sim Filled`, `Sim Open`, `Sim Closed`, `Sim Win Rate %`, `Sim Avg Closed Return %`, `Sim Avg Closed R`(number)
    - `Sim Top Winners`, `Sim Top Losers`, `Series`, `Summary`(text)
    - `Live Available`(checkbox), `Live Position Count`, `Live Unrealized PnL`, `Live Return %`, `Live Equity`(number)

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
