# Sidecar Development Plan (Living Document)

Last updated: 2026-05-15 (KST, paper OCO submit gate)
Owner: givet-bsm + Codex
Scope: `alpha-exec-engine` execution/paper-trading operations

---

## 0) Operating Rule (How we develop from now on)

This document is the single live plan for sidecar development.

- We update this file whenever:
  1) a milestone starts,
  2) a milestone completes,
  3) a blocker or risk changes,
  4) a policy threshold is tuned.
- Every update must include:
  - date/time (UTC + KST),
  - what changed,
  - evidence link (GitHub run / Notion row / artifact).
- If code changes but this plan is not updated, the task is not considered complete.

### Execution-first roadmap lock

Until paper trading proves that orders are submitted, visible at Alpaca, and diagnosable after cancel/replace, work must
follow this sequence:

1. **Broker path proof**: confirm RTH sidecar runs produce `preflight_pass=true`, `attempted>=1`, `submitted>=1`,
   Alpaca paper order visibility, and broker-aware idempotency release after manual cancel.
2. **Fillability tuning**: tune entry price realism before changing upstream scoring. Required dimensions:
   current-price distance, ATR, spread, volume, stale order cancel/replace, and RR after any chase adjustment.
   The 2026-05-04 RTH sample confirmed the broker lane was not the blocker: `ADBE` was blocked by high-price sizing
   (`DRY_NOTIONAL_PER_TRADE=100` below one share) and `CPRX` was blocked by entry distance/current RR. Next tuning must
   separate high-price sizing policy from Stage6 entry/OTE calibration instead of loosening both at once.
   The same review found one GitHub bridge-watchdog requeue failure caused by a transient GitHub `502`; dispatch calls now
   carry retry coverage so cadence failures are not misdiagnosed as broker/order failures.
   A 2026-05-07 cumulative audit over 15 recent sidecar dry-run artifacts showed the current failure is upstream of Alpaca:
   `submittedRuns=0`, `STAGE6_ZERO_EXECUTABLE=7`, and `SIDECAR_CANDIDATE_BLOCKED=8`. The two distinct Stage6 hashes split
   into (a) all candidates removed by `blocked_earnings_window` / `wait_earnings_data_missing`, and (b) ADBE/CPRX blocked
   by high-price sizing plus entry distance. Next implementation must fix Stage6 executable gating and entry realism before
   enabling broader reprice or raising order size.
3. **Stage 1-6 signal quality review**: only after execution telemetry exists, review why Stage6 "executable" entries are
   too far from current market or too idealized.
4. **Lifecycle policy hardening**: refine `ENTRY_NEW`, `HOLD_WAIT`, `SCALE_UP`, `SCALE_DOWN`, `EXIT_PARTIAL`,
   `EXIT_FULL`, stop timing, take-profit timing, and sector/position concentration limits.
   GTSA-style strategic reasoning is accepted only as a structured overlay, not as a direct order trigger. The immediate
   design target is a portfolio admission controller plus recommendation ledger so daily rotating recommendations cannot
   accumulate into uncontrolled pending orders or unmanaged watch symbols.
5. **Performance / monitoring layer**: expand Stage 7 only after paper order/fill telemetry is reliable.
6. **Paper-to-live promotion**: real-capital readiness requires stable paper execution evidence; no shortcut.

This is the project memory for sidecar sequencing. Codex local memory is read-only in this environment, so persistent
execution decisions are stored here instead.

### Completion estimate

These estimates assume normal RTH testing cadence and no external API/account outage:

| Phase | Target outcome | Realistic estimate |
|---|---|---:|
| M1 broker path proof | submitted Alpaca paper orders + cancel/idempotency reconciliation | current canary green; 1-2 scheduled confirmations remain |
| M2 fillability tuning | materially higher fill probability without breaking RR | 5-10 trading sessions |
| M2/M3 trading policy + Stage 1-6 review | reduce "executable but unfillable" false positives | 2-4 weeks |
| M3/M6 monitoring | Notion/performance/order telemetry usable for daily decisions | 1-2 weeks after fills exist |
| Paper-to-live promotion evidence | stable paper results, incident-free run window, promotion checklist | 4-8 weeks minimum |
| Full normal operation | analysis + execution + monitoring loop reliable enough for routine use | 8-12 weeks conservative |

The critical path is not code volume; it is live-market evidence. If fill data remains sparse, the timeline stretches.

---

## 1) Current State Snapshot

### What is verified

- Canary order-path verification is green on the latest RTH evidence run:
  - run: `https://github.com/pungking/alpha-exec-engine/actions/runs/25170624706`
  - `Preflight: PASS`
  - `Broker Reality: attempted=2 submitted=2 reason=submit_ok`
  - broker-aware idempotency released manually canceled INVA/JHG keys and re-submitted with unique retry
    `client_order_id` values.
- Duplicate `client_order_id` failure path is mitigated with retry+unique suffix.
- Broker-aware idempotency reconciliation is implemented:
  - duplicate keys query Alpaca by `client_order_id` in exec mode,
  - canceled/rejected/expired broker orders can release the key,
  - filled orders remain protected to avoid accidental double-entry,
  - releases are recorded in `state/order-idempotency.json.releases`.
- Broker submit path has a meaningful first pass from the 2026-04-30 RTH runs:
  - `Preflight: PASS`
  - `Broker Reality: attempted=2 submitted=2 reason=submit_ok`
  - Alpaca paper orders were visible to the operator.
- Execution overlay fallback has been hardened so latest-bars failures can fall through to latest trade/quote and daily
  bar context instead of marking all symbols `data=failed`.
- Execution overlay fallback was proven on the latest canary:
  - `Execution Overlay: data=ok`
  - `missing=0`
  - INVA/JHG had market snapshots instead of endpoint-wide failure.
- Open-order monitor is still observe-only, but now exposes operator-grade reprice diagnostics:
  - matched open orders show current price, existing limit, suggested RR-safe limit, delta, distance, RR at limit/current,
    age, and reason;
  - idempotency display separates ledger duplicate counts from skip-reason duplicates so "no payload" runs are not
    misread as missing broker visibility.
- P0 overnight fillability diagnosis is complete for the 2026-04-30 RTH batch:
  - sidecar submitted INVA/JHG twice and Alpaca accepted the paper orders;
  - all entry orders ended with `filled_qty=0`; first batch was manually canceled, second batch expired at market close;
  - later runs correctly avoided duplicate submissions while open orders existed;
  - the actual blocker is fillability/reprice, not broker submission.
- Monitor-driven stale reprice bridge is now implemented behind an explicit default-off switch:
  - `ENTRY_OPEN_ORDER_REPRICE_FROM_MONITOR_ENABLED=false` by default;
  - when enabled together with stale cleanup, all Stage6 actionable symbols with `REPRICE_CANDIDATE` rows can pass
    idempotency, preflight, and stale cancel/replace using the monitor's RR-safe suggested limit;
  - JHG/INVA canary evidence is not a ticker-specific rule; it is proof for the portfolio-wide candidate loop.
  - send-dedupe is bypassed only for applied monitor-driven reprice candidates.
- `SCALE_UP` chase guard controls are implemented and documented.
- Order-decision audit is now required evidence for execution diagnosis:
  - `state/last-order-decision-audit.json`
  - `state/order-decision-audit.jsonl`
  - required purpose: distinguish `payload_ready`, `entry_too_far_from_market`, `dedupe_skip`, `preflight_blocked`,
    `submit_disabled`, `read_only`, `exec_disabled`, and Alpaca rejection/failure paths.
- Portfolio admission controller is implemented in the sidecar path after execution overlay/open-order monitor and before
  preflight/broker submit:
  - enforces active-symbol, open-entry, new-symbol-per-day, sector, fillability, and current-RR gates;
  - writes `state/portfolio-admission-audit.json`;
  - keeps monitor-driven same-order replacement from consuming a new open-entry slot.
- Recommendation lifecycle ledger is implemented:
  - writes `state/recommendation-ledger.json`;
  - tracks each candidate as `RECOMMENDED_NEW`, `ADMITTED_FOR_ENTRY`, `OPEN_ORDER`, `FILLED`,
    `HOLD_MONITOR`, scale/exit candidate, `REJECTED_BY_ADMISSION`, or `EXPIRED_RECOMMENDATION`;
  - expires stale non-open/non-filled recommendations so daily rotating candidates do not accumulate indefinitely.
- Fresh RTH validation run `25503498355` confirmed the new artifacts are uploaded and populated. Review found one policy
  correction: pullback/reprice limit orders must be judged by RR at the proposed limit, not by current-price RR. Otherwise
  a valid waiting order like INCY can be falsely rejected before the market pulls back. The admission policy now uses
  current RR only for confirmed adaptive entries and proposed-limit RR for pullback/reprice orders.
- Fresh 2026-05-08 run `25558230451` confirmed the broker path was not the active blocker: Stage6 produced
  `stage6=0/finalPicks=0`, so sidecar correctly generated no payload and Alpaca submission was not attempted. The
  sidecar now persists `stage6BlockerSamples` and prints Stage6 blocker samples in Telegram/run summary so a no-order
  day is attributable to Stage6 gating instead of being mistaken for an Alpaca/order bug.
- Notion ingestion path is alive:
  - Daily Snapshot rows for `sidecar_dry_run` and `sidecar_market_guard` are present.

### 2026-05-12 KST Stage6 current-entry gate precondition

- Fresh webapp run produced `STAGE6_ALPHA_FINAL_2026-05-12_10-51-55.json` with hash `5066d3c17e8e`.
- Stage6 now emits current-entry structure diagnostics directly from OHLCV/ATR/support context.
- Local no-upload canary confirmed `INCY` would promote to
  `EXECUTABLE_NOW/executable_current_recalculated_stop` when both explicit Stage6 flags are enabled:
  - `VITE_STAGE6_ADAPTIVE_CURRENT_ENTRY_ENABLED=true`
  - `VITE_STAGE6_CURRENT_ENTRY_STOP_RECALC_ENABLED=true`
- Sidecar/Alpaca verification remains blocked until an explicit promoted Stage6 canary is intentionally run; payload
  preview is still not broker proof.
  - HF Tuning Tracker rows are being updated for latest dry-run runs.
  - Performance Dashboard database/schema is accessible and query-ready.
- Ops automation chain now includes:
  - Notion data-quality audit (`ops:notion:audit`)
  - consolidated ops daily artifact report (`ops:daily:report`)
  - root workflow publication/artifact wiring (`mcp-ops-daily`)

