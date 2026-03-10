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
- Supports regime auto profile switch by VIX (default/risk-off presets).
- Supports VIX source priority (`realtime_first` vs `snapshot_first`) with snapshot staleness guard.
- Regime diagnostics are logged as `[REGIME_DIAG]` (priority, snapshot freshness, finnhub/cnbc fallback reasons).
- Persists local run state in `state/last-run.json` and skips duplicate sends for same hash/mode.
- Optional one-line Telegram heartbeat on dedupe skip (`TELEGRAM_HEARTBEAT_ON_DEDUPE=true`).
- Saves dry-exec payload snapshot to `state/last-dry-exec-preview.json`.

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
- `TELEGRAM_HEARTBEAT_ON_DEDUPE`
- `REGIME_AUTO_ENABLED`
- `REGIME_FORCE_PROFILE` (`auto|default|risk_off`)
- `REGIME_VIX_SOURCE_PRIORITY` (`realtime_first|snapshot_first`)
- `REGIME_SNAPSHOT_MAX_AGE_MIN` (set `0` to disable stale guard)
- `VIX_RISK_ON_THRESHOLD`
- `VIX_RISK_OFF_THRESHOLD`
- `CNBC_RAPIDAPI_HOST` (optional, default `cnbc.p.rapidapi.com`)
- `GDRIVE_ROOT_FOLDER_ID`
- `GDRIVE_MARKET_SNAPSHOT_FOLDER_ID` (optional explicit folder for `MARKET_REGIME_SNAPSHOT.json`)
- `GDRIVE_STAGE6_FOLDER`
- `GDRIVE_REPORT_FOLDER`
- `TELEGRAM_PRIMARY_CHAT_ID`
- `TELEGRAM_SIMULATION_CHAT_ID`

### Ops Presets (2 profiles)
- `DRY_DEFAULT_*` : market normal profile
- `DRY_RISK_OFF_*` : high-volatility defensive profile

If profile-specific vars are empty, runtime falls back to legacy `DRY_*` values.

### Runtime Guard
`src/index.ts` validates required env keys at startup and exits with non-zero code on missing values.

## Workflow
- `sidecar-ci`: typecheck/build gate on push/PR.
- `sidecar-dry-run`: manual + scheduled dry-run with state cache restore/save.

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
