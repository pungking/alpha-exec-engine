# PAPER interval risk measurement: design review

Date: 2026-10-27
Parent: `PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1`
Status: `OFFLINE_REPRESENTATION_IMPLEMENTATION_APPROVED`

## 1. Authority and decision

The operator selected review of an interval-based measurement revision after
the negative source qualification in the 2026-10-26 collection amendment.
The subsequent direct operator response on 2026-10-27 approved the V2 interval
representation in offline code and fixtures. Acquisition, credential reads,
orders, state adoption, activation, a new collector and risk waivers remain
unapproved. Earlier approvals are preserved; this does not complete the parent.
The exact five limited-control identities remain unchanged.

Recommended interpretation of that selected approach: change the representation
of external cash movement, not the economic formula, numeric limits, sampling
grid or current-risk endpoint. A documented interval sum can replace exact event
times when it resolves every required evaluation boundary. Unknown allocation
or latest-gap coverage remains blocking.

Alternatives considered:

1. Exact interval sums on the existing grid: recommended, smallest change and
   mathematically equivalent where fully supported; no invented event times.
2. Coarsen the loss/drawdown grid to daily data or use old risk with fresh
   exposure: not selected. This can miss an intermediate peak or current loss.
   Keeping the same limit number does not preserve the same risk control.
3. Allocate date-only flows to midnight, assume zero flow or use an operator
   assurance instead of originals: rejected. This fabricates evidence.

Only the representation implementation is approved; source qualification and
complete operational integration are separate unfinished requirements.

## 2. What the source actually establishes

Public references rechecked on 2026-10-27, without account requests:

- [Portfolio history](https://docs.alpaca.markets/us/reference/getaccountportfoliohistory-1)
  defines history range/resolution and the requested cash-flow types.
- [Official SDK model](https://alpaca.markets/sdks/python/api_reference/trading/models.html#portfoliohistory)
  describes interval-start labels, end-of-window equity and cash-flow lists by
  activity type. Shape alone does not prove those lists' exact boundary alignment.
- [Account activities](https://docs.alpaca.markets/us/docs/account-activities)
  supplies signed amounts and activity types; a non-trade date may be an
  occurrence or settlement date. It is not necessarily an effective instant.

No `completeThrough`, financial snapshot ID, per-flow timestamp, or cash-flow
index alignment is invented as a vendor field. The interval records below are
proposed internal derived records. A supported source adapter must establish
their meaning from actual originals and documented semantics, not just accept
these field names or a `complete=true` label.

An authenticated capture establishes what the provider reported at that read;
it is not a guarantee against all future corrections. But reporting a complete
query and establishing which equity interval a flow affected remain different.
The prior created-time/effective-time coverage issue is not waived here.

## 3. Representation and exact admission

Propose separate `attended-risk-measurement-v2` and
`attended-risk-records-v2` discriminants. Existing V1 must retain its exact-event
meaning and rejection rules; no implicit migration or history rewrite.

Keep the policy's historical equity evaluation endpoints and daily-loss start.
The current authenticated account observation is an explicit additional replay
endpoint, not a fabricated entry in the raw history or a future timestamp pinned
before the read. The source adapter derives the replay view and proves required
flow coverage before appending it. Current exposures continue to use the fresh
full-portfolio account/position receipts; the five targets are not the portfolio.

For each required interval `(t[i-1], t[i]]`, the internal replay input contains:

- original equity endpoint reference and reported equity value;
- `startAt`, `endAt`, `netExternalFlowUsd` and source-record references for the
  complete external flow over that interval;
- account, currency, source/receipt/custody and mapping-version bindings.

These are aggregate intervals, not broker events: do not manufacture event IDs,
`firstSeenAt` or an occurrence time. A record reference identifies the actual
source bytes plus record/index and is not an economic-event identity.

The intervals must exactly partition the requested coverage, including the
daily-loss boundary and current observation endpoint. Reject gaps, overlaps,
duplicates, unknown timezone/boundaries, partial current buckets, unexplained
currency/sign differences and source/account drift. Explicitly covered zero
intervals are distinct from missing intervals or an SDK-default empty map.

Finer source intervals may be summed once to an existing policy interval. A
coarser interval cannot be split or prorated across a required boundary, even
when its net amount is zero: offsetting deposits/withdrawals can hide movement.
Do not drop policy sample points, silently forward-fill equity or merge periods
to make incompatible data fit. A date is usable only if its effective interval
and required boundary allocation are actually supported; the calendar alone
does not convert a settlement date to an effective-cash interval.

Classify external capital separately from trading returns. Supported deposits
and withdrawals retain their signs. Fees, interest and dividends remain in
returns; do not remove them as external contributions. Ambiguous journals,
security transfers without a verified valuation and unsupported activity types
block rather than disappearing. History cash-flow aggregates and activity
records can corroborate each other, but the same money is counted only once.

## 4. Formulas and unchanged risk meaning

Let `E[i]` be reported equity at the unchanged evaluation endpoints; `F[i]` is
complete signed external capital over `(t[i-1], t[i]]`. Let `j` identify the
daily-loss baseline and `n` the current account observation. In USD:

```text
dailyLossPct = 100 * max(0, E[j] + sum(F[j+1..n]) - E[n]) / E[j]
adjustedEquity[i] = E[i] - sum(F[1..i])
sampledPeak = max(adjustedEquity[0..n])
drawdownPct = 100 * (sampledPeak - adjustedEquity[n]) / sampledPeak
```

All required denominators and adjusted equity values must be positive. Use the
existing exact-decimal/rational helpers and the existing boundary comparison;
no float epsilon, rounding allowance or limit defaults. These are the current
cash-adjusted daily-loss and current sampled drawdown formulas, not a new
time-weighted-return metric or continuous-time maximum drawdown claim.

For the same grid, equity and complete flows, summing exact events within each
interval yields precisely the same formula inputs. That equivalence is the
acceptance test. It does not establish source authenticity or a live cash-flow
history. Position/sector/portfolio exposure, volatility, dollar volume, earnings
distance, their limits, windows and source requirements stay unchanged.

## 5. Freshness and the latest gap

Keep three times distinct: last verified historical endpoint `T_h`, current
account observation `T_a`, and decision time `T_d`. Do not substitute retrieval
time for an endpoint. Existing current observation freshness remains
`0 <= T_d - T_a <= configuredMaxAge <= 30 seconds`.

If `T_h < T_a`, current risk additionally needs complete external-flow coverage
over `(T_h, T_a]`, bound to the same account/equity basis. A latest bucket ending
after `T_a`, a short interval, equal account reads or no returned activity does
not establish that coverage. Unknown gap => `CURRENT_RISK_GAP_UNPROVEN` and
limited readiness stays blocked. Do not assign zero or truncate a bucket.

If `T_h == T_a`, source-time and equity-value consistency must still be proven;
matching local timestamps alone cannot make separate reads atomic. If `T_h > T_a`
or any needed input became available after the decision, reject it. The allowed
observation-to-decision latency does not imply that the history-to-observation
gap was measured. No new waiting timer, polling loop or freshness tolerance.

Consequently this design removes the artificial need for within-interval event
instants, but does NOT yet qualify Alpaca's current flow coverage. That limitation
is an explicit outcome, not a claim that implementing a collector will unlock
execution. A lagged-risk alternative would be another substantive policy choice;
it is not included in this recommendation or the current approval.

## 6. Minimal future change reach

| Location | Change only after written-design and implementation approval |
| --- | --- |
| `scripts/lib/scoped-paper-risk-evidence.mjs` | V2 interval validation and net-flow input to the same formulas; preserve V1, old grids, other six dimensions and no-authority pure result. |
| `scripts/lib/scoped-paper-evidence.mjs` | Bind actual originals/interval mapping/current receipts before sealing; never seal a caller-supplied complete flag. |
| `scripts/lib/scoped-paper-operational.mjs` | Explicit measurement-version agreement in existing pins; no blanket source/approval migration. |
| Existing attended fixtures/test and operational-files tests | Formula parity, rejection boundaries and version isolation; synthetic tests remain synthetic. |
| Existing transitive code inventories and offline CI | Pin changed modules and run full regression before any eventual merge. |

An exact shared original may support equity and flows without duplicate raw
copies, but this requires explicit role references and compatibility tests in
the already proposed producer/binding work. Do not relax all duplicate-path
checks. No new runtime flag, provider, planner, ledger or dependency.

The old five-GET capture, order routes, paired-store schema and V3 limited-purpose
labels are unchanged by this design. The proposed GET<=10 history capture remains
separate and unapproved. If source mapping/custody remains unsupported, do not
implement an always-blocked adapter and call the complete lifecycle delivered.

### Offline replay input shape

The pure replay uses the existing top-level policy/account/source-hash bindings.
V2 definition and V2 records must appear together; V1 remains exact-event only.
Within `attended-risk-records-v2`, `cashFlows` has exactly:

```text
coverageStart, coverageEnd, currency=USD,
flowBasis=EXTERNAL_CAPITAL_ONLY, rows

rows[]: startAt, endAt, netExternalFlowUsd, sourceRecordReferences
sourceRecordReferences[]: sourceSha256, jsonPointer
```

These are internal derived fields, not claimed Alpaca response fields. A JSON
pointer identifies a record inside a pinned source; it never invents an economic
event ID. References must use an existing `sourceHashes` member and a valid
non-root JSON pointer. Reusing the same source record or an ancestor/descendant
pair rejects. Multiple corroborating references describe one interval amount,
not extra contributions to sum. Each interval needs at least one reference.

Both interval count and total reference count are bounded by the existing
5000-record replay bound. Input order must be a contiguous left-open/right-closed
partition of the approved window. Finer intervals may sum into the same policy
endpoints, but a source interval cannot straddle a required endpoint. Zero is an
explicit signed-decimal amount, not absence of a row.

Replay can validate shape, arithmetic, version agreement, reference uniqueness
and byte-reference membership. It cannot prove vendor mapping, activity-type
classification, custody, a truthful zero-flow claim or complete current coverage.
Its result remains `sourceVerified=false` and `executionAuthorized=false`.
No runtime sealer, source adapter, CLI execution route or acquisition permission
is added by this representation-only implementation.

## 7. Validation and finite outcome

Offline acceptance matrix (authentic source qualification remains separate):

1. Exact-event/V2 interval formula parity on identical grids and decimal values.
2. Deposit, withdrawal, fees/dividends and duplicate-source double counting.
3. Aligned finer intervals versus a coarse bucket crossing a required boundary.
4. Hidden intermediate peak: reject automatic coarsening rather than lowering
   measured drawdown. Preserve daily start and the full approved lookback.
5. Missing/overlapping intervals, partial bucket, explicit zero versus absent map.
6. Source label/end distinction, session boundaries, early close and DST; no
   undocumented calendar or cash-flow indexing assumption.
7. A fresh account observation with an uncovered ten-second tail still blocks;
   complete supported tail passes that check; future endpoint/late input rejects.
8. V1/V2 isolation, forged source/custody rejection, deterministic hashes and no
   identifier/raw/secret exposure. No synthetic source success as runtime proof.

Initial design outcome was `INTERVAL_REPRESENTATION_DESIGN_PREPARED` with
`CURRENT_RISK_SOURCE_ADMISSION_NOT_ESTABLISHED`. After the direct implementation
approval, the pure V2 replay and fixtures passed the local 16-command regression
and two safety checks. The attended suite reports 688 parent and 863
authority-child assertions, with sourceAuthenticationProven=false and
lifecycleIntegrationComplete=false. The timing cases are synthetic boundary
tests, not market-calendar or provider-coverage certification. The new fixture
failed on unsupported V2 before implementation. Whole-branch review and actual
GitHub CI have not been completed for this change.

Representation implementation approval has been received. Source
alignment/coverage and an authentic original producer must qualify before a
complete implementation plan can promise integration. If they cannot, report the
same specific limitation once and stop; do not launch another diagnostic capture
or disguise a lagged/waived risk check as this design. Parent completion, independent
whole-branch review, CI/merge and any PAPER execution remain separate and unproven.
