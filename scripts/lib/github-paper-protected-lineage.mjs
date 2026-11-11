/**
 * STEP 5C-4D-3E — READ-ONLY diagnostics joining GitHub required-review history,
 * Environment policy, original admission job identity and cryptographically
 * verified encrypted CLAIM ancestry.
 *
 * A successful check is HOLD, not execution authority. Caller-injected HTTP
 * and keys do not prove operational attestation or external writer exclusion.
 */
import { readGithubPaperReviewEvidence } from './github-paper-review-evidence.mjs';
import { createGithubPaperCustodyRestRequest } from './github-paper-custody-rest.mjs';
import { inspectGithubCustodyLineageReadOnly, validateGithubCustodyConfiguration } from './github-paper-custody.mjs';
import { paperCustodyAccountScopeFingerprint } from './paper-custody-runtime-boundary.mjs';

const REPO = 'pungking/alpha-exec-engine';
const ENV = 'PAPER_CUSTODY_APPROVAL';
const ENV_ID = 26847620868;
const REVIEWER = 'pungking';
const JOB_NAME = 'Protected PAPER approval - operational HOLD';
const MAX_BYTES = 1024 * 1024;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const WORKFLOWS = new Set([
  '.github/workflows/paper-oco-submit-canary.yml',
  '.github/workflows/persistent-oco-repair-submit.yml',
  '.github/workflows/ledger-filled-migration.yml',
  '.github/workflows/paper-five-row-active-limited-state-recovery.yml',
]);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a,b) => typeof a === 'string' && a === b;
const validId = x => typeof x === 'string' && ID.test(x) && Number.isSafeInteger(Number(x));
const report = (findings, match = false) => Object.freeze({
  schemaVersion: 'github-paper-protected-crypto-binding-v1',
  status: findings.length ? 'DENY_PROTECTED_LINEAGE_EVIDENCE' : 'HOLD_PROTECTED_LINEAGE_NOT_OPERATIONAL_AUTHORITY',
  findings: Object.freeze([...new Set(findings)].sort()),
  evidenceShapeMatched: findings.length === 0 && match,
  authenticatedJobDeploymentVerified: false,
  externalEnvironmentPolicyAttested: false,
  brokerAccountOwnershipVerified: false,
  sourceRiskCashflowVerified: false,
  accountWideWriterFenced: false,
  actualPaperStateProvisioned: false,
  brokerSubmitAuthorized: false,
  stateMutationAuthorized: false,
  operationalEligible: false,
});
function environmentMatches(env, policies) {
  if (!object(env) || env.id !== ENV_ID || env.name !== ENV
    || env.can_admins_bypass !== false || !Array.isArray(env.protection_rules)
    || env.protection_rules.length > 16
    || !object(env.deployment_branch_policy)
    || env.deployment_branch_policy.protected_branches !== false
    || env.deployment_branch_policy.custom_branch_policies !== true) return false;
  const required = env.protection_rules.filter(p => object(p) && p.type === 'required_reviewers');
  if (required.length !== 1 || !Array.isArray(required[0].reviewers)
    || required[0].reviewers.length !== 1) return false;
  const who = required[0].reviewers[0];
  if (!object(who) || who.type !== 'User'
    || who.reviewer?.login !== REVIEWER
    || !Number.isSafeInteger(who.reviewer?.id) || who.reviewer.id <= 0) return false;
  return object(policies) && policies.total_count === 1
    && Array.isArray(policies.branch_policies) && policies.branch_policies.length === 1
    && policies.branch_policies[0]?.name === 'main'
    && policies.branch_policies[0]?.type === 'branch';
}
function jobMatches(job, expected, jobId) {
  return object(job) && String(job.id) === jobId
    && String(job.run_id) === expected.runId && job.run_attempt === 1
    && job.head_sha === expected.codeSha && job.name === JOB_NAME
    && job.status === 'completed' && job.conclusion === 'failure';
}
function baseMatches({ expected, scope, custodyConfig, reviewedCodeSha256, jobId }) {
  const fingerprint = paperCustodyAccountScopeFingerprint(scope);
  const cfg = validateGithubCustodyConfiguration(custodyConfig);
  return object(expected) && validId(expected.runId)
    && SHA40.test(expected.codeSha || '') && WORKFLOWS.has(expected.workflowPath)
    && SHA64.test(expected.accountScopeSha256 || '')
    && fingerprint !== null && fingerprint === expected.accountScopeSha256
    && validId(jobId) && cfg.status === 'VALID_NOT_EXECUTION_READY'
    && custodyConfig.repository === REPO && custodyConfig.ref === 'refs/heads/paper-state'
    && custodyConfig.workflow === expected.workflowPath && custodyConfig.runId === expected.runId
    && custodyConfig.runAttempt === 1 && custodyConfig.accountSha256 === scope.accountSha256
    && custodyConfig.scopeSha256 === scope.scopeSha256
    && custodyConfig.attemptId === scope.attemptId
    && SHA64.test(reviewedCodeSha256 || '') && custodyConfig.codeSha256 === reviewedCodeSha256;
}
function lineageMatches(lineage, cfg, expected, scope) {
  const s = lineage?.snapshot;
  return lineage?.status === 'HOLD_CRYPTOGRAPHIC_LINEAGE_NOT_OPERATIONAL_AUTHORITY'
    && lineage.cryptographicLineageVerified === true && lineage.operationalEligible === false
    && lineage.stateMutationAuthorized === false && lineage.brokerSubmitAuthorized === false
    && object(s) && s.currentCommit === cfg.expectedCommit
    && s.genesisCommit === cfg.genesisCommit && s.phase === 'CLAIM'
    && Number.isSafeInteger(s.sequence) && s.sequence > 0
    && s.accountSha256 === scope.accountSha256 && s.scopeSha256 === scope.scopeSha256
    && s.attemptId === scope.attemptId && SHA64.test(s.envelopeSha256 || '')
    && object(s.writer) && s.writer.runId === expected.runId
    && s.writer.runAttempt === 1 && s.writer.workflow === expected.workflowPath
    && s.writer.codeSha256 === cfg.codeSha256;
}
/** Pure diagnostic of API-shaped input. Injection is NOT trusted attestation. */
export function inspectGithubProtectedLineageEvidence(input = {}) {
  const x = object(input) ? input : {};
  if (!baseMatches(x)) return report(['LOCAL_SCOPE_OR_CODE_INVALID']);
  const findings = [];
  if (x.review?.status !== 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY'
    || x.review.reviewHistoryBound !== true || x.review.operationalEligible !== false
    || x.review.brokerSubmitAuthorized !== false
    || !Array.isArray(x.review.findings) || x.review.findings.length)
    findings.push('RUN_REVIEW_INVALID');
  if (!environmentMatches(x.environment, x.branchPolicies))
    findings.push('ENVIRONMENT_POLICY_INVALID');
  if (!jobMatches(x.job, x.expected, x.jobId))
    findings.push('ADMISSION_JOB_IDENTITY_INVALID');
  if (!lineageMatches(x.lineage, x.custodyConfig, x.expected, x.scope))
    findings.push('CRYPTOGRAPHIC_CLAIM_INVALID');
  return report(findings, true);
}
/**
 * GET-only trusted-data preparation, with explicit token, fetch and private
 * key supplied by caller; no dispatch, environment mutation, CLAIM or broker.
 * The helper returns only diagnostic statuses and never passes raw data out.
 */
