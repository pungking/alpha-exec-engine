import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const mod = await import('./lib/scoped-paper-transport.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e;
});
assert.equal(typeof mod.createScopedPaperTransport, 'function', 'bounded transport must exist');
const make = (fetchImpl = async () => new Response('{}'), more = {}) => mod.createScopedPaperTransport({
  credentials: { key: 'fixture-key', secret: 'fixture-secret' }, fetchImpl,
  clock: { now: () => '2026-10-09T15:00:00.000Z', monotonicMs: () => 0 }, deadlineMs: 300000, ...more,
});
const req = { group: 'account', phase: 'account', routeInput: {} };
let n = 0;
const transport = make(async (url, options) => {
  n++; assert.equal(url, 'https://paper-api.alpaca.markets/v2/account');
  assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
  assert.ok(options.signal); return new Response('{}');
});
const receipt = await transport.request(req);
assert.equal(receipt.complete, true); assert.equal(n, 1);
assert.equal(receipt.responseSha256, createHash('sha256').update('{}').digest('hex'));
assert.equal(transport.counts().total, 1); assert.ok(Object.isFrozen(transport.counts()));
for (const bad of [{ ...req, url: 'https://api.alpaca.markets/v2/account' },
  { ...req, method: 'DELETE' }, { ...req, dispatcher: {} }, { ...req, routeInput: { url: 'private' } },
  { ...req, phase: 'unknown' }, { ...req, group: 'delete' },
  { group: 'assets', phase: 'initial', routeInput: { assetId: '../orders' } }]) {
  let calls = 0;
  const t = make(async () => { calls++; return new Response('{}'); });
  const r = await t.request(bad); assert.equal(calls, 0); assert.equal(r.complete, false);
}
for (const response of [new Response('private body', { status: 302 }), new Response('private body', { status: 403 }),
  new Response('not-json'), new Response(new Uint8Array([255]))]) {
  const t = make(async () => response), r = await t.request(req);
  assert.notEqual(r.error, null); assert.equal(r.data, null);
  assert.ok(!JSON.stringify(r).includes('private body')); assert.equal(t.counts().total, 1);
  await t.request(req); assert.equal(t.counts().total, 1, 'failure is sticky, never retried');
}
for (const size of [8388608, 8388609]) {
  const t = make(async () => new Response(' '.repeat(size - 2) + '{}'));
  const r = await t.request(req);
  assert.equal(r.complete, size === 8388608);
  if (size > 8388608) assert.equal(r.responseSha256, null);
}
const stalled = make(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } })));
const start = performance.now(); const timeout = await stalled.request(req);
assert.equal(timeout.error, 'REQUEST_TIMEOUT'); assert.equal(timeout.responseSha256, null);
assert.ok(performance.now() - start < 4000);
const budget = make();
for (let i = 0; i < 6; i++) await budget.request(req);
assert.equal((await budget.request(req)).error, 'REQUEST_BUDGET_EXCEEDED');
assert.equal(budget.counts().total, 6);
const boom = make(async () => { throw Error('fixture-secret private response'); });
assert.equal((await boom.request(req)).error, 'TRANSPORT_FAILURE');
let c = 0;
const backwards = make(undefined, { clock: { now: () => c++ ? '2026-10-09T14:59:59.000Z' : '2026-10-09T15:00:00.000Z', monotonicMs: () => 0 } });
assert.equal((await backwards.request(req)).error, 'CLOCK_INVALID');
let ticks = [0, 0, -1];
const monoBack = make(undefined, { clock: { now: () => '2026-10-09T15:00:00.000Z', monotonicMs: () => ticks.shift() ?? -1 } });
assert.equal((await monoBack.request(req)).error, 'CLOCK_INVALID');
const order = { symbol: 'FIXTURE', qty: '2', side: 'sell', type: 'limit', time_in_force: 'day',
  limit_price: '99.9', client_order_id: 'fixture-client', extended_hours: false };
