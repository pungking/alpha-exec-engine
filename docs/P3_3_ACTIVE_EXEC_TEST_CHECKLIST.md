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

## 0.6) Stage6 Decision-Contract + Sidecar Alignment (smoke, PASS)

Goal: validate Stage6 execution-first contract is stable and sidecar parser reads the same interpretation.

### TC-0.6A (Stage6 decision contract integrity)

- [x] Stage6 run completed with `Execution-only` selection
- [x] `Decision dist(primary)` and `Decision dist(top6)` are logically consistent
- [x] `Watchlist(Model Top6)` includes `finalDecision/decisionReason` pair
- [x] Final dump created in Drive (`STAGE6_ALPHA_FINAL_*`)

Evidence
- stage6 output files:
  - `STAGE6_PART2_AI_RESULT_FULL_2026-03-15_02-08-20.json`
  - `STAGE6_ALPHA_FINAL_2026-03-15_02-08-22.json`
- key log lines:
  - `Execution-only: executable=3 selected=3 dropped_watchlist=5`
  - `Decision dist(primary): EXECUTABLE_NOW=3 WAIT_PRICE=2 BLOCKED_RISK=3 BLOCKED_EVENT=0`
  - `Decision dist(top6): EXECUTABLE_NOW=3 WAIT_PRICE=0 BLOCKED_RISK=0 BLOCKED_EVENT=0`
  - `Watchlist(Model Top6): VIST:WAIT_PRICE/wait_pullback_not_reached, UTHR:WAIT_PRICE/wait_pullback_not_reached, ADBE:BLOCKED_RISK/blocked_rr_below_min`

### TC-0.6B (Sidecar contract parser alignment)

- [x] Sidecar locks same Stage6 file/hash
- [x] `[STAGE6_CONTRACT]` counters match Stage6 final decision result
- [x] No parser/contract mismatch error

Evidence
- run id: `23092502950` (`https://github.com/pungking/alpha-exec-engine/actions/runs/23092502950`)
- key log lines:
  - `[STAGE6_LOCK] STAGE6_ALPHA_FINAL_2026-03-15_02-08-22.json ... sha256=dc19126f132b`
  - `[STAGE6_CONTRACT] enforce=true checked=3 executable=3 watchlist=0 blocked=0`
  - `[RUN_SUMMARY] ... stage6_contract_checked=3 stage6_contract_blocked=0 ...`
- note: `payloads=0/skipped=3` is policy gate outcome (risk-off conviction floor), not contract failure.

---

## 0.7) Payload Path Probe (one-shot, policy-gate isolation)

Goal: isolate whether `payload=0` is caused by policy floor (conviction) vs contract/parser mismatch.

### TC-0.7A (temporary conviction override probe)

- [ ] Open `sidecar-dry-run` -> **Run workflow**
- [ ] Set input `payload_probe=true`
- [ ] Set input `payload_probe_min_conviction=30` (or 20/40/50)
- [ ] Confirm Step Summary includes `Payload Path Probe` section
- [ ] Confirm `payloads/skipped` changes as expected vs baseline
- [ ] Revert to baseline policy (no permanent var change needed; probe is one-shot env override)

Evidence
- run id:
- probe setting:
- key log line:
- payload/skipped:
- notes:

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
