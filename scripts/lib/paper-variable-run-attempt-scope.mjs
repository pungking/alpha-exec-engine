/**
 * STEP 5C-4D-3Z — three source-variable Workflow Run↔Job attempt scopes.
 *
 * These are normalized, caller-supplied *metadata candidates*, not GitHub
 * origin attestations or historical values of vars.ALPACA_BASE_URL.
 *
 * Pure offline. No network, ambient tokens, account identities, file writes,
 * orders, trading or operation-authorization code paths.
 */
import { inspectPaperGithubAlpacaVariableProofGap } from './paper-github-alpaca-variable-proof-gap.mjs';

const REPO='pungking/alpha-exec-engine';
const REVIEWED_MAIN='5de8d91bc6449a3516989f3ba312659f15554c12';
const PRIOR_MAIN='111b95195fc6b911f10e23ec1e288360a0849518';
const TARGETS=Object.freeze([
 Object.freeze({file:'dry-run.yml',job:'dry-run',
  events:Object.freeze(['workflow_dispatch','schedule']),mode:'REPORT_ONLY'}),
 Object.freeze({file:'market-guard.yml',job:'market-guard',
  events:Object.freeze(['workflow_dispatch','schedule']),mode:'REPORT_ONLY'}),
 Object.freeze({file:'ledger-filled-migration.yml',job:'ledger-filled-migration',
  events:Object.freeze(['workflow_dispatch']),mode:'PROTECTED_ADMISSION_FAIL_CLOSED'}),
]);
export const PAPER_VARIABLE_ATTEMPT_SOURCE_TARGETS=TARGETS;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const positive=x=>Number.isSafeInteger(x)&&x>0;
const INPUT=['schemaVersion','repository','reviewedMainSha','baseline',
 'workflowSources','variableBefore','variableAfter','attempts','authorityClaims'];
const RUN=['repository','workflowFile','runId','runAttempt','headSha','ref',
 'event','status','conclusion'];
const JOB=['jobId','runId','runAttempt','headSha','name','status',
 'conclusion','sourceEnvironment'];
const OBS=['variableAtRun','outboundHostAtRun','brokerAccountBinding',
 'githubSourceProvenance'];
const RECORD=['workflowFile','sourceJobId','run','job','observations'];
const AUTH=['githubRunSourceIndependentlyAttested',
 'runSpecificVariableValueVerified','environmentOverridesExcludedAtRun',
 'runtimeOutboundPaperHostIndependentlyVerified',
 'brokerPaperLiveCredentialIsolationVerified','brokerOrderPrivilegesExcluded',
 'allOtherAccountWritersExcluded','mutationEdgeFenceEnforced',
 'independentReplayGuardEnforced','independentHumanOperationApproval',
 'operationalEligible'];
const PRIOR_AUTH=['actualGithubOriginAttested','historicalVariableResolutionVerified',
 'paperLiveAccountSeparationVerified','effectiveOutboundHostVerified',
 'brokerKeyOrderPermissionExcluded','externalAccountWritersExcluded',
 'brokerMutationFenceEnforced','independentReplayProtected',
 'humanOperationalApprovalObtained','operationalEligible'];