### 2026-05-15 KST Alpaca child/OCO repair precondition

- Official Alpaca docs review locked the next repair-lane payload boundary:
  - bracket entry orders use `order_class=bracket` with `take_profit.limit_price` and `stop_loss.stop_price`;
  - OCO repair candidates for existing long positions use `order_class=oco`, `side=sell`, `type=limit`, and `qty`;
  - `nested=true` order reads remain the correct source for broker child-order reconciliation;
  - notional repair payloads are disallowed by project policy because repair/replace behavior must be qty-based.
- Added offline paper fixtures and validator:
  - `testdata/alpaca/bracket-entry-long.paper.fixture.json`
  - `testdata/alpaca/oco-exit-long-repair.paper.fixture.json`
  - `npm run ops:alpaca:payload-fixtures`
  - output: `state/alpaca-order-payload-schema-report.json` / `.md`.
- Added future OCO paper canary runbook and nested response fixture validator:
  - `docs/ALPACA_OCO_PAPER_CANARY_RUNBOOK.md`
  - `testdata/alpaca/oco-repair-nested-open.paper-response.fixture.json`
  - `npm run ops:alpaca:oco-response-fixtures`
  - output: `state/alpaca-oco-response-fixture-report.json` / `.md`.
- Added generic report-only paper OCO canary selector:
  - `npm run ops:paper-oco-canary`
  - output: `state/paper-oco-canary-candidate.json` / `.md`
  - scope is portfolio-wide and dynamic; BZ/QFIN are only current artifact examples, not hard-coded targets.
  - the selector chooses at most one lowest-notional eligible `symbol + qty=1` row and keeps `executionAllowed=false`.
- Added report-only paper OCO approval gate:
  - `npm run ops:paper-oco-gate`
  - output: `state/paper-oco-canary-approval-gate.json` / `.md`
  - consumes the selected row and validates selector scope, guarded repair state, nested-order evidence, payload/response fixtures, order-state, safe runtime flags, qty, and price geometry.
  - returns `READY_FOR_MANUAL_APPROVAL` only as a non-mutating decision; `recommendedAction` remains `DO_NOT_SUBMIT`.
- Added blocked-by-default paper OCO submit gate:
  - `npm run ops:paper-oco-submit-gate`
  - output: `state/paper-oco-canary-submit-gate.json` / `.md`
  - does not call Alpaca POST and does not submit.
  - read-only Alpaca recheck can be requested with `PAPER_OCO_CANARY_READ_VERIFY=true`.
  - actual paper submit remains a separate future implementation requiring paper-only env, intentional runtime flags, exact approval phrase, pre-submit nested-order recheck, dedicated idempotency ledger, and post-submit nested visibility verification.
- Safety boundary remains unchanged:
  - scheduled workflow has no broker-mutating OCO submit env,
  - no emitted Alpaca repair payload in default path,
  - no auto stop/target repair,
  - future repair execution still requires a separate safety-gated task.

### What is not fully closed

- Execution/paper-trading stabilization has moved from "can we submit?" to "can we get rational fills without damaging
  RR?" The latest evidence shows accepted Alpaca orders but zero fills.
- Execution overlay and open-order monitor remain diagnostic layers by default. Live repricing requires explicit repo
  variables and must keep stale cleanup, max chase, RR floor, and cooldown caps aligned.
- Portfolio-level admission is not yet closed. Per-run caps and idempotency reduce duplicate orders, but they do not yet
  provide a complete cross-day cap on active recommended symbols, open entry orders, sector concentration, or stale
  unfilled recommendations.
- High-price whole-share sizing produced a successful RTH paper submit canary, but the manual canary override layer
  must stay synchronized because profile-specific `DRY_DEFAULT_*` / `DRY_RISK_OFF_*` values can override legacy
  `DRY_*` inputs.
- Daily ops reporting is documented but not fully auto-upserted as one consolidated Notion daily report row.
- Chase-guard tuning is in kickoff phase; baseline accumulation period is still pending.
- Cross-tool loop (Notion <-> Obsidian <-> NotebookLM) exists but is explicitly deferred until a stable always-on
  computer/NotebookLM source-refresh setup is available.
- Canary-specific KPI extraction (`preflight_pass`, `attempted`, `submitted`) is not yet integrated into daily report JSON.
- Automation integration audit snapshot (2026-04-22): `Connected 15 / Partial 3 / Not connected 2` (75.0%).
- Evidence: `docs/AUTOMATION_PIPELINE_INTEGRATION_AUDIT_2026-04-22.md`.

---

## 2) Milestones (Living)

## M1. Execution Reliability (Order Path)
Status: VALIDATED_ON_CANARY
Priority: P0

- Goal: keep `preflight/attempted/submitted` path stable and make every non-submit reason auditable.
- Current focus: observe submitted paper orders and collect fill/expire/cancel evidence without repeatedly resubmitting
  while open entry orders already exist.
- Current evidence artifact: `state/fillability-report.json` / `.md` joins Stage6 decisions, order-decision audit,
  Alpaca open/closed/fill state, and open-order monitor data for every actionable symbol.
- P0 fillability finding:
  - INVA was RR-safe to reprice upward during the session (`rrAtCurrent` stayed materially above the 1.8 floor), but the
    live path had no bridge from monitor `REPRICE_CANDIDATE` to stale cancel/replace.
  - JHG was not RR-safe at current price; the suggested reprice stayed conservative, so chasing the market would have
    been the wrong fix.
  - This diagnosis applies to every actionable symbol, not a fixed ticker set: each candidate must carry its own
    distance, `rrAtLimit`, `rrAtCurrent`, target-buffer, stale age, and broker-open-order evidence before any replacement.
- Broker-aware idempotency/manual-cancel reconciliation is validated on the current canary: manually canceled paper orders
  released the dedupe keys, while the same Stage6 hash reissued orders with unique broker-safe `client_order_id` suffixes.
- Done when:
  - repeated canary success with submit > 0 during RTH
  - at least one stale open order is either filled, safely repriced, or explicitly held with an RR/cap reason
  - `state/last-order-decision-audit.json` exists for normal and dedupe runs
  - Telegram/Step Summary separates preview payloads from actual broker submissions
  - Alpaca paper orders are visible for submitted runs, or the exact blocking reason is recorded
  - no unresolved duplicate-id hard failures
- Evidence:
  - canary runs + sidecar dry-run logs with pass markers
  - `state/last-dry-exec-preview.json`
  - `state/last-order-decision-audit.json`

## M2. Trading Policy Hardening
Status: IN_PROGRESS
Priority: P0

- Goal: production-grade action policy behavior (`ENTRY/HOLD/SCALE/EXIT`).
- Current:
  - chase guard introduced
  - policy matrix documented
  - high-price one-share sizing policy added behind explicit caps
  - portfolio admission + recommendation ledger implemented at sidecar layer
- Remaining:
  - repeat RTH canary after profile-aware manual override sync is pushed
  - 3-trading-day baseline for chase guard
  - compare conservative/balanced variants
  - validate portfolio admission + recommendation ledger against the next fresh RTH run before enabling broader automated scale/exit behavior
  - consume GTSA only through a reduced deterministic overlay; do not let free-text reasoning mutate order geometry
- Evidence source:
  - `docs/TRADING_POLICY_MATRIX.md`
  - `docs/SCALE_UP_CHASE_GUARD_TUNING_PLAN.md`
  - `docs/GTSA_EXECUTION_LIFECYCLE_INTEGRATION_PLAN.md`

## M3. Ops Reporting Automation
Status: IN_PROGRESS
Priority: P1

- Goal: daily ops report becomes systemized, auditable, and queryable.
- Current:
  - template + first daily report file exists
  - Notion audit script exists and is wired to root `mcp-ops-daily` workflow
- Remaining:
  - auto-generate daily report markdown from run data ✅
  - auto-upsert summary row to Notion (daily consolidated row, not per-run only) ✅
  - ensure evidence links are mandatory fields
  - ingest canary KPI markers from logs (`preflight_pass`, `attempted`, `submitted`) ✅
  - enforce evidence URL mandatory fields in Notion row schema

## M4. Knowledge Loop Integration (Notion/Obsidian/NotebookLM)
Status: IN_PROGRESS
Priority: P1

- Goal: research/ops loop supports tuning decisions with minimal manual friction.
- Current:
  - knowledge pipeline now has markdown quality gate step (`ops:knowledge:quality`) wired in workflow.
- Remaining:
  - daily report ingestion into Obsidian note stream
  - NotebookLM source refresh checkpoint linked to daily ops report
  - concise weekly synthesis output
  - define canonical ownership:
    - Notion = record DB
    - Obsidian = decision journal
    - NotebookLM = synthesis/QA layer

## M5. Paper-to-Live Promotion Gate
Status: PLANNED
Priority: P0

- Goal: objective promotion criteria before real-capital mode.
- Required gates (draft):
  - stable canary pass streak
  - stable submit success ratio
  - no critical incident in window
  - policy guard hit-rate in acceptable range
- Output:
  - promotion checklist + sign-off evidence bundle

## M6. Stage 7 Performance / Trading Ops Board
Status: DEFERRED
Priority: P2 until M1/M2 stabilize; then P1

- Goal: extend existing `7: Performance` into a unified `Performance / Trading Ops` board instead of creating
  a separate Stage 8 immediately.
- Decision:
  - Do **not** build this now.
  - Keep the current Stage 0-7 structure.
  - After execution stabilization, add internal Stage 7 tabs:
    - Simulation
    - Paper Trading
    - Live Account (read-only first)
    - Orders
    - Execution Queue
    - Risk Guard
    - Sidecar Logs
- Rationale:
  - `components/PerformanceDashboard.tsx` already owns Simulation/Live views.
  - Current operational pain is not lack of a prettier terminal; it is lack of clear broker-submit diagnosis.
  - A future Trading Ops board must consume stabilized state files, not become another unverified data surface.
- Done when:
  - M1 has repeated `attempted>=1 submitted>=1` evidence.
  - order-decision audit is stable in artifacts.
  - dashboard API can expose preview payloads, broker reality, skip reasons, open orders, and market guard state
    without leaking credentials to the frontend.

---

## 3) Active Backlog (Next Actions)

### Next 24h

