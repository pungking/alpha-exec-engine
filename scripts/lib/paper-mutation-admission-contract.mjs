/**
 * STEP 5C-4D-2A: pure, OFFLINE-ONLY PAPER mutation admission inspection.
 * No function in this module can authorize an order, a state write, or a workflow.
 * All caller-supplied evidence, INCLUDING apparently approved deployments, is
 * untrusted. Operational attestation is deliberately outside this API.
 */
export const MUTATION_TARGETS = Object.freeze({
  'paper-oco-submit-canary.yml': Object.freeze({ job: 'submit-canary', operation: 'PAPER_OCO_CANARY' }),
  'persistent-oco-repair-submit.yml': Object.freeze({ job: 'submit-persistent-repair', operation: 'PAPER_OCO_PERSISTENT_REPAIR' }),
  'ledger-filled-migration.yml': Object.freeze({ job: 'ledger-filled-migration', operation: 'PAPER_LEDGER_MIGRATION' }),
  'paper-five-row-active-limited-state-recovery.yml': Object.freeze({ job: 'recover', operation: 'PAPER_FIVE_ROW_STATE_RECOVERY' }),
});
const REPOSITORY = 'pungking/alpha-exec-engine';
const SOURCE_REF = 'refs/heads/main';
const STATE_REF = 'refs/heads/paper-state';
const APPROVAL_ENVIRONMENT = 'PAPER_CUSTODY_APPROVAL';
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = [
  'schemaVersion', 'workflow', 'job', 'operation', 'repository', 'sourceRef', 'stateRef',
  'codeSha', 'runId', 'runAttempt', 'event', 'environment', 'accountFingerprint',
  'scopeFingerprint', 'requestId', 'issuedAt', 'expiresAt', 'expectedStateCommit',
  'sourceEvidenceSha256', 'riskEvidenceSha256',
];
const RUNTIME_KEYS = [
  'repository', 'ref', 'sha', 'runId', 'runAttempt', 'event', 'workflow', 'job',
  'environment', 'accountFingerprint', 'scopeFingerprint', 'stateCommit', 'observedAt',
];
const APPROVAL_KEYS = [
  'requestId', 'codeSha', 'runId', 'runAttempt', 'scopeFingerprint', 'accountFingerprint',
  'environment', 'reviewer', 'reviewedAt', 'status', 'deploymentId',
];
const CUSTODY_KEYS = [
  'stateCommit', 'genesisCommit', 'writerClaim', 'lineageVerified',
  'legacyWritersQuiescent', 'reservationPersisted', 'preWireCheckpointVerified',
  'unknownBrokerEffect', 'sourceQualified', 'riskQualified', 'cashflowCutoffComplete',
  'tradingStatusGapReplayed', 'observationReconciled',
];
const ROOT_KEYS = ['request', 'runtime', 'approval', 'custody', 'consumedRequestIds'];
const BOOLEAN_TRUE = [
  'lineageVerified', 'legacyWritersQuiescent', 'reservationPersisted',
  'preWireCheckpointVerified', 'sourceQualified', 'riskQualified',
  'cashflowCutoffComplete', 'tradingStatusGapReplayed', 'observationReconciled',
];
const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x)
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const fieldsExact = (x, keys) => plain(x)
  && Object.keys(x).length === keys.length && Object.keys(x).every(k => keys.includes(k))
  && keys.every(k => owns(x, k));
const sha40 = x => typeof x === 'string' && HEX40.test(x);
const sha64 = x => typeof x === 'string' && HEX64.test(x);
const runId = x => typeof x === 'string' && POSITIVE_ID.test(x);
const timeMs = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString() ===
    (x.includes('.') ? x : x.replace('Z', '.000Z')) ? Date.parse(x) : NaN;

/**
 * Intentionally non-authorizing diagnostic. Never use it as a submit gate.
 * Returns reason codes only, never caller-supplied account/order/secret values.
 */
