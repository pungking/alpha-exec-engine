# Scoped PAPER Basic feed compatibility

## Scope and authorization

This is an additive compatibility contract for the existing five-target scoped
PAPER closeout adapter. It does not activate that adapter or implement ordinary
Stage6 entry/hold/protection automation. No broker call, subscription change,
repository variable, operational source proof or production state migration is
part of this change. READ_ONLY / EXEC_ENABLED defaults and the direct invocation
approval, account pin, exact source/code hashes and writer exclusion are unchanged.

Alpaca Basic provides real-time IEX, not consolidated SIP. PAPER simulated fills
use NBBO independently of a client's quote subscription. IEX quote-based checks
must not be represented as NBBO liquidity, consolidated spread, executable price
guarantees or evidence of live profitability.

## Explicit source selection

The reviewed `bindings.proof.feed` permits `sip` or `iex` only. The adapter passes
that exact value on every quote request, including presubmit refreshes. Transport
seals the request feed into the receipt; the mapper requires equality with the
approved source proof. It never derives feed identity from price values.

Legacy standalone transport callers that omit feed still request SIP explicitly.
An explicit missing/unknown/delayed/Toss feed is invalid. HTTP failure is sticky:
there is no retry or automatic SIP/IEX fallback. Order hosts remain PAPER-only.

IEX requires these additional reviewed proof fields:

| Field | Required meaning |
| --- | --- |
| `quoteCoverage` | `IEX_SINGLE_EXCHANGE` |
| `acceptsNonNbboPaperEvidence` | `true`, explicitly covered by the approved configuration hash |
| `feedEntitlementEvidenceSha256` | Existing account/feed permission evidence hash, not inferred from Basic alone |

The scope must remain PAPER. Synthetic v1 controller snapshots are still SIP-only;
IEX controller evidence must be a sealed observed v2 snapshot bound to the
approved proof hash and feed. This is source compatibility, not execution approval.

## Quote sizes: never guess the unit

The 2025-11-03 Alpaca change explicitly describes CTA/UTP sizes in shares. It does
not independently settle REST IEX units for this account/session. The general
quote documentation and historic IEX guidance use lots; neither justifies an
unconditional multiplier of 100 for every instrument.

Existing SIP proofs continue to require `quoteSizeUnit=shares` and
`sharesPerUnit="1"`. IEX requires the existing per-asset size evidence hash plus:

| Field | Required meaning |
| --- | --- |
| `quoteSizeFeed` | `iex` |
| `quoteSizeBasis` | `ALPACA_REST_LATEST_QUOTES` |
| `quoteSizeUnit` | Reviewed `shares` or `round_lots`, not inferred from response magnitude |
| `sharesPerUnit` | `"1"` for shares; explicitly evidenced positive integer string for lots |

There is no default unit or lot multiplier. The per-asset proof must establish the
unit and multiplier for the exact REST feed, instrument and applicable window.
An opaque hash alone does not establish that evidence: the operator must actually
review the source and bind its meaning before authorizing the configuration.
Runtime proof of these inputs is not supplied by synthetic tests.

IEX quotes require both exchange codes `V`, positive integral raw bid size and an
actual fresh payload timestamp. Normalized liquidity uses exact decimal
multiplication. The output retains original unit, multiplier and size evidence hash
alongside `bidSizeShares`; the latter is compared against the exact target quantity.
Missing/null/future/stale timestamps have no local-clock fallback or tolerance.

## Unchanged safety checks

- Current halt, risk, clock alignment, account and immutable identity evidence.
- Complete current portfolio, no open/protective order, fresh market session.
- Thirty-second evidence age, ten-bps spread and adverse-price floor, exact caps.
- The IEX spread/floor reference is IEX, not a claim about consolidated prices.
- Long-only full reduction, SELL LIMIT DAY, no extended-hours or risk increase.
- Durable reservation before submission, pre-write parity, duplicate rejection.
- Unknown submit outcome stops later targets; no synthetic fill/PnL promotion.

IEX itself does not prove trade-halt status, eliminate writer conflicts or supply
resting-order supervision. These prerequisites remain mandatory and unverified
until supplied by a separately reviewed runtime package.

## Compatibility and migration

No Stage6, shared ledger, notification or order schema changes. SIP mapped rows and
synthetic v1 behavior remain unchanged. Observed input schema stays v2: the new
source-proof fields are required only for the newly supported IEX option.
Successful quote receipts add `feed`; only in-process branded receipts are accepted.
IEX mapped rows add coverage and unit provenance. These private values are not
added to public aggregate results or broker order payloads.

New IEX proofs require a new configuration hash and direct approval; old SIP
approvals cannot authorize them. Historic evidence is not rewritten. Older code
rejects IEX proofs rather than interpreting them as SIP. Code rollback is a merge
revert, not restoring old ledgers after a broker action.

## Offline coverage and operational limit

Tests cover SIP regression, explicit IEX routing at each refresh, receipt/proof feed
mismatch, wrong exchange, reviewed shares/lots conversion (including lot size one),
missing/invalid units, wrong unit source, non-NBBO acknowledgement, missing/stale
halt/risk/time evidence, quote freshness, liquidity/spread/open-order rejection,
safe-default zero I/O, exact approval binding and deterministic mapping. Existing
temporary fixture storage, reconciliation, failure and duplicate tests are reused.

All provider traffic in these tests is fake transport under a network-denial
preload. Neither the account's entitlement nor real IEX size units are certified.
No real PAPER/LIVE order is authorized by this document or its passing tests.

## Official references reviewed 2026-10-14

- [Latest quote feed parameter](https://docs.alpaca.markets/us/reference/stocklatestquotesingle-1)
- [Market-data coverage](https://docs.alpaca.markets/us/docs/market-data-faq)
- [CTA/UTP size change](https://docs.alpaca.markets/us/changelog/marketdata-bid-and-ask-size-display-change)
- [General real-time quote schema](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)
- [Alpaca staff IEX lot-size explanation, historic guidance only](https://forum.alpaca.markets/t/bid-and-ask-size-for-iex-data-is-not-as-reported-by-iex/12712)
- [PAPER simulation limitations](https://docs.alpaca.markets/us/docs/paper-trading)