1. Finish execution stabilization:
   - do not fire another submit canary while current paper entry orders are open,
   - watch whether submitted orders fill, expire, or require stale cancel/replace,
   - confirm portfolio admission does not create extra broker submissions when capacity/fillability gates reject a candidate,
   - confirm `state/recommendation-ledger.json` reflects open/canceled/expired paper-order status after each run,
   - preserve `state/last-order-decision-audit.json` + Alpaca order status as the primary evidence pair.
2. Tune fillability only from broker-observed outcomes:
   - order stayed open because current price never pulled back,
   - order filled and bracket children opened correctly,
   - order expired/canceled and idempotency reconciled correctly.
   - open-order monitor emits `KEEP/WATCH_PULLBACK/REPRICE_CANDIDATE/CANCEL_CANDIDATE` before any automatic action.
3. Keep child-order repair in report-only mode:
   - use `ops:broker-child-reconcile`, `ops:guarded-repair-plan`, `ops:alpaca:payload-fixtures`, and
     `ops:alpaca:oco-response-fixtures` as the evidence chain,
   - do not submit OCO repair orders until a sanitized Alpaca paper fixture has proven the payload and the approval gate is explicitly completed.
4. Keep Stage 7 Trading Ops board deferred; no frontend expansion until M1 has scheduled-run confirmations, not only one
   manual canary proof.

### Next 72h

1. Re-run sidecar workflow with the stabilized audit path and compare:
   - Telegram summary
   - GitHub Step Summary
   - `last-dry-exec-preview.json`
   - `last-order-decision-audit.json`
   - Alpaca paper order list
2. Tune adaptive entry only after audit proves the blocking source is fillability/entry distance, not env/dedupe/preflight.
3. Keep Notion/Obsidian/NotebookLM integration in hold status unless it blocks execution evidence.
4. Add template/runtime drift check for bridge and sidecar workflow mirrors.

---

## 4) Risk Register (Live)

### R1. False confidence from short windows
- Risk: short pass streak may hide regime-specific failures.
- Control: enforce minimum observation window before policy changes.

### R2. Over-tight chase guard
- Risk: blocks too many valid adds in trend regimes.
- Control: baseline -> conservative -> balanced comparative protocol.

### R3. Data fragmentation across tools
- Risk: Notion/Obsidian/NotebookLM diverge in state.
- Control: daily report as canonical summary object with shared run links.

### R4. Dashboard before execution truth
- Risk: building a high-density trading terminal before broker-submit truth is stable creates a prettier but less
  reliable system.
- Control: Stage 7 Trading Ops work is blocked behind M1 evidence; only read from audited state files.

---

## 5) Update Log

- 2026-05-01 KST (open-order monitor v1):
  - Added observe-only open-order monitor for existing Alpaca buy entry orders.
  - Monitor writes `openOrderMonitor` into preview/audit/Telegram/run-summary with:
    - open-order age,
    - current price vs limit distance,
    - RR at open limit and current price,
    - suggested RR-safe reprice limit,
    - `KEEP/WATCH_PULLBACK/REPRICE_CANDIDATE/CANCEL_CANDIDATE/DATA_MISSING` status.
  - Actual cancel/replace remains disabled by default; this step only produces the evidence needed before enabling
    `ENTRY_OPEN_ORDER_STALE_CANCEL_ENABLED=true`.

- 2026-05-02 KST (monitor-driven reprice canary):
  - RTH canary `25221956534` proved the generic reprice path: an RR-safe stale open-entry candidate canceled the prior
    paper order, submitted a broker-safe retry order, and logged `attempted=1/submitted=1`.
  - Persisted `openOrderMonitorReprice` into `state/last-dry-exec-preview.json` so future artifacts can be audited
    structurally, not only via `[RUN_SUMMARY]` text.
  - Added candidate-wide fillability evidence report (`state/fillability-report.json` / `.md`) to distinguish
    Stage6 entry-distance blockers, RR-protected open pullback orders, reprice candidates, terminal unfilled orders,
    and actual fill activity.
  - Reprice bridge remains default-off after canary; production use requires explicit safety-switch enablement.

- 2026-04-30 KST (P0 broker reconciliation proof):
  - RTH canary `25170624706` completed with `Preflight=PASS`, `attempted=2`, `submitted=2`, `reason=submit_ok`.
  - Confirmed manual-cancel reconciliation:
    - original INVA/JHG broker orders were `canceled`,
    - idempotency keys were released with `broker_terminal:canceled`,
    - retry submissions used unique broker-safe `client_order_id` suffixes.
  - Confirmed execution overlay market-data fallback is working in the canary artifact:
    - `data=ok`,
    - `missing=0`,
    - INVA/JHG received current market snapshots.
  - Reclassified observe-only overlay semantics so a valid pullback-limit order is not labeled `NO_TRADE` merely because
    chasing current price would have poor RR. Low RR at the original limit remains a true `NO_TRADE`.
  - Added compact dedupe heartbeat and detailed open-order monitor telemetry so repeated runs report actionable
    stale/reprice evidence without Telegram mode-label spam.
  - Kept all open-order reprice/cancel behavior observe-only; no broker mutation is introduced by this telemetry update.

- 2026-04-30 KST (Telegram/order-readiness noise control):
  - Fixed dry-run dedupe key volatility by excluding `GUARD_CONTROL_AGE_MIN`; repeated schedules with the same
    Stage6 hash and same execution policy should no longer send full Telegram reports every run.
  - Added `Order Readiness` summary to Telegram/preview so `HF Live Promotion=PASS` is not confused with
    actual broker order submission readiness.
  - Stabilized market-guard Telegram dedupe signature to level/action/profile/open-state instead of raw VIX/index
    ticks, reducing L0 no-action notification spam.
  - Added `TELEGRAM_SEND_ENABLED=false` support to market-guard sender for isolated/no-noise runs.

- 2026-04-30 KST (execution overlay v1):
  - Added observe-only execution overlay to close the gap between Stage6 planned entry and real-time fillability.
  - Overlay reads Alpaca latest/daily bars and tags each decision as `CONFIRMED_ADAPTIVE_ENTRY`, `PULLBACK_LIMIT`,
    `WAIT_PULLBACK`, `NO_TRADE`, or `DATA_MISSING`.
  - Kept Stage6 as the signal source of truth; overlay v1 only writes audit/summary telemetry and does not mutate
    payload price, target, stop, or broker-submit behavior.
  - Next evidence gate: compare overlay tags against paper fills/expired orders before enabling any order-mutating
    overlay mode.

- 2026-04-30 KST (manual canary override sync):
  - RTH high-price canary submitted 1 SPG paper bracket order with `ENTRY_HIGH_PRICE_POLICY=min_one_share`.
  - Found manual override drift: `run_dry_max_total_notional_override` wrote legacy `DRY_MAX_TOTAL_NOTIONAL`, while
    runtime profile vars could still enforce `DRY_DEFAULT_MAX_TOTAL_NOTIONAL` / `DRY_RISK_OFF_MAX_TOTAL_NOTIONAL`.
  - Updated workflow override handling to write profile-specific and legacy `DRY_*` values together.
  - Added bridge inputs for high-price/adaptive-entry knobs so US_Alpha_Seeker manual dispatch can reach the real
    sidecar workflow without local template-only drift.

- 2026-04-30 KST (execution sizing hardening):
  - Added high-price whole-share sizing policy (`ENTRY_HIGH_PRICE_POLICY=skip|min_one_share`).
  - Added one-share notional/risk caps (`ENTRY_MIN_ONE_SHARE_MAX_NOTIONAL`,
    `ENTRY_MAX_RISK_DOLLARS_PER_TRADE`).
  - Extended order decision audit with requested notional, actual whole-share notional, broker quantity, dollar
    risk, and high-price sizing reason.
  - Kept default policy conservative (`skip`); paper canaries can opt in with `min_one_share`.

- 2026-04-29 KST (execution stabilization reset):
  - Reopened M1 because current operation still shows payload/preview paths that do not always become Alpaca paper
    submissions.
  - Promoted `state/last-order-decision-audit.json` and `state/order-decision-audit.jsonl` as required evidence
    for per-symbol payload/skip/broker diagnosis.
  - Deferred Stage 7 `Performance / Trading Ops` expansion until order path stabilization is green again.
  - Deferred Notion/Obsidian/NotebookLM loop work until always-on NotebookLM/source-refresh environment is available.

- 2026-04-22 UTC/KST:
  - Initialized living development plan.
  - Set current milestones and active backlog.
  - Established mandatory update rule for ongoing work.
- 2026-04-22 UTC/KST (Notion audit):
  - Confirmed latest sidecar dry-run / market-guard rows are collected in Notion.
  - Confirmed HF Tuning Tracker and Performance Dashboard structures are reachable.
  - Added explicit backlog for Notion data-quality automation and cross-tool ownership model.
- 2026-04-22 UTC/KST (ops automation):
  - Added `npm run ops:notion:audit` (`scripts/build-notion-ops-audit.mjs`).
  - Audit checks required fields, duplicate run keys, and latest-row staleness for Daily Snapshot DB.
  - Outputs: `state/notion-ops-audit.json` and `state/notion-ops-audit.md`.
  - Added run-key scope control (`NOTION_AUDIT_RUNKEY_PREFIXES`, default `sidecar-`) to avoid cross-engine false positives.
  - Validation result: `status=pass rows=39 missingRows=0 duplicateRunKeys=0`.
- 2026-04-22 UTC/KST (workflow wiring):
  - Root workflow `/.github/workflows/mcp-ops-daily.yml` now runs `ops:notion:audit`.
  - Workflow publishes audit markdown into Step Summary and uploads audit artifacts.
- 2026-04-22 UTC/KST (daily report auto):
  - Added `npm run ops:daily:report` (`scripts/build-ops-daily-report.mjs`).
  - Report aggregates GitHub workflow KPI window (canary + sidecar dry-run) and Notion audit status.
  - Outputs: `state/ops-daily-report.json` and `state/ops-daily-report.md`.
  - Root workflow `/.github/workflows/mcp-ops-daily.yml` now publishes and uploads ops daily report artifacts.
- 2026-04-22 UTC/KST (integration audit):
  - Added end-to-end pipeline connectivity audit document:
    - `docs/AUTOMATION_PIPELINE_INTEGRATION_AUDIT_2026-04-22.md`
  - Classified each lane as `Connected / Partial / Not connected`.
  - Baseline score: `13/20 connected (65.0%)`.
  - Promoted next critical closures:
    - consolidated Notion daily upsert,
    - canary KPI marker ingestion in ops daily report,
    - sidecar-to-knowledge handoff contract.
  - After P0 closure updates: `15/20 connected (75.0%)`.
