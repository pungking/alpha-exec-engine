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
const sha = b => createHash('sha256').update(b).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'paper-candidate-fixture-')));
const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
const publicDer = keys.publicKey.export({ type: 'spki', format: 'der' });
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
  const cli = spawnSync(process.execPath, [script], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).status, 'CANDIDATE_EXPORT_NOT_RUN'); assert.equal(cli.stderr, ''); });
  const badCli = spawnSync(process.execPath, [script, 'preflight', '/private/SYNTHETIC_PRIVATE_DO_NOT_PRINT'], { env: {}, encoding: 'utf8' });
  check(() => { assert.equal(badCli.status, 1); assert.ok(!badCli.stdout.includes('SYNTHETIC_PRIVATE_DO_NOT_PRINT')); assert.equal(badCli.stderr, ''); });
  const wf = fs.readFileSync('.github/workflows/paper-state-candidate-export.yml', 'utf8');
  check(() => assert.ok(wf.includes('workflow_dispatch:') && !/^  (push|schedule|repository_dispatch|workflow_run|pull_request):/m.test(wf)));
  check(() => assert.ok(wf.includes('contents: read') && wf.includes('actions: read') && wf.includes('cancel-in-progress: false')));
  check(() => assert.ok(wf.includes('fail-on-cache-miss: true') && !/restore-keys:|actions\/cache\/save|secrets\.|ALPACA|--paginate/.test(wf)));
  check(() => assert.ok(wf.includes('candidate.enc.json') && wf.includes('include-hidden-files: false')));
  check(() => assert.equal((wf.match(/gh api /g) || []).length, 4));
  check(() => assert.ok(!wf.includes('${{ inputs.scope_json }}')));
  console.log(JSON.stringify({ status: 'PASS', cases, brokerRequests: 0, runtimeExports: 0, stateAdopted: false }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
