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