- 2026-04-22 UTC/KST (knowledge markdown guard):
  - Hardened NotebookLM summary sanitizer in `scripts/knowledge-intake-pipeline.mjs` for:
    - trailing citation-number residue cleanup,
    - divider normalization (`### -` -> `---`),
    - inline label promotion (`- [Label] ...`),
    - consecutive duplicate section-header suppression.
  - Added quality audit script `npm run ops:knowledge:quality` (`scripts/check-knowledge-markdown-quality.mjs`).
  - Wired `.github/workflows/knowledge-intake-pipeline.yml` to run markdown quality check and upload quality report artifacts.
  - Added prevention runbook: `docs/KNOWLEDGE_MARKDOWN_ERROR_PREVENTION_2026-04-22.md`.
- 2026-04-22 UTC/KST (ops daily Notion integration):
  - Added canary verify log marker ingestion in `scripts/build-ops-daily-report.mjs`:
    - parses `[PREFLIGHT_CANARY_VERIFY] preflight_pass=... attempted=... submitted=...`
    - aggregates parsed run ratio + attempted/submitted totals.
  - Added consolidated Notion upsert script:
    - `npm run ops:daily:notion:sync` (`scripts/sync-notion-ops-daily.mjs`)
    - run key: `ops-daily-YYYY-MM-DD`
    - output: `state/notion-ops-daily-sync.json`
  - Root workflow `/.github/workflows/mcp-ops-daily.yml` now executes ops daily Notion sync and publishes sync summary.
- 2026-04-23 UTC/KST (ops daily evidence hardening):
  - `scripts/build-ops-daily-report.mjs` now emits `evidence.*` links (`ops_run`, latest canary/dry-run/guard, primary).
  - `scripts/sync-notion-ops-daily.mjs` now enforces evidence URL by default (`NOTION_OPS_DAILY_REQUIRE_EVIDENCE_URL=true`).
  - Notion sync now requires one URL + matching property alias (`Evidence URL` / `Run URL` / `Workflow URL`) and writes summary fields (`evidencePrimary`, `evidenceCount`).
  - Root workflow `/.github/workflows/mcp-ops-daily.yml` now exports `NOTION_OPS_DAILY_REQUIRE_EVIDENCE_URL` and shows evidence sync summary in Step Summary.
- 2026-04-23 UTC/KST (ops daily evidence mapping override):
  - Added explicit Notion column override envs:
    - `NOTION_OPS_DAILY_EVIDENCE_URL_PROPERTY`
    - `NOTION_OPS_DAILY_EVIDENCE_LINKS_PROPERTY`
  - Missing-evidence-property failure now includes override values and schema candidate hints for faster DB alignment.
  - Step Summary now includes resolved evidence property names (`evidenceUrlProperty`, `evidenceLinksProperty`).
  - `mcp-ops-daily.yml` default fallback for links property set to `Run Actions` (can be overridden by repo variable).

## 2026-05-17 - Paper OCO Canary Result and Persistent Repair Planning

- Added paper OCO canary result reporting:
  - `npm run ops:paper-oco-result`
  - output: `state/paper-oco-canary-result-report.json` / `.md`
  - pass requires: broker submit attempted/submitted, nested visibility, rollback cancel, rollback terminal verification, and terminal submit ledger.
- Added Notion backfill workflow for canary result records:
  - `.github/workflows/paper-oco-canary-result-sync.yml`
  - consumes a prior `paper-oco-submit-canary-*` artifact and syncs a separate Automation Incident Log row without broker calls.
- Added persistent OCO repair planner:
  - `npm run ops:persistent-oco-plan`
  - output: `state/persistent-oco-repair-plan.json` / `.md`
  - report-only, paper-only, one dynamic row, `autoCancel=false`, no POST until a separate exact-approval persistent repair task.
- Added non-mutating persistent OCO repair visibility:
  - `scripts/build-ops-health-report.mjs` now includes persistent repair plan safety status, selected dynamic row, and attempted/submitted guard metrics.
  - `scripts/sync-notion-summary.mjs` now syncs persistent repair status/selection/attempted/submitted fields to the Performance Dashboard when matching Notion columns exist.
  - Added `.github/workflows/persistent-oco-repair-plan-verify.yml` to rebuild the planner from a sidecar artifact and prove `brokerMutationAttempted=false` / `brokerMutationSubmitted=false` without broker POST calls.
- 2026-05-17 UTC/KST follow-up:
  - Manual `safe_default` dry-run on head `59ddb5b` exposed a real admission/state issue: an already-held symbol could still be admitted as a fresh entry payload when lifecycle scale-up was not active.
  - Portfolio admission now blocks same-symbol fresh entries for held positions unless the payload action is an explicit `SCALE_UP`.
  - Performance dashboard and order-state consistency now treat fillability `BLOCKED_*` / `NO_ACTIVE_ORDER` rows as non-fill-state evidence, while preserving `PAYLOAD_READY_NO_BROKER_MATCH` as planned-order evidence so duplicate-entry risks still fail.

## 2026-05-19 - Persistent Protective OCO GTC Hardening

- Diagnosed the first persistent protective OCO proof failure mode:
  - QFIN/BZ/ACAD no-auto-cancel paper OCO repairs were visible during RTH but disappeared after market close.
  - Root cause classification: `time_in_force=day` was incompatible with the intended persistent protection proof.
- Hardened persistent repair payload generation:
  - `npm run ops:persistent-oco-plan` now emits `time_in_force=gtc` for persistent OCO repair payload previews.
  - persistent repair idempotency keys include `tif=gtc` so expired DAY proof orders do not block corrected GTC repairs.
  - persistent repair client order IDs include `gtc` plus a deterministic payload fingerprint.
- Hardened approved submit verification:
  - `npm run ops:persistent-oco-submit` rebuilds/overrides persistent payloads as GTC and blocks non-GTC payloads via `persistent_payload_time_in_force_gtc`.
  - `.github/workflows/persistent-oco-repair-submit.yml` asserts selected dynamic rows and submitted payloads use GTC before/after broker mutation.
- Updated offline Alpaca fixtures and docs:
  - `testdata/alpaca/oco-exit-long-repair.paper.fixture.json`
  - `testdata/alpaca/oco-repair-nested-open.paper-response.fixture.json`
  - `docs/ALPACA_CHILD_OCO_PAYLOAD_SCHEMA.md`
  - `docs/ALPACA_OCO_PAPER_CANARY_RUNBOOK.md`
- Validation commands:
  - `node --check scripts/build-persistent-oco-repair-plan.mjs`
  - `node --check scripts/run-persistent-oco-repair-submit.mjs`
  - `node --check scripts/validate-alpaca-order-payload-fixtures.mjs`
  - `node --check scripts/validate-alpaca-oco-response-fixtures.mjs`
  - `npm run ops:alpaca:payload-fixtures`
  - `npm run ops:alpaca:oco-response-fixtures`
  - `npm run build`
- Next broker-mutating step remains separately gated:
  - During RTH, submit one corrected GTC persistent repair row at a time only after the exact approval phrase and scoped symbol are supplied.
  - After market close / next pre-RTH, run GET-only open verification to prove GTC persistence.

## 2026-05-19 - Persistent OCO Multi GET-Only Verification and Replanner Guardrails

- Added multi-submit persistent OCO open verification:
  - `npm run ops:persistent-oco-open-verify:multi`
  - `.github/workflows/persistent-oco-repair-open-verify-multi.yml`
  - output: `state/persistent-oco-repair-open-verify-multi.json` / `.md`
  - verifies multiple prior persistent submit artifacts together with Alpaca paper GET-only reads.
  - required invariants: `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`, parent client order visible, stop child visible, target child visible, active protection `time_in_force=gtc`.
- Strengthened ops/Notion visibility:
  - `scripts/build-ops-health-report.mjs` now reads multi-verify status, symbols, pass/fail counts, and fails if the verifier ever indicates broker mutation.
  - `scripts/sync-notion-summary.mjs` maps multi-verify overall/reports/pass/fail/symbols/summary to Performance Dashboard columns when those columns exist.
- Strengthened persistent repair selector safety:
  - persistent planner rows now expose `geometry`, `brokerStopPresent`, `brokerTargetPresent`, `brokerSellOrderCount`, and `safetyDecision`.
  - planner blocks inconsistent rows where both children are marked missing while active sell orders exist.
  - invalid geometry remains `do_not_submit`; ACAD-like rows must not be forced into repair.
- Next sidecar/RTH observation criteria:
  - QFIN/BZ repaired rows should remain `BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED` with stop and target present.
  - `persistent-oco-repair-plan` should remain `blocked_no_eligible_row` unless a genuinely unprotected filled position with valid geometry appears.
  - no duplicate OCO should be generated for already protected rows.
  - post-close/pre-RTH multi GET-only verification is the proof that GTC fixed the prior DAY-expiry failure mode.

## 2026-05-20 - Runtime Symbol-Agnostic Safety Check

- Clarified OCO repair scope: QFIN/BZ/ACAD/TSLA are current proof/evidence symbols only, not target-specific runtime behavior.
- Added runtime hard-code guard:
  - `npm run ops:safety:symbol-agnostic`
  - output: `state/symbol-agnostic-runtime-check.json` / `.md`
  - scans `src`, `scripts`, and `.github/workflows` for current proof symbols.
  - docs and test fixtures may keep example symbols; runtime code and workflows must remain dynamic.
- Wired the guard into persistent OCO submit/open-verify workflows so approved repairs and GET-only verifiers fail before broker interaction if runtime symbol hard-coding appears.

## 2026-05-20 - OCO Repair Guard Metadata Risk Gate

- Added guard metadata risk evaluation for repair candidates:
  - `scripts/lib/guard-metadata-risk.mjs`
  - blocks stale guard metadata, already-breached stop/target, and near-breach stop/target before a protective OCO can be approved.
- Extended repair planning and paper canary selectors:
  - `npm run ops:persistent-oco-plan`
  - `npm run ops:paper-oco-canary`
  - `npm run ops:paper-oco-gate`
  - selected rows now carry `guardMetadataRisk`; summaries expose stale/breached/near-breach counts.
- Hardened broker-mutating submit lanes:
  - `npm run ops:paper-oco-submit-gate`
  - `npm run ops:persistent-oco-submit`
  - static selected-row gates now require `selected_guard_metadata_fresh` and `selected_guard_not_near_breached`.
  - read-verify submit prechecks add `pre_submit_guard_metadata_fresh` and `pre_submit_guard_not_near_breached` using live Alpaca position current price before any POST.
