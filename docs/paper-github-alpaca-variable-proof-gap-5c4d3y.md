# STEP 5C-4D-3Y — GitHub ALPACA_BASE_URL variable proof-gap diagnostic

**Base:** PR #86 Merge commit on `main` `111b95195fc6b911f10e23ec1e288360a0849518`. Exact new `main` push `sidecar-ci` #43057736636 completed SUCCESS.

**Scope: READ-ONLY CANDIDATE / OFFLINE CI / ALL PAPER AND LIVE MUTATIONS HOLD.** This step does not read a real GitHub Variable, GitHub Secrets or an Alpaca account. It never dispatches workflows or performs order/cancel, PAPER state, live trading, Ruleset or Environment mutations.

## Findings and external read access

The STEP 3X source audit covers nine broker-credential referencing workflow Jobs. Of the nine, **six** declare the exact PAPER API base URL; **three** are dependent on the GitHub Actions `vars.ALPACA_BASE_URL` variable. The three are `dry-run.yml#dry-run`, `market-guard.yml#market-guard`, and `ledger-filled-migration.yml#ledger-filled-migration` (the last has an overridable PAPER default). None of those three Jobs has a bound GitHub Environment. Their code-source configuration is a static observation, not evidence of runtime outbound destination.

The connected GitHub repository metadata confirms that `pungking/alpha-exec-engine` has owner type **User**, not an organization. Official GitHub Actions Variables REST documentation specifies a GET-only repository endpoint:

- `GET https://api.github.com/repos/pungking/alpha-exec-engine/actions/variables/ALPACA_BASE_URL`
- Official documentation: https://docs.github.com/en/rest/actions/variables#get-a-repository-variable

The connected GitHub generic fetch tool returned `INVALID_ARGUMENT / GitHub Fetch URL is not an allowed public GitHub repository or search endpoint` for this variable and the repository variable listing. The connected GitHub tools do not offer a dedicated Actions Variable GET operation. **Actual variable value, existence, update time, and runtime effective value remain UNVERIFIED.** Do not infer absence from a 404, private permissions or connector-level denial.

## 3Y implementation

`scripts/lib/paper-github-alpaca-variable-proof-gap.mjs` includes a pure inspector and an optional GET-only caller-injected reader. The inspector composes the 3X YAML/Admission source auditor, frozen 3X parent/main SHA, nine exact Workflow definitions, source broker credential references and operational HOLD. It validates two untrusted repository-variable API-shaped snapshots and rejects:

- Any foreign repository, changed reviewed SHA, source YAML or baseline, missing/extra input keys or forged operations-ready claims
- Missing, malformed or out-of-order variable timestamps, invalid variable name, unsafe/suspicious values, extra fields, and mismatched first/second snapshots
- Any value other than **exactly** `https://paper-api.alpaca.markets`, including the LIVE hostname, lookalike subdomains, different ports, HTTP scheme, trailing paths or URL parameters

Even when the two synthetic/current candidate reads match the exact PAPER value, the result is **`HOLD_UNATTESTED_REPO_PAPER_VARIABLE_CANDIDATE`**; malformed/contradictory or unsafe values yield **`DENY_UNVERIFIED_OR_UNSAFE_BROKER_VARIABLE`**. The returned result never prints the API response's raw `value`, credentials or any provider error text. Every broker-write, external Writer, GitHub-origin, runtime host, approval and LIVE authority boolean stays false.

The optional adapter requires a caller-injected GitHub bearer, fetch implementation and AbortSignal. It makes exactly two GETs to a fixed URL, with redirect and retry disabled, HTTP 200/JSON checks, streamed 8 KiB per-response ceiling, Content-Length exactness and a source HOlD preflight **before the first GET**. Failures result in generic DENY. It performs no request by default, has no ambient secrets, and is never executed against live GitHub from CI. A supplied fake transport may forge a response or ignore AbortSignal; no independent proof or guaranteed wall-clock timeout follows. Two matching GETs are not an atomic GitHub configuration snapshot.

## Critical source and runtime distinctions

| Evidence category | Current result | Remaining proof obligation |
|---|---|---|
| Actual nine Workflow definitions | 6 fixed PAPER, 3 GitHub variable-dependent | Complete nested script and runtime egress audit |
| GitHub repository `ALPACA_BASE_URL` variable | **NOT FETCHED** | Separately authorized, authenticated read-only GET plus provenance and capture timestamp |
| Environment variable precedence | Three source Jobs have no Environment binding | Confirm actual workflow precedence and run-specific configuration without assuming a protected admission Job's scope transfers to a Writer Job |
| GitHub Secret metadata/keys | Only nine source-name references checked | Secret presence, organization inheritance, per-Job access and broker-side grant coverage without exposing values |
| PAPER-vs-LIVE key/account isolation | **NOT VERIFIED** | Independent owner-side permission/credential mapping; no LIVE API calls |
| Shared account Writer custody | **NOT VERIFIED** | Exhaustive credential/actor/manual/legacy/external Writer inventory and enforced mutation-edge fencing |
| Independent approval and anti-replay | **NOT VERIFIED** | Separate human source PR APPROVE policy and operation-specific Run/Job/Deployment approval with replay barrier |

GitHub repository variable values are configuration metadata, not a broker credential capability attestation. Even an authentic current PAPER value cannot prove the value at a prior job attempt or that nested scripts/other processes connect exclusively to PAPER. A URL alone cannot prove a key lacks order-write privileges.

## CI and scope controls

The new `scripts/test-paper-github-alpaca-variable-proof-gap.mjs` uses the **nine real checked-in YAML files**, mock GitHub GET-only responses and negative tests for LIVE/near-LIVE hostnames, changing timestamps, malformed values, HTTP 401/403/404/429, response length limits, bad content type, empty source scope, credentials and authority forgeries. It is imported into the pre-existing network-denied PAPER Custody suite and included in the SHA-256 Admission evidence pins.

Keep **17 Workflows / 21 Jobs / 10 OPEN blockers**, `operationalHold=true`, `settingsEvidence=USER_REPORTED_NOT_FETCHED` and `reviewBy=2026-12-11T00:00:00Z` unchanged. No operational GitHub YAML, variable, Ruleset, Environment, Secrets, account, PAPER state or trading flag has been changed.

Legacy Gemini → Obsidian Knowledge Intake cleanup remains separate in `pungking/US_Alpha_Seeker` Issue #57, not executed in this PR.

**Next decision point:** If a trusted repository administrator separately authorizes collection, use an approved credential with GitHub Variables(read) to inspect only the ALPACA_BASE_URL value and record a redacted proof. This must not grant PAPER/LIVE account execution. A future **source-only** PR review and merge is also separate from human operational authorization.
