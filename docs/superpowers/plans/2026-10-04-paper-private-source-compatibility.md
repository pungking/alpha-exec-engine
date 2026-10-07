# PAPER private source compatibility implementation plan

**Goal:** Accept an explicitly pinned historical-context source for read-only observation review without normalizing history or granting exit eligibility.

**Architecture:** Keep v1 strict. Version v2 isolates historical preview, auxiliary reports and baseline performance from regenerated report inputs. Preserve every source byte; only exact ledger/idempotency feed report producers. Do not run readiness selection on mixed-time v2 reports. Runtime and offline preflight share all source checks. A separately approved future capture still has at most five PAPER GETs.

**Tech stack:** Existing Node ESM collector, auditor, report producers and fixtures. No dependencies, execution-policy changes or state migration.

- [x] Reproduce v1 rejection and add v2 failing synthetic fixture (no private evidence in tests).
- [x] Implement v2 isolation, source preservation, portfolio drift check and shared offline preflight; keep v1 regressions unchanged.
- [x] Prepare a NEW owner-only v2 input from exact preserved bytes; run offline preflight with no secrets/network; never modify old source/attempt.
- [x] Run capture/auditor and safety regression suite, typecheck/build/audit; independent review.
- [ ] Commit/push/PR; merge only after CI succeeds. Pin merged code and source in a proposed, not authorized, future one-shot package.

## Acceptance

Static validation: 38 checks pass, including 104 capture cases and 34 legacy
auditor cases. Independent review findings on exact-five audit scope and source
isolation declarations were reproduced and fixed; re-review found no remaining
findings. Git integration completion is recorded by the PR/CI, not by a runtime
capture or a claim that historical input gaps have been repaired.

- Every historical source hash remains unchanged; v1 unsafe input still fails.
- v2 original preview payloads remain in the archive, never routed to report producers, readiness or broker submission.
- Historical auxiliary rows cannot provide ownership/protection/fill overrides.
- Baseline signed portfolio mismatch stops before additional requests; absence is not reconstructed.
- Exactly five limited identities required; unscoped rows remain unadopted.
- Offline preflight requires no credentials, fetch or output directory; actual capture requires fresh authorization and safe PAPER configuration.
- selectedCandidateCount=0, historicalEvidenceNormalized=false, currentStateAuthenticityVerified=false.
- This task has broker requests=0 and real state writes=0. Old missing-original-input goal stays blocked.
