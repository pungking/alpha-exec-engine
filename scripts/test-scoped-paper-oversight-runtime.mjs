import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { operationalFixture, hash, at } from './fixtures/scoped-paper-adapter.mjs';
import { managementRecord } from './fixtures/scoped-closeout.mjs';
import * as transportModule from './lib/scoped-paper-transport.mjs';
import * as evidence from './lib/scoped-paper-evidence.mjs';
import * as stores from './lib/scoped-closeout-storage.mjs';

assert.equal(typeof transportModule.createScopedPaperObservationTransport, 'function', 'observation-only bounded transport must exist');
assert.equal(typeof evidence.mapOversightObservation, 'function', 'fresh query must not fabricate a fresh order event');
const oversight = await import('./lib/scoped-paper-oversight.mjs');
assert.equal(typeof oversight.runScopedPaperOversight, 'function');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = async directory => Object.fromEntries(await Promise.all([['orderLedger', 'order-ledger.json'], ['orderIdempotency', 'order-idempotency.json']]
  .map(async ([key, file]) => [key, sha(await fs.readFile(path.join(directory, file)))])));
const read = async directory => JSON.parse(await fs.readFile(path.join(directory, 'order-ledger.json'), 'utf8'));
const order = (f, r, status = 'accepted', filled = '0') => ({ id: 'fixture-observed-order', client_order_id: r.clientOrderId,
  asset_id: r.assetId, symbol: f.assets[0].symbol, side: 'sell', type: 'limit', time_in_force: 'day', extended_hours: false,
  qty: r.qty, limit_price: r.limitPrice, filled_qty: filled, filled_avg_price: filled === '0' ? null : '100',
  created_at: at, updated_at: at, filled_at: filled === '0' ? null : at, status, legs: [] });
let checks = 0;

function fixture() {
  const f = operationalFixture(); let ms = 60000;
  f.clock = { now: () => new Date(Date.parse(at) + ms).toISOString(), monotonicMs: () => ms };
  f.advance = n => { ms += n; };
  f.record = { ...managementRecord(), accountSha256: f.input.accountSha256, requestSha256: hash('request'), submissionPhase: 'STOPPED' };
  f.bodies.lookup = order(f, f.record); f.bodies.clock.timestamp = f.clock.now();
  f.transport = (beforeRead = () => true, fetchImpl = f.fetchImpl) => transportModule.createScopedPaperObservationTransport({
    credentials: { key: 'fixture-key', secret: 'fixture-secret' }, fetchImpl, clock: f.clock,
    oversight: f.config.oversight, beforeRead });
  return f;
}
let f = fixture(), t = f.transport();
const r = await t.request({ group: 'account', phase: 'account', routeInput: {} });
const account = evidence.bindScopedObservationAccount({ scope: f.input, receipt: r, bindings: f.config.accountBinding, transport: t, clock: f.clock });
const lookup = () => t.request({ group: 'lookup', phase: 'observation', routeInput: { clientOrderId: f.record.clientOrderId } });
const map = (receipt, previous) => evidence.mapOversightObservation({ scope: f.input, record: f.record, receipt,
  accountBinding: account, transport: t, clock: f.clock, previous });
const old = await lookup(), first = map(old);
assert.equal(first.brokerStatus, 'accepted'); assert.equal(first.eventTimestamps.updatedAt, at);
assert.equal(first.queryInterval.retrievedAt, f.clock.now());
assert.throws(() => evidence.mapOrderObservation({ scope: f.input, record: f.record, receipt: old }), /STALE_OR_FUTURE/);
assert.throws(() => map(structuredClone(old)), /RECEIPT|TRANSPORT/);
assert.throws(() => evidence.mapOversightObservation({ scope: f.input, record: f.record, receipt: old,
  accountBinding: structuredClone(account), transport: t, clock: f.clock }), /ACCOUNT/); checks += 6;
