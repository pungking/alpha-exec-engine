import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { managementRecord, at, hash } from './fixtures/scoped-closeout.mjs';
import { operationalFixture } from './fixtures/scoped-paper-adapter.mjs';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';
import * as stores from './lib/scoped-closeout-storage.mjs';
import * as evidence from './lib/scoped-paper-evidence.mjs';

assert.equal(typeof stores.withScopedObservationStores, 'function', 'observation-only reopen must exist');
assert.equal(typeof evidence.bindScopedObservationAccount, 'function', 'same-transport account binding must exist');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = async dir => ({ orderLedger: sha(await fs.readFile(path.join(dir, 'order-ledger.json'))),
  orderIdempotency: sha(await fs.readFile(path.join(dir, 'order-idempotency.json'))) });
const read = async (dir, name = 'order-ledger.json') => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
let checks = 0;
const f = operationalFixture();
const transport = () => createScopedPaperTransport({ credentials: { key: 'fixture-key', secret: 'fixture-secret' },
  fetchImpl: f.fetchImpl, clock: f.clock, deadlineMs: 300000 });
const t = transport();
const accountReceipt = await t.request({ group: 'account', phase: 'account', routeInput: {} });
const bind = (receipt = accountReceipt, current = t, scope = f.input) => evidence.bindScopedObservationAccount({
  scope, bindings: f.config.accountBinding, transport: current, receipt, clock: f.clock });
const accountBinding = bind();
assert.throws(() => bind(structuredClone(accountReceipt)), /RECEIPT|TRANSPORT/);
assert.throws(() => bind(accountReceipt, transport()), /TRANSPORT/);
assert.throws(() => bind(accountReceipt, t, { ...f.input, accountSha256: hash('different-account') }), /ACCOUNT/);
checks += 3;

async function seed() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-observer-fixture-')));
  await fs.chmod(directory, 0o700);
  await fs.writeFile(path.join(directory, 'order-ledger.json'), JSON.stringify({ orders: {}, updatedAt: '', extension: 'preserved' }), { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'order-idempotency.json'), JSON.stringify({ orders: {}, releases: [], updatedAt: '', extension: 'preserved' }), { mode: 0o600 });
  const preWriteHashes = await hashes(directory), attemptId = f.input.attemptId;
  await stores.withScopedStores({ directory, expectedHashes: preWriteHashes, attemptId }, async ctx => {
    const records = Array.from({ length: 5 }, (_, i) => ({ ...managementRecord(i), accountSha256: f.input.accountSha256, preWriteHashes }));
    await stores.reserveScopedExits(ctx, records);
    const key = records[0].exitIdempotencyKey;
    await stores.recordScopedAttempt(ctx, key, hash('fixture-request'), { at, limitPrice: '99.9', evidenceSha256: hash('fixture-evidence') });
    const attempted = (await read(directory)).orders[key];
    const stopped = { ...attempted, submissionPhase: 'STOPPED', history: [...attempted.history,
      { at, phase: 'STOPPED', evidenceSha256: attempted.observedEvidenceSha256, brokerStatus: null, filledQty: '0' }] };
    await stores.recordScopedObservation(ctx, key, stopped);
  });
  return { directory, attemptId, expectedHashes: await hashes(directory), authoritySha256: hash(['fixture-observation-authority', directory]) };
}
const options = await seed();
try {
  const before = await read(options.directory), key = f.input.terms.targets[0].exitIdempotencyKey;
  const old = before.orders[key], at2 = '2026-10-09T15:00:00.100Z';
  const filled = { ...old, brokerOrderId: 'fixture-broker-order', brokerStatus: 'filled', filledQty: old.qty,
    updatedAt: at2, observedEvidenceSha256: hash('fixture-filled'), history: [...old.history,
      { at: at2, phase: 'STOPPED', evidenceSha256: hash('fixture-filled'), brokerStatus: 'filled', filledQty: old.qty }] };
  const backupDir = path.join(options.directory, `.scoped-closeout-${options.attemptId}`);
  const backup = await fs.readFile(path.join(backupDir, 'order-ledger.json'));
  await stores.withScopedObservationStores(options, async ctx => {
    assert.ok((await fs.stat(path.join(backupDir, `observation-${options.authoritySha256}.json`))).isFile());
    assert.deepEqual(await hashes(options.directory), options.expectedHashes, 'claim does not alter order stores');
    await assert.rejects(stores.reserveScopedExits(ctx, Object.values(before.orders)), /OBSERVATION_ONLY/);
    await assert.rejects(stores.recordScopedAttempt(ctx, key, hash('retry'), { at: at2 }), /OBSERVATION_ONLY/);
    await assert.rejects(stores.recordScopedObservation(ctx, key, filled), /ACCOUNT_BINDING/);
    await assert.rejects(stores.recordScopedObservation(ctx, key, filled, structuredClone(accountBinding)), /ACCOUNT_BINDING/);
    assert.deepEqual(await hashes(options.directory), options.expectedHashes);
    const receipt = await stores.recordScopedObservation(ctx, key, filled, accountBinding);
    assert.deepEqual(await hashes(options.directory), receipt.storeHashes);
    const same = await stores.recordScopedObservation(ctx, key, filled, accountBinding);
    assert.equal(same.unchanged, true); assert.deepEqual(same.storeHashes, receipt.storeHashes);
    checks += 9;
  });
  assert.equal((await read(options.directory)).orders[key].submissionPhase, 'STOPPED');
  assert.equal((await read(options.directory)).orders[key].realizedPnlVerified, false);
  assert.deepEqual((await read(options.directory)).orders, (await read(options.directory, 'order-idempotency.json')).orders);
  assert.deepEqual(await fs.readFile(path.join(backupDir, 'order-ledger.json')), backup);
  const currentHashes = await hashes(options.directory);
  await assert.rejects(stores.withScopedObservationStores({ ...options, expectedHashes: currentHashes }, () => {
    assert.fail('same authority must not reach credentials/network callback');
  }), /AUTHORITY_USED/);
  assert.deepEqual(await hashes(options.directory), currentHashes); checks += 6;
} finally { await fs.rm(options.directory, { recursive: true, force: true }); }

