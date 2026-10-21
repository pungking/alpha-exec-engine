import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managementRecord, hash, at } from './fixtures/scoped-closeout.mjs';
import { validateScopedManagementRecord } from '../dist/src/scoped-management-record.js';
import * as ledger from '../dist/src/order-ledger-storage.js';
import * as idem from '../dist/src/order-idempotency-storage.js';
import { withScopedStores, reserveScopedExits, recordScopedAttempt, recordScopedObservation } from './lib/scoped-closeout-storage.mjs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-stores-')); await fs.chmod(root, 0o700);
let checks = 0;
try {
  const r = managementRecord(), key = r.exitIdempotencyKey;
  assert.equal(validateScopedManagementRecord(key, r), true); checks++;
  for (const dangerous of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(validateScopedManagementRecord(dangerous, { ...r, exitIdempotencyKey: dangerous }), false); checks++;
  }
  const premature = { ...r, submissionPhase: 'ATTEMPTED', requestSha256: hash('request'), brokerOrderId: 'fixture-broker', brokerStatus: 'filled', filledQty: '2',
    history: [...r.history, { ...r.history[0], phase: 'ATTEMPTED', brokerStatus: 'filled', filledQty: '2' }] };
  assert.equal(validateScopedManagementRecord(key, premature), false); checks++;
  const verified = { ...premature, recordKind: 'SCOPED_MANAGEMENT_EXIT_V2', schemaVersion: 2, submissionPhase: 'STOPPED',
    brokerEventTimestamps: { createdAt: at, updatedAt: at, filledAt: at },
    history: [r.history[0], { ...r.history[0], phase: 'ATTEMPTED' },
      { ...r.history[0], phase: 'STOPPED', brokerStatus: 'filled', filledQty: '2' }] };
  assert.equal(validateScopedManagementRecord(key, verified), true); checks++;
  for (const patch of [{ schemaVersion: 1 }, { recordKind: 'SCOPED_MANAGEMENT_EXIT_V1' }, { brokerEventTimestamps: null },
    ...[{ updatedAt: '2026-02-30T00:00:00Z' }, { updatedAt: '2026-10-09T15:00:00.000000001Z' },
      { filledAt: null }, { filledAt: '2026-10-09T14:59:59Z' }, { createdAt: '2026-10-09T14:59:59Z' },
      { updatedAt: '2026-10-09T15:00:00.0000000001Z' }, { extra: true }]
      .map(change => ({ brokerEventTimestamps: { ...verified.brokerEventTimestamps, ...change } }))]) {
    assert.equal(validateScopedManagementRecord(key, { ...verified, ...patch }), false); checks++;
  }
  const missing = { ...verified }; delete missing.brokerEventTimestamps;
  assert.equal(validateScopedManagementRecord(key, missing), false); checks++;
  for (const patch of [{ firstSeenAt: at }, { side: 'buy' }, { stage6Hash: hash('s') },
    { originalOwnershipVerified: true }, { realizedPnlVerified: true }, { historicalEvidenceNormalized: true },
    { brokerSubmitAllowed: true }, { submissionPhase: 'FILLED' }, { filledQty: '3' },
    { brokerStatus: 'filled' }, { updatedAt: '2026-02-30T00:00:00.000Z' }, { history: [] },
    { history: [{ ...r.history[0], phase: 'ATTEMPTED' }] }]) {
    assert.equal(validateScopedManagementRecord(key, { ...r, ...patch }), false); checks++;
  }
  for (const [name, lib, load, save, old] of [
    ['order-ledger.json', ledger, 'loadScopedOrderLedgerState', 'saveScopedOrderLedgerState', 'loadOrderLedgerState'],
    ['order-idempotency.json', idem, 'loadScopedOrderIdempotencyState', 'saveScopedOrderIdempotencyState', 'loadOrderIdempotencyState'],
  ]) {
    const file = path.join(root, name);
    await assert.rejects(lib[load](file)); checks++;
    const initial = { orders: {}, updatedAt: '', preservedExtension: { nested: [1, 'unchanged'] }, ...(name.includes('idempotency') ? { releases: [] } : {}) };
    await fs.writeFile(file, JSON.stringify(initial), { mode: 0o600 });
    const state = await lib[load](file); state.orders[key] = r; state.updatedAt = at;
    await lib[save](file, state);
    assert.deepEqual((await lib[load](file)).preservedExtension, initial.preservedExtension);
    await assert.rejects(lib[old](file), /SCHEMA_INVALID/); checks += 2;
    state.orders[key] = verified; await lib[save](file, state);
    assert.deepEqual((await lib[load](file)).orders[key], verified);
    await assert.rejects(lib[old](file), /SCHEMA_INVALID/); checks += 2;
    const bytes = await fs.readFile(file);
    state.orders[key].realizedPnlVerified = true;
    await assert.rejects(lib[save](file, state), /SCHEMA_INVALID/);
    assert.deepEqual(await fs.readFile(file), bytes); checks += 2; state.orders[key].realizedPnlVerified = false;
    await fs.writeFile(file, '{broken'); await assert.rejects(lib[load](file)); checks++;
    assert.equal(await fs.readFile(file, 'utf8'), '{broken'); checks++;
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }

const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-coordinator-'))); await fs.chmod(directory, 0o700);
const sha = b => createHash('sha256').update(b).digest('hex');
try {
  const l = Buffer.from(JSON.stringify({ orders: {}, updatedAt: '', extension: 'preserved' }));
  const i = Buffer.from(JSON.stringify({ orders: {}, releases: [], updatedAt: '', extension: 'preserved' }));
  await fs.writeFile(path.join(directory, 'order-ledger.json'), l, { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'order-idempotency.json'), i, { mode: 0o600 });
  const expectedHashes = { orderLedger: sha(l), orderIdempotency: sha(i) };
  const options = { directory, expectedHashes, attemptId: 'fixture-attempt' };
  await withScopedStores(options, async context => {
    const records = Array.from({ length: 5 }, (_, n) => ({ ...managementRecord(n), preWriteHashes: expectedHashes }));
    const mixed = structuredClone(records); mixed[1].accountSha256 = hash('other');
    await assert.rejects(reserveScopedExits(context, mixed), /SCOPED_STORE_/); checks++;
    const receipt = await reserveScopedExits(context, records);
    assert.equal(receipt.recordsSha256, hash(records)); checks++;
    await assert.rejects(withScopedStores(options, () => {}), /SCOPED_STORE_/); checks++;
    const requestSha256 = hash('request'), details = { at, limitPrice: '99.9', evidenceSha256: hash('attempt') };
    await assert.rejects(recordScopedAttempt(context, records[1].exitIdempotencyKey, requestSha256, details), /SCOPED_STORE_/); checks++;
    const attempted = await recordScopedAttempt(context, records[0].exitIdempotencyKey, requestSha256, details);
    assert.equal(attempted.recordsSha256.length, 64); checks++;
    await assert.rejects(recordScopedAttempt(context, records[0].exitIdempotencyKey, requestSha256, details), /SCOPED_STORE_/); checks++;
    let record = (await ledger.loadScopedOrderLedgerState(path.join(directory, 'order-ledger.json'))).orders[records[0].exitIdempotencyKey];
    for (const [phase, status, qty] of [['OBSERVED', 'partially_filled', '0.5'], ['OBSERVED', 'filled', '2'], ['FLAT_RECONCILED', 'filled', '2']]) {
      record = { ...record, recordKind: 'SCOPED_MANAGEMENT_EXIT_V2', schemaVersion: 2,
        brokerEventTimestamps: { createdAt: at, updatedAt: at, filledAt: at },
        submissionPhase: phase, brokerStatus: status, filledQty: qty, brokerOrderId: 'fixture-broker',
        history: [...record.history, { at, phase, evidenceSha256: record.observedEvidenceSha256, brokerStatus: status, filledQty: qty }] };
      await recordScopedObservation(context, record.exitIdempotencyKey, record);
      if (status === 'partially_filled') {
        const bytes = await Promise.all(['order-ledger.json', 'order-idempotency.json'].map(f => fs.readFile(path.join(directory, f))));
        const downgraded = { ...record, recordKind: 'SCOPED_MANAGEMENT_EXIT_V1', schemaVersion: 1,
          history: [...record.history, record.history.at(-1)] };
        delete downgraded.brokerEventTimestamps;
        assert.equal(validateScopedManagementRecord(record.exitIdempotencyKey, downgraded), true); checks++;
        await assert.rejects(recordScopedObservation(context, record.exitIdempotencyKey, downgraded), /OBSERVATION_TIMESTAMP_REGRESSION/); checks++;
        const removed = { ...record, history: [...record.history, record.history.at(-1)] };
        delete removed.brokerEventTimestamps;
        await assert.rejects(recordScopedObservation(context, record.exitIdempotencyKey, removed), /OBSERVATION_TIMESTAMP_REGRESSION/); checks++;
        assert.deepEqual(await Promise.all(['order-ledger.json', 'order-idempotency.json'].map(f => fs.readFile(path.join(directory, f)))), bytes); checks++;
      }
    }
    await assert.rejects(recordScopedAttempt(context, records[1].exitIdempotencyKey, requestSha256, details), /SCOPED_STORE_BATCH_STOPPED/); checks++;
  });
  await assert.rejects(withScopedStores(options, () => {}), /SCOPED_STORE_/); checks++;
  assert.deepEqual(await fs.readFile(path.join(directory, '.scoped-closeout-fixture-attempt', 'order-ledger.json')), l); checks++;
} finally { await fs.rm(directory, { recursive: true, force: true }); }

// Inject failures into real temporary-file writes, including the cross-file gap.
for (const stage of ['backup-write', 'backup-sync', 'backup-rename',
  ...['idempotency', 'ledger'].flatMap(file => ['write', 'sync', 'readback', 'rename', 'after-rename', 'directory-sync'].map(op => `${file}-${op}`))]) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-fault-'))); await fs.chmod(dir, 0o700);
  const seedL = JSON.stringify({ orders: {}, updatedAt: '', extension: { untouched: true } });
  const seedI = JSON.stringify({ orders: {}, releases: [], updatedAt: '', extension: { untouched: true } });
  await fs.writeFile(path.join(dir, 'order-ledger.json'), seedL, { mode: 0o600 });
  await fs.writeFile(path.join(dir, 'order-idempotency.json'), seedI, { mode: 0o600 });
  const expectedHashes = { orderLedger: sha(seedL), orderIdempotency: sha(seedI) };
  const original = { open: fs.open, rename: fs.rename, readFile: fs.readFile };
  let injected = false, renamed = false; const handles = new Set();
  const isTarget = file => stage.startsWith('backup-') ? String(file).includes('.scoped-closeout-fixture-')
    : String(file).startsWith(path.join(dir, `order-${stage.split('-')[0]}.json.`));
  const fail = () => { injected = true; throw new Error('private-id must not escape'); };
  fs.open = async (...args) => {
    const h = await original.open(...args), file = String(args[0]); handles.add(h);
    return new Proxy(h, { get(target, k) {
      if (k === 'close') return async () => { try { return await h.close(); } finally { handles.delete(h); } };
      if (k === 'writeFile' && stage.endsWith('-write') && isTarget(file)) return async () => fail();
      if (k === 'sync' && ((stage.endsWith('-sync') && !stage.endsWith('directory-sync') && isTarget(file))
        || (stage.endsWith('directory-sync') && renamed && file === dir))) return async () => fail();
      const v = target[k]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  };
  fs.rename = async (from, to) => {
    if (isTarget(from)) {
      if (stage.endsWith('-rename') && !stage.endsWith('after-rename')) fail();
      await original.rename(from, to); renamed = true;
      if (stage.endsWith('after-rename')) fail();
    } else await original.rename(from, to);
  };
  fs.readFile = async (...args) => {
    if (stage.endsWith('readback') && isTarget(args[0])) { injected = true; return Buffer.from('invalid-private'); }
    return original.readFile(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(withScopedStores({ directory: dir, expectedHashes, attemptId: 'fixture-fault' }, async context => {
      await reserveScopedExits(context, Array.from({ length: 5 }, (_, n) => ({ ...managementRecord(n), attemptId: 'fixture-fault', preWriteHashes: expectedHashes })));
    }), /^Error: SCOPED_STORE_[A-Z_]+$/);
    assert.equal(injected, true, stage); checks += 2;
    assert.equal((await fs.stat(path.join(dir, '.scoped-closeout.lock'))).isFile(), true); checks++;
    assert.equal(handles.size, 0, `file handles closed: ${stage}`); checks++;
  } finally {
    Object.assign(fs, original); syncBuiltinESMExports();
    await Promise.all([...handles].map(h => h.close())); await fs.rm(dir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-storage', checks, productionStateWrites: 0 }));

for (const fault of ['symlink', 'world-readable', 'hash-drift', 'outside-writer']) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-boundary-'))); await fs.chmod(dir, 0o700);
  const l = JSON.stringify({ orders: {}, updatedAt: '' }), i = JSON.stringify({ orders: {}, releases: [], updatedAt: '' });
  const lf = path.join(dir, 'order-ledger.json'), idf = path.join(dir, 'order-idempotency.json');
  await fs.writeFile(lf, l, { mode: 0o600 }); await fs.writeFile(idf, i, { mode: 0o600 });
  const expectedHashes = { orderLedger: sha(l), orderIdempotency: sha(i) };
  const options = { directory: dir, attemptId: 'fixture-boundary', expectedHashes };
  try {
    if (fault === 'outside-writer') {
      const oldState = await ledger.loadOrderLedgerState(lf);
      let release;
      const signal = new Promise(resolve => { release = resolve; });
      // Register outside the coordinator's AsyncLocalStorage ownership context.
      const outsider = signal.then(() => assert.rejects(ledger.saveOrderLedgerState(lf, oldState), /LOCK_UNAVAILABLE/));
      await withScopedStores(options, async () => { release(); await outsider; });
    } else {
      if (fault === 'symlink') { await fs.rename(lf, `${lf}.original`); await fs.symlink(`${lf}.original`, lf); }
      if (fault === 'world-readable') await fs.chmod(lf, 0o644);
      if (fault === 'hash-drift') await fs.writeFile(lf, `${l} `);
      await assert.rejects(withScopedStores(options, () => assert.fail('untrusted state admitted')), /SCOPED_STORE_/);
    }
    assert.equal(await fs.readFile(lf, 'utf8'), fault === 'hash-drift' ? `${l} ` : l); checks += 2;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-private-boundaries', checks, productionStateWrites: 0 }));
