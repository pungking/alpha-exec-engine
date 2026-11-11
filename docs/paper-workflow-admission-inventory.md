# PAPER workflow admission and writer inventory

STEP 5C-4D-1, reviewed main 4ebc37c29b7ee32001a83ed03375d96cdcd7f961.
Offline only. All 17 workflows / 17 jobs classified; no custody-eligible job.

## Verdict and actual authority

**HOLD is this review's verdict, NOT a newly installed runtime interlock.**
Legacy manual submit jobs can still reach broker paths if their existing gates
pass. CI PASS is not authorization to dispatch them. READ_ONLY does not prevent
a separately gated migration's local state writes, cache saves, notification
receipts, Notion publication or report files.

The user reports three active rulesets (alpha-main-source-protection,
alpha-paper-state-integrity, alpha-paper-state-admission-hold), main-only
PAPER_CUSTODY_APPROVAL with reviewer pungking, self-review allowed, admin bypass
disallowed, and no paper-state branch. These settings were NOT fetched/modified
by this offline task. Source inspection confirms ZERO Environment references.
Creating an Environment alone cannot gate a job which does not reference it.

## Code evidence

- .github/workflows/dry-run.yml:212 fixes automatic DRY_RUN and safe flags;
  :282 hard-disables broker approval. :477 manual presets can write enabled
  flags to GITHUB_ENV; they are not automatic presets. src/index.ts:10085 still
  requires manual event, exact approval, PAPER and exact payload scope. Do not
  equate a displayed preset name or one flag with actual execution permission.
- src/market-guard.ts:971, :1224, :1260, :1604 writes control/state/action/report
  files despite the observe-only workflow.
- scripts/send-paper-order-notifications.mjs:44 writes delivery receipts through
  scripts/paper-order-notifications.mjs; dry-run saves the broad state directory.
- scripts/apply-ledger-filled-migration.mjs:205 backs up and writes the pair.
  scripts/apply-active-position-limited-recovery.mjs applies idempotency-only
  limited recovery. Both are state writers, not broker-order submissions.
- scripts/run-paper-oco-canary-submit.mjs:165 defines POST/DELETE helpers;
  :370 submits, :430 cancels; :475+ gates by dedicated flags, exact phrase and
  source/risk checks. These are not controlled solely by generic EXEC_ENABLED.
- scripts/run-persistent-oco-repair-submit.mjs:239-287 gates a distinct POST
  path and submit-ledger reservation; it deliberately leaves protection open.
- scripts/lib/github-paper-custody.mjs is an implemented transport/claim helper,
  but no current workflow is classified as operationally using that custody.
- Exact hashes for 85 reviewed entrypoint/static-import/config/lock files are in
  config/paper-workflow-admission-baseline.json. Workflow bodies and npm script
  definitions are also pinned; dynamic behavior is not generally proven by ASTs.

## Concurrency and storage conflicts

- dry-run and ledger-filled-migration share `sidecar-dry-run-${{ github.ref }}`
  with cancel=false, but only on the same ref. market-guard uses a different
  group while restoring/saving the SAME sidecar-state branch cache namespace.
- Limited recovery saves sidecar-state-main under another group. Its one-shot
  sentinel is not an account-wide lock or an authoritative durable writer claim.
- The two OCO submit workflows have different ref-dependent groups; they can
  overlap each other, migration jobs and cache writers. Per-workflow concurrency
  is not global PAPER-account exclusion.
- Exports have independent groups. Exact cache metadata/hash checks do not prove
  all writers were quiescent. Exports remain candidates, not state adoption.
- Result sync and CI have no declared concurrency. CI's npm dependency cache is
  not a PAPER state cache; publishing reports is not broker-order authority.
- main contains reviewed code; future paper-state contains encrypted checkpoint
  data only, never workflows or code to check out/execute. No branch created here.

## STEP 5C-4D-2 proposal (not execution authorization)

1. Review four direct manual writers: paper-oco-submit-canary.yml,
   persistent-oco-repair-submit.yml, ledger-filled-migration.yml and
   paper-five-row-active-limited-state-recovery.yml. Preserve historical
   approvals/attempts; decide retirement vs a separately approved replacement.
2. Bind only reviewed mutation jobs to PAPER_CUSTODY_APPROVAL, exact main code,
   shared branch-independent writer concurrency (cancel=false), AND durable
   claim/checkpoint barriers before side effects. Environment plus concurrency
   alone is insufficient. Abandoned claims require explicit reconciliation.
