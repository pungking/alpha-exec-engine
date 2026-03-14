# P3-3 Active Execution Test Checklist

Use this checklist to validate `market-guard` active execution safely, one step at a time.

---

## 0) Safety Baseline (required before all tests)

- [ ] `ALPACA_BASE_URL=https://paper-api.alpaca.markets` (paper only)
- [ ] `MARKET_GUARD_ENABLED=true`
- [ ] `MARKET_GUARD_MODE=active`
- [ ] `MARKET_GUARD_INTERVAL_MIN=1` (temporary for test cycle)
- [ ] `GUARD_ACTION_COOLDOWN_MIN=1` (temporary for test cycle)
- [ ] `GUARD_ALLOW_OUTSIDE_RTH=true` (temporary for test cycle)
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=true` (per test run)
- [ ] `GUARD_EXECUTE_TIGHTEN_STOPS=false`
- [ ] `GUARD_EXECUTE_REDUCE_POSITIONS=false`
- [ ] `GUARD_EXECUTE_FLATTEN=false`

Evidence
- run id:
- artifact:
- notes:

---

## 0.5) Entry Feasibility Gate Dry-Run Validation (recommended)

Goal: verify new entry-feasibility gate is safe when OFF and deterministic when ON.

### TC-0.5A (OFF, baseline parity)

- [x] `ENTRY_FEASIBILITY_ENFORCE=false`
- [x] Run `sidecar-dry-run` once
- [x] Confirm payload/skipped count parity with previous baseline hash/mode
- [x] Confirm no new skip reason (`entry_*`) appears

Evidence
- run id: `23088915967` (`https://github.com/pungking/alpha-exec-engine/actions/runs/23088915967`)
- key log line: `[ENTRY_FEASIBILITY] enforce=false maxDistancePct=15 checked=0 blocked=0`
- payload/skipped: `2 / 3` (`skip reasons: conviction_below_floor=3`)

### TC-0.5B (ON, gate visibility)

- [x] `ENTRY_FEASIBILITY_ENFORCE=true`
- [x] `ENTRY_MAX_DISTANCE_PCT=15`
- [x] Run `sidecar-dry-run` once
- [x] Confirm summary contains `entry_feas_enforce=true` and checked/blocked counters
- [x] If filtered, confirm skip reasons are deterministic (`entry_too_far_from_market`, etc.)

Evidence
- run id: `23088939432` (validation pack 포함, `https://github.com/pungking/alpha-exec-engine/actions/runs/23088939432`)
- key log line: `[ENTRY_FEASIBILITY] enforce=true maxDistancePct=15 checked=2 blocked=0`
- skipped reasons: `conviction_below_floor=3` (entry gate 추가 차단 없음)

### TC-0.5C (one-shot pack, credit-saving)

Use one workflow run to execute OFF/ON/STRICT sequentially.

- [x] Open `sidecar-dry-run` -> **Run workflow**
- [x] Set input `validation_pack=true`
- [x] Confirm Step Summary includes `Entry Feasibility Validation Pack` table
- [x] Confirm rows:
  - `off` => `enforce=false/maxDist=15`
  - `on` => `enforce=true/maxDist=15`
  - `strict` => `enforce=true/maxDist=1`
- [x] Confirm artifact includes `state/validation-pack/**` files

Evidence
- run id: `23088939432` (`https://github.com/pungking/alpha-exec-engine/actions/runs/23088939432`)
- summary table snapshot:
  - `off`: payload/skipped=`2/3`, `entryFeas checked/blocked=0/0`
  - `on`: payload/skipped=`2/3`, `entryFeas checked/blocked=2/0`
  - `strict`: payload/skipped=`0/5`, `entryFeas checked/blocked=2/2`
- artifact: `sidecar-state-23088939432.zip` (contains `state/validation-pack/off|on|strict/*`)

---

## 1) TC-1 blocked_safety_mode validation

Goal: confirm active mode actions are blocked when safety gate is closed.

### Variable overrides

