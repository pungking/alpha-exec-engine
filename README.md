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
- Persists local run state in `state/last-run.json` and skips duplicate sends for same hash/mode.
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

### Variables (GitHub Actions)
- `ALPACA_BASE_URL`
- `EXEC_ENABLED`
- `READ_ONLY`
- `TZ`
- `DRY_NOTIONAL_PER_TRADE`
- `DRY_MAX_ORDERS`
- `GDRIVE_ROOT_FOLDER_ID`
- `GDRIVE_STAGE6_FOLDER`
- `GDRIVE_REPORT_FOLDER`
- `TELEGRAM_PRIMARY_CHAT_ID`
- `TELEGRAM_SIMULATION_CHAT_ID`

### Runtime Guard
`src/index.ts` validates required env keys at startup and exits with non-zero code on missing values.

## Workflow
- `sidecar-ci`: typecheck/build gate on push/PR.
- `sidecar-dry-run`: manual + scheduled dry-run with state cache restore/save.

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
