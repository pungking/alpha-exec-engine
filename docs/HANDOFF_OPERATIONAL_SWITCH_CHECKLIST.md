# Ops->Knowledge Handoff Operational Switch Checklist

Updated: 2026-04-22  
Scope: `US_Alpha_Seeker` knowledge pipeline with enforced ops handoff contract

---

## 1) Objective

Promote handoff from advisory mode to strict operational gate:
- **Before**: handoff `HOLD/BLOCK` can be observed but pipeline may continue.
- **After**: handoff `HOLD/BLOCK` fails `knowledge-intake-pipeline`.

---

## 2) Required Variables

Set in repository variables (`US_Alpha_Seeker`):

### Mandatory (strict gate ON)
- `KNOWLEDGE_PIPELINE_HANDOFF_ENABLED=true`
- `KNOWLEDGE_PIPELINE_HANDOFF_REQUIRED=true`
- `KNOWLEDGE_PIPELINE_HANDOFF_REQUIRE_PASS=true`

### Recommended guardrails
- `KNOWLEDGE_PIPELINE_HANDOFF_MAX_AGE_MIN=1440`
- `KNOWLEDGE_PIPELINE_HANDOFF_REQUIRE_EXEC_READY=false`
- `KNOWLEDGE_PIPELINE_HANDOFF_REQUIRE_CANARY_FRESH=false`
- `KNOWLEDGE_PIPELINE_HANDOFF_HISTORY_MAX=200`
- `KNOWLEDGE_PIPELINE_HANDOFF_TREND_WINDOW=7`

### Ops artifact pull (fresh input)
- `OPS_DAILY_ARTIFACT_PULL_ENABLED=true`
- `OPS_DAILY_SOURCE_REPO=pungking/US_Alpha_Seeker`
- `OPS_DAILY_SOURCE_WORKFLOW=mcp-ops-daily.yml`
- `OPS_DAILY_SOURCE_ARTIFACT_NAME=ops-daily-report`
- `OPS_DAILY_SOURCE_MAX_RUNS=20`

---

## 3) Run Sequence (Manual Validation)

1. Trigger `mcp-ops-daily.yml`.
2. Confirm `Build ops daily report` completed.
3. Trigger `knowledge-intake-pipeline.yml`.
4. Confirm early steps:
   - `Pull latest ops daily artifact`
   - `Build ops->knowledge handoff contract`
   - `Validate ops->knowledge handoff contract`

---

## 4) Pass/Fail Matrix

### PASS case
- `state/ops-knowledge-handoff.json`:
  - `handoffStatus=PASS`
- `knowledge-intake-pipeline` continues past handoff validation.

### HOLD/BLOCK case (strict mode)
- `state/ops-knowledge-handoff.json`:
  - `handoffStatus=HOLD` or `BLOCK`
- workflow fails with gate message:
  - `[KNOWLEDGE_PIPELINE][EXIT] handoff gate blocked ...`

---

## 5) Evidence Files

- `state/ops-knowledge-handoff.json`
- `state/ops-knowledge-handoff.md`
- `state/ops-knowledge-handoff-history.jsonl`
- `state/knowledge-intake-pipeline-report.json`

---

## 6) Rollback Procedure

If strict mode causes excessive false blocks:

1. Set `KNOWLEDGE_PIPELINE_HANDOFF_REQUIRED=false`
2. Keep `KNOWLEDGE_PIPELINE_HANDOFF_ENABLED=true`
3. Keep alerting ON (`KNOWLEDGE_PIPELINE_ALERT_NOTIFY_ON=fail`)
4. Re-tune policy inputs (`MAX_AGE`, `REQUIRE_EXEC_READY`, `REQUIRE_CANARY_FRESH`)

This returns to observation mode without removing handoff telemetry.
