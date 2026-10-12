import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';
import { invocationFixture, initialReceipts, hash } from './fixtures/scoped-paper-adapter.mjs';
import { mapPreflightEvidence } from './lib/scoped-paper-evidence.mjs';
import * as controller from './lib/scoped-closeout-contract.mjs';
const adapter = await import('./lib/scoped-paper-adapter.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
assert.equal(typeof adapter.authorizeScopedPaperInvocation, 'function', 'explicit invocation gate must exist');
const cli = await import('./run-scoped-paper-closeout.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
assert.equal(typeof cli.main, 'function', 'safe entry point must exist');
const forbidden = { get approval() { throw Error('approval must not be read by default'); }, get transport() { throw Error('credentials/network factory accessed'); }, get notify() { throw Error('sender accessed'); } };
assert.equal((await cli.main([], forbidden)).status, 'CONFIGURATION_REQUIRED');
assert.equal((await cli.main(['--validate'], { ...{ config: invocationFixture().config }, ...{} })).status, 'PASS');
assert.equal((await cli.main(['--execute'], {})).status, 'STOPPED');
if (!process.argv.includes('--fixture-child')) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture-child'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', ALPHA_ENV: 'PAPER', READ_ONLY: 'false',
      EXEC_ENABLED: 'true', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' } });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  process.stdout.write(child.stdout);
} else {
  let f = invocationFixture();
  assert.equal(adapter.validateScopedPaperConfiguration(f.config).status, 'PASS');
  const capability = adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock });
  assert.throws(() => controller.validateObservedCloseoutInput(f.input, structuredClone(capability)), /AUTHORITY/);
  const scope = controller.validateObservedCloseoutInput(f.input, capability);
  const snapshot = mapPreflightEvidence({ scope, receipts: await initialReceipts(f), bindings: f.bindings, clock: f.clock });
  assert.equal(controller.evaluateCloseoutSnapshot(scope, snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'READY_REPORT_ONLY');
  assert.equal(controller.evaluateCloseoutSnapshot(scope, structuredClone(snapshot), { now: f.clock.now(), elapsedMs: 0 }).status, 'BLOCKED');
  assert.throws(() => controller.validateScopedCloseoutInput(f.input), /MODE_INVALID/);
  for (const mutate of [
    f => { f.input.authority.validFrom = '2026-10-09T15:00:10.000Z'; f.input.authoritySha256 = hash(f.input.authority); f.approval.configSha256 = hash(f.config); },
    f => { f.approval.phrase = 'old approval'; }, f => { f.approval.configSha256 = hash('changed'); },
    f => { f.approval.expiresAt = '2026-10-09T14:00:00.000Z'; },
    f => { f.config.writerExclusion = {}; },
    f => { f.config.input.safeFlags.readOnly = true; },
    f => { f.config.bindings.proof.feed = 'iex'; },
    f => { f.config.url = 'https://api.alpaca.markets'; },
  ]) { f = invocationFixture(); mutate(f);
    assert.throws(() => adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock }), /^Error: SCOPED_CLOSEOUT_/); }
  for (const [key, value] of [['READ_ONLY', 'true'], ['EXEC_ENABLED', 'false'], ['ALPHA_ENV', 'LIVE'],
    ['LIVE_ORDER_SUBMIT_ENABLED', 'true'], ['ALPACA_BASE_URL', 'https://api.alpaca.markets'], ['GUARD_EXECUTE_FLATTEN', 'true']]) {
    const old = process.env[key]; process.env[key] = value; f = invocationFixture();
    assert.throws(() => adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock }), /FLAGS|ORIGIN/);
    if (old === undefined) delete process.env[key]; else process.env[key] = old;
  }
  console.log('scoped PAPER invocation gate: PASS (actual process flags, direct authority, observed v2, v1 invariance)');
  assert.equal(typeof adapter.runScopedPaperCloseout, 'function', 'durable runner must exist');
  const sha = b => createHash('sha256').update(b).digest('hex');
  async function scenario(mode = 'success') {
    const f = invocationFixture();
    const wantsNotify = ['notifySuccess', 'notifyFailure', 'notifyNoAuthority', 'notifyHang'].includes(mode);
    let sends = 0, sendSignal;
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-adapter-fixture-')));
    await fs.chmod(directory, 0o700); let posts = 0, gets = 0; const orders = [];
    const read = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    try {
      f.config.directory = directory;
      if (mode === 'futureAuthority') { f.input.authority.validFrom = '2026-10-09T15:00:10.000Z'; f.input.authoritySha256 = hash(f.input.authority); }
      if (mode === 'obsoleteQuoteUnits') {
        Object.assign(f.bindings.proof.assets[0], { quoteSizeUnit: 'round_lots', sharesPerUnit: '100' });
        f.bindings.proofSha256 = hash(f.bindings.proof);
      }
      if (['equivalentQty', 'quantityDrift'].includes(mode)) {
        for (const t of [...f.input.terms.targets, ...f.input.terms.portfolio]) t.qty = '2.0';
        f.input.termsSha256 = hash(f.input.terms);
        for (const a of f.bindings.proof.assets) a.risk.termsSha256 = f.input.termsSha256;
        f.bindings.proofSha256 = hash(f.bindings.proof);
        if (mode === 'quantityDrift') f.bodies.positions[0].qty = '2.000000001';
      }
      for (const [key, name, value] of [['orderLedger', 'order-ledger.json', { orders: {}, updatedAt: '', preservedExtension: 'unchanged' }],
        ['orderIdempotency', 'order-idempotency.json', { orders: {}, releases: [], updatedAt: '', preservedExtension: 'unchanged' }]]) {
        const bytes = JSON.stringify(value); await fs.writeFile(path.join(directory, name), bytes, { mode: 0o600 });
        f.input.preWriteHashes[key] = sha(bytes);
      }
      const source = { schemaVersion: 'scoped-paper-source-v1', accountSha256: f.input.accountSha256,
        termsSha256: f.input.termsSha256, preWriteHashes: f.input.preWriteHashes, targets: structuredClone(f.input.terms.targets) };
      const sourceBytes = JSON.stringify(source);
      f.config.sourceFile = { path: path.join(directory, 'source.json'), sha256: sha(sourceBytes) };
      f.input.sourceSha256 = f.config.sourceFile.sha256;
      await fs.writeFile(f.config.sourceFile.path, sourceBytes, { mode: 0o600 });
      f.config.codeFiles = await Promise.all(adapter.SCOPED_PAPER_REVIEWED_FILES.map(async p => ({ path: p, sha256: sha(await fs.readFile(p)) })));
      if (wantsNotify && mode !== 'notifyNoAuthority') f.config.notifications = { destinationSha256: hash('private-route'), sourceRunId: '123', headSha: 'a'.repeat(40) };
      f.input.codeSha256 = hash(f.config.codeFiles); f.approval.configSha256 = hash(f.config);
      if (mode === 'badSourceHash') await fs.appendFile(f.config.sourceFile.path, ' ');
      if (mode === 'sourceIdentityMismatch') {
        source.targets[0].originalIdentitySha256 = hash('wrong-original');
        const bytes = JSON.stringify(source); await fs.writeFile(f.config.sourceFile.path, bytes);
        f.config.sourceFile.sha256 = f.input.sourceSha256 = sha(bytes); f.approval.configSha256 = hash(f.config);
      }
      if (mode === 'locked') await fs.writeFile(path.join(directory, '.scoped-closeout.lock'), 'fixture-other-owner', { mode: 0o600 });
      if (mode === 'accountMismatch') f.bodies.account.id = 'wrong-account';
      if (mode === 'openOrder') f.bodies.orders = [{ id: 'fixture-open-child', asset_id: f.assets[0].id }];
      let advanced = false;
      const clock = mode === 'stale' ? { ...f.clock, now: () => advanced ? '2026-10-09T15:00:31.000Z' : f.clock.now() } : f.clock;
      const fakeFetch = async (url, init) => {
        if (init.method === 'POST') {
          posts++;
          if (f.config.notifications) { const receipt = await read(`.scoped-closeout-${f.input.attemptId}/notifications.json`); assert.equal(receipt.lastDelivery, 'BASELINED'); }
          const body = JSON.parse(init.body), i = posts - 1, target = f.input.terms.targets[i];
          for (const name of ['order-ledger.json', 'order-idempotency.json']) {
            const r = (await read(name)).orders[target.exitIdempotencyKey];
            assert.equal(r.submissionPhase, 'ATTEMPTED'); assert.ok(r.requestSha256); assert.equal(r.brokerSubmitAllowed, false);
          }
          const partial = mode === 'partial', rejected = mode === 'rejected';
          const result = { ...body, id: `fixture-broker-${i}`, asset_id: target.assetId, status: partial ? 'partially_filled' : rejected ? 'rejected' : 'filled',
            filled_qty: partial ? '0.5' : rejected ? '0' : '2', filled_avg_price: rejected ? null : '100', created_at: f.clock.now(),
            updated_at: f.clock.now(), filled_at: rejected ? null : f.clock.now(), legs: null };
          orders.push(result);
          if (!partial && !rejected) f.bodies.positions = f.bodies.positions.filter(p => p.asset_id !== target.assetId);
          if (['submitTimeout', 'lookup404'].includes(mode)) throw Error('fixture-private-body');
          return new Response(JSON.stringify(result));
        }
        gets++;
        if (mode === 'lookup404' && url.includes('orders:by_client_order_id')) return new Response('{}', { status: 404 });
        if (mode === 'mutateCaller' && gets === 1) f.config.input.sourceSha256 = hash('caller-mutated');
        if (mode === 'sourceDrift' && gets === 17) await fs.appendFile(f.config.sourceFile.path, ' ');
        if (mode === 'flagsDrift' && gets === 17) process.env.READ_ONLY = 'true';
        if (url.includes('orders:by_client_order_id')) return new Response(JSON.stringify(orders.at(-1)));
        if (mode === 'postReadFailure' && posts && url.endsWith('/positions')) return new Response('{}', { status: 500 });
        if (mode === 'stateDrift' && gets === 17) await fs.appendFile(path.join(directory, 'order-ledger.json'), ' ');
        if (mode === 'stale' && gets === 17) advanced = true;
        return f.fetchImpl(url, init);
      };
      const transport = options => mode === 'forgedTransport' ? { request: async () => { throw Error('must-not-call'); }, counts: () => ({}) } : createScopedPaperTransport({ ...options, credentials: { key: 'fixture-key', secret: 'fixture-secret' }, fetchImpl: fakeFetch });
      let timeout, rejectDeadline; const stalled = new Promise((_, reject) => { rejectDeadline = reject; });
      const notify = wantsNotify ? { destinationSha256: hash('private-route'), send: async (message, { signal } = {}) => { sends++; sendSignal = signal; if (mode === 'notifyHang') { timeout = setTimeout(() => rejectDeadline(Error('runner notification deadline missing')), 4000); return new Promise(() => {}); } assert.ok(message.includes('제한관리 범위')); if (mode === 'notifyFailure') throw Error('fixture-private'); return { ok: true }; } } : undefined;
      const result = await Promise.race([adapter.runScopedPaperCloseout({ config: f.config, approval: f.approval, transport, clock, notify }),
        stalled]).finally(() => clearTimeout(timeout));
      process.env.READ_ONLY = 'false';
      const success = ['success', 'mutateCaller', 'notifySuccess', 'notifyFailure', 'notifyNoAuthority', 'notifyHang', 'equivalentQty'].includes(mode);
      assert.equal(result.status, success ? 'COMPLETE' : 'STOPPED', JSON.stringify({ mode, result }));
      assert.equal(posts, success ? 5 : ['partial', 'rejected', 'submitTimeout', 'postReadFailure', 'lookup404'].includes(mode) ? 1 : 0);
      assert.equal(sends, ['notifySuccess', 'notifyFailure', 'notifyHang'].includes(mode) ? 1 : 0);
      if (mode === 'notifySuccess') assert.equal(result.notificationDelivery.status, 'DELIVERED');
      if (mode === 'notifyHang') { assert.equal(sendSignal?.aborted, true); assert.equal(result.notificationDelivery.status, 'DELIVERY_UNCERTAIN'); }
      if (['futureAuthority', 'obsoleteQuoteUnits'].includes(mode)) { assert.equal(result.actualStateWriteAttempted, false); assert.equal(result.requestCounts.total, 0); assert.ok(!(await fs.readdir(directory)).some(n => n.startsWith('.scoped-closeout'))); }
      if (mode === 'notifyFailure') assert.equal(result.notificationDelivery.status, 'DELIVERY_UNCERTAIN');
      assert.ok(gets <= 61); assert.equal(result.requestCounts.submit, posts); assert.equal(result.requestCounts.total, gets + posts);
      assert.equal(result.originalHistoryNormalized, false); assert.equal(result.realizedPnlVerified, false);
      for (const name of ['order-ledger.json', 'order-idempotency.json']) {
        const store = await read(name); assert.equal(store.preservedExtension, 'unchanged');
        if (success) assert.equal(Object.values(store.orders).filter(r => r.submissionPhase === 'FLAT_RECONCILED').length, 5);
        if (['postReadFailure', 'submitTimeout'].includes(mode)) assert.equal(store.orders[f.input.terms.targets[0].exitIdempotencyKey].filledQty, '2');
        if (mode === 'lookup404') {
          const r = store.orders[f.input.terms.targets[0].exitIdempotencyKey];
          assert.equal(r.submissionPhase, 'STOPPED'); assert.equal(r.brokerStatus, null); assert.equal(r.filledQty, '0');
          assert.ok(r.history.some(e => e.phase === 'ATTEMPTED'));
        }
        for (const r of Object.values(store.orders)) assert.equal(r.realizedPnlVerified, false);
      }
      const before = gets + posts;
      const repeated = await adapter.runScopedPaperCloseout({ config: f.config, approval: f.approval, transport, clock });
      assert.equal(repeated.status, 'STOPPED'); assert.equal(gets + posts, before, 'same attempt never retries');
      if (mode === 'accountMismatch') {
        f.input.attemptId = 'another-attempt'; f.approval.configSha256 = hash(f.config);
        await adapter.runScopedPaperCloseout({ config: f.config, approval: f.approval, transport, clock });
        assert.equal(gets + posts, before, 'new ID must not bypass a failed preflight attempt');
      }
      assert.ok(!JSON.stringify(result).includes('fixture-broker-') && !JSON.stringify(result).includes('FIX0'));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  for (const mode of ['success', 'partial', 'rejected', 'submitTimeout', 'postReadFailure', 'accountMismatch', 'openOrder',
    'badSourceHash', 'sourceIdentityMismatch', 'stateDrift', 'stale', 'sourceDrift', 'flagsDrift', 'locked', 'lookup404', 'forgedTransport', 'mutateCaller', 'notifySuccess', 'notifyFailure', 'notifyNoAuthority', 'futureAuthority', 'equivalentQty', 'quantityDrift', 'notifyHang', 'obsoleteQuoteUnits']) await scenario(mode);
  console.log('scoped PAPER runner: PASS (REST-shaped fake transport, durable private stores, failure/replay matrix)');
}
