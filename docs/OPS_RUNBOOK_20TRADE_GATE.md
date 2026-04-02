# Sidecar 20-Trade Gate Runbook

## 1) Normal Accumulation Mode (before 20/20)
- Use `sidecar-dry-run` only for baseline accumulation.
- Keep `payload_probe=false` and `validation_pack=false` in baseline runs.
- Use `sidecar-payload-probe-isolated` for any forced-path probe checks.
- Expectation:
  - `hf_tuning_phase.gateProgress` grows toward `20/20`.
  - `hf_payload_probe_status` can stay `PENDING_NO_PAYLOAD` in baseline runs.

## 2) Probe/Experiment Mode (no baseline contamination)
- Run `sidecar-payload-probe-isolated` when HF path checks are needed.
- Inputs:
  - `payload_probe_mode=tighten|relief`
  - `payload_probe_min_conviction=20|30|40|50`
- Isolation guarantees:
  - `READ_ONLY=true`
  - `EXEC_ENABLED=false`
  - `TELEGRAM_SEND_ENABLED=false`
  - no cache restore/save, no Notion sync

## 3) Gate Completion (20/20 reached)
- Final state is reached when:
  - `hf_tuning_phase.gateProgress=20/20`
  - `hf_tuning_phase.gateStatus` is `GO` or `NO_GO`
- Optional auto-dispatch:
  - enable `VALIDATION_PACK_AUTO_TRIGGER_ENABLED=true`
  - workflow dispatches one `validation_pack=true` run automatically
  - dedupe key is stored in `state/validation-pack-auto-trigger.json`

## 4) Final Comparison Pack
- Run `validation_pack=true` (manual or auto-dispatched).
- Validate OFF/ON/STRICT deltas from:
  - `state/validation-pack/off/last-run.json`
  - `state/validation-pack/on/last-run.json`
  - `state/validation-pack/strict/last-run.json`
- Publish decision note in Step Summary/Notion with:
  - gate result (`GO`/`NO_GO`)
  - remaining blockers (if any)
  - recommended next action

## 5) Operational Watch Points
- `hf_marker_audit` must remain `ok` (or `n/a_dedupe` only on dedupe runs).
- `ops-health-report` warnings to track:
  - `perf_gate_progress_mismatch`
  - `perf_gate_remaining_mismatch`
  - `simulation_snapshot_lag`
  - `hf_alert_triggered`
- Node 20 deprecation annotation on `upload-artifact@v5` is non-blocking today; keep workflow execution status as source of truth.
