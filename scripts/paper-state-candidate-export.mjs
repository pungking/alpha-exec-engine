import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { directory as privateDirectory, readBytes, recipient, encryptPayload, decryptPayload } from './paper-exact-cache-private-export.mjs';

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
  const stack = []; let stringStart = 0, stringEnd = 0;
  // JSON.parse accepts duplicate keys; provenance must not hide a prior value or run attempt.
  for (let i = 0; i < text.length; i++) {
    const token = text[i];
    if (token === '"') {
      stringStart = i++;
      // Iterative scanning avoids regexp stack exhaustion on allowed multi-MiB strings.
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      stringEnd = i + 1; continue;
    }
    if (token === '{' || token === '[') {
      check(stack.length < 100, code); stack.push(token === '{' ? new Set() : null);
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') {
      const names = stack.at(-1), previousString = JSON.parse(text.slice(stringStart, stringEnd));
      check(names instanceof Set && !names.has(previousString), code); names.add(previousString);
    }
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

const ENVELOPE = 'paper-state-candidate-encrypted-v1';
const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024, MAX_ENVELOPE = 128 * 1024 * 1024;
const PAIR = ['order-ledger.json', 'order-idempotency.json'];
const attemptName = v => match(v, /^[A-Za-z0-9_-]{1,96}$/);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (v, names) => object(v) && equal(Object.keys(v).sort(), names.split(' ').sort());
const contextOf = p => ({ scopeSha256: p.scopeSha256, scope: p.scope, exportRunId: p.exportRunId });
function allowedFile(name) {
  if (PAIR.includes(name) || name === 'last-dry-exec-preview.json') return true;
  if (match(name, /^inputs\/[A-Za-z0-9_-]{1,96}\.json$/)) return true;
  const parts = typeof name === 'string' ? name.split('/') : [];
  return parts.length === 2 && parts[0].startsWith('.scoped-closeout-')
    && attemptName(parts[0].slice('.scoped-closeout-'.length))
    && match(parts[1], /^(order-ledger\.json|order-idempotency\.json|wire-[0-4]\.json|observation-[a-f0-9]{64}\.json|notifications\.json)$/);
}
function sourceValue(bytes) {
  const value = json(bytes, 'CANDIDATE_SOURCE_JSON_INVALID');
  const visit = v => {
    if (typeof v === 'string') check(!/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(v), 'CANDIDATE_SECRET_REJECTED');
    if (v && typeof v === 'object') for (const [key, item] of Object.entries(v)) {
      check(!/(api.?key|access.?token|refresh.?token|token$|password|credential|private.?key|secret|authorization|cookie)/i.test(key), 'CANDIDATE_SECRET_REJECTED');
      visit(item);
    }
  };
  visit(value); return value;
}
function validateFiles(files) {
  check(Array.isArray(files) && files.length >= 2 && files.length <= 1000, 'CANDIDATE_FILE_COUNT_INVALID');
  const found = new Map(); let total = 0, previous = '';
  for (const f of files) {
    check(exact(f, 'name sha256 bytes') && allowedFile(f.name) && f.name > previous && pin(f.sha256), 'CANDIDATE_SOURCE_PATH_INVALID');
    check(typeof f.bytes === 'string' && f.bytes.length <= Math.ceil(MAX_FILE / 3) * 4, 'CANDIDATE_SIZE_LIMIT');
    const bytes = Buffer.from(f.bytes, 'base64'); total += bytes.length;
    check(bytes.length > 0 && bytes.length <= MAX_FILE && total <= MAX_TOTAL, 'CANDIDATE_SIZE_LIMIT');
    check(bytes.toString('base64') === f.bytes && sha(bytes) === f.sha256, 'CANDIDATE_FILE_HASH_MISMATCH');
    found.set(f.name, { bytes, value: sourceValue(bytes) }); previous = f.name;
  }
  check(PAIR.every(n => found.has(n)), 'CANDIDATE_SOURCE_REQUIRED_FILE_MISSING');
  const prefixes = new Set(files.filter(f => f.name.startsWith('.scoped-closeout-')).map(f => f.name.split('/')[0]));
  for (const prefix of prefixes) check(PAIR.every(n => found.has(`${prefix}/${n}`)), 'CANDIDATE_BACKUP_MISSING');
  // Existing scoped records name their original backups by attemptId and preWriteHashes.
  for (const name of PAIR) for (const r of Object.values(found.get(name).value.orders ?? {})) {
    if (!object(r) || !('recordKind' in r || 'preWriteHashes' in r || 'attemptId' in r)) continue;
    check(attemptName(r.attemptId) && exact(r.preWriteHashes, 'orderLedger orderIdempotency'), 'CANDIDATE_BACKUP_MISSING');
    for (const [key, file] of [['orderLedger', PAIR[0]], ['orderIdempotency', PAIR[1]]]) {
      const backup = found.get(`.scoped-closeout-${r.attemptId}/${file}`);
      check(backup && pin(r.preWriteHashes[key]) && sha(backup.bytes) === r.preWriteHashes[key], 'CANDIDATE_BACKUP_MISSING');
    }
  }
  return found;
}
const manifestOf = files => files.map(f => ({ name: f.name, sha256: f.sha256, size: Buffer.from(f.bytes, 'base64').length }));
const signature = s => ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map(k => String(s[k]));
function sourceSnapshot(root) {
  check(typeof root === 'string' && path.isAbsolute(root), 'CANDIDATE_SOURCE_PATH_INVALID');
  privateDirectory(root);
  const files = [], stamps = []; let total = 0, entries = 0;
  const walk = (dir, prefix = '') => {
    privateDirectory(dir);
    const dirStat = fs.lstatSync(dir, { bigint: true });
    check(dirStat.uid === BigInt(process.getuid()) && (dirStat.mode & 0o022n) === 0n, 'CANDIDATE_SOURCE_PATH_INVALID');
    stamps.push([prefix, signature(dirStat)]);
    if (prefix.startsWith('.scoped-closeout-')) check(PAIR.every(n => fs.existsSync(path.join(dir, n))), 'CANDIDATE_BACKUP_MISSING');
    for (const name of fs.readdirSync(dir).sort()) {
      check(++entries <= 1100, 'CANDIDATE_FILE_COUNT_INVALID');
      const relative = prefix + name, full = path.join(dir, name), stat = fs.lstatSync(full, { bigint: true });
      stamps.push([relative, signature(stat)]);
      check(!stat.isSymbolicLink() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o022n) === 0n, 'CANDIDATE_SOURCE_PATH_INVALID');
      if (!prefix && !stat.isDirectory()) check(!/(?:^|[.-])(?:lock|tmp|partial|temp)(?:$|[.-])/i.test(name), 'CANDIDATE_SOURCE_FENCE_OR_TEMP');
      if (stat.isDirectory()) {
        check(!prefix && (name === 'inputs' || name.startsWith('.scoped-closeout-')
          && attemptName(name.slice('.scoped-closeout-'.length))), 'CANDIDATE_SOURCE_PATH_INVALID');
        walk(full, relative + '/'); continue;
      }
      check(stat.isFile() && stat.nlink === 1n, 'CANDIDATE_SOURCE_PATH_INVALID');
      if (!allowedFile(relative)) {
        check(!prefix && !name.startsWith('.scoped-closeout') && /^[A-Za-z0-9_-]+\.json$/.test(name), 'CANDIDATE_SOURCE_PATH_INVALID');
        continue; // Unrelated top-level reports are deliberately not captured.
      }
      check(files.length < 1000, 'CANDIDATE_FILE_COUNT_INVALID');
      check(stat.size > 0n && stat.size <= BigInt(MAX_FILE) && total + Number(stat.size) <= MAX_TOTAL, 'CANDIDATE_SIZE_LIMIT');
      let fd;
      try {
        fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        check(equal(signature(fs.fstatSync(fd, { bigint: true })), signature(stat)), 'CANDIDATE_SOURCE_CHANGED');
        // Bound allocation and reads even if a concurrent writer grows the file.
        const bytes = Buffer.alloc(Number(stat.size)); let offset = 0;
        while (offset < bytes.length) {
          const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          check(n > 0, 'CANDIDATE_SOURCE_CHANGED'); offset += n;
        }
        check(equal(signature(fs.fstatSync(fd, { bigint: true })), signature(stat))
          && equal(signature(fs.lstatSync(full, { bigint: true })), signature(stat)), 'CANDIDATE_SOURCE_CHANGED');
        sourceValue(bytes); total += bytes.length;
        files.push({ name: relative, sha256: sha(bytes), bytes: bytes.toString('base64') });
      } finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  };
  walk(root); files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  validateFiles(files); return { files, stamps };
}
function verifiedPreflight(dir, prepared) {
  const original = readBytes(path.join(dir, 'prepared.json'), 16384, true);
  check(original.equals(Buffer.from(JSON.stringify(prepared) + '\n')), 'CANDIDATE_PREPARED_MISMATCH');
  const hashes = {}, docs = ['history.json', 'source-run.json', 'caches-before.json'].map(name => {
    const bytes = readBytes(path.join(dir, name), MAX_FILE, true); hashes[name] = sha(bytes); return json(bytes);
  });
  const cache = validateMetadata(prepared, ...docs);
  const receipt = { schemaVersion: 'paper-state-candidate-preflight-v1', preparedSha256: sha(original),
    scopeSha256: prepared.scopeSha256, exportRunId: prepared.exportRunId, metadataSha256: hashes, cache,
    ...safe('CANDIDATE_PREFLIGHT_PASSED_NOT_EXPORTED') };
  check(readBytes(path.join(dir, 'preflight.json'), 16384, true).equals(Buffer.from(JSON.stringify(receipt) + '\n')),
    'CANDIDATE_PREFLIGHT_MISMATCH');
  check(equal(json(readBytes(path.join(dir, 'preflight.started.json'), 16384, true)),
    { scopeSha256: prepared.scopeSha256, exportRunId: prepared.exportRunId }), 'CANDIDATE_PREFLIGHT_MISMATCH');
  const afterBytes = readBytes(path.join(dir, 'caches-after.json'), MAX_FILE, true);
  check(equal(validateMetadata(prepared, docs[0], docs[1], json(afterBytes)), cache), 'CANDIDATE_CACHE_MISMATCH');
  return { preflightSha256: sha(Buffer.from(JSON.stringify(receipt) + '\n')), cachesAfterSha256: sha(afterBytes) };
}
function writePrivateBytes(dir, name, bytes) {
  const target = path.join(dir, name), partial = target + '.partial';
  absent(target, 'CANDIDATE_OUTPUT_EXISTS'); absent(partial, 'CANDIDATE_OUTPUT_EXISTS');
  const fd = fs.openSync(partial, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  check(readBytes(partial, MAX_ENVELOPE, true).equals(bytes), 'CANDIDATE_OUTPUT_VERIFY_FAILED');
  fs.linkSync(partial, target); fs.unlinkSync(partial);
  const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
}
export function encryptCandidateSource(sourceDirectory, attemptDirectory, env) {
  return guarded(() => {
    const prepared = authority(env); privateRoot(attemptDirectory);
    check(typeof sourceDirectory === 'string' && path.isAbsolute(sourceDirectory), 'CANDIDATE_SOURCE_PATH_INVALID');
    guarded(() => privateDirectory(sourceDirectory), 'CANDIDATE_SOURCE_PATH_INVALID');
    const source = path.resolve(sourceDirectory), attempt = path.resolve(attemptDirectory);
    check(source !== attempt && !source.startsWith(attempt + path.sep) && !attempt.startsWith(source + path.sep), 'CANDIDATE_SOURCE_PATH_INVALID');
    writePrivateJson(attemptDirectory, 'encrypt.started.json', contextOf(prepared), 'CANDIDATE_ATTEMPT_ALREADY_USED');
    const receipts = verifiedPreflight(attemptDirectory, prepared);
    check(env.CACHE_HIT === 'true' && env.CACHE_MATCHED_KEY === prepared.scope.cacheKey, 'CANDIDATE_EXACT_CACHE_MISS');
    absent(path.join(attempt, 'candidate.enc.json'), 'CANDIDATE_OUTPUT_EXISTS');
    absent(path.join(attempt, 'candidate.enc.json.partial'), 'CANDIDATE_OUTPUT_EXISTS');
    const snapshot = sourceSnapshot(source), context = contextOf(prepared);
    const manifestSha256 = sha(JSON.stringify(manifestOf(snapshot.files)));
    const bytes = encryptPayload({ context, evidenceBasis: 'UNVERIFIED_CACHE_SNAPSHOT', receipts,
      manifestSha256, files: snapshot.files, ...safe('CANDIDATE_NOT_ADOPTED') }, context,
    recipient({ RECIPIENT_PUBLIC_KEY: env.RECIPIENT_PUBLIC_KEY, RECIPIENT_SHA256: prepared.scope.recipientSha256 }), ENVELOPE);
    check(bytes.length <= MAX_ENVELOPE, 'CANDIDATE_SIZE_LIMIT');
    check(equal(snapshot, sourceSnapshot(source)), 'CANDIDATE_SOURCE_CHANGED');
    check(equal(receipts, verifiedPreflight(attempt, prepared)), 'CANDIDATE_CACHE_MISMATCH');
    writePrivateBytes(attempt, 'candidate.enc.json', bytes);
    return { ...safe('ENCRYPTED_CANDIDATE_CREATED_NOT_ADOPTED'), fileCount: snapshot.files.length,
      envelopeSha256: sha(bytes), manifestSha256, sourceStateModified: false, plaintextPublished: false };
  }, 'CANDIDATE_CAPTURE_FAILED');
}
function decodedFiles(raw, key, prepared) {
  const e = json(raw), context = contextOf(prepared);
  check(exact(e, 'schemaVersion algorithm context wrappedKey iv tag ciphertext') && e.schemaVersion === ENVELOPE
    && e.algorithm === 'RSA-OAEP-SHA256+A256GCM' && equal(e.context, context), 'CANDIDATE_ENVELOPE_INVALID');
  for (const field of ['wrappedKey', 'iv', 'tag', 'ciphertext']) {
    check(typeof e[field] === 'string' && Buffer.from(e[field], 'base64').toString('base64') === e[field], 'CANDIDATE_ENVELOPE_INVALID');
  }
  const payload = decryptPayload(e, key, context);
  check(exact(payload, 'context evidenceBasis receipts manifestSha256 files status currentStateAuthenticityVerified sourceClosureVerified stateAdopted executionAuthorized realizedPnlVerified brokerRequests runtimeExports')
    && equal(payload.context, context) && payload.evidenceBasis === 'UNVERIFIED_CACHE_SNAPSHOT'
    && exact(payload.receipts, 'preflightSha256 cachesAfterSha256') && Object.values(payload.receipts).every(pin)
    && Object.entries(safe('CANDIDATE_NOT_ADOPTED')).every(([k, v]) => payload[k] === v), 'CANDIDATE_PAYLOAD_INVALID');
  const files = validateFiles(payload.files);
  check(pin(payload.manifestSha256) && sha(JSON.stringify(manifestOf(payload.files))) === payload.manifestSha256, 'CANDIDATE_MANIFEST_MISMATCH');
  return { files, manifest: manifestOf(payload.files), manifestSha256: payload.manifestSha256 };
}
export function decryptCandidateSource(input, keyFile, outputDirectory, envelopeSha, scopeFile, scopeSha, exportRunId) {
  return guarded(() => {
    check(typeof outputDirectory === 'string' && path.isAbsolute(outputDirectory), 'CANDIDATE_PRIVATE_DIRECTORY_INVALID');
    privateRoot(path.dirname(outputDirectory)); absent(outputDirectory, 'CANDIDATE_OUTPUT_EXISTS');
    fs.mkdirSync(outputDirectory, { mode: 0o700 }); privateRoot(outputDirectory);
    // The exclusive outer directory burns failed decrypt attempts; no candidate is published until validation passes.
    writePrivateJson(outputDirectory, 'decrypt.started.json', { status: 'DECRYPT_ATTEMPT_STARTED' }, 'CANDIDATE_OUTPUT_EXISTS');
    const scope = validateCandidateScope(readBytes(scopeFile, 8192, true), scopeSha);
    check(id(exportRunId) && exportRunId !== scope.sourceRunId, 'CANDIDATE_EXECUTION_BINDING_MISMATCH');
    const raw = readBytes(input, MAX_ENVELOPE, true);
    check(pin(envelopeSha) && sha(raw) === envelopeSha, 'CANDIDATE_ENVELOPE_HASH_MISMATCH');
    const key = createPrivateKey(readBytes(keyFile, 16384, true));
    check(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 3072
      && sha(createPublicKey(key).export({ type: 'spki', format: 'der' })) === scope.recipientSha256, 'CANDIDATE_RECIPIENT_INVALID');
    const decoded = decodedFiles(raw, key, { scopeSha256: scopeSha, scope, exportRunId });
    const staged = path.join(outputDirectory, 'incomplete'); fs.mkdirSync(staged, { mode: 0o700 });
    for (const [name, file] of decoded.files) {
      const parent = path.dirname(path.join(staged, name));
      if (parent !== staged && !fs.existsSync(parent)) fs.mkdirSync(parent, { mode: 0o700 });
      privateRoot(parent); writePrivateBytes(parent, path.basename(name), file.bytes);
    }
    const actual = sourceSnapshot(staged);
    check(sha(JSON.stringify(manifestOf(actual.files))) === decoded.manifestSha256, 'CANDIDATE_OUTPUT_VERIFY_FAILED');
    writePrivateJson(outputDirectory, 'manifest.json', { ...safe('DECRYPTED_CANDIDATE_NOT_ADOPTED'),
      ...contextOf({ scopeSha256: scopeSha, scope, exportRunId }), envelopeSha256: envelopeSha,
      manifestSha256: decoded.manifestSha256, files: decoded.manifest }, 'CANDIDATE_OUTPUT_EXISTS');
    absent(path.join(outputDirectory, 'candidate'), 'CANDIDATE_OUTPUT_EXISTS');
    fs.renameSync(staged, path.join(outputDirectory, 'candidate'));
    const d = fs.openSync(outputDirectory, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
    return { ...safe('DECRYPTED_CANDIDATE_NOT_ADOPTED'), fileCount: decoded.files.size,
      envelopeSha256: envelopeSha, manifestSha256: decoded.manifestSha256, sourceStateModified: false };
  }, 'CANDIDATE_DECRYPT_FAILED');
}
