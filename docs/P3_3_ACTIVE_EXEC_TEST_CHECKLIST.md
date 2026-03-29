# P3-3 Active Execution Test Checklist

Use this checklist to validate `market-guard` active execution safely, one step at a time.

---

## 0.0) Minimum Closure Set (Phase-1, recommended)

Goal: close the highest-value operational gaps first before expanding to full active-exec coverage.

- [ ] M1. Complete `0.9B` runtime evidence closure
  - confirm latest artifact includes `state/stage6-20trade-loop.json`, `state/stage6-20trade-loop.csv`
  - confirm 10/20 Telegram milestone evidence (`TELEGRAM_PERF_LOOP`)
- [x] M2. Complete `0.8A` Stage6 quality-gate enforcement evidence
- [x] M3. Complete `0.8B` Telegram model/watchlist contract sync evidence
- [ ] M4. Complete `0.8C` sidecar skip-reason mapping sync evidence
- [ ] M5. Complete `TC-1` blocked-safety-mode smoke (active mode, safety gate closed)
- [ ] M6. Complete `6) Rollback to safe defaults` sign-off

Phase-1 done condition:
- [ ] `M1~M6` all checked with run id + key log lines attached

---

## 0.1) Phase Status Board (current)

Tracking unit: this checklist only (`P3_3_ACTIVE_EXEC_TEST_CHECKLIST.md`).

Completed reference (already closed):
- `0.5` Entry Feasibility Gate
- `0.6` Stage6 Decision-Contract Alignment
- `0.7` Payload Path Probe
- `0.9A` automation baseline
- `0.9C` Stage6 -> Sidecar auto-trigger

### Phase-1 (보완중 / 부분완료)

- `0.9B` runtime evidence: **8/9 complete**
  - pending: 10/20 Telegram milestone evidence (`TELEGRAM_PERF_LOOP`)

### Phase-2 (보완예정 / 미체크)

- `0.8A` quality gate enforcement: **4/4 complete**
- `0.8B` Telegram contract sync: **6/6 complete**
- `0.8C` sidecar skip-reason mapping sync: **2/3 complete**
- `TC-1` blocked safety mode: **0/8**
- `6)` rollback safe defaults sign-off: **0/11**

### Phase-3 (미보완 / 후속 확장)

- `0)` safety baseline: **0/10**
- `TC-2` tighten_stops: **0/12**
- `TC-3` cancel_open_entries: **0/12**
- `TC-4` reduce_positions_50: **0/14**
- `5)` troubleshooting checklist: **0/4**

Current subtotal:
- complete: **61**
- remaining: **83**
- progress: **42.4%** (`61/144`)

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

- [x] Open `sidecar-dry-run` -> **Run workflow**
- [x] Set input `payload_probe=true`
- [x] Set input `payload_probe_min_conviction=30` (or 20/40/50)
- [x] Confirm Step Summary includes `Payload Path Probe` section
- [x] Confirm `skip_reasons` distribution is shown in Step Summary
- [x] Confirm `payloads/skipped` changes as expected vs baseline
- [x] Revert to baseline policy (no permanent var change needed; probe is one-shot env override)

Evidence
- run id: `workflow_dispatch` (2026-03-28, user-shared summary)
- probe setting: `payload_probe=true`, `payload_probe_mode=tighten`, `payload_probe_min_conviction=50`
- key log line: `hf_payload_probe: status=PASS_FORCED_SIZE_REDUCED ... reason=forced_tighten_and_size_reduce_observed`
- payload/skipped: `0/1` (baseline and probe runs both policy-blocked; probe still validated forced HF path)
- notes: `hf_payload_probe_forced` confirmed `active=true modified=true ... baseSizeReduced=1 baseSizeSaved=120`

---

## 0.8) Stage6 Quality Gate + Telegram Contract Sync (in progress)

Goal: prevent low-quality executable leakage (e.g., Conv=0/ER=N-A) and keep Telegram sections aligned with Stage6 model/executable/watchlist semantics.

### TC-0.8A (quality gate enforcement)

- [x] Run Stage6 once with same Stage5 lock baseline
- [x] Confirm top log includes new quality reasons when applicable:
  - `blocked_quality_missing_expected_return`
  - `blocked_quality_conviction_floor`
  - `blocked_quality_verdict_unusable`
