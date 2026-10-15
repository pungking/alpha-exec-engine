import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { observePaperIex, main, APPROVAL, reviewedCodeSha256, CODE_FILES } from './run-paper-iex-readonly-probe.mjs';
import { paperFixture } from './fixtures/scoped-paper-adapter.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iex-readonly-fixture-')));
const sha = v => createHash('sha256').update(v).digest('hex');
const env = { ALPHA_ENV: 'PAPER', ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
  READ_ONLY: 'true', EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe',
  FORCE_SEND_ONCE: 'false', GUARD_EXECUTE_TIGHTEN_STOPS: 'false', GUARD_EXECUTE_REDUCE_POSITIONS: 'false', GUARD_EXECUTE_FLATTEN: 'false',
  ALPACA_KEY_ID: 'fixture-key-private', ALPACA_SECRET_KEY: 'fixture-secret-private' };
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
let cases = 0;
function source(f) {
  const directory = fs.mkdtempSync(path.join(root, 'source-')), ledger = {}, idem = {};
  for (const [i, a] of f.assets.entries()) {
    const key = `private-key-${i}`, row = { symbol: a.symbol, clientOrderId: `private-client-${i}`, brokerOrderId: i ? `private-broker-${i}` : null,
      idempotencyKey: key, stage6File: 'fixture-stage6.json', stage6Hash: 'a'.repeat(64), side: 'buy', status: 'filled' };
    ledger[key] = row;
    idem[key] = { ...row, recoveryMode: 'ACTIVE_POSITION_LIMITED_CONTROL', recoveryEvidenceSha256: 'b'.repeat(64),
      recoveryRecordedAtIsOriginalTimestamp: false, reportOnlyExitEvaluationAllowed: true, entryAllowed: false,
      scaleInAllowed: false, riskIncreasingActionAllowed: false, brokerSubmitAllowed: false, realizedPnlVerified: false, historicalEvidenceNormalized: false };
  }
  const data = { 'order-ledger.json': { orders: ledger }, 'order-idempotency.json': { orders: idem, releases: [] },
    'last-dry-exec-preview.json': { historicalOnly: true } };
  function persist() {
    const files = {};
    for (const [name, value] of Object.entries(data)) {
      const bytes = JSON.stringify(value); fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600 }); files[name] = sha(bytes);
    }
    const manifest = { schemaVersion: 'paper-private-capture-source-v1', environment: 'PAPER', sourceRunId: '12345',
      evidenceBasis: 'PRESERVED_STATE_SNAPSHOT', expectedPaperAccountSha256: sha(f.accountId), files };
    const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(directory, 'source-manifest.json'), bytes, { mode: 0o600 });
    return sha(bytes);
  }
  return { directory, data, persist };
}
async function run({ change = () => {}, tamper = () => {}, response, configChange = {}, envChange = {}, approval = APPROVAL,
  expected = 'OBSERVATION_COMPLETE_UNITS_UNVERIFIED', requests = 3, inspect = () => {} } = {}) {
  const f = paperFixture(), s = source(f); change(s.data, f); const pin = s.persist(); tamper(s.directory);
  const before = Object.fromEntries(fs.readdirSync(s.directory).map(n => [n, sha(fs.readFileSync(path.join(s.directory, n)))]));
  const config = { sourceDirectory: s.directory, sourceManifestSha256: pin, outputDirectory: path.join(root, `attempt-${cases++}`),
    reviewedCodeSha256: reviewedCodeSha256(), ...configChange };
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.ok(fs.existsSync(path.join(config.outputDirectory, 'attempt.json')));
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    const u = new URL(url), group = u.pathname.endsWith('/quotes/latest') ? 'quotes' : u.pathname.split('/').at(-1);
    assert.ok(['account', 'clock', 'quotes'].includes(group));
    assert.equal(u.origin, group === 'quotes' ? 'https://data.alpaca.markets' : 'https://paper-api.alpaca.markets');
    if (group === 'quotes') { assert.equal(u.searchParams.get('feed'), 'iex'); assert.equal(u.searchParams.get('currency'), 'USD');
      assert.deepEqual(u.searchParams.get('symbols').split(','), f.assets.map(a => a.symbol).sort()); }
    calls.push(group);
    const override = response?.(group, f.bodies[group], calls);
    return override ?? new Response(JSON.stringify(f.bodies[group]));
  };
  const result = await observePaperIex({ config, env: { ...env, ...envChange }, approval, fetchImpl, clock: f.clock });
  assert.equal(result.status, expected); assert.equal(calls.length, requests); assert.equal(result.requestCounts.total, requests);
  assert.equal(result.requestBudgetCompliant, true); assert.equal(result.executionReadinessEvaluated, false);
  assert.equal(result.quoteSizeUnitsVerified, false); assert.equal(result.currentPortfolioVerified, false);
  for (const k of ['brokerSubmitAllowed', 'stateMutationAttempted', 'rawResponseStored', 'realizedPnlVerified', 'historicalEvidenceNormalized']) assert.equal(result[k], false);
  assert.equal(result.selectedCandidateCount, 0);
  const output = JSON.stringify(result) + (fs.existsSync(config.outputDirectory)
    ? fs.readdirSync(config.outputDirectory).map(n => fs.readFileSync(path.join(config.outputDirectory, n), 'utf8')).join('') : '');
  for (const marker of ['FIX0', 'private-client', 'private-key', 'private-broker', f.accountId, env.ALPACA_KEY_ID, env.ALPACA_SECRET_KEY, 'RAW_SECRET', f.bodies.clock.timestamp]) assert.ok(!output.includes(marker));
  for (const [name, hash] of Object.entries(before)) assert.equal(sha(fs.readFileSync(path.join(s.directory, name))), hash);
  if (fs.existsSync(config.outputDirectory)) {
    assert.equal(fs.statSync(config.outputDirectory).mode & 0o077, 0);
    for (const name of fs.readdirSync(config.outputDirectory)) assert.equal(fs.statSync(path.join(config.outputDirectory, name)).mode & 0o077, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.outputDirectory, 'result.json'))), result);
  }
  await inspect(result, { config, f, fetchImpl, calls });
  return result;
}
try {
  const poison = new Proxy({}, { get() { throw Error('DEFAULT_IO'); } });
  assert.equal((await main([], poison)).status, 'NOT_RUN');
  assert.equal((await main(['--execute'], poison)).status, 'ARGUMENTS_INVALID');
  await run({ inspect: async (result, { config, f, fetchImpl, calls }) => {
    assert.equal(result.historicalTargetRows, 5); assert.equal(result.quoteRows, 5); assert.equal(result.accountPinMatched, true);
    assert.equal(result.missingOriginalBrokerIdRows, 1);
    const saved = fs.readFileSync(path.join(config.outputDirectory, 'result.json'));
    const dup = await observePaperIex({ config, env, approval: APPROVAL, fetchImpl, clock: f.clock });
    assert.equal(dup.status, 'ATTEMPT_EXISTS'); assert.equal(dup.requestCounts.total, 0); assert.equal(calls.length, 3);
    assert.deepEqual(fs.readFileSync(path.join(config.outputDirectory, 'result.json')), saved);
  } });
  const a = await run(), b = await run(); assert.deepEqual(a, b);
  await run({ approval: 'old approval', expected: 'APPROVAL_REQUIRED', requests: 0 });
  await run({ envChange: { ALPACA_KEY_ID: '' }, expected: 'CREDENTIALS_MISSING', requests: 0 });
  for (const [key, value] of Object.entries({ ALPHA_ENV: 'LIVE', READ_ONLY: 'false', EXEC_ENABLED: 'true', ALPACA_BASE_URL: 'https://api.alpaca.markets', GUARD_EXECUTE_FLATTEN: 'true' }))
    await run({ envChange: { [key]: value }, expected: 'SAFETY_CONFIG_INVALID', requests: 0 });
  await run({ configChange: { reviewedCodeSha256: '0'.repeat(64) }, expected: 'REVIEWED_CODE_MISMATCH', requests: 0 });
  await run({ configChange: { sourceManifestSha256: '0'.repeat(64) }, expected: 'SOURCE_CONTRACT_INVALID', requests: 0 });
  await run({ tamper: dir => fs.appendFileSync(path.join(dir, 'order-ledger.json'), ' '), expected: 'SOURCE_CONTRACT_INVALID', requests: 0 });
  await run({ change: d => { d['order-ledger.json'].orders.extra = { ...Object.values(d['order-ledger.json'].orders)[0] }; }, expected: 'SOURCE_CONTRACT_INVALID', requests: 0 });
  await run({ change: d => { delete d['order-idempotency.json'].orders['private-key-4']; }, expected: 'TARGET_COUNT_INVALID', requests: 0 });
  await run({ response: (g, body) => g === 'account' ? new Response(JSON.stringify({ ...body, id: 'wrong-account' })) : undefined,
    expected: 'ACCOUNT_PIN_MISMATCH', requests: 1 });
  await run({ change: (_, f) => { f.bodies.clock.is_open = false; }, expected: 'MARKET_CLOSED', requests: 2 });
  for (const timestamp of ['invalid', '2026-02-30T15:00:00Z', '2026-10-09T14:59:29Z', '2026-10-09T15:00:00.000000001Z'])
    await run({ change: (_, f) => { f.bodies.clock.timestamp = timestamp; }, expected: 'CLOCK_INVALID', requests: 2 });
  for (const mutate of [q => { q.FIX0.t = null; }, q => { q.FIX0.t = '2026-10-09T14:59:29Z'; },
    q => { q.FIX0.t = '2026-10-09T15:00:00.000000001Z'; }, q => { q.FIX0.bx = 'N'; },
    q => { q.FIX0.bp = 0; }, q => { q.FIX0.bs = -1; }, q => { q.FIX0.bp = 101; },
    q => { delete q.FIX0; }, q => { q.EXTRA = q.FIX0; }])
    await run({ change: (_, f) => mutate(f.bodies.quotes.quotes), expected: 'QUOTES_INVALID', requests: 3 });
  for (const status of [401, 403, 429, 500]) await run({ response: () => new Response('RAW_SECRET', { status }), expected: 'HTTP_FAILURE', requests: 1 });
  await run({ response: () => { throw Error('RAW_SECRET'); }, expected: 'TRANSPORT_FAILURE', requests: 1 });
  await run({ response: () => new Response('RAW_SECRET'), expected: 'JSON_INVALID', requests: 1 });
  await run({ response: () => new Response(new ReadableStream({ start(c) { c.error(Error('RAW_SECRET')); } })), expected: 'TRANSPORT_FAILURE', requests: 1 });
  await run({ response: () => new Promise(() => {}), expected: 'REQUEST_TIMEOUT', requests: 1 });
  await run({ change: (_, f) => { f.bodies.quotes.quotes.FIX0.bs = 1; f.bodies.quotes.quotes.FIX1.bs = 200; }, inspect: r => assert.equal(r.quoteSizeUnitsVerified, false) });
  const child = spawnSync(process.execPath, [path.resolve('scripts/run-paper-iex-readonly-probe.mjs')], { cwd: root, encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--require=${path.resolve('scripts/fixtures/scoped-paper-offline.cjs')}` } });
  assert.equal(child.status, 0); assert.equal(JSON.parse(child.stdout).status, 'NOT_RUN'); assert.equal(child.stderr, '');
  // A newly imported runtime module must be added to the reviewed byte hash, not silently omitted.
  for (const file of CODE_FILES) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g))
      assert.ok(CODE_FILES.includes(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))));
  }
  console.log(`PAPER IEX read-only probe: PASS (${cases} offline cases; no real network/state/orders)`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
