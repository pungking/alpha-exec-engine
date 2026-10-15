# PAPER IEX quote unit and read-only caller closure

Goal: PAPER_IEX_QUOTE_UNIT_AND_READONLY_CALLER_CLOSURE_V1.

## Scope and implementation sequence

1. Preserve the previous preparation, failed full-capture preflight and all original state.
2. Add failing fixtures for an inert CLI, exact historical identity scope, source/code/account pins,
   exclusive evidence reservation, a three-GET sequence, stopping/redaction and no duplicate request.
3. Reuse the scoped transport, private file reader, target validator and nanosecond freshness comparison.
4. Run offline regression tests and independent review; integrate only after CI succeeds.
5. Separately resolve the official unit question and obtain a narrow runtime approval. No execution activation.

## Current source-unit conclusion (2026-10-15)

`OFFICIAL_REST_IEX_PER_ASSET_QUOTE_UNIT_BASIS_UNVERIFIED` remains open.
Do not infer shares or a universal 100-share lot from returned size magnitudes.

- [Latest quotes reference](https://docs.alpaca.markets/us/reference/stocklatestquotes-1)
  supports an explicit IEX feed on the batch latest-quotes endpoint.
- [Market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)
  distinguishes single-exchange IEX from consolidated SIP; IEX is not NBBO.
- [CTA/UTP change notice](https://docs.alpaca.markets/us/changelog/marketdata-bid-and-ask-size-display-change)
  scopes the November 2025 shares change to CTA/UTP, not explicitly REST IEX.
- [Alpaca market-data skill](https://github.com/alpacahq/alpaca-skills/blob/main/skills/broker-api/market-data/SKILL.md)
  describes a general shares change, without a feed-specific REST IEX conversion contract.
- [Earlier staff response](https://forum.alpaca.markets/t/bid-and-ask-size-for-iex-data-is-not-as-reported-by-iex/12712)
  describes lots; it is not current per-asset proof.

These sources do not establish a current feed-specific, per-asset unit basis for this execution contract.
Ask Alpaca for the current `bs`/`as` units for REST `feed=iex`, their effective date,
and, if lots, the authoritative per-asset shares-per-lot source. No inquiry is sent by this script.
A successful three-GET observation cannot answer this unit question or unlock the closeout adapter.

## Caller contract

`scripts/run-paper-iex-readonly-probe.mjs` without arguments returns `NOT_RUN`:
no credential access, filesystem writes, or network. `--execute` is not supported.

An explicitly approved operator may later use `--observe <private-config-file> <config-byte-sha256>`.
The config has exactly four fields:

```json
{
  "sourceDirectory": "/absolute/private/preserved-source",
  "sourceManifestSha256": "REPLACE_WITH_REVIEWED_SHA256",
  "outputDirectory": "/absolute/private/new-exclusive-attempt",
  "reviewedCodeSha256": "REPLACE_WITH_REVIEWED_CODE_SHA256"
}
```

These are placeholders, not an executable approval package. Pin `reviewedCodeSha256()` from the
reviewed commit before authorizing runtime, not by blindly accepting current code during execution.
`CODE_FILES` covers the caller and its local transitive imports; the fixture enforces closure of that set.
New imported code must be included. The source manifest pins every file's bytes; only exact
ledger/idempotency identities scope the quote query. Historical auxiliary reports, current asset
IDs, portfolio, source ownership and state authenticity are not certified or repaired.

Use the existing five-row private source, never symbols guessed from a report. Input directories
and files must be owner-only, with no symlinks. All source files remain byte-identical.
Output parent must already exist owner-only; the new attempt directory is exclusive.
`attempt.json` is atomically persisted and fsynced before the first request. Existing attempts
(including a crashed/failed attempt) are never overwritten or retried. `result.json` contains
counts, statuses and hashes only. No account value, symbol, quote price/size/timestamp, credential,
or raw response is persisted or printed. Response bytes exist in memory only.

Required explicit environment: `ALPHA_ENV=PAPER`, `ALPACA_BASE_URL=https://paper-api.alpaca.markets`,
`READ_ONLY=true`, `EXEC_ENABLED=false`, `LIVE_ORDER_SUBMIT_ENABLED=false`, `MARKET_GUARD_MODE=observe`,
`FORCE_SEND_ONCE=false`, and all three `GUARD_EXECUTE_*` flags false.
Only after approval/source/code/safety preflight are `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` read.
No dotenv loading, credential discovery, variable updates or ambient default activation.
`PAPER_IEX_READONLY_APPROVAL` must equal the exact separately approved phrase
`AUTHORIZE PAPER IEX THREE-GET READ-ONLY ONE-SHOT`.

Fixed sequence:

| Order | Host / route | Limit | Gate |
| --- | --- | --- | --- |
| 1 | PAPER `/v2/account` | 1 GET | Exact approval/source/code/safety/credentials and exclusive attempt |
| 2 | PAPER `/v2/clock` | 1 GET | Raw account-ID SHA-256 matches the pinned source, account active/unblocked |
| 3 | Data `/v2/stocks/quotes/latest` | 1 GET | Valid fresh open broker clock; five exact historical symbols, `feed=iex`, `currency=USD` |

Total <=3. All other endpoints/feeds: zero. No submit callback is installed. No full closeout adapter,
portfolio collection, retry, pagination, redirect, SIP fallback, calendar call or market-data provider change.
Existing transport limits remain: 3 seconds/request, 8 MiB/response, 5 minutes/attempt.
Existing 30-second nanosecond-precision freshness rule is reused, without compensation or tolerance.
Closed/invalid/stale/future clock stops before quotes; clock is checked again after quotes.
Missing/extra quote, wrong exchange, invalid/crossed price or invalid size fails the observation.
Positive integer size is a shape check only, never unit normalization or liquidity certification.

Success is only `OBSERVATION_COMPLETE_UNITS_UNVERIFIED`. Account pin/access/shape observations
must not become `READY_REPORT_ONLY`, execution-ready, current portfolio proof, normalized historical
evidence or verified P&L. No receipt/binding for the closeout engine is produced.
This task does not fulfill the old missing-original-input goal.

## Verification / rollback

Run the new fixture under `scripts/fixtures/scoped-paper-offline.cjs` with an absolute preload path.
Also run scoped transport/evidence/adapter, closeout, private capture, storage, order-state,
readiness, protection, P&L, dispatch safety, symbol/routing, typecheck and build regressions.
CI only executes synthetic fixtures; no runtime workflow is added. Rollback: revert this isolated
merge, preserving all attempt directories. Stage6/OOS, existing state schemas, execution defaults,
dependencies and existing runtime callers are unchanged; freshness helper exports are additive.

## Completion boundaries

- Static caller completion: offline contracts, independent review, PR and CI PASS.
- Unit closure: current official REST IEX unit/lot evidence reviewed; currently NOT met.
- Runtime closure: separately approved one-shot; currently NOT run.
- PAPER orders / Toss LIVE / funding: NOT authorized by any of the above.
