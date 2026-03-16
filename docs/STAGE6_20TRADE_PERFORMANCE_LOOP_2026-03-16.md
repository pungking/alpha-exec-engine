# Stage6 20-Trade Performance Loop

Goal: improve both signal quality and execution realism with a low-credit, deterministic tuning loop.

Auto-logging outputs (sidecar):
- `state/stage6-20trade-loop.json`
- `state/stage6-20trade-loop.csv`

Notes:
- Sidecar appends one row per generated payload (`idempotencyKey`-based dedupe).
- If you want to split batches manually, set `STAGE6_PERF_BATCH_ID` (e.g. `batch-2026w12`).
- KPI snapshot is generated automatically at every 10-trade boundary.
- Milestone notification is sent to simulation Telegram channel at 10 and 20 trades (`TELEGRAM_PERF_LOOP`).

---

## 1) Freeze Window (required)

- Keep current Stage6 decision policy fixed for one batch.
- Do not change thresholds mid-batch.
- Batch unit:
  - minimum: 20 executed trades
  - preferred: 30 to 50 executed trades

---

## 2) Per-Trade Log Template

Copy this table and append one row per executed trade.

| runDate | symbol | modelRank | execRank | AQ | XS | decisionReason | entryPlanned | entryFilled | stopPlanned | targetPlanned | exitPrice | exitReason | holdDaysPlanned | holdDaysActual | RMultiple | slipPct | marketRegime | notes |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|---|
| YYYY-MM-DD | KTB | 3 | 1 | 82.3 | 95.2 | executable_pullback | 60.92 | 60.95 | 49.25 | 92.67 | 67.10 | manual_exit | 15 | 6 | 0.52 | 0.05 | risk_off | sample |

Notes:
- `RMultiple = (exitPrice - entryFilled) / (entryFilled - stopPlanned)` for long trades.
- `slipPct = abs(entryFilled - entryPlanned) / entryPlanned * 100`.

---

## 3) Batch KPI Snapshot (every 10 trades)

| KPI | Formula | Target |
|---|---|---|
| Fill Rate | filled / signaled executable | >= 60% |
| Stop Discipline | trades stopped by planned stop logic / stop-hit cases | >= 95% |
| Avg R | mean(RMultiple) | > 0.25 |
| Median Hold Error | median(abs(holdDaysActual - holdDaysPlanned)) | <= 4 days |
| No-Reason Drift | rows where log reason != stage6 reason | 0 |

---

## 4) Tuning Order (one variable at a time)

Apply exactly one change per batch, then re-measure.

1. `VITE_STAGE6_MAX_STOP_DISTANCE_PCT` (too many `blocked_stop_too_wide`)
2. `VITE_STAGE6_MIN_RR` (too many `blocked_rr_below_min`)
3. `VITE_ENTRY_FEASIBILITY_MAX_DISTANCE_PCT` (too many far-entry misses)
4. `VITE_STAGE6_EARNINGS_BLACKOUT_DAYS` (event risk false positives/negatives)
5. `VITE_STAGE6_MIN_CONVICTION` (quality vs volume balance)

Rule:
- If a KPI improves but another degrades materially, revert and try smaller change.

---

## 5) Go/No-Go for next batch

- GO: all must-pass checks below are true
  - `No-Reason Drift = 0`
  - `Fill Rate >= 60%`
  - `Avg R > 0`
  - no critical contract mismatch
- NO-GO: any must-pass fails

---

## 6) Reporting Cadence

- Daily: append trade rows + quick KPI note.
- Every 10 trades: full KPI snapshot.
- At 20 trades: tuning decision (hold/revert/adjust 1 variable).
