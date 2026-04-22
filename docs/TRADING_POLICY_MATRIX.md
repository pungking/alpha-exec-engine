# Trading Policy Matrix (Paper/Live)

This matrix is the operator contract for sidecar action generation.
Source of truth remains `STAGE6_ALPHA_FINAL_*.json` and runtime env flags.

## 1) Entry / Hold / Add

| Situation | Required conditions | Action | Notes |
|---|---|---|---|
| New long entry | Stage6 actionable (`BUY/STRONG_BUY`, optional `SPECULATIVE_BUY`) + Stage6 contract executable + conviction floor pass + preflight pass | `ENTRY_NEW` | Built as bracket (`limit + TP + SL`) |
| Maintain / no trade | Candidate fails gates, weak conviction, or non-executable Stage6 state | `HOLD_WAIT` | No submit |
| Add to held position | Held symbol + executable + conviction >= `POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION` + action allowed | `SCALE_UP` | Live lane only when held qty exists |
| Chase guard (new) | Held symbol scale-up request but (price-vs-avg-entry) > `POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT` OR intraday gain > `POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT` | `HOLD_WAIT` | Prevents overpaying momentum |

## 2) De-risk / Exit

| Situation | Required conditions | Action |
|---|---|---|
| Hard risk / blocked / stale state | Stage6 blocked or symbol lifecycle hard-exit state | `EXIT_FULL` (fallback to partial/scale-down if action not allowed) |
| Large loss breach | Unrealized PnL below `EXIT_FULL_MAX_LOSS_PCT` | `EXIT_FULL` |
| Risk-off de-risk | risk-off + loss/intraday shock/forced risk-off quality | `EXIT_PARTIAL` |
| Conviction deterioration | conviction below configured thresholds | `SCALE_DOWN` / `EXIT_PARTIAL` / `EXIT_FULL` by threshold level |
| Take-profit trim | Unrealized gain >= `TAKE_PROFIT_PARTIAL_PCT` with weak/watchlist context | `EXIT_PARTIAL` |

## 3) Execution Safety Chain (must pass in order)

1. Stage6 contract + payload geometry checks  
2. Regime / guard-control / approval queue gates  
3. Preflight (`/v2/account`, `/v2/clock`, buying power, RTH rule)  
4. Perf gate + HF live promotion gate (when required)  
5. Broker submit (`LIVE_ORDER_SUBMIT_ENABLED=true`, exec mode, non-read-only)

## 4) Non-negotiable defaults

- `EXEC_ENABLED=false`
- `READ_ONLY=true`
- `POSITION_LIFECYCLE_PREVIEW_ONLY=true`
- `LIVE_ORDER_SUBMIT_ENABLED=false`

Any live flip requires explicit operator approval and runbook evidence.

## 5) Paper-to-live readiness checks

- Canary evidence: `preflight_pass=true`, `attempted>=1`, `submitted>=1`
- No repeated `client_order_id` hard-fail (retry path should resolve duplicates)
- Skip reason distribution stable (no chronic `preflight_blocked` / dedupe false positives)
- Guard and approval telemetry remain green
