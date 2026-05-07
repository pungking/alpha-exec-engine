# GTSA Execution Lifecycle Integration Plan

Last updated: 2026-05-07 (KST)
Owner: givet-bsm + Codex
Scope: Stage6 final-recommendation overlay + sidecar execution/lifecycle policy design
Source input: `docs/prompts/GTSA_Skill_Prompt.md`

---

## 1) Purpose

GTSA (Genius Thinking Stock Analysis) is useful only if it is converted into bounded, auditable execution signals. It must not become a free-text LLM layer that directly changes orders. The correct role is:

1. enrich Stage6 final recommendations with structured thesis/risk/action context,
2. improve entry realism and monitoring priority,
3. feed sidecar portfolio admission and lifecycle decisions,
4. keep Stage6 numeric contract as the source of truth for `entry`, `target`, and `stop` unless a deterministic execution overlay produces a safer bounded adjustment.

This plan intentionally separates analysis enrichment from order execution. Stage6 remains canonical; sidecar remains the only order-adjacent system.

---

## 2) GTSA Output Contract

The full GTSA narrative can be stored for research and reporting, but sidecar must consume only a reduced deterministic schema.

Recommended structured fields:

```json
{
  "schemaVersion": "gtsa_overlay_v1",
  "ticker": "JHG",
  "generatedAt": "2026-05-07T00:00:00Z",
  "thinkingModes": ["GI", "MDA"],
  "gtsaCompositeScore": 0,
  "actionBias": "HOLD_WAIT",
  "convictionDelta": 0,
  "entryAggression": 0,
  "monitoringPriority": "NORMAL",
  "riskFlags": [],
  "entryTactic": "PULLBACK_LIMIT",
  "invalidationTriggers": [],
  "scaleUpTriggers": [],
  "scaleDownTriggers": [],
  "exitPartialTriggers": [],
  "exitFullTriggers": [],
  "humilityChecks": [],
  "dataQuality": {
    "hasMarketContext": false,
    "hasNewsContext": false,
    "hasPriceContext": false,
    "sourceFreshnessMinutes": null
  }
}
```

Allowed `actionBias` values:

- `ENTRY_NEW`
- `HOLD_WAIT`
- `SCALE_UP`
- `SCALE_DOWN`
- `EXIT_PARTIAL`
- `EXIT_FULL`
- `NO_TRADE`

Allowed `entryTactic` values:

- `PULLBACK_LIMIT`: keep Stage6 pullback entry; do not chase.
- `CONFIRMED_ADAPTIVE_ENTRY`: bounded execution overlay may lift entry if RR and target buffer survive.
- `BREAKOUT_RETEST`: wait for breakout and retest; do not submit immediately.
- `NO_ENTRY_EVENT_RISK`: block new entry because GTSA identified event/regime risk.
- `OBSERVE_ONLY`: track but do not order.

Critical rule: free-text GTSA output is never an executable instruction. Only validated enum/numeric fields may affect downstream gates.

---

## 3) Entry Price Decision Stack

Final entry handling must follow this order:

1. **Stage6 baseline**
   - Use Stage6 `entryPrice`, `targetPrice`, `stopLoss`, `executionBucket`, `decisionCode`, and `entryDistancePct` as the canonical signal contract.

2. **Sidecar deterministic execution overlay**
   - Validate current price, distance to entry, RR at limit/current/suggested price, spread/liquidity when available, stale order age, and target buffer.
   - Any price adjustment must stay inside RR floor, stop-distance bounds, max chase, and max entry-distance policy.

3. **GTSA policy overlay**
   - GTSA may adjust only *policy posture*, not raw order geometry.
   - Example: `entryAggression=+1` can allow the sidecar to use the upper half of the existing adaptive chase band; it cannot override `ENTRY_PRICE_MAX_CHASE_PCT`, `ENTRY_MAX_DISTANCE_PCT`, or `EXECUTION_OVERLAY_MIN_RR`.
   - Example: `entryAggression=-1` can force `HOLD_WAIT` even if Stage6 says executable.

4. **Portfolio admission controller**
   - Admit only the best candidates within portfolio/order caps.
   - Reject or defer lower-ranked candidates with explicit reasons.

This prevents the current failure mode: chasing unfillable idealized entries on one side, or accepting too many rotating daily recommendations on the other.

---

## 4) Portfolio Admission Controller

Daily recommendations must pass portfolio-level capacity checks before any order payload is created.

Recommended controls:

| Control | Default recommendation | Purpose |
|---|---:|---|
| `MAX_OPEN_ENTRY_ORDERS` | 6 | Prevent endless pending-order accumulation |
| `MAX_NEW_SYMBOLS_PER_DAY` | 2 | Keep daily turnover controlled |
| `MAX_ACTIVE_SYMBOLS_TOTAL` | 12 | Cap total monitored/held symbols |
| `MAX_SECTOR_ACTIVE_SYMBOLS` | 4 | Prevent sector concentration |
| `PENDING_ORDER_TTL_MINUTES` | 180 | Expire stale unfilled ideas |
| `MIN_FILLABILITY_SCORE` | 60 | Avoid orders unlikely to fill rationally |
| `MIN_ADMISSION_RR` | 1.8 | Preserve minimum reward/risk |

