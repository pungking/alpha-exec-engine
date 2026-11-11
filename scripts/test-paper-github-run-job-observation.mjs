import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAPER_PROTECTED_WRITER_TOPOLOGY as TARGETS } from './lib/paper-protected-writer-topology.mjs';
import { inspectPaperGithubRunJobObservation as inspect } from './lib/paper-github-run-job-observation.mjs';

const REPO='pungking/alpha-exec-engine';
const REVIEWED='746901741a4a484763ef785e2b66244b9e584b1c';
const HISTORICAL='2849c9c151fcc8192f14231209ecb02fa419ff8d';
const ADMISSION='Protected PAPER approval - operational HOLD';
const baseline=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const sources=Object.fromEntries(TARGETS.map(t=>[t.file,
 fs.readFileSync('.github/workflows/'+t.file,'utf8')]));
function sample({file='paper-oco-submit-canary.yml',sha=REVIEWED,
 runId=123456,conclusion='failure',admission=true,writer=true,
 admissionConclusion='failure',writerConclusion='skipped'}={}){
 const target=TARGETS.find(t=>t.file===file);
 if(!target)throw Error('BAD_FIXTURE_FILE');
 const jobs=[];
 const make=(id,name,c)=>({id,run_id:runId,run_attempt:1,head_sha:sha,
  name,status:'completed',conclusion:c});
 if(admission)jobs.push(make(234567,ADMISSION,admissionConclusion));
 if(writer)jobs.push(make(345678,target.writer,writerConclusion));
 return {
  schemaVersion:'paper-github-run-job-observation-v1',
  reviewedSourceSha:REVIEWED,
  baseline:structuredClone(baseline),workflowSources:{...sources},
  expected:{repository:REPO,workflowFile:file,runId:String(runId),runAttempt:1},
  run:{id:runId,run_attempt:1,head_sha:sha,head_branch:'main',
   event:'workflow_dispatch',path:'.github/workflows/'+file,
   status:'completed',conclusion,
   repository:{full_name:REPO},head_repository:{full_name:REPO}},
  jobs,
 };
}
let checks=0;
const authority=r=>{
 for(const k of ['observedRunProvenanceVerified','protectedEnvironmentPolicyVerified',
  'exactJobDeploymentApprovalVerified','brokerAccountWriterFenced',
  'operationAuthorized','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])assert.equal(r[k],false,k);
 assert.ok(r.proofGaps.includes('JOB_DEPLOYMENT_JOIN_NOT_VERIFIED'));
};
function held(x,which,extra){
 const r=inspect(x);
 assert.equal(r.status,which,JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceTopologyConsistent,true);
 if(extra)assert.ok(r.proofGaps.includes(extra),JSON.stringify(r.proofGaps));
 authority(r);checks++;return r;
}
function denied(x,reason){
 const r=inspect(x);
 assert.equal(r.status,'DENY_GITHUB_RUN_JOB_OBSERVATION_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.sourceTopologyConsistent,false);
 authority(r);checks++;
}
const change=(fn,reason)=>{
 const x=sample();fn(x);denied(x,reason);
};
for(const t of TARGETS) held(sample({file:t.file}),
 'HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION');
held(sample({writer:false}), 'HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION',
 'MUTATION_JOB_RESULT_MISSING');
held(sample({admission:false}), 'HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION',
 'ADMISSION_JOB_RESULT_MISSING');
held(sample({file:'paper-five-row-active-limited-state-recovery.yml',
 sha:HISTORICAL,runId:32877521120,admission:false,writer:true,
 writerConclusion:'success',conclusion:'success'}),
 'HOLD_HISTORICAL_SOURCE_NOT_CURRENT_AUTHORITY',
 'OBSERVED_RUN_DIFFERENT_FROM_REVIEWED_CURRENT_SOURCE');
denied(null,'OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
denied({},'OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
change(x=>{x.schemaVersion='READY';},'OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
change(x=>{x.operationAuthorized=true;},'OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
change(x=>{x.reviewedSourceSha='f'.repeat(40);},'OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
change(x=>{x.expected.runId='1';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.expected.runAttempt=2;},'REQUESTED_RUN_BOUNDARY_INVALID');
change(x=>{x.expected.workflowFile='unknown.yml';},'REQUESTED_RUN_BOUNDARY_INVALID');
change(x=>{x.expected.repository='untrusted/repo';},'REQUESTED_RUN_BOUNDARY_INVALID');
change(x=>{x.run.event='pull_request';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.run.head_branch='paper-state';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.run.path='other.yml';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.run.status='in_progress';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.run.head_sha='x';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.run.repository.full_name='other/repo';},'RUN_IDENTITY_OR_COMPLETION_INVALID');
change(x=>{x.jobs[0].run_id=999;},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[0].run_attempt=2;},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[0].head_sha='f'.repeat(40);},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[1].name='unlisted-writer';},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[0].status='queued';},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs.push({...x.jobs[1],id:456789});},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[1].id=x.jobs[0].id;},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs=[];},'JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
change(x=>{x.jobs[0].conclusion='success';},'IMPOSSIBLE_SUCCESSFUL_FAIL_CLOSED_ADMISSION');
change(x=>{x.jobs[1].conclusion='success';},'UNEXPECTED_MUTATION_JOB_EXECUTION_UNDER_HOLD_SOURCE');
change(x=>{x.jobs[1].conclusion='failure';},'UNEXPECTED_MUTATION_JOB_EXECUTION_UNDER_HOLD_SOURCE');
change(x=>{x.run.conclusion='success';},'UNEXPECTED_SUCCESSFUL_WORKFLOW_UNDER_HOLD_SOURCE');
change(x=>{x.baseline.operationalHold=false;},'REVIEWED_SOURCE_TOPOLOGY_INVALID');
change(x=>{x.workflowSources[TARGETS[0].file]+='\n# source drift';},
 'REVIEWED_SOURCE_TOPOLOGY_INVALID'); // this is YAML comment only; canonical hash ignores comment
const secrets=sample();secrets.jobs[0].privateToken='DO_NOT_PRINT';
const output=held(secrets,'HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION');
assert.ok(!JSON.stringify(output).includes('DO_NOT_PRINT'));checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_GITHUB_RUN_JOB_OBSERVATION_PASS',
 checks,sourcePinnedSha:REVIEWED,
 observedGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0,
}));
