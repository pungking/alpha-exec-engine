# Knowledge System Operating Model (Notion + Obsidian + NotebookLM)

## Purpose

Define a practical ownership model so tuning/extension work stays auditable and fast.

## Tool Ownership

- Notion (system of record)
  - Run-level structured facts (status, payloads, gate states, hashes, timestamps)
  - Daily KPI row (consolidated)
  - Incident and decision checklist references

- Obsidian (engineering decision journal)
  - Why we changed thresholds
  - What hypotheses were tested
  - What was rejected and why
  - Link back to Notion rows and GitHub runs

- NotebookLM (analysis/synthesis layer)
  - Digest Notion+Obsidian sources
  - Produce short synthesis for weekly tuning review
  - Never acts as canonical source of truth

## Daily Workflow

1. Runs complete (`sidecar-dry-run`, canary, guard)
2. Notion run rows are synced (existing automation)
3. Create/refresh `OPS_DAILY_REPORT_YYYY-MM-DD.md`
4. Upsert one Notion daily consolidated row from report
5. Append Obsidian daily note with:
   - KPI deltas
   - anomaly summary
   - links (Notion rows + GitHub runs)
6. Refresh NotebookLM ingestion marker for the day

## Data Quality Checklist (Notion)

Run this check daily:

- Required fields present:
  - `Run Key`, `Status`, `Source`, `Stage6 Hash`, `Payload Count`, `Skipped Count`, `Summary`
- No duplicate run key rows in same target DB
- Latest run timestamp freshness within expected window
- Canary validation evidence has at least one passing row in last window
- Market guard rows continue to arrive (no silent gap)

## Weekly Review

- Compare chase-guard block rate vs submit quality
- Review preflight block reasons and dedupe behavior
- Decide threshold changes only with evidence links

## Anti-Drift Rule

Any threshold change must update all three:

1. Runtime config/env reference (README)
2. Tuning plan document
3. Daily report entry with reason + evidence
