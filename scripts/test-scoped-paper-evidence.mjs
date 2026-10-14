import assert from 'node:assert/strict';
import { paperFixture, initialReceipts, useIexProof, hash, at } from './fixtures/scoped-paper-adapter.mjs';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';
const m = await import('./lib/scoped-paper-evidence.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
assert.equal(typeof m.mapPreflightEvidence, 'function', 'observed mapper must exist');
const map = async f => m.mapPreflightEvidence({ scope: f.input, receipts: await initialReceipts(f), bindings: f.bindings, clock: f.clock, committed: {} });
let f = paperFixture(), snapshot = await map(f);
assert.equal(snapshot.evidenceMode, 'PAPER_OBSERVED'); assert.equal(snapshot.rows.length, 5);
assert.equal(snapshot.rows[0].bidSizeShares, '200'); assert.equal(snapshot.rows[0].bid, '100');
assert.equal(snapshot.rows[0].bidSizeShares, String(f.bodies.quotes.quotes.FIX0.bs), 'current SIP sizes are already shares');
for (const [unit, multiplier] of [['round_lots', '100'], ['round_lots', '1'], ['shares', '100']]) {
  const bad = paperFixture();
  Object.assign(bad.bindings.proof.assets[0], { quoteSizeUnit: unit, sharesPerUnit: multiplier });
  bad.bindings.proofSha256 = hash(bad.bindings.proof);
  assert.ok(m.assessSourceBindings(bad.bindings, bad.input, bad.clock).reasons.includes('QUOTE_SIZE_CONTRACT_UNVERIFIED'),
    'current SIP rejects obsolete lot interpretation even with a matching proof hash');
  await assert.rejects(() => map(bad), /SOURCE_BINDING_INVALID/);
}
assert.equal(snapshot.clock.open, '2026-10-09T13:30:00.000Z');
assert.equal(m.isObservedSnapshot(snapshot), true); assert.equal(m.isObservedSnapshot(structuredClone(snapshot)), false);
assert.equal(m.assessSourceBindings({}, f.input, f.clock).status, 'BLOCKED');
for (const mutate of [
  f => { f.bodies.positions[0].asset_id = 'wrong-id'; },
  f => { f.bodies.positions.push({ ...f.bodies.positions[0] }); },
  f => { f.bodies.positions[0].qty = '-2'; },
  f => { f.bodies.positions[0].side = 'short'; },
  f => { f.bodies.orders = Array.from({ length: 500 }, () => ({})); },
  f => { f.bodies.orders = [{ id: 'fixture-parent', legs: [{ id: 'fixture-child' }] }]; },
  f => { delete f.bodies.quotes.quotes.FIX0; },
  f => { f.bodies.quotes.quotes.FIX0.t = '2026-10-09T15:00:00.000000001Z'; },
  f => { f.bodies.quotes.quotes.FIX0.t = '2026-10-09T14:59:29Z'; },
  f => { f.bodies.clock.is_open = false; },
  f => { f.bodies.calendar[0].date = '2026-10-10'; },
  f => { f.bodies.calendar[0].close = '13:00'; },
  f => { f.bindings.rawAccountIdSha256 = hash('wrong'); },
]) {
  f = paperFixture(); mutate(f); await assert.rejects(() => map(f), /^Error: SCOPED_EVIDENCE_[A-Z_]+$/);
}
for (const [field, want] of [['feedEntitlementEvidenceSha256', 'FEED_ENTITLEMENT_UNVERIFIED'],
  ['clockAlignmentEvidenceSha256', 'CLOCK_ALIGNMENT_UNVERIFIED']]) {
  f = paperFixture(); delete f.bindings.proof[field]; f.bindings.proofSha256 = hash(f.bindings.proof);
  assert.ok(m.assessSourceBindings(f.bindings, f.input, f.clock).reasons.includes(want));
}
for (const [mutate, want] of [
  [f => { delete f.bindings.proof.assets[0].sizeEvidenceSha256; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].halt.status = 'UNKNOWN'; }, 'HALT_EVIDENCE_UNAVAILABLE'],
  [f => { f.bindings.proof.assets[0].risk.termsSha256 = hash('different'); }, 'RISK_EVIDENCE_INCOMPLETE'],
]) { f = paperFixture(); mutate(f); f.bindings.proofSha256 = hash(f.bindings.proof);
  assert.ok(m.assessSourceBindings(f.bindings, f.input, f.clock).reasons.includes(want)); }
