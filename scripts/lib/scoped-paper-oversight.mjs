import path from 'node:path';
import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { validateOperationalConfiguration, loadOperationalEvidenceFiles, assessOperationalControlEvidence } from './scoped-paper-operational.mjs';
import { takeOperationalObservationAuthority } from './scoped-closeout-contract.mjs';
import { isScopedPaperObservationTransport } from './scoped-paper-transport.mjs';
import { bindScopedObservationAccount, isScopedObservationAccount, mapOversightObservation, mapOversightPortfolio } from './scoped-paper-evidence.mjs';
import { withScopedObservationStores, recordScopedObservation } from './scoped-closeout-storage.mjs';
import { boundedNotificationSend } from './scoped-paper-adapter.mjs';
import { buildScopedNotificationSnapshot, deliverNotifications } from '../paper-order-notifications.mjs';

const check = (ok, code) => { if (!ok) throw Error(`SCOPED_ADAPTER_${code}`); };
const failureCode = error => /^SCOPED_(?:ADAPTER|STORE|EVIDENCE|CLOSEOUT)_[A-Z_]+$/.test(error?.message)
  ? error.message : 'SCOPED_ADAPTER_OBSERVATION_FAILED';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, fields) => object(v) && Object.keys(v).sort().join(' ') === fields.split(' ').sort().join(' ');
const pin = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
function observationAuthority(authority, records, clock) {
  const inherited = takeOperationalObservationAuthority(authority, records, clock);
  if (inherited) authority = inherited.binding;
  else {
    authority = structuredClone(authority);
    check(exact(authority, 'config expectedHashes recordsSha256 approval') && validateOperationalConfiguration(authority.config).status === 'PASS', 'OBSERVATION_AUTHORITY_INVALID');
    const { approval, ...basis } = authority;
    check(exact(approval, 'kind phrase authoritySha256 approvedAt') && approval.kind === 'DIRECT_SCOPED_OBSERVATION_INVOCATION'
      && approval.phrase === 'AUTHORIZE PAPER SCOPED OUTCOME OBSERVATION ONE-SHOT' && approval.authoritySha256 === digest(basis)
      && time(approval.approvedAt) <= time(clock.now()), 'OBSERVATION_AUTHORITY_INVALID');
    authority = { ...basis, authoritySha256: approval.authoritySha256 };
  }
  const { input: scope, oversight: policy } = authority.config;
  check(exact(authority.expectedHashes, 'orderLedger orderIdempotency') && Object.values(authority.expectedHashes).every(pin)
    && Array.isArray(records) && records.length === 5 && digest(records) === authority.recordsSha256
    && records.every(r => r.accountSha256 === scope.accountSha256 && r.attemptId === scope.attemptId
      && r.managementAuthoritySha256 === scope.authoritySha256 && r.termsSha256 === scope.termsSha256
      && digest(r.preWriteHashes) === digest(scope.preWriteHashes)
      && scope.terms.targets.some(t => ['assetId', 'clientOrderId', 'originalIdentitySha256', 'exitIdempotencyKey', 'qty'].every(k => r[k] === t[k]))), 'OBSERVATION_SCOPE_INVALID');
  let lastNow = time(clock.now()), lastMono = clock.monotonicMs(); const started = lastMono, startNow = lastNow;
  const guard = () => {
    const e = process.env, inheritedRemaining = inherited?.assertActive();
    if (!inherited) check(e.ALPHA_ENV === 'PAPER' && e.READ_ONLY === 'true' && e.EXEC_ENABLED === 'false' && e.LIVE_ORDER_SUBMIT_ENABLED === 'false'
      && e.MARKET_GUARD_MODE === 'observe' && ['FORCE_SEND_ONCE', 'GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN'].every(k => !e[k] || e[k] === 'false')
      && ['ALPACA_BASE_URL', 'ALPACA_API_BASE_URL'].every(k => !e[k] || e[k] === 'https://paper-api.alpaca.markets'), 'OBSERVATION_PROCESS_FLAGS_BLOCKED');
    const now = time(clock.now()), mono = clock.monotonicMs();
    check(Number.isFinite(mono) && mono >= lastMono && now >= lastNow && now >= time(policy.validFrom)
      && now < time(policy.expiresAt) && mono - started < time(policy.expiresAt) - startNow, 'OBSERVATION_WINDOW_EXPIRED');
    lastNow = now; lastMono = mono;
    return Math.min(time(policy.expiresAt) - now, time(policy.expiresAt) - startNow - (mono - started), inheritedRemaining ?? Infinity);
  };
  guard(); return { scope, policy, guard, authority };
}
async function waitForObservation(clock, intervalMs, guard) {
  const remaining = guard(), started = clock.monotonicMs(), controller = new AbortController(); let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => clock.sleep(intervalMs, { signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(Error('SCOPED_ADAPTER_OBSERVATION_WAIT_EXPIRED'));
      }, Math.min(intervalMs + 3000, remaining)); }),
    ]);
    guard();
    check(clock.monotonicMs() - started >= intervalMs, 'OBSERVATION_WAIT_INVALID');
  } finally { clearTimeout(timer); }
}
function observedRecord(before, observation, at) {
  if (before.brokerOrderId === observation.brokerOrderId && before.brokerStatus === observation.brokerStatus && before.filledQty === observation.filledQty) return before;
  check(before.submissionPhase !== 'FLAT_RECONCILED', 'TERMINAL_RECORD_CONFLICT');
  const evidenceSha256 = digest(observation);
  return { ...before, submissionPhase: 'STOPPED', brokerOrderId: observation.brokerOrderId, brokerStatus: observation.brokerStatus,
    filledQty: observation.filledQty, updatedAt: at, observedEvidenceSha256: evidenceSha256, history: [...before.history,
      { at, phase: 'STOPPED', evidenceSha256, brokerStatus: observation.brokerStatus, filledQty: observation.filledQty }] };
}