for (const fault of ['paired-mismatch', 'hash-drift', 'wrong-attempt', 'missing-attempt', 'backup-hash-drift', 'symlink-attempt',
  'world-readable-attempt', 'stale-fence', 'wrong-account-binding', 'history-full', 'authority-replay-no-write']) {
  const o = await seed();
  try {
    const attempt = path.join(o.directory, `.scoped-closeout-${o.attemptId}`);
    if (fault === 'paired-mismatch') {
      const d = await read(o.directory, 'order-idempotency.json'); delete d.orders[f.input.terms.targets[4].exitIdempotencyKey];
      await fs.writeFile(path.join(o.directory, 'order-idempotency.json'), JSON.stringify(d)); o.expectedHashes = await hashes(o.directory);
    }
    if (fault === 'hash-drift') o.expectedHashes.orderLedger = hash('changed');
    if (fault === 'wrong-attempt') o.attemptId = 'different';
    if (fault === 'missing-attempt') await fs.rename(attempt, `${attempt}-preserved`);
    if (fault === 'backup-hash-drift') await fs.appendFile(path.join(attempt, 'order-ledger.json'), ' ');
    if (fault === 'symlink-attempt') { await fs.rename(attempt, `${attempt}-preserved`); await fs.symlink(`${attempt}-preserved`, attempt); }
    if (fault === 'world-readable-attempt') await fs.chmod(attempt, 0o755);
    if (fault === 'stale-fence') await fs.writeFile(path.join(o.directory, '.scoped-closeout.lock'), 'preserved', { mode: 0o600 });
    const oldHashes = await hashes(o.directory);
    if (fault === 'authority-replay-no-write') {
      await stores.withScopedObservationStores(o, async () => {});
      await assert.rejects(stores.withScopedObservationStores(o, () => assert.fail('authority replay admitted')), /AUTHORITY_USED/);
    } else if (fault === 'wrong-account-binding' || fault === 'history-full') {
      await stores.withScopedObservationStores(o, async ctx => {
        const old = (await read(o.directory)).orders[f.input.terms.targets[0].exitIdempotencyKey];
        const next = { ...old, history: [...old.history, old.history.at(-1)] };
        if (fault === 'history-full') next.history = [...old.history, ...Array(14).fill(old.history.at(-1))];
        await assert.rejects(stores.recordScopedObservation(ctx, old.exitIdempotencyKey, next,
          fault === 'wrong-account-binding' ? {} : accountBinding), /SCOPED_STORE_/);
      });
    } else await assert.rejects(stores.withScopedObservationStores(o, () => assert.fail('invalid observer opened')), /SCOPED_STORE_/);
    assert.deepEqual(await hashes(o.directory), oldHashes, 'rejection preserves both order stores'); checks += 2;
  } finally { await fs.rm(o.directory, { recursive: true, force: true }); }
}
for (const fault of ['claim-write', 'claim-sync', 'claim-readback', 'claim-link', 'claim-after-link', 'claim-unlink',
  'claim-directory-sync', 'claim-final-readback',
  ...['idempotency', 'ledger'].flatMap(file => ['write', 'sync', 'readback', 'rename', 'after-rename', 'directory-sync'].map(op => `${file}-${op}`))]) {
  const o = await seed(), attempt = path.join(o.directory, `.scoped-closeout-${o.attemptId}`);
  const backupHashes = await hashes(attempt), original = { open: fs.open, link: fs.link, unlink: fs.unlink, rename: fs.rename, readFile: fs.readFile };
  const handles = new Set(); let injected = false, renamed = false, callbackReached = false;
  const isClaim = file => String(file).startsWith(path.join(attempt, 'observation-'));
  const isStoreTemp = file => String(file).startsWith(path.join(o.directory, `order-${fault.split('-')[0]}.json.`));
  const isFaultTarget = file => fault.startsWith('claim-') ? isClaim(file) : isStoreTemp(file);
  const fail = () => { injected = true; throw Error('fixture-private-error-must-not-escape'); };
  fs.open = async (...args) => {
    const h = await original.open(...args), file = String(args[0]); handles.add(h);
    return new Proxy(h, { get(target, key) {
      if (key === 'close') return async () => { try { return await h.close(); } finally { handles.delete(h); } };
      if (key === 'writeFile' && fault.endsWith('-write') && isFaultTarget(file)) return async () => fail();
      if (key === 'sync' && ((fault.endsWith('-sync') && !fault.endsWith('directory-sync') && isFaultTarget(file))
        || (fault === 'claim-directory-sync' && file === attempt)
        || (fault.endsWith('directory-sync') && renamed && file === o.directory))) return async () => fail();
      if (key === 'readFile' && isClaim(file) && ((fault === 'claim-readback' && file.endsWith('.tmp'))
        || (fault === 'claim-final-readback' && file.endsWith('.json')))) return async () => { injected = true; return Buffer.from('invalid'); };
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    } });
  };
  fs.link = async (from, to) => {
    if (isClaim(from) && fault === 'claim-link') fail();
    await original.link(from, to);
    if (isClaim(from) && fault === 'claim-after-link') fail();
  };
  fs.unlink = async file => { if (isClaim(file) && fault === 'claim-unlink') fail(); return original.unlink(file); };
  fs.rename = async (from, to) => {
    if (isStoreTemp(from) && fault.endsWith('-rename') && !fault.endsWith('after-rename')) fail();
    await original.rename(from, to);
    if (isStoreTemp(from)) { renamed = true; if (fault.endsWith('after-rename')) fail(); }
  };
  fs.readFile = async (...args) => {
    if (isStoreTemp(args[0]) && fault.endsWith('readback')) { injected = true; return Buffer.from('invalid'); }
    return original.readFile(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(stores.withScopedObservationStores(o, async ctx => {
      callbackReached = true;
      const old = (await read(o.directory)).orders[f.input.terms.targets[0].exitIdempotencyKey];
      await stores.recordScopedObservation(ctx, old.exitIdempotencyKey, { ...old, history: [...old.history, old.history.at(-1)] }, accountBinding);
    }), /^Error: SCOPED_STORE_[A-Z_]+$/);
    assert.equal(injected, true, fault); assert.equal(handles.size, 0, fault);
    assert.equal(callbackReached, !fault.startsWith('claim-'), fault);
    assert.ok((await fs.stat(path.join(o.directory, '.scoped-closeout.lock'))).isFile());
    assert.deepEqual(await hashes(attempt), backupHashes, 'original backups stay unchanged');
    if (fault.startsWith('claim-')) assert.deepEqual(await hashes(o.directory), o.expectedHashes);
    checks += 6;
  } finally {
    Object.assign(fs, original); syncBuiltinESMExports();
    await Promise.all([...handles].map(h => h.close())); await fs.rm(o.directory, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-observation-storage', checks, actualBrokerRequests: 0, productionStateWrites: 0 }));