f = paperFixture(); const receipts = await initialReceipts(f);
assert.throws(() => m.mapPreflightEvidence({ scope: f.input, receipts: structuredClone(receipts), bindings: f.bindings, clock: f.clock }), /RECEIPT/);
f = paperFixture(); f.assets[0].symbol = 'RENAMED'; f.bodies.positions[0].symbol = 'RENAMED';
f.bodies.quotes.quotes.RENAMED = f.bodies.quotes.quotes.FIX0; delete f.bodies.quotes.quotes.FIX0;
assert.equal((await map(f)).rows[0].symbol, 'RENAMED', 'exact immutable asset permits a proven rename');
f = paperFixture(); const originalFetch = f.fetchImpl;
f.fetchImpl = async (url, options) => {
  const r = await originalFetch(url, options);
  return new Response((await r.text()).replaceAll('"bp":100,', '"bp":100.000000000000001,'));
};
await assert.rejects(() => map(f), /RECEIPT_INVALID/, 'JSON numeric precision loss must not become a verified price');
f = paperFixture();
const record = { ...f.input.terms.targets[0], createdAt: at, limitPrice: '99.9', brokerOrderId: null };
const rawOrder = { id: 'fixture-order', client_order_id: record.clientOrderId, asset_id: record.assetId, symbol: 'FIX0',
  side: 'sell', type: 'limit', time_in_force: 'day', qty: '2', filled_qty: '2', filled_avg_price: '100',
  limit_price: '99.9', extended_hours: false, status: 'filled', created_at: at, updated_at: at, filled_at: at, legs: null };
const observed = async raw => {
  const t = createScopedPaperTransport({ credentials: { key: 'fixture-key', secret: 'fixture-secret' }, clock: f.clock,
    deadlineMs: 300000, fetchImpl: async () => new Response(JSON.stringify(raw)) });
  return t.request({ group: 'lookup', phase: 'postcheck', routeInput: { clientOrderId: record.clientOrderId } });
};
let lookup = await observed(rawOrder);
assert.equal(typeof m.mapOrderObservation, 'function');
assert.equal(m.mapOrderObservation({ scope: f.input, record, receipt: lookup }).brokerStatus, 'filled');
for (const change of [{ asset_id: 'wrong' }, { client_order_id: 'wrong' }, { side: 'buy' }, { qty: '3' },
  { type: 'market' }, { time_in_force: 'gtc' }, { status: 'pending_new' }, { filled_at: null },
  { updated_at: '2026-10-09T15:00:00.000000001Z' }, { created_at: '2026-10-09T14:59:00Z' }]) {
  const r = await observed({ ...rawOrder, ...change });
  assert.throws(() => m.mapOrderObservation({ scope: f.input, record, receipt: r }), /^Error: SCOPED_EVIDENCE_/);
}
const post = await initialReceipts(f);
const ps = m.mapPostcheckEvidence({ scope: f.input, receipts: [lookup, ...post.filter(r => ['positions', 'orders', 'clock'].includes(r.group))],
  bindings: f.bindings, clock: f.clock, calendar: f.bodies.calendar });
