import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withOrderStateDirectoryLock } from '../../dist/src/order-state-storage.js';
import { loadScopedOrderLedgerState, saveScopedOrderLedgerState } from '../../dist/src/order-ledger-storage.js';
import { loadScopedOrderIdempotencyState, saveScopedOrderIdempotencyState } from '../../dist/src/order-idempotency-storage.js';
import { validateScopedManagementRecord } from '../../dist/src/scoped-management-record.js';
import { sha256Canonical as canonical } from './active-position-limited-recovery.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contexts = new WeakMap();
const files = { orderLedger: 'order-ledger.json', orderIdempotency: 'order-idempotency.json' };
const check = (ok, code) => { if (!ok) throw new Error(`SCOPED_STORE_${code}`); };
const pin = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function privateBytes(file) {
  const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await h.stat();
    check(s.isFile() && s.nlink === 1 && s.size <= 50 * 1024 * 1024 && s.uid === process.getuid() && (s.mode & 0o077) === 0, 'PRIVATE_FILE_INVALID');
    return await h.readFile();
  } finally { await h.close(); }
}
async function readHashes(directory) {
  const entries = await Promise.all(Object.entries(files).map(async ([k, name]) => [k, hash(await privateBytes(path.join(directory, name)))]));
  return Object.fromEntries(entries);
}
async function syncDirectory(directory) { const h = await fs.open(directory, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function backup(directory, attemptId, expectedHashes) {
  const backupDir = path.join(directory, `.scoped-closeout-${attemptId}`);
  await fs.mkdir(backupDir, { mode: 0o700 });
  for (const [k, name] of Object.entries(files)) {
    const raw = await privateBytes(path.join(directory, name)); check(hash(raw) === expectedHashes[k], 'HASH_DRIFT');
    const temporary = path.join(backupDir, `${name}.tmp`), h = await fs.open(temporary, 'wx', 0o600);
    try { await h.writeFile(raw); await h.sync(); } finally { await h.close(); }
    check((await privateBytes(temporary)).equals(raw), 'BACKUP_VERIFY_FAILED');
    await fs.rename(temporary, path.join(backupDir, name));
  }
  await syncDirectory(backupDir); await syncDirectory(directory);
}
function contextOf(context) {
  const c = contexts.get(context); check(c && !c.closed && !c.poisoned, 'CONTEXT_INVALID'); return c;
}
export async function withScopedStores({ directory, expectedHashes, attemptId }, task) {
  try {
    check(typeof directory === 'string' && path.isAbsolute(directory) && await fs.realpath(directory) === path.resolve(directory), 'DIRECTORY_INVALID');
    const s = await fs.lstat(directory);
    check(s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o077) === 0, 'DIRECTORY_INVALID');
    check(/^[a-zA-Z0-9_-]{1,96}$/.test(attemptId) && expectedHashes && Object.keys(expectedHashes).sort().join(',') === 'orderIdempotency,orderLedger'
      && Object.values(expectedHashes).every(pin), 'PIN_INVALID');
    return await withOrderStateDirectoryLock(directory, async () => {
      check(canonical(await readHashes(directory)) === canonical(expectedHashes), 'HASH_DRIFT');
      const ledger = await loadScopedOrderLedgerState(path.join(directory, files.orderLedger));
      const idem = await loadScopedOrderIdempotencyState(path.join(directory, files.orderIdempotency));
      check([...Object.values(ledger.orders), ...Object.values(idem.orders)].every(r => !r.recordKind), 'EXISTING_MANAGEMENT_ATTEMPT');
      check(!(await fs.readdir(directory)).some(name => name.startsWith('.scoped-closeout-')), 'EXISTING_MANAGEMENT_ATTEMPT');
      await backup(directory, attemptId, expectedHashes);
      const context = Object.freeze({});
      const c = { directory, attemptId, expectedHashes: structuredClone(expectedHashes), hashes: await readHashes(directory),
        ledger, idem, keys: [], closed: false, poisoned: false, pending: false };
      contexts.set(context, c);
      try { const result = await task(context); check(!c.poisoned && !c.pending, 'COMMIT_UNCERTAIN'); return result; }
      finally { c.closed = true; }
    });
  } catch (error) { throw new Error(/^SCOPED_STORE_[A-Z_]+$/.test(error.message) ? error.message : 'SCOPED_STORE_FAILED'); }
}
export async function verifyScopedStoreReceipt(context, receipt) {
  const c = contextOf(context);
  check(!c.pending && receipt && canonical(receipt.storeHashes) === canonical(c.hashes)
    && canonical(await readHashes(c.directory)) === canonical(c.hashes), 'HASH_DRIFT');
  return true;
}
async function commit(c, records) {
  check(!c.pending, 'CONCURRENT_WRITE'); c.pending = true;
  try {
    const snapshot = records.map(r => structuredClone(r));
    check(canonical(await readHashes(c.directory)) === canonical(c.hashes), 'HASH_DRIFT');
    for (const record of snapshot) {
      check(validateScopedManagementRecord(record.exitIdempotencyKey, record), 'RECORD_INVALID');
      c.idem.orders[record.exitIdempotencyKey] = structuredClone(record);
      c.ledger.orders[record.exitIdempotencyKey] = structuredClone(record);
    }
    c.idem.updatedAt = c.ledger.updatedAt = snapshot.at(-1).updatedAt;
    await saveScopedOrderIdempotencyState(path.join(c.directory, files.orderIdempotency), c.idem);
    await saveScopedOrderLedgerState(path.join(c.directory, files.orderLedger), c.ledger);
    const idem = await loadScopedOrderIdempotencyState(path.join(c.directory, files.orderIdempotency));
    const ledger = await loadScopedOrderLedgerState(path.join(c.directory, files.orderLedger));
    check(canonical(idem) === canonical(c.idem) && canonical(ledger) === canonical(c.ledger), 'PARITY_INVALID');
    c.idem = idem; c.ledger = ledger; c.hashes = await readHashes(c.directory);
    return Object.freeze({ recordsSha256: canonical(snapshot), storeHashes: Object.freeze({ ...c.hashes }) });
  } catch { c.poisoned = true; throw new Error('SCOPED_STORE_COMMIT_UNCERTAIN'); }
  finally { c.pending = false; }
}
export async function reserveScopedExits(context, records) {
  const c = contextOf(context);
  check(!c.keys.length && Array.isArray(records) && records.length === 5, 'FIVE_RESERVATIONS_REQUIRED');
  records = structuredClone(records);
  check(['accountSha256', 'managementAuthoritySha256', 'termsSha256'].every(k => new Set(records.map(r => r?.[k])).size === 1), 'SCOPE_MISMATCH');
  const used = [...Object.keys(c.ledger.orders), ...Object.keys(c.idem.orders), ...c.idem.releases.map(r => r.key)];
  for (const field of ['exitIdempotencyKey', 'clientOrderId', 'originalIdentitySha256', 'assetId']) check(new Set(records.map(r => r?.[field])).size === 5, 'IDENTITY_DUPLICATE');
  check(records.every(r => validateScopedManagementRecord(r.exitIdempotencyKey, r) && r.submissionPhase === 'RESERVED'
    && r.attemptId === c.attemptId && canonical(r.preWriteHashes) === canonical(c.expectedHashes)
    && !used.includes(r.exitIdempotencyKey)
    && [...Object.values(c.ledger.orders), ...Object.values(c.idem.orders), ...c.idem.releases].every(v => v.clientOrderId !== r.clientOrderId)), 'RESERVATION_INVALID');
  c.keys = records.map(r => r.exitIdempotencyKey); return commit(c, records);
}
export async function recordScopedAttempt(context, key, requestSha256, { at, limitPrice, evidenceSha256 }) {
  const c = contextOf(context), before = c.ledger.orders[key];
  check(c.keys.length === 5 && c.keys.includes(key) && before?.submissionPhase === 'RESERVED' && pin(requestSha256), 'ATTEMPT_REPLAY');
  check(c.keys.every(k => c.ledger.orders[k].history.every(e => e.phase !== 'STOPPED'
    && !['partially_filled', 'canceled', 'rejected', 'expired'].includes(e.brokerStatus))), 'BATCH_STOPPED');
  check(c.keys.slice(0, c.keys.indexOf(key)).every(k => c.ledger.orders[k].submissionPhase === 'FLAT_RECONCILED')
    && c.keys.slice(c.keys.indexOf(key) + 1).every(k => c.ledger.orders[k].submissionPhase === 'RESERVED'), 'ATTEMPT_ORDER_INVALID');
  const record = { ...before, submissionPhase: 'ATTEMPTED', requestSha256, limitPrice, updatedAt: at, observedEvidenceSha256: evidenceSha256,
    history: [...before.history, { at, phase: 'ATTEMPTED', evidenceSha256, brokerStatus: null, filledQty: '0' }] };
  return commit(c, [record]);
}
export async function recordScopedObservation(context, key, record) {
  const c = contextOf(context), before = c.ledger.orders[key];
  check(c.keys.includes(key) && before && record && before.submissionPhase !== 'RESERVED', 'OBSERVATION_INVALID');
  const mutable = new Set(['submissionPhase', 'brokerOrderId', 'brokerStatus', 'filledQty', 'updatedAt', 'observedEvidenceSha256', 'history']);
  check(Object.keys(before).every(k => mutable.has(k) || canonical(before[k]) === canonical(record[k]))
    && record.history.length === before.history.length + 1 && canonical(record.history.slice(0, -1)) === canonical(before.history)
    && (before.brokerOrderId === null || record.brokerOrderId === before.brokerOrderId), 'OBSERVATION_LINEAGE_INVALID');
  return commit(c, [record]);
}
