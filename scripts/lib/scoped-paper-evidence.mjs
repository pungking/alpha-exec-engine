import { createHash } from 'node:crypto';
import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { decimalRatio, decimalText, compare, multiply } from './closeout-decimal.mjs';
import { isScopedPaperReceipt } from './scoped-paper-transport.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v);
const symbol = v => typeof v === 'string' && /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(v);
const check = (ok, code) => { if (!ok) throw Error(`SCOPED_EVIDENCE_${code}`); };
const freeze = v => { if (object(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const snapshots = new WeakSet();
export const isObservedSnapshot = value => snapshots.has(value);
const seal = v => { freeze(v); snapshots.add(v); return v; };
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const local = value => Object.fromEntries(ny.formatToParts(new Date(value)).map(p => [p.type, p.value]));

// Compare full provider precision before any millisecond projection for the old controller.
function ns(value) {
  check(typeof value === 'string', 'TIMESTAMP_INVALID');
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  check(m && Number.isFinite(Date.parse(`${m[1]}${m[3]}`)), 'TIMESTAMP_INVALID');
  const day = m[1].slice(0, 10);
  check(new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day, 'TIMESTAMP_INVALID');
  return BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000000n + BigInt((m[2] ?? '').padEnd(9, '0'));
}
const fresh = (v, now) => { try { const age = ns(now) - ns(v); return age >= 0n && age <= 30000000000n; } catch { return false; } };
export { ns as evidenceTimestampNs, fresh as evidenceTimestampFresh };
const projected = (v, now) => { check(fresh(v, now), 'TIMESTAMP_STALE_OR_FUTURE'); return new Date(Number(ns(v) / 1000000n)).toISOString(); };
function decimal(value, zero = false) {
  check((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string', 'DECIMAL_INVALID');
  const text = String(value);
  check(/^(0|[1-9]\d{0,15})(\.\d{1,9})?$/.test(text) && (zero || compare(decimalRatio(text), [0n, 1n]) > 0), 'DECIMAL_INVALID');
  return decimalText(decimalRatio(text));
}

export function assessSourceBindings(bindings, scope, clock) {
  const p = bindings?.proof, reasons = [];
  try {
    check(object(p) && p.basis === 'REVIEWED_SCOPED_SOURCE_EVIDENCE' && digest(p) === bindings.proofSha256
      && p.accountSha256 === scope.accountSha256 && p.session === scope.authority.session
      && ns(p.validFrom) <= ns(clock.now()) && ns(p.expiresAt) >= ns(clock.now()), 'SOURCE_BINDING_INVALID');
    const iex = p.feed === 'iex';
    if (!['sip', 'iex'].includes(p.feed) || p.currency !== 'USD' || !hash(p.feedEntitlementEvidenceSha256)
      || (iex && (scope.environment !== 'PAPER' || p.quoteCoverage !== 'IEX_SINGLE_EXCHANGE'
        || p.acceptsNonNbboPaperEvidence !== true))) reasons.push('FEED_ENTITLEMENT_UNVERIFIED');
    if (!hash(p.clockAlignmentEvidenceSha256)) reasons.push('CLOCK_ALIGNMENT_UNVERIFIED');
    check(Array.isArray(p.assets) && p.assets.length === 5 && new Set(p.assets.map(a => a.assetId)).size === 5
      && p.assets.every(a => scope.terms.targets.some(t => t.assetId === a.assetId)), 'SOURCE_ASSET_BINDING_INVALID');
    for (const a of p.assets) {
      // CTA/UTP's shares change does not establish IEX units; require a feed-specific reviewed basis.
      const shares = a.quoteSizeUnit === 'shares' && a.sharesPerUnit === '1';
      const lots = iex && a.quoteSizeUnit === 'round_lots' && typeof a.sharesPerUnit === 'string' && /^[1-9]\d{0,15}$/.test(a.sharesPerUnit);
      if ((!shares && !lots) || !hash(a.sizeEvidenceSha256)
        || (iex && (a.quoteSizeFeed !== 'iex' || a.quoteSizeBasis !== 'ALPACA_REST_LATEST_QUOTES'))) reasons.push('QUOTE_SIZE_CONTRACT_UNVERIFIED');
      if (!hash(a.incrementEvidenceSha256) || !a.quantityIncrement) reasons.push('ASSET_INCREMENT_UNVERIFIED');
      if (a.halt?.status !== 'NOT_HALTED' || !hash(a.halt?.evidenceSha256) || !fresh(a.halt?.observedAt, clock.now())) reasons.push('HALT_EVIDENCE_UNAVAILABLE');
      if (a.risk?.status !== 'PASS' || a.risk?.termsSha256 !== scope.termsSha256 || !hash(a.risk?.evidenceSha256)
        || !fresh(a.risk?.observedAt, clock.now())) reasons.push('RISK_EVIDENCE_INCOMPLETE');
    }
  } catch { reasons.push('SOURCE_BINDING_INVALID'); }
  return freeze({ status: reasons.length ? 'BLOCKED' : 'PASS', reasons: [...new Set(reasons)], evidenceHashes: hash(bindings?.proofSha256) ? [bindings.proofSha256] : [] });
}

function interval(r, now) {
  check(isScopedPaperReceipt(r) && r.complete && r.error === null && r.status >= 200 && r.status < 300
    && hash(r.responseSha256) && r.bytes > 0 && r.bytes <= 8388608 && r.durationMs >= 0 && r.durationMs <= 3000
    && fresh(r.requestedAt, now) && ns(r.requestedAt) <= ns(r.retrievedAt) && ns(r.retrievedAt) <= ns(now)
    && ns(r.retrievedAt) - ns(r.requestedAt) <= 3000000000n, 'RECEIPT_INVALID');
  return { basis: 'OBSERVED_GET_INTERVAL', requestedAt: r.requestedAt, retrievedAt: r.retrievedAt, responseSha256: r.responseSha256 };
}
function receipt(receipts, group, now) {
  const rows = receipts.filter(r => r.group === group); check(rows.length === 1, 'RECEIPT_COUNT_INVALID');
  interval(rows[0], now); return rows[0];
}
export function mapAccountEvidence({ scope, receipt: r, bindings, clock }) {
  interval(r, clock.now()); const a = r.data;
  check(r.group === 'account' && id(a?.id) && a.status === 'ACTIVE' && a.currency === 'USD'
    && a.trading_blocked === false && a.account_blocked === false && a.trade_suspended_by_user === false, 'ACCOUNT_INVALID');
  check(bindings.accountHashBasis === 'CANONICAL_PAPER_ACCOUNT_ID' && bindings.rawAccountHashBasis === 'RAW_ACCOUNT_ID_UTF8'
    && digest(['PAPER', a.id]) === scope.accountSha256
    && createHash('sha256').update(a.id).digest('hex') === bindings.rawAccountIdSha256, 'ACCOUNT_PIN_MISMATCH');
  return scope.accountSha256;
}
function positions(r) {
  check(Array.isArray(r.data) && r.data.length < 500 && new Set(r.data.map(p => p?.asset_id)).size === r.data.length, 'POSITIONS_INVALID');
  return r.data.map(p => { check(id(p?.asset_id) && symbol(p.symbol) && p.asset_class === 'us_equity' && p.side === 'long', 'POSITION_IDENTITY_INVALID');
    return { assetId: p.asset_id, qty: decimal(p.qty) }; });
}
function noOrders(r) {
  check(Array.isArray(r.data) && r.data.length === 0, 'OPEN_ORDER_CONFLICT'); return [];
}
function clockEvidence(r, calendar, scope, bindings, now) {
  const p = bindings.proof, c = r.data, date = scope.authority.session;
  check(c?.is_open === true && Array.isArray(calendar) && calendar.length === 1 && calendar[0].date === date, 'MARKET_SESSION_INVALID');
  const open = p.calendar?.open, close = p.calendar?.close;
  check(ns(open) <= ns(now) && ns(close) > ns(now) && ns(c.next_close) === ns(close), 'MARKET_SESSION_INVALID');
  for (const [v, hhmm] of [[open, calendar[0].open], [close, calendar[0].close], [now, null]]) {
    const parts = local(v);
    check(`${parts.year}-${parts.month}-${parts.day}` === date && (!hhmm || `${parts.hour}:${parts.minute}` === hhmm), 'MARKET_SESSION_INVALID');
  }
  return { version: 'v2', isOpen: true, timestamp: projected(c.timestamp, now), session: date, open, close,
    timezone: 'America/New_York', clockAlignment: 'PAPER_OBSERVED_VERIFIED', responseSha256: r.responseSha256 };
}

export function mapPreflightEvidence({ scope, receipts, bindings, clock, committed = {} }) {
  const now = clock.now(); check(assessSourceBindings(bindings, scope, clock).status === 'PASS', 'SOURCE_BINDING_INVALID');
  check(Array.isArray(receipts) && receipts.every(r => isScopedPaperReceipt(r)), 'RECEIPT_INVALID');
  const get = group => receipt(receipts, group, now);
  mapAccountEvidence({ scope, receipt: get('account'), bindings, clock });
  const pr = get('positions'), portfolio = positions(pr), orders = noOrders(get('orders'));
  const expected = scope.terms.portfolio.filter(p => !Object.hasOwn(committed, p.assetId));
  const sorted = rows => rows.map(r => ({ ...r, qty: decimal(r.qty) })).sort((a, b) => a.assetId.localeCompare(b.assetId));
  check(digest(sorted(portfolio)) === digest(sorted(expected)), 'PORTFOLIO_DRIFT');
  const ar = receipts.filter(r => r.group === 'assets');
  check(ar.length === 5 && new Set(ar.map(r => r.data?.id)).size === 5, 'ASSET_COUNT_INVALID');
  ar.forEach(r => interval(r, now));
  const qr = get('quotes'), quotes = qr.data?.quotes;
  check(qr.feed === bindings.proof.feed, 'QUOTE_FEED_MISMATCH');
  check(object(quotes) && Object.keys(quotes).length === 5, 'QUOTES_INVALID');
  const rows = scope.terms.targets.map(t => {
    const a = ar.find(r => r.data?.id === t.assetId)?.data, p = pr.data.find(r => r.asset_id === t.assetId);
    check(a && symbol(a.symbol) && a.class === 'us_equity' && a.status === 'active' && a.tradable === true
      && typeof a.fractionable === 'boolean' && (!p || p.symbol === a.symbol), 'ASSET_IDENTITY_INVALID');
    const b = bindings.proof.assets.find(r => r.assetId === t.assetId), q = quotes[a.symbol];
    check(object(q), 'QUOTE_IDENTITY_INVALID');
    if (qr.feed === 'iex') check(q.bx === 'V' && q.ax === 'V' && /^[1-9]\d{0,15}$/.test(String(q.bs)), 'IEX_QUOTE_CONTRACT_INVALID');
    return { originalIdentitySha256: t.originalIdentitySha256, assetId: t.assetId, symbol: a.symbol, qty: t.qty,
      bid: decimal(q.bp), ask: decimal(q.ap), bidSizeShares: decimalText(multiply(decimalRatio(decimal(q.bs)), decimalRatio(b.sharesPerUnit))),
      quoteAt: projected(q.t, qr.retrievedAt), quoteResponseSha256: qr.responseSha256, feed: qr.feed, currency: 'USD', sizeUnit: 'shares',
      ...(qr.feed === 'iex' ? { quoteCoverage: 'IEX_SINGLE_EXCHANGE', quoteSizeUnit: b.quoteSizeUnit,
        sharesPerUnit: b.sharesPerUnit, sizeEvidenceSha256: b.sizeEvidenceSha256 } : {}),
      sourceBinding: 'PAPER_OBSERVED_VERIFIED', tick: compare(decimalRatio(decimal(q.bp)), [1n, 1n]) >= 0 ? '0.01' : '0.0001',
      quantityIncrement: decimal(b.quantityIncrement), fractionable: a.fractionable, tradable: a.tradable,
      haltStatus: b.halt.status, riskStatus: b.risk.status, riskEvidenceSha256: b.risk.evidenceSha256 };
  });
  check(new Set(rows.map(r => r.symbol)).size === 5, 'ASSET_IDENTITY_INVALID');
  return seal({ evidenceMode: 'PAPER_OBSERVED', accountSha256: scope.accountSha256, sourceSha256: scope.sourceSha256,
    sourceBindingsSha256: bindings.proofSha256,
    complete: true, portfolio, openOrders: orders, rows,
    observations: { account: interval(get('account'), now), positions: interval(pr, now), orders: interval(get('orders'), now),
      calendar: interval(get('calendar'), now), assets: { basis: 'OBSERVED_GET_SET', receipts: ar.map(r => interval(r, now)) } },
    clock: clockEvidence(get('clock'), get('calendar').data, scope, bindings, now) });
}

export function mapOrderObservation({ scope, record, receipt: r }) {
  interval(r, r.retrievedAt); const o = r.data;
  check(['lookup', 'submit'].includes(r.group) && id(o?.id) && o.client_order_id === record.clientOrderId
    && o.asset_id === record.assetId && (!record.brokerOrderId || o.id === record.brokerOrderId)
    && symbol(o.symbol) && (!record.symbol || record.symbol === o.symbol)
    && o.side === 'sell' && o.type === 'limit' && o.time_in_force === 'day' && o.extended_hours === false
    && decimal(o.qty) === decimal(record.qty) && decimal(o.limit_price) === decimal(record.limitPrice)
    && (!o.legs || (Array.isArray(o.legs) && o.legs.length === 0)), 'ORDER_LINEAGE_INVALID');
  projected(o.updated_at, r.retrievedAt);
  check(ns(o.created_at) >= ns(record.createdAt) && ns(o.created_at) <= ns(o.updated_at), 'ORDER_TIMESTAMP_INVALID');
  const status = ['new', 'accepted'].includes(o.status) ? 'accepted' : o.status;
  check(['accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired'].includes(status), 'ORDER_STATUS_INVALID');
  const filled = decimal(o.filled_qty, true), full = compare(decimalRatio(filled), decimalRatio(record.qty));
  check(full <= 0 && (status !== 'filled' || full === 0)
    && (status !== 'partially_filled' || (filled !== '0' && full < 0))
    && (!['accepted', 'rejected'].includes(status) || filled === '0'), 'ORDER_FILL_INVALID');
  if (filled !== '0') { decimal(o.filled_avg_price); projected(o.filled_at, r.retrievedAt); }
  return freeze({ accountSha256: scope.accountSha256, assetId: o.asset_id, clientOrderId: o.client_order_id,
    brokerOrderId: o.id, brokerStatus: status, filledQty: filled, responseSha256: r.responseSha256 });
}

export function mapPostcheckEvidence({ scope, receipts, bindings, clock, calendar }) {
  const result = { evidenceMode: 'PAPER_OBSERVED', accountSha256: scope.accountSha256, sourceSha256: scope.sourceSha256,
    sourceBindingsSha256: bindings.proofSha256,
    complete: false, observations: {} };
  // A later read failure must not discard the first lookup's independently verified fill.
  for (const r of receipts) {
    try { result.observations[r.group] = interval(r, clock.now()); }
    catch { result.complete = false; }
  }
  try {
    result.portfolio = positions(receipt(receipts, 'positions', clock.now()));
    result.openOrders = noOrders(receipt(receipts, 'orders', clock.now()));
    result.clock = clockEvidence(receipt(receipts, 'clock', clock.now()), calendar, scope, bindings, clock.now());
    result.complete = ['lookup', 'positions', 'orders', 'clock'].every(g => result.observations[g]);
  } catch { result.complete = false; }
  return seal(result);
}
