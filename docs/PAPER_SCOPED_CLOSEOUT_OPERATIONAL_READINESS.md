# Scoped PAPER closeout operational readiness

Goal: PAPER_SCOPED_CLOSEOUT_OPERATIONAL_READINESS_CLOSURE_V1
Review date: 2026-10-13
Baseline: 5d211bcdecf224e1e9291037644acc80856d7d92
Disposition: STATIC_ASSESSMENT_COMPLETE_RUNTIME_NOT_READY
Primary blocker: SIP_REQUIRED_BUT_BASIC_ONLY

The operator confirmed Basic only. This is not an authentication failure or a
claim that Basic cannot place PAPER orders. The current scoped adapter requires
real-time SIP; Basic's real-time feed is IEX. No subscription, feed fallback,
execution flag, state adoption or broker request is authorized by this document.

## Verified correction and compatibility

Alpaca's dated CTA/UTP change makes current US stock quote sizes shares from
2025-11-03. The default 2026 fixture incorrectly modeled lots times 100, and the
source-binding validator accepted that obsolete interpretation. Current observed
SIP bindings now require `quoteSizeUnit=shares` and `sharesPerUnit=1`; bid size is
mapped directly, without multiplication. Hash parity alone cannot validate units.

The existing observed v2 field layout and synthetic v1 controller remain unchanged.
This tightens validation of current-data source proofs: an old round-lot binding
is rejected, not converted or grandfathered. Do not rewrite historical artifacts.
Any future configuration must pin the reviewed code and independently verified
source evidence again; fixtures are not operational evidence. All existing
spread, adverse-price, quantity, notional and freshness limits remain unchanged.

## Complete prerequisite inventory

| Boundary | Finding | Required closure |
| --- | --- | --- |
| Scoped adapter and local stores | Implemented, offline fixture path tested | No repeat implementation |
| Preserved evidence | Manifest/file and terms preservation hashes match | Preserve; not current state authenticity |
| Current SIP quote-size semantics | Resolved by dated official documentation | Reject legacy lot multipliers |
| Account data entitlement | Basic confirmed; current SIP requirement unmet | Explicit feed/coverage decision; no automatic purchase |
| Current halt evidence | No producer in this scoped route | Proven current status; tradable flag or silence is insufficient |
| Management risk evidence | Validated as input, not produced by the adapter | Applicable limits/current evidence or individually approved exceptions |
| Clock alignment | Proof required before adapter access | Verified time basis; local clock/HTTP receipt alone is not proof |
| Instrument increments and identities | Require exact reviewed bindings | No universal lot rule, symbol-only join or invented original IDs |
| Observed invocation configuration | Prior five-row terms are offline only | Exact asset/portfolio/account/source/code bindings; no stale promotion |
| Durable PAPER directory | Not selected/adopted under current approval | Exact path, original preservation, hash parity, owner-only custody |
| Account-wide writer exclusion | Local fence exists; workflow groups differ | Exclude other hosts/jobs/manual writes; local lock is not account-wide |
| Operational caller | Callable function exists, standalone CLI is inert | Reviewed composition of real dependencies, source proof and authority |
| Resting DAY orders and notification | Bounded observation/delivery only | Oversight plan for accepted/partial/uncertain outcomes; no hidden cancel |
| Execution approval | Absent | Exact scoped approval after prerequisites; never embedded-artifact authority |

`assessSourceBindings` runs before network or store access and again before submit.
It requires fresh halt/risk evidence, not just hashes of old observations. The
61-GET/5-POST ceiling is a model limit, not authorization. It contains no status
stream or extra entitlement/risk collection. Thirty-second evidence age can stop
an attempt well before its 300-second maximum. Do not extend freshness or retry.

## Finite next step

Next proposed goal: PAPER_BASIC_FEED_COMPATIBILITY_CONTRACT_V1.

First design the Basic-compatible PAPER-only source contract, including IEX's
single-exchange coverage and the halt/risk/time proof producer and caller. Do not
merely replace `sip` with `iex`, claim consolidated NBBO coverage, weaken price
limits or implement a new source without reviewing its exact scope and budget.
Current account observations should be collected only after the static producer
and invocation path can consume them, avoiding another immediately stale proof.

After that, separately approve durable state custody/writer exclusion and a
bounded PAPER invocation. Five-position management is not normal strategy entry
activation and cannot verify historical ownership or strategy realized P&L.
Normal Stage6-driven automatic PAPER entry/protection/exit is a separate lifecycle
integration; LIVE and OOS eligibility remain unchanged. The withdrawn historical
input goal stays withdrawn, not completed through new observations.

## Official references

- [CTA/UTP size change](https://docs.alpaca.markets/us/changelog/marketdata-bid-and-ask-size-display-change)
- [Market data plans](https://docs.alpaca.markets/us/docs/about-market-data-api)
- [Latest quotes and explicit feeds](https://docs.alpaca.markets/us/reference/stocklatestquotes-1)
- [Market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)
- [Stock status stream](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)

Public documentation verifies provider semantics, not this account's current
permissions, portfolio, trading status, writer exclusivity or execution readiness.
