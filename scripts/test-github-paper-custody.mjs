import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryGithub, sourceBytes, sha, file } from './fixtures/github-paper-custody.mjs';
import { withScopedStores, reserveScopedExits, recordScopedAttempt, withScopedObservationStores } from './lib/scoped-closeout-storage.mjs';
import { managementRecord, hash, at } from './fixtures/scoped-closeout.mjs';
import { buildNotificationSnapshot, deliverNotifications } from './paper-order-notifications.mjs';

const custody = await import('./lib/github-paper-custody.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
for (const name of ['validateGithubCustodyConfiguration', 'openGithubCustody',
  'checkpointGithubCustody', 'assertGithubCustody', 'releaseGithubCustody'])
  assert.equal(typeof custody[name], 'function', `${name} must exist`);
assert.equal(custody.validateGithubCustodyConfiguration({}).status, 'BLOCKED');
assert.throws(() => custody.assertGithubCustody({}), /GITHUB_CUSTODY_/);

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'github-custody-fixture-')));
await fs.chmod(root, 0o700);
let n = 0, checks = 3;
const open = async (f, extra = {}) => custody.openGithubCustody({ config: f.config, request: f.request,
  privateKey: f.privateKey, directory: path.join(root, `restore-${n++}`), ...extra });
try {
  const f = memoryGithub(), directory = path.join(root, `restore-${n++}`);
  assert.equal(custody.validateGithubCustodyConfiguration(f.config).status, 'VALID_NOT_EXECUTION_READY'); checks++;
  const session = await open(f, { directory });
  assert.equal(custody.assertGithubCustody(session, { directory, accountSha256: f.config.accountSha256, attemptId: f.config.attemptId }), true); checks++;
  assert.deepEqual(await fs.readFile(path.join(directory, 'inputs/source.json')), sourceBytes); checks++;
  assert.equal((await fs.stat(path.join(directory, 'order-ledger.json'))).mode & 0o077, 0); checks++;
  assert.throws(() => custody.assertGithubCustody(structuredClone(session)), /GITHUB_CUSTODY_/); checks++;
  assert.throws(() => custody.assertGithubCustody(session, { accountSha256: sha('wrong') }), /GITHUB_CUSTODY_/); checks++;
  const before = f.head();
  await custody.checkpointGithubCustody(session, 'OBSERVATION');
  assert.notEqual(f.head(), before); checks++;
  await custody.releaseGithubCustody(session);
  assert.throws(() => custody.assertGithubCustody(session), /GITHUB_CUSTODY_/); checks++;
  const handoff = await open(f, { config: { ...f.config, expectedCommit: f.head(), runId: '3' } });
  await custody.releaseGithubCustody(handoff); checks++;
  for (const patch of [{ runAttempt: 2 }, { ref: 'refs/heads/main' }, { expectedCommit: null },
    { maxRequests: 0 }, { inputFiles: {} }, { environment: 'LIVE' }]) {
    const bad = memoryGithub(); bad.config = { ...bad.config, ...patch };
    await assert.rejects(open(bad), /GITHUB_CUSTODY_/); assert.equal(bad.calls.length, 0); checks++;
  }
  for (const mutatePayload of [p => { p.accountSha256 = sha('wrong'); },
    p => { p.files[0].sha256 = sha('wrong'); }, p => { p.files.push(p.files[0]); },
    p => { p.files[0].path = '../escape'; }, p => { p.files = p.files.filter(x => x.path !== 'inputs/source.json'); },
    p => { p.files.push(file('inputs/secret.json', { apiKey: 'fixture-secret' })); }]) {
    await assert.rejects(open(memoryGithub({ mutatePayload })), /GITHUB_CUSTODY_/); checks++;
  }
  const wrongKey = memoryGithub(); wrongKey.config.recipientSha256 = sha('another-key');
  await assert.rejects(open(wrongKey), /KEY_MISMATCH/); assert.equal(wrongKey.calls.length, 0); checks++;
  for (const field of ['Authorization', 'Cookie', 'api_key', 'access_token', 'privateKey']) {
    const source = file('inputs/source.json', { headers: { [field]: 'synthetic-credential-not-for-retention' } });
    const secret = memoryGithub({ mutatePayload: p => { p.files = p.files.map(f => f.path === source.path ? source : f); } });
    secret.config.inputFiles[source.path] = source.sha256;
    await assert.rejects(open(secret), /SECRET_FIELD/);
    assert.ok(secret.calls.every(c => c.method === 'GET')); checks++;
  }
  const missingRef = memoryGithub(); missingRef.fail = () => ({ status: 404, data: {} });
  await assert.rejects(open(missingRef), /GITHUB_CUSTODY_/); assert.equal(missingRef.calls.length, 1); checks++;
  const corrupted = memoryGithub();
  corrupted.fail = ({ path }) => path.includes('/blobs/') ? { status: 200, data: { sha: path.split('/').at(-1), encoding: 'base64', content: 'e30=' } } : null;
  await assert.rejects(open(corrupted), /BLOB_INVALID/); checks++;
  const fork = memoryGithub(); fork.objects.get(fork.head()).parents = [{ sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40) }];
  await assert.rejects(open(fork), /COMMIT_INVALID/); checks++;
  for (const missingPair of [true, false]) {
    const incomplete = memoryGithub({ mutatePayload: p => {
      const hashes = { orderLedger: p.files.find(f => f.path === 'order-ledger.json').sha256,
        orderIdempotency: p.files.find(f => f.path === 'order-idempotency.json').sha256 };
      const records = Array.from({ length: 5 }, (_, i) => ({ ...managementRecord(i), preWriteHashes: hashes }));
      p.files = p.files.map(f => f.path === 'order-ledger.json' ? file(f.path, { orders: Object.fromEntries(records.map(r => [r.exitIdempotencyKey, r])), updatedAt: at })
        : f.path === 'order-idempotency.json' && !missingPair ? file(f.path, { orders: Object.fromEntries(records.map(r => [r.exitIdempotencyKey, r])), releases: [], updatedAt: at }) : f);
    } });
    await assert.rejects(open(incomplete), /GITHUB_CUSTODY_/); checks++;
  }
  const lost = memoryGithub(), lostSession = await open(lost);
  lost.afterPatch = () => { throw Error('raw sensitive server text must not escape'); };
  await assert.rejects(custody.checkpointGithubCustody(lostSession, 'OBSERVATION'), e => /^GITHUB_CUSTODY_[A-Z_]+$/.test(e.message));
  const count = lost.calls.length;
  await assert.rejects(custody.checkpointGithubCustody(lostSession, 'OBSERVATION'), /GITHUB_CUSTODY_/);
  assert.equal(lost.calls.length, count); checks += 3;
  const held = memoryGithub(); await open(held);
  await assert.rejects(open(held, { config: { ...held.config, expectedCommit: held.head(), runId: '3' } }), /GITHUB_CUSTODY_WRITER_ACTIVE/); checks++;
  const timeout = memoryGithub(); timeout.config.timeoutMs = 5;
  timeout.request = () => new Promise(() => {});
  await assert.rejects(open(timeout), /GITHUB_CUSTODY_/); checks++;
  const budget = memoryGithub(); budget.config.maxRequests = 1;
  await assert.rejects(open(budget), /GITHUB_CUSTODY_/); assert.equal(budget.calls.length, 1); checks++;
  const barrier = memoryGithub(), storeDir = path.join(root, `restore-${n++}`), binding = await open(barrier, { directory: storeDir });
  const expectedHashes = Object.fromEntries(await Promise.all([['orderLedger', 'order-ledger.json'], ['orderIdempotency', 'order-idempotency.json']]
    .map(async ([k, name]) => [k, sha(await fs.readFile(path.join(storeDir, name)))])));
  await assert.rejects(withScopedStores({ directory: storeDir, expectedHashes, attemptId: barrier.config.attemptId, custody: binding }, async ctx => {
    barrier.fail = ({ method }) => method === 'POST' ? { status: 500, data: {} } : null;
    await reserveScopedExits(ctx, Array.from({ length: 5 }, (_, i) => ({ ...managementRecord(i), preWriteHashes: expectedHashes })));
  }), /SCOPED_STORE_/); checks++;
  const monotone = memoryGithub(), monoDir = path.join(root, `restore-${n++}`), mono = await open(monotone, { directory: monoDir });
  await withScopedStores({ directory: monoDir, expectedHashes, attemptId: monotone.config.attemptId, custody: mono }, async ctx => {
    await reserveScopedExits(ctx, Array.from({ length: 5 }, (_, i) => ({ ...managementRecord(i), preWriteHashes: expectedHashes })));
  });
  await fs.writeFile(path.join(monoDir, 'order-ledger.json'), JSON.stringify({ orders: {}, updatedAt: '' }));
  await fs.writeFile(path.join(monoDir, 'order-idempotency.json'), JSON.stringify({ orders: {}, releases: [], updatedAt: '' }));
  await assert.rejects(custody.checkpointGithubCustody(mono, 'OBSERVATION'), /GITHUB_CUSTODY_/); checks++;
  const observed = memoryGithub(), firstDir = path.join(root, `restore-${n++}`), first = await open(observed, { directory: firstDir });
  let observationHashes;
  await withScopedStores({ directory: firstDir, expectedHashes, attemptId: observed.config.attemptId, custody: first }, async ctx => {
    const records = Array.from({ length: 5 }, (_, i) => ({ ...managementRecord(i), preWriteHashes: expectedHashes }));
    await reserveScopedExits(ctx, records);
    observationHashes = (await recordScopedAttempt(ctx, records[0].exitIdempotencyKey, hash('wire'),
      { at, limitPrice: '99.9', evidenceSha256: hash('evidence') })).storeHashes;
  });
  await custody.releaseGithubCustody(first);
  const observerDir = path.join(root, `restore-${n++}`), observer = await open(observed,
    { directory: observerDir, config: { ...observed.config, expectedCommit: observed.head(), runId: '3' } });
  const observation = { directory: observerDir, expectedHashes: observationHashes, attemptId: observed.config.attemptId,
    authoritySha256: hash('once'), custody: observer };
  let reads = 0;
  await withScopedObservationStores(observation, async () => { assert.equal(observed.snapshot().phase, 'OBSERVATION_CLAIM'); reads++; });
  assert.equal(reads, 1);
  await custody.releaseGithubCustody(observer);
  const nextDir = path.join(root, `restore-${n++}`), next = await open(observed,
    { directory: nextDir, config: { ...observed.config, expectedCommit: observed.head(), runId: '4' } });
  await assert.rejects(withScopedObservationStores({ ...observation, directory: nextDir, custody: next }, () => { reads++; }), /OBSERVATION_AUTHORITY_USED/);
  assert.equal(reads, 1); checks += 3;
  const input = { accountId: 'synthetic-account', paper: true, runId: '123', headSha: 'a'.repeat(40), observedAt: at,
    complete: true, positions: [], openOrders: [], closedOrders: [], orderLedger: { orders: {} }, orderIdempotency: { orders: {} }, realizedPnl: { rows: [] } };
  const baseline = buildNotificationSnapshot(input), notifications = memoryGithub({ mutatePayload: p => { p.accountSha256 = baseline.accountSha256; } });
  notifications.config.accountSha256 = baseline.accountSha256;
  const noticeDir = path.join(root, `restore-${n++}`), notice = await open(notifications, { directory: noticeDir });
  const receiptDir = path.join(noticeDir, `.scoped-closeout-${notifications.config.attemptId}`);
  await fs.mkdir(receiptDir, { mode: 0o700 }); const receiptPath = path.join(receiptDir, 'notifications.json'); let sends = 0;
  const wrongReceipt = path.join(receiptDir, 'unapproved.json');
  assert.equal((await deliverNotifications({ snapshot: baseline, receiptPath: wrongReceipt, custody: notice,
    send: () => { sends++; } })).status, 'RECEIPT_INVALID');
  await assert.rejects(fs.stat(wrongReceipt), { code: 'ENOENT' }); checks++;
  assert.equal((await deliverNotifications({ snapshot: baseline, receiptPath, custody: notice, send: () => { sends++; } })).status, 'BASELINE_RECORDED');
  const current = buildNotificationSnapshot({ ...input, openOrders: [{ id: 'synthetic-order', client_order_id: 'synthetic-client', symbol: 'TESTX',
    side: 'buy', type: 'limit', status: 'new', qty: '2', filled_qty: '0', submitted_at: at, updated_at: at }] });
  notifications.afterPatch = () => { throw Error('fixture lost notification persistence ack'); };
  const noticeResult = await deliverNotifications({ snapshot: current, receiptPath, custody: notice, send: () => { sends++; } });
  assert.equal(noticeResult.status, 'RECEIPT_WRITE_FAILED'); assert.equal(sends, 0); checks += 3;
  assert.equal((await deliverNotifications({ snapshot: current, receiptPath, custody: notice, send: () => { sends++; } })).status, 'RECEIPT_INVALID');
  assert.equal(sends, 0); checks++;
  const stale = memoryGithub(), old = stale.config.expectedCommit;
  await open(stale);
  await assert.rejects(open(stale, { config: { ...stale.config, expectedCommit: old } }), /HEAD_DRIFT/); checks++;
  const shallow = memoryGithub(); const ss = await open(shallow); await custody.releaseGithubCustody(ss);
  await assert.rejects(open(shallow, { config: { ...shallow.config, expectedCommit: shallow.head(), maxHistory: 1 } }), /HISTORY_LIMIT/); checks++;
  const shared = memoryGithub();
  const collision = await Promise.allSettled([open(shared), open(shared, { config: { ...shared.config, runId: '3' } })]);
  assert.equal(collision.filter(r => r.status === 'fulfilled').length, 1); checks++;
  const escaped = memoryGithub(), escapedDir = path.join(root, `restore-${n++}`), escaping = await open(escaped, { directory: escapedDir });
  await fs.symlink(path.join(escapedDir, 'order-ledger.json'), path.join(escapedDir, 'inputs/alias.json'));
  await assert.rejects(custody.checkpointGithubCustody(escaping, 'OBSERVATION'), /PATH_INVALID/); checks++;
  for (const call of f.calls.filter(x => x.method !== 'GET')) {
    assert.ok(!JSON.stringify(call).includes(f.config.accountSha256));
    assert.ok(!JSON.stringify(call).includes('synthetic-source-only'));
    if (call.method === 'PATCH') assert.equal(call.body.force, false);
  } checks++;
  console.log(JSON.stringify({ status: 'OFFLINE_GITHUB_CUSTODY_PASS', checks, brokerRequests: 0, operationalStateChanged: false }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
await import('./test-github-paper-custody-rest.mjs');
await import('./test-github-paper-review-evidence.mjs');
await import('./test-paper-custody-runtime-boundary.mjs');
await import('./test-github-paper-custody-lineage-readonly.mjs');
await import('./test-github-paper-protected-lineage.mjs');
