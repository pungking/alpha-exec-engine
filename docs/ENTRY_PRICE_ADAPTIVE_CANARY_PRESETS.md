# Entry Price Adaptive Canary Presets

## Objective
Increase paper-trading fill probability without breaking core risk geometry.

## Preset A (conservative, recommended first)
- `ENTRY_PRICE_MODE=adaptive`
- `ENTRY_PRICE_MAX_CHASE_PCT=1.8`
- `ENTRY_PRICE_DISTANCE_TRIGGER_PCT=2.5`
- `ENTRY_PRICE_DISTANCE_SCALE=0.35`
- `ENTRY_PRICE_MIN_RR=1.8`

Expected behavior:
- Small/controlled chase only when Stage6 distance is materially wide.
- RR floor remains strict enough to avoid quality collapse.

## Preset B (aggressive canary only)
- `ENTRY_PRICE_MODE=adaptive`
- `ENTRY_PRICE_MAX_CHASE_PCT=3.0`
- `ENTRY_PRICE_DISTANCE_TRIGGER_PCT=1.5`
- `ENTRY_PRICE_DISTANCE_SCALE=0.50`
- `ENTRY_PRICE_MIN_RR=1.6`

Expected behavior:
- Faster fill convergence, higher risk of edge compression.
- Use only as bounded canary; compare realized fill/slippage before promoting.

## Canary workflow guidance
Use `Sidecar Preflight Canary Recheck` inputs:
- `run_entry_price_mode`
- `run_entry_price_max_chase_pct`
- `run_entry_price_distance_trigger_pct`
- `run_entry_price_distance_scale`
- `run_entry_price_min_rr`
- `verify_entry_price_tuning=true`
- matching `expected_entry_price_*` values

Pass criteria:
- workflow success
- `preflight_pass=true`
- `attempted>=1, submitted>=1`
- `entry_price_tuning_pass=true`

## Promotion rule
- Promote only when Preset A shows stable fill improvement across at least 3 market sessions
  and no material deterioration in `avgR` / stop-hit pattern.
- Keep `strict` as rollback default.
