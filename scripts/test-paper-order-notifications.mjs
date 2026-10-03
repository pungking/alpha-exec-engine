import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNotificationSnapshot, deliverNotifications, formatNotification } from './paper-order-notifications.mjs';
import { buildLiveSummary, buildPublicDashboard } from './build-performance-dashboard.mjs';
import { runNotificationDelivery } from './send-paper-order-notifications.mjs';
import { createHash } from 'node:crypto';

const at = '2026-10-02T15:00:00.000Z';
const order = (patch = {}) => ({ id: 'synthetic-order', client_order_id: 'synthetic-client', symbol: 'TESTX',
  side: 'buy', type: 'limit', status: 'new', qty: '2', filled_qty: '0', submitted_at: at, updated_at: at, ...patch });
const input = (patch = {}) => ({ accountId: 'synthetic-account', paper: true, runId: '123', headSha: 'a'.repeat(40), observedAt: at,
  complete: true, positions: [], openOrders: [order()], closedOrders: [], orderLedger: { orders: {} },
  orderIdempotency: { orders: {} }, realizedPnl: { rows: [] }, ...patch });
const types = snapshot => snapshot.events.map(e => e.type);
const accepted = buildNotificationSnapshot(input());
assert.deepEqual(types(accepted), ['ORDER_ACCEPTED']);
const partial = buildNotificationSnapshot(input({ openOrders: [order({ status: 'partially_filled', filled_qty: '1', filled_avg_price: '10' })] }));
assert.deepEqual(types(partial), ['ORDER_PARTIALLY_FILLED']);
const fill = order({ status: 'filled', filled_qty: '2', filled_avg_price: '10', filled_at: at });
const filled = buildNotificationSnapshot(input({ openOrders: [], closedOrders: [fill] }));
assert.deepEqual(types(filled), ['ORDER_FILLED']);
assert.equal(formatNotification(filled.events).includes('청산 완료'), false);
for (const status of ['canceled', 'rejected', 'expired']) {
  const snapshot = buildNotificationSnapshot(input({ openOrders: [], closedOrders: [order({ status })] }));
  assert.ok(types(snapshot).includes(`ORDER_${status.toUpperCase()}`));
}
for (const patch of [{ paper: false }, { complete: false }, { accountId: '' }, { positions: [{}] }]) {
  assert.equal(buildNotificationSnapshot(input(patch)).status, 'EVIDENCE_UNAVAILABLE');
}
for (const patch of [{ id: '' }, { symbol: '<unsafe>' }, { status: 'new_unknown_status' }, { status: 'filled', filled_qty: '0' },
  { status: 'partially_filled', filled_qty: '2' }, { updated_at: '2099-01-01T00:00:00Z' },
  { status: 'filled', filled_qty: '2', filled_avg_price: '10', filled_at: null }]) {
  assert.equal(buildNotificationSnapshot(input({ openOrders: [order(patch)] })).events.length, 0);
}
const conflict = buildNotificationSnapshot(input({ closedOrders: [fill] }));
assert.equal(conflict.events.length, 0);
assert.equal(conflict.excludedRows, 1);
const same = buildNotificationSnapshot(input({ openOrders: [order(), order()] }));
assert.deepEqual(same.events, accepted.events);
assert.deepEqual(buildNotificationSnapshot(input({ runId: '124', observedAt: '2026-10-02T15:15:00.000Z' })).events, accepted.events);

const exit = { ...fill, id: 'synthetic-exit', client_order_id: 'synthetic-exit-client', side: 'sell' };
const stateRow = { brokerOrderId: exit.id, clientOrderId: exit.client_order_id, symbol: exit.symbol,
  actionType: 'EXIT_FULL', executionSide: 'sell', submittedQty: 2, status: 'filled', brokerStatus: 'filled', stage6Hash: 'b'.repeat(64) };
