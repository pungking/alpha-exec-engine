/**
 * STEP 5C-4D-3C — READ-ONLY composition of approved-run evidence, PAPER
 * account/scope pins and a claimed encrypted custody writer checkpoint.
 *
 * NON-AUTHORIZING. This cannot create a custody session, grant a broker
 * permission, validate real P0 inputs, or attest legacy writer exclusion.
 * Even synthetically perfect inputs always return HOLD, never READY.
 */
import { createHash } from 'node:crypto';
import { readGithubPaperReviewEvidence } from './github-paper-review-evidence.mjs';
import { createGithubPaperCustodyRestRequest } from './github-paper-custody-rest.mjs';
import { validateGithubCustodyConfiguration } from './github-paper-custody.mjs';

const REPOSITORY = 'pungking/alpha-exec-engine';
const REF = 'refs/heads/paper-state';
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[1-9][0-9]{0,15}$/;
const ATTEMPT_ID = /^[A-Za-z0-9_-]{1,96}$/;
const TARGETS = Object.freeze(new Set([
  '.github/workflows/paper-oco-submit-canary.yml',
  '.github/workflows/persistent-oco-repair-submit.yml',
  '.github/workflows/ledger-filled-migration.yml',
  '.github/workflows/paper-five-row-active-limited-state-recovery.yml',
]));
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x)
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => keys.includes(k));
const hex40 = x => typeof x === 'string' && HEX40.test(x);
const hex64 = x => typeof x === 'string' && HEX64.test(x);
const positiveRun = x => typeof x === 'string' && RUN_ID.test(x) && Number.isSafeInteger(Number(x));
const cleanStatus = (findings) => Object.freeze({
  schemaVersion: 'paper-custody-runtime-boundary-diagnostic-v1',
  status: findings.length ? 'DENY_RUNTIME_BOUNDARY_INVALID' : 'HOLD_BOUNDARY_UNTRUSTED_NOT_AUTHORIZED',
  findings: Object.freeze([...new Set(findings)].sort()),
  structuralBindingValid: findings.length === 0,
  reviewHistoryBound: false,
  environmentConfigurationVerified: false,
  accountOwnershipVerified: false,
  sourceAndRiskVerified: false,
  legacyWritersExcluded: false,
  remoteClaimLineageVerified: false,
  durableWriterVerified: false,
  brokerSubmitAuthorized: false,
  stateMutationAuthorized: false,
  operationalEligible: false,
});
const scopeKeys = ['accountSha256', 'scopeSha256', 'attemptId'];
const claimKeys = [
  'schemaVersion', 'ref', 'commit', 'parentCommit', 'genesisCommit', 'envelopeSha256',
  'phase', 'sequence', 'writer', 'accountSha256', 'scopeSha256', 'attemptId',
];
const writerKeys = ['runId', 'runAttempt', 'workflow', 'codeSha256'];
const expectedKeys = ['runId', 'codeSha', 'workflowPath', 'accountScopeSha256'];

export function paperCustodyAccountScopeFingerprint(scope) {
  if (!exact(scope, scopeKeys)
    || !hex64(scope.accountSha256) || !hex64(scope.scopeSha256)
    || typeof scope.attemptId !== 'string' || !ATTEMPT_ID.test(scope.attemptId)) return null;
  // Encodes values in a fixed tuple rather than ambiguous concatenated strings.
  return createHash('sha256').update(JSON.stringify([
    'paper-custody-account-scope-v1',
    scope.accountSha256, scope.scopeSha256, scope.attemptId,
  ])).digest('hex');
}
function expectedValid(e) {
  return exact(e, expectedKeys) && positiveRun(e.runId)
    && hex40(e.codeSha) && TARGETS.has(e.workflowPath) && hex64(e.accountScopeSha256);
}
function claimValid(c) {
  return exact(c, claimKeys) && c.schemaVersion === 'paper-custody-writer-claim-observation-v1'
    && c.ref === REF && hex40(c.commit) && hex40(c.parentCommit)
    && hex40(c.genesisCommit) && hex64(c.envelopeSha256)
    && c.commit !== c.parentCommit && c.phase === 'CLAIM'
    && Number.isSafeInteger(c.sequence) && c.sequence > 0
    && hex64(c.accountSha256) && hex64(c.scopeSha256)
    && typeof c.attemptId === 'string' && ATTEMPT_ID.test(c.attemptId)
    && exact(c.writer, writerKeys)
    && positiveRun(c.writer.runId) && c.writer.runAttempt === 1
    && TARGETS.has(c.writer.workflow) && hex64(c.writer.codeSha256);
}
function reviewValid(v) {
  return plain(v) && v.schemaVersion === 'github-paper-review-evidence-v1'
    && v.status === 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY'
    && v.reviewHistoryBound === true && Array.isArray(v.findings) && v.findings.length === 0
    && v.environmentConfigurationVerified === false
    && v.custodyScopeVerified === false && v.writerClaimVerified === false
    && v.brokerSubmitAuthorized === false && v.stateMutationAuthorized === false
    && v.operationalEligible === false;
}