export async function inspectGithubProtectedLineageReadOnly(input = {}) {
  const x = object(input) ? input : {};
  if (!baseMatches(x)) return report(['LOCAL_SCOPE_OR_CODE_INVALID']);
  const { expected, scope, custodyConfig, reviewedCodeSha256, jobId,
    token, fetchImpl, privateKey } = x;
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096
    || !/^[\x21-\x7e]+$/.test(token) || typeof fetchImpl !== 'function'
    || privateKey?.type !== 'private') return report(['TRANSPORT_OR_KEY_INVALID']);
  try {
    const review = await readGithubPaperReviewEvidence({ expected, token, fetchImpl });
    if (review.status !== 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY'
      || review.reviewHistoryBound !== true) return report(['RUN_REVIEW_INVALID']);
    const headers = Object.freeze({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + token,
    });
    async function get(endpoint) {
      const response = await fetchImpl('https://api.github.com/repos/' + REPO + endpoint,
        { method: 'GET', headers, redirect: 'error', cache: 'no-store' });
      if (response?.status !== 200 || typeof response.body?.getReader !== 'function')
        throw Error('PROTECTED_READ_RESPONSE_INVALID');
      const length = response.headers?.get?.('content-length');
      if (length != null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
        throw Error('PROTECTED_READ_TOO_LARGE');
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw Error('PROTECTED_READ_RESPONSE_INVALID');
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw Error('PROTECTED_READ_TOO_LARGE');
          chunks.push(Buffer.from(value));
        }
      } catch (e) {
        await reader.cancel().catch(() => {});
        throw e;
      } finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
      if (!object(value)) throw Error('PROTECTED_READ_RESPONSE_INVALID');
      return value;
    }
    const environment = await get('/environments/' + ENV);
    const branchPolicies = await get('/environments/' + ENV + '/deployment-branch-policies?per_page=2');
    const job = await get('/actions/jobs/' + jobId);
    if (!environmentMatches(environment, branchPolicies))
      return report(['ENVIRONMENT_POLICY_INVALID']);
    if (!jobMatches(job, expected, jobId))
      return report(['ADMISSION_JOB_IDENTITY_INVALID']);
    const request = createGithubPaperCustodyRestRequest({
      repository: REPO, token, fetchImpl,
    });
    const lineage = await inspectGithubCustodyLineageReadOnly({
      config: custodyConfig, request, privateKey,
    });
    return inspectGithubProtectedLineageEvidence({
      expected, scope, custodyConfig, reviewedCodeSha256, jobId,
      review, environment, branchPolicies, job, lineage,
    });
  } catch {
    return report(['PROTECTED_READ_FAILED']);
  }
}
