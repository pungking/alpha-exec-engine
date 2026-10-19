import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { operationalFixture, hash } from './fixtures/scoped-paper-adapter.mjs';
import { SCOPED_PAPER_REVIEWED_FILES } from './lib/scoped-paper-adapter.mjs';
import * as operational from './lib/scoped-paper-operational.mjs';
import { main } from './run-scoped-paper-closeout.mjs';

assert.equal(typeof operational.loadOperationalEvidenceFiles, 'function', 'load and pin actual bytes, not caller PASS labels');
assert.equal(typeof operational.verifyOperationalEvidenceFiles, 'function');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let checks = 0;
async function fixture() {
  const { config } = operationalFixture();
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'operational-files-')));
  await fs.chmod(directory, 0o700);
  const write = async (name, value) => {
    const file = path.join(directory, `${name}.json`), bytes = Buffer.from(JSON.stringify(value));
    await fs.writeFile(file, bytes, { mode: 0o600 }); return { path: file, sha256: sha(bytes) };
  };
  config.sourceFile = await write('source', { schemaVersion: 'scoped-paper-source-v1', accountSha256: config.input.accountSha256,
    termsSha256: config.input.termsSha256, preWriteHashes: config.input.preWriteHashes, targets: config.input.terms.targets });
  config.input.sourceSha256 = config.sourceFile.sha256;
  config.codeFiles = await Promise.all(SCOPED_PAPER_REVIEWED_FILES.map(async file => ({ path: file, sha256: sha(await fs.readFile(file)) })));
  config.input.codeSha256 = hash(config.codeFiles);
  config.sourcePolicy.contractFile = await write('source-contract', { status: 'UNKNOWN', continuity: 'UNVERIFIED' });
  config.sourcePolicy.riskPolicyFile = await write('risk', { status: 'PASS', evidence: 'synthetic-label-is-not-proof' });
  config.sourcePolicy.clockPolicyFile = await write('clock', { status: 'UNVERIFIED' });
  config.custody.evidenceFile = await write('custody', { status: 'NOT_ADOPTED' });
  config.oversight.operatorAttendanceFile = await write('attendance', { status: 'NOT_AUTHORIZED' });
  const refs = [config.sourcePolicy.contractFile, config.sourcePolicy.riskPolicyFile, config.sourcePolicy.clockPolicyFile,
    config.custody.evidenceFile, config.oversight.operatorAttendanceFile];
  return { config, directory, refs, write };
}
const p = await fixture();
try {
  const files = await operational.loadOperationalEvidenceFiles({ config: p.config });
  assert.equal(files.status, 'PINNED_BYTES_VERIFIED_NOT_READINESS');
  assert.equal(files.sourceEvidenceVerified, false); assert.equal(files.brokerSubmitAllowed, false);
  assert.equal(files.documents.sourceContract.status, 'UNKNOWN');
  assert.equal(files.documents.riskPolicy.status, 'PASS');
  assert.equal(Object.keys(files.documents).length, 5);
  assert.equal(Object.isFrozen(files.documents.riskPolicy), true);
  assert.equal(await operational.verifyOperationalEvidenceFiles({ config: p.config, files }), true);
  await assert.rejects(() => operational.verifyOperationalEvidenceFiles({ config: p.config, files: structuredClone(files) }), /FILES_UNBOUND/);
  const changed = structuredClone(p.config); changed.oversight.intervalMs++;
  await assert.rejects(() => operational.verifyOperationalEvidenceFiles({ config: changed, files }), /FILES_UNBOUND/); checks += 10;
  for (const ref of [p.config.sourceFile, ...p.refs]) {
    const before = await fs.readFile(ref.path);
    await fs.appendFile(ref.path, ' ');
    await assert.rejects(() => operational.verifyOperationalEvidenceFiles({ config: p.config, files }), /FILE_HASH_DRIFT/);
    await fs.writeFile(ref.path, before); checks++;
  }
  const badCode = structuredClone(p.config); badCode.codeFiles[0].sha256 = hash('not-current-code');
  badCode.input.codeSha256 = hash(badCode.codeFiles);
  await assert.rejects(() => operational.loadOperationalEvidenceFiles({ config: badCode }), /FILE_HASH_DRIFT/); checks++;
  const duplicate = structuredClone(p.config); duplicate.sourcePolicy.riskPolicyFile = duplicate.sourcePolicy.contractFile;
  await assert.rejects(() => operational.loadOperationalEvidenceFiles({ config: duplicate }), /FILE_IDENTITY_DUPLICATE/); checks++;
  const malformed = structuredClone(p.config); delete malformed.sourcePolicy;
  const originalOpen = fs.open; let opened = 0;
  fs.open = async (...args) => { opened++; return originalOpen(...args); };
  try { await assert.rejects(() => operational.loadOperationalEvidenceFiles({ config: malformed }), /CONFIG_INVALID/); }
  finally { fs.open = originalOpen; }
  assert.equal(opened, 0); checks += 2;
} finally { await fs.rm(p.directory, { recursive: true, force: true }); }

