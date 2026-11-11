# STEP 5C-4D-3U — actual active GitHub Rulesets and missing independent human approval

**Base:** PR #82 merged into `main` as `c217e9031ad4c33a7b2def12e8561d4904347842`; exact-SHA `main` push `sidecar-ci` #43045677222 completed **SUCCESS**.

**Scope:** SOURCE-ONLY, OFFLINE CI, read-only actual GitHub configuration observation. PAPER and LIVE broker/state mutations remain **HOLD**. This PR does not modify any live Ruleset, GitHub Environment, Workflow YAML, account key, secret, broker order or ledger.

## Directly observed policy configuration

The connected GitHub API successfully returned `GET /repos/pungking/alpha-exec-engine/rulesets?per_page=100` and the three individual Ruleset detail GETs:

| Ruleset / ID | Actual returned active policy | Critical limitation |
|---|---|---|
| [alpha-main-source-protection / 26952584](https://github.com/pungking/alpha-exec-engine/settings/rules/26952584) | `refs/heads/main`, active, empty bypass actor list; deletion and non-fast-forward blocked; PR merge method `merge`; strict required `build` check (integration ID 15368) | **`required_approving_review_count=0`**; code-owner review, last-push approval and review-thread resolution not required |
| [alpha-paper-state-admission-hold / 26956735](https://github.com/pungking/alpha-exec-engine/settings/rules/26956735) | `refs/heads/paper-state`, active, no bypass actors; `creation` and `update` rules | Current configuration is not signed proof of historical enforcement, absence of all bypass paths or broker account custody |
| [alpha-paper-state-integrity / 26956389](https://github.com/pungking/alpha-exec-engine/settings/rules/26956389) | `refs/heads/paper-state`, active, no bypass actors; `deletion` and `non_fast_forward` rules | Source/state protections do not establish actual broker Writer exclusivity |

These observations are actual GitHub server responses at inspection time, **not** synthetic assumptions. However, the source-only classifier consumes separately supplied API-shaped data and therefore **does not authenticate its origin**. The inspected policy may change after observation. Do not treat these observations as at-run policy proof or as a signed audit record.

The `main` source policy permits a merge with **zero required human `APPROVE` reviews** (not necessarily zero actual comments or reviews). The independently recorded GitHub code-review `COMMENT` and user's explicit conversational request to merge source code are **not** an enforced GitHub human approval gate and neither is an operational authorization.

## New read-only diagnostic and negative tests

`scripts/lib/paper-github-ruleset-human-review-gap.mjs` validates a fixed observed source base SHA and the exact **three** active Ruleset IDs, targets, branch refs, absence of declared bypass actors, source merge and status-check constraints, and PAPER state hold/integrity rule sets. It reports:

- `HOLD_MAIN_HAS_ZERO_REQUIRED_HUMAN_APPROVALS` — expected current-shape source policy, `required_approving_review_count=0`.
- `HOLD_GITHUB_REVIEW_POLICY_UNATTESTED` — a syntactically plausible changed policy has one or more required reviews, but actual human approval, protection enforcement and broker custody are still unproven.
- `DENY_GITHUB_RULESET_SCOPE_INVALID` — missing/extra/disabled rulesets, wrong branch or ID, bypass actors, weakened required build check, invalid status or PR merge rule, forged proof claims, incomplete/unauthorized input.

An **optional**, bounded caller-injected GET-only reader fetches the allowlisted list and three reviewed detail URLs, rejects an explicit pagination `next` link, redirects, non-200/non-JSON, oversized or inconsistent Content-Length, and never prints the token or raw provider error. It makes **no network calls by default**; all CI fetches are synthetic. A malicious injected transport can ignore AbortSignal; no unconditional wall-clock deadline is promised.

This diagnostic is deliberately incapable of returning READY. A higher required human review count would be an improvement to source policy but would still require separately observed true GitHub `APPROVE` evidence, at-run policy attribution, independent protected Environment approval and an actual broker Writer fence before any operational action could even be considered.

## Separate security and operational boundaries

1. Existing 3P–3S Workflow review shows protected `admission` and mutation-capable Writer are **distinct Jobs**. An `admission` Environment reviewer approval does not transfer to downstream `recover`, `submit-canary`, `ledger-filled-migration` or `submit-persistent-repair`.
2. Current branch Rulesets do not prove the historic rules, actual GitHub protected Environment approval, administrator bypass exclusions across all enforcement surfaces, signed source origin or a Job ↔ Deployment ↔ Run-attempt approval link.
3. GitHub repository source/state branch protection is separate from brokerage account credential coverage, legacy external/manual/scheduled Writer inventory and enforced common **broker mutation-edge fencing**.
4. A separate human approval of a particular operation, validated risk/limit/source, independent replay control and final negative tests remain required. None has been performed here; PAPER/LIVE and all account state mutations remain HOLD.

## CI and change safety

The new `scripts/test-paper-github-ruleset-human-review-gap.mjs` tests the observed zero-required-review state; a hypothetical stronger approval policy (still HOLD); wrong rule IDs, branches, source SHA, bypass actors, changed PAPER-state update locks, changed `build` status policy, forged approval flags and mock GET response failures/size/pagination. Its test importer and source/test SHA-256 are added to the reviewed admission baseline.

**Admission:** exactly 17 workflows, 21 jobs, 10 OPEN blockers; `operationalHold=true`; `reviewBy=2026-12-11T00:00:00Z` unchanged. No Workflow YAML, Ruleset or Secrets mutation. This PR remains Draft until independent final code review and fresh explicit user authorization to merge code. Source approval never authorizes actual PAPER/LIVE trading.

The unrelated old Knowledge Intake / Gemini → Obsidian cleanup remains tracked separately in `pungking/US_Alpha_Seeker` Issue #57. Nothing is disabled or removed by this PR.

## Candidate next step

Separate, scoped evaluation of a **required independent human GitHub approval** on `main` should be proposed as a distinct configuration-change PR/approval, not silently applied during trading custody development. Validate compatibility with protected CI and available human reviewers. Even with a source-merge approval policy, broker Writer fencing and PAPER operational authorization remain independent gates.
