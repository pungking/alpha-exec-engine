import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { operationalFixture, attendedFixture, operationalControlDocuments, hash } from './fixtures/scoped-paper-adapter.mjs';
import { SCOPED_PAPER_REVIEWED_FILES } from './lib/scoped-paper-adapter.mjs';
import * as operational from './lib/scoped-paper-operational.mjs';
import { main } from './run-scoped-paper-closeout.mjs';
import * as evidence from './lib/scoped-paper-evidence.mjs';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';

assert.equal(typeof operational.loadOperationalEvidenceFiles, 'function', 'load and pin actual bytes, not caller PASS labels');
assert.equal(typeof operational.verifyOperationalEvidenceFiles, 'function');
assert.equal(typeof operational.assessOperationalControlEvidence, 'function', 'pinned labels are not custody, writer or attendance attestations');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let checks = 0;
async function fixture(attended = false) {
  const { config } = attended ? attendedFixture() : operationalFixture();
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
  if (attended) {
    config.sourcePolicy.validationPolicyFile = await write('validation-policy', { status: 'UNKNOWN' });
    const sources = [];
    for (const kind of ['equity', 'cashFlows', 'bars', 'earnings', 'identifiers', 'marketSessions']) sources.push({ kind,
      artifact: await write(`original-${kind}`, { recordKind: kind, rawFixture: true }),
      provenance: await write(`provenance-${kind}`, { recordKind: kind, status: 'UNVERIFIED' }) });
    config.sourcePolicy.riskSourceInventoryFile = await write('inventory', { schemaVersion: 'attended-risk-source-inventory-v1',
      accountSha256: config.input.accountSha256, termsSha256: config.input.termsSha256, sources });
  } else config.sourcePolicy.contractFile = await write('source-contract', { status: 'UNKNOWN', continuity: 'UNVERIFIED' });
  config.sourcePolicy.riskPolicyFile = await write('risk', { status: 'PASS', evidence: 'synthetic-label-is-not-proof' });
  config.sourcePolicy.clockPolicyFile = await write('clock', { status: 'UNVERIFIED' });
  config.custody.evidenceFile = await write('custody', { status: 'NOT_ADOPTED' });
  config.oversight.operatorAttendanceFile = await write('attendance', { status: 'NOT_AUTHORIZED' });
  const refs = [...Object.entries(config.sourcePolicy).filter(([k]) => k.endsWith('File')).map(([, v]) => v),
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

assert.equal(typeof operational.loadAttendedEvidenceFiles, 'function', 'attended originals must be pinned and purpose bound');
const attended = await fixture(true);
try {
  const { config } = attended, files = await operational.loadAttendedEvidenceFiles({ config });
  assert.equal(files.status, 'PINNED_BYTES_VERIFIED_NOT_READINESS');
  assert.equal(files.sourceEvidenceVerified, false);
  assert.equal(files.brokerSubmitAllowed, false);
  assert.equal(Object.keys(files.originals).length, 6);
  assert.equal(Object.isFrozen(files.originals.equity.artifact), true);
  assert.equal(files.originals.equity.provenance.status, 'UNVERIFIED', 'loading does not certify original-source authenticity');
  assert.equal(await operational.verifyAttendedEvidenceFiles({ config, files }), true);
  await assert.rejects(() => operational.verifyAttendedEvidenceFiles({ config, files: structuredClone(files) }), /FILES_UNBOUND/);
  await assert.rejects(() => operational.verifyOperationalEvidenceFiles({ config, files }), /FILES_UNBOUND/);
  const input = { config, files, clock: attendedFixture().clock };
  assert.equal((await operational.assessAttendedControlEvidence(input)).status, 'BLOCKED');
  const { custody, attendance } = operationalControlDocuments(config);
  config.writerExclusion.evidenceSha256 = hash(custody.writerExclusion);
  config.custody.evidenceFile = await attended.write('custody', custody);
  config.oversight.operatorAttendanceFile = await attended.write('attendance', attendance);
  const boundControls = await operational.loadAttendedEvidenceFiles({ config });
  assert.equal((await operational.assessAttendedControlEvidence({ ...input, files: boundControls })).status,
    'OPERATOR_ATTESTATIONS_BOUND_NOT_READINESS');
  const refs = files.documents.riskSourceInventory.sources.flatMap(s => [s.artifact, s.provenance]);
  for (const ref of refs) {
    const bytes = await fs.readFile(ref.path); await fs.appendFile(ref.path, ' ');
    await assert.rejects(() => operational.verifyAttendedEvidenceFiles({ config, files: boundControls }), /FILE_HASH_DRIFT/);
    await fs.writeFile(ref.path, bytes); checks++;
  }
  const arrayInventory = structuredClone(files.documents.riskSourceInventory);
  arrayInventory.sources.find(s => s.kind === 'cashFlows').artifact = await attended.write('original-cashFlows', []);
  config.sourcePolicy.riskSourceInventoryFile = await attended.write('inventory', arrayInventory);
  const arrayFiles = await operational.loadAttendedEvidenceFiles({ config });
  assert.deepEqual(arrayFiles.originals.cashFlows.artifact, [], 'original API arrays are preserved, not rewritten as an invented envelope');
  assert.equal(arrayFiles.sourceEvidenceVerified, false, 'an empty array alone does not prove complete cash-flow coverage');
  arrayInventory.sources.find(s => s.kind === 'cashFlows').artifact = await attended.write('original-cashFlows', null);
  config.sourcePolicy.riskSourceInventoryFile = await attended.write('inventory', arrayInventory);
  await assert.rejects(() => operational.loadAttendedEvidenceFiles({ config }), /DOCUMENT_INVALID/);
  await attended.write('original-cashFlows', files.originals.cashFlows.artifact); checks += 3;
  for (const change of [s => { s.sources.pop(); }, s => { s.sources[0].kind = 'unsupported'; },
    s => { s.sources[1].kind = s.sources[0].kind; }, s => { s.accountSha256 = hash('other-account'); },
    s => { s.sources[0].artifact = s.sources[0].provenance; }, s => { s.sources[0].artifact = config.sourceFile; },
    s => { s.sources[0].provenance.sha256 = hash('drift'); }, s => { s.ready = true; }]) {
    const inventory = structuredClone(files.documents.riskSourceInventory); change(inventory);
    config.sourcePolicy.riskSourceInventoryFile = await attended.write('inventory', inventory);
    await assert.rejects(() => operational.loadAttendedEvidenceFiles({ config }), /INVENTORY_INVALID|FILE_IDENTITY_DUPLICATE|FILE_HASH_DRIFT/);
    checks++;
  }
  checks += 11;
} finally { await fs.rm(attended.directory, { recursive: true, force: true }); }

const attendedInvocation = await fixture(true);
try {
  const { config, write, directory } = attendedInvocation, { clock, approval } = attendedFixture();
  const { custody, attendance } = operationalControlDocuments(config);
  config.writerExclusion.evidenceSha256 = hash(custody.writerExclusion);
  config.custody.evidenceFile = await write('custody', custody);
  config.oversight.operatorAttendanceFile = await write('attendance', attendance);
  approval.stableScopeSha256 = hash(config);
  const configFile = await write('invocation', config), approvalFile = await write('approval', approval);
  const args = ['--validate-attended', configFile.path, configFile.sha256, approvalFile.path, approvalFile.sha256];
  const forbidden = { clock, get transport() { assert.fail('validation must not access broker/credentials'); },
    get notify() { assert.fail('validation must not access sender'); }, get config() { assert.fail('use pinned file, not injected config'); } };
  const before = await fs.readdir(directory), valid = await main(args, forbidden);
  assert.equal(valid.status, 'PINNED_INPUTS_VERIFIED_NOT_READY');
  assert.equal(valid.validationScope, 'ATTENDED_PAPER_LIFECYCLE_ONLY');
  assert.equal(valid.externalTradingStatus, 'NOT_VERIFIED');
  assert.equal(valid.executionAuthorized, false); assert.equal(valid.sourceReadinessProven, false);
  assert.equal(valid.actualBrokerMutationAttempted, false); assert.equal(valid.actualStateWriteAttempted, false);
  assert.deepEqual(await fs.readdir(directory), before);
  assert.ok(!JSON.stringify(valid).includes(directory));
  const loaded = await operational.loadAttendedInvocationFiles({ configFile, approvalFile });
  assert.equal(loaded.files.sourceEvidenceVerified, false);
  assert.equal(await operational.verifyAttendedEvidenceFiles(loaded), true);
  await assert.rejects(operational.loadOperationalInvocationFiles({ configFile, approvalFile }), /CONFIG_INVALID/);
  assert.equal((await main(['--validate-operational', ...args.slice(1)], forbidden)).status, 'BLOCKED'); checks += 13;
  for (const change of [a => { a.kind = 'DIRECT_SCOPED_OPERATIONAL_INVOCATION'; }, a => { a.externalTradingStatus = 'NOT_HALTED'; },
    a => { a.validationScope = 'UNATTENDED'; }, a => { a.stableScopeSha256 = hash('other'); },
    a => { a.expiresAt = a.approvedAt; }, a => { delete a.rollbackPlanSha256; }]) {
    const bad = structuredClone(approval); change(bad);
    const ref = await write('approval', bad);
    const result = await main([...args.slice(0, 3), ref.path, ref.sha256], forbidden);
    assert.equal(result.status, 'BLOCKED'); assert.equal(result.executionAuthorized, false);
    assert.equal(result.actualBrokerMutationAttempted, false); assert.equal(result.actualStateWriteAttempted, false); checks += 4;
  }
  await write('approval', approval);
  const originalRead = fs.readFile, originalOpen = fs.open;
  fs.readFile = async () => assert.fail('invalid argument count must not open files');
  fs.open = async () => assert.fail('invalid argument count must not open files');
  try {
    for (const bad of [args.slice(0, 4), [...args, '--extra'], ['--validate-attended']]) {
      assert.equal((await main(bad, forbidden)).status, 'ARGUMENTS_INVALID'); checks++;
    }
  } finally { fs.readFile = originalRead; fs.open = originalOpen; }
  await fs.appendFile(config.sourcePolicy.riskPolicyFile.path, ' ');
  const drift = await main(args, forbidden);
  assert.equal(drift.status, 'BLOCKED'); assert.deepEqual(drift.reasons, ['SCOPED_ADAPTER_FILE_HASH_DRIFT']); checks += 2;
} finally { await fs.rm(attendedInvocation.directory, { recursive: true, force: true }); }

assert.equal(typeof evidence.buildAttendedClockEvidence, 'function', 'a reference interval must be authenticated by the receipt owner');
const clockFiles = await fixture(true);
try {
  const { config } = clockFiles;
  const policy = { schemaVersion: 'attended-paper-clock-policy-v1', basis: 'BROKER_TLS_REMOTE_REFERENCE_INTERVAL',
    hostIdSha256: config.custody.hostIdSha256, maxAgeMs: 30000, maxUncertaintyMs: 2,
    requiresHostSynchronizationProof: false, requiresProviderAccuracySla: false };
  const scope = Object.freeze(structuredClone(config.input));
  const make = async (payloadTime = '2026-10-09T15:00:00.001000000Z', change = () => {}) => {
    const p = structuredClone(policy); change(p);
    config.sourcePolicy.clockPolicyFile = await clockFiles.write('clock-policy', p);
    const files = await operational.loadAttendedEvidenceFiles({ config });
    let wall = Date.parse('2026-10-09T15:00:00.000Z'), mono = 100;
    const clock = { now: () => new Date(wall).toISOString(), monotonicMs: () => mono };
    const transport = createScopedPaperTransport({ credentials: { key: 'fixture', secret: 'fixture' }, clock, deadlineMs: 300000,
      fetchImpl: async () => { wall += 2; mono += 2; return new Response(JSON.stringify({ timestamp: payloadTime, is_open: true })); } });
    const receipt = await transport.request({ group: 'clock', phase: 'initial', routeInput: {} });
    return { scope, files, receipt, transport, clock, advance: (w, m) => { wall += w; mono += m; } };
  };
  const f = await make(), binding = await evidence.buildAttendedClockEvidence(f);
  assert.equal(binding.status, 'REMOTE_REFERENCE_INTERVAL_BOUND');
  assert.equal(binding.referenceProvenanceVerified, true);
  for (const claim of ['hostSynchronizationVerified', 'providerClockAccuracyVerified', 'timestampCompensationApplied', 'executionAuthorized'])
    assert.equal(binding[claim], false);
  assert.equal(evidence.isAttendedClockEvidence(binding, f), true);
  for (const change of [x => { x.receipt = structuredClone(x.receipt); }, x => { x.files = structuredClone(x.files); },
    x => { x.transport = {}; }, x => { x.clock = { ...x.clock }; }, x => { x.scope = { ...x.scope, accountSha256: hash('wrong') }; }]) {
    const input = { ...f }; change(input);
    await assert.rejects(() => evidence.buildAttendedClockEvidence(input), /SCOPED_.*(?:UNBOUND|CLOCK|SCOPE|TRANSPORT)/); checks++;
  }
  assert.equal(evidence.isAttendedClockEvidence(structuredClone(binding), f), false);
  assert.equal(evidence.isAttendedClockEvidence(binding, { ...f, scope: { ...scope } }), false);
  f.advance(2, 0);
  assert.equal(evidence.isAttendedClockEvidence(binding, f), true, 'exact approved uncertainty is not a compensation');
  f.advance(1, 0);
  assert.equal(evidence.isAttendedClockEvidence(binding, f), false, 'wall clock drift beyond explicit bound invalidates reference');
  f.advance(0, 1);
  assert.equal(evidence.isAttendedClockEvidence(binding, f), false, 'invalidated time evidence never revives');
  for (const stamp of ['2026-10-09T15:00:00.002000001Z', '2026-10-09T14:59:59.999999999Z', 'invalid']) {
    await assert.rejects(() => make(stamp).then(evidence.buildAttendedClockEvidence), /SCOPED_EVIDENCE_(?:TIMESTAMP|CLOCK)/); checks++;
  }
  for (const change of [p => { p.requiresHostSynchronizationProof = true; }, p => { p.requiresProviderAccuracySla = true; },
    p => { p.maxAgeMs = 30001; }, p => { p.maxUncertaintyMs = 1; }, p => { p.hostIdSha256 = hash('other-host'); },
    p => { p.basis = 'LOCAL_DAEMON_RUNNING'; }]) {
    const invalid = await make(undefined, change);
    await assert.rejects(() => evidence.buildAttendedClockEvidence(invalid), /SCOPED_EVIDENCE_CLOCK/); checks++;
  }
  const expires = await make(), old = await evidence.buildAttendedClockEvidence(expires);
  expires.advance(30001, 30001);
  assert.equal(evidence.isAttendedClockEvidence(old, expires), false);
  const regression = await make(), saved = await evidence.buildAttendedClockEvidence(regression);
  regression.advance(1, -1);
  assert.equal(evidence.isAttendedClockEvidence(saved, regression), false);
  const drift = await make(); await fs.appendFile(config.sourcePolicy.clockPolicyFile.path, ' ');
  await assert.rejects(() => evidence.buildAttendedClockEvidence(drift), /FILE_HASH_DRIFT/);
  checks += 16;
} finally { await fs.rm(clockFiles.directory, { recursive: true, force: true }); }

// These are synthetic operator attestations, not observed account/source/host facts.
async function controlsFixture() {
  const f = await fixture(), { config } = f, { clock } = operationalFixture();
  const { custody, attendance } = operationalControlDocuments(config);
  Object.assign(f, { clock, custody, attendance });
  f.save = async () => {
    config.writerExclusion.evidenceSha256 = hash(f.custody.writerExclusion ?? 'absent-writer');
    config.custody.evidenceFile = await f.write('custody', f.custody);
    config.oversight.operatorAttendanceFile = await f.write('attendance', f.attendance);
    return operational.loadOperationalEvidenceFiles({ config });
  };
  return f;
}
const controls = await controlsFixture();
try {
  const files = await controls.save(), input = { config: controls.config, files, clock: controls.clock };
  const before = await fs.readdir(controls.directory), result = await operational.assessOperationalControlEvidence(input);
  assert.equal(result.status, 'OPERATOR_ATTESTATIONS_BOUND_NOT_READINESS');
  assert.deepEqual(result.reasons, []);
  for (const key of ['executionAuthorized', 'sourceReadinessProven', 'currentStateVerified',
    'hostIdentityIndependentlyVerified', 'writerExclusionIndependentlyVerified', 'physicalAttendanceVerified']) assert.equal(result[key], false);
  assert.deepEqual(result, await operational.assessOperationalControlEvidence(input));
  assert.deepEqual(await fs.readdir(controls.directory), before); checks += 10;
  const serialized = JSON.stringify(result);
  for (const secret of [controls.config.directory, 'fixture-operator', 'WRITE_DISABLED', 'OPERATOR_NONINTERFERENCE']) assert.ok(!serialized.includes(secret));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.reasons)); checks += 5;
  const copied = await operational.assessOperationalControlEvidence({ ...input, files: structuredClone(files) });
  assert.deepEqual(copied.reasons, ['SCOPED_CLOSEOUT_FILES_UNBOUND']); checks++;
  for (const now of ['not-a-time', controls.config.oversight.handoffDeadline,
    new Date(Date.parse(controls.config.input.authority.validFrom) - 1).toISOString()]) {
    const assessed = await operational.assessOperationalControlEvidence({ ...input, clock: { now: () => now } });
    assert.equal(assessed.status, 'BLOCKED'); assert.equal(assessed.executionAuthorized, false); checks += 2;
  }
  const wrongWriter = structuredClone(controls.config); wrongWriter.writerExclusion.evidenceSha256 = hash('unrelated-control');
  assert.deepEqual((await operational.assessOperationalControlEvidence({ config: wrongWriter,
    files: await operational.loadOperationalEvidenceFiles({ config: wrongWriter }), clock: controls.clock })).reasons,
  ['SCOPED_CLOSEOUT_WRITER_ATTESTATION_INVALID']); checks++;
  await fs.appendFile(controls.config.oversight.operatorAttendanceFile.path, ' ');
  assert.deepEqual((await operational.assessOperationalControlEvidence(input)).reasons, ['SCOPED_ADAPTER_FILE_HASH_DRIFT']); checks++;
} finally { await fs.rm(controls.directory, { recursive: true, force: true }); }

