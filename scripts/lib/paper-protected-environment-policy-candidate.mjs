/**
 * STEP 5C-4D-3R — GET-only protected Environment policy candidate inspection.
 *
 * This fills a missing *read-only acquisition interface* after 3Q.
 * All inputs, including injected REST responses, are untrusted. A matching
 * policy shape is NOT GitHub-origin attestation, run-specific approval,
 * proof of branch rules enforced at a historical run, or broker fencing.
 * Never reads an ambient token, network, clock, filesystem or ledger.
 */
const REPO = 'pungking/alpha-exec-engine';
const ENV = 'PAPER_CUSTODY_APPROVAL';
const MAX_BYTES = 128 * 1024;
const object = value => value !== null && typeof value === 'object'
  && !Array.isArray(value);
const validID = value => Number.isSafeInteger(value) && value > 0;
const output = (findings, mode = null) => Object.freeze({
 schemaVersion: 'paper-protected-environment-policy-candidate-v1',
 status: findings.length ? 'DENY_GITHUB_ENVIRONMENT_POLICY_CANDIDATE_INVALID'
   : 'HOLD_UNATTESTED_PROTECTED_ENVIRONMENT_POLICY',
 findings: Object.freeze([...new Set(findings)].sort()),
 suppliedReviewerAndBranchGuardrailsMatch: findings.length === 0,
 suppliedBranchMode: findings.length === 0 ? mode : null,
 proofGaps: Object.freeze([
  'INJECTED_HTTP_TRANSPORT_IS_NOT_TRUSTED_GITHUB_PROVENANCE',
  'ENVIRONMENT_POLICY_NOT_ATTESTED_AT_RUN_ATTEMPT',
  'GITHUB_ENVIRONMENT_REVIEW_IS_NOT_SEPARATE_WRITER_JOB_APPROVAL',
  'REPOSITORY_MAIN_BRANCH_PROTECTION_NOT_INDEPENDENTLY_ATTESTED',
  'BROKER_ACCOUNT_WIDE_WRITER_FENCING_NOT_VERIFIED',
  'SEPARATE_HUMAN_OPERATIONAL_APPROVAL_NOT_OBTAINED',
 ]),
 trustedGithubApiSourceVerified: false,
 policyAtRunTimeVerified: false,
 protectedAdmissionApprovalTransferredToWriter: false,
 protectedWriterJobApprovalVerified: false,
 independentlyVerifiedMainBranchProtection: false,
 brokerWriterExclusivityVerified: false,
 operationalEligible: false,
 paperBrokerSubmitAuthorized: false,
 paperStateMutationAuthorized: false,
 liveTradingAuthorized: false,
});
/**
 * Pure, untrusted API-shape + least-privilege guardrail validation.
 * The custom branch-policy list must be exhaustive within the 100-row
 * bounded first page, and its only accepted pattern is literal "main".
 * Protected-branches mode requires separate branch protection evidence.
 */
