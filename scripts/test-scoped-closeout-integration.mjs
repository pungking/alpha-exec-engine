import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, hash, at, bindPostcheckEvidence } from './fixtures/scoped-closeout.mjs';
import { validateScopedCloseoutInput, createScopedCloseoutState, advanceScopedCloseout, BUDGET } from './lib/scoped-closeout-contract.mjs';
import { withScopedStores, reserveScopedExits, recordScopedAttempt, recordScopedObservation } from './lib/scoped-closeout-storage.mjs';
import { buildNotificationSnapshot, deliverNotifications } from './paper-order-notifications.mjs';

// No adapter, secrets, environment configuration or network; only disposable files.
let checks = 0;
const sha = b => createHash('sha256').update(b).digest('hex');
const transport = group => ({ group, complete: true, status: 200, durationMs: 1, bytes: 10, responseSha256: hash(group) });
async function scenario({ failurePhase, partial = false, accepted = false, postConflict = false, postReadFailure = false, sendTimeout = false } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-integration-')));
  await fs.chmod(dir, 0o700);
  const f = fixture(), brokerOrders = [], requests = [];
  const oldLedger = { idempotencyKey: 'preserved', symbol: 'FIXTURE', side: 'buy', stage6Hash: hash('old'), stage6File: 'fixture.json', mode: 'PAPER',
    clientOrderId: 'preserved-client', status: 'filled', statusReason: 'fixture', preflightCode: 'fixture', regimeProfile: 'default',
    notional: 1, limitPrice: 1, takeProfitPrice: 2, stopLossPrice: 0.5, brokerOrderId: null, createdAt: at, updatedAt: at, history: [] };
  const oldIdem = { symbol: 'FIXTURE', side: 'buy', stage6Hash: hash('old'), stage6File: 'fixture.json', firstSeenAt: at, lastSeenAt: at };
  const initial = { orderLedger: { orders: { preserved: oldLedger }, updatedAt: at, extension: { preserved: true } },
    orderIdempotency: { orders: { preserved: oldIdem }, releases: [], updatedAt: at, extension: { preserved: true } } };
  const names = { orderLedger: 'order-ledger.json', orderIdempotency: 'order-idempotency.json' };
  const read = async name => JSON.parse(await fs.readFile(path.join(dir, names[name]), 'utf8'));
  let sends = 0;
  try {
    for (const [name, state] of Object.entries(initial)) {
      const bytes = JSON.stringify(state); await fs.writeFile(path.join(dir, names[name]), bytes, { mode: 0o600 });
      f.input.preWriteHashes[name] = sha(bytes);
    }
    f.input.accountSha256 = f.snapshot.accountSha256 = hash(['PAPER', 'synthetic-account']);
    const options = { directory: dir, expectedHashes: f.input.preWriteHashes, attemptId: f.input.attemptId };
    let step = { state: createScopedCloseoutState(validateScopedCloseoutInput(f.input)), effects: [] };
    const go = e => { step = advanceScopedCloseout(step.state, { ...e, clock: f.clock }); };
    const notificationInput = async () => ({ accountId: 'synthetic-account', paper: true, runId: '123', headSha: 'a'.repeat(40), observedAt: at,
      complete: true, positions: [], openOrders: [], closedOrders: brokerOrders,
      orderLedger: await read('orderLedger'), orderIdempotency: await read('orderIdempotency'), realizedPnl: { rows: [] } });
    const receiptPath = path.join(dir, 'notification-receipt.json');
    const send = async text => { sends++; assert.equal(text.includes('synthetic-account'), false); if (sendTimeout) throw new Error('fixture-timeout'); return { ok: true }; };
    assert.equal((await deliverNotifications({ snapshot: buildNotificationSnapshot(await notificationInput()), receiptPath, send })).status, 'BASELINE_RECORDED'); checks++;
    await withScopedStores(options, async ctx => {
      go({ type: 'INITIALIZE' });
      for (let n = 0; n < 65 && !['STOPPED', 'COMPLETE'].includes(step.state.phase); n++) {
        const { state, effects } = step;
        if (state.phase === failurePhase) { go({ type: 'FAILURE' }); continue; }
        const record = state.pendingRecords[0], row = state.rows[state.index];
        const responses = effects.filter(e => e.type === 'READ').map(e => { requests.push(e.group); return transport(e.group); });
        const snapshot = structuredClone(f.snapshot);
        snapshot.portfolio = snapshot.portfolio.filter(p => !Object.hasOwn(state.committed, p.assetId));
        const observation = status => ({ accountSha256: f.input.accountSha256, assetId: row.assetId, clientOrderId: row.clientOrderId,
          brokerOrderId: `fixture-broker-${state.index}`, brokerStatus: status, filledQty: status === 'filled' ? row.qty : status === 'partially_filled' ? '0.5' : '0' });
        switch (state.phase) {
          case 'ACCOUNT_PREFLIGHT': go({ type: 'ACCOUNT_READY', accountSha256: f.input.accountSha256, responses }); break;
          case 'INITIAL_PREFLIGHT': case 'REVALIDATING': go({ type: 'PREFLIGHT', snapshot, responses }); break;
          case 'RESERVING': go({ type: 'RESERVED', receipt: await reserveScopedExits(ctx, state.pendingRecords) }); break;
          case 'ATTEMPT_PERSIST': go({ type: 'ATTEMPT_RECORDED', receipt: await recordScopedAttempt(ctx, record.exitIdempotencyKey, record.requestSha256,
            { at: record.updatedAt, limitPrice: record.limitPrice, evidenceSha256: record.observedEvidenceSha256 }) }); break;
          case 'SUBMITTING': {
            for (const name of Object.keys(names)) {
              const disk = (await read(name)).orders[row.exitIdempotencyKey];
              assert.deepEqual(disk, row); assert.equal(disk.submissionPhase, 'ATTEMPTED'); checks += 2;
            }
            assert.equal(effects.filter(e => e.type === 'PROPOSE_LIMIT_ORDER').length, 1); checks++;
            requests.push('submit');
            const status = partial ? 'partially_filled' : accepted ? 'accepted' : 'filled';
            go({ type: 'SUBMIT_RESULT', response: transport('submit'), observation: observation(status) }); break;
          }
          case 'OBSERVATION_PERSIST': go({ type: 'OBSERVATION_RECORDED', receipt: await recordScopedObservation(ctx, record.exitIdempotencyKey, record) }); break;
          case 'POSTCHECK': {
            const status = partial ? 'partially_filled' : 'filled';
            if (!partial) snapshot.portfolio = snapshot.portfolio.filter(p => p.assetId !== row.assetId);
            if (postConflict) snapshot.openOrders.push({ protective: true });
            brokerOrders.push({ id: `fixture-broker-${state.index}`, client_order_id: row.clientOrderId, asset_id: row.assetId, symbol: `FIX${String.fromCharCode(65 + state.index)}`,
              side: 'sell', type: 'limit', status, qty: row.qty, filled_qty: partial ? '0.5' : row.qty, filled_avg_price: '100', submitted_at: at, updated_at: at, filled_at: at });
            const obs = observation(status); bindPostcheckEvidence(snapshot, responses, obs);
            if (postReadFailure) responses[1].status = 500;
            go({ type: 'POSTCHECK', responses, snapshot, observation: obs }); break;
          }
          case 'FINAL_PERSIST': go({ type: 'FINAL_RECORDED', receipt: await recordScopedObservation(ctx, record.exitIdempotencyKey, record) }); break;
          default: assert.fail('Unexpected synthetic phase');
        }
      }
    });
    const done = !failurePhase && !partial && !postConflict && !postReadFailure;
    assert.equal(step.state.phase, done ? 'COMPLETE' : 'STOPPED'); checks++;
    if (postReadFailure) {
      const r = (await read('orderLedger')).orders[f.input.terms.targets[0].exitIdempotencyKey];
      assert.equal(r.brokerStatus, 'filled'); assert.equal(r.filledQty, '2'); assert.equal(r.submissionPhase, 'STOPPED'); checks += 3;
    }
    for (const [name, original] of Object.entries(initial)) {
      const current = await read(name);
      assert.deepEqual(current.orders.preserved, original.orders.preserved);
      assert.deepEqual(current.extension, original.extension);
      assert.equal(sha(await fs.readFile(path.join(dir, `.scoped-closeout-${f.input.attemptId}`, names[name]))), f.input.preWriteHashes[name]); checks += 3;
      for (const r of Object.values(current.orders).filter(r => r.recordKind)) {
        assert.equal(r.originalOwnershipVerified, false); assert.equal(r.realizedPnlVerified, false); assert.equal(r.historicalEvidenceNormalized, false); checks += 3;
      }
    }
    for (const [group, cap] of Object.entries(BUDGET)) { assert.ok(requests.filter(r => r === group).length <= cap); checks++; }
    assert.equal(advanceScopedCloseout(step.state, { type: 'INITIALIZE', clock: f.clock }).effects.length, 0); checks++;
    if (done) {
      assert.equal(requests.length, 66); checks++;
      const snap = buildNotificationSnapshot(await notificationInput());
      assert.equal(snap.events.filter(e => e.type === 'MANAGEMENT_POSITION_FLAT_RECONCILED').length, 5);
      assert.equal(snap.events.filter(e => e.type === 'POSITION_CLOSEOUT_RECONCILED').length, 0); checks += 2;
      const delivered = await deliverNotifications({ snapshot: snap, receiptPath, send });
      assert.equal(delivered.status, sendTimeout ? 'DELIVERY_UNCERTAIN' : 'DELIVERED');
      assert.equal((await deliverNotifications({ snapshot: snap, receiptPath, send })).status, 'NO_CHANGE');
      assert.equal(sends, 1); checks += 3;
    } else { assert.ok(requests.filter(r => r === 'submit').length <= 1); checks++; }
    await assert.rejects(withScopedStores(options, () => {}), /SCOPED_STORE_/); checks++;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
await scenario(); await scenario({ accepted: true }); await scenario({ sendTimeout: true });
await scenario({ partial: true }); await scenario({ postConflict: true });
await scenario({ accepted: true, postReadFailure: true });
for (const failurePhase of ['ACCOUNT_PREFLIGHT', 'INITIAL_PREFLIGHT', 'RESERVING', 'REVALIDATING', 'ATTEMPT_PERSIST', 'SUBMITTING', 'OBSERVATION_PERSIST', 'POSTCHECK', 'FINAL_PERSIST']) await scenario({ failurePhase });
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-integration', checks, actualBrokerRequests: 0, actualTelegramSends: 0, productionStateWrites: 0 }));