- [ ] `EXEC_ENABLED=false`
- [ ] `READ_ONLY=true`
- [ ] `GUARD_FORCE_LEVEL=l2`
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=true`

### Execute

- [ ] Run `sidecar-market-guard` once

### Expected

- [ ] log contains `action=actions_allowed`
- [ ] log contains `[GUARD_LEDGER] ... blocked=` with value `>=1`
- [ ] Telegram Actions lines include `status=blocked_safety_mode`

Evidence
- run id:
- key log line:
- Telegram snippet:

---

## 2) TC-2 tighten_stops focused validation

Goal: allow live gate and validate `tighten_stops` path first.

### Preconditions

- [ ] account has at least one position (or `skipped_not_applicable` is expected)

### Variable overrides

- [ ] `EXEC_ENABLED=true`
- [ ] `READ_ONLY=false`
- [ ] `GUARD_FORCE_LEVEL=l3`
- [ ] `GUARD_EXECUTE_TIGHTEN_STOPS=true`
- [ ] `GUARD_EXECUTE_REDUCE_POSITIONS=false`
- [ ] `GUARD_EXECUTE_FLATTEN=false`
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=true`

### Execute

- [ ] Run `sidecar-market-guard` once

### Expected

- [ ] `tighten_stops` -> `executed` OR `skipped_not_applicable`
- [ ] `reduce_positions_50` -> `skipped_policy`
- [ ] `flatten_if_triggered` -> `skipped_policy`

Evidence
- run id:
- key log line:
- Telegram snippet:

---

## 3) TC-3 cancel_open_entries staged activation

Goal: validate cancellation logic safely before position reduction.

### Preconditions

- [ ] create at least one open BUY order in Alpaca paper
- [ ] wait for cooldown window from previous run (`>=2 min` when cooldown base is `1`)

### Variable overrides

- [ ] `EXEC_ENABLED=true`
- [ ] `READ_ONLY=false`
- [ ] `GUARD_FORCE_LEVEL=l3`
- [ ] `GUARD_EXECUTE_TIGHTEN_STOPS=false`
- [ ] `GUARD_EXECUTE_REDUCE_POSITIONS=false`
- [ ] `GUARD_EXECUTE_FLATTEN=false`
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=true`

### Execute

- [ ] Run `sidecar-market-guard` once

### Expected

- [ ] `cancel_open_entries` -> `executed`
- [ ] detail includes `canceled=...`

Evidence
- run id:
- key log line:
- order check:

---

## 4) TC-4 reduce_positions_50 staged activation

Goal: validate controlled reduction after cancellation path is proven.

### Preconditions

- [ ] account has positions
- [ ] no test-only open buy orders pending
- [ ] cooldown window has elapsed

### Variable overrides

- [ ] `EXEC_ENABLED=true`
- [ ] `READ_ONLY=false`
- [ ] `GUARD_FORCE_LEVEL=l3`
- [ ] `GUARD_EXECUTE_TIGHTEN_STOPS=false`
- [ ] `GUARD_EXECUTE_REDUCE_POSITIONS=true`
- [ ] `GUARD_EXECUTE_FLATTEN=false`
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=true`

### Execute

- [ ] Run `sidecar-market-guard` once

### Expected

- [ ] `reduce_positions_50` -> `executed`
- [ ] detail includes `submitted=...`
- [ ] `flatten_if_triggered` remains `skipped_policy`

Evidence
- run id:
- key log line:
- position delta:

---

## 5) Troubleshooting checklist

- [ ] `[GUARD_INTERVAL] skip` -> set `MARKET_GUARD_FORCE_SEND_ONCE=true` or wait interval
- [ ] `action_reason=cooldown_active` -> wait cooldown and rerun
- [ ] `action_reason=market_closed_guard` -> check `GUARD_ALLOW_OUTSIDE_RTH=true`
- [ ] Alpaca auth/base URL mismatch -> re-check secrets and `ALPACA_BASE_URL`

---

## 6) Rollback to safe defaults (mandatory after testing)

- [ ] `EXEC_ENABLED=false`
- [ ] `READ_ONLY=true`
- [ ] `MARKET_GUARD_MODE=observe`
- [ ] `GUARD_FORCE_LEVEL=auto`
- [ ] `MARKET_GUARD_FORCE_SEND_ONCE=false`
- [ ] `GUARD_ALLOW_OUTSIDE_RTH=false`
- [ ] `GUARD_EXECUTE_TIGHTEN_STOPS=false`
- [ ] `GUARD_EXECUTE_REDUCE_POSITIONS=false`
- [ ] `GUARD_EXECUTE_FLATTEN=false`
- [ ] `GUARD_ACTION_COOLDOWN_MIN=15`
- [ ] `MARKET_GUARD_INTERVAL_MIN=5`

Sign-off
- completed by:
- date:
- final run id:
