# Paper Trading Rollout Status

Last updated: 2026-04-22 02:15 KST (2026-04-21 17:15 UTC)

## Purpose
- Keep one operational source of truth for "what is done / what is pending" in sidecar paper-trading rollout.
- Remove confusion between template code (`US_Alpha_Seeker`) and live runtime repo (`alpha-exec-engine`).

## Terminology (locked)
- In this project, "simulation" means **paper trading**.
- Paper trading = order path may be executed, but only to `ALPACA_BASE_URL=https://paper-api.alpaca.markets`.

## Repo Ownership (critical)
- Runtime owner (actual execution): `pungking/alpha-exec-engine`
- Bridge/watchdog owner (dispatch/freshness): `pungking/US_Alpha_Seeker`
- Template mirror path in this repo: `sidecar-template/alpha-exec-engine/**`

If template code is updated, runtime repo must receive the same patch separately.

## Current Runtime Posture (paper lane)
- `EXEC_ENABLED=true`
- `READ_ONLY=false`
- `LIVE_ORDER_SUBMIT_ENABLED=true`
- `ALPACA_BASE_URL=https://paper-api.alpaca.markets`
- `APPROVAL_REQUIRED=true`
- `POSITION_LIFECYCLE_ENABLED=true`
- `POSITION_LIFECYCLE_PREVIEW_ONLY=true`
- Canary exposure caps:
  - `DRY_DEFAULT_MAX_ORDERS=2`
  - `DRY_DEFAULT_NOTIONAL_PER_TRADE=100`
  - `DRY_DEFAULT_MAX_TOTAL_NOTIONAL=200`
  - `DRY_RISK_OFF_MAX_ORDERS=1`
  - `DRY_RISK_OFF_NOTIONAL_PER_TRADE=100`
  - `DRY_RISK_OFF_MAX_TOTAL_NOTIONAL=100`

## Recent Validation Evidence
- `24735577239` (sidecar dry-run): submit lane enabled, but `payloads=0`.
- `24735674022` (sidecar dry-run): submit lane enabled, but `payloads=0` (`idempotency_duplicate` path).
- `24735757832` (sidecar dry-run, one-shot idempotency bypass):
  - `attempted=2`, `submitted=0`, `failed=2`
  - broker error: `422 fractional orders must be simple orders`
  - interpretation: broker submit path is alive, but entry order shape is rejected.

## Code State
- Template patch committed in `US_Alpha_Seeker`:
  - commit: `b38f55f`
  - file: `sidecar-template/alpha-exec-engine/src/index.ts`
  - change: convert entry submit body from `notional` to whole-share `qty`.

### Gap to close
- Runtime repo `alpha-exec-engine` still needs the same order-shape patch.
- Until runtime patch is applied, paper orders remain blocked by 422.

## Automation Status
- Bridge watchdog loop mode enabled in `US_Alpha_Seeker`:
  - run `24734967270` completed and requeued next loop run.
  - run `24735648961` currently in progress (loop wait/requeue pattern).
- Goal: keep sidecar dispatch cadence alive even when schedule slots stall.

## Next Actions (strict order)
1. Apply the `notional -> qty` patch to runtime repo `alpha-exec-engine`.
2. Trigger one canary run with idempotency bypass (`run_disable_order_idempotency=true`).
3. Confirm at least one broker submit success (`submitted>=1`) in paper lane.
4. Re-enable normal idempotency behavior and monitor 3-5 consecutive runs.
5. If stable, keep current low caps until separate scale-up approval.

## Done-When Criteria
- Dry-run log no longer shows `fractional orders must be simple orders`.
- `BROKER_SUBMIT` summary shows `attempted>0` and `submitted>=1` in paper account.
- Watchdog loop continues requeueing without stale gaps beyond configured threshold.