- Safety invariant:
  - no broker mutation is allowed when guard metadata is stale, stop/target is already breached, or the current price is within the configured near-breach threshold.
  - default thresholds are `OCO_REPAIR_GUARD_METADATA_MAX_AGE_MIN=30` and `OCO_REPAIR_GUARD_NEAR_BREACH_PCT=1`.
- New-order non-submission track:
  - `npm run ops:fillability` now exposes high-price sizing diagnostics for `entry_notional_below_limit_price`.
  - report-only fields include requested notional, one-share notional, one-share risk dollars, configured one-share caps, and whether `ENTRY_HIGH_PRICE_POLICY=min_one_share` would fit those caps.
  - changing `ENTRY_HIGH_PRICE_POLICY` remains an execution-policy decision; diagnostics do not alter order creation defaults.
- Manual canary workflow support:
  - `.github/workflows/dry-run.yml` now supports `run_verify_mode=safe_min_one_share_admission_probe` for `workflow_dispatch` only.
  - The preset keeps `READ_ONLY=true`, `EXEC_ENABLED=false`, and `LIVE_ORDER_SUBMIT_ENABLED=false` while applying `ENTRY_HIGH_PRICE_POLICY=min_one_share`, `DRY_MAX_TOTAL_NOTIONAL=300`, and `PORTFOLIO_MIN_FILLABILITY_SCORE=50` for that one run.
  - This avoids GitHub's 25-input `workflow_dispatch` limit and keeps repository defaults unchanged while allowing a safe read-only canary to determine whether `portfolio_fillability_below_floor` is the final blocker after one-share sizing and max-total-notional caps are satisfied.

## 2026-05-20 - Risk-Capped Open-Order Reprice Proposal

- Added report-only open-order reprice planning for stale/persistent open entries:
  - `npm run ops:open-order-reprice-proposal`
  - output: `state/open-order-reprice-proposal.json` / `.md`
  - wired into `.github/workflows/dry-run.yml` after order-state consistency and before ops health.
- The proposal is symbol-agnostic and reads current sidecar evidence from:
  - `state/last-dry-exec-preview.json`
  - `state/fillability-report.json`
  - `state/order-state-consistency-report.json`
- Safety invariant:
  - report-only only; `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - no replace is considered ready unless ledger consistency passes, duplicate open count is clean, broker order is still open, RR remains above floor, and risk dollars stay within `ENTRY_MAX_RISK_DOLLARS_PER_TRADE`.
- Reprice price discipline:
  - current/suggested chase is not used directly.
  - max candidate price is capped by `plannedStop + maxRiskDollarsPerTrade / qty`.
  - rows that would breach risk at the current/suggested price are surfaced as ops warnings instead of mutating broker orders.
- Ops health now surfaces:
  - `openRepriceProposal`, `openRepriceReady`, `openRepriceRiskBreaches`, `openRepriceAttempted`, `openRepriceSubmitted`.
- Current ADBE proof case:
  - existing limit stayed at `$245.12`.
  - current/suggested near-market reprice exceeded the `$25` max-risk cap.
  - risk-capped limit was approximately `$247.44`, so the correct behavior is no automatic replace and continued report-only monitoring unless a separate guarded replace approval is later requested.

## 2026-05-21 - Guard Metadata Refresh Plan Wiring

- Completion check found the prior guard-metadata commit only added the planner script; it was not yet wired into package scripts, CI artifact upload, ops health, or Notion telemetry.
- Added the report-only refresh lane wiring:
  - `npm run ops:guard-metadata-refresh`
  - output: `state/guard-metadata-refresh-plan.json` / `.md`
  - `.github/workflows/dry-run.yml` builds/publishes the plan after position-protection root-cause audit.
  - sidecar state artifacts now include both guard metadata refresh outputs.
- Goal/Team mapping:
  - Goal 1: current position stop/target metadata is re-sourced dynamically from broker children, recommendation ledger, Stage6 20-trade loop, then order ledger.
  - Goal 2: missing guard metadata now surfaces as `BLOCKED_NO_REFRESH_SOURCE` instead of being misclassified as broker repair work.
  - Goal 3: stale metadata surfaces as `BLOCKED_REFRESH_SOURCE_STALE`; repair can only be re-evaluated after a fresh, valid source exists.
  - Goal 4: open-order reprice remains independent and report-only; Notion/ops now include open reprice row count plus attempted/submitted flags.
- Safety invariant:
  - guard refresh is report-only only; `brokerMutationAllowed=false`, `stateMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - no ledger write, broker submit, cancel, replace, or OCO repair occurs from this lane.
  - any future metadata write or protective repair still requires a separate approval-gated task.
- Next run observation criteria:
  - artifact includes `guard-metadata-refresh-plan.json` / `.md`.
  - ops health files line shows `guardRefresh=ok`.
  - ops key metrics include `guardRefresh`, `guardRefreshReady`, `guardRefreshBlocked`, `guardRefreshRepairAfterRefresh`, `guardRefreshAttempted`, and `guardRefreshSubmitted`.
  - Notion Performance Dashboard summary/log includes the same guard refresh fields.
  - if refresh creates repair re-evaluation candidates, that is a manual-review signal only; broker/state mutation remains false.

## 2026-05-21 - Goal/Team Status Lane Report

- Added a symbol-agnostic lane status report to make the Goal/Team operating model explicit:
  - `npm run ops:lane-status`
  - output: `state/ops-lane-status-report.json` / `.md`
  - `.github/workflows/dry-run.yml` builds/publishes the report after persistent OCO repair planning and before ops health.
- Lanes are status buckets, not ticker-specific workflows:
  - `Guard Metadata Missing Lane`
  - `Guard Metadata Stale Lane`
  - `Broker Children Present Monitor Lane`
  - `Valid Guard + Missing Child Repair Candidate Lane`
  - `Invalid Geometry Root-Cause Lane`
  - `Open Order Risk-Capped Reprice Lane`
  - `New Order / Fillability / Submit Path Lane`
- Safety invariant:
  - lane status is report-only; no broker mutation, no state mutation, no submit/replace/cancel.
  - actual paper/live broker mutation still requires a separate approval-gated task.
- Fillability hardening:
  - latest quote midpoint now rejects invalid bid/ask (`bid <= 0`, `ask <= 0`, or `ask < bid`) and falls back to execution overlay / monitor price.
  - `fillability-report` and ops health now expose `invalidQuoteCount` / `invalidQuotes` so quote-quality distortion is visible.
- Next run observation criteria:
  - artifact includes `ops-lane-status-report.json` / `.md`.
  - ops health files line shows `laneStatus=ok`.
  - Notion Performance Dashboard logs include `laneStatus`, `laneBlocked`, `laneAttempted=false`, and `laneSubmitted=false`.
  - high-price sizing blockers remain classified under the new-order/fillability lane, not submit-path failure.

## 2026-05-21 - Notion Performance Dashboard Open-Reprice Columns

- Added idempotent Notion Performance Dashboard schema ensure for open-order reprice telemetry.
- `scripts/sync-notion-summary.mjs` now creates these columns when missing before writing the Performance Dashboard row:
  - `Open Reprice Proposal Overall` (`select`)
  - `Open Reprice Ready` (`number`)
  - `Open Reprice Rows` (`number`)
  - `Open Reprice Risk Breaches` (`number`)
  - `Open Reprice Attempted` (`checkbox`)
  - `Open Reprice Submitted` (`checkbox`)
  - `Open Reprice Summary` (`rich_text`)
  - `Position Protection Guard Missing` (`number`)
  - `Guard Metadata Refresh Overall` (`select`)
  - `Guard Metadata Refresh Ready` (`number`)
  - `Guard Metadata Refresh Blocked` (`number`)
  - `Guard Metadata Refresh No Source` (`number`)
  - `Guard Metadata Refresh Stale Source` (`number`)
  - `Guard Metadata Refresh Invalid Geometry` (`number`)
  - `Guard Metadata Refresh Repair After Refresh` (`number`)
  - `Guard Metadata Refresh Attempted` (`checkbox`)
  - `Guard Metadata Refresh Submitted` (`checkbox`)
  - `Guard Metadata Refresh Summary` (`rich_text`)
  - `Ops Lane Status Overall` (`select`)
  - `Ops Lane Status Blocked` (`number`)
  - `Ops Lane Manual Approval Candidates` (`number`)
  - `Ops Lane Attempted` (`checkbox`)
  - `Ops Lane Submitted` (`checkbox`)
  - `Ops Lane Status Summary` (`rich_text`)
- Safety/ops behavior:
  - schema ensure is controlled by `NOTION_PERFORMANCE_DASHBOARD_SCHEMA_ENSURE_ENABLED` (default `true`).
  - schema ensure is non-blocking by default unless `NOTION_PERFORMANCE_DASHBOARD_SCHEMA_ENSURE_REQUIRED=true`.
  - no broker or order mutation is involved.
- Evidence:
  - writes `state/notion-performance-dashboard-schema-report.json` / `.md`.
  - `.github/workflows/dry-run.yml` uploads those reports with the sidecar state artifact.
  - Notion sync logs now include `openReprice`, `openRepriceRows`, `openRepriceReady`, `openRepriceAttempted`, `openRepriceSubmitted`, `guardRefresh`, `guardRefreshReady`, `guardRefreshRepairAfter`, and the concrete dashboard ops fields written.

## 2026-05-21 - Position Protection Root-Cause Audit

- Added a symbol-agnostic root-cause audit for held-position protection gaps:
  - `npm run ops:position-protection:audit`
  - output: `state/position-protection-root-cause-audit.json` / `.md`
  - wired into `.github/workflows/dry-run.yml` after order-state consistency and before open-order reprice/repair planners.
- Audit purpose:
  - separate broker child-order gaps from guard metadata gaps.
  - detect stale stop/target metadata before any protective OCO repair can be approved.
  - detect invalid stop/current/target geometry, including stop/current drift where planned stop is at or above current price.
  - keep all decisions portfolio-wide and dynamic; proof symbols are examples only, not runtime targets.
