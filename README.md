# alpha-exec-engine (Sidecar)

Execution/simulation sidecar for `US_Alpha_Seeker`.

## Scope
- Reads Stage6 outputs and applies execution policy.
- Sends execution/simulation Telegram events.
- Does **not** modify the analysis engine logic.

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

## Policy
- Version: `stage6-exec-v1.0-rc1`
- Source of truth: `STAGE6_ALPHA_FINAL_*.json`
