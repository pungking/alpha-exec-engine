import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { decimalRatio as ratio, decimalText, withinCap, add, multiply, compare, ceilToTick } from './closeout-decimal.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, names) => object(v) && Object.keys(v).sort().join(',') === names.split(' ').sort().join(',');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v);
const positive = v => typeof v === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,9})?$/.test(v) && ratio(v)[0] > 0n;
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
const requireContract = (ok, code) => { if (!ok) throw new Error(`SCOPED_CLOSEOUT_${code}`); };
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const scopes = new WeakSet();
export const BUDGET = Object.freeze({ account: 6, positions: 11, orders: 11, clock: 11, calendar: 1, assets: 10, lookup: 5, quotes: 6, submit: 5 });
export const SAFETY = Object.freeze({ brokerSubmitAllowed: false, wouldCreateBrokerPayload: false,
  originalOwnershipVerified: false, realizedPnlVerified: false, historicalEvidenceNormalized: false });

export function validateScopedCloseoutInput(input) {
  requireContract(exact(input, 'schemaVersion environment evidenceMode attemptId accountSha256 sourceSha256 codeSha256 terms termsSha256 authority authoritySha256 safeFlags preWriteHashes'), 'INPUT_INVALID');
  requireContract(input.schemaVersion === 1 && input.environment === 'PAPER' && input.evidenceMode === 'SYNTHETIC', 'MODE_INVALID');
  requireContract(id(input.attemptId) && ['accountSha256', 'sourceSha256', 'codeSha256', 'termsSha256', 'authoritySha256'].every(k => hash(input[k])), 'PIN_INVALID');
  requireContract(exact(input.safeFlags, 'readOnly execEnabled liveOrderSubmitEnabled marketGuardMode')
    && input.safeFlags.readOnly === true && input.safeFlags.execEnabled === false
    && input.safeFlags.liveOrderSubmitEnabled === false && input.safeFlags.marketGuardMode === 'observe', 'SAFE_FLAGS_REQUIRED');
  const a = input.authority, t = input.terms;
  requireContract(exact(a, 'kind session validFrom expiresAt acceptsRestingDayOrders') && a.kind === 'SYNTHETIC_ONLY'
    && /^\d{4}-\d\d-\d\d$/.test(a.session) && time(a.expiresAt) > time(a.validFrom)
    && a.acceptsRestingDayOrders === true && digest(a) === input.authoritySha256, 'AUTHORITY_INVALID');
  requireContract(exact(input.preWriteHashes, 'orderLedger orderIdempotency') && Object.values(input.preWriteHashes).every(hash), 'STORE_PIN_INVALID');
  requireContract(exact(t, 'targets portfolio maxTotalNotional maxSpreadBps maxAdverseBps maxEvidenceAgeSeconds')
    && digest(t) === input.termsSha256 && t.maxSpreadBps === 10 && t.maxAdverseBps === 10
    && t.maxEvidenceAgeSeconds === 30 && positive(t.maxTotalNotional), 'TERMS_INVALID');
  requireContract(Array.isArray(t.targets) && t.targets.length === 5 && t.targets.every(r =>
    exact(r, 'originalIdentitySha256 assetId exitIdempotencyKey clientOrderId qty maxNotional')
    && hash(r.originalIdentitySha256) && ['assetId', 'exitIdempotencyKey', 'clientOrderId'].every(k => id(r[k]))
    && r.clientOrderId.length <= 48 && positive(r.qty) && positive(r.maxNotional)), 'FIVE_TARGETS_REQUIRED');
  for (const key of ['originalIdentitySha256', 'assetId', 'exitIdempotencyKey', 'clientOrderId'])
    requireContract(new Set(t.targets.map(r => r[key])).size === 5, 'DUPLICATE_IDENTITY');
  requireContract(Array.isArray(t.portfolio) && t.portfolio.length >= 5 && t.portfolio.length < 500
    && t.portfolio.every(p => exact(p, 'assetId qty') && id(p.assetId) && positive(p.qty))
    && new Set(t.portfolio.map(p => p.assetId)).size === t.portfolio.length
    && t.targets.every(r => t.portfolio.some(p => p.assetId === r.assetId && p.qty === r.qty)), 'PORTFOLIO_INVALID');
  const scope = freeze(structuredClone(input)); scopes.add(scope); return scope;
}

function validateTime(scope, snapshot, clock) {
  const now = time(clock?.now), c = snapshot.clock, a = scope.authority;
  requireContract(Number.isFinite(now) && Number.isFinite(clock.elapsedMs) && clock.elapsedMs >= 0 && clock.elapsedMs <= 283000, 'DEADLINE_INVALID');
  requireContract(now >= time(a.validFrom) && time(a.expiresAt) - now >= 17000, 'AUTHORITY_EXPIRED');
  requireContract(object(c) && c.version === 'v2' && c.isOpen === true && c.timezone === 'America/New_York'
    && c.clockAlignment === 'SYNTHETIC_VERIFIED' && hash(c.responseSha256) && c.session === a.session
    && time(c.open) <= now && time(c.close) - now >= 17000, 'MARKET_SESSION_INVALID');
  requireContract(Number.isFinite(time(c.timestamp)) && time(c.timestamp) <= now && now - time(c.timestamp) <= 30000, 'CLOCK_STALE');
  requireContract(exact(snapshot.observations, 'account positions orders assets calendar'), 'OBSERVATIONS_INVALID');
  for (const o of Object.values(snapshot.observations)) requireContract(exact(o, 'basis requestedAt retrievedAt responseSha256')
    && o.basis === 'OBSERVED_GET_INTERVAL' && hash(o.responseSha256)
    && time(o.requestedAt) <= time(o.retrievedAt) && time(o.retrievedAt) <= now
    && now - time(o.requestedAt) <= 30000 && time(o.retrievedAt) - time(o.requestedAt) <= 3000, 'OBSERVATION_STALE');
}

