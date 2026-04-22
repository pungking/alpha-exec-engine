# Automation Pipeline Integration Audit (2026-04-22)

Updated: 2026-04-22 UTC/KST  
Owner: givet-bsm + Codex  
Scope: `US_Alpha_Seeker` control-plane bridge + `alpha-exec-engine` sidecar automation lanes

---

## 1) Verdict

Not all implemented logic is fully connected into one end-to-end automated pipeline yet.

- **Execution core lanes** are connected and automated.
- **Ops observability lanes** are mostly connected.
- **Knowledge loop lanes** are implemented but still partially disconnected from sidecar daily outputs.

Current integration score (operational connectivity):
- **Connected:** 15
- **Partially connected:** 3
- **Not connected:** 2
- **Coverage:** `15 / 20 = 75.0%`

---

## 2) Integration Matrix (Fact Check)

| Domain | Component | Automation Link | Current Status | Notes |
|---|---|---|---|---|
| Execution | sidecar dry-run (`alpha-exec-engine`) | schedule + manual + repository_dispatch | Connected | Primary runtime lane active |
| Execution | sidecar market-guard | schedule + manual | Connected | Separate guard lane active |
| Execution | sidecar payload probe isolated | manual workflow | Connected | Safe lane; no state cache pollution |
| Execution | preflight gate | runtime + canary verify | Connected | Canary verifies pass marker |
| Execution | broker submit lane | runtime + canary verify | Connected | attempted/submitted markers validated in canary |
| Execution | order idempotency ledger | runtime state (`state/order-idempotency.json`) | Connected | dedupe path in production code |
| Execution | order lifecycle ledger | runtime state (`state/order-ledger.json`) | Connected | transition/state history persisted |
| Execution | approval queue gate | runtime + Drive queue sync | Connected | entry-expansion gating implemented |
| Execution | HF promotion/perf-gate submit dependency | runtime + dry-run summary | Connected | submit guard chain exists |
| Bridge | US webapp schedule -> sidecar dispatch | `schedule.yml` repository_dispatch + fallback workflow_dispatch | Connected | bridge layer active |
| Bridge | sidecar dispatch watchdog (US repo) | `sidecar-dispatch-watchdog.yml` | Connected | stale-run fallback dispatch |
| Sidecar | sidecar native watchdog (runtime repo) | `dry-run-watchdog.yml` | Connected | runtime self-heal lane |
| Ops | Notion per-run sync (dry-run/guard) | `sync-notion-summary.mjs` in sidecar workflows | Connected | daily snapshot rows confirmed historically |
| Ops | Notion data-quality audit | `ops:notion:audit` + `mcp-ops-daily.yml` | Connected | required-field/duplicate/stale checks wired |
| Ops | ops daily report artifact | `ops:daily:report` + `mcp-ops-daily.yml` | Connected | json/md + step summary + artifacts |
| Ops | consolidated daily Notion row | `ops:daily:notion:sync` + `mcp-ops-daily.yml` | Connected | run key `ops-daily-YYYY-MM-DD` upsert |
| Ops | canary KPI ingestion into ops daily report (`preflight_pass`, `attempted`, `submitted`) | `ops:daily:report` canary log parser | Connected | parses `[PREFLIGHT_CANARY_VERIFY]` markers |
| Knowledge | Notion -> Obsidian -> NotebookLM routine | dedicated workflows/scripts exist | Partial | loop exists, linkage to sidecar daily report is weak |
| Knowledge | sidecar daily report -> knowledge pipeline handoff | not enforced | Partial | no mandatory handoff contract |
| Governance | template/runtime workflow drift control | manual sync discipline only | Partial | mirror drift remains operational risk |

---

## 3) What is strong vs weak

### Strong
- Paper-trading execution chain is automation-ready (dry-run, guard, canary, watchdog).
- Safety gates are layered (preflight, perf gate, HF live promotion, idempotency, lifecycle controls).
- Notion operational telemetry is no longer blind; audit + daily report artifacts exist.

### Weak
- Evidence URL mandatory-field enforcement in Notion daily row is not hard-validated yet.
- Knowledge loop is operationally separate from sidecar evidence loop.
- Mirror/template drift can silently increase runbook entropy.

---

## 4) Priority Gap Closure Plan

### P0 (immediate)
1. Add hard link in daily report row to evidence URLs (canary + dry-run).

### P1 (next)
1. Add sidecar->knowledge handoff contract:
   - daily report id, generated timestamp, evidence links, status.
2. Obsidian append automation should consume the same daily JSON payload (not separate ad-hoc logic).
3. NotebookLM ingestion marker should reference same report key.

### P2 (stability hardening)
1. Add mirror drift checker between:
   - `/.github/workflows/*sidecar*`
   - `sidecar-template/alpha-exec-engine/.github/workflows/*`
2. Add fail/warn mode for drift in control-plane workflow.

---

## 5) Done-When (integration completeness target)

Target: **>= 90% connected coverage** and no critical partials in execution/ops governance.

Required completion checks:
1. Consolidated daily Notion row auto-upsert is live for 3 consecutive days.
2. Daily report includes canary trade-quality KPIs (`preflight_pass`, `attempted`, `submitted`) from logs. ✅
3. Knowledge loop references the same daily report key without manual copy-paste.
4. Template/runtime drift checker runs at least daily and reports explicit status.

