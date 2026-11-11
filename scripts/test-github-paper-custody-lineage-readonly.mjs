import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryGithub, sha } from './fixtures/github-paper-custody.mjs';
import {
  inspectGithubCustodyLineageReadOnly, openGithubCustody, releaseGithubCustody,
} from './lib/github-paper-custody.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-lineage-readonly-')));
await fs.chmod(root, 0o700);
let checks = 0, count = 0;
const inspect = (f, extra = {}) => inspectGithubCustodyLineageReadOnly({
  config: f.config, request: f.request, privateKey: f.privateKey, ...extra,
});
const hold = async (f, extra = {}) => {
  const before = f.calls.length;
  const out = await inspect(f, extra);
  assert.equal(out.status, 'HOLD_CRYPTOGRAPHIC_LINEAGE_NOT_OPERATIONAL_AUTHORITY');
  assert.equal(out.cryptographicLineageVerified, true);
  assert.deepEqual(out.findings, []);
  assert.ok(out.snapshot && out.snapshot.currentCommit === (extra.config || f.config).expectedCommit);
  assert.ok(f.calls.slice(before).every(c => c.method === 'GET'), 'read-only must not POST/PATCH');
  assert.equal(out.brokerSubmitAuthorized, false);
  assert.equal(out.stateMutationAuthorized, false);
  assert.equal(out.operationalEligible, false);
  assert.equal(out.authenticatedEnvironmentVerified, false);
  assert.equal(out.accountWideWriterExclusionVerified, false);
  checks++;
  return out;
};
const deny = async (f, code, extra = {}) => {
  const before = f?.calls.length ?? 0;
  const out = await (f ? inspect(f, extra) : inspectGithubCustodyLineageReadOnly(extra));
  assert.equal(out.status, 'DENY_LINEAGE_EVIDENCE_INVALID');
  assert.ok(out.findings.includes(code), JSON.stringify(out.findings));
  assert.equal(out.cryptographicLineageVerified, false);
  assert.equal(out.brokerSubmitAuthorized, false);
  assert.equal(out.stateMutationAuthorized, false);
  assert.equal(out.operationalEligible, false);
  assert.equal(out.snapshot, null);
  if (f) assert.ok(f.calls.slice(before).every(c => c.method === 'GET'));
  checks++;
};
try {
  const seed = memoryGithub();
  const seeded = await hold(seed);
  assert.equal(seeded.snapshot.phase, 'SEED');
  assert.equal(seeded.snapshot.sequence, 0);
  assert.equal(seeded.snapshot.parentCommit, null);
  assert.equal(seeded.snapshot.writer, null);
  assert.equal(seeded.snapshot.accountSha256, seed.config.accountSha256);
  assert.equal(seeded.snapshot.scopeSha256, seed.config.scopeSha256);
  checks += 6;

  await deny(null, 'READ_ONLY_INPUT_INVALID', null);
  await deny(null, 'READ_ONLY_INPUT_INVALID', {});
  await deny(null, 'READ_ONLY_INPUT_INVALID', { config: seed.config });
  await deny(seed, 'CONFIG_INVALID', { config: { ...seed.config, ref: 'refs/heads/main' } });
  await deny(seed, 'CONFIG_INVALID', { config: { ...seed.config, runAttempt: 2 } });
  await deny(seed, 'KEY_MISMATCH', { config: { ...seed.config, recipientSha256: sha('wrong') } });
  await deny(seed, 'READ_ONLY_INPUT_INVALID', { request: null });
  await deny(seed, 'READ_ONLY_INPUT_INVALID', { privateKey: null });

  const active = memoryGithub(), directory = path.join(root, 'one-writer');
  const session = await openGithubCustody({
    config: active.config, request: active.request,
    privateKey: active.privateKey, directory,
  });
  const claimHead = active.head();
  const claim = await hold(active, { config: { ...active.config, expectedCommit: claimHead } });
  assert.equal(claim.snapshot.phase, 'CLAIM');
  assert.equal(claim.snapshot.sequence, 1);
  assert.equal(claim.snapshot.parentCommit, active.config.genesisCommit);
  assert.deepEqual(claim.snapshot.writer, {
    runId: active.config.runId, runAttempt: active.config.runAttempt,
    workflow: active.config.workflow, codeSha256: active.config.codeSha256,
  });
  assert.ok(claim.snapshot.envelopeSha256.length === 64);
  checks += 5;

  await deny(active, 'HEAD_DRIFT', { config: active.config });
  await deny(active, 'HISTORY_LIMIT', { config: {
    ...active.config, expectedCommit: claimHead, maxHistory: 1,
  } });
  await releaseGithubCustody(session);
  const handed = await hold(active, { config: {
    ...active.config, expectedCommit: active.head(),
  } });
  assert.equal(handed.snapshot.phase, 'HANDOFF');
  assert.equal(handed.snapshot.writer, null);
  assert.equal(handed.snapshot.sequence, 2);
  checks += 3;

  const broken = memoryGithub();
  broken.fail = ({ path: uri }) => uri.includes('/blobs/')
    ? { status: 200, data: { sha: uri.split('/').at(-1), encoding: 'base64', content: 'e30=' } } : null;
  await deny(broken, 'BLOB_INVALID');
  const multiParent = memoryGithub();
  multiParent.objects.get(multiParent.head()).parents.push({ sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40) });
  await deny(multiParent, 'COMMIT_INVALID');
  const noRef = memoryGithub(); noRef.fail = () => ({ status: 404, data: {} });
  await deny(noRef, 'RESPONSE_INVALID');
  const rawError = memoryGithub(); rawError.request = async () => {
    throw Error('synthetic forbidden token private information');
  };
  const failure = await inspect(rawError);
  assert.equal(failure.status, 'DENY_LINEAGE_EVIDENCE_INVALID');
  assert.ok(!JSON.stringify(failure).includes('synthetic forbidden token'));
  assert.ok(failure.findings.every(x => /^[A-Z_]+$/.test(x)));
  checks += 3;

  const raced = memoryGithub(); let refReads = 0;
  const original = raced.request;
  raced.request = async input => {
    if (input.method === 'GET' && input.path.endsWith('/ref/heads/paper-state')) {
      refReads++;
      if (refReads === 2) raced.move('7'.repeat(40));
    }
    return original(input);
  };
  await deny(raced, 'HEAD_DRIFT_AFTER_READ');
  assert.equal(refReads, 2); checks++;

  const injected = memoryGithub();
  await deny(injected, 'CONFIG_INVALID', { config: { ...injected.config,
    repository: '../malicious',
  } });
  assert.equal(injected.calls.length, 0); checks++;
  const malformed = memoryGithub();
  await deny(malformed, 'READ_ONLY_INPUT_INVALID', { extra: 'unexpected' });
  assert.equal(malformed.calls.length, 0); checks++;

  console.log(JSON.stringify({
    status: 'OFFLINE_GITHUB_CUSTODY_CRYPTOGRAPHIC_LINEAGE_READONLY_PASS',
    checks, actualGithubRequests: 0, brokerRequests: 0, stateWritesByInspector: 0,
    orderAuthorityGranted: 0,
  }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