const renewed = await controlsFixture();
try {
  for (const document of [renewed.custody.writerExclusion, renewed.attendance])
    document.attestedAt = document.validFrom = renewed.config.oversight.validFrom;
  const input = { config: renewed.config, files: await renewed.save(), clock: renewed.clock };
  assert.equal((await operational.assessOperationalControlEvidence(input)).status, 'BLOCKED');
  assert.equal((await operational.assessOperationalControlEvidence({ ...input, purpose: 'OBSERVATION' })).status,
    'OPERATOR_ATTESTATIONS_BOUND_NOT_READINESS', 'new observation attestation cannot be backdated to the original submit window');
  assert.deepEqual((await operational.assessOperationalControlEvidence({ ...input, purpose: 'UNKNOWN' })).reasons,
    ['SCOPED_CLOSEOUT_CONTROL_PURPOSE_INVALID']); checks += 3;
} finally { await fs.rm(renewed.directory, { recursive: true, force: true }); }

const controlMutations = [
  ['CUSTODY', f => { f.custody = { status: 'PASS' }; }],
  ['CUSTODY', f => { f.custody.accountSha256 = hash('wrong-account'); }],
  ['CUSTODY', f => { f.custody.hostIdSha256 = hash('wrong-host'); }],
  ['CUSTODY', f => { f.custody.directory += '/different'; }],
  ['CUSTODY', f => { f.custody.preWriteHashes = { ...f.custody.preWriteHashes, orderLedger: hash('different-store') }; }],
  ['CUSTODY', f => { f.custody.termsSha256 = hash('different-targets'); }],
  ['CUSTODY', f => { f.custody.sourceSha256 = hash('different-source'); }],
  ['CUSTODY', f => { f.custody.recordedAt = '2026-10-09T15:00:00.001Z'; }],
  ['CUSTODY', f => { delete f.custody.adoptionApprovalSha256; }],
  ['CUSTODY', f => { f.custody.historicalEvidenceNormalized = true; }],
  ['WRITER', f => { f.custody.writerExclusion.controls = {}; }],
  ['WRITER', f => { f.custody.writerExclusion.accountSha256 = hash('different-account'); }],
  ['WRITER', f => { f.custody.writerExclusion.hostIdSha256 = hash('different-host'); }],
  ['WRITER', f => { f.custody.writerExclusion.session = '2026-10-08'; }],
  ['WRITER', f => { f.custody.writerExclusion.attestedAt = '2026-10-09T15:00:01.000Z'; }],
  ['WRITER', f => { f.custody.writerExclusion.expiresAt = '2026-10-09T15:04:59.000Z'; }],
  ['WRITER', f => { f.custody.writerExclusion.validFrom = '2026-10-09T15:00:01.000Z'; }],
  ['WRITER', f => { delete f.custody.writerExclusion.procedureSha256; }],
  ...['githubActions', 'otherHosts', 'otherProcesses', 'manualTrading'].flatMap(lane => [
    ['WRITER', f => { f.custody.writerExclusion.controls[lane].status = 'UNKNOWN'; }],
    ['WRITER', f => { delete f.custody.writerExclusion.controls[lane].evidenceSha256; }],
  ]),
  ['ATTENDANCE', f => { f.attendance = { status: 'PASS' }; }],
  ['ATTENDANCE', f => { f.attendance.basis = 'UNATTENDED_LOCAL_HEARTBEAT'; }],
  ['ATTENDANCE', f => { f.attendance.accountSha256 = hash('different-account'); }],
  ['ATTENDANCE', f => { f.attendance.hostIdSha256 = hash('different-host'); }],
  ['ATTENDANCE', f => { f.attendance.session = '2026-10-08'; }],
  ['ATTENDANCE', f => { f.attendance.attestedAt = '2026-10-09T15:00:00.001Z'; }],
  ['ATTENDANCE', f => { f.attendance.expiresAt = '2026-10-09T15:04:59.000Z'; }],
  ['ATTENDANCE', f => { f.attendance.validFrom = '2026-10-09T15:00:00.001Z'; }],
  ['ATTENDANCE', f => { delete f.attendance.operatorSha256; }],
  ['ATTENDANCE', f => { delete f.attendance.handoffProcedureSha256; }],
  ['ATTENDANCE', f => { f.attendance.brokerInterfaceAttended = false; }],
  ['ATTENDANCE', f => { f.attendance.hostLossOrdersMayRemainAcknowledged = false; }],
];
for (const [kind, mutate] of controlMutations) {
  const f = await controlsFixture();
  try {
    mutate(f);
    const files = await f.save();
    const result = await operational.assessOperationalControlEvidence({ config: f.config, files, clock: f.clock });
    assert.equal(result.status, 'BLOCKED'); assert.ok(result.reasons.includes(`SCOPED_CLOSEOUT_${kind}_ATTESTATION_INVALID`)); checks += 2;
  } finally { await fs.rm(f.directory, { recursive: true, force: true }); }
}