export async function runScopedPaperOversight({ authority, records, observationTransport, clock, notify }) {
  let transport, reason = null, receipt, cycles = 0, flatReconciledRows = 0, observedRows = 0, attemptedRows = 0, complete = false;
  let config;
  let stateWriteAttempted = false, receiptPath, sendNotification, notificationSnapshot;
  let notificationDelivery = { status: 'NOT_AUTHORIZED', eventCount: 0 };
  const notificationEvents = new Map();
  const collectNotifications = (rows = [], observations = {}) => {
    if (!receiptPath) return;
    const snapshot = buildScopedNotificationSnapshot({ scope: config.input, records: rows, storeReceipt: receipt,
      observations, ...config.notifications, observedAt: clock.now() });
    if (snapshot.status !== 'OBSERVATIONS_READY') {
      notificationDelivery = { status: 'EVIDENCE_UNAVAILABLE', eventCount: 0 }; receiptPath = null; return;
    }
    for (const event of snapshot.events) notificationEvents.set(event.eventKey, event);
    // Five records, each with at most 16 history events plus reconciliation, and one handoff.
    if (notificationEvents.size > 5 * (16 + 1) + 1) {
      notificationDelivery = { status: 'EVIDENCE_UNAVAILABLE', eventCount: 0 }; receiptPath = null; return;
    }
    notificationSnapshot = { ...snapshot, events: [...notificationEvents.values()] };
  };
  try {
    records = structuredClone(records);
    const authorized = observationAuthority(authority, records, clock), { scope, policy, guard } = authorized;
    authority = authorized.authority; config = authority.config;
    const indices = records.map((r, i) => r.submissionPhase !== 'RESERVED' ? i : -1).filter(i => i >= 0);
    attemptedRows = indices.length;
    check(attemptedRows > 0 && typeof observationTransport === 'function' && typeof clock.sleep === 'function', 'OBSERVATION_CONFIG_INVALID');
    const files = await loadOperationalEvidenceFiles({ config });
    const controls = async () => {
      const result = await assessOperationalControlEvidence({ config, files, clock, purpose: 'OBSERVATION' });
      if (result.status === 'BLOCKED') throw Error(result.reasons[0]);
      guard();
    };
    await controls();
    stateWriteAttempted = true;
    await withScopedObservationStores({ directory: config.directory, expectedHashes: authority.expectedHashes,
      attemptId: scope.attemptId, authoritySha256: authority.authoritySha256 }, async (context, stored) => {
      try {
      check(digest(stored) === authority.recordsSha256, 'OBSERVATION_SCOPE_INVALID');
      if (config.notifications && notify?.destinationSha256 === config.notifications.destinationSha256 && typeof notify.send === 'function') {
        const started = clock.monotonicMs(), startNow = time(clock.now()), send = notify.send;
        sendNotification = message => {
          const now = time(clock.now()), remaining = time(policy.handoffDeadline) - now;
          check(now >= startNow && remaining > 0, 'NOTIFICATION_DEADLINE_EXPIRED');
          return boundedNotificationSend(send, message, clock, started,
            Math.min(time(policy.handoffDeadline) - startNow, clock.monotonicMs() - started + remaining));
        };
        receiptPath = path.join(config.directory, `.scoped-closeout-${scope.attemptId}`, 'notifications.json');
        collectNotifications();
        notificationDelivery = await deliverNotifications({ snapshot: notificationSnapshot, receiptPath, send: sendNotification });
        if (!['BASELINE_RECORDED', 'NO_CHANGE'].includes(notificationDelivery.status)) receiptPath = null;
      }
      let accountBinding;
      const beforeRead = request => { guard(); return request.group === 'account'
        ? !accountBinding : isScopedObservationAccount(accountBinding, scope.accountSha256, transport); };
      await controls();
      transport = observationTransport({ beforeRead, clock, oversight: policy });
      check(isScopedPaperObservationTransport(transport, beforeRead), 'OBSERVATION_TRANSPORT_INVALID');
      const read = async (group, routeInput = {}) => {
        await controls();
        const r = await transport.request({ group, phase: group === 'account' ? 'account' : 'observation', routeInput });
        check(!r.error && r.complete, 'OBSERVATION_READ_FAILED'); guard(); return r;
      };
      accountBinding = bindScopedObservationAccount({ scope, receipt: await read('account'), bindings: config.accountBinding, transport, clock });
      const previous = new Map();
      for (let cycle = 0; cycle < policy.maxCycles; cycle++) {
        if (cycle) await waitForObservation(clock, policy.intervalMs, guard);
        for (const index of indices) {
          const before = records[index], observed = mapOversightObservation({ scope, record: before,
            receipt: await read('lookup', { clientOrderId: before.clientOrderId }), accountBinding, transport, clock,
            previous: previous.get(before.exitIdempotencyKey) });
          const next = observedRecord(before, observed, clock.now());
          receipt = await recordScopedObservation(context, before.exitIdempotencyKey, next, accountBinding);
          records[index] = next; previous.set(before.exitIdempotencyKey, observed);
          collectNotifications([next], { symbols: [observed] });
        }
        observedRows = previous.size;
        const responses = [];
        for (const group of ['positions', 'orders', 'clock']) responses.push(await read(group));
        const snapshot = mapOversightPortfolio({ scope, records, receipts: responses, accountBinding, transport, clock });
        cycles++; flatReconciledRows = snapshot.flatKeys.length;
        if (receiptPath) for (const index of indices) {
          const row = records[index];
          receipt = await recordScopedObservation(context, row.exitIdempotencyKey, row, accountBinding);
          collectNotifications([row], { symbols: [previous.get(row.exitIdempotencyKey)], portfolio: snapshot });
        }
        if (!snapshot.portfolioMatches || snapshot.openOrderConflict) { reason = 'SCOPED_ADAPTER_OBSERVATION_PORTFOLIO_CONFLICT'; break; }
        if (flatReconciledRows === attemptedRows) { complete = true; break; }
        if (!snapshot.marketOpen) { reason = 'SCOPED_ADAPTER_OBSERVATION_MARKET_CLOSED'; break; }
        if (indices.some(i => ['canceled', 'rejected', 'expired'].includes(records[i].brokerStatus))) { reason = 'SCOPED_ADAPTER_OBSERVATION_TERMINAL_RESIDUAL'; break; }
      }
      if (!complete && !reason) reason = 'SCOPED_ADAPTER_OBSERVATION_BUDGET_EXHAUSTED';
      } catch (error) {
        // Keep the safe observation reason while storage preserves its failure fence.
        reason = failureCode(error); throw error;
      }
    });
  } catch (error) {
    reason ??= failureCode(error);
  }
  // Delivery follows durable observations; its failure cannot reopen orders or discard verified fills.
  if (receiptPath) {
    try {
      collectNotifications([], reason ? { handoffReason: reason } : {});
      if (receiptPath) notificationDelivery = await deliverNotifications({ snapshot: notificationSnapshot, receiptPath, send: sendNotification });
    } catch { notificationDelivery = { status: 'DELIVERY_UNCERTAIN', eventCount: 0 }; }
  }
  const counts = transport?.counts() ?? { account: 0, lookup: 0, positions: 0, orders: 0, clock: 0, total: 0 };
  const budget = config?.oversight?.requestBudget;
  return Object.freeze({ status: complete && !reason ? 'ATTEMPTED_ORDERS_RECONCILED' : 'UNRESOLVED_HANDOFF', reasons: reason ? [reason] : [],
    requestCounts: counts, requestBudgetCompliant: counts.total === 0 || (budget && Object.entries(counts).every(([k, v]) => v <= budget[k])),
    cycles, attemptedRows, observedRows, flatReconciledRows, reservedUnsubmittedRows: 5 - attemptedRows,
    storeHashes: receipt?.storeHashes ?? {}, notificationDelivery, actualBrokerMutationAttempted: false, actualStateWriteAttempted: stateWriteAttempted,
    brokerSubmitAllowed: false, originalHistoryNormalized: false, realizedPnlVerified: false });
}
