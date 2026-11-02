# PAPER risk-original collection contract amendment

Date: 2026-10-26
Parent: `PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1`
Status: `DESIGN_ACCEPTED_FOLLOWUP_PLANNING_ONLY`

## 1. Decision and authority

The operator confirmed that preserved original account-equity history and
complete cash-movement evidence do not exist, then selected an offline
collection-contract amendment using the existing Alpaca provider. On 2026-10-26
the operator approved this design and follow-up planning only. This document
finishes that narrow design task. It does not finish the parent or authorize a
collector, credentials, API calls, orders, state adoption, activation or a waiver.

The confirmed defect is `COLLECTION_CONTRACT_GAP`, not an operator file-location
problem. Do not request the same nonexistent originals again. Existing five-GET
captures remain intact and cannot be reclassified as historical-risk proof.
Previously approved Native offline implementation remains approved separately;
this amendment does not expand its network routes or weaken its gates.

Approaches considered:

1. **Selected:** specify finite, private Alpaca history acquisition and exact
   mapping/coverage rules offline. Avoid another provider or runtime probe.
2. Preserve the gap until the operator supplies originals. Safe, but does not
   address the confirmed missing producer and was not selected.

Inventing zero flows, using current equity as history, or exempting loss/drawdown
checks is not an alternative under the approved scope.

## 2. Existing reach and what stays unchanged

| Existing code | Relevant boundary |
| --- | --- |
| `scripts/capture-paper-private-evidence.mjs` | Account, positions, open/closed orders and clock only; no equity-history or cash-flow route. Keep its five-GET contract unchanged. |
| `scripts/lib/scoped-paper-operational.mjs` | Pins six original/provenance roles; file hashes prove byte identity, not authenticity or completeness. |
| `scripts/lib/scoped-paper-risk-evidence.mjs` | Replays exposure, daily loss, sampled drawdown, volatility, dollar volume and event distance; cannot authenticate source records. |
| `scripts/lib/scoped-paper-evidence.mjs` and `scoped-paper-transport.mjs` | Reuse receipt/account binding and bounded transport patterns if future implementation is approved; do not extend the order transport implicitly. |
| `scripts/test-scoped-paper-attended-lifecycle.mjs` and `test-scoped-paper-operational-files.mjs` | Future mapping/rejection fixtures belong here where compatible. Synthetic arithmetic PASS is not real-source proof. |

This amendment changes documentation only. No new dependency, provider, ledger,
runtime flag, scheduler, order loop or public raw-evidence artifact. Other source
roles (bars, earnings, identifiers, market sessions) are not certified by this
review. Their existing provenance requirements remain in force.

## 3. Verified public contracts and their limits

The following are public documentation, not observations of the user's account.
They were inspected on 2026-10-26 without calling a broker endpoint.

