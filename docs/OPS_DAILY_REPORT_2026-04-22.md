# Sidecar Ops Daily Report - 2026-04-22

## 1) Run Window

- Date (UTC/KST): 2026-04-22 UTC / 2026-04-22 KST
- Window: post-fix verification window (`04:05~04:22 UTC`)
- Operator: codex + givet-bsm
- Scope: `sidecar-dry-run`, `sidecar-preflight-canary-recheck`

## 2) Executive Summary

- Overall status: `GREEN (post-fix window)`
- Key outcome: canary + dry-run order path validated with `preflight=PASS` and `submitted>=1`.
- Immediate blocker: none in post-fix window.

## 3) Core KPIs (post-fix verification window)

- `canary_success_rate` = `2 / 2`  
  - runs: `24759659930`, `24759989453`
- `preflight_pass_rate` = `2 / 2`
- `submit_success_rate` (`submitted/attempted`) = `4 / 4`
- `dedupe_false_positive_count` = `0` (post-fix window)
- `client_order_id_duplicate_recovered_count` = `2` (latest dry-run run `24759991965`)
- `preflight_blocked_count` = `0` (post-fix window)
- `watchdog_fallback_count` = `N/A` (not in this focused verification window)

## 4) Failure Breakdown (historical before post-fix window)

1. reason: `PREFLIGHT_MARKET_CLOSED`
   - count: multiple (earlier 2026-04-22 UTC runs)
   - evidence: canary failures `24756656328`, `24758813871`
   - action: canary input defaults to `run_allow_entry_outside_rth=true`
2. reason: `client_order_id must be unique`
   - count: observed pre-fix
   - evidence: dry-run `24759302909`
   - action: duplicate-id retry with unique suffix added, verified in `24759597339` and `24759991965`
3. reason: dedupe skip in canary target pick
   - count: observed pre-fix
   - evidence: canary `24759495341` -> target `24759498591`
   - action: canary target matching and dispatch inputs tightened

## 5) Policy Execution Check (Trading Matrix Conformance)

Reference: `docs/TRADING_POLICY_MATRIX.md`

- `ENTRY_NEW` path: `OK`
- `SCALE_UP` path: `OK` (duplicate-id retry path confirmed)
- `SCALE_DOWN/EXIT_PARTIAL/EXIT_FULL` path: `N/A` in this short window
- Chase guard trigger quality: `N/A` in this short window (monitor in baseline period)
- Unexpected action transitions: none

## 6) Risk & Safety Gate Check

- `EXEC_ENABLED`: controlled by workflow vars (paper lane)
- `READ_ONLY`: controlled per run context
- `LIVE_ORDER_SUBMIT_ENABLED`: enabled in canary validation lane
- `ALLOW_ENTRY_OUTSIDE_RTH`: `true` for canary reliability check
- Perf gate: `GO` (from run summary)
- HF live promotion: `PASS` (from run summary)
- Approval queue behavior: preview bypass in current canary lane (expected)

## 7) Next Actions (24h)

1. Start tuning Step 1 baseline (`3 trading days`) with default chase guard params.
2. Fill this report template once per trading day and track guard hit-rate vs submit quality.
3. After 3-day baseline, decide Step 2 conservative variant activation.

## 8) Evidence Links

- Canary:
  - https://github.com/pungking/US_Alpha_Seeker/actions/runs/24759659930
  - https://github.com/pungking/US_Alpha_Seeker/actions/runs/24759989453
- Target dry-run:
  - https://github.com/pungking/alpha-exec-engine/actions/runs/24759663273
  - https://github.com/pungking/alpha-exec-engine/actions/runs/24759991965

## 9) Notion Collection Audit (sample check)

- Daily Snapshot row present:
  - `sidecar-dryrun-24759991965-1`
  - `sidecar-guard-24759835536-1`
- HF Tuning Tracker row present:
  - `sidecar-dryrun-24759991965-1`
- Field sanity (sample):
  - `Stage6 Hash`, `Payload Count`, `Skipped Count`, `Status`, `Summary` populated
- Note:
  - consolidated daily row automation is still pending (currently per-run rows are primary evidence).
