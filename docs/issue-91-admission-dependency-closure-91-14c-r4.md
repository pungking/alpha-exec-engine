# Issue #91 — STEP #91-14C-R4: execution dependency closure / candidate admission preflight

**Status: SOURCE-ONLY CANDIDATE / RE-ATTESTATION NOT APPROVED / OPERATIONS HOLD.**

## Frozen provenance

- Review base: `main` `73984070264f6e47cc8ab212b4ea4db0e09d7c20`.
- Candidate parent: Draft PR #97 HEAD `5d29e2d9740550efa6df56fcfa08e091a5d893d1`. This R4 branch is intentionally *stacked on PR #97*, not on main; it must not be merged separately into main or misrepresented as a standalone source change.
- At review, PR #97 exact-HEAD sidecar-ci #43600002956 failed the protected `PAPER workflow admission inventory` step with `REVIEWED_ENTRYPOINT_DRIFT`. The later `Sidecar public evidence boundary` step was SKIPPED. The CI denial is expected; a full regression PASS has not occurred.
- Issue #91 historical sidecar bootstrap failure root cause is UNKNOWN. A classifier category does not determine root cause.

## Execution and trust boundary

`scripts/run-private-sidecar-step.sh` (existing SHA-256 pin `0c76ebca08652738334bf1de2832ef7e5e8fe63f4a17bf4d73b18244f9fe5f2d`)
  - invokes `scripts/paper-runtime-private-binding.mjs` at begin/finish (already pinned);
  - executes the original producer supplied by workflow argument, which must separately remain covered by the reviewed workflow and operational evidence inventory;
  - in the proposed failure-only branch invokes NEW `scripts/probe-private-sidecar-diagnostic.mjs` (NOT pinned in the old baseline);
  - the probe loads `scripts/classify-private-sidecar-failure.mjs` (NOT pinned in the old baseline).
  
The minimum newly uncovered *repository-controlled* source closure is **probe + classifier**; this is **not a claim** that four enumerated files cover every dynamic shell, Node or installed dependency. The workflow-supplied producer, binding's imports/calls, package-lock / node_modules integrity, GNU tools (`timeout`, `env`, `head`, `wc`), Node executable, runner image, file descriptor inheritance and signal/process group semantics require distinct source/supply-chain/runner provenance checks. No toolchain binary is assigned a fabricated repository SHA.

Threats to evaluate: malicious replacement of helper/classifier after baseline approval; PATH interception; unexpected local imports or exec edges; symlink or TOCTOU substitution of private `output.log`; output/stdout/stderr/Step Summary leakage; multiline/control/private strings; classifier stderr and nonzero status; unreadable/oversize files; background grandchildren and escaped process groups; TERM/INT/HUP; changed original producer status, missing begin/finish evidence; unauthorized event/phase; and a misleading green CI from regenerated hashes.

## Offline candidate

Run on the **exact R4 branch checkout** (no providers, credentials, actual market data, network or broker):

```bash
node scripts/test-private-sidecar-admission-closure-r4.mjs
```

This read-only preflight:
- validates old-baseline inventory counts, HOLD and OPEN blockers;
- proves old wrapper hash must drift and old binding hash must remain pinned;
- asserts the explicit wrapper→probe→classifier and wrapper→binding source references;
- simulates a prospective protected four-source manifest *in memory*, and verifies a mutation to each file invalidates its digest;
- checks all 139 unchanged existing baseline-pinned files against authoritative old SHA-256 values; never writes baseline/checker, changes no workflow, and never emits actual private log content.

**Limitations**: this preflight is a static source-shape/mutation test, not arbitrary dynamic import/exec analysis, no-orphan host attestation, an independent source code review, a successful exact-HEAD CI run, a human APPROVE, or admission permission. Since the trusted baseline remains old, the existing CI gate MUST still fail at `REVIEWED_ENTRYPOINT_DRIFT`; later steps may be skipped.

## Required R4 evidence before re-attestation request

1. Confirm exact main, PR #97 parent and six-file diff, new R4 diff, active Rulesets, and branch ancestry. Any stale head invalidates this packet.
2. Collect actual local/offline `node ...closure-r4.mjs` stdout and exit against the **exact** R4 commit; preserve sanitized evidence. The presence of source code alone is not PASS.
3. Independently inspect transitive repository import/exec closure, dynamic producer entrypoint, package-lock and runner/tool dependencies; enumerate any additional operational hash pins, and separate environment provenance from source pins.
4. Complete N01–N12 changed-wrapper tests, including N03 races/permissions and N10/N11 mutation gates. Prove no runaway subprocess/same-group descendant on Linux. Record escaped process group/session and external kill boundaries as unverified unless directly tested.
5. Obtain independent human security and operations review of proposed trust closure and authorization scope. The current main Ruleset requires build and merge commit but has **zero** required approving reviews; it does not substitute a human security decision.
6. After a **separate explicit user approval**, submit a *new* reviewed baseline/checker re-attestation Draft PR including authoritative new source hashes and added closure, preserving 17 workflows, 21 jobs, 10 OPEN blockers, `operationalHold=true` and expiry policy. Old baseline must reject the changed wrapper; only independently trusted new baseline may pass. Do not automatically regenerate hash or extend `reviewBy`.
7. Separate PR-specific source merge approval remains mandatory, followed by new-main CI; source merge does not release PAPER/LIVE/dispatch/account/order/state HOLD.

## Rollback and custody

R4 rollback: close its Draft PR and delete/revert only R4 test/document in its branch; PR #97 and old main remain unchanged. In a separately authorized future admission change, rollback must restore the previously trusted wrapper and source-bound helper path **and** matching previously reviewed baseline/checker under an independently reviewed, atomic source change. Never restore only a hash, silently drop a dependency pin, weaken CI, or treat source rollback as undoing any previously executed account/state mutation.

Protected baseline, checker, package command, workflow YAML, Rulesets, `paper-state`, credentials and executions: **NOT MODIFIED** by R4.