| Source | Documented behavior | Consequence for the mapper |
| --- | --- | --- |
| [Portfolio history](https://docs.alpaca.markets/us/reference/getaccountportfoliohistory-1) | Time range/resolution and `cashflow_types` are explicit; intraday history has range restrictions. | Pin parameters from the measurement definition; never silently change resolution or expand the window. |
| [Official SDK model](https://alpaca.markets/sdks/python/api_reference/trading/models.html#portfoliohistory) | `timestamp` labels interval starts; `equity` describes interval ends; cash flow is grouped by activity type. | A timestamp label is not an exact equity observation time. An omitted/default empty cash-flow map proves nothing about complete external flows. |
| [Activities endpoint](https://docs.alpaca.markets/us/reference/getaccountactivities-2) | Creation-time filters, activity categories and cursor/page-size controls are documented. | Creation-time exhaustion does not prove effective-time completeness through a later decision. |
| [Activities guide](https://docs.alpaca.markets/us/docs/account-activities) | Non-trade dates may mean occurrence/settlement; non-trade types include transfers, dividends, fees and journals. | Do not treat every non-trade amount as external capital or turn a date-only field into an intraday timestamp. |

The endpoint reference and guide differ on date-specific page-size behavior.
The proposal therefore uses explicit page size and cursor controls, not an
unbounded date-only query. No inspected source establishes an atomic portfolio/
activities snapshot or a final effective-time watermark through the equity
observation cutoff used for a risk decision.
This is **not documented in the inspected sources**, not a claim that Alpaca can
never provide it.

## 4. Proposed finite acquisition envelope

These are engineering proposals for review, not approved requests. A future
read-only capture is separate from submission and from the old five-GET scope.
Its exact account/config/code/window hashes must be pinned in a new approval.

| Request group | Maximum calls | Purpose |
| --- | ---: | --- |
| PAPER account | 2 | Initial account pin and final comparison; equality is not proof that nothing changed between reads. |
| PAPER clock | 1 | Record remote reference; not proof of historical source freshness. |
| Market calendar | 1 | Explicit session boundaries, timezone and early-close handling for the requested window. |
| Portfolio history | 2 | At most a completed-session window and a separate intraday window, only if the policy needs both. |
| Account non-trade activities | 4 | At most four cursor pages, explicit page size 100; stop at the cap. |
| **Total** | **10 GETs** | Fewer when a route is unnecessary or any check fails. |

Only the existing PAPER host is eligible. Propose reusing current 3-second,
8-MiB-per-response and 300-second-attempt ceilings. These ceilings do not grant
freshness or enlarge the existing <=30-second execution-evidence limit.
No retry, fallback, order/quote reads, provider change, writes or automatic repeat.
Bounded activity pagination is a **new proposed read-only permission**, not a
reinterpretation of any old no-pagination authorization or an order-loop change.

Preflight requires explicit policy window, supported grids, account/terms/code
pins and safe flags before credential access. Unsupported ranges or more than
two necessary history segments fail before network access; do not truncate to
fit. A unique owner-only attempt is exclusively created before the first request.
Any existing attempt/output prevents a second run under the same scope.

Each activity cursor must advance from the returned page; duplicate identities,
repeated cursors, malformed records or inconsistent account evidence stop capture.
A full fourth page is incomplete, not success. A shorter/empty page can establish
that the bounded query returned no further reported rows under its documented
paging semantics; it cannot prove absence of late-posted effective-time events.
Do not widen creation-time filters by an invented late-posting tolerance.

## 5. Original bytes, meaning and custody

- Preserve original response bytes only in a newly authorized owner-only local
  evidence directory (0700 directory, 0600 files), never in git/public CI/stdout.
  Do not retain authorization headers, credentials or cookies. Current approval
  authorizes none of these future captures.
- Record exact request parameters, response-byte hash, reviewed producer-code
  hash, account/terms pins, UTC and monotonic receipt intervals, response status,
  page links and parse outcome. Use existing atomic private-file helpers; never
  overwrite old evidence, caches or production state.
- Keep original bytes separate from normalized replay records. The derived view
  retains source/page/record hashes, interval labels, effective-time precision,
  creation/settlement semantics and mapping version. No fabricated source field.
- Same-process authenticated receipts and checked file custody are distinct from
  a provider-signed statement. Reloaded hashes or a local `complete=true` cannot
  mint source authority. Any eventual offline-import trust basis needs explicit
  reviewed producer/custody validation; an unsigned assertion alone is rejected.
- Reuse the six-role inventory without copying a response twice just to pretend
  two independent sources exist. Any required shared-source reference/schema
  change must be explicit and fixture-tested in the future implementation plan.

## 6. Mapping and admission rules

**Equity:** validate equal-length arrays, numeric domains, unique ordered labels,
requested window/resolution, and exact session coverage. Resolve interval ends
only from a documented convention and the actual session calendar; do not add a
fixed day across an early close. Unresolved endpoints or a live unfinished bucket
remain unusable. Current account equity is a separate receipt observation, never
written into the history response or used to backfill a missing historical point.

**Cash movement:** classify external capital separately from trading returns,
fees, interest, dividends and security transfers. Recognized type does not by
itself resolve an ambiguous journal's economic meaning. Unclassified types,
non-cash transfers without valuation, and date-only movements that cross a
required intraday boundary block the replay; do not invent zero value or midnight.
Aggregated history cash flows cannot be converted to fabricated event IDs/times.

**Completeness:** retain separate findings for transport completeness, query/page
exhaustion, measurement-grid coverage, posting/effective-time semantics and
equity-observation-cutoff coverage. None implies the others. The current replay
passes `currentAccount.observedAt`, not `decisionAt`, to `lossAndDrawdown`; it
requires cash-flow coverage to that equity observation and separately enforces
the configured evidence age (at most 30 seconds) when evaluating the decision.
Preserve this existing latency distinction. Neither timestamp may be fabricated
from retrieval time, and a receipt interval does not establish financial posting
completeness. Do not tighten the approved implementation into an impossible
zero-latency requirement or loosen its existing freshness bound.

**Reconciliation:** compare reported history/cash-flow values only on matching
bases and intervals. Do not apply the provider's P/L adjustment and independently
subtract the same flows again. Rounding, intervals, account mismatch or unexplained
differences block rather than gaining a new numeric tolerance.

Capture outcomes are mutually exclusive by this precedence:
`PREFLIGHT_REJECTED`, `REQUEST_FAILED`, `SOURCE_SCHEMA_INVALID`,
`QUERY_COVERAGE_INCOMPLETE`, `SOURCE_TIME_BASIS_UNRESOLVED`,
`EXTERNAL_FLOW_CLASSIFICATION_UNRESOLVED`,
`DECISION_BOUNDARY_COMPLETENESS_UNPROVEN`, `ORIGINALS_CAPTURED_REVIEW_ONLY`.
Every outcome keeps `executionAuthorized=false`, `brokerSubmitAllowed=false`
and `riskEvidenceVerified=false`. A later verifier may establish only what its
underlying authenticated source actually proves; capture success is not readiness.

## 7. Finite feasibility decision

**Result: `COLLECTION_DESIGN_PREPARED_CURRENT_RISK_SOURCE_NOT_QUALIFIED`.**

The ordinary history/activities schemas support a bounded private review capture.
They do not, on the evidence inspected, establish the exact cash-flow closure at
the equity observation cutoff required by Task1. A collector alone cannot be promised to
unlock the parent. Implementing an always-blocked source adapter or repeatedly
collecting the same account data would not solve it.

Before a production risk-source adapter is implemented, resolve one concrete
contract question: what original evidence proves the equity/capital-flow basis
through the same observation cutoff, with the permitted freshness at decision
time? Sufficient documented source semantics can
answer this; a support reply is not intrinsically mandatory. If no such basis is
available, an explicit measurement-contract redesign is needed, separately
reviewed and approved; this document does not weaken or replace the current basis.
Do not start paid collection or another diagnostic loop merely to find out whether
the missing guarantee happens to be true for an empty response.

Existing independent offline implementation work is not revoked. However, full
source/caller acceptance, whole-branch review, CI/merge and runtime readiness must
not be reported complete while this integration premise remains unresolved.
The parent remains open, with one primary source blocker:
`RISK_ORIGINAL_SOURCE_CONTRACT_INCOMPLETE`. RTH is not the prerequisite for this
design decision. Other unverified source roles are not silently certified.

### 7.1 Source qualification decision, 2026-10-27

Result: `SOURCE_MAPPING_UNSUPPORTED_REQUIRES_CONTRACT_DECISION`.
This completes the bounded qualification assessment with a negative result,
not source admission or the parent goal. The first unsupported semantic mapping
is row 4. Rows 1-3 describe supported subsets, not verified account evidence.

| # | Required mapping and evidence | Qualification and rejection boundary |
| --- | --- | --- |
| 1 | `PortfolioHistory.timestamp`, `equity`, `timeframe` describe interval-start labels and end-of-interval values. Calendar open/close supplies session boundaries. | CONDITIONAL: full fixed intraday intervals can be mapped when their actual grid matches the policy and session. Reject missing, partial or unresolved intervals; this does not establish every daily/early-close mapping or the current account cutoff. |
| 2 | Existing authenticated account receipt plus transport send/receive interval; `validateInputs` checks `currentAccount.observedAt` against `decisionAt`. | SUPPORTED_OBSERVATION_CONVENTION: retain the approved <=30-second age limit. Receipt time is an observation boundary, not a provider financial-posting timestamp or proof of atomic cross-endpoint reads. |
| 3 | NonTradeActivity `activity_type` and signed `net_amount`; CSD/CSW identify cash deposits/withdrawals. | CONDITIONAL: classify supported external-capital types with their documented sign. Fees/dividends are not external capital. Ambiguous journals, unvalued security transfers and unsupported types block rather than being silently omitted. |
| 4 | NonTradeActivity `date` can describe occurrence or settlement; history `cashflow` is a list of amounts per activity type. `lossAndDrawdown` instead consumes event records with exact `at` and `eventSha256`. | UNSUPPORTED for the current event-level mapping: a date or bucket amount does not establish an exact event instant. Do not extract an effective timestamp from an activity ID, invent midnight, or manufacture event records from aggregates. A compatible interval representation would require an explicit contract revision. |
| 5 | Activities filters use creation time and cursors exhaust that query. Replay requires external-flow coverage ending exactly at the current account observation, and history's last equity to equal that current equity. | UNSUPPORTED: the inspected contracts do not establish that these separately returned views cover the same effective-value cutoff. Reject unsupported coverage; neither two equal account reads nor an empty page proves it. This is not a requirement that future corrections be impossible. |
| 6 | Existing loader pins account/terms and twelve original/provenance files, returning `sourceEvidenceVerified=false`. The operator confirmed originals are absent. | IMPLEMENTATION_AND_EVIDENCE_GAP: original history acquisition and reviewed import custody are not implemented. This is our missing producer/binding, not a missing provider signature requirement. A hash proves bytes, not collection or completeness; reject unbound imports. |

Additional official implementation evidence inspected:
[Alpaca-py PortfolioHistory model](https://github.com/alpacahq/alpaca-py/blob/master/alpaca/trading/models.py).
It represents cash flows as `Dict[ActivityType, List[float]]`, with a default empty
map; it does not add per-flow effective timestamps, account snapshot identity or
a complete-through field. Its `base_value_asof` is a trading-date basis, not an
intraday flow timestamp. SDK source shape is not a stronger service guarantee.
Broker API examples and archived documentation were not substituted for the
current Trading API/PAPER contract.

The mismatch is between the proposed source and our chosen replay interface;
it is not evidence of an Alpaca outage. It also does not prove that a correct
interval-based mapper is impossible. No new source field, tolerance or
future-finality requirement is introduced by this finding.

**2026-10-28 disposition after approved V2 implementation:** The six-row table
above preserves the original V1 assessment. V2 now accepts exact interval sums
without inventing individual event times, so the internal representation part
of row4 is resolved in offline code/fixtures. Provider interval alignment still
needs original-source support. Row5's same-current-account-cutoff coverage and
row6's original producer/custody remain unproven. Current source admission is
still NOT_QUALIFIED, with row5 the primary residual. An old completed bucket
cannot silently become current-risk evidence. Repeating the representation
design review, broker capture or support poll would not resolve that premise.

The original next decision was whether to review an explicit interval-based measurement
revision: preserve actual history interval boundaries, retain reported cash-flow
amounts as aggregates, and keep fresh current exposure separate. That revision
must state how the last-history-to-current gap is treated and quantify changed
time granularity; numeric limits alone do not make two measurement bases
equivalent. An unproved gap must still block. It is a design decision, not
permission to drop cash-flow adjustment, use stale risk, exempt the five rows,
implement the collector or submit an order. If the current exact-event basis is
retained, new evidence supporting rows 4-5 is required; repeating the same query
or waiting for market open cannot supply a contractual guarantee.

## 8. Acceptance and validation boundary

Future offline fixtures must cover interval-start/end mismatch and early closes;
missing/duplicate grid points; date-only or late-posted cash movements; ambiguous
journals and non-cash transfers; unsupported types; empty versus exhausted pages;
four-page exhaustion, cursor loops and duplicate records; account/hash drift;
non-finite/malformed values; adjustment double counting; deterministic derived
hashes; source-custody substitution; and identifier/secret/raw-body redaction.
Test a valid documented mapping separately from observation-cutoff completeness
and decision-time freshness. The existing delayed-observation fixture exercises
that separation; its synthetic empty flows do not certify real account history.
Do not claim a positive end-to-end source test using a synthetic completeness bit.

This documentation task is done when the original absence, source limits, exact
proposed budget, mapping/rejection rules and unresolved admission boundary are
recorded and reviewed by the operator. No implementation test, independent code
review, broker proof, commit/CI/merge or parent completion is claimed by writing it.