- [x] Confirm low-quality candidate is **not** `EXECUTABLE_NOW`
- [x] Confirm `Decision reasons(primary)` includes `quality_*` counters

Evidence
- stage6 run id: `2026-03-29_02-40-31` (`STAGE6_PART2_AI_RESULT_FULL_2026-03-29_02-40-31.json`, `STAGE6_ALPHA_FINAL_2026-03-29_02-40-33.json`)
- key log lines:
  - `decisionReasonCountsPrimary ... blocked_quality_verdict_unusable: 2`
  - `stage6_contract: enforce=true checked=3 executable=3 watchlist=0 blocked=0`
- affected symbols: `PDD`, `ADMA` (`decisionReason=blocked_quality_verdict_unusable`, not executable-now)
- notes: `blocked_quality_missing_expected_return` / `blocked_quality_conviction_floor` are not present in this sample window (N/A in this run)

### TC-0.8B (telegram model/watchlist semantic alignment)

- [x] Generate Telegram brief from the same Stage6 run
- [x] Confirm `Top6 (Model Rank)` reflects model-top6 universe (not executable-only list)
- [x] Confirm `Watchlist (실행 대기)` contains model-top6 non-executable names when they exist
- [x] Confirm `Executable Picks` matches execution-only set
- [x] Confirm each candidate line includes both `AQ`(추천 품질) and `XS`(실행 가능성)
- [x] Confirm no `TELEGRAM_CONTRACT_MISMATCH` in logs

Evidence
- stage6 run id: `2026-03-29_02-40-31`
- telegram file: `TELEGRAM_BRIEF_REPORT_2026-03-29_02-40-41.md`
- key section snippets:
  - `Top6 (Model Rank)` present
  - `Executable Picks` present (execution-only set)
  - `Watchlist (실행 대기)` present (model-top6 non-executable names)
  - candidate lines include `AQ` and `XS`
  - mismatch marker not found (`TELEGRAM_CONTRACT_MISMATCH` absent)

### TC-0.8C (sidecar skip reason mapping sync)

- [x] Run sidecar-dry-run against the new Stage6 dump
- [ ] If quality-blocked names exist, confirm skip reason mapping appears as:
  - `stage6_quality_missing_expected_return`
  - `stage6_quality_conviction_floor`
  - `stage6_quality_verdict_unusable`
  - (source can be either `skip_reasons` or `stage6_skip_hint_primary`)
- [x] Confirm `[STAGE6_CONTRACT]` counters match Stage6 final decision distribution

Evidence
- sidecar run id: normal/probe pair (`logs_62432780110.zip`, `logs_62432801084.zip`)
- key log lines:
  - `[STAGE6_CONTRACT] enforce=true checked=3 executable=3 watchlist=0 blocked=0`
  - `[SKIP_REASONS] entry_blocked:guard_control_halt_new_entries(level=L3),simulated_live_parity:3`
- skip_reasons summary: stage6 quality skip-reason mapping is not observed yet in sidecar summary path (open item)

---

## 0.9) Stage6 20-Trade Performance Loop (new)

Goal: tune for both recommendation quality and executable realism with one-variable-per-batch control.

Reference
- `sidecar-template/alpha-exec-engine/docs/STAGE6_20TRADE_PERFORMANCE_LOOP_2026-03-16.md`

### TC-0.9A (automation baseline, code-level)

- [x] Sidecar writes loop state JSON automatically
  - `state/stage6-20trade-loop.json`
- [x] Sidecar writes loop state CSV automatically
  - `state/stage6-20trade-loop.csv`
- [x] Row upsert uses `idempotencyKey` (duplicate insertion guard)
- [x] KPI snapshot is auto-generated every 10 trades (`[PERF_LOOP_KPI]`)
- [x] workflow summary shows `perf_loop` (batch/trades/snapshots)
- [x] artifacts include loop files (`state/stage6-20trade-loop.json`, `state/stage6-20trade-loop.csv`)
- [x] batch split env supported (`STAGE6_PERF_BATCH_ID`)

Evidence
- code refs:
  - `sidecar-template/alpha-exec-engine/src/index.ts`
  - `sidecar-template/alpha-exec-engine/.github/workflows/dry-run.yml`