for (const mutate of [o => { o.updated_at = '2026-10-09T16:00:00Z'; }, o => { o.created_at = '2026-10-09T14:00:00Z'; },
  o => { o.asset_id = 'other'; }, o => { o.qty = '3'; }, o => { o.id = 'different'; }]) {
  f.bodies.lookup = order(f, f.record); mutate(f.bodies.lookup);
  const bad = await lookup(); assert.throws(() => map(bad, first), /SCOPED_EVIDENCE_/); checks++;
}
f.bodies.lookup = order(f, f.record); f.bodies.lookup.updated_at = '2026-10-09T15:00:30.000Z';
const advanced = map(await lookup(), first);
f.bodies.lookup.updated_at = at;
const regressed = await lookup(); assert.throws(() => map(regressed, advanced), /TIMESTAMP/); checks++;

for (const request of [{ group: 'submit', phase: 'submit', routeInput: {}, body: { symbol: 'FIX0', qty: '1', side: 'sell', type: 'limit',
  time_in_force: 'day', limit_price: '100', client_order_id: 'fixture-attempt', extended_hours: false } },
{ group: 'quotes', phase: 'initial', routeInput: { symbols: ['FIX0'], feed: 'iex' } },
{ group: 'account', phase: 'account', routeInput: {}, method: 'DELETE' }]) {
  const v = fixture(), transport = v.transport();
  assert.notEqual((await transport.request(request)).error, null); assert.equal(v.calls.length, 0); checks += 2;
}
const capped = fixture(), capTransport = capped.transport();
await capTransport.request({ group: 'account', phase: 'account', routeInput: {} });
assert.equal((await capTransport.request({ group: 'account', phase: 'account', routeInput: {} })).error, 'REQUEST_BUDGET_EXCEEDED');
assert.equal(capped.calls.length, 1); checks += 2;
const lookupCap = fixture(), lookupTransport = lookupCap.transport();
for (let i = 0; i < 10; i++) assert.equal((await lookupTransport.request({ group: 'lookup', phase: 'observation',
  routeInput: { clientOrderId: lookupCap.record.clientOrderId } })).error, null);
assert.equal((await lookupTransport.request({ group: 'lookup', phase: 'observation', routeInput: { clientOrderId: lookupCap.record.clientOrderId } })).error,
  'REQUEST_BUDGET_EXCEEDED');
assert.equal(lookupCap.calls.length, 10); checks += 12;
assert.ok(transportModule.createScopedPaperTransport({ credentials: { key: 'fixture-key', secret: 'fixture-secret' },
  fetchImpl: capped.fetchImpl, clock: capped.clock, deadlineMs: 299999.5 })); checks++;
const responseClock = fixture(), responseTransport = responseClock.transport(() => true, async (...args) => {
  responseClock.advance(100); return responseClock.fetchImpl(...args);
});
await responseTransport.request({ group: 'account', phase: 'account', routeInput: {} });
responseClock.advance(-50);
assert.equal((await responseTransport.request({ group: 'clock', phase: 'observation', routeInput: {} })).error, 'CLOCK_INVALID');
assert.equal(responseClock.calls.length, 1, 'response completion is also a monotonic watermark'); checks += 2;

