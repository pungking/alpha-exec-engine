import assert from 'node:assert/strict';
import {fingerprintPaperEvidenceSnapshot as fingerprint,
 inspectPaperEvidenceSnapshotCommitment as inspect} from './lib/paper-evidence-snapshot-commitment.mjs';
const SHA='a'.repeat(40),REPO='pungking/alpha-exec-engine',ENV='PAPER_CUSTODY_APPROVAL';
const expected={repository:REPO,environment:ENV,environmentId:26847620868,
 branch:'main',sha:SHA,runId:'123456',jobId:'234567',deploymentId:'345678',
 attempt:1,workflowPath:'.github/workflows/paper-oco-submit-canary.yml'};
const makeSnapshot=()=>({
 expected:{...expected},
 run:{id:123456,run_attempt:1,head_sha:SHA,head_branch:'main',
  event:'workflow_dispatch',path:expected.workflowPath,
  repository:{full_name:REPO},head_repository:{full_name:REPO},
  pull_requests:[],created_at:'2026-11-11T10:00:00Z',
  run_started_at:'2026-11-11T10:01:00Z'},
 job:{id:234567,run_id:123456,run_attempt:1,head_sha:SHA,
  name:'Protected PAPER approval - operational HOLD',status:'completed',conclusion:'failure',
  started_at:'2026-11-11T10:04:00Z',completed_at:'2026-11-11T10:05:00Z'},
 deployment:{id:345678,sha:SHA,ref:'main',environment:ENV,task:'deploy',
  creator:{login:'github-actions[bot]'},created_at:'2026-11-11T10:02:00Z'},
 statuses:[{deployment_id:345678,state:'success',environment:ENV,
  created_at:'2026-11-11T10:06:00Z'}],
 approvals:[{state:'approved',user:{login:'pungking',id:1},
  environments:[{id:26847620868,name:ENV}],created_at:'2026-11-11T10:03:00Z'}],
});
const fixture=()=>{
 const snapshot=makeSnapshot();
 return {snapshot,
  captureReceipt:{schemaVersion:'paper-github-provenance-receipt-v1',
   transportClass:'CALLER_SUPPLIED_UNVERIFIED',repository:REPO,
   runId:expected.runId,jobId:expected.jobId,deploymentId:expected.deploymentId,
   capturedAt:'2026-11-11T10:07:00Z',attestation:'NONE'},
  commitment:{schemaVersion:'paper-github-evidence-commitment-v1',
   repository:REPO,runId:expected.runId,jobId:expected.jobId,
   deploymentId:expected.deploymentId,sourceSha:SHA,
   snapshotSha256:fingerprint(snapshot),evidenceOrigin:'CALLER_SUPPLIED_UNVERIFIED',
   signer:'NONE',approvalClaim:'NONE'},
 };
};
let checks=0;
const safety=x=>{for(const k of ['gitHubEvidenceOriginAuthenticated',
 'trustedSignerVerified','signedSnapshotReceiptVerified','replayGuardExternallyEnforced',
 'jobSpecificDeploymentApproved','brokerAccountWriterExclusivityVerified',
 'operationalEligible','stateMutationAuthorized','brokerSubmitAuthorized','liveTradingAuthorized'])
 assert.equal(x[k],false,k);};
const held=x=>{
 const r=inspect(x);assert.equal(r.status,'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT',
 JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);
 assert.equal(r.selectedContentDigestMatched,true);
 assert.equal(r.timestampSnapshotValid,true);
 assert.ok(r.proofGaps.includes('JOB_DEPLOYMENT_APPROVAL_NOT_VERIFIED'));
 safety(r);checks++;
};
const deny=(x,reason)=>{
 const r=inspect(x);assert.equal(r.status,'DENY_SNAPSHOT_COMMITMENT_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));safety(r);checks++;
};
const mutate=(fn,reason)=>{const x=fixture();fn(x);deny(x,reason);};
held(fixture());
deny(null,'PRECONDITION_PROVENANCE_INVALID');
deny({},'PRECONDITION_PROVENANCE_INVALID');
mutate(x=>{x.commitment.snapshotSha256='f'.repeat(64);},'SNAPSHOT_CONTENT_MISMATCH');
mutate(x=>{x.commitment.snapshotSha256='invalid';},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.signer='github-actions[bot]';},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.evidenceOrigin='VERIFIED';},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.approvalClaim='YES';},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.operationalEligible=true;},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.runId='234567';},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.commitment.sourceSha='f'.repeat(40);},'UNTRUSTED_RECEIPT_SHAPE_INVALID');
mutate(x=>{x.captureReceipt.attestation='SIGNED';},'PRECONDITION_PROVENANCE_INVALID');
mutate(x=>{x.snapshot.run.run_started_at='2026-11-11T10:01:30Z';},'SNAPSHOT_CONTENT_MISMATCH');
mutate(x=>{x.snapshot.job.completed_at='2026-11-11T10:04:30Z';},'SNAPSHOT_CONTENT_MISMATCH');
mutate(x=>{x.snapshot.approvals[0].user.id=7;},'SNAPSHOT_CONTENT_MISMATCH');
mutate(x=>{x.snapshot.statuses[0].created_at='2026-11-11T10:06:30Z';},'SNAPSHOT_CONTENT_MISMATCH');
mutate(x=>{x.snapshot.run.created_at='2026-02-30T10:00:00Z';},'PRECONDITION_PROVENANCE_INVALID');
mutate(x=>{x.snapshot.job.id=876543;},'PRECONDITION_PROVENANCE_INVALID');
mutate(x=>{x.snapshot.statuses=[];},'PRECONDITION_PROVENANCE_INVALID');
mutate(x=>{x.snapshot.run.created_at=23;},'PRECONDITION_PROVENANCE_INVALID');
const forged=fixture();forged.snapshot.approvals[0].user.id=999;
forged.commitment.snapshotSha256=fingerprint(forged.snapshot);
// A forged caller who also recomputes the digest still gets HOLD, never authorization.
held(forged);
const withSecret=fixture();withSecret.snapshot.run.apiToken='PRIVATE_FIXTURE_DO_NOT_PRINT';
assert.equal(fingerprint(withSecret.snapshot),withSecret.commitment.snapshotSha256);
held(withSecret);
assert.ok(!JSON.stringify(inspect(withSecret)).includes('PRIVATE_FIXTURE_DO_NOT_PRINT'));checks++;
assert.equal(fingerprint(null),null);checks++;
const altered=fixture();altered.snapshot.expected.runId='123457';
altered.snapshot.run.id=123457;altered.snapshot.job.run_id=123457;
altered.captureReceipt.runId='123457';altered.commitment.runId='123457';
deny(altered,'SNAPSHOT_CONTENT_MISMATCH');
console.log(JSON.stringify({status:'OFFLINE_PAPER_EVIDENCE_SNAPSHOT_COMMITMENT_PASS',
 checks,realGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0}));