let posts = 0;
const noPermit = make(async () => { posts++; return new Response('{}'); });
assert.equal((await noPermit.request({ group: 'submit', phase: 'submit', routeInput: {}, body: order })).error, 'SUBMIT_GATE_REQUIRED');
assert.equal(posts, 0);
const permitted = make(async (url, init) => {
  posts++; assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), order); return new Response('{}');
}, { beforeSubmit: async () => true });
assert.equal((await permitted.request({ group: 'submit', phase: 'submit', routeInput: {}, body: order })).complete, true);
assert.equal(posts, 1);
const submit = { group: 'submit', phase: 'submit', routeInput: {}, body: order };
for (const mode of ['stop-during-await', 'false', 'throw', 'promise', 'rejected-promise']) {
  let release, retired = false, calls = 0, wireChecks = 0;
  const beforeSubmit = () => new Promise(resolve => { release = resolve; });
  const beforeWire = body => {
    wireChecks++; assert.ok(Object.isFrozen(body)); assert.deepEqual(body, order);
    if (mode === 'throw') throw Error('private-stop-reason');
    if (mode === 'promise') return Promise.resolve(true);
    if (mode === 'rejected-promise') return Promise.reject(Error('private-stop-reason'));
    return mode !== 'false' && !retired;
  };
  const t = make(async () => { calls++; return new Response('{}'); }, { beforeSubmit, beforeWire });
  const pending = t.request(submit);
  if (mode === 'stop-during-await') retired = true;
  release(true);
  const r = await pending;
  assert.equal(r.error, 'SUBMIT_WIRE_GATE_REQUIRED', mode);
  assert.equal(calls, 0); assert.equal(wireChecks, 1); assert.equal(t.counts().submit, 0);
  assert.ok(!JSON.stringify(r).includes('private-stop-reason'));
  assert.equal((await t.request(req)).error, 'TRANSPORT_STOPPED');
  assert.equal(calls, 0, 'no attempt means no extra reconciliation GET');
  assert.equal(mod.isScopedPaperTransport(t, beforeSubmit, beforeWire), true);
  assert.equal(mod.isScopedPaperTransport(t, beforeSubmit, () => true), false);
  assert.equal(mod.isScopedPaperTransport(t, beforeSubmit), false, 'caller must bind the final guard too');
}
{
  let microtaskRan = false, calls = 0, allow = true;
  const beforeWire = () => { queueMicrotask(() => { microtaskRan = true; }); return allow; };
  const t = make(async (_url, options) => {
    calls++;
    if (options.method === 'POST') assert.equal(microtaskRan, false, 'no await between final gate and initiating fetch');
    return new Response('{}');
  }, { beforeSubmit: async () => true, beforeWire });
  assert.equal((await t.request(submit)).error, null); assert.equal(t.counts().submit, 1);
  allow = false;
  assert.equal((await t.request(submit)).error, 'SUBMIT_WIRE_GATE_REQUIRED'); assert.equal(t.counts().submit, 1);
  assert.equal((await t.request({ group: 'positions', phase: 'postcheck', routeInput: {} })).error, null);
  assert.equal(calls, 2, 'previous possible submission permits only bounded reconciliation');
}
for (const beforeWire of [true, null, 'PASS']) assert.throws(() => make(undefined, { beforeWire }), /TRANSPORT_CONFIG_INVALID/);
assert.throws(() => make(undefined, { credentials: {} }), /CREDENTIALS_MISSING/);
assert.equal(mod.isScopedPaperReceipt(receipt), true);
assert.equal(mod.isScopedPaperReceipt(structuredClone(receipt)), false);
assert.ok(Object.isFrozen(receipt.data));
assert.equal(typeof mod.scopedPaperReceiptTiming, 'function', 'remote reference needs same-transport monotonic provenance');
const timingClock = { now: () => '2026-10-09T15:00:00.000Z', monotonicMs: () => 10 };
const timed = make(undefined, { clock: timingClock });
const timedReceipt = await timed.request({ group: 'clock', phase: 'initial', routeInput: {} });
const timing = mod.scopedPaperReceiptTiming(timedReceipt, timed, timingClock);
assert.deepEqual(timing, { origin: 'https://paper-api.alpaca.markets', method: 'GET',
  dispatchedAt: timingClock.now(), sentMonotonicMs: 10, receivedMonotonicMs: 10 });
assert.equal(Object.isFrozen(timing), true);
assert.equal('sentMonotonicMs' in timedReceipt, false, 'provenance is private, not caller supplied JSON');
for (const args of [[structuredClone(timedReceipt), timed, timingClock], [timedReceipt, make(), timingClock],
  [timedReceipt, timed, { ...timingClock }]]) assert.throws(() => mod.scopedPaperReceiptTiming(...args), /RECEIPT_TIMING_UNBOUND/);
