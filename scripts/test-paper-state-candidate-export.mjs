import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/paper-state-candidate-export.mjs');
assert.ok(fs.existsSync(script), 'Missing independently scoped PAPER state candidate exporter');
const { APPROVAL, validateCandidateScope, prepareCandidateAttempt, preflightCandidateAttempt,
  encryptCandidateSource, decryptCandidateSource } = await import(pathToFileURL(script));
const step3aOnly = process.argv.includes('--step3a');
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
  check(() => { assert.equal(inert.status, 0); assert.equal(inert.stdout, ''); assert.equal(inert.stderr, ''); });
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
  const cli = spawnSync(process.execPath, [...childNodeOptions, script], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).status, 'CANDIDATE_EXPORT_NOT_RUN'); assert.equal(cli.stderr, ''); });
  const badCli = spawnSync(process.execPath, [...childNodeOptions, script, 'preflight', '/private/SYNTHETIC_PRIVATE_DO_NOT_PRINT'], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(badCli.status, 1); assert.ok(!badCli.stdout.includes('SYNTHETIC_PRIVATE_DO_NOT_PRINT')); assert.equal(badCli.stderr, ''); });
  const wf = fs.readFileSync('.github/workflows/paper-state-candidate-export.yml', 'utf8');
  check(() => assert.ok(wf.includes('workflow_dispatch:') && !/^  (push|schedule|repository_dispatch|workflow_run|pull_request):/m.test(wf)));
  check(() => assert.ok(wf.includes('contents: read') && wf.includes('actions: read') && wf.includes('cancel-in-progress: false')));
  check(() => assert.ok(wf.includes('fail-on-cache-miss: true') && !/restore-keys:|actions\/cache\/save|secrets\.|ALPACA|--paginate/.test(wf)));
  check(() => assert.ok(wf.includes('candidate.enc.json') && wf.includes('include-hidden-files: false')));
  check(() => assert.equal((wf.match(/gh api /g) || []).length, 4));
  check(() => assert.ok(!wf.includes('${{ inputs.scope_json }}')));
  console.log(JSON.stringify({ status: 'PASS', cases, brokerRequests: 0, runtimeExports: 0, stateAdopted: false }));
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
