# Sidecar Overall Progress Tracker

Scope baseline: **current stabilization and verification program** (JSON parse hardening + HF verify gate + workflow sync).

## 1) Code Hardening
- [x] Add shared safe JSON parser utility (`src/json-utils.ts`)
- [x] Migrate `src/index.ts` JSON parse paths to shared parser
- [x] Migrate `src/market-guard.ts` JSON parse paths to shared parser
- [x] Migrate `src/replay-hf-judgement.ts` JSON parse paths to shared parser

## 2) Guardrails & Regression
- [x] Add parser policy guard script (`scripts/check-json-parse-guard.mjs`)
- [x] Add one-shot HF verification command (`npm run verify:hf`)
- [x] Optimize verify flow to single build (dist-based checks)
- [x] Keep fixture replay strict baseline check in verification path

## 3) CI / Workflow Sync
- [x] Switch sidecar CI to unified `verify:hf` gate
- [x] Add `verify:hf` pre-gate for `validation_pack=true` in `dry-run.yml`
- [x] Add JSON parse guard step for non-validation dry-runs
- [x] Expose `hf_verify_gate` outcome in dry-run Step Summary

## 4) Documentation & Ops
- [x] Sync README quick-start and verification shortcuts
- [x] Sync README workflow notes (`validation_pack` verify pre-gate + parse guard lane)
- [x] Sync HF playbook with JSON parse guard ops note
- [x] Add this overall progress tracker file
- [ ] Attach 1 validation-pack run evidence (log + summary snippet)
- [ ] Attach 1 payload-probe run evidence (log + summary snippet)
- [x] Daily update loop: keep tracker status and evidence links current (`npm run progress:daily` + `docs/OVERALL_PROGRESS_EVIDENCE.md`)