- Safety invariant:
  - report-only only; `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - stale guard metadata blocks repair lanes until refreshed from a current Stage6 or position-lifecycle source.
  - invalid guard geometry blocks repair lanes and routes to Stage6/guard-metadata root-cause review instead of broker repair.
- Repair planner hardening:
  - persistent OCO and paper OCO canary selectors now evaluate guard metadata freshness from the planned guard source timestamp (`plannedLedgerUpdatedAt`) instead of the newly generated reconciliation report timestamp.
  - `null` planned stop/target values are no longer coerced to zero in the persistent repair planner.
- Next run observation criteria:
  - artifact includes `position-protection-root-cause-audit.json` / `.md`.
  - ops health key metrics include `protectionAudit`, `protectionStale`, `protectionInvalidGeometry`, and `protectionBrokerChildMissing`.
  - Notion Performance Dashboard summary/log includes `protectionAudit`, `protectionStale`, `protectionInvalidGeometry`, and `protectionBrokerChildMissing`.
  - if a held position has stale or invalid guard metadata, persistent repair selection must be blocked rather than promoted to approval.

## 2026-05-21 - Guard Lineage + Min-One-Share Canary Goal/Team

- Completed the two-lane Goal/Team expansion as report-only infrastructure:
  - Goal 1: `npm run ops:guard-metadata:lineage`
    - output: `state/guard-metadata-lineage-audit.json` / `.md`
    - proves where held-position stop/target lineage is connected or disconnected across performance dashboard, broker children, recommendation ledger, Stage6 loop, order ledger, idempotency, fillability, and current preview records.
  - Goal 2: `npm run ops:high-price:min-one-share-canary`
    - output: `state/high-price-min-one-share-canary-plan.json` / `.md`
    - selects a dynamic high-price sizing candidate only when `ENTRY_HIGH_PRICE_POLICY=min_one_share` would fit one-share notional/risk caps and there is no active/terminal broker state.
- Workflow/telemetry wiring:
  - `.github/workflows/dry-run.yml` now builds and uploads both reports.
  - ops health now exposes `guardLineage*` and `minOneShareCanary*` metrics and fails if either lane attempts/submits broker mutation.
  - ops lane status now uses the lineage audit for missing/stale/invalid guard source routing and labels high-price min-one-share candidates as safe payload-probe candidates.
  - Notion Performance Dashboard schema ensure/sync now includes guard lineage and min-one-share canary fields.
- Safety invariant:
  - both lanes are report-only; `brokerMutationAllowed=false`, `stateMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - the min-one-share lane is a safe dry-run payload-generation probe only, not a submit approval.
  - any later broker visibility test still requires a separate approval-gated run and must prove preflight, idempotency, and Alpaca visibility.
- Safe canary observation criteria:
  - dispatch dry-run with `run_verify_mode=safe_min_one_share_admission_probe`, `run_entry_high_price_policy=min_one_share`, `run_dry_max_orders_override=1`, `run_dry_max_total_notional_override=600`, `run_entry_min_one_share_max_notional=300`, and `run_entry_max_risk_dollars_per_trade=25`.
  - done when payload generation is observed with `brokerMutationAttempted=false` and `brokerMutationSubmitted=false`.
  - if payload remains zero, inspect `orderReadiness`, `topSkip`, `portfolioAdmission`, and `fillability-report` before changing Stage6 or entry logic.

## 2026-05-22 - Sidecar RTH Audit Stabilization

- Latest RTH sidecar failures were caused by `npm run ops:order-state` exiting non-zero on a state-consistency audit failure (`ATAT` mixed fill state), not by a broker submit exception.
- Updated order-state consistency behavior:
  - security/account redaction failures still hard-exit.
  - state consistency failures remain `overall=FAIL` in `state/order-state-consistency-report.json` / `.md` and ops health, but do not fail the whole sidecar workflow unless `ORDER_STATE_CONSISTENCY_EXIT_ON_FAIL=true`.
  - no broker mutation is introduced; this remains report-only.
- Ops health now consumes order-state consistency as a first-class signal (`orderState`, failures/warnings, redaction status) so the workflow can keep producing artifacts while preserving critical visibility.
- GitHub Step Summary cleanup:
  - `Sidecar Dry-Run Summary` now starts with a compact table for Stage6, payload, safety, and preflight.
  - verbose key/value diagnostics are collapsed under `Verbose diagnostics` to reduce broken-looking markdown/noisy tables.
- Next observation criteria:
  - fresh RTH safe run succeeds at workflow level.
  - payload remains visible when safe min-one-share probe is enabled.
  - `attempted=0` and `submitted=0` remain true in safe mode.
  - order-state `FAIL` is routed to ops health/Notion, not treated as a sidecar infrastructure crash.
- Follow-up fix:
  - latest safe run showed `payloadCount=0` because a currently held symbol consumed the pre-admission `maxOrders=1` slot and was rejected only later by portfolio admission; the next valid candidate then hit `max_orders_reached`.
  - added a report-safe pre-admission held-position gate so held `ENTRY_NEW` rows are skipped before capacity allocation. This keeps candidate selection symbol-agnostic and prevents one held symbol from starving the next valid payload candidate.

## 2026-05-24 - Terminal State and Guard Freshness Split

- Current calendar note: this review ran outside US RTH, so fresh RTH submit-path validation is deferred until the next market session.
- Order-state mixed handling:
  - terminal broker/fill evidence that conflicts with stale ledger/idempotency `submitted/open` evidence is now classified as `TERMINAL_RECONCILIATION_REQUIRED` instead of a generic hard state failure.
  - true terminal-vs-terminal conflicts remain `FAIL`.
  - the audit remains report-only and non-mutating; it does not repair ledgers automatically.
- Guard metadata lineage:
  - added per-source `freshnessStatus`, `geometryStatus`, row-level `rootCause`, and aggregate root-cause/freshness counts.
  - expected root-cause classes: `NO_SOURCE_WITH_STOP_TARGET`, `SOURCE_AGE_EXCEEDED`, `SOURCE_TIMESTAMP_MISSING`, `FRESH_SOURCE_INVALID_GEOMETRY`, `FRESH_VALID_SOURCE_AVAILABLE`.
  - source freshness gaps are explicitly separated from broker child-order repair; repair remains blocked until fresh valid stop/current/target metadata exists.
- Next RTH done-when:
  - latest fresh Stage6 safe run produces `payloadCount>=1` if an unheld executable candidate exists.
  - safe runs keep `attempted=0` and `submitted=0`.
  - order-state terminal reconciliation rows are visible but do not crash the sidecar workflow.
  - guard lineage root causes are visible in `guard-metadata-lineage-audit.json/md` and `ops-health-report.json/md`.

## 2026-05-24 - Payload Expectation and TopSkip Route Split

- Added order-decision route classification so `topSkip` is no longer a flat reason blob:
  - `portfolio_held`: already-held symbol blocked before creating a new entry payload.
  - `dedupe`: idempotency/deduplication gates that intentionally suppress repeated orders.
  - `stale_source`: stale symbol/source metadata that must be fixed upstream before submit-path testing.
  - other route buckets include entry distance, price geometry, sizing, capacity, quality gate, and contract gate.
- `last-order-decision-audit.json` and `last-dry-exec-preview.json` now include:
  - `summary.topSkipReasonCategories`
  - `summary.payloadExpectation`
- Payload expectation invariant:
  - `payloadCount>=1` is required only when at least one unheld executable candidate survives portfolio-held, dedupe, and stale-source gates.
  - a held executable candidate with `portfolio_held_symbol_entry_blocked` is a valid no-new-order route, not evidence that payload generation is broken.
- GitHub `Sidecar Dry-Run Summary` now prints `order_decision_routes` with top-skip categories and the unheld-executable payload expectation status.
- Safety invariant:
  - this is report-only observability; it does not mutate broker state, idempotency state, or order ledgers.
  - safe runs must still show `attempted=0` and `submitted=0` until a separate approval-gated submit test is explicitly confirmed.

## 2026-05-25 - Pre-RTH Readiness Lane Hardening

- Calendar note:
  - 2026-05-25 is a US market holiday, so RTH validation is deferred to the next normal session.
- Ops lane status now refuses to treat stale local preview artifacts as current payload readiness:
  - `track_7_new_order_fillability_submit_path` reports `stale_preview_wait_fresh_rth` when `last-dry-exec-preview.json` exceeds `OPS_LANE_STATUS_MAX_PREVIEW_AGE_MIN` (default `1440`).
  - it reports `missing_decision_audit_wait_fresh_rth` when no `last-order-decision-audit.json` / embedded order-decision records are available.
  - stale/missing states count as blocked lanes in `ops-lane-status-report.json/md`.
- Purpose:
  - prevent an old preview with `payloadCount>0` from being mistaken for the next RTH proof.
  - force the next RTH judgment to use fresh `payloadExpectation`, `topSkipReasonCategories`, and decision-audit rows.
- Safety invariant:
  - report-only only; `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
- Next RTH done-when:
  - fresh sidecar run updates `previewGeneratedAt` within the configured age window.
  - `decisionAuditRows > 0`.
  - if an unheld executable candidate exists, `payloadExpectation.status=pass_payload_ready` and `unheldExecutablePayloadReady>=1`.
  - safe mode still shows `attempted=0` and `submitted=0`.

## 2026-05-27 - Entry/Reprice Policy Split for Fillability Blocks

- Current blocker class:
  - do not lower `PORTFOLIO_MIN_FILLABILITY_SCORE` just because a candidate is rejected by `portfolio_fillability_below_floor`.
  - first separate whether the rejection is caused by current price moving too far above Stage6 entry, RR falling below the minimum at current price, invalid stop/current/target geometry, or a genuinely reviewable adaptive-entry/reprice case.
- Added report-only lane:
  - `state/entry-reprice-policy-decision.json`
  - `state/entry-reprice-policy-decision.md`
  - npm script: `npm run ops:entry-reprice-policy`
- Decision policy:
  - `WAIT_PULLBACK_RR_BELOW_MIN`: current-price RR is below `ENTRY_PRICE_MIN_RR`; keep the Stage6 pullback limit and do not lower fillability floor.
  - `WAIT_PULLBACK_DISTANCE_TOO_FAR` / `WAIT_PULLBACK_ABOVE_ADAPTIVE_BAND`: current price is outside the adaptive/reprice band; keep wait-pullback route.
  - `ENTRY_REPRICE_REVIEW_READY`: current price remains inside the adaptive band and RR is preserved; this is manual-review only, not an automatic replace/submit.
  - `BLOCK_PRICE_GEOMETRY`: stop/current/target geometry is invalid; route to Stage6/guard metadata root-cause, not broker repair.
- Safety invariant:
  - report-only only; `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - any future replace/submit verification still requires a separate approval-gated `CONFIRM LIVE EXECUTION` scope.
