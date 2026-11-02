import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { operationalFixture, pinOperationalFixtureFiles, hash } from './fixtures/scoped-paper-adapter.mjs';
import * as operational from './lib/scoped-paper-operational.mjs';
import { main } from './run-scoped-paper-closeout.mjs';

assert.equal(typeof operational.assessOperationalReadiness, 'function', 'operational readiness must evaluate pinned documents, not labels');
assert.equal(typeof operational.assessOperationalRiskPolicy, 'function');
assert.equal(typeof operational.assessOperationalClockEvidence, 'function');

const f = operationalFixture();
const risk = { schemaVersion: 'scoped-paper-risk-policy-v1', accountSha256: f.input.accountSha256,
  termsSha256: f.input.termsSha256, policySourceSha256: hash('fixture-reviewed-policy'),
  limits: { maxPositionPct: '10', maxSectorPct: '30', maxPortfolioExposurePct: '100',
    maxDailyLossPct: '2', maxDrawdownPct: '5', minAverageDailyDollarVolumeUsd: '1000000',
    maxVolatilityPct: '50', minEarningsDistanceDays: '3' } };
const riskInput = { config: f.config, policy: risk };
assert.equal(operational.assessOperationalRiskPolicy(riskInput).status, 'POLICY_CONTRACT_VALID_NOT_CURRENT_RISK');
for (const key of Object.keys(risk.limits)) {
  for (const value of [undefined, null, '', 'PASS', 'NaN', '-1', 'Infinity', '1e10', false]) {
    const policy = structuredClone(risk); policy.limits[key] = value;
    assert.equal(operational.assessOperationalRiskPolicy({ ...riskInput, policy }).status, 'BLOCKED');
  }
}
for (const change of [p => { p.accountSha256 = hash('other'); }, p => { p.termsSha256 = hash('other'); },
  p => { p.limits.maxDailyLossPct = '-0.1'; }, p => { p.limits.minEarningsDistanceDays = '1.5'; },
  p => { p.limits.maxSectorPct = '0'; }, p => { p.exceptions = ['risk-reducing']; },
  p => { p.limits.hidden = '1'; }, p => { delete p.policySourceSha256; }]) {
  const policy = structuredClone(risk); change(policy);
  assert.equal(operational.assessOperationalRiskPolicy({ ...riskInput, policy }).status, 'BLOCKED');
}
const explicitPolicy = structuredClone(risk); explicitPolicy.limits.maxVolatilityPct = '125';
assert.equal(operational.assessOperationalRiskPolicy({ ...riskInput, policy: explicitPolicy }).status,
  'POLICY_CONTRACT_VALID_NOT_CURRENT_RISK', 'shape validation must not invent a risk threshold');

const clockDocument = { schemaVersion: 'scoped-paper-clock-evidence-v1', hostIdSha256: f.config.custody.hostIdSha256,
  basis: 'INDEPENDENT_REFERENCE_INTERVAL', referenceEvidenceSha256: hash('fixture-reference-bytes'),
  policy: { maxAgeMs: 1000, maxUncertaintyMs: 2 },
  localSampleAt: '2026-10-09T14:59:59.500Z',
  referenceEarliestAt: '2026-10-09T14:59:59.499Z', referenceLatestAt: '2026-10-09T14:59:59.501Z' };
const clockInput = { config: f.config, document: clockDocument, clock: f.clock };
assert.equal(operational.assessOperationalClockEvidence(clockInput).status, 'REFERENCE_INTERVAL_CONSISTENT_NOT_AUTHENTICATED');
for (const change of [d => { d.basis = 'BROKER_IS_OPEN'; }, d => { d.basis = 'HTTP_DATE'; },
  d => { d.hostIdSha256 = hash('other-host'); }, d => { d.policy.maxAgeMs = 30001; },
  d => { d.policy.maxAgeMs = 0; }, d => { d.policy.maxAgeMs = '1000'; },
  d => { d.policy.maxUncertaintyMs = -1; }, d => { d.policy.maxUncertaintyMs = 30001; },
  d => { d.localSampleAt = '2026-10-09T15:00:00.001Z'; },
  d => { d.localSampleAt = '2026-10-09T14:59:58.999Z'; },
  d => { d.referenceEarliestAt = '2026-10-09T14:59:59.502Z'; },
  d => { d.referenceLatestAt = '2026-10-09T14:59:59.503Z'; },
  d => { d.referenceEvidenceSha256 = 'unknown'; }, d => { d.offsetCompensationMs = 1; }]) {
  const document = structuredClone(clockDocument); change(document);
  assert.equal(operational.assessOperationalClockEvidence({ ...clockInput, document }).status, 'BLOCKED');
}
assert.equal(operational.assessOperationalClockEvidence({ ...clockInput, clock: { now: () => 'invalid' } }).status, 'BLOCKED');

