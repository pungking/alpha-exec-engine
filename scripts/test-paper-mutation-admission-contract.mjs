import assert from 'node:assert/strict';
import { inspectPaperMutationAdmission, MUTATION_TARGETS } from './lib/paper-mutation-admission-contract.mjs';

// Synthetic values, not runtime evidence or real account identifiers.
const ID = '123e4567-e89b-42d3-a456-426614174000';
const sha = 'a'.repeat(40), state = 'b'.repeat(40);
const digest = 'c'.repeat(64), account = 'd'.repeat(64), scope = 'e'.repeat(64);
const iso = '2026-11-11T01:00:00.000Z';
const reviewedAt = '2026-11-11T01:01:00.000Z';
const observedAt = '2026-11-11T01:02:00.000Z';
const expiresAt = '2026-11-11T01:03:00.000Z';

function fixture(workflow = 'paper-oco-submit-canary.yml') {
  const t = MUTATION_TARGETS[workflow];
  return {
    request: {
      schemaVersion: 'paper-mutation-admission-v1', workflow, job: t.job, operation: t.operation,
      repository: 'pungking/alpha-exec-engine', sourceRef: 'refs/heads/main', stateRef: 'refs/heads/paper-state',
      codeSha: sha, runId: '123456789', runAttempt: 1, event: 'workflow_dispatch',
      environment: 'PAPER_CUSTODY_APPROVAL', accountFingerprint: account, scopeFingerprint: scope,
      requestId: ID, issuedAt: iso, expiresAt, expectedStateCommit: state,
      sourceEvidenceSha256: digest, riskEvidenceSha256: digest,
    },
    runtime: {
      repository: 'pungking/alpha-exec-engine', ref: 'refs/heads/main', sha,
      runId: '123456789', runAttempt: 1, event: 'workflow_dispatch', workflow, job: t.job,
      environment: 'PAPER_CUSTODY_APPROVAL', accountFingerprint: account,
      scopeFingerprint: scope, stateCommit: state, observedAt,
    },
    approval: {
      requestId: ID, codeSha: sha, runId: '123456789', runAttempt: 1,
      scopeFingerprint: scope, accountFingerprint: account, environment: 'PAPER_CUSTODY_APPROVAL',
      reviewer: 'pungking', reviewedAt, status: 'approved', deploymentId: '56789',
    },
    custody: {
      stateCommit: state, genesisCommit: sha, writerClaim: digest,
      lineageVerified: true, legacyWritersQuiescent: true,
      reservationPersisted: true, preWireCheckpointVerified: true,
      unknownBrokerEffect: false, sourceQualified: true, riskQualified: true,
      cashflowCutoffComplete: true, tradingStatusGapReplayed: true, observationReconciled: true,
    },
    consumedRequestIds: [],
  };
}
let checks = 0;
const checked = (input, code) => {
  const v = inspectPaperMutationAdmission(input);
  assert.equal(v.operationalEligible, false);
  assert.equal(v.brokerSubmitAuthorized, false);
  assert.equal(v.stateMutationAuthorized, false);
  assert.equal(v.environmentApprovalVerified, false);
  assert.equal(v.durableWriterVerified, false);
  assert.equal(v.requiresSeparateRuntimeIntegrationAndExplicitApproval, true);
  if (code) {
    assert.equal(v.status, 'DENY_CONTRACT_INVALID');
    assert.equal(v.contractValid, false);
    assert.ok(v.findings.includes(code), 'Expected ' + code + ', got ' + v.findings.join(','));
  } else {
    assert.deepEqual(v.findings, []);
    assert.equal(v.contractValid, true);
    assert.equal(v.status, 'HOLD_OFFLINE_EVIDENCE_UNTRUSTED');
  }
  checks++;
};
const mutate = (fn, code, workflow) => { const v = fixture(workflow); fn(v); checked(v, code); };
for (const workflow of Object.keys(MUTATION_TARGETS)) checked(fixture(workflow));
checked(fixture());
for (const value of [null, undefined, [], 'invalid', 7, {}]) checked(value, 'ROOT_SHAPE_INVALID');
for (const key of ['request', 'runtime', 'approval', 'custody', 'consumedRequestIds'])
  mutate(x => { delete x[key]; }, 'ROOT_SHAPE_INVALID');
for (const key of ['request', 'runtime', 'approval', 'custody'])
  mutate(x => { x[key].unexpected = true; }, key.toUpperCase() + '_SHAPE_INVALID');
mutate(x => { x.extra = 1; }, 'ROOT_SHAPE_INVALID');
mutate(x => { x.request.schemaVersion = 'paper-mutation-admission-v2'; }, 'SCHEMA_INVALID');
mutate(x => { x.request.workflow = 'evil.yml'; }, 'TARGET_NOT_ALLOWLISTED');
mutate(x => { x.request.job = 'submit-persistent-repair'; }, 'TARGET_NOT_ALLOWLISTED');
mutate(x => { x.request.operation = 'LIVE_ORDER'; }, 'TARGET_NOT_ALLOWLISTED');
for (const [key, bad] of [['repository', 'wrong/repo'], ['sourceRef', 'refs/heads/paper-state'],
  ['stateRef', 'refs/heads/main'], ['environment', 'UNPROTECTED']])
  mutate(x => { x.request[key] = bad; }, 'REQUEST_BOUNDARY_INVALID');
