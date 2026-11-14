# Issue #91 / R4B: candidate execution closure and offline evidence

Status: **CANDIDATE ONLY, NOT ADMITTED; runtime defects remain; operations HOLD.**
On resume, inspect existing Git state first. Preserve commits, uncommitted changes,
test evidence and the stacked PRs; resume only unfinished work.

## Verified source provenance

Read Issue #91, AGENTS.md, custody design, bootstrap observability contract,
N05/N06 pre-admission evidence, R4 closure document, and PR #97/#98/#99 diffs.
GitHub was checked before implementation; these are snapshots, not floating pins:

| Source | Exact commit | Existing CI |
| --- | --- | --- |
| main | `73984070264f6e47cc8ab212b4ea4db0e09d7c20` | No operational execution requested |
| PR #97 | `5d29e2d9740550efa6df56fcfa08e091a5d893d1` | [43600002956](https://github.com/pungking/alpha-exec-engine/actions/runs/43600002956), FAILURE |
| PR #98 | `3273f250d56f6a2a2f9aaf2597acb1df62391980` | [43603984955](https://github.com/pungking/alpha-exec-engine/actions/runs/43603984955), FAILURE |
| PR #99 / R4A base | `37e2134e0471960d84a3c5abe0251d21fca35cfa` | [43605734048](https://github.com/pungking/alpha-exec-engine/actions/runs/43605734048), FAILURE |

R4B is stacked on R4A, NOT a standalone patch to main. Its only CI hook is three
test imports in the existing pre-Admission test entrypoint. No workflow, package
script, runtime source or trusted control is changed. The complete main-to-R4B
diff includes unmerged #97 runtime changes; review both diff ranges.

## M1/M4: inspectable inventory, not a new trust root

`issue-91-r4b-candidate-inventory.json` contains all **140 original protected
hashes**, observed hashes, **17 workflow definitions / 21 jobs / 10 OPEN
blockers**, original expiry `2026-12-11T00:00:00Z`, producer hashes and edges.
Canonical baseline digest remains
`419fbfae411d8e4e772b5dc7175b665fda3608660418eff5389cf0aae82f434b`.
Only the already-modified wrapper differs from its trusted source hash. There
are zero operationally eligible jobs; no trust digest is regenerated.

The read-only test uses the installed TypeScript AST parser for literal imports,
exports, require/import calls, child_process bindings and URL code references;
existing strict YAML parsing enumerates every wrapper-selected run step (including
conditional/manual ones). Literal shell node/npm entrypoints and npm lifecycle
scripts are expanded without execution. Workflow inline Node here-docs are parsed
separately. The original producer `$1` is a GitHub-generated temporary script:
its source run block is hashed, but actual temporary bytes are NOT attested.

Reviewed roots/edges:
- wrapper -> binding begin/finish -> audit/private-export/limited-recovery helpers
  -> their static imports (inventory records each edge and pin).
- wrapper -> probe -> `process.execPath` + classifier URL -> classifier fs reads.
  Generic probe(command,args) is dynamic; the repository CLI call is traced, not
  a claim about arbitrary callers supplying arbitrary commands.
- wrapper -> 110 workflow run producers across dry-run and market-guard, including
  preview `dist/src/index.js`, guard, performance, orderState, protection, report
  scripts, validation tests, Notion/notification/dispatch-capable producers.
  These are source inspections ONLY, not safe-to-execute declarations.
- test-ownership runNode -> two literal report-producer calls, not arbitrary
  executable discovery. Regex `.exec()` is NOT classified as child_process.exec.
- `npm ci`, `tsc`, shell builtins/utilities, actions and generated dist artifacts
  cross host/build boundaries. Source mapping to TS does not attest emitted JS.

Observed repository closure: 75 files, 71 matching protected pins, one wrapper
drift, three unpinned files (probe, classifier, HF test source). This is a bounded
source analysis, **not proof of universal execution closure**. Shell expansion,
aliased/dynamically constructed code, PATH replacement, loader environment and
runner-generated scripts remain UNVERIFIED. All unresolved edges are explicit.
The JSON is a reproducible candidate snapshot for inspection, not an admission
allowlist; replacing its hashes can never authorize execution.

Separate provenance: package-lock digest and package integrity/version entries,
package.json and tsconfig hashes, workflow action refs and runner labels are
recorded. Node binary, GNU timeout/env/head/wc, bash/mktemp, effective PATH,
ubuntu-latest image, action tag resolution, npm/tsc runtime and installed package
bytes are **UNVERIFIED host/supply-chain boundaries**. No fabricated binary hash.

