import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { managementRecord, hash, at } from './fixtures/scoped-closeout.mjs';
import { validateScopedManagementRecord } from '../dist/src/scoped-management-record.js';
import * as ledger from '../dist/src/order-ledger-storage.js';
import * as idem from '../dist/src/order-idempotency-storage.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-stores-')); await fs.chmod(root, 0o700);
let checks = 0;
try {
  const r = managementRecord(), key = r.exitIdempotencyKey;
  assert.equal(validateScopedManagementRecord(key, r), true); checks++;
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
    const bytes = await fs.readFile(file);
    state.orders[key].realizedPnlVerified = true;
    await assert.rejects(lib[save](file, state), /SCHEMA_INVALID/);
    assert.deepEqual(await fs.readFile(file), bytes); checks += 2; state.orders[key].realizedPnlVerified = false;
    await fs.writeFile(file, '{broken'); await assert.rejects(lib[load](file)); checks++;
    assert.equal(await fs.readFile(file, 'utf8'), '{broken'); checks++;
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-storage', checks, productionStateWrites: 0 }));