export function inspectPaperMutationAdmission(candidate) {
  const problems = new Set();
  const mark = (ok, code) => { if (!ok) problems.add(code); };
  mark(fieldsExact(candidate, ROOT_KEYS), 'ROOT_SHAPE_INVALID');
  const request = plain(candidate) && plain(candidate.request) ? candidate.request : {};
  const runtime = plain(candidate) && plain(candidate.runtime) ? candidate.runtime : {};
  const approval = plain(candidate) && plain(candidate.approval) ? candidate.approval : {};
  const custody = plain(candidate) && plain(candidate.custody) ? candidate.custody : {};
  const consumed = plain(candidate) && candidate.consumedRequestIds;
  mark(fieldsExact(request, REQUEST_KEYS), 'REQUEST_SHAPE_INVALID');
  mark(fieldsExact(runtime, RUNTIME_KEYS), 'RUNTIME_SHAPE_INVALID');
  mark(fieldsExact(approval, APPROVAL_KEYS), 'APPROVAL_SHAPE_INVALID');
  mark(fieldsExact(custody, CUSTODY_KEYS), 'CUSTODY_SHAPE_INVALID');
  mark(Array.isArray(consumed) && consumed.length <= 1000 && consumed.every(x => typeof x === 'string' && REQUEST_ID.test(x))
    && new Set(consumed).size === consumed.length, 'CONSUMED_REQUESTS_INVALID');

  const target = owns(MUTATION_TARGETS, request.workflow) ? MUTATION_TARGETS[request.workflow] : null;
  mark(request.schemaVersion === 'paper-mutation-admission-v1', 'SCHEMA_INVALID');
  mark(!!target && request.job === target.job && request.operation === target.operation, 'TARGET_NOT_ALLOWLISTED');
  mark(request.repository === REPOSITORY && request.sourceRef === SOURCE_REF
    && request.stateRef === STATE_REF && request.environment === APPROVAL_ENVIRONMENT, 'REQUEST_BOUNDARY_INVALID');
  mark(sha40(request.codeSha) && sha40(request.expectedStateCommit)
    && sha64(request.accountFingerprint) && sha64(request.scopeFingerprint)
    && sha64(request.sourceEvidenceSha256) && sha64(request.riskEvidenceSha256), 'REQUEST_DIGEST_INVALID');
  mark(runId(request.runId) && request.runAttempt === 1 && request.event === 'workflow_dispatch'
    && typeof request.requestId === 'string' && REQUEST_ID.test(request.requestId), 'REQUEST_IDENTITY_INVALID');
  mark(!Array.isArray(consumed) || !consumed.includes(request.requestId), 'REQUEST_ALREADY_CONSUMED');

  mark(runtime.repository === REPOSITORY && runtime.ref === SOURCE_REF
    && runtime.event === 'workflow_dispatch' && runtime.environment === APPROVAL_ENVIRONMENT, 'RUNTIME_BOUNDARY_MISMATCH');
  mark(sha40(runtime.sha) && runtime.sha === request.codeSha
    && runtime.runId === request.runId && runtime.runAttempt === request.runAttempt
    && runtime.workflow === request.workflow && runtime.job === request.job
    && runtime.accountFingerprint === request.accountFingerprint
    && runtime.scopeFingerprint === request.scopeFingerprint
    && runtime.stateCommit === request.expectedStateCommit, 'RUNTIME_IDENTITY_MISMATCH');
  mark(approval.requestId === request.requestId && approval.codeSha === request.codeSha
    && approval.runId === request.runId && approval.runAttempt === request.runAttempt
    && approval.accountFingerprint === request.accountFingerprint
    && approval.scopeFingerprint === request.scopeFingerprint
    && approval.environment === APPROVAL_ENVIRONMENT, 'APPROVAL_BINDING_MISMATCH');
  mark(approval.status === 'approved' && approval.reviewer === 'pungking'
    && runId(approval.deploymentId), 'APPROVAL_CLAIM_INVALID');
  mark(sha40(custody.stateCommit) && custody.stateCommit === request.expectedStateCommit
    && sha40(custody.genesisCommit) && sha64(custody.writerClaim), 'CUSTODY_BINDING_INVALID');
  for (const field of BOOLEAN_TRUE) mark(custody[field] === true,
    'EVIDENCE_' + field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() + '_MISSING');
  mark(custody.unknownBrokerEffect === false, 'UNKNOWN_BROKER_EFFECT');

  const issued = timeMs(request.issuedAt), expiry = timeMs(request.expiresAt);
  const observed = timeMs(runtime.observedAt), reviewed = timeMs(approval.reviewedAt);
  mark(Number.isFinite(issued) && Number.isFinite(expiry) && expiry > issued
    && expiry - issued <= 5 * 60 * 1000, 'REQUEST_DEADLINE_INVALID');
  mark(Number.isFinite(observed) && Number.isFinite(issued) && Number.isFinite(expiry)
    && observed >= issued && observed < expiry, 'REQUEST_EXPIRED_OR_FUTURE');
  mark(Number.isFinite(reviewed) && Number.isFinite(observed) && Number.isFinite(issued)
    && reviewed >= issued && reviewed <= observed, 'APPROVAL_TIME_INVALID');

  const findings = Object.freeze([...problems].sort());
  return Object.freeze({
    schemaVersion: 'paper-mutation-admission-diagnostic-v1',
    status: findings.length ? 'DENY_CONTRACT_INVALID' : 'HOLD_OFFLINE_EVIDENCE_UNTRUSTED',
    contractValid: findings.length === 0,
    findings,
    operationalEligible: false,
    brokerSubmitAuthorized: false,
    stateMutationAuthorized: false,
    environmentApprovalVerified: false,
    durableWriterVerified: false,
    requiresSeparateRuntimeIntegrationAndExplicitApproval: true,
  });
}
