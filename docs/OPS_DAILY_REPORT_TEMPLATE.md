# Sidecar Ops Daily Report Template

Use this template for daily paper/live-ops status reporting.

## 1) Run Window

- Date (UTC/KST):
- Window:
- Operator:
- Scope: `sidecar-dry-run`, `sidecar-preflight-canary-recheck`, watchdog

## 2) Executive Summary

- Overall status: `GREEN | YELLOW | RED`
- Key outcome (one line):
- Immediate blocker (if any):

## 3) Core KPIs (Required)

- `canary_success_rate` = ___ / ___
- `preflight_pass_rate` = ___ / ___
- `submit_success_rate` (`submitted/attempted`) = ___ / ___
- `dedupe_false_positive_count` = ___
- `client_order_id_duplicate_recovered_count` = ___
- `preflight_blocked_count` = ___
- `watchdog_fallback_count` = ___

## 4) Failure Breakdown (Top 3)

1. reason:
   - count:
   - evidence (run URL/log marker):
   - action:
2. reason:
   - count:
   - evidence:
   - action:
3. reason:
   - count:
   - evidence:
   - action:

## 5) Policy Execution Check (Trading Matrix Conformance)

Reference: `docs/TRADING_POLICY_MATRIX.md`

- `ENTRY_NEW` path: `OK | ISSUE`
- `SCALE_UP` path: `OK | ISSUE`
- `SCALE_DOWN/EXIT_PARTIAL/EXIT_FULL` path: `OK | ISSUE`
- Chase guard trigger quality (`scale_up_chase_guard`, `scale_up_intraday_chase_guard`): `OK | ISSUE`
- Unexpected action transitions: `none | details`

## 6) Risk & Safety Gate Check

- `EXEC_ENABLED`:
- `READ_ONLY`:
- `LIVE_ORDER_SUBMIT_ENABLED`:
- `ALLOW_ENTRY_OUTSIDE_RTH`:
- Perf gate:
- HF live promotion:
- Approval queue behavior:

## 7) Next Actions (24h)

1.
2.
3.

## 8) Evidence Links

- Canary runs:
- Sidecar dry-run runs:
- Notion dashboard rows:
- Artifacts:

---

## Quick Collection Commands

```bash
# US_Alpha_Seeker canary latest 10
gh run list --workflow sidecar-preflight-canary-recheck.yml --limit 10

# alpha-exec-engine dry-run latest 20
gh run list --repo pungking/alpha-exec-engine --workflow dry-run.yml --limit 20

# Pull key verification line from one canary run
gh run view <CANARY_RUN_ID> --log | rg "PREFLIGHT_CANARY_VERIFY|submitted=|attempted="
```
