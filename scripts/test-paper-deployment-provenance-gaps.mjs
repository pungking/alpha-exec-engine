import assert from 'node:assert/strict';
import { inspectPaperDeploymentProvenanceGaps as inspect } from './lib/paper-deployment-provenance-gaps.mjs';
const SHA='a'.repeat(40);
const E={repository:'pungking/alpha-exec-engine',environment:'PAPER_CUSTODY_APPROVAL',
 environmentId:26847620868,branch:'main',sha:SHA,runId:'123456',
 jobId:'234567',deploymentId:'345678',attempt:1,
 workflowPath:'.github/workflows/paper-oco-submit-canary.yml'};
const snapshot=()=>({
 expected:{...E},
 run:{id:123456,run_attempt:1,head_sha:SHA,head_branch:'main',
  event:'workflow_dispatch',path:E.workflowPath,
  repository:{full_name:E.repository},head_repository:{full_name:E.repository},
  pull_requests:[],created_at:'2026-11-11T10:00:00Z',run_started_at:'2026-11-11T10:01:00Z'},
 job:{id:234567,run_id:123456,run_attempt:1,head_sha:SHA,
  name:'Protected PAPER approval - operational HOLD',status:'completed',
  conclusion:'failure',started_at:'2026-11-11T10:04:00Z',completed_at:'2026-11-11T10:05:00Z'},
 deployment:{id:345678,sha:SHA,ref:'main',environment:E.environment,
  task:'deploy',creator:{login:'github-actions[bot]'},
  created_at:'2026-11-11T10:02:00Z'},
 statuses:[{deployment_id:345678,state:'success',environment:E.environment,
  created_at:'2026-11-11T10:06:00Z'}],
 approvals:[{state:'approved',user:{login:'pungking',id:1},
  environments:[{id:26847620868,name:E.environment}],
  created_at:'2026-11-11T10:03:00Z'}],
});
const example=()=>({snapshot:snapshot(),receipt:{
 schemaVersion:'paper-github-provenance-receipt-v1',
 transportClass:'CALLER_SUPPLIED_UNVERIFIED',
 repository:E.repository,runId:E.runId,jobId:E.jobId,
 deploymentId:E.deploymentId,capturedAt:'2026-11-11T10:07:00Z',attestation:'NONE',
}});
let checks=0;
const safety=r=>{for(const k of ['proofOfApiOrigin','githubApprovalProvenanceAuthenticated',
 'approvalTiedToSpecificJobAttempt','deploymentTiedToSpecificJob',
 'environmentPolicyIndependentlyVerified','accountWideBrokerWriterFenced',
 'durableWriterClaimVerified','operationalEligible','stateMutationAuthorized',
 'brokerSubmitAuthorized','liveTradingAuthorized'])assert.equal(r[k],false,k);};
const held=(x,gap)=>{let r=inspect(x);assert.equal(r.status,
 'HOLD_UNAUTHENTICATED_JOB_DEPLOYMENT_PROVENANCE',JSON.stringify(r.failures));
 assert.deepEqual(r.failures,[]);assert.equal(r.snapshotShapesCorrelated,true);
 assert.ok(r.proofGaps.includes('EXACT_JOB_DEPLOYMENT_JOIN_UNPROVEN'));
 if(gap)assert.ok(r.proofGaps.includes(gap),JSON.stringify(r.proofGaps));
 safety(r);checks++;};
const deny=(x,reason)=>{let r=inspect(x);assert.equal(r.status,'DENY_PROVENANCE_SNAPSHOT_INVALID');
 assert.ok(r.failures.includes(reason),JSON.stringify(r.failures));safety(r);checks++;};
const change=(fn,reason)=>{let x=example();fn(x);deny(x,reason);};
held(example(),'DEPLOYMENT_SUCCESS_NOT_ATTRIBUTABLE_TO_FAILED_JOB');
deny(null,'REST_CORRELATION_INVALID');deny({},'REST_CORRELATION_INVALID');
change(x=>{x.snapshot.expected.sha='f'.repeat(40);},'REST_CORRELATION_INVALID');
change(x=>{x.snapshot.job.conclusion='success';},'REST_CORRELATION_INVALID');
change(x=>{x.snapshot.approvals=[];},'REST_CORRELATION_INVALID');
change(x=>{x.receipt.transportClass='VERIFIED';},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.receipt.attestation='SIGNED';},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.receipt.approvalVerified=true;},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.receipt.repository='other/repo';},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.receipt.jobId='234568';},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.receipt.capturedAt='not-a-time';},'CAPTURE_RECEIPT_INVALID');
change(x=>{x.snapshot.run.created_at='2026-11-11T10:02:00Z';},'RUN_CLOCK_ORDER_INVALID');
change(x=>{x.snapshot.run.run_started_at='2026-11-11T10:05:00Z';},'JOB_CLOCK_ORDER_INVALID');
change(x=>{x.snapshot.job.completed_at='2026-11-11T10:03:00Z';},'JOB_FINISH_ORDER_INVALID');
change(x=>{x.snapshot.deployment.created_at='2026-11-11T09:58:00Z';},'DEPLOYMENT_BEFORE_RUN');
change(x=>{x.snapshot.statuses[0].created_at='2026-11-11T09:59:00Z';},'DEPLOYMENT_STATUS_BEFORE_DEPLOYMENT');
change(x=>{x.snapshot.approvals[0].created_at='2026-11-11T09:59:00Z';},'APPROVAL_BEFORE_RUN');
change(x=>{x.snapshot.approvals[0].created_at='2026-11-11T10:06:00Z';},'APPROVAL_AFTER_JOB');
change(x=>{x.receipt.capturedAt='2026-11-11T10:04:00Z';},'CAPTURE_PRECEDES_EVIDENCE');
change(x=>{x.snapshot.job.started_at='yesterday';},'JOB_STARTED_TIME_INVALID');
change(x=>{x.snapshot.run.created_at='2026-11-11T10:00:00+00:00';},'RUN_CREATED_TIME_INVALID');
change(x=>{x.snapshot.run.created_at='2026-02-30T10:00:00Z';},'RUN_CREATED_TIME_INVALID');
change(x=>{x.snapshot.run.created_at='2026-11-11T24:00:00Z';},'RUN_CREATED_TIME_INVALID');
change(x=>{x.snapshot.run.created_at='2026-11-11T10:00:60Z';},'RUN_CREATED_TIME_INVALID');
change(x=>{x.snapshot.run.created_at='2026-11-11T10:00:00.9999Z';},'RUN_CREATED_TIME_INVALID');
change(x=>{x.receipt.capturedAt='2026-02-30T11:00:00Z';},'CAPTURE_RECEIPT_INVALID');
{const leap=example();leap.receipt.capturedAt='2028-02-29T00:00:00Z';held(leap);}
let missing=example();delete missing.snapshot.approvals[0].created_at;
held(missing,'RUN_APPROVAL_TIME_MISSING');
missing=example();delete missing.snapshot.job.started_at;
held(missing,'JOB_STARTED_TIME_MISSING');
assert.ok(!JSON.stringify(inspect(example())).includes('synthetic-test-only-github-token'));
checks++;
console.log(JSON.stringify({status:'OFFLINE_PAPER_DEPLOYMENT_PROVENANCE_GAPS_PASS',
 checks,externalGithubRequests:0,brokerRequests:0,stateMutations:0,
 operationalAuthorityGranted:0}));