const pnl = { symbol: exit.symbol, sourceType: 'ALPACA_PAPER_BROKER_FILLS', status: 'VERIFIED_NET_REALIZED_PNL',
  terminalExit: true, realizedPnlVerified: true, residualSignedQuantity: 0, partialExit: false, direction: 'long',
  idempotencyVerdict: 'PASS', recoveryMode: null, costDoubleCountViolation: false, matchedQuantity: 2,
  entryFillProvenance: 'BROKER_FILLED_AVG_PRICE', exitFillProvenance: 'BROKER_FILLED_AVG_PRICE' };
const closeoutInput = input({ openOrders: [], closedOrders: [exit], orderLedger: { orders: { exact: { ...stateRow, idempotencyKey: 'exact' } } },
  orderIdempotency: { orders: { exact: stateRow } }, realizedPnl: { rows: [pnl] } });
assert.ok(types(buildNotificationSnapshot(closeoutInput)).includes('POSITION_CLOSEOUT_RECONCILED'));
assert.equal(types(buildNotificationSnapshot({ ...closeoutInput, realizedPnl: { rows: [{ ...pnl, direction: 'short' }] } }))
  .includes('POSITION_CLOSEOUT_RECONCILED'), false);
for (const patch of [{ positions: [{ symbol: exit.symbol, qty: '1' }] }, { openOrders: [order({ id: 'child', side: 'sell' })] },
  { orderIdempotency: { orders: {} } }, { orderIdempotency: { orders: { exact: { ...stateRow, recoveryMode: 'ACTIVE_POSITION_LIMITED_CONTROL' } } } },
  { realizedPnl: { rows: [{ ...pnl, realizedPnlVerified: false }] } }, { realizedPnl: { rows: [{ ...pnl, terminalExit: false }] } },
  { orderLedger: { orders: { exact: { ...stateRow, idempotencyKey: 'wrong' } } } }]) {
  assert.equal(types(buildNotificationSnapshot({ ...closeoutInput, ...patch })).includes('POSITION_CLOSEOUT_RECONCILED'), false);
}
const children = [order({ id: 'stop', type: 'stop', side: 'sell' }), order({ id: 'target', side: 'sell' })];
const protectedSnapshot = buildNotificationSnapshot(input({ openOrders: [{ ...fill, legs: children }] }));
assert.ok(types(protectedSnapshot).includes('PROTECTION_CHILDREN_OBSERVED'));
const unknownProtection = buildNotificationSnapshot(input({ openOrders: [{ ...fill, legs: children.slice(0, 1) }] }));
assert.ok(types(unknownProtection).includes('PROTECTION_REVIEW_REQUIRED'));
const privateText = JSON.stringify(accepted);
for (const sensitive of ['synthetic-order', 'synthetic-client', 'synthetic-account']) assert.equal(privateText.includes(sensitive), false);
assert.equal(JSON.stringify(buildPublicDashboard({ notificationSnapshot: accepted })).includes('TESTX'), false);

// The projection observer must not introduce another broker read or public field.
const routes = [], observations = [];
const live = await buildLiveSummary(async route => {
  routes.push(route);
  return { ok: true, data: route === '/v2/account' ? { id: 'fixture-private-account' } : [] };
}, { ledger: { orders: {} }, idempotency: { orders: {}, releases: [] }, fillability: {} }, value => observations.push(value));
assert.deepEqual(routes, ['/v2/account', '/v2/positions', '/v2/orders?status=open&nested=true&direction=desc&limit=500']);
assert.equal(observations.length, 1);
assert.equal(observations[0].liveComplete, true);
assert.equal(JSON.stringify(buildPublicDashboard({ live, notificationSnapshot: accepted })).includes('fixture-private-account'), false);
assert.equal(buildNotificationSnapshot(input({ openOrders: Array.from({ length: 500 }, () => order()) })).status, 'EVIDENCE_UNAVAILABLE');
assert.equal(buildNotificationSnapshot(input({ closedOrders: Array.from({ length: 500 }, () => fill) })).status, 'EVIDENCE_UNAVAILABLE');

