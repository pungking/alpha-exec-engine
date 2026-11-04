import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createPublicKey } from 'node:crypto';
import { encryptPayload, decryptPayload, readBytes, directory as privateDirectory } from '../paper-exact-cache-private-export.mjs';
import { validateScopedOrderLedgerState } from '../../dist/src/order-ledger-storage.js';
import { validateScopedOrderIdempotencyState } from '../../dist/src/order-idempotency-storage.js';
import { parseStrictJsonText } from '../../dist/src/json-utils.js';
import { sha256Canonical as canonical } from './active-position-limited-recovery.mjs';

const sessions = new WeakMap(), LIMIT = 64 * 1024 * 1024;
const SCHEMA = 'github-paper-custody-envelope-v1';
const phases = ['CLAIM', 'BACKUP', 'RESERVATION', 'ATTEMPT', 'WIRE', 'OBSERVATION_CLAIM', 'OBSERVATION', 'NOTIFICATION', 'HANDOFF'];
const sha = b => createHash('sha256').update(b).digest('hex');
const gitBlob = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const pin = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const git = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const check = (ok, reason) => { if (!ok) throw Error(`GITHUB_CUSTODY_${reason}`); };
const safeError = e => Error(/^GITHUB_CUSTODY_[A-Z_]+$/.test(e?.message) ? e.message : 'GITHUB_CUSTODY_FAILED');
const json = bytes => parseStrictJsonText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'GITHUB_CUSTODY_JSON_INVALID');
function base64(value) {
  check(typeof value === 'string' && value.length <= LIMIT * 2, 'ENCODING_INVALID');
  const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value && bytes.length <= LIMIT, 'ENCODING_INVALID'); return bytes;
}
function configuration(c) {
  check(exact(c, 'schemaVersion repository ref genesisCommit expectedCommit recipientSha256 accountSha256 scopeSha256 attemptId runId runAttempt workflow codeSha256 inputFiles maxRequests maxHistory timeoutMs')
    && c.schemaVersion === 'github-paper-custody-config-v1' && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(c.repository)
    && c.ref === 'refs/heads/paper-state' && git(c.genesisCommit) && git(c.expectedCommit)
    && ['recipientSha256', 'accountSha256', 'scopeSha256', 'codeSha256'].every(k => pin(c[k]))
    && /^[A-Za-z0-9_-]{1,96}$/.test(c.attemptId) && /^[1-9]\d*$/.test(c.runId) && c.runAttempt === 1
    && /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(c.workflow)
    && object(c.inputFiles) && Object.keys(c.inputFiles).length > 0
    && Object.entries(c.inputFiles).every(([k, v]) => /^inputs\/[A-Za-z0-9_-]+\.json$/.test(k) && pin(v))
    && ['maxRequests', 'maxHistory', 'timeoutMs'].every(k => Number.isSafeInteger(c[k]) && c[k] > 0)
    && c.maxHistory <= 1000 && c.maxRequests <= 10000 && c.timeoutMs <= 30000, 'CONFIG_INVALID');
}
export function validateGithubCustodyConfiguration(config) {
  try { configuration(config); return { status: 'VALID_NOT_EXECUTION_READY', executionAuthorized: false }; }
  catch { return { status: 'BLOCKED', reasons: ['GITHUB_CUSTODY_CONFIG_INVALID'], executionAuthorized: false }; }
}
function context(c, sequence, parentCommit) {
  return { repository: c.repository, ref: c.ref, recipientSha256: c.recipientSha256, sequence, parentCommit,
    runId: c.runId, runAttempt: c.runAttempt, workflow: c.workflow, codeSha256: c.codeSha256 };
}
const writer = c => ({ runId: c.runId, runAttempt: c.runAttempt, workflow: c.workflow, codeSha256: c.codeSha256 });
function allowed(name, c) {
  if (['order-ledger.json', 'order-idempotency.json'].includes(name) || Object.hasOwn(c.inputFiles, name)) return true;
  const prefix = `.scoped-closeout-${c.attemptId}/`;
  return name.startsWith(prefix) && /^(order-ledger\.json|order-idempotency\.json|wire-[0-4]\.json|observation-[a-f0-9]{64}\.json|notifications\.json)$/.test(name.slice(prefix.length));
}
function noSecrets(v) {
  if (Array.isArray(v)) { v.forEach(noSecrets); return; }
  if (object(v)) for (const [key, value] of Object.entries(v)) {
    check(!/(api.?key|access.?token|refresh.?token|password|credential|private.?key|secret|authorization|cookie)/i.test(key), 'SECRET_FIELD'); noSecrets(value);
  }
  if (typeof v === 'string') check(!/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(v), 'SECRET_FIELD');
}
function filesOf(files, c) {
  check(Array.isArray(files) && files.length > 0 && files.length <= 1000, 'MANIFEST_INVALID');
  const result = new Map(); let total = 0;
  for (const f of files) {
    check(exact(f, 'path sha256 bytes') && typeof f.path === 'string' && allowed(f.path, c)
      && !result.has(f.path) && pin(f.sha256), 'MANIFEST_INVALID');
    const bytes = base64(f.bytes); total += bytes.length;
    check(total <= LIMIT && bytes.length > 0 && sha(bytes) === f.sha256, 'HASH_MISMATCH');
    noSecrets(json(bytes)); result.set(f.path, bytes);
  }
  for (const [name, hash] of Object.entries(c.inputFiles)) check(result.has(name) && sha(result.get(name)) === hash, 'INPUT_MISSING');
  const ledger = json(result.get('order-ledger.json')), idem = json(result.get('order-idempotency.json'));
  validateScopedOrderLedgerState(ledger); validateScopedOrderIdempotencyState(idem);
  const records = Object.values(ledger.orders).filter(r => r.recordKind), others = Object.values(idem.orders).filter(r => r.recordKind);
  check(records.length === others.length && (records.length === 0 || records.length === 5), 'PAIR_INVALID');
  const prefix = `.scoped-closeout-${c.attemptId}/`;
  for (const r of records) {
    check(r.attemptId === c.attemptId && r.accountSha256 === c.accountSha256 && r.termsSha256 === c.scopeSha256
      && canonical(r) === canonical(idem.orders[r.exitIdempotencyKey]) && !idem.releases.some(x => x.key === r.exitIdempotencyKey), 'PAIR_INVALID');
    for (const [key, name] of [['orderLedger', 'order-ledger.json'], ['orderIdempotency', 'order-idempotency.json']])
      check(result.has(prefix + name) && sha(result.get(prefix + name)) === r.preWriteHashes[key], 'BACKUP_MISSING');
  }
  return result;
}
function decode(raw, c, key) {
  check(raw.length <= LIMIT, 'SIZE_LIMIT'); const e = json(raw), x = e?.context;
  check(exact(e, 'schemaVersion algorithm context wrappedKey iv tag ciphertext') && e.schemaVersion === SCHEMA
    && e.algorithm === 'RSA-OAEP-SHA256+A256GCM'
    && exact(x, 'repository ref recipientSha256 sequence parentCommit runId runAttempt workflow codeSha256')
    && x.repository === c.repository && x.ref === c.ref && x.recipientSha256 === c.recipientSha256
    && Number.isSafeInteger(x.sequence) && x.sequence >= 0 && (x.parentCommit === null || git(x.parentCommit))
    && /^[1-9]\d*$/.test(x.runId) && x.runAttempt === 1 && x.workflow === c.workflow && pin(x.codeSha256), 'ENVELOPE_INVALID');
  for (const name of ['wrappedKey', 'iv', 'tag', 'ciphertext']) base64(e[name]);
  const p = decryptPayload(e, key, x);
  check(exact(p, 'schemaVersion context environment accountSha256 scopeSha256 attemptId previousEnvelopeSha256 writer phase files')
    && p.schemaVersion === 'github-paper-state-v1' && canonical(p.context) === canonical(x)
    && p.environment === 'PAPER' && p.accountSha256 === c.accountSha256 && p.scopeSha256 === c.scopeSha256 && p.attemptId === c.attemptId
    && (x.sequence === 0 ? p.phase === 'SEED' && p.previousEnvelopeSha256 === null && x.parentCommit === null
      : phases.includes(p.phase) && pin(p.previousEnvelopeSha256) && git(x.parentCommit))
    && (['SEED', 'HANDOFF'].includes(p.phase) ? p.writer === null : canonical(p.writer) === canonical(writer(x))), 'PAYLOAD_INVALID');
  return { payload: p, files: filesOf(p.files, c), envelopeSha256: sha(raw) };
}
function continuity(before, after, parent) {
  check(after.payload.context.parentCommit === parent && after.payload.context.sequence === before.payload.context.sequence + 1
    && after.payload.previousEnvelopeSha256 === before.envelopeSha256, 'LINEAGE_INVALID');
  for (const [name, bytes] of before.files) {
    check(after.files.has(name), 'FILE_REMOVED');
    if (name === 'order-ledger.json' || name === 'order-idempotency.json') {
      storeEvolution(json(bytes), json(after.files.get(name))); continue;
    }
    if (name.endsWith('/notifications.json')) {
      const a = json(bytes), b = json(after.files.get(name));
      check(Array.isArray(a.seen) && Array.isArray(b.seen) && a.seen.every(k => b.seen.includes(k))
        && Array.isArray(a.attempts) && Array.isArray(b.attempts) && b.attempts.length >= a.attempts.length
        && a.attempts.every((v, i) => Object.keys(v).every(k => k === 'status' || canonical(v[k]) === canonical(b.attempts[i][k]))), 'NOTIFICATION_REGRESSION');
    } else check(bytes.equals(after.files.get(name)), 'IMMUTABLE_FILE_CHANGED');
  }
}
function storeEvolution(a, b) {
  const fixed = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['orders', 'updatedAt'].includes(k)));
  check(canonical(fixed(a)) === canonical(fixed(b)), 'STATE_REGRESSION');
  const mutable = new Set(['recordKind', 'schemaVersion', 'brokerEventTimestamps', 'submissionPhase', 'brokerOrderId',
    'brokerStatus', 'filledQty', 'updatedAt', 'observedEvidenceSha256', 'requestSha256', 'limitPrice', 'history']);
  for (const [key, old] of Object.entries(a.orders)) {
    const next = b.orders[key]; check(next, 'STATE_REGRESSION');
    if (!old.recordKind) { check(canonical(old) === canonical(next), 'STATE_REGRESSION'); continue; }
    check(Object.keys(old).every(k => mutable.has(k) || canonical(old[k]) === canonical(next[k]))
      && next.history.length >= old.history.length && canonical(next.history.slice(0, old.history.length)) === canonical(old.history)
      && (next.history.length !== old.history.length || canonical(next) === canonical(old))
      && (old.requestSha256 === null || old.requestSha256 === next.requestSha256)
      && (old.brokerOrderId === null || old.brokerOrderId === next.brokerOrderId)
      && next.history.filter(e => e.phase === 'ATTEMPTED').length <= 1, 'STATE_REGRESSION');
  }
  for (const [key, row] of Object.entries(b.orders)) check(Object.hasOwn(a.orders, key) || row.recordKind, 'STATE_REGRESSION');
}
async function call(s, method, route, body, status = 200) {
  check(!s.poisoned && s.requests < s.config.maxRequests, 'REQUEST_BUDGET'); s.requests++;
  const controller = new AbortController(); let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => s.request({ method, path: `/repos/${s.config.repository}/git/${route}`, body, signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('GITHUB_CUSTODY_TIMEOUT')); }, s.config.timeoutMs); }),
    ]);
    check(response?.status === status && object(response.data), 'RESPONSE_INVALID'); return response.data;
  } finally { clearTimeout(timer); }
}
async function head(s) {
  const r = await call(s, 'GET', 'ref/heads/paper-state');
  check(r.ref === s.config.ref && r.object?.type === 'commit' && git(r.object.sha), 'REF_INVALID'); return r.object.sha;
}
async function load(s, commitId) {
  const commit = await call(s, 'GET', `commits/${commitId}`);
  check(commit.sha === commitId && git(commit.tree?.sha) && Array.isArray(commit.parents)
    && commit.parents.length <= 1 && commit.parents.every(p => git(p.sha)), 'COMMIT_INVALID');
  const tree = await call(s, 'GET', `trees/${commit.tree.sha}`), entry = tree.tree?.[0];
  check(tree.sha === commit.tree.sha && tree.truncated === false && tree.tree.length === 1 && entry.path === 'checkpoint.enc.json'
    && entry.mode === '100644' && entry.type === 'blob' && git(entry.sha), 'TREE_INVALID');
  const blob = await call(s, 'GET', `blobs/${entry.sha}`);
  check(blob.sha === entry.sha && blob.encoding === 'base64' && typeof blob.content === 'string', 'BLOB_INVALID');
  const raw = base64(blob.content.replace(/[\r\n]/g, ''));
  check(raw.length <= LIMIT && gitBlob(raw) === entry.sha, 'BLOB_INVALID');
  const snap = decode(raw, s.config, s.key), parent = commit.parents[0]?.sha ?? null;
  check(snap.payload.context.parentCommit === parent, 'LINEAGE_INVALID'); return { ...snap, parent };
}
async function history(s) {
  check(await head(s) === s.config.expectedCommit, 'HEAD_DRIFT');
  let id = s.config.expectedCommit, child = null, latest;
  for (let i = 0; i < s.config.maxHistory; i++) {
    const snap = await load(s, id); latest ??= snap;
    if (child) continuity(snap, child, id);
    if (id === s.config.genesisCommit) {
      check(snap.parent === null && snap.payload.context.sequence === 0, 'GENESIS_INVALID'); return latest;
    }
    check(snap.parent !== null, 'GENESIS_MISSING'); child = snap; id = snap.parent;
  }
  throw Error('GITHUB_CUSTODY_HISTORY_LIMIT');
}
async function sync(dir) { const h = await fs.open(dir, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function extract(s) {
  privateDirectory(path.dirname(s.directory), true);
  await fs.mkdir(s.directory, { mode: 0o700 });
  for (const [name, bytes] of s.snapshot.files) {
    const dest = path.join(s.directory, name), parent = path.dirname(dest);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const h = await fs.open(dest, 'wx', 0o600);
    try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
    check(readBytes(dest, LIMIT, true).equals(bytes), 'EXTRACTION_INVALID'); await sync(parent);
  }
  await sync(s.directory);
}
async function localFiles(s) {
  privateDirectory(s.directory, true); const files = [];
  async function walk(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = relative + entry.name, full = path.join(dir, entry.name);
      if (entry.isFile() && (name === '.scoped-closeout.lock' || name === `.scoped-closeout-${s.config.attemptId}/notifications.json.lock`)) continue;
      if (entry.isDirectory()) {
        check(name === 'inputs' || name === `.scoped-closeout-${s.config.attemptId}`, 'PATH_INVALID'); privateDirectory(full, true); await walk(full, name + '/');
      } else {
        check(entry.isFile() && allowed(name, s.config), 'PATH_INVALID');
        const bytes = readBytes(full, LIMIT, true); files.push({ path: name, sha256: sha(bytes), bytes: bytes.toString('base64') });
      }
    }
  }
  await walk(s.directory); files.sort((a, b) => a.path.localeCompare(b.path)); filesOf(files, s.config); return files;
}
function active(session) {
  const s = sessions.get(session); check(s && !s.poisoned && !s.closed, 'SESSION_INVALID'); return s;
}
export function assertGithubCustody(session, { directory, accountSha256, attemptId, receiptPath } = {}) {
  const s = active(session);
  check((directory === undefined || path.resolve(directory) === s.directory) && (accountSha256 === undefined || accountSha256 === s.config.accountSha256)
    && (attemptId === undefined || attemptId === s.config.attemptId)
    && (receiptPath === undefined || receiptPath === path.join(s.directory, `.scoped-closeout-${s.config.attemptId}`, 'notifications.json')), 'BINDING_INVALID'); return true;
}
async function publish(s, phase) {
  check(!s.busy, 'CONCURRENT_WRITE'); s.busy = true;
  try {
    check(await head(s) === s.head, 'HEAD_DRIFT');
    const c = context(s.config, s.snapshot.payload.context.sequence + 1, s.head);
    const p = { ...s.snapshot.payload, context: c, previousEnvelopeSha256: s.snapshot.envelopeSha256,
      phase, writer: phase === 'HANDOFF' ? null : writer(s.config), files: await localFiles(s) };
    const raw = encryptPayload(p, c, s.publicKey, SCHEMA), snap = decode(raw, s.config, s.key);
    continuity(s.snapshot, snap, s.head);
    const b = await call(s, 'POST', 'blobs', { content: raw.toString('base64'), encoding: 'base64' }, 201);
    check(b.sha === gitBlob(raw), 'BLOB_INVALID');
    const t = await call(s, 'POST', 'trees', { tree: [{ path: 'checkpoint.enc.json', mode: '100644', type: 'blob', sha: b.sha }] }, 201);
    check(git(t.sha), 'TREE_INVALID');
    const commit = await call(s, 'POST', 'commits', { message: 'PAPER encrypted checkpoint', tree: t.sha, parents: [s.head] }, 201);
    check(git(commit.sha), 'COMMIT_INVALID');
    await call(s, 'PATCH', 'refs/heads/paper-state', { sha: commit.sha, force: false });
    check(await head(s) === commit.sha, 'ACK_INVALID');
    const verified = await load(s, commit.sha);
    check(verified.envelopeSha256 === snap.envelopeSha256 && canonical(await localFiles(s)) === canonical(p.files), 'ACK_INVALID');
    s.head = commit.sha; s.snapshot = verified;
    return Object.freeze({ commit: s.head, envelopeSha256: verified.envelopeSha256 });
  } catch (e) { s.poisoned = true; throw safeError(e); }
  finally { s.busy = false; }
}
// No network or credential defaults. This storage binding never conveys order authority.
export async function openGithubCustody({ config, request, privateKey, directory }) {
  let s;
  try {
    config = structuredClone(config); configuration(config);
    check(typeof request === 'function' && path.isAbsolute(directory) && path.resolve(directory) === directory
      && privateKey?.type === 'private' && privateKey.asymmetricKeyType === 'rsa' && privateKey.asymmetricKeyDetails.modulusLength >= 2048, 'INPUT_INVALID');
    privateDirectory(path.dirname(directory), true);
    try { await fs.lstat(directory); throw Error('GITHUB_CUSTODY_OUTPUT_EXISTS'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const publicKey = createPublicKey(privateKey);
    check(sha(publicKey.export({ type: 'spki', format: 'der' })) === config.recipientSha256, 'KEY_MISMATCH');
    s = { config, request, key: privateKey, publicKey, directory, requests: 0, head: config.expectedCommit, poisoned: false, closed: false };
    s.snapshot = await history(s); check(s.snapshot.payload.writer === null, 'WRITER_ACTIVE');
    await extract(s); await publish(s, 'CLAIM');
    const session = Object.freeze({}); sessions.set(session, s); return session;
  } catch (e) { if (s) s.poisoned = true; throw safeError(e); }
}
export async function checkpointGithubCustody(session, phase) {
  const s = active(session); check(phases.includes(phase) && !['CLAIM', 'HANDOFF'].includes(phase), 'PHASE_INVALID');
  return publish(s, phase);
}
export async function releaseGithubCustody(session) {
  const s = active(session); const receipt = await publish(s, 'HANDOFF'); s.closed = true; return receipt;
}
