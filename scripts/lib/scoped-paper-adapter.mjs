export { validateScopedPaperConfiguration, authorizeScopedPaperInvocation } from './scoped-closeout-contract.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { authorizeScopedPaperInvocation, assertScopedPaperInvocation, validateObservedCloseoutInput,
  createScopedCloseoutState, advanceScopedCloseout, evaluateCloseoutSnapshot, BUDGET } from './scoped-closeout-contract.mjs';
import { withScopedStores, reserveScopedExits, recordScopedAttempt, recordScopedObservation, verifyScopedStoreReceipt } from './scoped-closeout-storage.mjs';
import { isScopedPaperTransport } from './scoped-paper-transport.mjs';
import { mapAccountEvidence, mapPreflightEvidence, mapOrderObservation, mapPostcheckEvidence } from './scoped-paper-evidence.mjs';
import { buildScopedNotificationSnapshot, deliverNotifications } from '../paper-order-notifications.mjs';

export const SCOPED_PAPER_REVIEWED_FILES = Object.freeze([
  './scoped-paper-adapter.mjs', './scoped-paper-transport.mjs', './scoped-paper-evidence.mjs', './scoped-closeout-contract.mjs',
  './scoped-closeout-storage.mjs', './closeout-decimal.mjs', './active-position-limited-recovery.mjs',
  '../paper-order-notifications.mjs', '../run-scoped-paper-closeout.mjs',
  '../../dist/src/order-state-storage.js', '../../dist/src/order-ledger-storage.js',
  '../../dist/src/order-idempotency-storage.js', '../../dist/src/scoped-management-record.js', '../../dist/src/json-utils.js',
].map(p => fileURLToPath(new URL(p, import.meta.url))).sort());
const sha = b => createHash('sha256').update(b).digest('hex');
const check = (ok, code) => { if (!ok) throw Error(`SCOPED_ADAPTER_${code}`); };
async function pinnedFile(file, privateOnly) {
  const h = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await h.stat();
    check(s.isFile() && s.nlink === 1 && s.size <= 50 * 1024 * 1024
      && (!privateOnly || (s.uid === process.getuid() && (s.mode & 0o077) === 0)), 'FILE_INVALID');
    const bytes = await h.readFile(); check(sha(bytes) === file.sha256, 'FILE_HASH_DRIFT'); return bytes;
  } finally { await h.close(); }
}
async function verifyInputs(config) {
  check(digest(config.codeFiles.map(f => f.path)) === digest(SCOPED_PAPER_REVIEWED_FILES), 'CODE_MANIFEST_INVALID');
  for (const file of config.codeFiles) await pinnedFile(file, false);
  const source = JSON.parse((await pinnedFile(config.sourceFile, true)).toString('utf8'));
  const expected = { schemaVersion: 'scoped-paper-source-v1', accountSha256: config.input.accountSha256,
    termsSha256: config.input.termsSha256, preWriteHashes: config.input.preWriteHashes, targets: config.input.terms.targets };
  check(digest(source) === digest(expected), 'SOURCE_BINDING_INVALID');
}
function updateCache(cache, receipts) {
  for (const r of receipts) {
    if (r.error) continue;
    const key = r.group === 'assets' ? `assets:${r.data?.id}` : r.group;
    cache.set(key, r);
  }
}
function routeInput(effect, state, cache, assetIndex, feed) {
  if (effect.group === 'assets') return { assetId: state.scope.terms.targets[effect.phase === 'initial' ? assetIndex : state.index].assetId };
  if (effect.group === 'calendar') return { session: state.scope.authority.session };
  if (effect.group === 'lookup') return { clientOrderId: state.rows[state.index].clientOrderId };
  if (effect.group === 'quotes') return { symbols: state.scope.terms.targets.map(t => cache.get(`assets:${t.assetId}`)?.data?.symbol), feed };
  return {};
}
function wireOrder(state) {
  const o = state.order, row = state.snapshot.rows.find(r => r.assetId === o.assetId);
  check(row && digest(o) === state.rows[state.index].requestSha256, 'INTENT_MISMATCH');
  return { symbol: row.symbol, qty: o.qty, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: o.limitPrice,
    client_order_id: o.clientOrderId, extended_hours: false };
}
async function persistWire(config, state, body, receipt) {
  const dir = path.join(config.directory, `.scoped-closeout-${state.scope.attemptId}`);
  const dest = path.join(dir, `wire-${state.index}.json`), temp = `${dest}.tmp`;
  const h = await fs.open(temp, 'wx', 0o600);
  try {
    await h.writeFile(JSON.stringify({ intentSha256: digest(state.order), intentHashBasis: 'CANONICAL_CONTROLLER_ORDER',
      wireBodySha256: sha(JSON.stringify(body)), wireHashBasis: 'SERIALIZED_BROKER_REQUEST_UTF8', storeHashes: receipt.storeHashes }));
    await h.sync();
  } finally { await h.close(); }
  await fs.link(temp, dest); await fs.unlink(temp);
  const d = await fs.open(dir, 'r'); try { await d.sync(); } finally { await d.close(); }
}
async function boundedNotificationSend(send, message, clock, startedAt) {
  const elapsed = clock.monotonicMs() - startedAt, remaining = Math.min(3000, 300000 - elapsed);
  check(Number.isFinite(elapsed) && elapsed >= 0 && remaining > 0, 'NOTIFICATION_DEADLINE_EXPIRED');
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => send(message, { signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(Error('SCOPED_ADAPTER_NOTIFICATION_DEADLINE_EXPIRED'));
      }, remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function runScopedPaperCloseout({ config, approval, transport, clock, notify }) {
  let activeTransport, state, step, lastReceipt, stateWriteAttempted = false, reason = null, notificationSnapshot, receiptPath, sendNotification;
  let notificationDelivery = { status: 'NOT_AUTHORIZED', eventCount: 0 };
  const cache = new Map(), notificationEvents = new Map();
  const collectNotifications = records => {
    if (!receiptPath) return;
    const snapshot = buildScopedNotificationSnapshot({ scope: state.scope, records, storeReceipt: lastReceipt,
      observations: { symbols: state.snapshot?.rows ?? [], ...((reason || state.phase === 'STOPPED')
        ? { stoppedReason: reason ?? state.reason ?? 'SCOPED_ADAPTER_STOPPED' } : {}) },
      ...config.notifications, observedAt: clock.now() });
    if (snapshot.status !== 'OBSERVATIONS_READY') { notificationDelivery = { status: 'EVIDENCE_UNAVAILABLE', eventCount: 0 }; return; }
    for (const e of snapshot.events) notificationEvents.set(e.eventKey, e);
    check(notificationEvents.size <= 21, 'NOTIFICATION_BUDGET_EXCEEDED');
    notificationSnapshot = { ...snapshot, events: [...notificationEvents.values()] };
  };
  try {
    config = structuredClone(config); approval = structuredClone(approval);
    const capability = authorizeScopedPaperInvocation({ config, approval, clock });
    const scope = validateObservedCloseoutInput(config.input, capability), start = clock.monotonicMs();
    check(Number.isFinite(start) && typeof transport === 'function', 'CONFIG_INVALID');
    const timing = () => ({ now: clock.now(), elapsedMs: clock.monotonicMs() - start });
    state = createScopedCloseoutState(scope);
    const go = event => { step = advanceScopedCloseout(state, { ...event, clock: timing() }); state = step.state; };
    await verifyInputs(config);
    assertScopedPaperInvocation(capability, { config, clock });
    stateWriteAttempted = true;
    await withScopedStores({ directory: config.directory, expectedHashes: scope.preWriteHashes, attemptId: scope.attemptId }, async context => {
      if (config.notifications && notify?.destinationSha256 === config.notifications.destinationSha256 && typeof notify.send === 'function') {
        sendNotification = message => boundedNotificationSend(notify.send, message, clock, start);
        receiptPath = path.join(config.directory, `.scoped-closeout-${scope.attemptId}`, 'notifications.json');
        collectNotifications([]);
        notificationDelivery = await deliverNotifications({ snapshot: notificationSnapshot, receiptPath, send: sendNotification });
        if (notificationDelivery.status !== 'BASELINE_RECORDED') { receiptPath = null; notificationSnapshot = null; }
      }
      const beforeSubmit = async body => {
        assertScopedPaperInvocation(capability, { config, clock }); await verifyInputs(config);
        await verifyScopedStoreReceipt(context, lastReceipt);
        check(state.phase === 'SUBMITTING' && digest(body) === digest(wireOrder(state)), 'WIRE_MISMATCH');
        check(evaluateCloseoutSnapshot(scope, state.snapshot, timing(), state.committed).status === 'READY_REPORT_ONLY', 'PRESEND_STALE');
        await persistWire(config, state, body, lastReceipt);
        assertScopedPaperInvocation(capability, { config, clock });
        await verifyScopedStoreReceipt(context, lastReceipt);
        check(evaluateCloseoutSnapshot(scope, state.snapshot, timing(), state.committed).status === 'READY_REPORT_ONLY', 'PRESEND_STALE');
        return true;
      };
      const candidate = transport({ beforeSubmit, clock, deadlineMs: 300000 - timing().elapsedMs });
      check(isScopedPaperTransport(candidate, beforeSubmit), 'TRANSPORT_INVALID');
      activeTransport = candidate;
      go({ type: 'INITIALIZE' });
      for (let n = 0; n < 80 && !['STOPPED', 'COMPLETE'].includes(state.phase); n++) {
        let assetIndex = 0; const responses = [];
        for (const e of step.effects) {
          if (e.type === 'NOTIFY') continue;
          if (e.type !== 'READ') continue;
          const input = routeInput(e, state, cache, assetIndex, config.bindings.proof.feed);
          if (e.group === 'assets') assetIndex++;
          const response = await activeTransport.request({ group: e.group, phase: e.phase, routeInput: input });
          responses.push(response); updateCache(cache, [response]);
        }
        const record = state.pendingRecords[0];
        switch (state.phase) {
          case 'ACCOUNT_PREFLIGHT': go({ type: 'ACCOUNT_READY', responses,
            accountSha256: mapAccountEvidence({ scope, receipt: responses[0], bindings: config.bindings, clock }) }); break;
          case 'INITIAL_PREFLIGHT': case 'REVALIDATING': go({ type: 'PREFLIGHT', responses,
            snapshot: mapPreflightEvidence({ scope, receipts: [...cache.values()].filter(r => r.group !== 'lookup'), bindings: config.bindings, clock, committed: state.committed }) }); break;
          case 'RESERVING':
            lastReceipt = await reserveScopedExits(context, state.pendingRecords); go({ type: 'RESERVED', receipt: lastReceipt }); break;
          case 'ATTEMPT_PERSIST':
            lastReceipt = await recordScopedAttempt(context, record.exitIdempotencyKey, record.requestSha256,
              { at: record.updatedAt, limitPrice: record.limitPrice, evidenceSha256: record.observedEvidenceSha256 });
            go({ type: 'ATTEMPT_RECORDED', receipt: lastReceipt }); break;
          case 'SUBMITTING': {
            const response = await activeTransport.request({ group: 'submit', phase: 'submit', routeInput: {}, body: wireOrder(state) });
            let observation = null;
            try { observation = mapOrderObservation({ scope, record: { ...state.rows[state.index], symbol: wireOrder(state).symbol }, receipt: response }); }
            catch { /* The controller persists uncertain submission, never a fabricated fill. */ }
            go({ type: 'SUBMIT_RESULT', response, observation }); break;
          }
          case 'OBSERVATION_PERSIST':
            lastReceipt = await recordScopedObservation(context, record.exitIdempotencyKey, record);
            collectNotifications([record]);
            go({ type: 'OBSERVATION_RECORDED', receipt: lastReceipt }); break;
          case 'POSTCHECK': {
            let observation = null;
            try { observation = mapOrderObservation({ scope, record: state.rows[state.index], receipt: responses[0] }); }
            catch { /* Failed lookup stays unresolved; no resend. */ }
            go({ type: 'POSTCHECK', responses, observation, snapshot: mapPostcheckEvidence({ scope, receipts: responses,
              bindings: config.bindings, clock, calendar: cache.get('calendar')?.data }) }); break;
          }
          case 'FINAL_PERSIST':
            lastReceipt = await recordScopedObservation(context, record.exitIdempotencyKey, record);
            go({ type: 'FINAL_RECORDED', receipt: lastReceipt }); collectNotifications([record]); break;
          default: throw Error('SCOPED_ADAPTER_PHASE_INVALID');
        }
      }
      collectNotifications([]);
      check(state.phase === 'COMPLETE' || state.phase === 'STOPPED', 'ITERATION_BOUND');
    });
  } catch (error) {
    reason = /^SCOPED_(?:CLOSEOUT|STORE|ADAPTER|EVIDENCE)_[A-Z_]+$/.test(error?.message) ? error.message : 'SCOPED_ADAPTER_FAILED';
  }
  // Sending follows durable postchecks, so delivery latency cannot delay reconciliation or replay an order.
  if (receiptPath) {
    try {
      collectNotifications([]);
      notificationDelivery = await deliverNotifications({ snapshot: notificationSnapshot, receiptPath, send: sendNotification });
    } catch { notificationDelivery = { status: 'DELIVERY_UNCERTAIN', eventCount: 0 }; }
  }
  const counts = activeTransport?.counts() ?? { ...Object.fromEntries(Object.keys(BUDGET).map(k => [k, 0])), total: 0 };
  const rowStatusCounts = {};
  for (const r of state?.rows ?? []) { const key = r.submissionPhase ?? r.phase; rowStatusCounts[key] = (rowStatusCounts[key] ?? 0) + 1; }
  return Object.freeze({ status: !reason && state?.phase === 'COMPLETE' ? 'COMPLETE' : 'STOPPED',
    reasons: [reason ?? state?.reason].filter(Boolean), requestCounts: counts,
    requestBudgetCompliant: Object.entries(BUDGET).every(([k, v]) => counts[k] <= v) && counts.total <= 66,
    rowStatusCounts, hashes: { ...(lastReceipt?.storeHashes ?? {}) }, notificationDelivery, actualBrokerMutationAttempted: counts.submit > 0,
    actualStateWriteAttempted: stateWriteAttempted, originalHistoryNormalized: false, realizedPnlVerified: false });
}