export function inspectPaperProtectedEnvironmentPolicyCandidate(input = {}) {
 const x = object(input) ? input : {}, findings = [];
 const env = x.environment, policies = x.branchPolicies;
 if (Object.keys(x).sort().join(',') !== 'branchPolicies,environment')
  findings.push('POLICY_INPUT_ENVELOPE_INVALID');
 if (!object(env) || !validID(env.id) || env.name !== ENV
   || !Array.isArray(env.protection_rules)
   || !object(env.deployment_branch_policy))
  findings.push('ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID');
 if (findings.includes('ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID'))
  return output(findings);
 const rules = env.protection_rules;
 const reviews = rules.filter(r => object(r) && r.type === 'required_reviewers');
 if (reviews.length !== 1 || reviews[0].prevent_self_review !== true
   || !Array.isArray(reviews[0].reviewers)
   || reviews[0].reviewers.length < 1 || reviews[0].reviewers.length > 6
   || reviews[0].reviewers.some(r => !object(r)
     || !['User', 'Team'].includes(r.type)
     || !object(r.reviewer) || !validID(r.reviewer.id))
   || new Set(reviews[0].reviewers.map(r => String(r?.reviewer?.id))).size
     !== reviews[0].reviewers.length)
  findings.push('REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
 const branchRules = rules.filter(r => object(r) && r.type === 'branch_policy');
 if (branchRules.length !== 1)
  findings.push('ENVIRONMENT_BRANCH_PROTECTION_RULE_MISSING');
 const b = env.deployment_branch_policy;
 let mode = null;
 if (b.protected_branches === true && b.custom_branch_policies === false)
  mode = 'PROTECTED_BRANCHES_UNATTESTED';
 else if (b.protected_branches === false && b.custom_branch_policies === true)
  mode = 'CUSTOM_MAIN_PATTERN_UNATTESTED';
 else findings.push('DEPLOYMENT_BRANCH_RESTRICTION_UNSAFE');
 if (mode === 'PROTECTED_BRANCHES_UNATTESTED') {
  if (policies !== null)
   findings.push('UNEXPECTED_CUSTOM_BRANCH_LIST');
 } else if (mode === 'CUSTOM_MAIN_PATTERN_UNATTESTED') {
  if (!object(policies) || !Array.isArray(policies.branch_policies)
    || policies.total_count !== 1 || policies.branch_policies.length !== 1
    || policies.branch_policies[0]?.name !== 'main'
    || !validID(policies.branch_policies[0]?.id))
   findings.push('CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
 }
 return output(findings, mode);
}
/**
 * Caller-injected GET-only adapter. It does not automatically run, load secrets
 * or claim the injected fetch is authentic. A malicious fetch may ignore the
 * AbortSignal: this function does not guarantee a wall-clock deadline.
 */
export async function readPaperProtectedEnvironmentPolicyCandidate(input = {}) {
 const x = object(input) ? input : {};
 if (typeof x.token !== 'string' || x.token.length < 8 || x.token.length > 4096
   || !/^[\x21-\x7e]+$/.test(x.token)
   || typeof x.fetchImpl !== 'function'
   || !object(x.signal) || typeof x.signal.addEventListener !== 'function'
   || typeof x.signal.aborted !== 'boolean' || x.signal.aborted)
  return output(['READ_ONLY_TRANSPORT_CONFIG_INVALID']);
 const root = 'https://api.github.com/repos/' + REPO;
 const headers = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: 'Bearer ' + x.token,
 });
 async function get(path) {
  if (x.signal.aborted) throw Error('ABORTED');
  const response = await x.fetchImpl(root + path, {
   method: 'GET', headers, redirect: 'error', cache: 'no-store',
   signal: x.signal,
  });
  if (response?.status !== 200 || typeof response.body?.getReader !== 'function')
   throw Error('HTTP_STATUS_OR_BODY_UNEXPECTED');
  const media = response.headers?.get?.('content-type');
  if (typeof media !== 'string' || !/^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(media))
   throw Error('NON_JSON_RESPONSE');
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined
    && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES))
   throw Error('INVALID_LENGTH');
  const reader = response.body.getReader();
  let bytes = 0, chunks = [];
  try {
   for (;;) {
    if (x.signal.aborted) throw Error('ABORTED');
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) throw Error('INVALID_STREAM_CHUNK');
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) throw Error('RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(value));
   }
  } catch (error) {
   await reader.cancel().catch(() => {});
   throw error;
  } finally { reader.releaseLock(); }
  if (declared !== null && declared !== undefined && Number(declared) !== bytes)
   throw Error('CONTENT_LENGTH_MISMATCH');
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
 }
 try {
  const environment = await get('/environments/' + ENV);
  if (!object(environment)) throw Error('INVALID_ENVIRONMENT_BODY');
  const custom = environment.deployment_branch_policy?.custom_branch_policies === true;
  const branchPolicies = custom
   ? await get('/environments/' + ENV + '/deployment-branch-policies?per_page=100&page=1')
   : null;
  return inspectPaperProtectedEnvironmentPolicyCandidate({
   environment, branchPolicies,
  });
 } catch {
  // Never return provider error bodies, request URL, credentials or tokens.
  return output(['READ_ONLY_GITHUB_ENVIRONMENT_POLICY_UNAVAILABLE']);
 }
}
