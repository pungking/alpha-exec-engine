import { createHash, generateKeyPairSync } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../paper-exact-cache-private-export.mjs';
import { fixture } from './scoped-closeout.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const gitId = obj => createHash('sha1').update(JSON.stringify(obj)).digest('hex');
export const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const sourceBytes = Buffer.from('{"schemaVersion":"synthetic-source-only"}');
export function file(name, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes));
  return { path: name, sha256: sha(bytes), bytes: bytes.toString('base64') };
}
export function memoryGithub({ mutatePayload = () => {}, extraFiles = [] } = {}) {
  const { input } = fixture(), calls = [], objects = new Map();
  const config = { schemaVersion: 'github-paper-custody-config-v1', repository: 'fixture/engine',
    ref: 'refs/heads/paper-state', genesisCommit: '', expectedCommit: '',
    recipientSha256: sha(keys.publicKey.export({ type: 'spki', format: 'der' })),
    accountSha256: input.accountSha256, scopeSha256: input.termsSha256, attemptId: input.attemptId,
    runId: '2', runAttempt: 1, workflow: '.github/workflows/dry-run.yml', codeSha256: sha('fixture-code'),
    inputFiles: { 'inputs/source.json': sha(sourceBytes) }, maxRequests: 256, maxHistory: 32, timeoutMs: 1000 };
  const context = { repository: config.repository, ref: config.ref, recipientSha256: config.recipientSha256,
    sequence: 0, parentCommit: null, runId: '1', runAttempt: 1, workflow: config.workflow, codeSha256: config.codeSha256 };
  const payload = { schemaVersion: 'github-paper-state-v1', context, environment: 'PAPER',
    accountSha256: config.accountSha256, scopeSha256: config.scopeSha256, attemptId: config.attemptId,
    previousEnvelopeSha256: null, writer: null, phase: 'SEED', files: [
      file('order-ledger.json', { orders: {}, updatedAt: '' }),
      file('order-idempotency.json', { orders: {}, releases: [], updatedAt: '' }),
      file('inputs/source.json', sourceBytes), ...extraFiles].sort((a, b) => a.path.localeCompare(b.path)) };
  mutatePayload(payload);
  const envelope = encryptPayload(payload, context, keys.publicKey, 'github-paper-custody-envelope-v1');
  function blob(bytes) { const id = gitBlob(bytes); objects.set(id, { sha: id, encoding: 'base64', content: bytes.toString('base64') }); return id; }
  function tree(id) { const data = { tree: [{ path: 'checkpoint.enc.json', mode: '100644', type: 'blob', sha: id }], truncated: false };
    const sha = gitId(data); objects.set(sha, { ...data, sha }); return sha; }
  function commit(t, parents) { const data = { tree: { sha: t }, parents: parents.map(sha => ({ sha })) };
    const sha = gitId(data); objects.set(sha, { ...data, sha }); return sha; }
  let head = commit(tree(blob(envelope)), []);
  config.genesisCommit = config.expectedCommit = head;
  const f = { config, calls, objects, payload, envelope, privateKey: keys.privateKey,
    fail: null, afterPatch: null, head: () => head, move: value => { head = value; } };
  f.snapshot = () => {
    const tree = objects.get(objects.get(head).tree.sha), blob = objects.get(tree.tree[0].sha);
    const e = JSON.parse(Buffer.from(blob.content, 'base64'));
    return decryptPayload(e, keys.privateKey, e.context);
  };
  f.request = async ({ method, path, body, signal }) => {
    if (signal.aborted) throw Error('fixture aborted');
    calls.push({ method, path, body });
    if (f.fail) { const value = await f.fail({ method, path, body }); if (value) return value; }
    const base = '/repos/fixture/engine/git/';
    if (!path.startsWith(base)) throw Error('fixture unexpected route');
    const route = path.slice(base.length);
    if (method === 'GET' && route === 'ref/heads/paper-state') return { status: 200, data: { ref: config.ref, object: { type: 'commit', sha: head } } };
    if (method === 'GET' && /^(commits|trees|blobs)\/[a-f0-9]{40}$/.test(route)) {
      const data = objects.get(route.split('/')[1]); return { status: data ? 200 : 404, data: structuredClone(data) };
    }
    if (method === 'POST' && route === 'blobs') return { status: 201, data: { sha: blob(Buffer.from(body.content, 'base64')) } };
    if (method === 'POST' && route === 'trees') return { status: 201, data: { sha: tree(body.tree[0].sha) } };
    if (method === 'POST' && route === 'commits') return { status: 201, data: { sha: commit(body.tree, body.parents) } };
    if (method === 'PATCH' && route === 'refs/heads/paper-state') {
      const next = objects.get(body.sha);
      if (body.force !== false || next?.parents.length !== 1 || next.parents[0].sha !== head) return { status: 409, data: {} };
      head = body.sha; if (f.afterPatch) await f.afterPatch();
      return { status: 200, data: { ref: config.ref, object: { type: 'commit', sha: head } } };
    }
    throw Error('fixture unexpected method');
  };
  return f;
}