const invocation = await fixture();
try {
  const approval = operationalFixture().approval;
  approval.stableScopeSha256 = hash(invocation.config);
  const configPin = await invocation.write('invocation', invocation.config), approvalPin = await invocation.write('approval', approval);
  const args = ['--validate-operational', configPin.path, configPin.sha256, approvalPin.path, approvalPin.sha256];
  const forbidden = { get transport() { assert.fail('local validation must not inspect credentials/transport'); },
    get observationTransport() { assert.fail('local validation must not create an observer'); },
    get notify() { assert.fail('local validation must not inspect sender'); } };
  const before = await fs.readdir(invocation.directory);
  const valid = await main(args, forbidden);
  assert.equal(valid.status, 'PINNED_INPUTS_VERIFIED_NOT_READY');
  assert.equal(valid.executionAuthorized, false); assert.equal(valid.sourceReadinessProven, false);
  assert.equal(valid.actualBrokerMutationAttempted, false); assert.equal(valid.actualStateWriteAttempted, false);
  assert.deepEqual(await fs.readdir(invocation.directory), before);
  assert.equal((await main(['--validate'], { config: invocation.config })).status, 'PASS'); checks += 7;
  for (const change of [a => { a.kind = 'DIRECT_SCOPED_OPERATOR_INVOCATION'; }, a => { a.stableScopeSha256 = hash('other-config'); },
    a => { a.approvedAt = 'invalid'; }, a => { a.expiresAt = '2026-10-09T15:00:00.000Z'; }]) {
    const bad = structuredClone(approval); change(bad); const ref = await invocation.write('approval', bad);
    const result = await main([...args.slice(0, 3), ref.path, ref.sha256], forbidden);
    assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.reasons, ['SCOPED_CLOSEOUT_AUTHORITY_INVALID']); checks += 2;
  }
  await invocation.write('approval', approval);
  await fs.appendFile(configPin.path, ' ');
  assert.equal((await main(args, forbidden)).status, 'BLOCKED');
  await invocation.write('invocation', invocation.config);
  await fs.appendFile(invocation.config.custody.evidenceFile.path, ' ');
  assert.equal((await main(args, forbidden)).status, 'BLOCKED'); checks += 2;
  const originalOpen = fs.open; let opened = 0;
  fs.open = async (...values) => { opened++; return originalOpen(...values); };
  try {
    assert.equal((await main([], forbidden)).status, 'CONFIGURATION_REQUIRED');
    for (const bad of [args.slice(0, 4), [...args, 'extra'], [args[0], 'relative-file', ...args.slice(2)],
      [args[0], args[1], 'not-a-sha', ...args.slice(3)]]) assert.ok(['ARGUMENTS_INVALID', 'BLOCKED'].includes((await main(bad, forbidden)).status));
  } finally { fs.open = originalOpen; }
  assert.equal(opened, 0); checks += 6;
  assert.ok(!JSON.stringify(valid).includes(invocation.directory)); checks++;
  await assert.rejects(() => operational.loadOperationalInvocationFiles({
    configFile: { path: path.join(invocation.directory, 'missing-private-config.json'), sha256: hash('missing') }, approvalFile: approvalPin,
  }), error => /^SCOPED_(CLOSEOUT|ADAPTER)_[A-Z_]+$/.test(error.message) && !error.message.includes(invocation.directory)); checks++;
} finally { await fs.rm(invocation.directory, { recursive: true, force: true }); }

for (const mode of ['missing', 'symlink', 'parent-symlink', 'hardlink', 'public', 'non-json', 'array']) {
  const p = await fixture();
  try {
    const ref = p.config.sourcePolicy.contractFile;
    if (mode === 'missing') await fs.unlink(ref.path);
    if (mode === 'symlink') { await fs.rename(ref.path, `${ref.path}.original`); await fs.symlink(`${ref.path}.original`, ref.path); }
    if (mode === 'parent-symlink') {
      const real = path.join(p.directory, 'real'), link = path.join(p.directory, 'link'); await fs.mkdir(real, { mode: 0o700 });
      await fs.rename(ref.path, path.join(real, 'contract.json')); await fs.symlink(real, link); ref.path = path.join(link, 'contract.json');
    }
    if (mode === 'hardlink') await fs.link(ref.path, `${ref.path}.alias`);
    if (mode === 'public') await fs.chmod(ref.path, 0o644);
    if (mode === 'non-json' || mode === 'array') {
      const bytes = mode === 'array' ? '[]' : 'synthetic-secret-not-json';
      await fs.writeFile(ref.path, bytes); ref.sha256 = sha(bytes);
    }
    await assert.rejects(() => operational.loadOperationalEvidenceFiles({ config: p.config }), error => {
      assert.match(error.message, /^SCOPED_(ADAPTER|CLOSEOUT)_[A-Z_]+$/);
      assert.ok(!error.message.includes(p.directory) && !error.message.includes('synthetic-secret')); return true;
    }); checks += 3;
  } finally { await fs.rm(p.directory, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-operational-pinned-files', checks,
  sourceReadinessProven: false, brokerRequests: 0, productionStateWrites: 0 }));
