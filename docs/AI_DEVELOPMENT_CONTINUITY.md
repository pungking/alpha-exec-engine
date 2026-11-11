# AI Development Continuity Protocol — US Alpha Seeker

Version: 1.0 (2026-11-12). Applies to work coordinated across **pungking/US_Alpha_Seeker**, **pungking/alpha-exec-engine** and, when in scope, **pungking/US_Alpha_Seeker_Harvester**. This document supplements each repository's own `AGENTS.md`; it does not replace existing safety, ownership, CI or approval rules.

## 1. Repository boundaries

- `US_Alpha_Seeker`: Stage 0–6 analysis, data lineage, ranking/signals and the canonical Stage 6 artifact.
- `alpha-exec-engine`: Sidecar, DRY_RUN, market guard, broker-adjacent operations, custody and state/idempotency safety.
- `US_Alpha_Seeker_Harvester`: OHLCV/auxiliary data harvesting and data-quality duties.
- Do not combine changes across repositories into a single PR. Keep ownership and test contracts explicit. Do not infer that a policy in one repository grants execution authority in another.

## 2. Roles — direct work first, selective Codex delegation

- The user is the owner and makes strategy, material scope and explicit merge/operation approvals.
- ChatGPT leads technical planning, uses connected GitHub tools to independently verify evidence, implements bounded changes directly **when practical and safe**, reviews diffs/tests/CI and prepares a precise handoff.
- Codex is a **selective implementation collaborator**, not an automatic destination for every new module. Delegate when large local worktree edits, multi-file compilation, shell/test-driven development, refactoring or unavailable direct tools make Codex meaningfully preferable.
- Before delegating, identify the concrete blocker/benefit, exact repository and base SHA, files/modules, safety restrictions, tests/done-when criteria, deliverables and recommended available model/effort. Supply a copy-ready instruction. Do not claim Codex was invoked unless an actual invocation succeeded.
- Never claim an independent human GitHub APPROVE when only ChatGPT/Codex reviewed the code. A technical review comment is not approval or evidence that required human checks passed.
- Preserve all project-specific instructions in the target repository's `AGENTS.md`; this protocol is procedural and cannot override stronger safety controls.

## 3. Source change and merge lifecycle

1. Confirm the target repo, exact `main` SHA, latest relevant PRs, GitHub Issues, diff, branch/ruleset and CI before starting.
2. Define task scope and its explicit `Safety Impact`, `Schema Impact`, `Data Impact`, tests and rollback.
3. Work only on a dedicated branch. **Never push directly to `main`**, even if GitHub currently allows it. Keep cross-repo changes as separate PRs.
4. Run available offline/unit/negative tests; confirm GitHub required check on the **exact PR HEAD**, not a stale SHA. Clearly distinguish tests, CI and real runtime evidence.
5. Create a Draft PR unless the user specifically authorized another review flow; perform a fresh critical review of the final diff/HEAD. Fix findings and rerun checks after changes.
6. Only merge after **a new, explicit user instruction approving that particular PR's source merge**, exact-HEAD checks and actual ruleset conditions. Prefer merge commits where policy requires them. A request to continue development, old blanket consent or PR comment does not automatically grant a later merge.
7. Verify the merge result, merge parents, `main` SHA and post-merge `main` push CI. Do not report completion until evidence confirms it.
8. Carry forward only verified status, unresolved blockers and the next bounded STEP. State the difference between completed, proposed, running, blocked and unknown.

## 4. Execution and custody safety are separate from source merge

- Default and current custody controls: `EXEC_ENABLED=false`, `READ_ONLY=true`, `MARKET_GUARD_MODE=observe`; guard mutation flags remain false.
- PAPER and LIVE order execution, broker account/state mutation, migration, credentials, GitHub Secrets/Variables/Environments/Rulesets and execution-policy changes remain HOLD unless separately scoped and authorized under the target `AGENTS.md` and applicable admission gates.
- Source review, source merge, passing CI, a synthetic fixture, GitHub Run/Job metadata or an apparent PAPER URL **never** establish operational readiness.
- Never infer historical environment/variable values, account authority, external Writer exclusivity or broker-side fencing from current GitHub metadata. Use fail-closed `HOLD`/`DENY` classifications for unverified evidence.
- No new actual broker requests, manual/scheduled workflow dispatches, production data/state writes or cleanup as a side effect of a documentation or offline task.

## 5. Every new chat: restore context from evidence

Read, in order:
1. ChatGPT Project Instructions if available, then the relevant repository's current `AGENTS.md`.
2. `docs/AI_DEVELOPMENT_CONTINUITY.md` and `docs/DEVELOPMENT_HANDOFF.md` in that repository.
3. Live GitHub `main` SHA, active/recent PRs, exact-HEAD checks and workflow runs, relevant Issues, reviews and branch rulesets.
4. The actual changed source, tests and job logs relevant to the requested STEP.

**Evidence priority:** current GitHub and explicit present-turn user approval > repository contract/policy > dated handoff snapshot > conversation recap or model memory. When sources disagree, investigate and report; **do not silently substitute the snapshot**. A prior conversation's "READY to develop" is not "implemented", and a GitHub check success is not runtime attestation.

If the GitHub connector is unavailable, disclose this and avoid guessing SHA, PR/CI or completed actions. Do not demand the user restate context when it can be recovered from the repository or previous discussions.

## 6. Update `docs/DEVELOPMENT_HANDOFF.md` at milestones

At least when a STEP ends, a PR is merged, or a major HOLD/blocker decision changes, write or propose a new **dated, separately reviewed** handoff snapshot with:

- Repository and role; the *verified-at* timestamp and source links.
- Latest verified `main` SHA and exact CI Run ID/conclusion, or explicitly UNKNOWN.
- Active STEP, last completed STEP, relevant Issue/PR number and exact HEAD.
- HOLD/approval boundary, changed files, test counts and remaining proof gaps.
- Next safe task and definition of done; Codex handoff status if applicable.
- Explicit note: **a snapshot is not live GitHub state**. Never rewrite history or claim a future CI result.

No commit should be auto-generated by a scheduled workflow as part of this protocol. Update via a separate PR and review, or capture a new verified handoff in an existing authorized task branch.

## 7. ChatGPT Project Instructions — short pointer to copy

> For US_Alpha_Seeker development, follow the target repository's AGENTS.md and docs/AI_DEVELOPMENT_CONTINUITY.md. Work directly with GitHub when practical; delegate to Codex only with a clear reason and full prompt/model/effort/test contract. At the start of every new chat, verify live main SHA, PR, CI, Issues and docs/DEVELOPMENT_HANDOFF.md. Use branch → Draft PR → exact-HEAD CI → review → explicit PR-specific merge approval → new main CI. Keep PAPER/LIVE operational execution HOLD and never treat source merge approval as order/account authorization.
