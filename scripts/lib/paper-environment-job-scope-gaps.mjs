/**
 * STEP 5C-4D-3S — source-only protected Environment applicability boundary.
 *
 * An Environment applies to a Job that names it, not automatically to a
 * downstream, mutation-capable Job. GitHub policy candidates and local YAML
 * are not trusted runtime/approval or broker-account evidence.
 *
 * No network, ambient credential, time, filesystem or state mutation.
 */
import {
 inspectPaperProtectedWriterTopology,
 PAPER_PROTECTED_WRITER_TOPOLOGY,
} from './paper-protected-writer-topology.mjs';
import {
 inspectPaperProtectedEnvironmentPolicyCandidate,
} from './paper-protected-environment-policy-candidate.mjs';

const REPO = 'pungking/alpha-exec-engine';
const ENV = 'PAPER_CUSTODY_APPROVAL';
const REVIEWED_MAIN_SHA = '6cd26eb4fffc32c181a6768b3f9eaff589162bb8';
const ENV_ID = 26847620868;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x,keys) => object(x) && Object.keys(x).length === keys.length
  && keys.every(k=>Object.hasOwn(x,k));
const INPUT_KEYS = ['schemaVersion','reviewedMainSha','baseline',
 'workflowSources','environmentCandidate','requested','authorityClaims'];
const REQUEST_KEYS = ['repository','sourceRef','sourceSha',
 'workflowFile','protectedAdmissionJob','mutationWriterJob',
 'environmentName','environmentId'];
const CLAIM_KEYS = ['environmentAttestedAtRun','adminBypassIndependentlyExcluded',
 'mainBranchProtectionIndependentlyVerified','mutationJobApprovalVerified',
 'brokerAccountWritersFenced','independentReplayControlEnforced',
 'separateHumanOperationalApproval','operationalEligible'];
const report = (findings, target = null) => Object.freeze({
 schemaVersion: 'paper-environment-job-scope-gaps-v1',
 status: findings.length ? 'DENY_PROTECTED_ENVIRONMENT_SCOPE_INVALID'
  : 'HOLD_PROTECTED_ADMISSION_POLICY_NOT_WRITER_AUTHORITY',
 findings: Object.freeze([...new Set(findings)].sort()),
 sourceTopologyMatched: findings.length === 0,
 suppliedPolicyShapeMatched: findings.length === 0,
 protectedAdmissionJobs: findings.length === 0 ? 4 : 0,
 distinctMutationWriterJobs: findings.length === 0 ? 4 : 0,
 requestedProtectedJob: findings.length === 0 ? 'admission' : null,
 requestedWriterJob: findings.length === 0 ? target.writer : null,
 requestedWorkflowFile: findings.length === 0 ? target.file : null,
 proofGaps: Object.freeze([
  'ENVIRONMENT_CANDIDATE_IS_NOT_VERIFIED_GITHUB_POLICY',
  'REVIEWED_ENVIRONMENT_ID_NOT_INDEPENDENTLY_ATTESTED',
  'CURRENT_POLICY_CANNOT_ATTEST_HISTORICAL_RUN_ATTEMPT',
  'ADMIN_BYPASS_STATE_NOT_INDEPENDENTLY_VERIFIED',
  'MAIN_BRANCH_ACTUAL_PROTECTION_NOT_VERIFIED',
  'ADMISSION_ENVIRONMENT_IS_NOT_DOWNSTREAM_MUTATION_JOB_ENVIRONMENT',
  'PROTECTED_JOB_DEPLOYMENT_APPROVAL_NOT_INDEPENDENTLY_LINKED',
  'ALL_EXTERNAL_BROKER_ACCOUNT_WRITERS_NOT_EXCLUDED',
  'BROKER_MUTATION_EDGE_FENCING_NOT_ENFORCED',
  'REPLAY_PROTECTION_AND_HUMAN_OPERATIONAL_APPROVAL_MISSING',
 ]),
 trustedGithubSourceVerified: false,
 policyAtRunTimeVerified: false,
 administratorBypassExcluded: false,
 exactMutationJobDeploymentApproved: false,
 accountWideBrokerWriterFencingVerified: false,
 independentReplayGuardVerified: false,
 separateHumanOperationalApprovalVerified: false,
 operationalEligible: false,
 paperBrokerSubmitAuthorized: false,
 paperStateMutationAuthorized: false,
 liveTradingAuthorized: false,
});
/**
 * Compare reviewed 3P YAML topology with a 3R untrusted policy candidate.
 * Explicit requested job identity prevents a protected admission approval
 * from being silently re-labelled as approval of the mutation writer Job.
 */
export function inspectPaperEnvironmentJobScopeGaps(input={}) {
 const x=object(input)?input:{},findings=[];
 if(!exact(x,INPUT_KEYS)||x.schemaVersion!=='paper-environment-job-scope-gaps-v1'
  ||x.reviewedMainSha!==REVIEWED_MAIN_SHA)
  findings.push('SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
 const topology=inspectPaperProtectedWriterTopology({
  baseline:x.baseline,workflowSources:x.workflowSources,
 });
 if(topology.status!=='HOLD_APPROVED_ADMISSION_NOT_WRITER_JOB_AUTHORITY'
  ||topology.reviewedSourceTopologyMatched!==true
  ||topology.protectedAdmissionApprovalTransfersToWriter!==false
  ||topology.operationalEligible!==false)
  findings.push('FOUR_WORKFLOW_SOURCE_TOPOLOGY_INVALID');
 const policy=inspectPaperProtectedEnvironmentPolicyCandidate(x.environmentCandidate);
 if(policy.status!=='HOLD_UNATTESTED_PROTECTED_ENVIRONMENT_POLICY'
  ||policy.suppliedReviewerAndBranchGuardrailsMatch!==true
  ||policy.operationalEligible!==false
  ||policy.trustedGithubApiSourceVerified!==false)
  findings.push('UNTRUSTED_POLICY_CANDIDATE_INVALID');

 const requested=x.requested;
 const target=PAPER_PROTECTED_WRITER_TOPOLOGY.find(v=>v.file===requested?.workflowFile);
 if(!exact(requested,REQUEST_KEYS)
  ||requested.repository!==REPO
  ||requested.sourceRef!=='refs/heads/main'
  ||requested.sourceSha!==REVIEWED_MAIN_SHA
  ||!target
  ||requested.protectedAdmissionJob!=='admission'
  ||requested.mutationWriterJob!==target?.writer
  ||requested.environmentName!==ENV
  ||requested.environmentId!==ENV_ID
  ||x.environmentCandidate?.environment?.id!==ENV_ID)
   findings.push('EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
 if(!exact(x.authorityClaims,CLAIM_KEYS)
  ||CLAIM_KEYS.some(k=>x.authorityClaims?.[k]!==false))
  findings.push('UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
 return report(findings,target);
}
