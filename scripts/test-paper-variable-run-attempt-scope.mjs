import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 PAPER_VARIABLE_ATTEMPT_SOURCE_TARGETS as RUN_TARGETS,
 inspectPaperVariableRunAttemptScope as inspect,
} from './lib/paper-variable-run-attempt-scope.mjs';
import { PAPER_BROKER_ENDPOINT_REVIEWED_JOBS as SOURCE_TARGETS }
 from './lib/paper-broker-endpoint-source-audit.mjs';

const REPO='pungking/alpha-exec-engine';
const MAIN='5de8d91bc6449a3516989f3ba312659f15554c12';
const BASE=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const SOURCES=Object.fromEntries(SOURCE_TARGETS.map(t=>[
 t.file,fs.readFileSync('.github/workflows/'+t.file,'utf8'),
]));
const PAPER='https://paper-api.alpaca.markets';
const AUTH=['githubRunSourceIndependentlyAttested',
 'runSpecificVariableValueVerified','environmentOverridesExcludedAtRun',
 'runtimeOutboundPaperHostIndependentlyVerified',
 'brokerPaperLiveCredentialIsolationVerified','brokerOrderPrivilegesExcluded',
 'allOtherAccountWritersExcluded','mutationEdgeFenceEnforced',
 'independentReplayGuardEnforced','independentHumanOperationApproval',
 'operationalEligible'];
const evidence=()=>({variableAtRun:'NOT_ATTESTED',outboundHostAtRun:'NOT_ATTESTED',
 brokerAccountBinding:'NOT_ATTESTED',githubSourceProvenance:'CALLER_SUPPLIED_UNVERIFIED'});
const variable=()=>({name:'ALPACA_BASE_URL',value:PAPER,
 created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-10T00:00:00Z'});
function fixture(){
 return {
  schemaVersion:'paper-variable-run-attempt-scope-v1',
  repository:REPO,reviewedMainSha:MAIN,baseline:structuredClone(BASE),
  workflowSources:{...SOURCES},variableBefore:variable(),variableAfter:variable(),
  attempts:RUN_TARGETS.map((t,i)=>{
   const runId=100000+i,jobId=200000+i,ledger=i===2;
   const conclusion=ledger?'failure':i===0?'success':'failure';
   const jobConclusion=ledger?'skipped':conclusion;
   return {
    workflowFile:t.file,sourceJobId:t.job,
    run:{repository:REPO,workflowFile:'.github/workflows/'+t.file,
     runId,runAttempt:1,headSha:MAIN,ref:'refs/heads/main',
     event:ledger?'workflow_dispatch':'schedule',
     status:'completed',conclusion},
    job:{jobId,runId,runAttempt:1,headSha:MAIN,name:t.job,
     status:'completed',conclusion:jobConclusion,sourceEnvironment:null},
    observations:evidence(),
   };
  }),
  authorityClaims:Object.fromEntries(AUTH.map(k=>[k,false])),
 };
}
let checks=0,actualGithubRequests=0,actualBrokerRequests=0,externalWrites=0;
const safe=r=>{
 for(const key of ['currentRepositoryVariableAuthenticated',
  'exactRunAttemptGithubOriginVerified','variableAtRunTimeVerified',
  'actualRunJobDeploymentPolicyVerified','outboundPaperHostVerified',
  'brokerKeyReadOnlyPrivilegeVerified','accountWideWriterExclusivityVerified',
  'brokerMutationFenceVerified','separateHumanOperationalApprovalVerified',
  'operationalEligible','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])
  assert.equal(r[key],false,key);
 assert.ok(r.proofGaps.includes(
  'CURRENT_GITHUB_REPOSITORY_VARIABLE_NOT_RUN_ATTEMPT_VALUE'));
 for(const secret of ['100000','200000',PAPER,'https://api.alpaca.markets',
  'fake-token', 'broker-account-id'])
  assert.ok(!JSON.stringify(r).includes(secret),'raw evidence reflected');
};
const held=x=>{
 const r=inspect(x);
 assert.equal(r.status,'HOLD_UNATTESTED_RUN_JOB_VARIABLE_AT_RUNTIME',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceAndCandidateRunJobShapeMatched,true);
 assert.equal(r.runJobTargets,3);
 assert.equal(r.reportOnlyAttemptTargets,2);
 assert.equal(r.admissionHaltedMutationTarget,1);
 safe(r);checks++;return r;
};
const denied=(x,error)=>{
 const r=inspect(x);
 assert.equal(r.status,'DENY_RUN_JOB_SCOPE_OR_VARIABLE_PROOF_INVALID');
 assert.ok(r.findings.includes(error),JSON.stringify(r.findings));
 assert.equal(r.sourceAndCandidateRunJobShapeMatched,false);
 assert.equal(r.runJobTargets,null);safe(r);checks++;
};
const mutate=(fn,error)=>{const x=fixture();fn(x);denied(x,error);};
held(fixture());


{
 const x=fixture();x.attempts[0].run.workflowFile+='@main';
 x.attempts[0].run.event='workflow_dispatch';
 held(x);
}
{
 const x=fixture();x.attempts[1].run.event='workflow_dispatch';
 x.attempts[1].run.conclusion='success';
 x.attempts[1].job.conclusion='success';
 held(x);
}
denied(null,'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
denied({},'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
mutate(x=>{x.schemaVersion='READY';},'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
mutate(x=>{x.repository='another/repo';},'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
mutate(x=>{x.reviewedMainSha='f'.repeat(40);},'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
mutate(x=>{x.additionalAuthority=true;},'REVIEWED_MAIN_OR_INPUT_ENVELOPE_INVALID');
for(const k of AUTH)mutate(x=>{x.authorityClaims[k]=true;},
 'UNSUPPORTED_RUN_ATTEMPT_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.trustedRun=true;},
 'UNSUPPORTED_RUN_ATTEMPT_AUTHORITY_CLAIM');
mutate(x=>{delete x.authorityClaims;},
 'UNSUPPORTED_RUN_ATTEMPT_AUTHORITY_CLAIM');
mutate(x=>{x.baseline.operationalHold=false;},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{x.baseline.workflows.pop();},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{x.variableBefore.value='https://api.alpaca.markets';},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{x.variableAfter.updated_at='2026-11-11T00:00:00Z';},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{delete x.workflowSources['market-guard.yml'];},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{x.workflowSources['dry-run.yml']=x.workflowSources['dry-run.yml']
 .replace('vars.ALPACA_BASE_URL','vars.LIVE_BASE_URL');},
 'REVIEWED_VARIABLE_AND_WORKFLOW_SOURCE_INVALID');
mutate(x=>{x.attempts.pop();},'EXACT_THREE_RUN_JOB_ATTEMPTS_REQUIRED');
mutate(x=>{x.attempts=[];},'EXACT_THREE_RUN_JOB_ATTEMPTS_REQUIRED');
mutate(x=>{x.attempts.push(x.attempts[0]);},
 'EXACT_THREE_RUN_JOB_ATTEMPTS_REQUIRED');
mutate(x=>{x.attempts[0]={};},'RUN_JOB_ATTEMPT_RECORD_SHAPE_INVALID');
mutate(x=>{x.attempts[0].verified=true;},'RUN_JOB_ATTEMPT_RECORD_SHAPE_INVALID');
mutate(x=>{x.attempts[0].workflowFile='paper-oco-submit-canary.yml';},
 'RUN_JOB_SOURCE_TARGET_OR_DUPLICATE_INVALID');
mutate(x=>{x.attempts[0].sourceJobId='market-guard';},
 'RUN_JOB_SOURCE_TARGET_OR_DUPLICATE_INVALID');
mutate(x=>{x.attempts[1].workflowFile='dry-run.yml';},
 'RUN_JOB_SOURCE_TARGET_OR_DUPLICATE_INVALID');
mutate(x=>{x.attempts[0].run.repository='foreign/repo';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.workflowFile='.github/workflows/market-guard.yml';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.workflowFile='.github/workflows/dry-run.yml@dev';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.runId=0;},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.runAttempt=0;},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.runAttempt=1001;},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.runAttempt='1';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.headSha='f'.repeat(40);},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.ref='refs/heads/feature';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.event='pull_request';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[2].run.event='schedule';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.status='in_progress';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.conclusion='unknown';},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[0].run.extra=true;},
 'RUN_ID_SHA_REF_EVENT_OR_STATUS_INVALID');
mutate(x=>{x.attempts[1].run.runId=x.attempts[0].run.runId;},
 'REUSED_WORKFLOW_RUN_ID');
mutate(x=>{x.attempts[0].job.jobId=0;},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.runId=x.attempts[1].run.runId;},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.runAttempt=2;},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.headSha='f'.repeat(40);},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.name='an-unaudited-job';},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.sourceEnvironment='PAPER_CUSTODY_APPROVAL';},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.status='queued';},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.conclusion='other';},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[0].job.debug=true;},
 'JOB_ID_ATTEMPT_SHA_OR_ENVIRONMENT_INVALID');
