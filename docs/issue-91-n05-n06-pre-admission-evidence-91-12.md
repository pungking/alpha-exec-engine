# Issue #91 — STEP #91-12: N05/N06 offline pre-admission and re-attestation evidence

**Status: candidate test specification only; not approved for operational integration.**

Snapshot: `main` `febcac97432b008188c0ee8178ed1c90c290b571` (2026-11-14 KST). PRs [#92](https://github.com/pungking/alpha-exec-engine/pull/92), [#93](https://github.com/pungking/alpha-exec-engine/pull/93), [#94](https://github.com/pungking/alpha-exec-engine/pull/94), and [#95](https://github.com/pungking/alpha-exec-engine/pull/95) were merged separately; the new-main `push` `sidecar-ci` [#43553546316](https://github.com/pungking/alpha-exec-engine/actions/runs/43553546316) completed SUCCESS. This is a dated evidence snapshot, not a timeless branch-status guarantee. Incident #91 remains OPEN; initial bootstrap cause **UNKNOWN**.

## Boundary and existing admission contract

- The actual private wrapper `scripts/run-private-sidecar-step.sh` does **not** invoke the offline classifier. A successful candidate test says nothing about live diagnostic output or an effective production timeout.
- The reviewed baseline `config/paper-workflow-admission-baseline.json` has `operationalHold=true`, 140 pinned evidence source hashes, a 17-workflow / 21-job contract and `reviewBy=2026-12-11T00:00:00Z`. The protected wrapper is pinned by SHA-256 `0c76ebca08652738334bf1de2832ef7e5e8fe63f4a17bf4d73b18244f9fe5f2d`.
- `scripts/check-paper-workflow-admission.mjs` pins canonical baseline SHA-256 `419fbfae411d8e4e772b5dc7175b665fda3608660418eff5389cf0aae82f434b` and rejects `REVIEWED_ENTRYPOINT_DRIFT`, `BASELINE_UNREVIEWED_CHANGE`, `PACKAGE_COMMAND_DRIFT` and `WORKFLOW_DEFINITION_UNREVIEWED`. A failure is a **valid denial**, not a reason to weaken the gate.
- None of the above files, protected workflows, policy flags, environment variables, broker paths, external provider contracts or operational state may be changed in this STEP. No actual analyses, dispatch/rerun, private artifact retrieval, account or order operations are authorized.

## N05 — untrusted classifier output: exact public format

A future guarded wrapper may accept exactly **one ASCII enum token followed by one LF** from an isolated, bounded classifier subprocess:

`ENVIRONMENT_MISSING`, `DRIVE_AUTH_FAILURE`, `STAGE6_READ_FAILURE`, `STAGE6_TRIGGER_REJECTED`, `UNKNOWN`.

Everything else becomes `UNKNOWN`: missing LF, padded token, unknown token, blank input, a second line (even if valid), CRLF, ANSI/control bytes, private strings, stdout larger than the allowed buffer, and non-string data. Never copy the original stdout, stderr, path, identifier, HTTP response, exception, or token into public output, Step Summary, logs or artifact names. A valid matching class is **not** root-cause verification. The candidate public schema is exactly `class=<ENUM> rawOutputPublished=false rootCauseVerified=false` with one terminal LF; the existing wrapper currently emits no such line.

## N06 — missing/failed/stuck classifier: fail closed without producer impact

The **candidate** test harness in `scripts/test-private-sidecar-diagnostic-preflight.mjs` uses one synchronous local child invocation, a 2500 ms timeout, a 1024-byte stdout/stderr buffer bound and zero retries. Missing executable, nonzero exit, signal/timeout, excessive output and malformed output must all return the same sanitized `UNKNOWN` line while keeping the already-observed producer exit code **unchanged**. Synthetic cases include producer exits `0` and `37` (timeout exercised with `37`).

These 2500 ms / 1024-byte values are **preflight test policy candidates**, not operational performance requirements or evidence that the protected wrapper currently enforces them. Final bounds require separate design review for host/platform runtime behavior. The test mock executes only from disposable files with a **minimal fixture-only child environment** (a synthetic unforwarded canary confirms runner environment isolation); no real classifier path, workflow action, provider, broker, token or account is invoked by this preflight.

## Test-only implementation and limitations

STEP #91-12 adds only a new synthetic test module and a one-line import from the existing `scripts/test-sidecar-public-evidence.mjs` CI entry point. It adds no runtime hooks or admission policy changes. This source-only test can show an isolated candidate sanitizer and a bounded child-process fail-closed design; it **cannot** establish that a future wrapper implements these properties. Existing #92–#95 regression assertions must continue to pass unchanged.

Specifically, N05 and N06 are considered **candidate-preflight covered**, but **operational N05/N06 remain UNVERIFIED / HOLD** until an authorized wrapper implementation and full end-to-end offline tests demonstrate them. The historical failed bootstrap run may not be reclassified by this code.

## Evidence packet required **before** a separate operational change request

1. Identify and verify the then-current `main` SHA, `AGENTS.md`, operational wrapper, Admission checker, baseline digest and `reviewBy`; record the owner/reviewer and the explicit authorization scope. Verify actual active GitHub Rulesets, including required checks and allowed merge method.
2. Define the smallest production wrapper change and a threat model covering private log handling, stdout/stderr/Step Summary, injection/multiline output, unreadable/missing logs, child timeout/exit, event/phase gating, producer exit, binding begin/finish and file permissions. Do not introduce credentials, network calls, retries, operational entitlement or fail-open behavior.
3. Run the full N01–N12 negative matrix **against the actual proposed wrapper integration** in a network-denied offline harness. Require complete output allowlist validation, wrong-event and successful-producer invariance, N05 malicious child output, N06 missing/crash/timeout, N07 failed hooks, no secret leak and exact original producer exit. Establish a bounded kill policy that does not hang CI. Retain sanitized test results, coverage and exact commit identity as inspectable evidence.
4. Perform an independent security/operations review of the actual source and *full affected Admission inventory*. Any proposed change to a pinned wrapper must first trigger `REVIEWED_ENTRYPOINT_DRIFT` under the old baseline. No checker suppression, no regenerated trusted hash just to turn CI green, no unreviewed baseline changes, and no automatic `reviewBy` extension.
5. Request explicit **separate authorization for the re-attestation scope** before changing any pinned baseline, canonical digest or reviewed entrypoint. Review new source hashes and every unaffected protection assumption against authoritative originals; do not confuse Git blob SHA with content SHA-256. Use a fresh branch and Draft PR, exact-HEAD CI and an independent review.
6. Request an additional **PR-specific source Merge commit approval** after CI/review; verify the newly generated main push CI. A source merge does **not** authorize running `sidecar-dry-run` or invoking any actual provider, PAPER/LIVE, account/order or state mutation. All operational approvals must be separate and gated.

## Acceptance/rollback for this STEP

A STEP #91-12 PR is acceptable only if its diff changes the test-only import, the test-only candidate script, and this document; the original wrapper, baseline, checker, workflows and package scripts must remain byte-identical. Verify exact-HEAD `sidecar-ci`, including `PAPER workflow admission inventory` and `Sidecar public evidence boundary` SUCCESS, plus a second-pass diff review. Keep the PR Draft and **do not merge without new PR-specific user approval**. Rollback, if eventually needed, is removal/revert of offline tests and this document only. Issue #91 root cause remains UNKNOWN.
