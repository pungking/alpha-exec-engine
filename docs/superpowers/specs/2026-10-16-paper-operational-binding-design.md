# Scoped PAPER operational binding on one Mac

Goal: PAPER_SCOPED_CLOSEOUT_OPERATIONAL_BINDING_CLOSURE_V1
Code baseline: e313185b9744f122bf36c9b5b5abcede90c42252
Status: OPERATOR_DESIGN_APPROVED_SOURCE_CONTRACT_UNRESOLVED.
Design-writing approval: 2026-10-16, existing Mac as the single execution host.
Written-spec approval: 2026-10-16; official source-contract research only.
Implementation, broker access, state adoption, orders and activation are NOT authorized.

## 1. Outcome and boundary

Connect the existing five-target management adapter to real, verifiable inputs,
durable PAPER custody and bounded order oversight. Do not build another engine.
The end state is an invocable, default-inert route whose authority, evidence and
effects are independently verifiable, not another successful account/quote probe.

This is exceptional reduction of five existing limited-control positions, not
ordinary strategy ownership, automatic Stage6 entry, scale-in or LIVE trading.
Keep original ownership/history/PnL unverified. The separate unverified-origin
management reference and all unscoped positions remain outside target authority.
Do not revive the withdrawn historical-input goal or claim missing originals were
recovered. Normal Stage6 entry/protection/holding/exit automation is separate.

This document and public official-document research are authorized now. No runtime
code, dependency, daemon, credential access, broker/market-data capture, state
adoption, broker action or settings change is included. The operator has approved
the written architecture, not a resolved source contract. Subsequent implementation
requires source-contract closure, a written plan and execution-method approval.
Runtime requires a separate exact scoped execution approval under AGENTS.md.

## 2. Verified starting point

The completed read-only captures remain consumed, immutable observations:

- IEX capture: account, clock and quotes once each; five quote rows verified at
  that observation. Basic IEX is single-venue, not consolidated NBBO.
- Five-target capture: account, positions, open orders, closed orders and clock
  once each. Five exact active targets within eleven positions; zero open orders
  at that observation. This is not a current state-authenticity or execution proof.
- The approved offline terms retain full reduction of all five targets, the
  existing private per-order/aggregate caps, 10 bps spread, 10 bps adverse price
  and 30-second evidence age. Do not recalculate caps from later prices.
- Exact REST IEX size semantics were separately reviewed. Do not reopen that
  completed proof or copy WebSocket round-lot examples into the REST mapper.

Current reusable boundaries:

| Code | Reuse / actual gap |
| --- | --- |
| scoped-paper-transport.mjs | PAPER-only allowlisted bounded transport; sealed complete receipts |
| scoped-paper-evidence.mjs | Exact mapping; source proof is validated but not produced |
| scoped-closeout-contract.mjs | Limits, authority, phase transitions, sticky stop |
| scoped-closeout-storage.mjs and order-state-storage.ts | Durable reservation/CAS/local fence; not cross-host exclusion |
| scoped-paper-adapter.mjs | Existing composition, pre-submit checks and bounded postcheck |
| run-scoped-paper-closeout.mjs | Default-inert entry point; no autonomous production caller |
| paper-order-notifications.mjs | Existing event mapping and delivery deduplication |

The old operational-readiness report's SIP-only blocker is historical; current
main supports explicitly acknowledged PAPER IEX. Do not roll that work back.

## 3. Architecture choice

Use one supervised process on the existing Mac and one explicit owner-only PAPER
directory. Reuse current stores and controller. No new ledger, broker abstraction,
planner or dependency. Agent_Javis/DGX migration and recurring entry are deferred.

Rejected alternatives:

1. Actions caches as transactional custody: immutable snapshots and separate
   workflow groups are not an account-wide transaction lock.
2. A second host or engine: creates duplicate writers without fixing evidence.
3. Enabling the current CLI with handwritten PASS hashes: fabricates readiness.

