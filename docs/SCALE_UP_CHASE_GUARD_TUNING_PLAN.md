# Scale-Up Chase Guard Tuning Plan

This plan tunes add-on entry (`SCALE_UP`) controls for real-world execution quality.

## Objective

Minimize overpay/chasing risk while preserving valid momentum adds.

## Current Guard Variables

- `POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT` (default `0.03`)
- `POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT` (default `0.02`)

## Decision Signals

- `scale_up_chase_guard`
- `scale_up_intraday_chase_guard`
- `existing_position_scale_up`

## Tuning Protocol (Paper First)

### Step 1: Baseline (3 trading days)

- Keep defaults:
  - chase from avg entry: `0.03`
  - intraday gain: `0.02`
- Collect:
  - `scale_up attempts`
  - `scale_up blocked by chase guards`
  - `accepted submits`
  - post-add adverse excursion proxy (if available from ledger/perf notes)

### Step 2: Conservative Variant (next 2 days)

- Set:
  - chase from avg entry: `0.02`
  - intraday gain: `0.015`
- Compare to baseline:
  - reduction in poor fills / immediate drawdown
  - impact on opportunity loss (`SCALE_UP` conversion drop)

### Step 3: Balanced Variant (next 2 days)

- Set:
  - chase from avg entry: `0.025`
  - intraday gain: `0.018`
- Compare against Step 2 and choose stable regime default.

## Promotion Criteria

Use the variant that satisfies all:

1. No increase in safety incidents (`preflight`/submit failures not attributable to market closure)
2. `submitted/attempted` for `SCALE_UP` remains operationally healthy
3. Guard blocks are meaningful (not near-zero, not excessive)
4. Daily ops report remains `GREEN` for 3 consecutive trading days

## Rollback Rule

If `SCALE_UP` conversion collapses or drawdown worsens materially, revert to prior setting immediately and log incident in daily report.

## Evidence Checklist

- Canary pass evidence (`preflight_pass=true`, `attempted>=1`, `submitted>=1`)
- Run summary lines containing guard reason counts
- Daily report entries for each tuning step