async function prepared() {
  const f = fixture(), directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-oversight-runtime-')));
  await fs.chmod(directory, 0o700);
  for (const file of ['order-ledger.json', 'order-idempotency.json']) await fs.writeFile(path.join(directory, file),
    JSON.stringify({ orders: {}, ...(file.includes('idempotency') ? { releases: [] } : {}), updatedAt: '' }), { mode: 0o600 });
  const preWriteHashes = await hashes(directory);
  Object.assign(f.input, { preWriteHashes }); f.config.directory = directory;
  await stores.withScopedStores({ directory, expectedHashes: preWriteHashes, attemptId: f.input.attemptId }, async ctx => {
    const rows = f.input.terms.targets.map((_, i) => ({ ...managementRecord(i), accountSha256: f.input.accountSha256,
      managementAuthoritySha256: f.input.authoritySha256, preWriteHashes }));
    await stores.reserveScopedExits(ctx, rows);
    await stores.recordScopedAttempt(ctx, rows[0].exitIdempotencyKey, hash('request'), { at, limitPrice: '99.9', evidenceSha256: hash('attempt') });
    const old = (await read(directory)).orders[rows[0].exitIdempotencyKey];
    await stores.recordScopedObservation(ctx, old.exitIdempotencyKey, { ...old, submissionPhase: 'STOPPED', history: [...old.history,
      { at, phase: 'STOPPED', evidenceSha256: old.observedEvidenceSha256, brokerStatus: null, filledQty: '0' }] });
  });
  const records = Object.values((await read(directory)).orders);
  const authority = { config: f.config, expectedHashes: await hashes(directory), recordsSha256: hash(records) };
  authority.approval = { kind: 'DIRECT_SCOPED_OBSERVATION_INVOCATION', phrase: 'AUTHORIZE PAPER SCOPED OUTCOME OBSERVATION ONE-SHOT',
    authoritySha256: hash(authority), approvedAt: f.clock.now() };
  f.bodies.lookup = order(f, records[0]);
  let factories = 0;
  const deps = { authority, records, clock: { ...f.clock, sleep: async n => { f.advance(n); f.bodies.clock.timestamp = f.clock.now(); } },
    observationTransport: ({ beforeRead }) => { factories++; return f.transport(beforeRead); } };
  return { f, directory, authority, records, deps, factories: () => factories };
}
for (const mode of ['accepted', 'partial-filled', 'long-window', 'filled-residual', 'canceled', 'unknown-lookup', 'wrong-account',
  'missing-approval', 'records-drift', 'read-failure', 'market-closed', 'expired-submit', 'manual-position-drift',
  'expired-observation', 'clock-rewind', 'lookup-notfound', 'fill-regression', 'protected-order', 'early-wakeup']) {
  const p = await prepared();
  try {
    let cycle = 0;
    const fetchBase = p.f.fetchImpl;
    p.f.fetchImpl = async (url, options) => {
      if (url.includes('orders:by_client_order_id')) {
        cycle++;
        if (mode === 'read-failure') { p.f.calls.push({ method: options.method }); throw Error('fixture-secret'); }
        if (mode === 'lookup-notfound') { p.f.calls.push({ method: options.method }); return new Response('{}', { status: 404 }); }
        if (mode === 'partial-filled' || mode === 'long-window' || mode === 'fill-regression') {
          const status = cycle === 1 ? 'partially_filled' : mode === 'fill-regression' ? 'accepted' : 'filled';
          p.f.bodies.lookup = order(p.f, p.records[0], status, cycle === 1 ? '1' : mode === 'fill-regression' ? '0' : '2');
          p.f.bodies.lookup.updated_at = p.f.clock.now(); p.f.bodies.lookup.filled_at = p.f.clock.now();
          p.f.bodies.positions = p.f.bodies.positions.filter(x => x.asset_id !== p.records[0].assetId);
          if (cycle === 1) p.f.bodies.positions.unshift({ ...p.f.bodies.positions[0], asset_id: p.records[0].assetId, symbol: 'FIX0', qty: '1' });
        }
      }
      const response = await fetchBase(url, options);
      if (mode === 'clock-rewind' && url.endsWith('/account')) p.f.advance(-100);
      return response;
    };
    if (mode === 'filled-residual') p.f.bodies.lookup = order(p.f, p.records[0], 'filled', '2');
    if (mode === 'canceled') p.f.bodies.lookup.status = 'canceled';
    if (mode === 'wrong-account') p.f.bodies.account.id = 'different-account';
    if (mode === 'missing-approval') delete p.authority.approval;
    if (mode === 'records-drift') p.deps.records = structuredClone(p.records).reverse();
    if (mode === 'market-closed') p.f.bodies.clock.is_open = false;
    if (mode === 'expired-observation') p.f.advance(300000);
    if (mode === 'protected-order') p.f.bodies.orders = [{ id: 'unscoped-protection', asset_id: p.records[0].assetId, legs: [{}] }];
    if (mode === 'manual-position-drift') p.f.bodies.positions.push({ asset_id: 'unscoped-asset', symbol: 'OTHER', asset_class: 'us_equity', side: 'long', qty: '1' });
    if (mode === 'early-wakeup') p.deps.clock.sleep = async () => {};
    if (mode === 'long-window') {
      p.f.config.oversight.intervalMs = 150000;
      const { approval, ...base } = p.authority; approval.authoritySha256 = hash(base);
    }
    if (mode === 'expired-submit') {
      p.f.advance(360000);
      p.f.bodies.clock.timestamp = p.f.clock.now();
      Object.assign(p.f.config.oversight, { validFrom: p.f.clock.now(), expiresAt: '2026-10-09T15:15:00.000Z', handoffDeadline: '2026-10-09T15:15:00.000Z' });
      p.f.config.writerExclusion.expiresAt = p.f.config.oversight.handoffDeadline;
      const { approval, ...base } = p.authority; approval.authoritySha256 = hash(base); approval.approvedAt = p.f.clock.now();
    }
    const result = await oversight.runScopedPaperOversight(p.deps);
    assert.equal(result.actualBrokerMutationAttempted, false); assert.equal(result.realizedPnlVerified, false);
    assert.ok(p.f.calls.every(c => c.method === 'GET')); assert.ok(p.f.calls.length <= 9);
    assert.equal(result.requestBudgetCompliant, true);
    if (['missing-approval', 'records-drift', 'expired-observation'].includes(mode)) { assert.equal(p.factories(), 0); assert.equal(p.f.calls.length, 0); }
    else if (mode === 'early-wakeup') {
      assert.deepEqual(result.reasons, ['SCOPED_ADAPTER_OBSERVATION_WAIT_INVALID']);
      assert.equal(p.f.calls.length, 5, 'an early wakeup cannot spend the next cycle budget');
    }
    else if (mode === 'wrong-account') assert.equal(p.f.calls.length, 1, 'bind real account before lookup');
    else if (mode === 'partial-filled' || mode === 'long-window') {
      assert.equal(result.status, 'ATTEMPTED_ORDERS_RECONCILED'); assert.equal(result.flatReconciledRows, 1);
      const current = (await read(p.directory)).orders[p.records[0].exitIdempotencyKey];
      assert.equal(current.submissionPhase, 'STOPPED'); assert.equal(current.filledQty, '2');
    } else assert.equal(result.status, 'UNRESOLVED_HANDOFF', mode);
    if (mode === 'accepted' || mode === 'expired-submit') {
      const current = (await read(p.directory)).orders[p.records[0].exitIdempotencyKey];
      assert.equal(current.history.length, 4, 'unchanged poll does not append history');
      const beforeCalls = p.f.calls.length;
      await oversight.runScopedPaperOversight(p.deps);
      assert.equal(p.f.calls.length, beforeCalls, 'replay never resets read budget');
    }
    assert.ok(!JSON.stringify(result).includes('fixture-asset')); assert.ok(!JSON.stringify(result).includes('fixture-secret')); checks += 9;
  } finally { await fs.rm(p.directory, { recursive: true, force: true }); }
}
const stalled = await prepared(); let watchdog, sleepSignal;
try {
  stalled.f.config.oversight.intervalMs = 1;
  const { approval, ...basis } = stalled.authority; approval.authoritySha256 = hash(basis);
  stalled.deps.clock.sleep = (_ms, { signal } = {}) => { sleepSignal = signal; return new Promise(() => {}); };
  const result = await Promise.race([oversight.runScopedPaperOversight(stalled.deps), new Promise(resolve => {
    watchdog = setTimeout(() => resolve({ status: 'TEST_TIMEOUT' }), 4500);
  })]);
  assert.equal(result.status, 'UNRESOLVED_HANDOFF', 'stalled sleep must not hold the writer indefinitely');
  assert.deepEqual(result.reasons, ['SCOPED_ADAPTER_OBSERVATION_WAIT_EXPIRED']);
  assert.equal(sleepSignal?.aborted, true); assert.equal(stalled.f.calls.length, 5); checks += 4;
} finally { clearTimeout(watchdog); await fs.rm(stalled.directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-paper-oversight-runtime', checks, actualBrokerRequests: 0, productionStateWrites: 0 }));