Data flow, after the separate authorizations exist:

    approved stable scope + custody/writer attestations
      -> bounded current-evidence producer
      -> sealed source/risk/time validation
      -> existing scoped controller and durable reservations
      -> existing PAPER adapter
      -> persistent accepted/partial/uncertain oversight and notifications

Stopping the submitter must never be mistaken for canceling a resting order.

## 4. Separate fixed authority from changing observations

Current `authorizeScopedPaperInvocation` hashes the entire configuration, including
`bindings.proof`. `assessSourceBindings` also requires fresh halt/risk observations.
Updating those observations changes the configuration hash. A human approval of
one stale configuration cannot authorize a different refreshed configuration.
Synthetic fixtures do not establish a practical approval-to-observation flow.

Proposed additive invocation contract: `scoped-paper-operational-invocation-v1`.
It separates two explicit objects rather than excluding arbitrary hash fields:

- Stable approved scope: PAPER account pin and both hash bases, exact five immutable
  target identities, retained complete portfolio basis, source/code hashes, terms
  and caps, feed/coverage acknowledgement, source-verification rules, state path
  and pre-write hashes, session/expiry, request ceilings, writer-exclusion and
  oversight policy, rollback and notification destination hash.
- Current observation bundle: sealed receipts, exact response/record hashes,
  observation intervals, provider effective timestamps, current portfolio/order
  parity and source/risk/time verdicts produced under that approved scope.

Authority binds the stable-scope hash. Each observation bundle binds that authority
and its own hash. Every changed stable field invalidates approval. Freshness and
terms are re-evaluated before each submission. Runtime evidence never grants
authority, changes caps or enlarges the five-target set.

Do not manufacture a legacy approval object for a newly built configuration. Add
an explicitly validated authority path and in-process capability; retain the old
v2 path unchanged and separately tested. No old approvals are grandfathered into
this contract. Default CLI remains zero-I/O validation. Runtime execution defaults
remain READ_ONLY=true / EXEC_ENABLED=false / LIVE_ORDER_SUBMIT_ENABLED=false.

## 5. Source production and unresolved source facts

| Evidence | Required producer/basis | Reject |
| --- | --- | --- |
| Account/portfolio/open orders | Existing sealed PAPER reads; exact account and full set; nested children accounted for | Drift, incomplete/limited response, any open-order conflict |
| Asset identity | Existing asset-by-ID reads, bound to preserved target IDs and current position IDs | Symbol-only joins, guessed IDs, inactive/nontradable asset |
| Quantity precision | Current asset fractionable flag plus reviewed official qty contract; exact decimal representability | Universal lot multipliers or inferred increment field |
| IEX quote | Explicit REST feed, exact five symbols derived from assets, proven shares basis, fresh payload timestamp | Delayed/SIP/Toss fallback, receipt-time timestamp substitution |
| Session/time | Broker clock/calendar plus verified host time basis and monotonic continuity | Local wall time alone, fabricated offset, future/stale timestamp |
| Trading status | Current explicit official state or a documented baseline plus demonstrably continuous status coverage | Silence, tradable=true, market-open or a quote as proof of not halted |
| Management risk | Actual configured limits and current inputs, or individually approved management-only exceptions | Blanket PASS because an action is called risk reducing |

An opaque evidence hash is insufficient: verify the referenced exact bytes,
schema, source, account/asset, time basis and relevant fields before producing a
PASS binding. Do not accept a user-supplied PASS label as an observed receipt.
Private source documents/normalized evidence remain owner-only; public reports
contain counts/status/hashes, never private identities or responses.

### Trading-status contract is still unresolved

Alpaca documents `statuses` messages (`sc`, `rc`, `t`, tape) on subscribed feeds,
but the reviewed page does not establish an initial current-state snapshot,
periodic refresh, replay completeness or this account's channel entitlement.
IEX quote access does not prove those properties. A one-shot connection with no
status event must remain unavailable, not NOT_HALTED.

Before enabling a producer, establish an official current-state/initialization
contract and map only documented tradable/resumed statuses. Quotation resumption
is not trading resumption. A disconnect, gap or unknown code invalidates coverage.
Keep effective-event time distinct from the observation/coverage time: do not
refresh an old event timestamp by assigning the local clock. The existing
30-second rule remains; changing its basis requires explicit reviewed compatibility
and fixtures, not a tolerance increase.