3. Keep dry-run.yml and market-guard.yml scheduled report/observe paths. Separate
   their report/notification caches from authoritative ledger publication before
   any cutover. Do not attach human approval to an entire scheduled analysis job.
4. Keep payload-probe-isolated.yml non-adopting. Exports retain separate bounded
   export approval. Read/verify/result/plan/watchdog/CI jobs are not environment
   targets unless they gain custody-write or protected decryption-key authority.
5. Prove current seed/companions, source qualification, current risk/cash-flow
   completeness, trusted writer exclusion, persistence before wire, observation
   and notification continuity. Then obtain separate provisioning/cutover/runtime
   approval. All P0 source/risk gaps remain unresolved.

No other repository's analysis/Vercel automation was touched. No operational
schedule, concurrency, environment or execution default changed in this task.

## Baseline blockers (not waivers)

- **CODE_ONLY / OPEN:** CI is not an operational custody admission proof.
- **DISPATCH_CODE_PIN / OPEN:** Dispatcher must remain bound to safe dry-run defaults; no trade authority.
- **ENV_UNBOUND / OPEN:** No existing job references PAPER_CUSTODY_APPROVAL; input phrases are not protected-environment approval.
- **WRITER_NOT_UNIFIED / OPEN:** No account-wide common workflow exclusion plus durable checkpoint writer claim is deployed.
- **LEGACY_CACHE / OPEN:** Prefix/best-effort cache publication is not authoritative custody; concurrent state snapshots can diverge.
- **P0_SOURCE / OPEN:** Current seed authenticity, original input/companion closure and trading-status source qualification remain unproven.
- **P0_RISK / OPEN:** Current-cutoff cash-flow completeness and current risk source evidence remain unproven.
- **EXPORT_NOT_ADOPTION / OPEN:** Encrypted export is a candidate, not custody genesis, completeness or execution authority.
- **READ_NOT_CUSTODY / OPEN:** Report/read path is not a custody writer; any future adoption needs separate reviewed admission.
- **LEGACY_EVIDENCE / OPEN:** Latest/prefix artifacts or plaintext report publication need separately reviewed provenance/redaction boundaries before custody cutover.

Review expires 2026-12-11T00:00:00Z; renewal requires a reviewed PR, not automatic extension. Expiry fails this development check, not scheduled runtime.

## Per-workflow inventory

Secret references below are NAMES from source only, never values. INHERITED means
repository token defaults are unverified, not assumed read-only. Full step env
overrides, action inputs and shell bodies are covered by the definition hash.

### ci.yml

Source: .github/workflows/ci.yml. Events: pull_request, push.