mutate(x=>{x.attempts[1].job.jobId=x.attempts[0].job.jobId;},
 'REUSED_WORKFLOW_JOB_ID');
mutate(x=>{x.attempts[0].run.conclusion='success';
 x.attempts[0].job.conclusion='failure';},
 'REPORT_JOB_AND_WORKFLOW_OUTCOMES_CONFLICT');
mutate(x=>{x.attempts[2].job.conclusion='success';},
 'FAIL_CLOSED_ADMISSION_CANNOT_PROMOTE_LEDGER_JOB');
mutate(x=>{x.attempts[2].run.conclusion='success';},
 'FAIL_CLOSED_ADMISSION_CANNOT_PROMOTE_LEDGER_JOB');
mutate(x=>{x.attempts[2].job.conclusion='failure';},
 'FAIL_CLOSED_ADMISSION_CANNOT_PROMOTE_LEDGER_JOB');
mutate(x=>{x.attempts[0].observations.variableAtRun=PAPER;},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
mutate(x=>{x.attempts[0].observations.outboundHostAtRun=PAPER;},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
mutate(x=>{x.attempts[0].observations.brokerAccountBinding='broker-account-id';},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
mutate(x=>{x.attempts[0].observations.githubSourceProvenance='TRUSTED';},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
mutate(x=>{delete x.attempts[0].observations.variableAtRun;},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
mutate(x=>{x.attempts[0].observations.signer='attacker';},
 'RUN_TIME_OR_GITHUB_ATTESTATION_FORGED');
const h=held(fixture());assert.ok(!JSON.stringify(h).includes('ALPACA_BASE_URL'));
checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_VARIABLE_RUN_ATTEMPT_SCOPE_PASS',
 checks,sourceVariableDependentJobs:3,
 reportOnlyJobCandidates:2,protectedAdmissionBlockedLedgerJob:1,
 actualGitHubRequests:actualGithubRequests,brokerRequests:actualBrokerRequests,
 externalStateWrites:externalWrites,operationalAuthorityGranted:0,
}));