## M2: tested denials and demonstrated defects

`test-private-sidecar-security-r4b.mjs` emits sanitized, named evidence:
- N03 readable control, absent file, injected EACCES, actual mode-000 denial
  (actual DAC case explicitly unverified when root).
- **DEMONSTRATED_GAP:** real symlink is followed; recognized content returns
  ENVIRONMENT_MISSING, not required UNKNOWN.
- **DEMONSTRATED_GAP:** deterministic stat/read pathname replacement returns the
  replacement's class, not UNKNOWN. This uses fs interposition on synthetic files;
  it proves the unsafe check/use boundary, not frequency of a natural race.
- N09 unchanged live candidate Admission denies REVIEWED_ENTRYPOINT_DRIFT.
- N10 baseline hash, expiry extension, package command, protected source and
  workflow mutations denied with their exact error codes.
- N11 five unsafe defaults on both automatic workflows denied.

To avoid masking N10/N11 behind the known wrapper drift, an IN-MEMORY old-source
control uses exact main wrapper bytes, first checked against the immutable trusted
hash. No on-disk wrapper or baseline is changed. Its clean control must pass and
each mutation must produce its own denial. This is NOT candidate admission.

The evidence collector's exit 0 means assertions about observations passed. It
does NOT mean the two required UNKNOWN properties passed. Runtime fixes require
separate approval: no-follow bounded descriptor read, regular-file/ownership/link
checks and before/after identity checks; reject concurrent change to UNKNOWN.
Do not silently patch the classifier or re-attest it in R4B.

## M3: Linux process boundaries

`test-private-sidecar-process-tree-r4b.mjs` runs the unchanged wrapper and copied
unchanged probe with a synthetic classifier and failing binding stub. It uses no
real ledger, credential, provider, broker or production producer. Every producer
returns 19; all public stdout is exact enum/booleans/exit code, stderr empty.

Cases: same-group child, escaped session/group timeout, probe TERM/INT/HUP,
SIGKILL of the probe parent. Linux `/proc` checks distinguish running descendants
from zombies and verify group/session membership. A separate test supervisor
cleans only recorded synthetic PIDs with matching process start times; synthetic
children have their own finite lifetime. Supervisor cleanup is NOT credited to
the wrapper. A 7-second case deadline bounds harness waiting.

Expected boundaries: ordinary same-group cleanup on caught signals; UNKNOWN and
original producer status retained even when the classifier escapes or the probe
is killed. Detached escape and SIGKILL can leave descendants until the supervisor
cleans them. Therefore **no host-wide no-orphan guarantee**, no proof of kernel
process-reaping, runner teardown, uninterruptible I/O or malicious supervisor.
Killed wrapper/runner preservation of producer exit status is not promised.

macOS cannot prove these Linux properties; report SKIP/UNVERIFIED locally and use
actual Linux PR CI. Existing R4A integration assumes `/usr/bin/timeout` and Linux
process semantics; do not rewrite those production assumptions in this task.
Network-denial preload protects normal Node test processes; minimal synthetic
child environments do not carry it. Synthetic children contain no network calls.
This is not OS network-namespace isolation or arbitrary hostile-code sandboxing.

## M5: validation and review protocol

Commands (capture actual exit codes; no dispatch/rerun):
```
npm ci --ignore-scripts --no-audit --no-fund
node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-private-sidecar-inventory-r4b.mjs
node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-private-sidecar-security-r4b.mjs
node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-private-sidecar-process-tree-r4b.mjs
npm run typecheck
npm run build
npm audit --audit-level=high
npm run ops:safety:paper-workflow-admission
git diff --check
```

The last Admission command must exit 1 on the candidate. Existing admission
regressions that require a green baseline also fail at their initial control on
this candidate; do not skip or relabel them. Baseline mutation regressions can
additionally run in a disposable old-source fixture, clearly distinguished.
PR CI must execute candidate tests before the existing intentional denial;
later CI steps can be SKIPPED. Review exact HEAD/run and job-step outcomes, not
just a green checkmark. Final PR evidence/comment records command exits and CI
URLs without repeatedly modifying source to embed its own final commit hash.

Independent technical COMMENT is neither human APPROVE nor source/operational
authorization. If runtime gaps or test failures remain, explicitly report them.
Issue #91 historical cause remains UNKNOWN and the parent PAPER goal incomplete.
Rollback of R4B: close its Draft PR or revert only its tests/docs; no state repair.
No baseline/checker/ruleset/workflow/package script changes, account/order/cache
activity, provider operations, dispatch/rerun, source merges or activation.
