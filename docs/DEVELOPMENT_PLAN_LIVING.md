# Sidecar Development Plan (Living Document)

Last updated: 2026-04-22 (KST)
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

### What is not fully closed

- Daily ops reporting is documented but not fully auto-upserted as one consolidated Notion daily report row.
- Chase-guard tuning is in kickoff phase; baseline accumulation period is still pending.
- Cross-tool loop (Notion <-> Obsidian <-> NotebookLM) exists but needs tighter daily ops integration.

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
- Remaining:
  - auto-generate daily report markdown from run data
  - auto-upsert summary row to Notion
  - ensure evidence links are mandatory fields

## M4. Knowledge Loop Integration (Notion/Obsidian/NotebookLM)
Status: IN_PROGRESS  
Priority: P1

- Goal: research/ops loop supports tuning decisions with minimal manual friction.
- Remaining:
  - daily report ingestion into Obsidian note stream
  - NotebookLM source refresh checkpoint linked to daily ops report
  - concise weekly synthesis output

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

1. Generate `OPS_DAILY_REPORT_YYYY-MM-DD.md` with latest KPI block and evidence links.
2. Run baseline Step-1 data collection for chase guard (default params).
3. Define Notion upsert target format for daily consolidated ops row.

### Next 72h

1. Add automation script/workflow to compile daily metrics from GitHub runs.
2. Push consolidated daily row to Notion (`Daily Snapshot` or dedicated Ops DB).
3. Add Obsidian append step for daily report index + links.

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