- Next RTH done-when:
  - artifact upload includes `entry-reprice-policy-decision.json/md`.
  - RYAAY-like cases show `report_only_wait_pullback` with `WAIT_PULLBACK_RR_BELOW_MIN` when current-price RR is below policy floor.
  - ops health and Notion Performance Dashboard reflect entry/reprice policy status without mutating broker/order state.

## 2026-05-27 - Combined Entry/Open-Order Reprice Approval Gate

- RTH observation showed the two reprice signals can diverge intraday:
  - `entry-reprice-policy-decision` may be ready while `open-order-reprice-proposal` is blocked by unsafe/non-report-only mode.
  - a safe read-only run may show `open-order-reprice-proposal.readyForApproval>0` while `entry-reprice-policy-decision` has moved back to wait-pullback because current price exceeded the adaptive band.
- Ops lane status now treats guarded replace approval as ready only when both gates align:
  - `entryRepricePolicyReady > 0`
  - `openOrderRepriceReady > 0`
- If open-order reprice is ready but entry policy is not, lane 6 reports `wait_entry_policy_alignment` and no replace approval is requested.
- If entry policy is ready but open-order reprice is not, lane 6 reports `wait_open_order_reprice_ready`.
- Safety invariant:
  - combined gate is report-only and symbol-agnostic.
  - no replace/cancel/submit happens without a separate scoped `CONFIRM LIVE EXECUTION` approval.

## 2026-05-28 - Terminal Reconciliation and Expired Fillability Taxonomy

- Current blocker class:
  - broker terminal states (`expired`, `canceled`, `rejected`) must not leave `order-ledger.json` stuck at `submitted`.
  - an expired order is not automatically a bad alpha pick; it may be a good candidate whose pullback limit was not reached.
- Added/updated report-only behavior:
  - order ledger reconciliation now uses released idempotency evidence as well as active idempotency rows.
  - same Stage6/hash terminal re-entry is blocked by default after broker terminal release evidence.
  - fillability rows for terminal unfilled orders now classify root causes such as `limit_not_reached`, `quote_invalid`, and `pullback_not_filled`.
  - order-state consistency maps `TERMINAL_UNFILLED` with `reason=expired/canceled/rejected` to the matching terminal state instead of a generic mixed terminal bucket.
  - ops health surfaces expired taxonomy and re-entry review requirements.
- Re-entry policy:
  - same Stage6/hash re-entry is not allowed automatically after a terminal unfilled close.
  - re-entry requires either a fresh Stage6 signal or an explicit manual retry/approval lane.
- Safety invariant:
  - report-only only; no broker submit/replace/cancel is performed by this lane.
  - expired taxonomy is symbol-agnostic and must apply to any future submitted symbol, not just the observed sample.
- Next RTH done-when:
  - terminal broker releases transition ledger rows from `submitted` to the matching terminal state.
  - order-state consistency no longer shows terminal reconciliation required for rows whose broker terminal status is known.
  - fillability/ops reports show terminal taxonomy and `reentryReviewRequired` for expired unfilled orders.
  - same Stage6/hash after `expired/canceled/rejected` produces `idempotency_terminal_reentry_requires_fresh_stage6_or_approval`, not a new payload.

## 2026-06-02 - Zero-Executable Decision Audit and Stage6 Proof Guard

- Current blocker class:
  - a Stage6 file may legitimately have `executablePicks=0`, but sidecar observability must still explain why top model/watchlist names were not actionable.
  - `BREAKOUT_RETEST_PROOF_REVIEW_READY` is a producer-side review marker, not proof that sidecar may promote or submit the row.
- Added/updated report-only behavior:
  - when actionable rows are empty, sidecar now emits decision-audit rows from Stage6 diagnostic candidates (`modelTop6`, `watchlistTop`, and all candidate context).
  - top skip categories split Stage6 blockers into `quality_gate`, `risk_geometry`, `entry_distance`, `structure`, and `breakout` instead of collapsing everything into empty/no-payload.
  - `orderDecisionAudit.summary.stage6PolicyAudit` records zero-executable status, breakout proof review-ready counts, proof-confirmed counts, structure waits, and breakout waits.
- Policy:
  - proof-review-ready rows remain `skipped` / `HOLD_WAIT` in sidecar.
  - Stage6 producer must emit a separate proof-confirmed executable row before the normal payload path can consider promotion.
  - overblocking judgment is made from diagnostic rows and categories first; do not lower risk/fillability gates just to force payloads.
- Safety invariant:
  - report-only only; no submit, replace, cancel, or broker mutation behavior changes.
  - safe RTH runs must still preserve `attempted=0` and `submitted=0` unless a separate scoped `CONFIRM LIVE EXECUTION` approval is given.
- Next RTH done-when:
  - if fresh Stage6 still has zero executable picks, `last-order-decision-audit.json.summary.candidates > 0`.
  - `topSkipReasonCategories` shows the dominant blocker class instead of `none`.
  - `payloadExpectation.status=no_unheld_executable` remains acceptable when Stage6 has no unheld executable row.
  - `stage6PolicyAudit.policyVerdict` clearly distinguishes `proof_review_ready_not_promoted` from `proof_confirmed_requires_stage6_policy_review`.

## 2026-06-02 - Progress Scorecard Policy

- Use progress scores as an operator dashboard, not as proof of live readiness.
- Recommended score lanes:
  - Data collection / Harvester readiness: universe freshness, delist/new-list handling, failed ticker taxonomy, OHLCV freshness.
  - Stage0-6 analysis readiness: schema stability, data lineage, zero-executable audit, proof-confirmed entry policy, ranking/entry/stop/target quality.
  - Sidecar simulation readiness: fresh Stage6 consumption, decision audit, idempotency, ledger reconciliation, fillability taxonomy, safe-mode invariants.
  - Paper execution readiness: paper submit visibility, OCO/stop protection, terminal reconciliation, guarded replace/retry lanes.
  - Live readiness: explicit safety checklist only; score must stay below production-ready until dry/paper state separation, approval gates, alerting, and risk caps are proven.
- Interpretation:
  - scores are meaningful only when tied to done-when evidence and recent artifacts.
  - a high sub-score must not override execution safety defaults.

## 2026-06-02 - Protection Metadata Source Precedence and Fill-State Split

- Current blocker class:
  - protection/guard metadata failures were mixed together: stale order-ledger metadata, existing broker child orders, unmanaged/manual positions, and unconfirmed fill state could all surface as a generic repair blocker.
  - this made already-protected rows look stale and made submitted-but-position-present rows look like repair candidates.
- Added/updated report-only behavior:
  - broker child reconciliation now emits portfolio-wide `ownershipClassification`, `fillStateReconciliation`, and effective guard source fields.
  - source precedence now prefers currently observed broker children over stale planned order-ledger guard metadata when both broker stop and target children are present.
  - position protection root-cause audit distinguishes:
    - `NO_ACTION_BROKER_CHILDREN_PRESENT`
    - `BLOCK_REPAIR_POSITION_NOT_SIDECAR_MANAGED`
    - `BLOCK_REPAIR_FILL_STATE_RECONCILIATION_REQUIRED`
    - stale/missing guard metadata and broker-child-missing repair candidates.
  - guard metadata refresh plan reports fresh broker-child monitor rows, fill-state reconciliation blockers, ownership review blockers, and repair reevaluation candidates separately.
  - persistent/paper OCO planners remain report-only and block rows whose fill state is not confirmed filled.
- Safety invariant:
  - no broker/order/state mutation is introduced by this track.
  - `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false` remain mandatory for all refresh/repair planner outputs.
- Next safe-run done-when:
  - rows with active broker stop+target children classify as monitor/no-action even if old ledger metadata exists.
  - sidecar-managed submitted/open positions with broker position evidence classify as fill-state reconciliation required, not repair-ready.
  - external/manual positions classify as ownership review required before any guard metadata backfill or repair lane.
  - latest safe artifact still shows broker mutation attempted/submitted as false.

## 2026-06-02 - Guard Source Recovery and Fill-State Reconciliation Split

- Current blocker class:
  - stale guard sources and fill-state inconsistencies are separate failure modes and must not be merged into one repair diagnosis.
  - a sidecar-managed filled position with stale order-ledger stop/target needs a fresh guard source before repair reevaluation.
  - a position-present row whose ledger/idempotency still says submitted/open needs fill-state reconciliation before any guard source recovery or child-order repair.
- Added/updated report-only behavior:
  - `guard-source-recovery-plan` classifies each held position into fresh-source-required, fill-state-first, ownership-review, invalid-geometry, broker-children-no-action, or repair-reevaluation-ready.
  - `fill-state-reconciliation-audit` classifies position/ledger/idempotency/fillability consistency into confirmed-filled, position-present-open-ledger, terminal-not-filled-position, divergence, unknown, or external ownership review.
  - ops health now surfaces both reports separately so stale source work cannot accidentally mask fill-state reconciliation work.
- Safety invariant:
  - both reports are portfolio-wide and symbol-agnostic.
  - both reports are report-only: `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`, and `stateMutationAttempted=false`.
  - ledger terminalization or guard metadata writes still require a separate scoped approval path.
- Next safe-run done-when:
  - stale-source rows show `FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE`, not repair-ready.
  - submitted/open-position rows show `POSITION_PRESENT_WITH_OPEN_LEDGER_STATE` in fill-state reconciliation.
  - broker-child-present rows remain `NO_ACTION_BROKER_CHILDREN_PRESENT`.
  - ops health includes `guard_source_recovery` and `fill_state_reconciliation` summary lines.

## 2026-06-02 - Broker Fill-State Evidence and Ledger Terminalization Proposal

- Current blocker class:
  - fill-state reconciliation rows must be proven by broker read-only evidence before any ledger/idempotency terminalization is even proposed.
  - stale guard-source recovery remains blocked until fill-state rows are no longer open/submitted or inconclusive.
- Added/updated report-only behavior:
  - `broker-fill-state-evidence` performs Alpaca paper GET-only reads for reconciliation candidates and classifies filled, terminal-unfilled, still-working, or inconclusive evidence.
  - `ledger-terminalization-proposal` converts only confirmed broker evidence into proposed ledger/idempotency patch previews; it never writes state.
  - protective repair remains blocked while terminalization is blocked or evidence is inconclusive.
- Safety invariant:
  - broker evidence is GET-only and paper endpoint gated.
  - ledger/idempotency terminalization is proposal-only; applying patches requires a separate scoped state migration task.
  - no broker mutation, no ledger mutation, no idempotency mutation is introduced.