---

## 6) [BAD] Mismatch / Risk (Priority) + [FIX] Immediate Actions

Evidence timestamp basis:
- Verified on **2026-04-22 (UTC/KST)** from GitHub Actions runs/logs.
- US webapp scheduler run: `24773244727` (success, 2026-04-22T10:24:23Z).
- Sidecar dry-run run: `24775047168` (success, 2026-04-22T11:09:43Z).
- Sidecar canary run: `24759989453` (success, 2026-04-22T04:20:48Z).

### P0-1) Execution-readiness signal can be over-read when market is closed
- [BAD]
  - In `24775047168`, dry-run concluded success but key markers show:
    - `[PREFLIGHT] status=FAIL code=PREFLIGHT_MARKET_CLOSED`
    - `[BROKER_SUBMIT] ... attempted=0 submitted=0`
  - This is valid behavior, but operators can misread `success + HF_LIVE_PROMOTION=PASS` as "execution path is live-ready now."
- [FIX]
  - Keep `PREFLIGHT_SOFT_CODES` behavior, but promote "market closed/no submit" as top-level operational state in daily brief/Notion sync.
  - Add explicit `exec_readiness_now` flag with values:
    - `READY` (preflight pass + attempted>=1 + submitted>=1 in latest executable lane)
    - `BLOCKED_MARKET_CLOSED`
    - `BLOCKED_GATES`
  - Owner lane: `build-ops-daily-report.mjs` + `sync-notion-ops-daily.mjs`.

### P0-2) Canary freshness is not explicitly enforced in ops report
- [BAD]
  - Canary is currently validated by dedicated workflow, but ops daily summary does not hard-fail on stale canary age.
  - Latest successful canary run exists (`24759989453`), but stale-threshold semantics are not first-class in report decision.
- [FIX]
  - Add canary freshness gate (`canaryLatestAgeMin <= CANARY_FRESH_MAX_MIN`, default 360).
  - If stale: set ops daily status to `warn` with reason `canary_stale`.
  - Owner lane: `build-ops-daily-report.mjs`.

### P1-1) Guard mode/source consistency can appear contradictory across channels
- [BAD]
  - Sidecar market-guard scheduled run (`24774265151`) reported `mode=active`.
  - User-facing report snapshot may show `mode=OBSERVE` depending on source/time of embedded summary.
  - This is usually a source/timing issue, but operator confidence drops when not traceable.
- [FIX]
  - Add source provenance fields to all guard summaries:
    - `guard_source_workflow`, `guard_source_run_id`, `guard_source_generated_at`.
  - In daily report, print both "latest standalone guard run" and "embedded dry-run guard context."
  - Owner lane: `build-ops-daily-report.mjs` + guard summary producer script/workflow step summary.

### P1-2) Runtime/template drift risk remains process-based, not enforced
- [BAD]
  - Workflow ownership separation is documented, but drift control is still mostly manual.
- [FIX]
  - Add a daily diff checker job:
    - compare `/.github/workflows/*sidecar*` vs `sidecar-template/alpha-exec-engine/.github/workflows/*`
    - emit `PASS/WARN` artifact and Step Summary.
  - Owner lane: US control-plane workflow + small audit script.
  - Implementation status (2026-04-22):
    - Added script: `scripts/audit-sidecar-workflow-drift.mjs`
    - Added workflow: `.github/workflows/sidecar-workflow-drift-audit.yml`
    - Output artifacts: `state/sidecar-workflow-drift-audit.json`, `state/sidecar-workflow-drift-audit.md`

### P2-1) Knowledge loop is implemented but not contract-enforced from ops daily
- [BAD]
  - Notion/Obsidian/NotebookLM loop exists, but daily sidecar ops report handoff is not a hard contract.
- [FIX]
  - Define handoff contract JSON (`runKey`, `stage6Hash`, `dryRunUrl`, `canaryUrl`, `opsDailyUrl`, `status`).
  - Make knowledge intake pipeline consume this contract first.
  - Owner lane: `knowledge-intake-pipeline.mjs` + ops daily sync output.

---

## 7) Verification Snapshot (Executed)

### Chain Integrity (confirmed)
- Scheduler -> sidecar dispatch linkage:
  - `schedule#24773244727` includes:
    - `[DISPATCH_PREP] file=STAGE6_ALPHA_FINAL_2026-04-22_20-08-25.json hash=ba821534443b`
    - `[DISPATCH_OK] repo=pungking/alpha-exec-engine ... hash=ba821534443b`
- Dry-run consumed same stage signal:
  - `dry-run#24775047168` includes:
    - `[RUN_SUMMARY] ... stage6=STAGE6_ALPHA_FINAL_2026-04-22_20-08-25.json hash=ba821534443b`

### Canary Gate (confirmed)
- `sidecar-preflight-canary-recheck#24759989453` includes:
  - `[PREFLIGHT_CANARY_VERIFY] preflight_pass=true attempted=2 submitted=2`
- Result: canary gate logic is functioning.

### Current Limitation (confirmed)
- Latest scheduled dry-run (`24775047168`) had:
  - `PREFLIGHT_MARKET_CLOSED`, `attempted=0`, `submitted=0`
- Result: current "ready/blocked now" status must be surfaced more explicitly in ops layer.