- note: runtime evidence capture is tracked in TC-0.9B below

### TC-0.9B (runtime evidence, in progress)

- [x] Run sidecar-dry-run once and confirm `[PERF_LOOP]` log appears
- [x] At 10-trade boundary, confirm `[PERF_LOOP_KPI]` log appears
- [x] Download artifact and verify both loop files exist
- [x] Confirm summary line `perf_loop: batch=... trades=... snapshots=...`
- [x] Confirm summary line `perf_loop_latest_kpi: trades=... fillRatePct=... avgR=... holdErrMedian=... noReasonDrift=...`
- [x] Confirm summary line `perf_loop_gate_status: GO|NO_GO|PENDING_SAMPLE`
- [x] Confirm summary line `perf_loop_gate_reason: ...`
- [x] Confirm summary line `perf_loop_gate_progress: current/20`
- [ ] At 10/20 trades, confirm Telegram simulation channel receives milestone alert (`TELEGRAM_PERF_LOOP`)

Evidence
- run id: `workflow_dispatch` (2026-03-28, user-shared summary set)
- key log lines:
  - `perf_loop: batch=stage6-20260316 trades=11 snapshots=1`
  - `perf_loop_latest_kpi: trades=11 fillRatePct=0.00 avgR=0.0000 holdErrMedian=0.00 noReasonDrift=0`
  - `perf_loop_gate_status: PENDING_SAMPLE`
  - `perf_loop_gate_reason: sample_insufficient(trades=11,required>=20)`
  - `perf_loop_gate_progress: 11/20`
- artifact:
  - `sidecar-state-23690812125.zip` includes `stage6-20trade-loop.json`, `stage6-20trade-loop.csv`
  - `sidecar-state-23690819759.zip` includes `stage6-20trade-loop.json`, `stage6-20trade-loop.csv`
- summary snippet: runtime KPI/gate lines are consistently present in both normal/probe/validation-pack runs
- pending: explicit Telegram milestone marker (`TELEGRAM_PERF_LOOP`) log evidence

### TC-0.9C (Stage6 -> Sidecar auto-trigger, PASS)

- [x] `US_Alpha_Seeker` secrets에 `SIDECAR_DISPATCH_TOKEN` 설정 (target: `pungking/alpha-exec-engine`)
- [x] From Stage6 pipeline, send `repository_dispatch(type=stage6_result_created)` once after Stage6 final dump is archived
- [x] Confirm sidecar-dry-run starts without manual click
- [x] Confirm Step Summary includes:
  - `trigger: event=repository_dispatch action=stage6_result_created`
  - `trigger_stage6: hash=... file=... sourceRun=...` (if payload provided)

Evidence
- stage6 run id: `US_Alpha_Seeker` run (`logs_60742122772.zip`)
- sidecar run id: `23139289345` (`logs_60744574413.zip`, `sidecar-state-23139289345.zip`)
- summary snippet:
  - `[DISPATCH_OK] repo=pungking/alpha-exec-engine event=stage6_result_created file=STAGE6_ALPHA_FINAL_2026-03-16_19-31-40.json hash=a902a230 sourceRun=2026-03-16_19-31-38`
  - `WORKFLOW_EVENT_NAME: repository_dispatch`
  - `WORKFLOW_EVENT_ACTION: stage6_result_created`
  - `[TRIGGER] event=repository_dispatch action=stage6_result_created`
  - `[TRIGGER] stage6Hash=a902a230 stage6File=STAGE6_ALPHA_FINAL_2026-03-16_19-31-40.json sourceRun=2026-03-16_19-31-38`

Note
- `logs_60748849412.zip` / `sidecar-state-23140712565.zip`는 `schedule` fallback 런으로 확인됨
  (`WORKFLOW_EVENT_NAME: schedule`). dispatch 런 증빙과 구분해서 보관.

Checklist
- [ ] Freeze policy for one batch (no threshold changes mid-batch)
- [ ] Log every executed trade with AQ/XS, reason, entry/exit, R-multiple, slippage
- [ ] Generate KPI snapshot every 10 trades
- [ ] Change only one tuning variable per batch
- [ ] Record GO/NO-GO at 20 trades

Evidence
- batch id:
- trade count:
- kpi snapshot:
- tuning change:
- go/no-go:

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