const invocation = await controlsFixture();
try {
  await invocation.save();
  const approval = operationalFixture().approval;
  approval.stableScopeSha256 = hash(invocation.config);
  const configPin = await invocation.write('invocation', invocation.config), approvalPin = await invocation.write('approval', approval);
  const args = ['--validate-operational', configPin.path, configPin.sha256, approvalPin.path, approvalPin.sha256];
  const forbidden = { clock: invocation.clock, get transport() { assert.fail('local validation must not inspect credentials/transport'); },
    get observationTransport() { assert.fail('local validation must not create an observer'); },
    get notify() { assert.fail('local validation must not inspect sender'); } };
  const before = await fs.readdir(invocation.directory);
  const valid = await main(args, forbidden);
  assert.equal(valid.status, 'PINNED_INPUTS_VERIFIED_NOT_READY');
  assert.equal(valid.executionAuthorized, false); assert.equal(valid.sourceReadinessProven, false);
  assert.equal(valid.actualBrokerMutationAttempted, false); assert.equal(valid.actualStateWriteAttempted, false);
  assert.equal(valid.controlEvidence?.status, 'OPERATOR_ATTESTATIONS_BOUND_NOT_READINESS'); checks++;
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

const labels = await fixture();
try {
  const approval = operationalFixture().approval; approval.stableScopeSha256 = hash(labels.config);
  const configPin = await labels.write('invocation', labels.config), approvalPin = await labels.write('approval', approval);
  const result = await main(['--validate-operational', configPin.path, configPin.sha256, approvalPin.path, approvalPin.sha256],
    { clock: operationalFixture().clock, get transport() { assert.fail('unattested controls must not load credentials'); } });
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasons, ['SCOPED_CLOSEOUT_CUSTODY_ATTESTATION_INVALID',
    'SCOPED_CLOSEOUT_WRITER_ATTESTATION_INVALID', 'SCOPED_CLOSEOUT_ATTENDANCE_ATTESTATION_INVALID']);
  assert.equal(result.actualStateWriteAttempted, false); checks += 3;
} finally { await fs.rm(labels.directory, { recursive: true, force: true }); }

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