/**
 * Match internal claims ONLY. No input object or matching status proves that
 * the GitHub approval, custody ref, or broker account actually exists.
 */
export function inspectPaperCustodyRuntimeBoundary(input = {}) {
  const problems = [];
  const add = (ok, why) => { if (!ok) problems.push(why); };
  const x = plain(input) ? input : {};
  add(exact(x, ['expected', 'scope', 'custodyConfig', 'claim', 'refSnapshot', 'reviewEvidence', 'reviewedCodeSha256']),
    'INPUT_SHAPE_INVALID');
  const { expected, scope, custodyConfig, claim, refSnapshot, reviewEvidence, reviewedCodeSha256 } = x;
  const e = expectedValid(expected);
  const fp = paperCustodyAccountScopeFingerprint(scope);
  add(e, 'EXPECTED_RUN_INVALID');
  add(fp !== null, 'ACCOUNT_SCOPE_INVALID');
  add(hex64(reviewedCodeSha256), 'REVIEWED_CODE_PIN_INVALID');
  const c = validateGithubCustodyConfiguration(custodyConfig);
  add(c.status === 'VALID_NOT_EXECUTION_READY', 'CUSTODY_CONFIG_INVALID');
  const configOk = c.status === 'VALID_NOT_EXECUTION_READY';
  const bounded = e && fp !== null && configOk;
  add(bounded && expected.accountScopeSha256 === fp
    && custodyConfig.repository === REPOSITORY && custodyConfig.ref === REF
    && custodyConfig.runId === expected.runId && custodyConfig.runAttempt === 1
    && custodyConfig.workflow === expected.workflowPath
    && custodyConfig.accountSha256 === scope.accountSha256
    && custodyConfig.scopeSha256 === scope.scopeSha256
    && custodyConfig.attemptId === scope.attemptId
    && custodyConfig.codeSha256 === reviewedCodeSha256,
    'CROSS_SCOPE_RUN_BINDING_INVALID');
  add(reviewValid(reviewEvidence), 'GITHUB_REVIEW_NOT_BOUND');
  const validClaim = claimValid(claim);
  add(validClaim, 'WRITER_CLAIM_FORMAT_INVALID');
  add(validClaim && configOk
    && claim.parentCommit === custodyConfig.expectedCommit
    && claim.genesisCommit === custodyConfig.genesisCommit
    && claim.accountSha256 === custodyConfig.accountSha256
    && claim.scopeSha256 === custodyConfig.scopeSha256
    && claim.attemptId === custodyConfig.attemptId
    && claim.writer.runId === custodyConfig.runId
    && claim.writer.runAttempt === custodyConfig.runAttempt
    && claim.writer.workflow === custodyConfig.workflow
    && claim.writer.codeSha256 === custodyConfig.codeSha256,
    'WRITER_CLAIM_BINDING_INVALID');
  add(plain(refSnapshot) && refSnapshot.ref === REF
    && plain(refSnapshot.object) && refSnapshot.object.type === 'commit'
    && hex40(refSnapshot.object.sha) && validClaim
    && refSnapshot.object.sha === claim.commit,
    'REMOTE_HEAD_MISMATCH');
  return cleanStatus(problems);
}

/**
 * Read GitHub approval history + encrypted-state ref through injected HTTP
 * GET-only transports, then return a non-authorizing diagnostic. No secrets,
 * environment config, workflow/job code or broker state are modified.
 *
 * This does NOT authenticate claim contents; a future independently reviewed
 * decrypt/lineage checker and account-wide writer exclusion are mandatory.
 */
export async function inspectPaperCustodyReadOnlyPreflight(input = {}) {
  const { expected, scope, custodyConfig, claim, reviewedCodeSha256, token, fetchImpl } =
    plain(input) ? input : {};
  const base = { expected, scope, custodyConfig, claim,
    refSnapshot: null, reviewEvidence: null, reviewedCodeSha256 };
  const shape = inspectPaperCustodyRuntimeBoundary(base);
  const first = shape.findings.filter(x =>
    x !== 'REMOTE_HEAD_MISMATCH' && x !== 'GITHUB_REVIEW_NOT_BOUND');
  if (first.length) return cleanStatus(first);
  try {
    const review = await readGithubPaperReviewEvidence({ expected, token, fetchImpl });
    if (!reviewValid(review)) return cleanStatus(['GITHUB_REVIEW_NOT_BOUND']);
    const request = createGithubPaperCustodyRestRequest({
      repository: REPOSITORY, token, fetchImpl,
    });
    const signal = new AbortController().signal;
    const snapshot = await request({
      method: 'GET', path: '/repos/' + REPOSITORY + '/git/ref/heads/paper-state', signal,
    });
    if (snapshot.status !== 200) return cleanStatus(['REMOTE_REF_NOT_AVAILABLE']);
    return inspectPaperCustodyRuntimeBoundary({
      ...base, reviewEvidence: review, refSnapshot: snapshot.data,
    });
  } catch {
    // No provider messages, tokens, state content or caller strings in result.
    return cleanStatus(['READ_ONLY_PREFLIGHT_FAILED']);
  }
}