function report(errors){
 const ok=errors.length===0;
 return Object.freeze({
  schemaVersion:'paper-variable-run-attempt-scope-v1',
  status:ok?'HOLD_UNATTESTED_RUN_JOB_VARIABLE_AT_RUNTIME'
   :'DENY_RUN_JOB_SCOPE_OR_VARIABLE_PROOF_INVALID',
  findings:Object.freeze([...new Set(errors)].sort()),
  sourceAndCandidateRunJobShapeMatched:ok,
  runJobTargets:ok?3:null,
  reportOnlyAttemptTargets:ok?2:null,
  admissionHaltedMutationTarget:ok?1:null,
  reviewedFrozenMainSha:REVIEWED_MAIN,
  proofGaps:Object.freeze([
   'RUN_JOB_METADATA_SNAPSHOT_IS_CALLER_SUPPLIED_UNATTESTED',
   'GITHUB_RUN_ID_JOB_ID_AND_ATTEMPT_NOT_INDEPENDENTLY_LINKED',
   'CURRENT_GITHUB_REPOSITORY_VARIABLE_NOT_RUN_ATTEMPT_VALUE',
   'GITHUB_REPOSITORY_VARIABLE_AT_RUN_TIME_NOT_CAPTURED',
   'JOB_STEP_ENV_OVERRIDES_AND_NESTED_EGRESS_NOT_PROVEN',
   'HISTORICAL_WORKFLOW_REF_AND_GITHUB_POLICY_NOT_ATTESTED',
   'PROTECTED_ADMISSION_FAIL_CLOSED_CANNOT_AUTHORIZE_LEDGER_JOB',
   'PAPER_VS_LIVE_BROKER_KEY_PERMISSION_SCOPE_UNVERIFIED',
   'ALL_EXTERNAL_ACCOUNT_WRITERS_AND_FENCING_UNVERIFIED',
   'SEPARATE_HUMAN_OPERATION_APPROVAL_AND_ANTI_REPLAY_MISSING',
  ]),
  currentRepositoryVariableAuthenticated:false,
  exactRunAttemptGithubOriginVerified:false,
  variableAtRunTimeVerified:false,
  actualRunJobDeploymentPolicyVerified:false,
  outboundPaperHostVerified:false,
  brokerKeyReadOnlyPrivilegeVerified:false,
  accountWideWriterExclusivityVerified:false,
  brokerMutationFenceVerified:false,
  separateHumanOperationalApprovalVerified:false,
  operationalEligible:false,
  paperBrokerSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
 });
}
export function inspectPaperVariableRunAttemptScope(input={}){
 const x=object(input)?input:{},errors=[];
 if(!exact(x,INPUT)||x.schemaVersion!=='paper-variable-run-attempt-scope-v1'
   ||x.repository!==REPO||x.reviewedMainSha!==REVIEWED_MAIN)
  errors.push('REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
 if(!exact(x.authorityClaims,AUTH)||AUTH.some(k=>x.authorityClaims?.[k]!==false))
  errors.push('UNSUPPORTED_RUN_ATTEMPT_AUTHORITY_CLAIM');
 const prior=inspectPaperGithubAlpacaVariableProofGap({
  schemaVersion:'paper-github-alpaca-base-url-proof-gap-v1',
  repository:REPO,reviewedMainSha:PRIOR_MAIN,
  baseline:x.baseline,workflowSources:x.workflowSources,
  variableBefore:x.variableBefore,variableAfter:x.variableAfter,
  authorityClaims:Object.fromEntries(PRIOR_AUTH.map(k=>[k,false])),
 });
 if(prior.status!=='HOLD_UNATTESTED_REPO_PAPER_VARIABLE_CANDIDATE'
   ||prior.reviewedVariableDependentJobs!==3)
  errors.push('REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');

 if(!Array.isArray(x.attempts)||x.attempts.length!==TARGETS.length){
  errors.push('EXACT_THREE_RUN_JOB_ATTEMPTS_REQUIRED');return report(errors);
 }
 const seenFiles=new Set(),seenRuns=new Set(),seenJobs=new Set();
 for(const entry of x.attempts){
  if(!exact(entry,RECORD)){
   errors.push('RUN_JOB_ATTEMPT_RECORD_SHAPE_INVALID');continue;
  }
  const t=TARGETS.find(v=>v.file===entry.workflowFile);
  if(!t||entry.sourceJobId!==t.job||seenFiles.has(entry.workflowFile))
   errors.push('RUN_JOB_SOURCE_TARGET_OR_DUPLICATE_INVALID');
  seenFiles.add(entry.workflowFile);
  const r=entry.run,j=entry.job,o=entry.observations;
  if(!exact(r,RUN)||!positive(r.runId)||!positive(r.runAttempt)
   ||r.runAttempt>1000||r.repository!==REPO||r.headSha!==REVIEWED_MAIN
   ||r.ref!=='refs/heads/main'
   ||(r.workflowFile!=='.github/workflows/'+entry.workflowFile
     &&r.workflowFile!=='.github/workflows/'+entry.workflowFile+'@main')
   ||!t?.events.includes(r.event)
   ||r.status!=='completed'
   ||!['success','failure','cancelled','skipped'].includes(r.conclusion))
   errors.push('RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
  if(!exact(j,JOB)||!positive(j.jobId)||j.runId!==r?.runId
   ||j.runAttempt!==r?.runAttempt||j.headSha!==r?.headSha
   ||j.name!==entry.sourceJobId||j.sourceEnvironment!==null
   ||j.status!=='completed'
   ||!['success','failure','cancelled','skipped'].includes(j.conclusion))
   errors.push('JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
  if(t?.mode==='PROTECTED_ADMISSION_FAIL_CLOSED'){
   if(j?.conclusion!=='skipped'||r?.conclusion==='success')
    errors.push('FAIL_CLOSED_ADMISSION_CANNOT_PROMOTE_LEDGER_JOB');
  }else if(r?.conclusion!==j?.conclusion)
   errors.push('REPORT_JOB_AND_WORKFLOW_OUTCOMES_CONFLICT');
  if(!exact(o,OBS)
   ||o.variableAtRun!=='NOT_ATTESTED'
   ||o.outboundHostAtRun!=='NOT_ATTESTED'
   ||o.brokerAccountBinding!=='NOT_ATTESTED'
   ||o.githubSourceProvenance!=='CALLER_SUPPLIED_UNVERIFIED')
   errors.push('RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
  if(seenRuns.has(r?.runId))errors.push('REUSED_WORKFLOW_RUN_ID');
  if(seenJobs.has(j?.jobId))errors.push('REUSED_WORKFLOW_JOB_ID');
  seenRuns.add(r?.runId);seenJobs.add(j?.jobId);
 }
 if(seenFiles.size!==TARGETS.length)
  errors.push('MISSING_OR_DUPLICATED_REVIEWED_WORKFLOW');
 return report(errors);
}