This is a source-contract gate, not a request for another account/positions probe.
If no sufficient official source can be established, automatic closeout remains
blocked. A separate manual broker-managed closeout is an operator alternative,
not silently executed or approved by this design.

### Risk and clock are not derived from labels

Inventory applicable daily-loss/drawdown, exposure, liquidity, volatility and
event controls using existing policy helpers. Map each to verified evidence,
blocking missing evidence, or a specifically approved reduction-only exception.
Preserved spread/notional terms alone cannot satisfy every risk dimension.
No exception is approved in this document.

Host time verification must have provenance, age and uncertainty bounds appropriate
to the existing no-future/30-second checks. A running time daemon, one HTTP Date
header or a broker `is_open` response alone does not certify host synchronization.
Clock compensation, automatic system-clock changes and invented offsets are out.

## 6. Durable custody and account-wide writer exclusion

The future exact directory is supplied in existing `config.directory`, outside
Git, caches and temporary evidence roots. Do not create or adopt it now. Use
existing order-ledger/idempotency formats, owner-only access, no symlinks, backups,
hash parity and crash-safe writes. Keep original preserved evidence immutable.

Before adoption, explicitly identify which bytes are historical reference and
which records are authorized limited management state. Current broker GETs do not
authenticate old sidecar state. Missing original IDs/timestamps remain missing;
no normal strategy ownership/PnL promotion and no synthetic legacy entries.
Directory selection and state adoption require their own bounded authorization.

The Mac becomes the only authorized writer during the scoped operating period.
Inventory GitHub jobs, other hosts/processes and manual trading for this account.
Freeze their write capability through a separately approved control procedure,
then verify it. A local file lock, empty open orders or different workflow
concurrency groups do not prove exclusivity. Cooperative local callers reuse the
existing fence; external/manual noninterference needs an explicit operator
attestation and enforceable operating procedure. No attestation is synthesized.

Writer-exclusion validity must cover resting-order supervision, not only the
submission deadline. If it cannot be established or is revoked, no new submissions.
Do not restore an old cache/backup after a possible broker action.

## 7. Oversight and failure semantics

Reuse the existing order observation/storage/notification helpers for only the
attempt's exact order/client/asset identities. Do not route uncertain orders back
through submission. Admission of this oversight route requires a separately
bounded PAPER read/stream scope; current development performs zero broker calls.

| Observation | Required behavior |
| --- | --- |
| Accepted / resting | Retain reservation; continue approved observation; do not call it filled/flat |
| Partial fill | Record exact broker-confirmed quantity; no replacement, residual resubmit or inferred terminal state |
| Unknown submit outcome | Stop later targets, retain uncertain attempt; exact lookup only under approved observation budget |
| Filled | Persist exact fill, then reconcile current position and open orders; no strategy PnL promotion |
| Canceled/rejected/expired | Persist broker terminal status and reconcile residual exposure; no automatic retry |
| Detectable stream/network/storage failure | Stop new submissions, preserve last state, attempt a safe critical alert; outstanding orders may remain |
| Silent host/power loss | Local alerts and observation cannot be guaranteed; independent supervision or operator attendance is required |

Order status effective time (`updated_at`/`filled_at`) and fresh query interval are
different. The existing mapper requires those event times to be within 30 seconds
and cannot simply be reused for long-resting orders. An oversight-specific mapping
must preserve original timestamps, verify current response provenance and reject
future/contradictory lineage without treating an unchanged old status as a new
event. Do not weaken the existing submit-time checks globally.

No DELETE/PATCH/reprice/protective-child action is implied. Emergency stop blocks
new submissions; it cannot promise existing orders are canceled. A cancel/replace
or manual cleanup requires its own authority. The observer does not exit merely
because the submission window expired: continue only within the separately
approved observation window, or stop with unresolved-order alert and operator
handoff. Its read budget and operator response window must be explicit before
activation; no unlimited polling/reconnect or silently extended deadline.

