import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { directory as privateDirectory, readBytes, recipient } from './paper-exact-cache-private-export.mjs';

export const APPROVAL = 'AUTHORIZE PAPER STATE CANDIDATE ENCRYPTED EXPORT ONE-SHOT';
const WORKFLOW = '.github/workflows/paper-state-candidate-export.yml';
const FIELDS = 'schemaVersion repository exportCommit sourceRunId sourceRunAttempt sourceHeadSha sourceWorkflow sourceEvent sourceConclusion cacheId cacheKey cacheVersion recipientSha256'.split(' ');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const match = (v, regex) => typeof v === 'string' && v.match(regex)?.[0] === v;
const id = v => match(v, /^[1-9][0-9]{0,19}$/);
const git = v => match(v, /^[a-f0-9]{40}$/);
const pin = v => match(v, /^[a-f0-9]{64}$/);
const metadataId = v => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || id(v);
class CandidateError extends Error {}
const check = (ok, code) => { if (!ok) throw new CandidateError(code); };
function guarded(task, code) {
  try { return task(); }
  catch (e) { throw e instanceof CandidateError ? e : new CandidateError(code); }
}
function json(bytes, code = 'CANDIDATE_METADATA_INVALID') {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), value = JSON.parse(text);
  check(object(value), code);
  const stack = []; let previousString;
  // JSON.parse accepts duplicate keys; provenance must not hide a prior value or run attempt.
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:]/g)) {
    if (token === '{' || token === '[') {
      check(stack.length < 100, code); stack.push(token === '{' ? new Set() : null);
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') {
      const names = stack.at(-1);
      check(names instanceof Set && !names.has(previousString), code); names.add(previousString);
    } else previousString = JSON.parse(token);
  }
  return value;
}

export function validateCandidateScope(bytes, expectedSha) {
  return guarded(() => {
    check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8192, 'CANDIDATE_SCOPE_INVALID');
    check(pin(expectedSha) && sha(bytes) === expectedSha, 'CANDIDATE_SCOPE_HASH_MISMATCH');
    const s = json(bytes, 'CANDIDATE_SCOPE_INVALID');
    check(object(s) && Object.keys(s).sort().join(' ') === [...FIELDS].sort().join(' '), 'CANDIDATE_SCOPE_INVALID');
    check(s.schemaVersion === 'paper-state-candidate-scope-v1'
      && match(s.repository, /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
      && !['.', '..'].includes(s.repository.split('/')[1])
      && git(s.exportCommit) && git(s.sourceHeadSha)
      && id(s.sourceRunId) && s.sourceRunAttempt === 1 && id(s.cacheId)
      && match(s.sourceWorkflow, /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/)
      && ['schedule', 'repository_dispatch', 'workflow_dispatch'].includes(s.sourceEvent)
      && ['success', 'failure', 'cancelled', 'timed_out'].includes(s.sourceConclusion)
      && s.cacheKey === 'sidecar-state-main-' + s.sourceRunId
      && pin(s.cacheVersion) && pin(s.recipientSha256), 'CANDIDATE_SCOPE_INVALID');
    return Object.freeze(Object.fromEntries(FIELDS.map(k => [k, s[k]])));
  }, 'CANDIDATE_SCOPE_INVALID');
}

