# STEP 5C-4D-3O — independent operational evidence closure prerequisites

**Base:** PR #76 merged as `6c17393c3ea60c80c5049cb55a53aeb24b68cfa4`. Post-merge `main` sidecar-ci run #43027733189 SUCCESS.

**SOURCE ONLY. OFFLINE. PAPER/LIVE mutation HOLD remains in force.**

## Why this stage differs from 3J–3N
Previous steps verify synthetic Run/Job/Deployment API-shaped evidence, timestamps, selected SHA-256 content commitments and consistency of two caller-supplied captures. None establishes real protected job approval, GitHub API origin, brokerage account ownership or operational fencing. Adding more self-signed hashes would not solve the underlying trust problem.

3O introduces a narrow **machine-verifiable missing-proof inventory**, `scripts/lib/paper-external-proof-closure.mjs`. It refuses to convert a source-check or a caller's `verified:true` declaration into a readiness decision. This is a prerequisite checklist, not a new runtime verifier.

## Independently verifiable artifacts still required

| Proof gate | Evidence required | Current authoritative status |
|---|---|---|
| GitHub collector origin | Approved collector identity, constrained credentials, authenticated API source and timestamp/provenance | NOT ATTESTED |
| Protected Environment enforcement | Enforced reviewer/branch/bypass settings captured for the relevant run/attempt, not only current static settings | NOT ATTESTED |
| Exact Job ↔ Deployment approval | Trusted link of workflow Run ID, Job ID, attempt, Environment, Deployment ID and responsible human reviewer | NOT ATTESTED |
| Account-wide broker credential inventory | Account identity, scopes and inventory of all keys/users/apps with order/state mutation capability, independently verified | NOT ATTESTED |
| External and legacy Writer exclusion | Evidence that direct, scheduled, out-of-band and retired clients cannot mutate the same account | NOT ATTESTED |
| Broker mutation-edge fencing | Real shared fencing/lease checked *at each mutation edge*, with crash, concurrency, takeover and recovery negative tests | NOT ATTESTED |
| Independent append-only replay protection | A separately controlled monotonic counter or append-only event store, signed/verified receipts, and replay rejection | NOT ATTESTED |
| Separate human operational approval | Explicit scope-bound human approval after all risk, account, operational and custody requirements pass | NOT REQUESTED / HOLD |

The list is a set of prospective acceptance prerequisites. It must not be misrepresented as collected evidence. The reviewer must independently validate each surface; the current CI tests are not sufficient.

## Source-only fail-closed contract

`inspectPaperExternalProofClosure` requires:
- `pungking/alpha-exec-engine`, `refs/heads/main`, valid source SHA and SHA-256-shaped **untrusted** account/scope fingerprints, and `PAPER_CUSTODY_APPROVAL`.
- The reviewed admission source inventory remains exactly **17 workflows, 21 jobs, 10 OPEN blockers, operationalHold=true**.
- Exactly eight external proof categories, each declared only as `NOT_ATTESTED`, `INDEPENDENT_EXTERNAL_EVIDENCE_REQUIRED`, `verified=false`, `evidenceDigest=null`.
- An exact `SOURCE_ONLY_NO_OPERATIONAL_AUTHORITY` declaration with every positive authority field false.

Missing, duplicated, unknown, forcibly verified, contradictory, or extra-positive authority fields are **DENY_EXTERNAL_PROOF_DECLARATION_INVALID**. A correct declaration produces **HOLD_INDEPENDENT_OPERATIONAL_PROOF_NOT_ACQUIRED**. Both outputs always set broker submit, PAPER state mutation, LIVE trading, human operational approval, Writer exclusivity and independent replay-control flags false.

This module is deliberately incapable of returning READY. Upgrading proof classes in the future requires a **new independent trust contract and separate user approval**, not a Boolean flip or digest derived from caller-supplied data. An `accountSha256` value having 64 hexadecimal characters is format validation only and does not independently bind to any actual broker account.

## CI, merge conditions and non-goals

The new `scripts/test-paper-external-proof-closure.mjs` runs offline invalid/contradictory-proof tests through the existing GitHub custody CI suite. Reviewed source/test SHA256 pins and the admission checksum are updated, while workflow YAML, rulesets, Environment, secrets, broker APIs, execution credentials, paper-state and cache/ledger remain untouched. The admission review deadline `2026-12-11T00:00:00Z` is unchanged.

Draft PR must pass CI, undergo independent diff/code review and await explicit user source merge approval. Post-merge `main` CI is required before starting the next step. Never dispatch any PAPER or LIVE workflow as part of this process.

## Unrelated legacy knowledge workflows

The separate `pungking/US_Alpha_Seeker` repository still contains scheduled YAML definitions for `Knowledge Intake Pipeline`, `Knowledge Intake Final Check` and `Knowledge Obsidian Nightly Validate`. These are **not** part of the trading custody chain or 3O code. A later cleanup should independently inspect the enabled/disabled state, recent GitHub Actions runs, NotebookLM/Gemini/Obsidian/Telegram integrations, vars/secrets, and downstream dependencies before disabling schedules or retiring files. This PR does not modify those workflows.