- Job: `build`; `CI_FIXTURES`.
- Effects: Synthetic local stores/build/replay only; npm dependency cache is not the PAPER state cache.
- Environment: `null`; proposed target: `NO`.
- Permissions: `"INHERITED_UNVERIFIED"`.
- Workflow concurrency: `null`; job override: `null`.
- Job flags: `{}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: CODE_ONLY.
### dry-run-watchdog.yml

Source: .github/workflows/dry-run-watchdog.yml. Events: schedule, workflow_dispatch.

- Job: `watchdog`; `AUTOMATIC_DISPATCHER`.
- Effects: GitHub actions:write dispatches dry-run default-safe inputs, not a broker writer.
- Environment: `null`; proposed target: `NO`.
- Permissions: `{"actions": "write", "contents": "read"}`.
- Workflow concurrency: `{"group": "sidecar-dry-run-watchdog-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: DISPATCH_CODE_PIN.
### dry-run.yml

Source: .github/workflows/dry-run.yml. Events: repository_dispatch, schedule, workflow_dispatch.

- Job: `dry-run`; `AUTOMATIC_REPORT_CACHE_WRITER`.
- Effects: DRY_RUN broker mutation disabled; nevertheless writes reports, notification receipts, guard state and broad state cache; manual presets are not custody admission.
- Environment: `null`; proposed target: `SPLIT_FUTURE_WRITER`.
- Permissions: `"INHERITED_UNVERIFIED"`.
- Workflow concurrency: `{"group": "sidecar-dry-run-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "DRY_RUN", "EXEC_ENABLED": "false", "READ_ONLY": "true", "MARKET_GUARD_MODE": "observe", "ORDER_LIFECYCLE_ENABLED": "false", "LIVE_ORDER_SUBMIT_ENABLED": "false"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALPHA_VANTAGE_API_KEY, ALPHA_VANTAGE_KEY, CNBC_RAPIDAPI_KEY, FINNHUB_API_KEY, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GITHUB_TOKEN, NOTION_TOKEN, PERPLEXITY_API_KEY, RAPID_API_KEY, TELEGRAM_TOKEN, VITE_PERPLEXITY_API_KEY. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}", "restore-keys": "sidecar-state-${{ github.ref_name }}-\n"}}, {"action": "actions/cache/save@v4", "if": "always()", "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}"}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_CACHE, P0_SOURCE, P0_RISK.
### ledger-filled-migration.yml

Source: .github/workflows/ledger-filled-migration.yml. Events: workflow_dispatch.

- Job: `ledger-filled-migration`; `MANUAL_LEDGER_MIGRATION`.
- Effects: Explicit approval gates state-only ledger/idempotency migration despite READ_ONLY=true; prefix restore and cache save exist.
- Environment: `null`; proposed target: `REQUIRED_BEFORE_CUSTODY_WRITE`.
- Permissions: `"INHERITED_UNVERIFIED"`.
- Workflow concurrency: `{"group": "sidecar-dry-run-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"EXEC_ENABLED": "false", "READ_ONLY": "true", "LIVE_ORDER_SUBMIT_ENABLED": "false", "MARKET_GUARD_MODE": "observe", "ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}", "restore-keys": "sidecar-state-${{ github.ref_name }}-\n"}}, {"action": "actions/cache/save@v4", "if": "success()", "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}"}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_CACHE, P0_SOURCE.
### market-guard.yml

Source: .github/workflows/market-guard.yml. Events: schedule, workflow_dispatch.

- Job: `market-guard`; `AUTOMATIC_REPORT_CACHE_WRITER`.
- Effects: Observe mode still writes guard-control/market-guard/action report state and shared cache; no automatic broker mutation.
- Environment: `null`; proposed target: `SPLIT_FUTURE_WRITER`.
- Permissions: `"INHERITED_UNVERIFIED"`.
- Workflow concurrency: `{"group": "sidecar-market-guard-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "DRY_RUN", "EXEC_ENABLED": "false", "READ_ONLY": "true", "LIVE_ORDER_SUBMIT_ENABLED": "false", "MARKET_GUARD_MODE": "observe"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY, CNBC_RAPIDAPI_KEY, FINNHUB_API_KEY, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, NOTION_TOKEN, RAPID_API_KEY, TELEGRAM_TOKEN. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}", "restore-keys": "sidecar-state-${{ github.ref_name }}-\n"}}, {"action": "actions/cache/save@v4", "if": "always()", "with": {"path": "state", "key": "sidecar-state-${{ github.ref_name }}-${{ github.run_id }}"}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_CACHE.
### paper-exact-cache-private-export.yml

Source: .github/workflows/paper-exact-cache-private-export.yml. Events: workflow_dispatch.

- Job: `export`; `MANUAL_ENCRYPTED_EXPORT`.
- Effects: Historical exact cache restore to disposable workspace, ciphertext export, no authoritative state adoption.
- Environment: `null`; proposed target: `SEPARATE_EXPORT_APPROVAL`.
- Permissions: `{"contents": "read", "actions": "read"}`.
- Workflow concurrency: `{"group": "paper-exact-cache-private-export", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"READ_ONLY": "true", "EXEC_ENABLED": "false", "LIVE_ORDER_SUBMIT_ENABLED": "false"}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-main-35610146111", "fail-on-cache-miss": true}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: EXPORT_NOT_ADOPTION.
### paper-five-row-active-limited-state-recovery.yml

Source: .github/workflows/paper-five-row-active-limited-state-recovery.yml. Events: workflow_dispatch.

