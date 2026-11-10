import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { encryptPayload, decryptPayload } from './paper-exact-cache-private-export.mjs';

const script = path.resolve('scripts/paper-state-candidate-export.mjs');
assert.ok(fs.existsSync(script), 'Missing independently scoped PAPER state candidate exporter');
const { APPROVAL, validateCandidateScope, prepareCandidateAttempt, preflightCandidateAttempt,
  encryptCandidateSource, decryptCandidateSource } = await import(pathToFileURL(script));
const step3aOnly = process.argv.includes('--step3a');
const step3bOnly = process.argv.includes('--step3b');
const childNodeOptions = ['--require', path.resolve('scripts/fixtures/scoped-paper-offline.cjs')];
const sha = b => createHash('sha256').update(b).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'paper-candidate-fixture-')));
const keys = !step3aOnly && typeof encryptCandidateSource === 'function' && typeof decryptCandidateSource === 'function'
  ? generateKeyPairSync('rsa', { modulusLength: 3072 }) : null;
// STEP 3A needs only a synthetic public ASN.1 fixture, not a generated key pair.
const publicDer = keys ? keys.publicKey.export({ type: 'spki', format: 'der' })
  : Buffer.from('308201a2300d06092a864886f70d01010105000382018f003082018a0282018100'
    + '80' + '11'.repeat(383) + '0203010001', 'hex');
const scope = { schemaVersion: 'paper-state-candidate-scope-v1', repository: 'fixture/engine',
  exportCommit: 'a'.repeat(40), sourceRunId: '123', sourceRunAttempt: 1, sourceHeadSha: 'b'.repeat(40),
  sourceWorkflow: '.github/workflows/dry-run.yml', sourceEvent: 'schedule', sourceConclusion: 'success',
  cacheId: '456', cacheKey: 'sidecar-state-main-123', cacheVersion: 'c'.repeat(64), recipientSha256: sha(publicDer) };
const scopeBytes = Buffer.from(JSON.stringify(scope));
const env = { CANDIDATE_SCOPE_JSON: scopeBytes.toString(), CANDIDATE_SCOPE_SHA256: sha(scopeBytes),
  RECIPIENT_PUBLIC_KEY: publicDer.toString('base64'), APPROVAL_PHRASE: APPROVAL,
  GITHUB_REPOSITORY: scope.repository, GITHUB_SHA: scope.exportCommit, GITHUB_RUN_ID: '789',
  GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch',
  ALPHA_ENV: 'PAPER', READ_ONLY: 'true', EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false',
  MARKET_GUARD_MODE: 'observe', CACHE_HIT: 'true', CACHE_MATCHED_KEY: scope.cacheKey };
const history = { total_count: 1, workflow_runs: [{ id: 789, run_attempt: 1, head_sha: scope.exportCommit,
  head_branch: 'main', event: 'workflow_dispatch', path: '.github/workflows/paper-state-candidate-export.yml',
  status: 'in_progress', conclusion: null, repository: { full_name: scope.repository },
  created_at: '2026-01-02T16:00:00Z' }] };
const run = { id: 123, run_attempt: 1, head_sha: scope.sourceHeadSha, head_branch: 'main', event: 'schedule',
  path: scope.sourceWorkflow, repository: { full_name: scope.repository }, status: 'completed', conclusion: 'success',
  created_at: '2026-01-02T14:00:00Z', run_started_at: '2026-01-02T14:01:00Z', updated_at: '2026-01-02T14:05:00Z' };
const cache = { id: 456, key: scope.cacheKey, version: scope.cacheVersion, ref: 'refs/heads/main',
  created_at: '2026-01-02T14:04:00Z', size_in_bytes: 1000, last_accessed_at: '2026-01-02T14:04:00Z' };