- Next safe-run done-when:
  - ATAT-style rows show broker evidence verdict and either a ready terminalization proposal or a concrete blocked reason.
  - QFIN/ACAD-style rows stay in fresh-source-required until a fresh Stage6 or position-lifecycle guard source exists.
  - protective repair planners do not re-enter while either fill-state reconciliation or guard-source freshness remains blocked.

## 2026-06-02 - Ledger Filled Migration Report-First Lane

- Current blocker class:
  - broker evidence may prove a submitted/open ledger row is actually filled, but state ledgers must not be edited without an explicit report-first migration plan.
- Added/updated report-only behavior:
  - `ledger-filled-migration-plan` consumes `ledger-terminalization-proposal` and emits backup requirements, file hashes, order-ledger/idempotency diff previews, and audit record previews.
  - migration rows are ready only when broker filled evidence, ledger key, idempotency key, current entries, patch preview, and repair-still-blocked gates all pass.
  - ops lane status keeps protective repair blocked while filled migration rows are waiting for review/apply.
- Safety invariant:
  - this lane does not write `order-ledger.json` or `order-idempotency.json`.
  - migration application requires a separate scoped state migration task with backup, diff, audit record, and restore plan.
- Next done-when:
  - ATAT-style filled rows show `manual_filled_migration_apply_review_ready` with backup/diff/audit previews.
  - QFIN/ACAD-style stale guard rows remain fresh-source-required until a fresh Stage6 or position-lifecycle guard source exists.
  - protective repair remains blocked until state migration is applied and guard source freshness is re-audited.

### 2026-06-02 - Ledger Filled Migration Apply Gate

- Scope: `alpha-exec-engine` / state-only `order-ledger` + `order-idempotency` filled terminalization lane.
- The apply lane is symbol-agnostic and consumes the existing `ledger-filled-migration-plan`; ATAT is only the current evidence row, not a hard-coded operating target.
- Default behavior remains report-only: `LEDGER_FILLED_MIGRATION_APPLY=false` writes `ledger-filled-migration-apply-report` and does not mutate state.
- State apply is blocked unless all gates pass:
  - explicit `LEDGER_FILLED_MIGRATION_APPLY=true`,
  - approval phrase `CONFIRM STATE LEDGER MIGRATION`,
  - ready filled-only rows,
  - max-row/symbol scope guard,
  - current `order-ledger` and `order-idempotency` hashes match the reviewed plan,
  - pre-write backups are created,
  - audit JSONL is written,
  - post-write verification confirms filled ledger/idempotency terminal state.
- Broker mutation remains impossible in this lane; it never places, cancels, or replaces orders.
- Protective repair remains blocked after apply until fill-state reconciliation and guard-source recovery are rerun against the migrated state.

Done-When:

- Safe/default run shows `ledger-filled-migration-apply-report.overall=apply_not_requested_ready_rows_present` or no-ready-row equivalent with `stateMutationApplied=false`.
- Approved state-only run, if explicitly requested, shows `overall=state_migration_applied_and_verified`, backup files under `state/migration-backups/**`, and audit records in `ledger-filled-migration-audit.jsonl`.
- Subsequent audit run clears the fill-state terminalization prerequisite before QFIN/ACAD-style fresh guard source recovery can be re-evaluated.

Note: the regular `sidecar-dry-run` workflow intentionally hard-locks `LEDGER_FILLED_MIGRATION_APPLY=false` because GitHub workflow_dispatch input count is already at the platform limit and dry-run must not become a state-mutation entrypoint. Approved state migration must be run as a separate scoped migration task using `scripts/apply-ledger-filled-migration.mjs` against a reviewed state directory, then followed by the same safe dry-run audit chain.

### 2026-06-02 - Position Lifecycle Guard Source Recovery Lane

- Scope: `alpha-exec-engine` / report-only fresh guard source recovery for sidecar-managed filled positions with stale stop/target metadata.
- Added `position-lifecycle-guard-source-plan` as a symbol-agnostic lifecycle revalidation lane:
  - consumes current performance dashboard positions, broker child reconciliation, position protection audit, guard metadata refresh, and fill-state reconciliation.
  - emits a fresh `position_lifecycle_revalidated_guard` source only when the position is confirmed sidecar-managed filled, current stop/current/target geometry is valid, performance data is fresh, and stop/target are not near-breached.
  - does not write order ledgers, idempotency ledgers, broker orders, or position metadata.
- The protection chain now reruns after lifecycle source planning so broker-child reconciliation, position-protection audit, guard metadata refresh, guard lineage, guard-source recovery, and persistent OCO planning all see the same fresh lifecycle source.
- Safety invariant:
  - `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - `stateMutationAllowed=false`, `stateMutationAttempted=false`.
  - actual protective repair submit still requires a separate scoped approval task with `CONFIRM LIVE EXECUTION`.

Done-When:

- QFIN/ACAD-style stale source rows move from `FRESH_SOURCE_REQUIRED_FROM_STAGE6_OR_LIFECYCLE` to `FRESH_SOURCE_READY_REPAIR_REEVALUATION_REPORT_ONLY` only when lifecycle revalidation passes.
- `guard-metadata-refresh-plan.summary.staleRefreshSource=0` for lifecycle-revalidated rows and `repairReevaluationCandidates>0` when broker children are still missing.
- `ops-lane-status-report` shows `track_4_valid_guard_missing_child_repair_candidate.status=manual_approval_candidate` with no broker mutation.
- `persistent-oco-repair-plan` may select one dynamic row for manual approval, but remains report-only until separately approved.

### 2026-06-03 - Limited Multi Persistent OCO Repair Planner

- Scope: `alpha-exec-engine` / report-only limited multi planner layered above the one-row persistent OCO repair plan.
- Added `limited-multi-oco-repair-plan` as a symbol-agnostic batch visibility lane:
  - consumes `persistent-oco-repair-plan`, `broker-child-order-reconciliation`, and optional multi open verification evidence.
  - classifies every row into already-protected, position ownership review, guard metadata missing, fill-state reconciliation, invalid geometry, or eligible manual approval.
  - caps approval candidates by `LIMITED_MULTI_OCO_REPAIR_MAX_ROWS` and `LIMITED_MULTI_OCO_REPAIR_MAX_QTY_PER_ROW`.
  - does not authorize or implement a multi-row submit lane.
- Safety invariant:
  - `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - protected rows with broker stop+target present remain monitor-only and must not generate duplicate OCO children.
  - TSLA-style external/manual or guard-metadata-missing rows stay on root-cause lanes, not repair lanes.
  - actual broker mutation still requires a separate scoped approval task with `CONFIRM LIVE EXECUTION`.

Done-When:

- Safe sidecar artifacts include `limited-multi-oco-repair-plan.json` / `.md`.
- QFIN/BZ/ACAD/ATAT-style protected rows show `already_protected_no_action`.
- TSLA-style rows show `position_ownership_review` or another concrete blocked group.
- `ops-lane-status-report` includes `track_8_limited_multi_oco_repair_planner`.
- `ops-health-report` includes limited multi OCO metrics and fails if the planner ever reports broker mutation.

### 2026-06-03 - Position Ownership + Guard Metadata Gap Audit

- Scope: `alpha-exec-engine` / report-only root-cause separation for TSLA-style positions that are not sidecar-managed and have no fresh stop/target source.
- Added `position-ownership-guard-gap-audit` as a symbol-agnostic separation lane:
  - consumes performance dashboard positions, position protection root-cause audit, guard metadata lineage, guard source recovery, persistent OCO repair plan, and limited multi OCO repair plan.
  - classifies protected rows as `already_protected_no_action` so duplicate OCO children are not generated.
  - classifies TSLA-style rows as `external_position_and_guard_metadata_missing` when both sidecar ownership evidence and stop/target guard source are absent.
  - emits required evidence before repair can be reconsidered: sidecar order/idempotency ownership proof plus fresh Stage6 or position lifecycle stop/target source.
- Safety invariant:
  - `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - `stateMutationAllowed=false`, `stateMutationAttempted=false`.
  - multi submit remains unauthorized; limited multi planner remains report-only.
  - broker mutation still requires a separate scoped `CONFIRM LIVE EXECUTION` task.

Done-When:

- Safe sidecar artifacts include `position-ownership-guard-gap-audit.json` / `.md`.
- QFIN/BZ/ACAD/ATAT-style protected rows show `already_protected_no_action`.
- TSLA-style rows show `external_position_and_guard_metadata_missing` or another concrete root-cause class, not repair eligibility.
- `ops-lane-status-report` includes `track_9_position_ownership_guard_gap`.
- `ops-health-report` includes ownership guard gap metrics and fails if this audit ever reports broker mutation.

### 2026-06-03 - Position Ownership Recovery Decision Lane

- Scope: `alpha-exec-engine` / report-only decision layer for whether TSLA-style ownership proof should be recovered.
- Added `position-ownership-recovery-decision` as a state-recovery decision lane, not a broker repair lane:
  - consumes ownership gap audit, guard lineage, order ledger, order idempotency, recommendation ledger, persistent OCO plan, and limited multi plan.
  - classifies external/manual rows with no sidecar filled proof and no fresh guard source as `DO_NOT_AUTO_RECOVER_EXTERNAL_NO_OWNERSHIP_NO_GUARD_SOURCE`.
  - only allows `STATE_ONLY_RECOVERY_REVIEW_READY` when both sidecar ownership proof and fresh stop/target guard source exist.
  - requires a separate state-only recovery task with `CONFIRM STATE OWNERSHIP RECOVERY` plus backup, diff, audit, and post-verify before any ledger/metadata mutation.
- Safety invariant:
  - `brokerMutationAllowed=false`, `brokerMutationAttempted=false`, `brokerMutationSubmitted=false`.
  - `stateMutationAllowed=false`, `stateMutationAttempted=false`, `stateMutationApplied=false`.
  - limited multi planner remains report-only.
  - no multi submit lane is authorized; actual broker mutation still requires a separate scoped `CONFIRM LIVE EXECUTION` task.

Done-When:

- Safe sidecar artifacts include `position-ownership-recovery-decision.json` / `.md`.
- TSLA-style external/manual rows are not auto-adopted and show a concrete do-not-auto-recover decision until ownership proof and fresh guard source exist.
- `ops-lane-status-report` includes `track_10_position_ownership_recovery_decision`.
- `ops-health-report` includes ownership recovery decision metrics and fails if this lane reports broker or state mutation.