assert.equal(ps.complete, true);
const broken = m.mapPostcheckEvidence({ scope: f.input, receipts: [lookup], bindings: f.bindings, clock: f.clock, calendar: f.bodies.calendar });
assert.equal(broken.complete, false); assert.equal(broken.observations.lookup.responseSha256, lookup.responseSha256);
for (const [unit, multiplier, expected] of [['round_lots', '100', '20000'], ['round_lots', '1', '200'], ['shares', '1', '200']]) {
  const iex = useIexProof(paperFixture(), unit, multiplier);
  const first = await map(iex), second = await map(iex);
  assert.equal(first.rows[0].bidSizeShares, expected, 'only the reviewed asset-specific unit may determine liquidity');
  assert.equal(first.rows[0].feed, 'iex'); assert.equal(first.rows[0].quoteCoverage, 'IEX_SINGLE_EXCHANGE');
  assert.deepEqual(first, second);
  assert.ok(iex.calls.filter(c => c.url.includes('/quotes/')).every(c => new URL(c.url).searchParams.get('feed') === 'iex'));
}
for (const [mutate, reason] of [
  [f => { delete f.bindings.proof.acceptsNonNbboPaperEvidence; }, 'FEED_ENTITLEMENT_UNVERIFIED'],
  [f => { f.bindings.proof.quoteCoverage = 'NBBO'; }, 'FEED_ENTITLEMENT_UNVERIFIED'],
  [f => { f.input.environment = 'LIVE'; }, 'FEED_ENTITLEMENT_UNVERIFIED'],
  [f => { delete f.bindings.proof.feedEntitlementEvidenceSha256; }, 'FEED_ENTITLEMENT_UNVERIFIED'],
  [f => { delete f.bindings.proof.assets[0].sharesPerUnit; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].sharesPerUnit = '0.01'; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].quoteSizeFeed = 'sip'; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].quoteSizeBasis = 'CTA_UTP_NOTICE'; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { delete f.bindings.proof.assets[0].sizeEvidenceSha256; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].quoteSizeUnit = 'shares'; }, 'QUOTE_SIZE_CONTRACT_UNVERIFIED'],
  [f => { f.bindings.proof.assets[0].halt.status = 'UNKNOWN'; }, 'HALT_EVIDENCE_UNAVAILABLE'],
  [f => { f.bindings.proof.assets[0].halt.observedAt = '2026-10-09T14:59:29Z'; }, 'HALT_EVIDENCE_UNAVAILABLE'],
  [f => { f.bindings.proof.assets[0].risk.status = 'UNKNOWN'; }, 'RISK_EVIDENCE_INCOMPLETE'],
  [f => { delete f.bindings.proof.clockAlignmentEvidenceSha256; }, 'CLOCK_ALIGNMENT_UNVERIFIED'],
]) {
  const iex = useIexProof(paperFixture()); mutate(iex); iex.bindings.proofSha256 = hash(iex.bindings.proof);
  assert.ok(m.assessSourceBindings(iex.bindings, iex.input, iex.clock).reasons.includes(reason));
  await assert.rejects(() => map(iex), /SOURCE_BINDING_INVALID/);
}
for (const mutate of [
  f => { f.bodies.quotes.quotes.FIX0.bx = 'Q'; }, f => { delete f.bodies.quotes.quotes.FIX0.ax; },
  f => { f.bodies.quotes.quotes.FIX0.bs = 0.5; }, f => { f.bodies.quotes.quotes.FIX0.t = null; },
  f => { f.bodies.quotes.quotes.FIX0.t = '2026-10-09T14:59:29Z'; },
  f => { f.bodies.quotes.quotes.FIX0.t = '2026-10-09T15:00:00.000000001Z'; },
]) { const iex = useIexProof(paperFixture()); mutate(iex); await assert.rejects(() => map(iex), /SCOPED_EVIDENCE_/); }
for (const feed of ['sip', 'iex']) {
  const bound = feed === 'iex' ? useIexProof(paperFixture()) : paperFixture();
  const wrong = feed === 'iex' ? paperFixture() : useIexProof(paperFixture());
  assert.throws(() => m.mapPreflightEvidence({ scope: bound.input, bindings: bound.bindings, clock: bound.clock,
    receipts: [] }), /RECEIPT/);
  const mismatched = await initialReceipts(wrong);
  assert.throws(() => m.mapPreflightEvidence({ scope: bound.input, bindings: bound.bindings, clock: bound.clock,
    receipts: mismatched }), /QUOTE_FEED_MISMATCH/, 'identical response data must not mask a different requested feed');
}
console.log('scoped PAPER evidence: PASS (feed-bound units, exact identity, precision, source/time, no synthetic promotion)');