const caches = { total_count: 1, actions_caches: [cache] };
const write = (p, v) => fs.writeFileSync(p, Buffer.isBuffer(v) ? v : JSON.stringify(v), { mode: 0o600 });
let cases = 0, sequence = 0;
function check(f) { f(); cases++; }
function reject(f, code) { check(() => assert.throws(f, e => e.message === code)); }
function attempt(e = env) {
  const d = path.join(root, 'attempt-' + sequence++);
  prepareCandidateAttempt(d, e);
  for (const [n, v] of [['history.json', history], ['source-run.json', run], ['caches-before.json', caches], ['caches-after.json', caches]]) write(path.join(d, n), v);
  return d;
}
function source() {
  const d = path.join(root, 'source-' + sequence++); fs.mkdirSync(d, { mode: 0o700 });
  write(path.join(d, 'order-ledger.json'), { orders: {}, updatedAt: '' });
  write(path.join(d, 'order-idempotency.json'), { orders: {}, releases: [], updatedAt: '' });
  write(path.join(d, 'last-dry-exec-preview.json'), { marker: 'SYNTHETIC_PRIVATE_DO_NOT_PRINT' });
  fs.mkdirSync(path.join(d, 'inputs'), { mode: 0o700 });
  write(path.join(d, 'inputs/terms.json'), { synthetic: true });
  write(path.join(d, 'unrelated-report.json'), { excluded: true });
  return d;
}
function ready() { const d = attempt(); preflightCandidateAttempt(d, env); return d; }
try {
  check(() => assert.deepEqual(validateCandidateScope(scopeBytes, sha(scopeBytes)), scope));
  reject(() => validateCandidateScope(scopeBytes, 'f'.repeat(64)), 'CANDIDATE_SCOPE_HASH_MISMATCH');
  const extra = Buffer.from(JSON.stringify({ ...scope, accountId: 'SYNTHETIC_SECRET' }));
  reject(() => validateCandidateScope(extra, sha(extra)), 'CANDIDATE_SCOPE_INVALID');
  for (const [k, v] of [['sourceRunAttempt', 2], ['cacheKey', '../state'], ['sourceWorkflow', '../../unsafe'],
    ['repository', 'fixture/engine?token=secret'], ['sourceRunId', '0'], ['cacheVersion', 'bad']]) {
    const bad = Buffer.from(JSON.stringify({ ...scope, [k]: v }));
    reject(() => validateCandidateScope(bad, sha(bad)), 'CANDIDATE_SCOPE_INVALID');
  }
  for (const [k, v] of [['APPROVAL_PHRASE', 'AUTHORIZE PAPER EXACT-CACHE ENCRYPTED PRIVATE EXPORT ONE-SHOT'],
    ['READ_ONLY', 'false'], ['EXEC_ENABLED', 'true'], ['LIVE_ORDER_SUBMIT_ENABLED', 'true'], ['ALPHA_ENV', 'LIVE'],
    ['MARKET_GUARD_MODE', 'execute'], ['GITHUB_EVENT_NAME', 'schedule'], ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_REPOSITORY', 'other/repo'], ['GITHUB_SHA', 'f'.repeat(40)], ['GITHUB_REF', 'refs/heads/feature']]) {
    const d = path.join(root, 'denied-' + sequence++);
    check(() => { assert.throws(() => prepareCandidateAttempt(d, { ...env, [k]: v })); assert.equal(fs.existsSync(d), false); });
  }
  const d = attempt();
  reject(() => prepareCandidateAttempt(d, env), 'CANDIDATE_ATTEMPT_EXISTS');
  check(() => preflightCandidateAttempt(d, env));
  reject(() => preflightCandidateAttempt(d, env), 'CANDIDATE_OUTPUT_EXISTS');
  for (const [file, value, code] of [
    ['history.json', { ...history, total_count: 2 }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['history.json', { ...history, workflow_runs: [] }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['source-run.json', { ...run, head_sha: 'd'.repeat(40) }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, run_attempt: 2 }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, repository: { full_name: 'other/repo' } }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, status: 'in_progress' }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['caches-before.json', { total_count: 2, actions_caches: [cache, cache] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, id: 457 }] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, key: scope.cacheKey + '-prefix' }] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, created_at: '2026-01-03T00:00:00Z' }] }, 'CANDIDATE_CACHE_TIME_INVALID'],
  ]) { const a = attempt(); write(path.join(a, file), value); reject(() => preflightCandidateAttempt(a, env), code); }
  const scoped = value => { const bytes = Buffer.from(JSON.stringify(value)); return () => validateCandidateScope(bytes, sha(bytes)); };
  for (const value of [null, [], {}, { ...scope, sourceRunAttempt: '1' }, { ...scope, cacheId: 456 },
    { ...scope, sourceConclusion: 'unknown' }, { ...scope, sourceEvent: 'push' },
    { ...scope, recipientSha256: 'bad' }, { ...scope, sourceHeadSha: '' }]) reject(scoped(value), 'CANDIDATE_SCOPE_INVALID');
  for (const bytes of [Buffer.from('{'), Buffer.from('null'), Buffer.from([0xc0, 0xaf]), Buffer.alloc(8193, 0x20),
    Buffer.from(JSON.stringify(scope).replace('"sourceRunId":"123"', '"sourceRunId":"999","sourceRunId":"123"'))]) {
    reject(() => validateCandidateScope(bytes, sha(bytes)), 'CANDIDATE_SCOPE_INVALID');
  }
  const missing = { ...scope }; delete missing.cacheId;
  reject(scoped(missing), 'CANDIDATE_SCOPE_INVALID');
  const frozen = validateCandidateScope(scopeBytes, sha(scopeBytes));
  check(() => assert.ok(Object.isFrozen(frozen)));
  for (const name of ['APPROVAL_PHRASE', 'ALPHA_ENV', 'READ_ONLY', 'EXEC_ENABLED', 'LIVE_ORDER_SUBMIT_ENABLED',
    'MARKET_GUARD_MODE', 'GITHUB_RUN_ID', 'RECIPIENT_PUBLIC_KEY', 'CANDIDATE_SCOPE_SHA256']) {
    const e = { ...env }; delete e[name]; const target = path.join(root, 'missing-env-' + sequence++);
    check(() => { assert.throws(() => prepareCandidateAttempt(target, e)); assert.equal(fs.existsSync(target), false); });
  }
  for (const name of ['FORCE_SEND_ONCE', 'GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN']) {
    check(() => assert.throws(() => prepareCandidateAttempt(path.join(root, 'guard-' + sequence++), { ...env, [name]: 'true' })));
  }
  for (const id of ['0', '01', '1e3', '789\n']) check(() => assert.throws(() => prepareCandidateAttempt(path.join(root, 'run-id-' + sequence++), { ...env, GITHUB_RUN_ID: id })));
  const privateParent = path.join(root, 'public-parent'); fs.mkdirSync(privateParent, { mode: 0o755 }); fs.chmodSync(privateParent, 0o755);
  check(() => assert.throws(() => prepareCandidateAttempt(path.join(privateParent, 'attempt'), env)));
  const parentLink = path.join(root, 'parent-link'); fs.symlinkSync(root, parentLink);
  check(() => assert.throws(() => prepareCandidateAttempt(path.join(parentLink, 'linked-attempt'), env)));
  const prepared = attempt();
  check(() => assert.equal(fs.statSync(prepared).mode & 0o777, 0o700));
  check(() => assert.equal(fs.statSync(path.join(prepared, 'prepared.json')).mode & 0o777, 0o600));
  write(path.join(prepared, 'prepared.json'), { tampered: true });
  reject(() => preflightCandidateAttempt(prepared, env), 'CANDIDATE_PREPARED_MISMATCH');
  const rebound = attempt();
  reject(() => preflightCandidateAttempt(rebound, { ...env, GITHUB_RUN_ID: '790' }), 'CANDIDATE_PREPARED_MISMATCH');
  for (const [file, value, code] of [
    ['history.json', { ...history, workflow_runs: [{ ...history.workflow_runs[0], id: 790 }] }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['history.json', { ...history, workflow_runs: [{ ...history.workflow_runs[0], status: 'completed' }] }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['history.json', { ...history, workflow_runs: [{ ...history.workflow_runs[0], repository: { full_name: 'other/repo' } }] }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['history.json', { ...history, workflow_runs: [{ ...history.workflow_runs[0], path: '.github/workflows/other.yml' }] }, 'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT'],
    ['source-run.json', { ...run, id: 124 }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, event: 'workflow_dispatch' }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, conclusion: 'failure' }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, path: '.github/workflows/market-guard.yml' }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, head_branch: 'feature' }, 'CANDIDATE_SOURCE_RUN_MISMATCH'],
    ['source-run.json', { ...run, updated_at: '2026-01-03T00:00:00Z' }, 'CANDIDATE_SOURCE_TIME_INVALID'],
    ['source-run.json', { ...run, run_started_at: '2026-01-02T14:06:00Z' }, 'CANDIDATE_SOURCE_TIME_INVALID'],
    ['source-run.json', { ...run, created_at: '2026-02-30T14:00:00Z' }, 'CANDIDATE_SOURCE_TIME_INVALID'],
    ['caches-before.json', { total_count: 0, actions_caches: [] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, version: 'd'.repeat(64) }] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, ref: 'refs/heads/feature' }] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, size_in_bytes: -1 }] }, 'CANDIDATE_CACHE_MISMATCH'],
    ['caches-before.json', { total_count: 1, actions_caches: [{ ...cache, created_at: '2026-01-02T14:00:00Z' }] }, 'CANDIDATE_CACHE_TIME_INVALID'],
  ]) { const a = attempt(); write(path.join(a, file), value); reject(() => preflightCandidateAttempt(a, env), code); }
  for (const name of ['history.json', 'source-run.json', 'caches-before.json']) {
    const a = attempt(); write(path.join(a, name), Buffer.from('{"private":"SYNTHETIC_SECRET"'));
    reject(() => preflightCandidateAttempt(a, env), 'CANDIDATE_METADATA_INVALID');
    reject(() => preflightCandidateAttempt(a, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  }
  const linkedMeta = attempt(); fs.unlinkSync(path.join(linkedMeta, 'history.json'));
  fs.symlinkSync(path.join(d, 'history.json'), path.join(linkedMeta, 'history.json'));
  reject(() => preflightCandidateAttempt(linkedMeta, env), 'CANDIDATE_METADATA_INVALID');
  const modeMeta = attempt(); fs.chmodSync(path.join(modeMeta, 'history.json'), 0o644);
  reject(() => preflightCandidateAttempt(modeMeta, env), 'CANDIDATE_METADATA_INVALID');
  const duplicateMeta = attempt();
  write(path.join(duplicateMeta, 'source-run.json'), Buffer.from(JSON.stringify(run).replace('"run_attempt":1', '"run_attempt":2,"run_attempt":1')));
  reject(() => preflightCandidateAttempt(duplicateMeta, env), 'CANDIDATE_METADATA_INVALID');
  const aliasedMeta = attempt();
  write(path.join(aliasedMeta, 'source-run.json'), Buffer.from(JSON.stringify(run).replace('"run_attempt":1', '"run_\\u0061ttempt":2,"run_attempt":1')));
  reject(() => preflightCandidateAttempt(aliasedMeta, env), 'CANDIDATE_METADATA_INVALID');
  const nestedMeta = attempt();
  write(path.join(nestedMeta, 'source-run.json'), { ...run, extra: {
    actor: { id: 1 }, owner: { id: 2 }, items: [{ id: 3 }, { id: 4 }],
    text: 'escaped "strings": { and [ are data, not structure' } });
  check(() => preflightCandidateAttempt(nestedMeta, env));
  const deepMeta = attempt();
  write(path.join(deepMeta, 'source-run.json'), Buffer.from('{"extra":' + '['.repeat(101) + '0' + ']'.repeat(101) + '}'));
  reject(() => preflightCandidateAttempt(deepMeta, env), 'CANDIDATE_METADATA_INVALID');
  const hardMeta = attempt(); fs.linkSync(path.join(hardMeta, 'history.json'), path.join(hardMeta, 'history-copy.json'));
  reject(() => preflightCandidateAttempt(hardMeta, env), 'CANDIDATE_METADATA_INVALID');
  const badKey = path.join(root, 'bad-recipient-' + sequence++);
  reject(() => prepareCandidateAttempt(badKey, { ...env, RECIPIENT_PUBLIC_KEY: Buffer.from('not a key').toString('base64') }), 'CANDIDATE_RECIPIENT_INVALID');
  check(() => assert.equal(fs.existsSync(badKey), false));
  const retry = attempt(); write(path.join(retry, 'source-run.json'), { ...run, run_attempt: 2 });
  reject(() => preflightCandidateAttempt(retry, env), 'CANDIDATE_SOURCE_RUN_MISMATCH');
  write(path.join(retry, 'source-run.json'), run);
  reject(() => preflightCandidateAttempt(retry, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  const complete = ready(), receipt = JSON.parse(fs.readFileSync(path.join(complete, 'preflight.json')));
  check(() => assert.equal(receipt.metadataSha256['source-run.json'], sha(fs.readFileSync(path.join(complete, 'source-run.json')))));
  check(() => assert.equal(receipt.cache.version, scope.cacheVersion));
  check(() => assert.equal(fs.statSync(path.join(complete, 'preflight.json')).mode & 0o777, 0o600));
  const failedScope = { ...scope, sourceConclusion: 'failure' }, failedBytes = Buffer.from(JSON.stringify(failedScope));
  const failedEnv = { ...env, CANDIDATE_SCOPE_JSON: failedBytes.toString(), CANDIDATE_SCOPE_SHA256: sha(failedBytes) };
  const failedSource = attempt(failedEnv); write(path.join(failedSource, 'source-run.json'), { ...run, conclusion: 'failure' });
  check(() => preflightCandidateAttempt(failedSource, failedEnv));
  const guardProbe = spawnSync(process.execPath, [...childNodeOptions, '-e',
    "process.exit(globalThis.fetch?.name === 'deny' && require('node:https').get.name === 'deny' ? 0 : 1)"], { env: {}, encoding: 'utf8' });
  check(() => assert.equal(guardProbe.status, 0, 'Fixture child must preload the offline network guard'));
  const inert = spawnSync(process.execPath, [...childNodeOptions, script], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(inert.status, 0); assert.equal(JSON.parse(inert.stdout).status, 'CANDIDATE_EXPORT_NOT_RUN'); assert.equal(inert.stderr, ''); });
  console.log(JSON.stringify({ status: 'PASS', phase: 'STEP_3A', cases, brokerRequests: 0,
    runtimeExports: 0, stateAdopted: false, ephemeralKeyPairsGenerated: keys === null ? 0 : 1 }));
  if (!step3aOnly) {
  assert.equal(typeof encryptCandidateSource, 'function', 'STEP_3B_NOT_IMPLEMENTED: encryptCandidateSource');
  assert.equal(typeof decryptCandidateSource, 'function', 'STEP_3B_NOT_IMPLEMENTED: decryptCandidateSource');
  const s = source(), a = ready(), original = fs.readFileSync(path.join(s, 'order-ledger.json'));
  const result = encryptCandidateSource(s, a, env), encrypted = path.join(a, 'candidate.enc.json');
  check(() => assert.equal(result.status, 'ENCRYPTED_CANDIDATE_CREATED_NOT_ADOPTED'));
  check(() => assert.equal(result.fileCount, 4));
  check(() => assert.ok(!fs.readFileSync(encrypted).includes('SYNTHETIC_PRIVATE_DO_NOT_PRINT')));
  check(() => assert.ok(original.equals(fs.readFileSync(path.join(s, 'order-ledger.json')))));
  for (const k of ['currentStateAuthenticityVerified', 'sourceClosureVerified', 'stateAdopted', 'executionAuthorized', 'realizedPnlVerified']) check(() => assert.equal(result[k], false));
  reject(() => encryptCandidateSource(s, a, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  const keyFile = path.join(root, 'private.pem'), scopeFile = path.join(root, 'scope.json');
  write(keyFile, Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }))); write(scopeFile, scopeBytes);
  const output = path.join(root, 'opened');
  check(() => decryptCandidateSource(encrypted, keyFile, output, result.envelopeSha256, scopeFile, sha(scopeBytes), '789'));
  check(() => assert.ok(original.equals(fs.readFileSync(path.join(output, 'candidate/order-ledger.json')))));
  check(() => assert.equal(fs.existsSync(path.join(output, 'candidate/unrelated-report.json')), false));
  check(() => assert.equal(fs.statSync(path.join(output, 'candidate/order-ledger.json')).mode & 0o777, 0o600));
  reject(() => decryptCandidateSource(encrypted, keyFile, output, result.envelopeSha256, scopeFile, sha(scopeBytes), '789'), 'CANDIDATE_OUTPUT_EXISTS');
  check(() => assert.throws(() => decryptCandidateSource(encrypted, keyFile, path.join(root, 'wrong-run'), result.envelopeSha256, scopeFile, sha(scopeBytes), '790')));
  const e = JSON.parse(fs.readFileSync(encrypted)); e.ciphertext = Buffer.from('tampered').toString('base64');
  const tampered = path.join(root, 'tampered.json'); write(tampered, e);
  check(() => assert.throws(() => decryptCandidateSource(tampered, keyFile, path.join(root, 'tampered-out'), sha(fs.readFileSync(tampered)), scopeFile, sha(scopeBytes), '789')));
  const other = ready(), again = encryptCandidateSource(s, other, env);
  check(() => { assert.equal(again.manifestSha256, result.manifestSha256); assert.notEqual(again.envelopeSha256, result.envelopeSha256); });
  for (const [modify, code] of [
    [p => fs.unlinkSync(path.join(p, 'order-ledger.json')), 'CANDIDATE_SOURCE_REQUIRED_FILE_MISSING'],
    [p => write(path.join(p, '.scoped-closeout.lock'), { locked: true }), 'CANDIDATE_SOURCE_FENCE_OR_TEMP'],
    [p => write(path.join(p, 'order-ledger.json.lock'), { locked: true }), 'CANDIDATE_SOURCE_FENCE_OR_TEMP'],
    [p => write(path.join(p, 'inputs/token.json'), { authorization: 'SYNTHETIC_SECRET' }), 'CANDIDATE_SECRET_REJECTED'],
    [p => write(path.join(p, 'inputs/key.json'), { note: '-----BEGIN PRIVATE KEY-----' }), 'CANDIDATE_SECRET_REJECTED'],
    [p => fs.symlinkSync(path.join(p, 'order-ledger.json'), path.join(p, 'inputs/link.json')), 'CANDIDATE_SOURCE_PATH_INVALID'],
    [p => write(path.join(p, 'inputs/unfinished.json.tmp'), { partial: true }), 'CANDIDATE_SOURCE_PATH_INVALID'],
    [p => { fs.mkdirSync(path.join(p, '.scoped-closeout-fixture')); write(path.join(p, '.scoped-closeout-fixture/wire-0.json'), {}); }, 'CANDIDATE_BACKUP_MISSING'],
  ]) {
    const p = source(), at = ready(); modify(p);
    reject(() => encryptCandidateSource(p, at, env), code);
    check(() => assert.equal(fs.existsSync(path.join(at, 'candidate.enc.json')), false));
    reject(() => encryptCandidateSource(p, at, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  }
  const companions = source(), prefix = '.scoped-closeout-fixture', backup = Buffer.from('{"orders":{},"updatedAt":""}');
  fs.mkdirSync(path.join(companions, prefix));
  for (const name of ['order-ledger.json', 'order-idempotency.json']) write(path.join(companions, prefix, name), backup);
  for (const name of ['wire-0.json', 'observation-' + 'a'.repeat(64) + '.json', 'notifications.json']) write(path.join(companions, prefix, name), { synthetic: true });
  check(() => assert.equal(encryptCandidateSource(companions, ready(), env).fileCount, 9));
  const drift = ready(); write(path.join(drift, 'caches-after.json'), { ...caches, actions_caches: [{ ...cache, id: 999 }] });
  reject(() => encryptCandidateSource(s, drift, env), 'CANDIDATE_CACHE_MISMATCH');
  reject(() => encryptCandidateSource(s, ready(), { ...env, CACHE_HIT: 'false' }), 'CANDIDATE_EXACT_CACHE_MISS');

  // These cases catch silent omission of backups and source writes on path overlap.
  for (const mutate of [p => fs.mkdirSync(path.join(p, '.scoped-closeout-empty'), { mode: 0o700 }),
    p => fs.chmodSync(p, 0o777)]) {
    const p = source(); mutate(p);
    check(() => assert.throws(() => encryptCandidateSource(p, ready(), env)));
  }
  const overlap = ready(), overlapNames = fs.readdirSync(overlap).sort();
  check(() => { assert.throws(() => encryptCandidateSource(overlap, overlap, env));
    assert.deepEqual(fs.readdirSync(overlap).sort(), overlapNames); });

  const aliasTarget = ready(), aliasSource = path.join(root, 'alias-source');
  fs.symlinkSync(aliasTarget, aliasSource);
  const aliasBefore = fs.readdirSync(aliasTarget).sort();
  check(() => { assert.throws(() => encryptCandidateSource(aliasSource, aliasTarget, env));
    assert.deepEqual(fs.readdirSync(aliasTarget).sort(), aliasBefore); });
  const failCapture = (mutate, expectedCode) => {
    const p = source(), at = ready(); mutate(p, at);
    check(() => { assert.throws(() => encryptCandidateSource(p, at, env), e => expectedCode ? e.message === expectedCode : /^CANDIDATE_[A-Z_]+$/.test(e.message));
      assert.equal(fs.existsSync(path.join(at, 'candidate.enc.json')), false); });
    reject(() => encryptCandidateSource(p, at, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  };
  for (const mutate of [
    p => fs.unlinkSync(path.join(p, 'order-idempotency.json')),
    p => fs.linkSync(path.join(p, 'order-ledger.json'), path.join(p, 'inputs/hard.json')),
    p => { fs.rmSync(path.join(p, 'inputs'), { recursive: true }); fs.symlinkSync(root, path.join(p, 'inputs')); },
    p => fs.mkdirSync(path.join(p, 'inputs/nested')),
    p => write(path.join(p, 'inputs/wire.json.lock'), {}),
    p => write(path.join(p, '.incomplete.partial'), {}),
    p => write(path.join(p, 'order-ledger.json'), Buffer.from('{"orders":{},"orders":{}}')),
    p => write(path.join(p, 'order-ledger.json'), Buffer.from([0xff])),
    p => write(path.join(p, 'inputs/bad.json'), []),
    p => write(path.join(p, 'inputs/bad.json'), { nested: { api_key: null } }),
    p => write(path.join(p, 'inputs/bad.json'), { nested: { privateKey: 'synthetic' } }),
    p => write(path.join(p, 'inputs/bad.json'), { text: '-----BEGIN OPENSSH PRIVATE KEY-----' }),
    p => write(path.join(p, 'order-ledger.json'), { orders: { synthetic: { attemptId: 'missing', preWriteHashes: { orderLedger: sha(original), orderIdempotency: sha(original) } } } }),
    p => write(path.join(p, 'order-idempotency.json'), { orders: { synthetic: { attemptId: '../escape', preWriteHashes: {} } } }),
    (_, at) => fs.unlinkSync(path.join(at, 'preflight.json')),
    (_, at) => write(path.join(at, 'preflight.json'), { status: 'PASS' }),
    (_, at) => fs.unlinkSync(path.join(at, 'preflight.started.json')),
    (_, at) => write(path.join(at, 'prepared.json'), {}),
    (_, at) => write(path.join(at, 'history.json'), { ...history, unexpected: true }),
    (_, at) => write(path.join(at, 'caches-after.json'), { total_count: 0, actions_caches: [] }),
    (_, at) => write(path.join(at, 'candidate.enc.json.partial'), Buffer.from('unfinished')),
  ]) failCapture(mutate);
  for (const [field, value] of [['id', 999], ['version', 'e'.repeat(64)], ['key', scope.cacheKey + '-suffix'],
    ['ref', 'refs/heads/other'], ['created_at', '2026-01-02T14:03:00Z'], ['size_in_bytes', 1001]]) {
    failCapture((_, at) => write(path.join(at, 'caches-after.json'), { total_count: 1, actions_caches: [{ ...cache, [field]: value }] }));
  }
  for (const key of ['TELEGRAM_BOT_TOKEN', 'GITHUB_TOKEN', 'token', 'githubToken']) {
    failCapture(p => write(path.join(p, 'inputs/credential.json'), { [key]: 'SYNTHETIC_CREDENTIAL' }), 'CANDIDATE_SECRET_REJECTED');
  }
  for (const name of ['block', 'clock', 'lock']) {
    const p = source(), prefix = '.scoped-closeout-' + name;
    fs.mkdirSync(path.join(p, prefix), { mode: 0o700 });
    for (const file of ['order-ledger.json', 'order-idempotency.json']) write(path.join(p, prefix, file), {});
    check(() => assert.equal(encryptCandidateSource(p, ready(), env).fileCount, 6));
  }
  // Actual bytes (including whitespace) survive; all allowed companion shapes round-trip.
  const complete = source(), pre = '.scoped-closeout-all'; fs.mkdirSync(path.join(complete, pre), { mode: 0o700 });
  const originals = { orderLedger: Buffer.from(' { "orders": {} }\n'), orderIdempotency: Buffer.from('{\n "orders" : {}\n}\n') };
  for (const [k, name] of [['orderLedger', 'order-ledger.json'], ['orderIdempotency', 'order-idempotency.json']]) write(path.join(complete, pre, name), originals[k]);
  for (let i = 0; i < 5; i++) write(path.join(complete, pre, `wire-${i}.json`), { index: i });
  for (const name of ['notifications.json', 'observation-' + 'b'.repeat(64) + '.json']) write(path.join(complete, pre, name), {});
  write(path.join(complete, 'order-ledger.json'), { orders: { synthetic: { recordKind: 'SCOPED_MANAGEMENT_EXIT_V3', attemptId: 'all',
    preWriteHashes: Object.fromEntries(Object.entries(originals).map(([k, v]) => [k, sha(v)])) } } });
  const completeAttempt = ready(), completeResult = encryptCandidateSource(complete, completeAttempt, env);
  const completeOut = path.join(root, 'complete-out');
  const opened = decryptCandidateSource(path.join(completeAttempt, 'candidate.enc.json'), keyFile, completeOut,
    completeResult.envelopeSha256, scopeFile, sha(scopeBytes), '789');
  check(() => { assert.equal(opened.fileCount, 13); for (const key of ['currentStateAuthenticityVerified', 'sourceClosureVerified', 'stateAdopted', 'executionAuthorized', 'realizedPnlVerified']) assert.equal(opened[key], false); });
  const files = JSON.parse(fs.readFileSync(path.join(completeOut, 'manifest.json'))).files;
  check(() => { for (const f of files) {
    assert.deepEqual(fs.readFileSync(path.join(completeOut, 'candidate', f.name)), fs.readFileSync(path.join(complete, f.name)));
    assert.equal(fs.statSync(path.join(completeOut, 'candidate', f.name)).mode & 0o777, 0o600);
  }
    assert.equal(fs.statSync(completeOut).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(completeOut, 'candidate', pre)).mode & 0o777, 0o700);
  });
  write(path.join(complete, pre, 'order-ledger.json'), {});
  reject(() => encryptCandidateSource(complete, ready(), env), 'CANDIDATE_BACKUP_MISSING');
  fs.unlinkSync(path.join(s, 'last-dry-exec-preview.json'));
  check(() => assert.equal(encryptCandidateSource(s, ready(), env).fileCount, 3));

  // Repeated inventory detects content change, additions, and same-size in-read mutations.
  for (const mutate of [p => write(path.join(p, 'order-ledger.json'), { orders: {}, changed: true }),
    p => write(path.join(p, 'inputs/new.json'), {}), p => fs.mkdirSync(path.join(p, '.scoped-closeout-new'))]) {
    const p = source(), at = ready(), originalReaddir = fs.readdirSync; let seen = 0;
    fs.readdirSync = function (dir, ...args) { if (dir === p && ++seen === 2) mutate(p); return originalReaddir.call(this, dir, ...args); };
    try { check(() => { assert.throws(() => encryptCandidateSource(p, at, env)); assert.equal(fs.existsSync(path.join(at, 'candidate.enc.json')), false); }); }
    finally { fs.readdirSync = originalReaddir; }
    reject(() => encryptCandidateSource(p, at, env), 'CANDIDATE_ATTEMPT_ALREADY_USED');
  }
  { const p = source(), at = ready(), originalRead = fs.readSync; let once = false;
    fs.readSync = function (...args) { const n = originalRead.apply(this, args); if (!once && fs.fstatSync(args[0]).ino === fs.statSync(path.join(p, 'order-ledger.json')).ino) { once = true;
      write(path.join(p, 'order-ledger.json'), { orders: {}, updatedAt: 'changed' }); } return n; };
    try { check(() => assert.throws(() => encryptCandidateSource(p, at, env))); }
    finally { fs.readSync = originalRead; }
    check(() => assert.equal(fs.existsSync(path.join(at, 'candidate.enc.json')), false));
  }
  // Limits fail before encryption/publication, using only temporary synthetic files.
  failCapture(p => fs.truncateSync(path.join(p, 'order-ledger.json'), 8 * 1024 * 1024 + 1), 'CANDIDATE_SIZE_LIMIT');
  failCapture(p => fs.truncateSync(path.join(p, 'order-ledger.json'), 0), 'CANDIDATE_SIZE_LIMIT');
  failCapture(p => { for (let i = 0; i < 1001; i++) write(path.join(p, 'inputs', `many-${i}.json`), {}); }, 'CANDIDATE_FILE_COUNT_INVALID');
  failCapture(p => { const chunk = Buffer.from('{"text":"' + 'x'.repeat(8 * 1024 * 1024 - 11) + '"}');
    for (let i = 0; i < 9; i++) write(path.join(p, 'inputs', `big-${i}.json`), chunk); }, 'CANDIDATE_SIZE_LIMIT');
  // Authentic encrypted but invalid manifests cannot cross the extraction boundary.
  const goodEnvelope = JSON.parse(fs.readFileSync(encrypted));
  const plain = decryptPayload(goodEnvelope, keys.privateKey, goodEnvelope.context);
  const rejectDecrypt = (raw, changes = {}) => {
    const input = path.join(root, 'cipher-' + sequence++ + '.json'), out = path.join(root, 'rejected-' + sequence++);
    write(input, raw);
    check(() => { assert.throws(() => decryptCandidateSource(input, changes.keyFile ?? keyFile, out,
      changes.envelopeSha ?? sha(raw), changes.scopeFile ?? scopeFile, changes.scopeSha ?? sha(scopeBytes), changes.run ?? '789'),
      e => /^CANDIDATE_[A-Z_]+$/.test(e.message)); assert.equal(fs.existsSync(path.join(out, 'candidate')), false); });
    reject(() => decryptCandidateSource(encrypted, keyFile, out, result.envelopeSha256, scopeFile, sha(scopeBytes), '789'), 'CANDIDATE_OUTPUT_EXISTS');
  };
  for (const mutate of [
    p => p.files.push(p.files[0]), p => { p.files[0].name = '../escape.json'; },
    p => { p.files[0].name = '/absolute.json'; }, p => { p.files[0].name = 'inputs/../escape.json'; },
    p => { p.files[0].name = 'inputs/nested/deep.json'; }, p => { p.files[0].name = 'inputs\\escape.json'; },
    p => { p.files[0].name = 'inputs/temp.json.tmp'; }, p => p.files.reverse(),
    p => { p.files[0].sha256 = 'f'.repeat(64); }, p => { p.files[0].bytes += '\n'; },
    p => { p.files[0].bytes = Buffer.from('{"access_token":"synthetic"}').toString('base64'); p.files[0].sha256 = sha(Buffer.from(p.files[0].bytes, 'base64')); },
    p => { p.files = p.files.filter(f => f.name !== 'order-ledger.json'); },
    p => { p.manifestSha256 = 'f'.repeat(64); }, p => { p.stateAdopted = true; },
    p => { p.realizedPnlVerified = true; }, p => { p.sourceClosureVerified = true; },
    p => { p.executionAuthorized = true; }, p => { p.currentStateAuthenticityVerified = true; },
    p => { p.context.exportRunId = '999'; }, p => { p.receipts = {}; },
  ]) { const payload = structuredClone(plain); mutate(payload);
    rejectDecrypt(encryptPayload(payload, goodEnvelope.context, keys.publicKey, goodEnvelope.schemaVersion)); }
  for (const key of ['TELEGRAM_BOT_TOKEN', 'GITHUB_TOKEN', 'token', 'githubToken']) {
    const payload = structuredClone(plain), bytes = Buffer.from(JSON.stringify({ [key]: 'SYNTHETIC_CREDENTIAL' }));
    payload.files[0].bytes = bytes.toString('base64'); payload.files[0].sha256 = sha(bytes);
    payload.manifestSha256 = sha(JSON.stringify(payload.files.map(f => ({ name: f.name, sha256: f.sha256, size: Buffer.from(f.bytes, 'base64').length }))));
    rejectDecrypt(encryptPayload(payload, goodEnvelope.context, keys.publicKey, goodEnvelope.schemaVersion));
  }
  for (const field of ['ciphertext', 'wrappedKey', 'iv', 'tag']) {
    const bad = structuredClone(goodEnvelope); const bytes = Buffer.from(bad[field], 'base64'); bytes[0] ^= 1; bad[field] = bytes.toString('base64');
    rejectDecrypt(Buffer.from(JSON.stringify(bad)));
  }
  rejectDecrypt(fs.readFileSync(encrypted), { envelopeSha: 'f'.repeat(64) });
  rejectDecrypt(fs.readFileSync(encrypted), { scopeSha: 'f'.repeat(64) });
  rejectDecrypt(fs.readFileSync(encrypted), { run: '790' });
  const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 3072 }), wrongKeyFile = path.join(root, 'wrong-private.pem');
  write(wrongKeyFile, Buffer.from(wrongKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })));
  rejectDecrypt(fs.readFileSync(encrypted), { keyFile: wrongKeyFile });
  const changedScope = Buffer.from(JSON.stringify({ ...scope, sourceHeadSha: 'f'.repeat(40) })), changedScopeFile = path.join(root, 'changed-scope.json');
  write(changedScopeFile, changedScope);
  rejectDecrypt(fs.readFileSync(encrypted), { scopeFile: changedScopeFile, scopeSha: sha(changedScope) });
  const tooBig = path.join(root, 'oversize.enc.json'); write(tooBig, {}); fs.truncateSync(tooBig, 128 * 1024 * 1024 + 1);
  check(() => assert.throws(() => decryptCandidateSource(tooBig, keyFile, path.join(root, 'oversize-out'), 'f'.repeat(64), scopeFile, sha(scopeBytes), '789')));
  fs.chmodSync(keyFile, 0o644); rejectDecrypt(fs.readFileSync(encrypted)); fs.chmodSync(keyFile, 0o600);
  const existingAttempt = ready(); write(path.join(existingAttempt, 'candidate.enc.json'), Buffer.from('preserved'));
  reject(() => encryptCandidateSource(s, existingAttempt, env), 'CANDIDATE_OUTPUT_EXISTS');
  check(() => assert.equal(fs.readFileSync(path.join(existingAttempt, 'candidate.enc.json'), 'utf8'), 'preserved'));
  console.log(JSON.stringify({ status: 'PASS', phase: 'STEP_3B', cases: cases - 112, brokerRequests: 0 }));
  if (!step3bOnly) {
  assert.ok(fs.existsSync('.github/workflows/paper-state-candidate-export.yml'), 'STEP_3C_NOT_IMPLEMENTED: workflow and CLI integration');
  const cli = spawnSync(process.execPath, [...childNodeOptions, script], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).status, 'CANDIDATE_EXPORT_NOT_RUN'); assert.equal(cli.stderr, ''); });
  const badCli = spawnSync(process.execPath, [...childNodeOptions, script, 'preflight', '/private/SYNTHETIC_PRIVATE_DO_NOT_PRINT'], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(badCli.status, 1); assert.ok(!badCli.stdout.includes('SYNTHETIC_PRIVATE_DO_NOT_PRINT')); assert.equal(badCli.stderr, ''); });

  const workflowFile = '.github/workflows/paper-state-candidate-export.yml';
  // JSON is a YAML subset: parse the entire workflow, not security-critical regex fragments.
  const wf = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  const flags = { ALPHA_ENV: 'PAPER', READ_ONLY: 'true', EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' };
  const actionPins = { checkout: 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
    node: 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
    restore: 'actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830',
    upload: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9' };
  function assertWorkflow(w) {
    assert.deepEqual(Object.keys(w).sort(), ['concurrency', 'jobs', 'name', 'on', 'permissions']);
    assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
    assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs).sort(), ['approval_phrase', 'recipient_public_key', 'scope_json', 'scope_sha256']);
    for (const input of Object.values(w.on.workflow_dispatch.inputs)) { assert.equal(input.type, 'string'); assert.equal(input.required, true); assert.equal(input.default, undefined); }
    assert.deepEqual(w.permissions, { contents: 'read', actions: 'read' });
    assert.deepEqual(w.concurrency, { group: 'paper-state-candidate-export', 'cancel-in-progress': false });
    assert.deepEqual(Object.keys(w.jobs), ['export']); const job = w.jobs.export;
    assert.deepEqual(Object.keys(job).sort(), ['env', 'if', 'runs-on', 'steps', 'timeout-minutes']);
    assert.equal(job.if, "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_attempt == '1' }}");
    assert.equal(job['runs-on'], 'ubuntu-latest'); assert.equal(job['timeout-minutes'], 10);
    assert.deepEqual(job.env, { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true', ...flags });
    assert.deepEqual(job.steps.map(x => x.id), ['checkout', 'node', 'prepare', 'preflight', 'restore', 'restore_check', 'encrypt', 'upload']);
    for (const step of job.steps) {
      assert.ok(Object.keys(step).every(k => ['id', 'name', 'uses', 'with', 'shell', 'run', 'env', 'if'].includes(k)));
      if (step.uses) { assert.equal(step.uses, actionPins[step.id]); assert.equal(step.run, undefined); }
      if (step.run) {
        assert.equal(step.shell, 'bash'); assert.equal(step.if, undefined);
        assert.ok(!/\$\{\{|(?:^|[\s;|&])(curl|wget|eval|source)\s|--paginate|--retry|set -x|\|\| true/m.test(step.run));
        assert.ok(step.run.startsWith('set -euo pipefail\nset -C\numask 077\n'));
      }
    }
    const steps = Object.fromEntries(job.steps.map(x => [x.id, x]));
    assert.deepEqual(steps.checkout.with, { ref: '${{ github.sha }}', 'persist-credentials': false,
      'sparse-checkout-cone-mode': false, 'sparse-checkout': '/scripts/paper-state-candidate-export.mjs\n/scripts/paper-exact-cache-private-export.mjs' });
    assert.deepEqual(steps.node.with, { 'node-version': '20' });
    assert.deepEqual(steps.restore.with, { path: 'state', key: '${{ fromJSON(inputs.scope_json).cacheKey }}', 'fail-on-cache-miss': true });
    assert.deepEqual(steps.upload.with, { name: 'paper-state-candidate-encrypted-${{ github.run_id }}',
      path: '${{ runner.temp }}/paper-candidate-private/attempt/candidate.enc.json',
      'if-no-files-found': 'error', 'retention-days': 1, 'compression-level': 0, 'include-hidden-files': false, overwrite: false });
    assert.equal(steps.upload.if, "${{ success() && steps.encrypt.outcome == 'success' }}");
    const tokenEnv = { GH_TOKEN: '${{ github.token }}', GH_DEBUG: '', GH_PROMPT_DISABLED: '1' };
    const restoreEnv = { CACHE_HIT: '${{ steps.restore.outputs.cache-hit }}', CACHE_MATCHED_KEY: '${{ steps.restore.outputs.cache-matched-key }}' };
    assert.equal(steps.prepare.env, undefined); assert.deepEqual(steps.preflight.env, tokenEnv);
    assert.deepEqual(steps.restore_check.env, restoreEnv); assert.deepEqual(steps.encrypt.env, { ...tokenEnv, ...restoreEnv });
    assert.equal(steps.checkout.env, undefined); assert.equal(steps.node.env, undefined);
    assert.equal(steps.restore.env, undefined); assert.equal(steps.upload.env, undefined);
    const text = JSON.stringify(w); assert.ok(!/secrets\.|restore-keys|actions\/cache\/save|ALPACA|TOSS|scope_json.*\$\{\{ inputs/.test(text));
    assert.equal((text.match(/gh api /g) || []).length, 4);
  }
  check(() => assertWorkflow(wf));
  for (const mutate of [w => { w.on.schedule = []; }, w => { w.on.push = {}; }, w => { w.on.repository_dispatch = {}; },
    w => { w.permissions.actions = 'write'; }, w => { w.permissions.contents = 'write'; }, w => { w.jobs.export.permissions = { contents: 'write' }; },
    w => { w.jobs.export.if = '${{ always() }}'; }, w => { w.concurrency['cancel-in-progress'] = true; },
    w => { w.jobs.export.env.EXEC_ENABLED = 'true'; }, w => { w.jobs.export.env.READ_ONLY = 'false'; },
    w => { w.jobs.export.steps[4].with['restore-keys'] = 'sidecar-state-main-'; },
    w => { w.jobs.export.steps[4].uses = 'actions/cache@v4'; },
    w => { w.jobs.export.steps[4].with['fail-on-cache-miss'] = false; },
    w => { w.jobs.export.steps[7].with.path = 'state/**'; },
    w => { w.jobs.export.steps[7].with['include-hidden-files'] = true; },
    w => { w.jobs.export.steps[7].if = '${{ always() }}'; },
    w => { w.jobs.export.steps[3]['continue-on-error'] = true; },
    w => { w.jobs.export.steps[3].env.BROKER_KEY = '${{ secrets.BROKER_KEY }}'; },
    w => { w.jobs.export.steps[3].run += '\necho "${{ inputs.scope_json }}"'; },
    w => { w.jobs.export.steps[3].run += '\nsource /unapproved/input'; },
    w => { w.jobs.export.steps[3].run += '\neval "$UNAPPROVED"'; },
    w => { w.jobs.export.steps[0].with.ref = 'main'; },
  ]) { const bad = structuredClone(wf); mutate(bad); check(() => assert.throws(() => assertWorkflow(bad))); }
  const callCli = (args, e = env) => spawnSync(process.execPath, [...childNodeOptions, script, ...args], { env: e, encoding: 'utf8' });
  const cliAttempt = path.join(root, 'cli-attempt');
  check(() => assert.equal(callCli(['prepare', cliAttempt]).status, 0));
  check(() => assert.equal(callCli(['prepare', cliAttempt]).status, 1));
  for (const [n, v] of [['history.json', history], ['source-run.json', run], ['caches-before.json', caches], ['caches-after.json', caches]]) write(path.join(cliAttempt, n), v);
  check(() => assert.equal(callCli(['preflight', cliAttempt]).status, 0));
  check(() => assert.equal(callCli(['verify-restore']).status, 0));
  const cliSource = source(), cliCipher = callCli(['encrypt', cliSource, cliAttempt]);
  check(() => { assert.equal(cliCipher.status, 0); assert.equal(cliCipher.stderr, ''); assert.ok(!cliCipher.stdout.includes('SYNTHETIC_PRIVATE')); });
  const cliHash = JSON.parse(cliCipher.stdout).envelopeSha256;
  const cliDecrypt = callCli(['decrypt', path.join(cliAttempt, 'candidate.enc.json'), keyFile, path.join(root, 'cli-opened'), cliHash, scopeFile, sha(scopeBytes), '789'], {});
  check(() => { assert.equal(cliDecrypt.status, 0); assert.equal(JSON.parse(cliDecrypt.stdout).executionAuthorized, false); });
  for (const args of [['unknown'], ['prepare'], ['preflight', root, 'extra'], ['encrypt', root], ['decrypt'], ['verify-restore', root]]) {
    check(() => { const r = callCli(args); assert.equal(r.status, 1); assert.equal(r.stderr, ''); assert.match(JSON.parse(r.stdout).status, /^CANDIDATE_/); });
  }

  // Execute the real workflow shell bodies with a fixture-only gh binary. No Actions/cache service runs.
  const bin = path.join(root, 'mock-bin'); fs.mkdirSync(bin, { mode: 0o700 });
  write(path.join(bin, 'gh'), Buffer.from(`#!${process.execPath}\nconst fs=require('node:fs'),p=process.env.MOCK_DATA;
const args=process.argv.slice(2); fs.appendFileSync(p+'/calls.jsonl',JSON.stringify(args)+'\\n');
const calls=fs.readFileSync(p+'/calls.jsonl','utf8').trim().split('\\n').length;
if (args[0]!=='api'||args[1]!=='--method'||args[2]!=='GET'||args[3]!=='--hostname'||args[4]!=='github.com'||args.length!==6) process.exit(9);
if (String(calls)===process.env.MOCK_FAIL_AT) { process.stderr.write('SYNTHETIC_PRIVATE_DO_NOT_PRINT');process.exit(7); }
const endpoints=['repos/fixture/engine/actions/workflows/paper-state-candidate-export.yml/runs?event=workflow_dispatch&per_page=100','repos/fixture/engine/actions/runs/123','repos/fixture/engine/actions/caches?ref=refs/heads/main&key=sidecar-state-main-123&per_page=100'];
const which=endpoints.indexOf(args[5]);if(which<0)process.exit(8);
const name=which===0?'history.json':which===1?'source-run.json':calls===4?'caches-after.json':'caches-before.json';
process.stdout.write(fs.readFileSync(p+'/'+name));\n`)); fs.chmodSync(path.join(bin, 'gh'), 0o700);
  write(path.join(bin, 'timeout'), Buffer.from('#!/bin/bash\n[[ "$1" == "30s" ]] || exit 8\nshift\nexec "$@"\n')); fs.chmodSync(path.join(bin, 'timeout'), 0o700);
  function shellFixture({ inputChanges = {}, environment = {}, metadata = {}, failAt = '', cacheHit = 'true', matchedKey = scope.cacheKey, retry = false } = {}) {
    const base = path.join(root, 'workflow-' + sequence++); fs.mkdirSync(base, { mode: 0o700 });
    const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace, { mode: 0o700 }); fs.mkdirSync(path.join(workspace, 'scripts'), { mode: 0o700 });
    for (const n of ['paper-state-candidate-export.mjs', 'paper-exact-cache-private-export.mjs']) fs.copyFileSync(path.resolve('scripts', n), path.join(workspace, 'scripts', n));
    const inputs = { approval_phrase: APPROVAL, scope_json: scopeBytes.toString(), scope_sha256: sha(scopeBytes), recipient_public_key: publicDer.toString('base64'), ...inputChanges };
    const eventFile = path.join(base, 'event.json'); write(eventFile, { inputs });
    for (const [n, v] of [['history.json', history], ['source-run.json', run], ['caches-before.json', caches], ['caches-after.json', caches]]) write(path.join(base, n), metadata[n] ?? v);
    const e = { ...env, ...flags, GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: eventFile,
      GITHUB_WORKSPACE: workspace, RUNNER_TEMP: base, PATH: bin + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin',
      NODE_OPTIONS: '--require=' + childNodeOptions[1], MOCK_DATA: base, MOCK_FAIL_AT: failAt,
      CACHE_HIT: cacheHit, CACHE_MATCHED_KEY: matchedKey, GH_TOKEN: 'SYNTHETIC_TOKEN', ...environment };
    for (const k of ['CANDIDATE_SCOPE_JSON', 'CANDIDATE_SCOPE_SHA256', 'RECIPIENT_PUBLIC_KEY', 'APPROVAL_PHRASE']) delete e[k];
    let result, phase, publicLog = ''; const beforeSource = source();
    const beforeHash = sha(fs.readFileSync(path.join(beforeSource, 'order-ledger.json')));
    for (const step of wf.jobs.export.steps.filter(x => x.run)) {
      phase = step.id;
      if (phase === 'restore_check') fs.cpSync(beforeSource, path.join(workspace, 'state'), { recursive: true });
      result = spawnSync('/bin/bash', ['-c', step.run], { cwd: workspace, env: e, encoding: 'utf8' });
      publicLog += result.stdout + result.stderr; if (result.status !== 0) break;
    }
    const at = path.join(base, 'paper-candidate-private/attempt'), cipher = path.join(at, 'candidate.enc.json');
    const calls = fs.existsSync(path.join(base, 'calls.jsonl')) ? fs.readFileSync(path.join(base, 'calls.jsonl'), 'utf8').trim().split('\n').length : 0;
    assert.ok(!publicLog.includes('SYNTHETIC_PRIVATE_DO_NOT_PRINT') && !publicLog.includes('SYNTHETIC_TOKEN') && !publicLog.includes(publicDer.toString('base64')));
    assert.equal(sha(fs.readFileSync(path.join(beforeSource, 'order-ledger.json'))), beforeHash);
    if (retry) {
      const again = spawnSync('/bin/bash', ['-c', wf.jobs.export.steps.find(x => x.id === 'prepare').run], { cwd: workspace, env: e, encoding: 'utf8' });
      assert.notEqual(again.status, 0); assert.equal(fs.readFileSync(path.join(base, 'calls.jsonl'), 'utf8').trim().split('\n').length, calls);
    }
    return { status: result.status, phase, calls, cipherExists: fs.existsSync(cipher), publicLog };
  }
  check(() => { const r = shellFixture(); assert.equal(r.status, 0); assert.equal(r.calls, 4); assert.equal(r.cipherExists, true); });
  for (const inputChanges of [{ approval_phrase: 'WRONG' }, { scope_sha256: 'f'.repeat(64) },
    { recipient_public_key: '-----BEGIN PRIVATE KEY----- SYNTHETIC_PRIVATE_DO_NOT_PRINT' },
    { scope_json: '$(touch /SYNTHETIC_PRIVATE_DO_NOT_PRINT)' },
    { scope_json: JSON.stringify({ ...scope, cacheKey: 'x; echo SYNTHETIC_PRIVATE_DO_NOT_PRINT' }) }, { unexpected: 'SYNTHETIC_PRIVATE_DO_NOT_PRINT' }]) {
    check(() => { const r = shellFixture({ inputChanges }); assert.notEqual(r.status, 0); assert.equal(r.calls, 0); assert.equal(r.cipherExists, false); });
  }
  for (const environment of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_SHA: 'f'.repeat(40) }, { GITHUB_REPOSITORY: 'other/engine' },
    { ALPHA_ENV: 'LIVE' }, { EXEC_ENABLED: 'true' }, { READ_ONLY: 'false' }, { LIVE_ORDER_SUBMIT_ENABLED: 'true' }, { MARKET_GUARD_MODE: 'execute' }]) {
    check(() => { const r = shellFixture({ environment }); assert.notEqual(r.status, 0); assert.equal(r.calls, 0); assert.equal(r.cipherExists, false); });
  }
  for (const failAt of ['1', '2', '3', '4']) {
    check(() => { const r = shellFixture({ failAt, retry: true }); assert.notEqual(r.status, 0); assert.equal(r.calls, Number(failAt)); assert.equal(r.cipherExists, false); });
  }
  for (const metadata of [ { 'history.json': { ...history, total_count: 2 } }, { 'history.json': { total_count: 1, workflow_runs: [] } },
    { 'source-run.json': { ...run, run_attempt: 2 } }, { 'caches-before.json': { total_count: 0, actions_caches: [] } },
    ...['id', 'key', 'version'].map(k => ({ 'caches-before.json': { total_count: 1, actions_caches: [{ ...cache, [k]: k === 'id' ? 999 : 'mismatch' }] } })),
    { 'caches-after.json': { total_count: 1, actions_caches: [{ ...cache, size_in_bytes: 1001 }] } } ]) {
    check(() => { const r = shellFixture({ metadata }); assert.notEqual(r.status, 0); assert.equal(r.cipherExists, false); assert.equal(r.calls, metadata['caches-after.json'] ? 4 : 3); });
  }
  for (const options of [{ cacheHit: 'false' }, { cacheHit: '' }, { matchedKey: scope.cacheKey + '-prefix' }]) {
    check(() => { const r = shellFixture(options); assert.notEqual(r.status, 0); assert.equal(r.phase, 'restore_check'); assert.equal(r.calls, 3); assert.equal(r.cipherExists, false); });
  }
  check(() => {
    const pkg = JSON.parse(fs.readFileSync('package.json'));
    assert.equal(pkg.scripts['ops:test:paper-state-candidate-export'], 'node --require ./scripts/fixtures/scoped-paper-offline.cjs scripts/test-paper-state-candidate-export.mjs');
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    assert.ok(ci.includes('run: npm run ops:test:paper-state-candidate-export'));
  });
  console.log(JSON.stringify({ status: 'PASS', phase: 'STEP_3C', cases: cases - 317, brokerRequests: 0, actualWorkflowRuns: 0 }));
  console.log(JSON.stringify({ status: 'PASS', cases, brokerRequests: 0, runtimeExports: 0, stateAdopted: false }));
  }
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