const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'operational-readiness-fixture-')));
await fs.chmod(directory, 0o700);
try {
  f.config.directory = directory;
  await pinOperationalFixtureFiles(f.config, directory);
  const write = async (pin, value) => {
    const bytes = JSON.stringify(value); await fs.writeFile(pin.path, bytes, { mode: 0o600 });
    pin.sha256 = createHash('sha256').update(bytes).digest('hex');
  };
  const assess = async () => operational.assessOperationalReadiness({ config: f.config,
    files: await operational.loadOperationalEvidenceFiles({ config: f.config }), clock: f.clock });
  let result = await assess();
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('SCOPED_CLOSEOUT_RISK_POLICY_INVALID'));
  assert.ok(result.reasons.includes('SCOPED_CLOSEOUT_CLOCK_EVIDENCE_INVALID'));
  await write(f.config.sourcePolicy.riskPolicyFile, risk);
  await write(f.config.sourcePolicy.clockPolicyFile, clockDocument);
  // Hash-pinned declarations are not independently authenticated provider/host evidence.
  for (const source of [{ status: 'PASS', initialStateVerified: true, continuityVerified: true },
    { source: 'ALPACA_STATUSES', tradable: true, is_open: true },
    { source: 'ALPACA_STATUSES', initial: 'NOT_HALTED', disconnected: false, lastCode: 'T' }]) {
    await write(f.config.sourcePolicy.contractFile, source);
    result = await assess();
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.riskPolicy.status, 'POLICY_CONTRACT_VALID_NOT_CURRENT_RISK');
    assert.equal(result.clockEvidence.status, 'REFERENCE_INTERVAL_CONSISTENT_NOT_AUTHENTICATED');
    assert.ok(result.reasons.includes('SCOPED_CLOSEOUT_SOURCE_INITIAL_STATE_AND_CONTINUITY_UNVERIFIED'));
    assert.ok(result.reasons.includes('SCOPED_CLOSEOUT_CURRENT_RISK_EVIDENCE_UNVERIFIED'));
    assert.ok(result.reasons.includes('SCOPED_CLOSEOUT_CLOCK_REFERENCE_PROVENANCE_UNVERIFIED'));
    assert.equal(result.executionAuthorized, false); assert.equal(result.sourceReadinessProven, false);
    assert.equal(result.wouldCreateBrokerPayload, false);
    assert.deepEqual(await assess(), result, 'same pinned bytes and clock are deterministic');
  }
  const files = await operational.loadOperationalEvidenceFiles({ config: f.config });
  assert.equal((await operational.assessOperationalReadiness({ config: f.config, files: structuredClone(files), clock: f.clock })).status, 'BLOCKED');
  await fs.appendFile(f.config.sourcePolicy.clockPolicyFile.path, ' ');
  result = await operational.assessOperationalReadiness({ config: f.config, files, clock: f.clock });
  assert.ok(result.reasons.includes('SCOPED_ADAPTER_FILE_HASH_DRIFT'));
  await write(f.config.sourcePolicy.clockPolicyFile, clockDocument);
  f.approval.stableScopeSha256 = hash(f.config);
  const configFile = { path: path.join(directory, 'config.json') }, approvalFile = { path: path.join(directory, 'approval.json') };
  await write(configFile, f.config); await write(approvalFile, f.approval);
  const forbidden = { clock: f.clock, get transport() { assert.fail('readiness must not read credentials or transport'); },
    get notify() { assert.fail('readiness must not touch Telegram'); } };
  const before = await fs.readdir(directory);
  const report = await main(['--assess-operational', configFile.path, configFile.sha256, approvalFile.path, approvalFile.sha256], forbidden);
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.actualStateWriteAttempted, false);
  assert.equal(report.actualBrokerMutationAttempted, false); assert.ok(report.readiness.reasons.includes('SCOPED_CLOSEOUT_SOURCE_INITIAL_STATE_AND_CONTINUITY_UNVERIFIED'));
  assert.deepEqual(await fs.readdir(directory), before);
  for (const privateValue of [directory, f.config.input.accountSha256, f.config.input.terms.targets[0].assetId, 'fixture-paper-account'])
    assert.ok(!JSON.stringify(report).includes(privateValue), 'aggregate must redact private input');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('scoped PAPER readiness: PASS (policy/time consistency separate from authentic source truth; no runtime permission)');