for (const key of ['codeSha', 'expectedStateCommit', 'accountFingerprint', 'scopeFingerprint',
  'sourceEvidenceSha256', 'riskEvidenceSha256'])
  mutate(x => { x.request[key] = 'INVALID'; }, 'REQUEST_DIGEST_INVALID');
for (const [key, bad] of [['runId', '0'], ['runAttempt', 2], ['event', 'schedule'],
  ['requestId', 'duplicate'], ['runAttempt', '1']])
  mutate(x => { x.request[key] = bad; }, 'REQUEST_IDENTITY_INVALID');
mutate(x => { x.consumedRequestIds = [ID]; }, 'REQUEST_ALREADY_CONSUMED');
mutate(x => { x.consumedRequestIds = [ID, ID]; }, 'CONSUMED_REQUESTS_INVALID');
mutate(x => { x.consumedRequestIds = ['not-a-uuid']; }, 'CONSUMED_REQUESTS_INVALID');
for (const [key, bad] of [['repository', 'untrusted/repo'], ['ref', 'refs/heads/dev'],
  ['event', 'push'], ['environment', 'UNPROTECTED']])
  mutate(x => { x.runtime[key] = bad; }, 'RUNTIME_BOUNDARY_MISMATCH');
for (const [key, bad] of [['sha', 'f'.repeat(40)], ['runId', '2'], ['runAttempt', 2],
  ['workflow', 'dry-run.yml'], ['job', 'other-job'], ['accountFingerprint', digest],
  ['scopeFingerprint', account], ['stateCommit', sha]])
  mutate(x => { x.runtime[key] = bad; }, 'RUNTIME_IDENTITY_MISMATCH');
for (const [key, bad] of [['requestId', 'bad'], ['codeSha', state], ['runId', '2'],
  ['runAttempt', 2], ['scopeFingerprint', account], ['accountFingerprint', scope],
  ['environment', 'unprotected']])
  mutate(x => { x.approval[key] = bad; }, 'APPROVAL_BINDING_MISMATCH');
for (const [key, bad] of [['status', 'pending'], ['reviewer', 'external'], ['deploymentId', '0']])
  mutate(x => { x.approval[key] = bad; }, 'APPROVAL_CLAIM_INVALID');
for (const [key, bad] of [['stateCommit', sha], ['genesisCommit', 'bad'], ['writerClaim', 'bad']])
  mutate(x => { x.custody[key] = bad; }, 'CUSTODY_BINDING_INVALID');
for (const key of ['lineageVerified', 'legacyWritersQuiescent', 'reservationPersisted',
  'preWireCheckpointVerified', 'sourceQualified', 'riskQualified', 'cashflowCutoffComplete',
  'tradingStatusGapReplayed', 'observationReconciled']) {
  const code = 'EVIDENCE_' + key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() + '_MISSING';
  mutate(x => { x.custody[key] = false; }, code);
  mutate(x => { x.custody[key] = 'true'; }, code);
}
mutate(x => { x.custody.unknownBrokerEffect = true; }, 'UNKNOWN_BROKER_EFFECT');
for (const value of ['invalid', '2026-02-30T00:00:00Z',
  '2026-11-11T01:00:00+09:00', '2026-11-11T01:00:00.1234Z'])
  mutate(x => { x.request.issuedAt = value; }, 'REQUEST_DEADLINE_INVALID');
mutate(x => { x.request.expiresAt = '2026-11-11T01:07:00.000Z'; }, 'REQUEST_DEADLINE_INVALID');
mutate(x => { x.request.expiresAt = iso; }, 'REQUEST_DEADLINE_INVALID');
mutate(x => { x.runtime.observedAt = '2026-11-11T01:04:00.000Z'; }, 'REQUEST_EXPIRED_OR_FUTURE');
mutate(x => { x.runtime.observedAt = '2026-11-11T00:59:00.000Z'; }, 'REQUEST_EXPIRED_OR_FUTURE');
mutate(x => { x.approval.reviewedAt = '2026-11-11T01:03:00.000Z'; }, 'APPROVAL_TIME_INVALID');
mutate(x => { x.approval.reviewedAt = '2026-11-11T00:59:00.000Z'; }, 'APPROVAL_TIME_INVALID');

const sensitive = fixture();
sensitive.request.accountFingerprint = 'private-identifier-not-for-logging';
sensitive.runtime.accountFingerprint = 'private-identifier-not-for-logging';
assert.ok(!JSON.stringify(inspectPaperMutationAdmission(sensitive)).includes('private-identifier-not-for-logging'));
checks++;
assert.equal('authorize' in (await import('./lib/paper-mutation-admission-contract.mjs')), false);
checks++;
console.log(JSON.stringify({ status: 'OFFLINE_PAPER_MUTATION_ADMISSION_TEST_PASS', checks,
  brokerRequests: 0, stateMutations: 0, operationalEligibilityGranted: 0 }));