The Mac must remain awake and connected while locally supervising nonterminal
orders. GitHub analysis can run without it, but Mac-held collection/supervision
cannot. Broker orders may survive a laptop outage. Automatic launchd activation,
power-setting changes and DGX failover are not authorized here.

Prohibit unattended outstanding orders until a separately approved missing-
heartbeat observer outside this Mac exists. That observer must be read/alert-only,
not another execution writer, and have a bounded operating window, missed-heartbeat
threshold, delivery evidence and explicit operator response/handoff procedure.
Until then, a named operator must be attending the broker interface during the
entire nonterminal interval. A lost Mac cannot reliably send its own outage alert;
failure to receive an alert is not evidence of health. No monitor is activated by
this design, and no cancellation authority is implied by operator attendance.

Require all five targets to pass initial readiness before the first submission.
Broker execution itself is not atomic: partial execution can occur. Never label
the five targets closed until each has its own verified terminal/position evidence.

## 8. Budgets and authorization sequence

Current controller ceilings remain 61 GET / 5 POST, not permission to consume them.
Do not hide new source/status/oversight requests inside those counters or reuse
unspent prior one-shot budgets. Any additional source connection and oversight
requests need an explicit group, maximum count/bytes/duration and failure rule in
the reviewed implementation plan and later runtime approval. No retry/pagination.

Finite sequence:

1. Review this written architecture and resolve the trading-status source contract.
2. Review one implementation plan covering stable authority/current evidence,
   source production, custody/writer preflight, oversight and caller tests together.
3. Implement on a clean branch with offline fixtures, independent review and CI.
   Unresolved prerequisites must yield a named block, never fake READY.
4. Approve exact custody/adoption and account-wide writer procedure separately;
   then an exact session-bound PAPER invocation, including observation/handoff.
5. Verify actual execution/terminal evidence once. Only that proves a closeout;
   tests, code merge, accepted orders and read-only captures do not.

Do not schedule another diagnostic capture merely to refresh the old five-row
report. Current evidence belongs inside the approved operational attempt, after
its producer and consumer are implemented. LIVE/Toss funding remains outside this
scope; no claim about profitability or readiness to deposit real funds follows.

## 9. Review and acceptance criteria

Required offline cases before implementation can be called static-ready:

- Safe defaults, invalid/missing/current-scope approval: zero credentials/network/state.
- Stable approval hash unchanged by allowed observation refresh; any target/account/
  terms/code/path/feed/risk-policy change rejected. Old approval cannot authorize v1.
- Five exact assets/full portfolio; ambiguity, changed position, incomplete orders,
  stale/future/forged source proof, unknown halt, missing time/risk evidence rejected.
- Unchanged old status vs fresh observation distinguished; no timestamp fabrication.
- Source disconnect/coverage gap stops submissions. No inference from silence.
- Local duplicate/concurrent attempt and external-writer uncertainty fail closed.
- Backup/parity/crash recovery, uncertain submit and restart never duplicate orders.
- Accepted/partial/terminal cases preserve exact identity, quantity and original
  times; residual positions and unscoped holdings are never silently removed.
- Expired submission authority cannot create an order; observer authority cannot
  submit/cancel; exhausted observation scope produces explicit unresolved handoff.
- Silent host loss cannot be reported as locally alerted or healthy; unattended
  operation without independently approved outage detection is rejected.
- Existing SIP/IEX, generic entry, protection, idempotency and notification tests
  remain compatible; notification redelivery is deduplicated and safely redacted.

Design complete means this specification and its unresolved decisions are reviewed.
Static contract complete means implemented/tested/reviewed/CI-passed composition.
Operationally ready additionally requires authentic current inputs, custody,
exclusion, oversight and exact authority. The full goal is not complete merely
because this document exists.

## 10. Official references and review limits

Reviewed 2026-10-16; documentation is not an account runtime proof:

- [Asset by immutable ID](https://docs.alpaca.markets/us/reference/get-v2-assets-symbol_or_asset_id)
- [Fractional qty/order contract](https://docs.alpaca.markets/us/docs/fractional-trading)
- [Trading-status channel and codes](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)

No source entitlement, host clock, current writer exclusivity, custody adoption or
order state is certified by this document. These cannot be verified from the
available information. Do not print private inputs to obtain review approval.

## 11. Official source review outcome

Review date: 2026-10-16. Result: SOURCE_INITIAL_STATE_AND_CONTINUITY_UNVERIFIED.
This is a bounded documentation review, not proof that the provider lacks these
capabilities. No authenticated request, stream connection or live RSS fetch ran.

| Source | Established contract | Limitation for this design |
| --- | --- | --- |
| [Stock stream](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data) | Status events include tape-specific halt/resume codes and event time; access depends on subscription | No reviewed initial-state snapshot, all-symbol baseline completion or gap-recovery guarantee; IEX quote access does not establish account status-channel entitlement |
| [Stream protocol](https://docs.alpaca.markets/us/docs/streaming-market-data) | Subscription acknowledgements describe subscribed channels; slow clients can disconnect without a preceding error | An acknowledgement is not a current-status snapshot; the reviewed protocol does not document replay cursor, sequence-gap recovery or status freshness watermark |
| [Price snapshot](https://docs.alpaca.markets/us/reference/stocksnapshotsingle) | Latest trade/quote and minute/daily/previous bars | No documented current halt-state snapshot in this response description |
| [Historical status reply](https://forum.alpaca.markets/t/is-it-possible-to-query-for-historical-trade-quote-statuses/15067) | Alpaca's September 2024 reply said historical halt/resume queries were unavailable | Historical statement, not a current capability guarantee; cannot assume a historical backfill path |
| [Halted-order reply](https://forum.alpaca.markets/t/order-status-during-halt/17962) | Alpaca's October 2025 reply describes accepted orders held pending during a halt | Acceptance is not proof of tradability or execution; do not assume broker rejection eliminates the gap. PAPER parity is not established by this reply |
| [Nasdaq RSS documentation](https://classic.nasdaqtrader.com/Trader.aspx?id=TradeHaltRSS) | Includes Nasdaq and other exchange listings; refreshed once per minute with no faster querying | Does not establish the existing 30-second current-state requirement; a fresh HTTP retrieval cannot make the underlying source fresh |
| [Nasdaq query definitions](https://classic.nasdaqtrader.com/snippets/tradehaltaccordion.html) | Default current query is described by halt day; historical/resumption-date queries are separate | Absence in one daily result cannot prove absence of an earlier continuing halt |

Keep bootstrap UNKNOWN. Do not promote subscription success, silence, fresh quotes,
asset eligibility or a missing RSS row to NOT_HALTED. Quotation resumption remains
different from trading resumption. An event's timestamp and a proven current
coverage interval remain separate; connection health alone cannot prove coverage.
Do not buy SIP or add another provider assuming it solves initialization/replay.

### Single next dependency

Obtain an attributable current Alpaca contract for a Basic/PAPER client covering:

1. Initial state for a target already halted before subscription, including
   overnight halts and a machine-readable baseline-completion/as-of marker.
2. Status coverage for CTA and UTP listed targets on IEX versus venue-only status,
   and whether Basic/PAPER has the required entitlement without an upgrade.
3. Disconnect/slow-client recovery: sequence/cursor/replay or a documented fresh
   snapshot alternative, with a bound that can support the approved age limit.
4. Meaning of no status messages, timestamp basis and stale/partial source detection.

Request documentation/schema references rather than credentials or portfolio
details. A local support-question draft is prepared but has not been sent. Do not
repeat account/position/quote captures: they cannot answer this source-contract gap.
If the provider cannot supply the contract, return one explicit source/policy
decision to the operator; do not silently relax the guard or start another audit.

Source review is finished; source eligibility is NOT established. Full operational
binding, an executable implementation plan and the parent goal remain incomplete.
No wait for a natural RTH run is needed to resolve this documentation dependency.