function priceOrder(target, row, now) {
  requireContract(object(row) && row.assetId === target.assetId && row.originalIdentitySha256 === target.originalIdentitySha256
    && row.qty === target.qty, 'ROW_IDENTITY_INVALID');
  requireContract(['bid', 'ask', 'bidSizeShares', 'tick', 'quantityIncrement'].every(k => positive(row[k])), 'DECIMAL_INVALID');
  requireContract(row.feed === 'sip' && row.currency === 'USD' && row.sizeUnit === 'shares'
    && row.sourceBinding === 'SYNTHETIC_VERIFIED' && hash(row.quoteResponseSha256)
    && row.tradable === true && row.haltStatus === 'NOT_HALTED' && row.riskStatus === 'PASS' && hash(row.riskEvidenceSha256), 'SOURCE_OR_RISK_INVALID');
  requireContract(time(row.quoteAt) <= now && now - time(row.quoteAt) <= 30000, 'QUOTE_STALE');
  const bid = ratio(row.bid), ask = ratio(row.ask), qty = ratio(row.qty), step = ratio(row.quantityIncrement);
  requireContract(compare(ask, bid) >= 0 && compare(qty, ratio(row.bidSizeShares)) <= 0, 'LIQUIDITY_INVALID');
  requireContract(row.tick === (compare(bid, [1n, 1n]) >= 0 ? '0.01' : '0.0001')
    && qty[0] * step[1] % (qty[1] * step[0]) === 0n
    && (qty[0] % qty[1] === 0n || row.fractionable === true), 'INCREMENT_INVALID');
  const spread = [20000n * (ask[0] * bid[1] - bid[0] * ask[1]), ask[0] * bid[1] + bid[0] * ask[1]];
  requireContract(withinCap(spread, '10'), 'SPREAD_EXCEEDED');
  const floor = multiply(bid, [9990n, 10000n]), limitPrice = ceilToTick(floor, row.tick);
  requireContract(compare(ratio(limitPrice), bid) <= 0 && positive(limitPrice), 'PRICE_FLOOR_INVALID');
  const planned = multiply(ask, qty);
  requireContract(withinCap(planned, target.maxNotional), 'ROW_CAP_EXCEEDED');
  return { exitIdempotencyKey: target.exitIdempotencyKey, clientOrderId: target.clientOrderId,
    assetId: target.assetId, side: 'sell', actionType: 'EXIT_FULL', qty: target.qty,
    limitPrice, type: 'limit', timeInForce: 'day', extendedHours: false,
    plannedNotional: decimalText(planned) };
}

export function evaluateCloseoutSnapshot(scope, snapshot, clock, committed = {}) {
  try {
    requireContract(scopes.has(scope), 'UNVALIDATED_SCOPE');
    requireContract(object(snapshot) && snapshot.evidenceMode === 'SYNTHETIC' && snapshot.complete === true
      && snapshot.accountSha256 === scope.accountSha256 && snapshot.sourceSha256 === scope.sourceSha256, 'SNAPSHOT_INVALID');
    validateTime(scope, snapshot, clock);
    const expected = scope.terms.portfolio.filter(p => !Object.hasOwn(committed, p.assetId));
    const canonicalPortfolio = rows => [...rows].sort((a, b) => a.assetId.localeCompare(b.assetId));
    requireContract(Array.isArray(snapshot.portfolio) && digest(canonicalPortfolio(snapshot.portfolio)) === digest(canonicalPortfolio(expected)), 'PORTFOLIO_DRIFT');
    requireContract(Array.isArray(snapshot.openOrders) && snapshot.openOrders.length === 0, 'OPEN_ORDER_CONFLICT');
    requireContract(Array.isArray(snapshot.rows) && snapshot.rows.length === 5
      && new Set(snapshot.rows.map(r => r?.assetId)).size === 5, 'ROW_COUNT_INVALID');
    const proposedOrders = scope.terms.targets.filter(t => !Object.hasOwn(committed, t.assetId))
      .map(t => priceOrder(t, snapshot.rows.find(r => r.assetId === t.assetId), time(clock.now)));
    requireContract(object(committed) && Object.keys(committed).every(k => scope.terms.targets.some(t => t.assetId === k)
      && positive(committed[k])), 'COMMITTED_NOTIONAL_INVALID');
    const total = [...Object.values(committed), ...proposedOrders.map(o => o.plannedNotional)].reduce((a, v) => add(a, ratio(v)), [0n, 1n]);
    requireContract(withinCap(total, scope.terms.maxTotalNotional), 'TOTAL_CAP_EXCEEDED');
    return freeze({ status: 'READY_REPORT_ONLY', reasons: [], proposedOrders,
      reservedPlannedNotional: decimalText(total), evidenceSha256: digest(snapshot), ...SAFETY });
  } catch (error) {
    const code = /^SCOPED_CLOSEOUT_[A-Z_]+$/.test(error.message) ? error.message : 'SCOPED_CLOSEOUT_SNAPSHOT_INVALID';
    return freeze({ status: 'BLOCKED', reasons: [code], proposedOrders: [], ...SAFETY });
  }
}