const oldNow = timingClock.now;
timingClock.now = () => '2026-10-09T15:00:01.000Z';
assert.throws(() => mod.scopedPaperReceiptTiming(timedReceipt, timed, timingClock), /RECEIPT_TIMING_UNBOUND/);
timingClock.now = oldNow;
const failedTiming = make(async () => new Response('{}', { status: 403 }), { clock: timingClock });
const failedReceipt = await failedTiming.request(req);
assert.throws(() => mod.scopedPaperReceiptTiming(failedReceipt, failedTiming, timingClock), /RECEIPT_TIMING_UNBOUND/);
const legacyClock = { now: () => '2026-10-09T15:00:00.000Z', monotonicMs: () => 0 };
const legacyTimed = make(async () => {
  legacyClock.now = () => '2026-10-09T15:00:00.001Z'; return new Response('{}');
}, { clock: legacyClock });
const legacyReceipt = await legacyTimed.request(req);
assert.equal(legacyReceipt.error, null, 'new clock provenance must not change the legacy receipt contract');
assert.throws(() => mod.scopedPaperReceiptTiming(legacyReceipt, legacyTimed, legacyClock), /RECEIPT_TIMING_UNBOUND/);
let gateRelease, concurrentPosts = 0;
const concurrent = make(async () => { concurrentPosts++; return new Response('{}'); }, {
  beforeSubmit: () => new Promise(resolve => { gateRelease = resolve; }),
});
const first = concurrent.request({ group: 'submit', phase: 'submit', routeInput: {}, body: order });
await concurrent.request(req); gateRelease(true); await first;
assert.equal(concurrentPosts, 0, 'concurrent request invalidates pending submit');
for (const [group, routeInput, ending] of [
  ['positions', {}, '/v2/positions'], ['orders', {}, '/v2/orders?status=open&limit=500&nested=true'],
  ['clock', {}, '/v2/clock'], ['assets', { assetId: 'fixture-id' }, '/v2/assets/fixture-id'],
  ['calendar', { session: '2026-10-09' }, '/v2/calendar?start=2026-10-09&end=2026-10-09'],
  ['lookup', { clientOrderId: 'fixture-client' }, '/v2/orders:by_client_order_id?client_order_id=fixture-client'],
  ['quotes', { symbols: ['FIXTURE'] }, '/v2/stocks/quotes/latest?symbols=FIXTURE&feed=sip&currency=USD'],
]) {
  const t = make(async url => { assert.equal(url, (group === 'quotes' ? 'https://data.alpaca.markets' : 'https://paper-api.alpaca.markets') + ending); return new Response('{}'); });
  assert.equal((await t.request({ group, phase: group === 'lookup' ? 'postcheck' : 'initial', routeInput })).complete, true);
}
for (const feed of ['sip', 'iex']) {
  const t = make(async url => {
    assert.equal(new URL(url).searchParams.get('feed'), feed);
    return new Response('{}');
  });
  const r = await t.request({ group: 'quotes', phase: 'initial', routeInput: { symbols: ['FIXTURE'], feed } });
  assert.equal(r.complete, true, 'explicit reviewed quote feed must reach the exact endpoint');
  assert.equal(r.feed, feed, 'sealed receipt must carry the request feed, not infer it from response values');
}
for (const feed of ['delayed_sip', 'toss', '', null, 'IEX', 'iex&feed=sip']) {
  const t = make(() => { assert.fail('invalid feed must not reach network'); });
  assert.equal((await t.request({ group: 'quotes', phase: 'initial', routeInput: { symbols: ['FIXTURE'], feed } })).error, 'ROUTE_INVALID');
  assert.equal(t.counts().total, 0);
}
let quoteCalls = 0;
const deniedIex = make(async url => { quoteCalls++; assert.equal(new URL(url).searchParams.get('feed'), 'iex'); return new Response('{}', { status: 403 }); });
await deniedIex.request({ group: 'quotes', phase: 'initial', routeInput: { symbols: ['FIXTURE'], feed: 'iex' } });
await deniedIex.request({ group: 'quotes', phase: 'initial', routeInput: { symbols: ['FIXTURE'], feed: 'sip' } });
assert.equal(quoteCalls, 1, 'failed IEX must not retry or fall back to SIP');
console.log('scoped PAPER transport: PASS (bounds, explicit feed, no fallback, sticky failure, submit gate, redaction)');