Admission ranking should combine:

- Stage6 model rank / `XS` / `AQ`,
- expected return and RR,
- execution distance and fillability,
- GTSA composite score and action bias,
- sector and existing exposure,
- open order age and broker state.

Expected audit output:

```text
Portfolio Admission: checked=6 admitted=2 rejected=4
activeSymbols=5/12 openEntryOrders=2/6 newSymbolsToday=2/2
Rejected: CPRX capacity_new_symbols_per_day, SPG high_price_risk_cap, AUPH lower_rank_capacity_full
```

---

## 5) Recommendation Monitoring Ledger

The system needs a symbol-level recommendation ledger separate from the broker order ledger.

Recommended state file:

`state/recommendation-ledger.json`

Recommended lifecycle states:

- `RECOMMENDED_NEW`
- `ADMITTED_FOR_ENTRY`
- `ORDER_PENDING`
- `OPEN_ORDER`
- `FILLED`
- `HOLD_MONITOR`
- `SCALE_UP_CANDIDATE`
- `SCALE_DOWN_CANDIDATE`
- `EXIT_PARTIAL_CANDIDATE`
- `EXIT_FULL_CANDIDATE`
- `CLOSED`
- `EXPIRED_RECOMMENDATION`
- `REJECTED_BY_ADMISSION`

Each ledger row must include:

- `symbol`, `sector`, `firstSeenAt`, `lastSeenAt`, `stage6Hash`, `latestStage6File`,
- latest Stage6 rank/score/verdict/entry/target/stop,
- latest GTSA reduced fields,
- broker order state if any,
- position state if any,
- current action recommendation,
- explicit reason code.

This ledger answers the user's operational question directly: “which recommended names are still being watched, which entered, which were rejected, which should be scaled/exited, and why?”

---

## 6) Action Policy Mapping

| Situation | Required evidence | Action |
|---|---|---|
| New high-quality Stage6 executable + capacity available | RR ok, fillability ok, no duplicate open order | `ENTRY_NEW` |
| Stage6 executable but current price too far | RR/current price fails or distance too high | `HOLD_WAIT` |
| Already held, Stage6 still strong, price not extended | conviction high, avg-entry chase guard ok | `SCALE_UP` |
| Already held, conviction weakens or risk rises | score/risk degradation, sector cap pressure | `SCALE_DOWN` |
| Profit target partial zone reached | partial take-profit threshold and thesis still alive | `EXIT_PARTIAL` |
| Stop/invalidation/event risk hit | stop, thesis break, hard risk flag | `EXIT_FULL` |
| Recommendation stale and never filled | TTL expired, not reselected, no position | `EXPIRED_RECOMMENDATION` |

GTSA may refine the reason and priority, but the action must be emitted by deterministic policy code.

---

## 7) Guardrails

- GTSA cannot directly submit orders.
- GTSA cannot bypass Stage6 geometry, preflight, Alpaca clock, idempotency, open-order guard, or portfolio caps.
- If GTSA data quality is incomplete, output `OBSERVE_ONLY` or leave sidecar posture unchanged.
- If GTSA contradicts Stage6, sidecar must either downgrade to `HOLD_WAIT` or require explicit audit evidence before entry.
- No free-text recommendation can change `EXEC_ENABLED`, `READ_ONLY`, or market-guard execution flags.

---

## 8) Implementation Sequence

### P0-A: Documentation and contract freeze

- Add this document to the living development plan.
- Keep the source GTSA prompt in `docs/prompts/GTSA_Skill_Prompt.md` so CI, GitHub, and the always-on machine do not
  depend on a local `Downloads` path.
- Define `gtsa_overlay_v1` reduced schema.
- Define `recommendation-ledger` state schema.

### P0-B: Sidecar portfolio admission controller

- Add portfolio-level caps before payload creation.
- Emit `state/portfolio-admission-audit.json`.
- Keep execution defaults safe and make reasons visible in Telegram/ops reports.

### P1-A: Recommendation ledger

- Persist candidate lifecycle state across daily Stage6 hashes.
- Track repeated recommendations, new names, stale names, open orders, fills, and closed/rejected names.

### P1-B: GTSA overlay ingestion

- Add optional `gtsaOverlay` parser after Stage6 load.
- Default: disabled/observe-only.
- Consume only reduced fields.

### P2: Stage6 GTSA generation

- Generate GTSA overlay after Stage6 final recommendations.
- Store narrative for Notion/Obsidian/NotebookLM; store reduced schema for sidecar.

---

## 9) Done-When Criteria

- A daily run with 6 different recommendations admits only configured top candidates and rejects the rest with explicit reason codes.
- After 5 trading days, active open/held/monitored symbols remain below configured portfolio caps.
- Repeated recommendations update `lastSeenAt` instead of creating uncontrolled duplicate watch records.
- Stale unfilled recommendations become `EXPIRED_RECOMMENDATION` or `HOLD_WAIT` with evidence.
- Filled positions transition into lifecycle monitoring and can produce `HOLD`, `SCALE_UP`, `SCALE_DOWN`, `EXIT_PARTIAL`, or `EXIT_FULL` candidates.
- Telegram/Notion reports show recommendation state, broker state, and next action separately.
