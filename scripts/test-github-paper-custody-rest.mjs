import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGithubPaperCustodyRestRequest } from './lib/github-paper-custody-rest.mjs';
import { openGithubCustody, checkpointGithubCustody, releaseGithubCustody } from './lib/github-paper-custody.mjs';
import { memoryGithub } from './fixtures/github-paper-custody.mjs';

const ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'custody-rest-offline-')));
await fs.chmod(ROOT, 0o700);
const TOKEN = 'synthetic-test-only-token-not-a-secret';
let checks = 0, serial = 0, brokerRequests = 0;
const check = fn => { checks++; return fn(); };
const blocked = async (fn, code) => {
  checks++;
  await assert.rejects(fn, err => err?.message === 'GITHUB_CUSTODY_REST_' + code);
};
const newDirectory = () => path.join(ROOT, 'restore-' + serial++);
function fixture() {
  const git = memoryGithub();
  let httpCalls = 0, malformed = null, contentLength = null;
  const fetchImpl = async (url, init) => {
    httpCalls++;
    assert.equal(url.startsWith('https://api.github.com/repos/fixture/engine/git/'), true);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.ok(init.signal && !init.signal.aborted);
    if (malformed) return new Response(malformed, { status: 200,
      headers: contentLength === null ? {} : { 'content-length': contentLength } });
    const result = await git.request({
      method: init.method, path: url.slice('https://api.github.com'.length),
      body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal,
    });
    return new Response(JSON.stringify(result.data), { status: result.status,
      headers: contentLength === null ? {} : { 'content-length': contentLength } });
  };
  const request = createGithubPaperCustodyRestRequest({
    repository: git.config.repository, token: TOKEN, fetchImpl,
  });
  return { git, request, get httpCalls() { return httpCalls; },
    setMalformed: (value, len = null) => { malformed = value; contentLength = len; } };
}
const invoke = (f, opts = {}) => openGithubCustody({
  config: f.git.config, request: f.request, privateKey: f.git.privateKey,
  directory: newDirectory(), ...opts,
});
try {
  check(() => assert.throws(() => createGithubPaperCustodyRestRequest({}),
    /GITHUB_CUSTODY_REST_CONFIG_INVALID/));
  for (const config of [
    { repository: '../other', token: TOKEN, fetchImpl: () => {} },
    { repository: 'fixture/engine', token: '', fetchImpl: () => {} },
    { repository: 'fixture/engine', token: TOKEN, fetchImpl: null },
    { repository: 'fixture/engine', token: TOKEN + '\n', fetchImpl: () => {} },
  ]) check(() => assert.throws(() => createGithubPaperCustodyRestRequest(config),
    /GITHUB_CUSTODY_REST_CONFIG_INVALID/));

  const f = fixture(), signal = new AbortController().signal;
  const expectedPrefix = '/repos/fixture/engine/git/';
  const noNetwork = async (method, tail, body, code) => {
    const count = f.httpCalls;
    await blocked(() => f.request({ method, path: expectedPrefix + tail, body, signal }), code);
    assert.equal(f.httpCalls, count, 'invalid route must never invoke HTTP');
  };
  await noNetwork('GET', 'ref/heads/main', undefined, 'ROUTE_INVALID');
  await noNetwork('GET', 'refs/heads/paper-state', undefined, 'ROUTE_INVALID');
  await noNetwork('GET', 'commits/latest', undefined, 'ROUTE_INVALID');
  await noNetwork('GET', '../secrets', undefined, 'ROUTE_INVALID');
  await noNetwork('POST', 'refs/heads/paper-state', {}, 'ROUTE_INVALID');
  await noNetwork('PATCH', 'refs/heads/paper-state', { sha: 'a'.repeat(40), force: true }, 'ROUTE_INVALID');
  await noNetwork('PATCH', 'refs/heads/paper-state', { sha: 'a'.repeat(40), force: false, extra: 1 }, 'ROUTE_INVALID');
  await noNetwork('POST', 'commits', { message: 'unexpected', tree: 'a'.repeat(40), parents: ['a'.repeat(40)] }, 'PAYLOAD_INVALID');
  await noNetwork('POST', 'trees', { tree: [{ path: 'other.json', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }] }, 'PAYLOAD_INVALID');
  await noNetwork('POST', 'blobs', { content: '', encoding: 'base64' }, 'PAYLOAD_INVALID');
  await noNetwork('DELETE', 'ref/heads/paper-state', {}, 'METHOD_INVALID');
  await noNetwork('GET', 'blobs/' + 'a'.repeat(40), {}, 'ROUTE_INVALID');
  const canceled = new AbortController(); canceled.abort();
  const count = f.httpCalls;
  await blocked(() => f.request({ method: 'GET', path: expectedPrefix + 'ref/heads/paper-state',
    signal: canceled.signal }), 'SIGNAL_INVALID');
  assert.equal(f.httpCalls, count); checks++;

  const session = await invoke(f);
  check(() => assert.equal(f.git.snapshot().phase, 'CLAIM'));
  check(() => assert.equal(f.git.head() !== f.git.config.genesisCommit, true));
  // An active writer is a durable checkpoint, not an in-process or GitHub Actions-only lock.
  await assert.rejects(invoke(f, { config: { ...f.git.config, expectedCommit: f.git.head(), runId: '3' } }),
    /GITHUB_CUSTODY_WRITER_ACTIVE/); checks++;
  const before = f.git.head();
  await checkpointGithubCustody(session, 'OBSERVATION');
  check(() => assert.notEqual(f.git.head(), before));
  check(() => assert.equal(f.git.snapshot().phase, 'OBSERVATION'));
  await releaseGithubCustody(session);
  check(() => assert.equal(f.git.snapshot().phase, 'HANDOFF'));
  const successor = await invoke(f, { config: { ...f.git.config, expectedCommit: f.git.head(), runId: '3' } });
  await releaseGithubCustody(successor); checks++;
  const writes = f.git.calls.filter(x => x.method !== 'GET');
  check(() => assert.ok(writes.length > 0));
  for (const call of writes.filter(x => x.method === 'PATCH')) {
    check(() => assert.deepEqual(Object.keys(call.body).sort(), ['force', 'sha']));
    check(() => assert.equal(call.body.force, false));
  }

  const conflict = fixture();
  const result = await Promise.allSettled([invoke(conflict), invoke(conflict, {
    config: { ...conflict.git.config, runId: '3' },
  })]);
  check(() => assert.equal(result.filter(z => z.status === 'fulfilled').length, 1));
  check(() => assert.ok(result.some(z => z.status === 'rejected')));
  const winner = result.find(z => z.status === 'fulfilled');
  await releaseGithubCustody(winner.value); checks++;
  const stale = await invoke(conflict, { config: { ...conflict.git.config,
    expectedCommit: conflict.git.head(), runId: '4' } });
  await releaseGithubCustody(stale); checks++;

  const ambiguous = fixture();
  ambiguous.git.afterPatch = () => { throw Error('synthetic private auth response, do not log'); };
  await assert.rejects(invoke(ambiguous), e => /^GITHUB_CUSTODY_[A-Z_]+$/.test(e.message)
    && !e.message.includes('private')); checks++;
  check(() => assert.equal(ambiguous.git.snapshot().phase, 'CLAIM'));
  await assert.rejects(invoke(ambiguous, { config: { ...ambiguous.git.config,
    expectedCommit: ambiguous.git.head(), runId: '3' } }), /GITHUB_CUSTODY_WRITER_ACTIVE/); checks++;

  const malformed = fixture();
  malformed.setMalformed('{malformed');
  await assert.rejects(invoke(malformed), /GITHUB_CUSTODY_/); checks++;
  const oversized = fixture();
  oversized.setMalformed('{}', String(128 * 1024 * 1024 + 1));
  await assert.rejects(invoke(oversized), /GITHUB_CUSTODY_/); checks++;
  const failed = fixture();
  const deniedFetch = async () => { throw Error('http log token ' + TOKEN); };
  const denial = createGithubPaperCustodyRestRequest({
    repository: 'fixture/engine', token: TOKEN, fetchImpl: deniedFetch,
  });
  await blocked(() => denial({ method: 'GET', path: expectedPrefix + 'ref/heads/paper-state', signal }),
    'REQUEST_FAILED');
  check(() => assert.ok(!JSON.stringify({ status: 'HOLD', checks, brokerRequests }).includes(TOKEN)));
  check(() => assert.equal(brokerRequests, 0));
  console.log(JSON.stringify({
    status: 'OFFLINE_GITHUB_CUSTODY_REST_BRIDGE_PASS', checks,
    brokerRequests, actualGithubRequests: 0, paperStateProvisioned: false,
    accountWriterAuthorized: false,
  }));
} finally {
  await fs.rm(ROOT, { recursive: true, force: true });
}
