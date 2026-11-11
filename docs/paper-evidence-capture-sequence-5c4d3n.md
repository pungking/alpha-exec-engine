# STEP 5C-4D-3N — untrusted GitHub evidence capture-sequence reconciliation

**Base:** PR #75 merged on `main` at `f238e9df7879b58c0af2e0ae9a7a03b64f1157e6`, push sidecar-ci #43025701443 SUCCESS.

**Scope:** SOURCE ONLY, OFFLINE, READ-ONLY. Existing PAPER and LIVE order/state mutation HOLD is unchanged.

## Distinct problem and fix

3M now binds a single caller-supplied capture receipt, selected REST fields and request context through SHA256. It cannot detect whether two separately valid bundles are duplicates, from different code commits, or represent reversed capture times without comparing them.

3N adds `scripts/lib/paper-evidence-capture-sequence.mjs` to compare at most two independently 3M-validated, caller-supplied bundles for the *same* workflow Run/Job/Deployment context. It detects:
- Identical capture timestamp or a backwards timestamp despite individually valid 3M bundles.
- Exact bundle hash replay.
- Cross-capture repository, branch, Environment, commit SHA, Run/Job/Deployment ID, run attempt or workflow path swaps.
- Changes to source-expected stable REST record properties (run creation/start, completed Job start/end, deployment creation, reviewer identity/approval time and the selected deployment status timestamp).
- Malformed, self-asserted VERIFIED or mismatched previous/current bundle inputs.

A first capture with no prior untrusted reference returns `HOLD_NO_EXTERNAL_REPLAY_HISTORY`. Two structurally consistent ordered captures return `HOLD_UNTRUSTED_CAPTURE_SEQUENCE`. Contradictions return `DENY_CAPTURE_SEQUENCE_INVALID`.

## Explicit limitations and authority firewall

This is **not production anti-replay**. Both snapshots, their timestamps, and SHA digests are caller-controlled. An attacker able to replace previous/current inputs can construct a consistent newer-looking pair and still receive HOLD; no external trusted sequence, independent clock, write-once history, signature verification or broker credential boundary is installed. `syntacticSequenceCompared=true` is NOT proof that the underlying GitHub evidence exists or that the capture really occurred in that order.

The current contract does not include an independently verified brokerage account fingerprint or any credential/writer reachability inventory. It cannot establish protected Environment approval for the exact Job attempt or a broker-wide Writer fence. It makes no GitHub REST calls and does not persist a replay database. **All outputs** set `githubOriginAuthenticated=false`, `trustedMonotonicSequenceVerified=false`, `externalReplayProtectionEnforced=false`, `jobDeploymentApprovalVerified=false`, `brokerWriterExclusivityVerified=false`, `operationalEligible=false`, `brokerSubmitAuthorized=false`, `stateMutationAuthorized=false`, and `liveTradingAuthorized=false`.

## Test and adoption gate

`scripts/test-paper-evidence-capture-sequence.mjs` uses synthetic 3M bundles. It covers a first-capture HOLD, good ordered pair HOLD, identical/replayed receipt, backwards time, switched SHA context, changed reviewer and immutable source data, forged proof fields, malicious two-sided recomputation HOLD, and absence of secret reflection. Existing 3M/3L/3K tests remain in the same offline CI suite. Admission baseline source/test digests are updated without touching Workflow YAML, GitHub Environment/rulesets, Secrets, broker APIs, paper-state, ledger/cache or orders.

Frozen 17 Workflow / 21 Job / 10 open blocker Admission Inventory, `operationalHold=true` and review deadline `2026-12-11T00:00:00Z` remain unchanged.

Next steps should prioritize independent GitHub evidence-origin and Job/Deployment approval proof, full broker writer inventory and a genuinely enforced shared fencing authority, not interpreting these offline synthetic checks as permission to dispatch PAPER jobs.