- Job: `recover`; `MANUAL_LEDGER_MIGRATION`.
- Effects: Exact cache, approval and sentinel gate idempotency-only recovery; saves backup, sidecar state and sentinel caches.
- Environment: `null`; proposed target: `REQUIRED_BEFORE_CUSTODY_WRITE`.
- Permissions: `{"contents": "read", "actions": "read"}`.
- Workflow concurrency: `{"group": "paper-five-row-active-limited-state-recovery", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"EXEC_ENABLED": "false", "READ_ONLY": "true", "LIVE_ORDER_SUBMIT_ENABLED": "false", "MARKET_GUARD_MODE": "observe"}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": ".one-shot-sentinel/paper-active-limited-recovery", "key": "paper-active-limited-recovery-main-d437349e-v1"}}, {"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-main-32742503181", "fail-on-cache-miss": true}}, {"action": "actions/cache/save@v4", "if": null, "with": {"path": "${{ runner.temp }}/paper-active-limited-backup", "key": "paper-active-limited-backup-main-${{ github.run_id }}"}}, {"action": "actions/cache/save@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-main-${{ github.run_id }}"}}, {"action": "actions/cache/save@v4", "if": null, "with": {"path": ".one-shot-sentinel/paper-active-limited-recovery", "key": "paper-active-limited-recovery-main-d437349e-v1"}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_CACHE, P0_SOURCE.
### paper-five-row-broker-evidence-recovery.yml

Source: .github/workflows/paper-five-row-broker-evidence-recovery.yml. Events: workflow_dispatch.

- Job: `restore-and-read`; `MANUAL_BROKER_READ_REPORT`.
- Effects: Exact cache copied to RUNNER_TEMP; bounded broker GETs; safe aggregate only, no cache save.
- Environment: `null`; proposed target: `NO_UNLESS_WRITER_ADDED`.
- Permissions: `{"contents": "read", "actions": "read"}`.
- Workflow concurrency: `{"group": "paper-five-row-broker-evidence-recovery", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER", "EXEC_ENABLED": "false", "READ_ONLY": "true", "LIVE_ORDER_SUBMIT_ENABLED": "false", "MARKET_GUARD_MODE": "observe"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@v4", "if": null, "with": {"path": "state", "key": "sidecar-state-main-32742503181", "fail-on-cache-miss": true}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY.
### paper-oco-canary-result-sync.yml

Source: .github/workflows/paper-oco-canary-result-sync.yml. Events: workflow_dispatch.

- Job: `result-sync`; `MANUAL_REPORT_PUBLISHER`.
- Effects: Artifact result report and Notion write; not read-only externally, but no broker/state-authority writer.
- Environment: `null`; proposed target: `NO`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `null`; job override: `null`.
- Job flags: `{}` (step overrides/runtime gates still apply).
- Secret reference names: NOTION_TOKEN. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY.
### paper-oco-read-verify.yml

Source: .github/workflows/paper-oco-read-verify.yml. Events: workflow_dispatch.

- Job: `read-verify`; `MANUAL_BROKER_READ_REPORT`.
- Effects: Shared OCO script has mutation capability, but submit flag absent/default false; GET-only assertion; disposable reports and artifact output.
- Environment: `null`; proposed target: `NO_UNLESS_WRITER_ADDED`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "paper-oco-read-verify-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY, LEGACY_EVIDENCE.
### paper-oco-submit-canary.yml

Source: .github/workflows/paper-oco-submit-canary.yml. Events: workflow_dispatch.

- Job: `submit-canary`; `MANUAL_BROKER_SUBMIT_CANCEL`.
- Effects: Explicit phrase plus dedicated submit flag enables PAPER POST, then DELETE rollback and private submit-ledger/report writes.
- Environment: `null`; proposed target: `REQUIRED_BEFORE_CUSTODY_WRITE`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "paper-oco-submit-canary-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY, NOTION_TOKEN. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_EVIDENCE, P0_SOURCE, P0_RISK.
### paper-state-candidate-export.yml

Source: .github/workflows/paper-state-candidate-export.yml. Events: workflow_dispatch.

- Job: `export`; `MANUAL_ENCRYPTED_EXPORT`.
- Effects: Reviewed main/first-attempt exact cache metadata and encrypted candidate; source authenticity remains false.
- Environment: `null`; proposed target: `SEPARATE_EXPORT_APPROVAL`.
- Permissions: `{"contents": "read", "actions": "read"}`.
- Workflow concurrency: `{"group": "paper-state-candidate-export", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER", "READ_ONLY": "true", "EXEC_ENABLED": "false", "LIVE_ORDER_SUBMIT_ENABLED": "false", "MARKET_GUARD_MODE": "observe"}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[{"action": "actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830", "if": null, "with": {"path": "state", "key": "${{ fromJSON(inputs.scope_json).cacheKey }}", "fail-on-cache-miss": true}}]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: EXPORT_NOT_ADOPTION.
### payload-probe-isolated.yml

Source: .github/workflows/payload-probe-isolated.yml. Events: workflow_dispatch.

- Job: `payload-probe-isolated`; `MANUAL_ISOLATED_PROBE`.
- Effects: Index probe with EXEC=false/READ_ONLY=true; variable-driven lifecycle flags, temporary local state/reports and plaintext artifact paths; not custody-ready.
- Environment: `null`; proposed target: `SPLIT_FUTURE_WRITER`.
- Permissions: `"INHERITED_UNVERIFIED"`.
- Workflow concurrency: `{"group": "sidecar-payload-probe-isolated-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"EXEC_ENABLED": false, "READ_ONLY": true, "ORDER_LIFECYCLE_ENABLED": "${{ vars.ORDER_LIFECYCLE_ENABLED }}", "LIVE_ORDER_SUBMIT_ENABLED": "${{ vars.LIVE_ORDER_SUBMIT_ENABLED }}"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPHA_VANTAGE_API_KEY, ALPHA_VANTAGE_KEY, CNBC_RAPIDAPI_KEY, FINNHUB_API_KEY, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, PERPLEXITY_API_KEY, RAPID_API_KEY, TELEGRAM_TOKEN, VITE_PERPLEXITY_API_KEY. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, LEGACY_EVIDENCE, P0_SOURCE.
### persistent-oco-repair-open-verify-multi.yml

Source: .github/workflows/persistent-oco-repair-open-verify-multi.yml. Events: workflow_dispatch.

- Job: `verify-open-protection-multi`; `MANUAL_BROKER_READ_REPORT`.
- Effects: Multiple submit artifacts plus GET-only verification; local reports/artifacts, no remote ledger adoption.
- Environment: `null`; proposed target: `NO_UNLESS_WRITER_ADDED`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "persistent-oco-repair-open-verify-multi-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY, LEGACY_EVIDENCE.
### persistent-oco-repair-open-verify.yml

Source: .github/workflows/persistent-oco-repair-open-verify.yml. Events: workflow_dispatch.

- Job: `verify-open-protection`; `MANUAL_BROKER_READ_REPORT`.
- Effects: Downloads latest-or-explicit artifacts, overlays local reports; broker GET verification and dashboard writes, not custody writes.
- Environment: `null`; proposed target: `NO_UNLESS_WRITER_ADDED`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "persistent-oco-repair-open-verify-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY, LEGACY_EVIDENCE.
### persistent-oco-repair-plan-verify.yml

Source: .github/workflows/persistent-oco-repair-plan-verify.yml. Events: workflow_dispatch.

- Job: `verify`; `MANUAL_REPORT_PUBLISHER`.
- Effects: Downloads source artifact, computes local plan/ops reports and uploads artifacts; no broker orders.
- Environment: `null`; proposed target: `NO`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "persistent-oco-repair-plan-verify-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{}` (step overrides/runtime gates still apply).
- Secret reference names: none. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: READ_NOT_CUSTODY, LEGACY_EVIDENCE.
### persistent-oco-repair-submit.yml

Source: .github/workflows/persistent-oco-repair-submit.yml. Events: workflow_dispatch.

- Job: `submit-persistent-repair`; `MANUAL_BROKER_SUBMIT`.
- Effects: Explicit phrase plus dedicated submit flag enables PAPER POST; leaves orders open, writes persistent submit ledger.
- Environment: `null`; proposed target: `REQUIRED_BEFORE_CUSTODY_WRITE`.
- Permissions: `{"actions": "read", "contents": "read"}`.
- Workflow concurrency: `{"group": "persistent-oco-repair-submit-${{ github.ref }}", "cancel-in-progress": false}`; job override: `null`.
- Job flags: `{"ALPHA_ENV": "PAPER"}` (step overrides/runtime gates still apply).
- Secret reference names: ALPACA_KEY_ID, ALPACA_SECRET_KEY. Dynamic reference detected: False.
- Cache actions: `[]` (setup-node npm cache is separate).
- Operational eligibility: **false**; durable writer claim: **unverified**.
- Blockers: ENV_UNBOUND, WRITER_NOT_UNIFIED, LEGACY_EVIDENCE, P0_SOURCE, P0_RISK.
