# Sidecar Development Plan (Living Document)

Last updated: 2026-04-22 (KST, after integration audit)
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

---

## 1) Current State Snapshot

### What is verified

- Canary order-path verification is passing:
  - `preflight_pass=true`
  - `attempted>=1`
  - `submitted>=1`
- Duplicate `client_order_id` failure path is mitigated with retry+unique suffix.
- `SCALE_UP` chase guard controls are implemented and documented.
- Notion ingestion path is alive:
  - Daily Snapshot rows for `sidecar_dry_run` and `sidecar_market_guard` are present.
  - HF Tuning Tracker rows are being updated for latest dry-run runs.
  - Performance Dashboard database/schema is accessible and query-ready.
- Ops automation chain now includes:
  - Notion data-quality audit (`ops:notion:audit`)
  - consolidated ops daily artifact report (`ops:daily:report`)
  - root workflow publication/artifact wiring (`mcp-ops-daily`)

### What is not fully closed

- Daily ops reporting is documented but not fully auto-upserted as one consolidated Notion daily report row.
- Chase-guard tuning is in kickoff phase; baseline accumulation period is still pending.
- Cross-tool loop (Notion <-> Obsidian <-> NotebookLM) exists but needs tighter daily ops integration.
- Canary-specific KPI extraction (`preflight_pass`, `attempted`, `submitted`) is not yet integrated into daily report JSON.
- Automation integration audit snapshot (2026-04-22): `Connected 15 / Partial 3 / Not connected 2` (75.0%).
- Evidence: `docs/AUTOMATION_PIPELINE_INTEGRATION_AUDIT_2026-04-22.md`.

---

## 2) Milestones (Living)

## M1. Execution Reliability (Order Path)
Status: DONE  
Priority: P0

- Goal: keep `preflight/attempted/submitted` path stable.
- Done when:
  - repeated canary success with submit > 0
  - no unresolved duplicate-id hard failures
- Evidence:
  - canary runs + sidecar dry-run logs with pass markers

## M2. Trading Policy Hardening
Status: IN_PROGRESS  
Priority: P0

- Goal: production-grade action policy behavior (`ENTRY/HOLD/SCALE/EXIT`).
- Current:
  - chase guard introduced
  - policy matrix documented
- Remaining:
  - 3-trading-day baseline for chase guard
  - compare conservative/balanced variants
- Evidence source:
  - `docs/TRADING_POLICY_MATRIX.md`
  - `docs/SCALE_UP_CHASE_GUARD_TUNING_PLAN.md`

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

---

## 3) Active Backlog (Next Actions)

### Next 24h

1. Implement daily consolidated Notion upsert from `state/ops-daily-report.json`.
2. Extend ops daily report with canary verification marker parser.
3. Run baseline Step-1 data collection for chase guard (default params).

### Next 72h

1. Push consolidated daily row to Notion (`Daily Snapshot` or dedicated Ops DB). (in progress)
2. Add evidence URL hard requirement in daily Notion row schema and sync script. (done 2026-04-23)
3. Add Obsidian append step for daily report index + links.
4. Add NotebookLM ingestion marker update linked to the daily report row.
5. Add template/runtime drift check for bridge and sidecar workflow mirrors.

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

---

## 5) Update Log

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
