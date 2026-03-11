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
- Payload gate enforces total notional cap (`DRY_MAX_TOTAL_NOTIONAL`).
- Payload JSON is validated/normalized before use (2-decimal rounding, finite/non-negative checks, bracket geometry, `client_order_id` format).
- Supports regime auto profile switch by VIX (default/risk-off presets).
- Supports VIX source priority (`realtime_first` vs `snapshot_first`) with snapshot staleness guard.
- Realtime chain: `Finnhub -> CNBC Direct -> CNBC RapidAPI -> Snapshot`.
- Regime diagnostics are logged as `[REGIME_DIAG]` (priority, snapshot freshness, finnhub/cnbc fallback reasons).
- Data quality guard scores VIX source health/mismatch/staleness and can force defensive profile + block new entries.
- Regime hysteresis + minimum hold time reduce profile flapping (`risk_off` recovery only after on-threshold and hold).
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

## Safety Defaults
- `EXEC_ENABLED=false`
- `READ_ONLY=true`

These defaults must stay until dry-run validation is complete.

## Quick Start
```bash
npm install
npm run build
node dist/src/index.js
```

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
- `DRY_MIN_STOP_DISTANCE_PCT`
- `DRY_MAX_STOP_DISTANCE_PCT`
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
- `REGIME_AUTO_ENABLED`
- `REGIME_FORCE_PROFILE` (`auto|default|risk_off`)
- `REGIME_VIX_SOURCE_PRIORITY` (`realtime_first|snapshot_first`)
- `REGIME_SNAPSHOT_MAX_AGE_MIN` (set `0` to disable stale guard)
- `REGIME_QUALITY_GUARD_ENABLED`
- `REGIME_QUALITY_MIN_SCORE`
- `REGIME_HYSTERESIS_ENABLED`
- `REGIME_MIN_HOLD_MIN`
- `REGIME_VIX_MISMATCH_PCT`
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

### Runtime Guard
`src/index.ts` validates required env keys at startup and exits with non-zero code on missing values.

## Workflow
- `sidecar-ci`: typecheck/build gate on push/PR.
- `sidecar-dry-run`: manual + scheduled dry-run with state cache restore/save.
  - Publishes concise run summary to GitHub Step Summary.
  - Uploads `state/last-run.json`, `state/last-dry-exec-preview.json`, `state/order-idempotency.json`, `state/order-ledger.json`, `state/regime-guard-state.json` as run artifacts.
- `sidecar-market-guard`: manual + weekday 5-minute guard run.
  - Publishes level/signal/action summary to Step Summary.
  - Uploads guard state artifacts (`last-market-guard`, `market-guard-state`, `guard-action-ledger`) plus core state files.

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