function authority(env) {
  check(object(env), 'CANDIDATE_ENVIRONMENT_INVALID');
  check(env.APPROVAL_PHRASE === APPROVAL, 'CANDIDATE_APPROVAL_REQUIRED');
  check(env.ALPHA_ENV === 'PAPER' && env.READ_ONLY === 'true' && env.EXEC_ENABLED === 'false'
    && env.LIVE_ORDER_SUBMIT_ENABLED === 'false' && env.MARKET_GUARD_MODE === 'observe'
    && ['FORCE_SEND_ONCE', 'GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN']
      .every(k => env[k] === undefined || env[k] === 'false'), 'CANDIDATE_SAFETY_FLAGS_INVALID');
  check(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main',
    'CANDIDATE_DISPATCH_MAIN_ONLY');
  check(env.GITHUB_RUN_ATTEMPT === '1' && id(env.GITHUB_RUN_ID), 'CANDIDATE_RUN_ATTEMPT_INVALID');
  check(typeof env.CANDIDATE_SCOPE_JSON === 'string' && Buffer.byteLength(env.CANDIDATE_SCOPE_JSON) <= 8192,
    'CANDIDATE_SCOPE_INVALID');
  const scope = validateCandidateScope(Buffer.from(env.CANDIDATE_SCOPE_JSON), env.CANDIDATE_SCOPE_SHA256);
  check(env.GITHUB_REPOSITORY === scope.repository && env.GITHUB_SHA === scope.exportCommit
    && env.GITHUB_RUN_ID !== scope.sourceRunId, 'CANDIDATE_EXECUTION_BINDING_MISMATCH');
  guarded(() => recipient({ RECIPIENT_PUBLIC_KEY: env.RECIPIENT_PUBLIC_KEY, RECIPIENT_SHA256: scope.recipientSha256 }),
    'CANDIDATE_RECIPIENT_INVALID');
  return { schemaVersion: 'paper-state-candidate-attempt-v1', scopeSha256: env.CANDIDATE_SCOPE_SHA256,
    exportRunId: env.GITHUB_RUN_ID, scope };
}
function privateRoot(dir) {
  check(typeof dir === 'string' && path.isAbsolute(dir), 'CANDIDATE_PRIVATE_DIRECTORY_INVALID');
  guarded(() => privateDirectory(dir, true), 'CANDIDATE_PRIVATE_DIRECTORY_INVALID');
}
function absent(file, code) {
  try { fs.lstatSync(file); }
  catch (e) { if (e.code === 'ENOENT') return; throw new CandidateError('CANDIDATE_IO_INVALID'); }
  throw new CandidateError(code);
}
function writePrivateJson(dir, name, value, existsCode) {
  const target = path.join(dir, name), partial = target + '.partial';
  absent(target, existsCode); absent(partial, existsCode);
  let fd;
  try {
    fd = fs.openSync(partial, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    // A hard link publishes atomically without replacing another writer's receipt.
    fs.linkSync(partial, target); fs.unlinkSync(partial);
    const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  } catch (e) {
    throw new CandidateError(e.code === 'EEXIST' ? existsCode : 'CANDIDATE_IO_INVALID');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const safe = status => ({ status, currentStateAuthenticityVerified: false, sourceClosureVerified: false,
  stateAdopted: false, executionAuthorized: false, realizedPnlVerified: false, brokerRequests: 0, runtimeExports: 0 });

export function prepareCandidateAttempt(directory, env) {
  return guarded(() => {
    const prepared = authority(env);
    check(typeof directory === 'string' && path.isAbsolute(directory), 'CANDIDATE_PRIVATE_DIRECTORY_INVALID');
    privateRoot(path.dirname(directory));
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (e) { throw new CandidateError(e.code === 'EEXIST' ? 'CANDIDATE_ATTEMPT_EXISTS' : 'CANDIDATE_IO_INVALID'); }
    privateRoot(directory);
    writePrivateJson(directory, 'prepared.json', prepared, 'CANDIDATE_OUTPUT_EXISTS');
    return safe('CANDIDATE_ATTEMPT_PREPARED_NOT_READY');
  }, 'CANDIDATE_IO_INVALID');
}

function utc(value) {
  if (typeof value !== 'string') return NaN;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return NaN;
  const normalized = new Date(t).toISOString();
  return value === normalized || value === normalized.replace('.000Z', 'Z') ? t : NaN;
}
function validateMetadata(prepared, history, source, caches) {
  const s = prepared.scope, own = history?.workflow_runs?.[0];
  check(history?.total_count === 1 && Array.isArray(history.workflow_runs) && history.workflow_runs.length === 1
    && object(own) && metadataId(own.id) && String(own.id) === prepared.exportRunId
    && own.run_attempt === 1 && own.head_sha === s.exportCommit && own.head_branch === 'main'
    && own.event === 'workflow_dispatch' && own.path === WORKFLOW && own.status === 'in_progress'
    && own.conclusion === null && own.repository?.full_name === s.repository,
  'CANDIDATE_PRIOR_OR_CONCURRENT_ATTEMPT');
  check(metadataId(source?.id) && String(source.id) === s.sourceRunId
    && source.run_attempt === s.sourceRunAttempt && source.head_sha === s.sourceHeadSha
    && source.head_branch === 'main' && source.event === s.sourceEvent && source.path === s.sourceWorkflow
    && source.repository?.full_name === s.repository && source.status === 'completed'
    && source.conclusion === s.sourceConclusion, 'CANDIDATE_SOURCE_RUN_MISMATCH');
  const started = utc(source.run_started_at), created = utc(source.created_at), ended = utc(source.updated_at);
  const exported = utc(own.created_at);
  check([started, created, ended, exported].every(Number.isFinite) && created <= started
    && started <= ended && ended <= exported, 'CANDIDATE_SOURCE_TIME_INVALID');
  check(caches?.total_count === 1 && Array.isArray(caches.actions_caches) && caches.actions_caches.length === 1,
    'CANDIDATE_CACHE_MISMATCH');
  const c = caches.actions_caches[0];
  check(object(c) && metadataId(c.id) && String(c.id) === s.cacheId && c.key === s.cacheKey
    && c.ref === 'refs/heads/main' && c.version === s.cacheVersion
    && Number.isSafeInteger(c.size_in_bytes) && c.size_in_bytes > 0, 'CANDIDATE_CACHE_MISMATCH');
  const cached = utc(c.created_at);
  check(Number.isFinite(cached) && started <= cached && cached <= ended, 'CANDIDATE_CACHE_TIME_INVALID');
  return { id: c.id, key: c.key, version: c.version, ref: c.ref, createdAt: c.created_at, sizeInBytes: c.size_in_bytes };
}

export function preflightCandidateAttempt(directory, env) {
  return guarded(() => {
    const prepared = authority(env); privateRoot(directory);
    const original = guarded(() => readBytes(path.join(directory, 'prepared.json'), 16384, true),
      'CANDIDATE_PREPARED_MISMATCH');
    check(original.equals(Buffer.from(JSON.stringify(prepared) + '\n')), 'CANDIDATE_PREPARED_MISMATCH');
    absent(path.join(directory, 'preflight.json'), 'CANDIDATE_OUTPUT_EXISTS');
    absent(path.join(directory, 'preflight.json.partial'), 'CANDIDATE_OUTPUT_EXISTS');
    writePrivateJson(directory, 'preflight.started.json', { scopeSha256: prepared.scopeSha256,
      exportRunId: prepared.exportRunId }, 'CANDIDATE_ATTEMPT_ALREADY_USED');
    const metadataSha256 = {}, documents = ['history.json', 'source-run.json', 'caches-before.json'].map(name =>
      guarded(() => {
        const bytes = readBytes(path.join(directory, name), 8 * 1024 * 1024, true);
        metadataSha256[name] = sha(bytes); return json(bytes);
      }, 'CANDIDATE_METADATA_INVALID'));
    const cache = validateMetadata(prepared, ...documents);
    writePrivateJson(directory, 'preflight.json', { schemaVersion: 'paper-state-candidate-preflight-v1',
      preparedSha256: sha(original), scopeSha256: prepared.scopeSha256, exportRunId: prepared.exportRunId,
      metadataSha256, cache, ...safe('CANDIDATE_PREFLIGHT_PASSED_NOT_EXPORTED') }, 'CANDIDATE_OUTPUT_EXISTS');
    return safe('CANDIDATE_PREFLIGHT_PASSED_NOT_EXPORTED');
  }, 'CANDIDATE_IO_INVALID');
}
