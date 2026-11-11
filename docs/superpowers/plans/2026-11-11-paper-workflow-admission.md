# STEP 5C-4D-1: offline workflow admission and writer inventory

Scope: alpha-exec-engine only. Parent PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1 remains incomplete.
Approved starting main: 4ebc37c29b7ee32001a83ed03375d96cdcd7f961; remote main matched before work.
Branch: codex/paper-workflow-admission-inventory, separate worktree; old candidate-export work preserved.

## Resume rule

On resume, inspect branch, HEAD, upstream/remote, porcelain status, existing diff,
tests and PR/CI before doing work. Preserve all existing changes. Never reset,
clean, force-push, rebase or merge main without separate approval. Reuse completed
work; interrupted reviews are not completed reviews. No new subagents needed.

## Design and reach

- Read AGENTS.md and docs/superpowers/specs/2026-11-03-github-paper-custody-design.md.
- Keep all 16 operational workflow files byte-identical. Change ci.yml only by
  adding offline checks. No schedule, concurrency, environment or execution
  policy activation/change. Existing automatic DRY_RUN flags stay DRY_RUN; do
  not replace them with PAPER just to make an inventory label look consistent.
- There was no YAML parser dependency. Add yaml 2.9.1 as one pinned dev dependency
  (no transitive dependency); use YAML 1.2 structural parsing, reject duplicates,
  aliases, custom tags, multiple documents, unknown root fields and malformed jobs.
- Freeze full parsed workflow documents, job observations and the npm command
  map, not selected text fragments. Comments can change; executable structure,
  inline shell/Python/JS, permissions, inputs, actions and steps require review.
- Pin 85 reviewed source/config/lock files: invoked entrypoints, static local
  import dependencies and referenced local shell scripts. These support the
  classification; this is not an interpreter or proof of all dynamic behavior.
- Reuse check-dry-run-dispatch-safety.mjs for existing execution-gate semantics;
  do not duplicate its implementation or change its legacy assertions. The new
  checker owns completeness, baseline drift, roles and no false admission.
- Baseline is an immutable bounded HOLD with its digest anchored in the checker.
  CI has no regenerate/accept flag. It expires 2026-12-11 00:00 UTC; renewal needs
  explicit source review, a new dated evidence baseline and ordinary PR review.
  The 30-day bound prevents silent indefinite exception extension. Expiry fails
  development CI; it does not disable or dispatch any existing scheduled job.
- Source branch is main; paper-state is ciphertext-only data, not code to check
  out or execute. There is no custody-eligible workflow in this stage, even if
  someone adds an Environment name or concurrency string to a candidate file.
- A baseline PASS means unchanged, classified, blocked scope, not broker safety,
  repository protection verification, writer exclusion or custody readiness.
  All legacy operational risks remain explicit and are not auto-repaired here.

## Tasks and verification ledger

- [x] Read-only main/worktree/design inventory; no secret values or API acquisition.
- [x] Write offline negative fixtures first; missing checker produced ERR_MODULE_NOT_FOUND (RED).
- [x] Implement structured parser, closed-world inventory, source pins and bounded HOLD.
- [x] Add package commands and one offline CI step; preserve operational workflow bytes.
- [x] Document all 17 jobs, effects, environment targets, concurrency collisions and next scope.
- [x] Complete fixtures and existing regression/typecheck/build/audit/diff checks.
- [x] Main-agent source review; no new subagents or independent review claim.
- [ ] Ordinary commit/push, Draft PR and actual CI verification (post-commit evidence in PR/task report).
- [ ] Independent user/ChatGPT review (separate, not claimed by this task).

No broker/provider request, cache restore/export, key/secret access, state branch
creation, migration, runtime deployment, workflow dispatch, order or main merge
is authorized. Repository source fetch/push, Draft PR/CI and npm audit are the
only external development operations. Rollback is reverting these source checks,
not deleting state/evidence or cancelling broker orders.

## Limits

Repository administrators/reviewers and CI source are trusted. A contributor who
can replace the checker, its expected digest and required CI together is not
cryptographically prevented by this repository check; protected-main review is
still required. Remote actions with mutable tags, future dependency behavior,
manual trading, other repositories/hosts and actual runner/token settings are
not attested. No claim of a general shell static analyzer or broker fence.

Parser reference: https://eemeli.org/yaml/ (parseDocument, uniqueKeys, strict,
YAML 1.2, visit, maxAliasCount; inspected for this implementation).

## Local verification evidence

- New admission fixtures: 65 checks PASS, including structural mutations,
  source/command drift, missing/duplicate classification and no false admission.
- Review found that an untrusted baseline was consulted before digest validation
  in loadInputs. A synthetic path fixture failed RED with ENOENT; validating the
  baseline first made it GREEN with BASELINE_UNREVIEWED_CHANGE, before any declared
  evidence path is read. No real .env file was read.
- Existing candidate export: 388 cases PASS; exact-cache export: 46 PASS;
  GitHub custody: 56 PASS; private binding: 81 PASS.
- Initial private-binding test failed because dist/src/scoped-management-record.js
  was not built yet. After npm run build, the same test passed without code changes.
  CI already builds before this test. The initial failure is retained, not hidden.
- The 22-command local verification set has a passing result for every command
  after that build-order correction: dispatch safety, scoped closeout/adapter/
  operational/attended contracts, IEX mock probe, public evidence, notifications,
  order-state consistency, symbol/routing safety, typecheck, build, syntax and diff.
- npm audit --audit-level=high: exit 0; all vulnerability counts zero.
- All 16 operational workflow files are byte-identical to the starting main.
  Only ci.yml receives offline checks. No source runtime or production state edit.
- These are synthetic/local results, not PR CI or operational readiness proof.

Maintainer cost: even benign npm command-map or pinned dependency/source changes
need a reviewed baseline update. This deliberately trades convenience for closed
admission during HOLD; do not replace it with automatic baseline regeneration.