const released = { ...stateRow, key: 'exact', releasedAt: at };
assert.ok(types(buildNotificationSnapshot({ ...closeoutInput, orderIdempotency: { orders: {}, releases: [released] } }))
  .includes('POSITION_CLOSEOUT_RECONCILED'));
assert.equal(types(buildNotificationSnapshot({ ...closeoutInput, orderIdempotency: { orders: { exact: stateRow }, releases: [released] } }))
  .includes('POSITION_CLOSEOUT_RECONCILED'), false);
const shortExit = { ...exit, side: 'buy' };
assert.ok(types(buildNotificationSnapshot({ ...closeoutInput, closedOrders: [shortExit],
  orderLedger: { orders: { exact: { ...stateRow, executionSide: 'buy', idempotencyKey: 'exact' } } },
  orderIdempotency: { orders: { exact: { ...stateRow, executionSide: 'buy' } } },
  realizedPnl: { rows: [{ ...pnl, direction: 'short' }] } })).includes('POSITION_CLOSEOUT_RECONCILED'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-notification-fixture-'));
try {
  const receipt = path.join(root, 'receipt.json');
  let calls = 0;
  const send = async text => { calls++; assert.ok(text.startsWith('[PAPER]')); return { ok: true }; };
  assert.equal((await deliverNotifications({ snapshot: accepted, receiptPath: receipt, send })).status, 'BASELINE_RECORDED');
  assert.equal(calls, 0);
  assert.equal((await deliverNotifications({ snapshot: partial, receiptPath: receipt, send })).status, 'DELIVERED');
  assert.equal(calls, 1);
  const hashBefore = fs.readFileSync(receipt, 'utf8');
  assert.equal((await deliverNotifications({ snapshot: partial, receiptPath: receipt, send })).status, 'NO_CHANGE');
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(receipt, 'utf8'), hashBefore);
  assert.equal((await deliverNotifications({ snapshot: filled, receiptPath: receipt, send: async () => { calls++; throw Error('secret-must-not-escape'); } })).status, 'DELIVERY_UNCERTAIN');
  assert.equal((await deliverNotifications({ snapshot: filled, receiptPath: receipt, send })).status, 'NO_CHANGE');
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(receipt, 'utf8').includes('secret'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt, 'utf8')).attempts.map(row => row.status), ['DELIVERED', 'UNCERTAIN']);
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  const changedAccount = buildNotificationSnapshot(input({ accountId: 'another-account' }));
  assert.equal((await deliverNotifications({ snapshot: changedAccount, receiptPath: receipt, send })).status, 'ACCOUNT_MISMATCH');
  const another = buildNotificationSnapshot(input({ openOrders: [order({ id: 'other', client_order_id: 'other-client' })] }));
  fs.writeFileSync(`${receipt}.lock`, '');
  assert.equal((await deliverNotifications({ snapshot: another, receiptPath: receipt, send })).status, 'RECEIPT_LOCKED');
  fs.unlinkSync(`${receipt}.lock`);
  fs.writeFileSync(receipt, '{broken');
  assert.equal((await deliverNotifications({ snapshot: another, receiptPath: receipt, send })).status, 'RECEIPT_INVALID');
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(receipt, 'utf8'), '{broken');
  fs.unlinkSync(receipt);
  fs.symlinkSync(path.join(root, 'absent'), receipt);
  assert.equal((await deliverNotifications({ snapshot: another, receiptPath: receipt, send })).status, 'RECEIPT_INVALID');
  assert.equal(fs.lstatSync(receipt).isSymbolicLink(), true);
  fs.unlinkSync(receipt);

  const stateDirectory = path.join(root, 'state'), bindingDirectory = path.join(root, 'binding');
  fs.mkdirSync(stateDirectory, { mode: 0o700 }); fs.mkdirSync(bindingDirectory, { mode: 0o700 });
  const write = (file, value) => { const bytes = JSON.stringify(value); fs.writeFileSync(file, bytes, { mode: 0o600 }); return createHash('sha256').update(bytes).digest('hex'); };
  const hashes = Object.fromEntries(['order-ledger.json', 'order-idempotency.json'].map(name => [name, write(path.join(stateDirectory, name), { orders: {} })]));
  const env = { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'sidecar-dry-run', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40), ALPHA_ENV: 'DRY_RUN', ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
    READ_ONLY: 'true', EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false', POSITION_LIFECYCLE_PREVIEW_ONLY: 'true',
    MARKET_GUARD_MODE: 'observe', GUARD_EXECUTE_TIGHTEN_STOPS: 'false', GUARD_EXECUTE_REDUCE_POSITIONS: 'false', GUARD_EXECUTE_FLATTEN: 'false',
    TELEGRAM_TOKEN: 'fake-test-token', TELEGRAM_SIMULATION_CHAT_ID: 'private-fixture-route' };
  const bind = snapshot => {
    const hash = write(path.join(stateDirectory, 'performance-dashboard.json'), { generatedAt: at, notificationSnapshot: snapshot });
    write(path.join(bindingDirectory, 'performance.end.json'), { phase: 'performance', status: 'COMPLETE', producerExitCode: 0,
      run: { runId: '123', runAttempt: 1, headSha: 'a'.repeat(40), event: 'schedule', brokerEnvironment: 'PAPER', executionEnvironment: 'DRY_RUN' },
      outputs: { 'performance-dashboard.json': hash }, previousOutputs: {}, inputs: hashes, inputsAfter: hashes,
      startedAt: at, finishedAt: at });
  };
  let telegramCalls = 0;
  const fetchImpl = async (url, options) => {
    telegramCalls++; assert.equal(new URL(url).hostname, 'api.telegram.org'); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('chat_id'), 'private-fixture-route');
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const run = patch => runNotificationDelivery({ env, stateDirectory, bindingDirectory, fetchImpl, now: Date.parse(at), ...patch });
  bind(accepted);
  for (const patch of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_RUN_ATTEMPT: '2' },
    { ALPACA_BASE_URL: 'https://api.alpaca.markets' }, { EXEC_ENABLED: 'true' }, { READ_ONLY: 'false' }]) {
    assert.equal((await run({ env: { ...env, ...patch } })).status, 'AUTOMATIC_PAPER_OBSERVATION_REQUIRED');
  }
  assert.equal((await run({ env: { ...env, TELEGRAM_SEND_ENABLED: 'false' } })).status, 'NOTIFICATION_DISABLED');
  assert.equal((await run({ env: { ...env, TELEGRAM_SIMULATION_CHAT_ID: '' } })).status, 'SIMULATION_ROUTE_NOT_CONFIGURED');
  assert.equal((await run()).status, 'BASELINE_RECORDED');
  bind(partial);
  assert.equal((await run()).status, 'DELIVERED');
  assert.equal((await run()).status, 'NO_CHANGE');
  bind(filled);
  assert.equal((await run({ fetchImpl: async () => { telegramCalls++; return { ok: true, json: async () => ({ ok: false }) }; } })).status, 'DELIVERY_UNCERTAIN');
  assert.equal((await run()).status, 'NO_CHANGE');
  assert.equal(telegramCalls, 2);
  const persisted = fs.readFileSync(path.join(stateDirectory, 'paper-order-notification-receipts.json'), 'utf8');
  for (const privateValue of ['TESTX', 'private-fixture-route', 'fake-test-token']) assert.equal(persisted.includes(privateValue), false);
  write(path.join(stateDirectory, 'performance-dashboard.json'), { generatedAt: at, notificationSnapshot: accepted });
  assert.equal((await run()).status, 'SOURCE_BINDING_INVALID');
  bind(accepted);
  write(path.join(stateDirectory, 'order-ledger.json'), { orders: { changed: {} } });
  assert.equal((await run()).status, 'SOURCE_BINDING_INVALID');
  assert.equal(telegramCalls, 2);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('paper-order-notifications: PASS (synthetic snapshots/mock sender only; brokerRequests=0; actualSends=0)');
