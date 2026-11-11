import assert from 'node:assert/strict';
import {
 inspectPaperEvidenceCaptureSequence as inspect,
} from './lib/paper-evidence-capture-sequence.mjs';
import {
 fingerprintPaperCaptureReceipt as receiptHash,
 fingerprintPaperEvidenceBundle as bundleHash,
} from './lib/paper-evidence-bundle-context.mjs';
import {
 fingerprintPaperEvidenceSnapshot as snapshotHash,
} from './lib/paper-evidence-snapshot-commitment.mjs';
const REPO='pungking/alpha-exec-engine',ENV='PAPER_CUSTODY_APPROVAL',SHA='a'.repeat(40);
function evidence({sourceSha=SHA,capture='2026-11-11T10:07:00Z',reviewerId=1}={}) {
 const e={repository:REPO,environment:ENV,environmentId:26847620868,branch:'main',
  sha:sourceSha,runId:'123456',jobId:'234567',deploymentId:'345678',attempt:1,
  workflowPath:'.github/workflows/paper-oco-submit-canary.yml'};
 const snapshot={
 expected:e,
 run:{id:123456,run_attempt:1,head_sha:sourceSha,head_branch:'main',
   event:'workflow_dispatch',path:e.workflowPath,repository:{full_name:REPO},
   head_repository:{full_name:REPO},pull_requests:[],
   created_at:'2026-11-11T10:00:00Z',run_started_at:'2026-11-11T10:01:00Z'},
 job:{id:234567,run_id:123456,run_attempt:1,head_sha:sourceSha,
   name:'Protected PAPER approval - operational HOLD',status:'completed',
   conclusion:'failure',started_at:'2026-11-11T10:04:00Z',
   completed_at:'2026-11-11T10:05:00Z'},
 deployment:{id:345678,sha:sourceSha,ref:'main',environment:ENV,
   task:'deploy',creator:{login:'github-actions[bot]'},
   created_at:'2026-11-11T10:02:00Z'},
 statuses:[{deployment_id:345678,state:'success',environment:ENV,
   created_at:'2026-11-11T10:06:00Z'}],
 approvals:[{state:'approved',user:{login:'pungking',id:reviewerId},
   environments:[{id:26847620868,name:ENV}],
   created_at:'2026-11-11T10:03:00Z'}],
 };
 const captureReceipt={
  schemaVersion:'paper-github-provenance-receipt-v1',
  transportClass:'CALLER_SUPPLIED_UNVERIFIED',repository:REPO,
  runId:e.runId,jobId:e.jobId,deploymentId:e.deploymentId,
  capturedAt:capture,attestation:'NONE',
 };
 const commitment={schemaVersion:'paper-github-evidence-commitment-v1',
  repository:REPO,runId:e.runId,jobId:e.jobId,
  deploymentId:e.deploymentId,sourceSha:e.sha,
  snapshotSha256:snapshotHash(snapshot),
  evidenceOrigin:'CALLER_SUPPLIED_UNVERIFIED',signer:'NONE',
  approvalClaim:'NONE',
 };
 const requestContext={repository:REPO,branch:e.branch,environment:ENV,sha:e.sha,
  runId:e.runId,jobId:e.jobId,deploymentId:e.deploymentId,
  attempt:1,workflowPath:e.workflowPath};
 const x={snapshot,captureReceipt,commitment,requestContext};
 x.bundle={schemaVersion:'paper-selected-evidence-bundle-context-v1',
  repository:REPO,runId:e.runId,jobId:e.jobId,
  deploymentId:e.deploymentId,sourceSha:e.sha,
  snapshotSha256:commitment.snapshotSha256,
  captureReceiptSha256:receiptHash(captureReceipt),
  bundleSha256:bundleHash(x),
  evidenceOrigin:'CALLER_SUPPLIED_UNVERIFIED',signer:'NONE',
  approvalClaim:'NONE',replayProtection:'UNPROVEN',
 };
 return x;
}
const sequence=({prev=evidence(),next=evidence({capture:'2026-11-11T10:08:00Z'})}={})=>({
 schemaVersion:'paper-untrusted-capture-sequence-v1',
 mode:'OFFLINE_UNTRUSTED_COMPARISON',
 previous:prev,
 current:next,
});
let checks=0;
const safe=r=>{
 for(const field of ['githubOriginAuthenticated','captureTimeIndependentlyVerified',
  'externalReplayProtectionEnforced','trustedMonotonicSequenceVerified',
  'jobDeploymentApprovalVerified','brokerWriterExclusivityVerified',
  'operationalEligible','stateMutationAuthorized','brokerSubmitAuthorized',
  'liveTradingAuthorized'])assert.equal(r[field],false,field);
};
const held=(s,status='HOLD_UNTRUSTED_CAPTURE_SEQUENCE')=>{
 const r=inspect(s);assert.equal(r.status,status,JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.ok(r.proofGaps.includes('EXTERNAL_MONOTONIC_SEQUENCE_UNAVAILABLE'));
 safe(r);checks++;
 return r;
};
const denied=(s,reason)=>{
 const r=inspect(s);assert.equal(r.status,'DENY_CAPTURE_SEQUENCE_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.syntacticSequenceCompared,false);safe(r);checks++;
};
const mutate=(fn,reason)=>{const x=sequence();fn(x);denied(x,reason);};
let r=held(sequence());assert.equal(r.syntacticSequenceCompared,true);
assert.equal(r.selectedSnapshotChanged,false);
r=held(sequence({prev:null}),'HOLD_NO_EXTERNAL_REPLAY_HISTORY');
assert.equal(r.syntacticSequenceCompared,false);
denied({},'SEQUENCE_ENVELOPE_INVALID');
denied(null,'SEQUENCE_ENVELOPE_INVALID');
mutate(x=>{x.mode='TRUSTED';},'SEQUENCE_ENVELOPE_INVALID');
mutate(x=>{x.operationalEligible=true;},'SEQUENCE_ENVELOPE_INVALID');
mutate(x=>{delete x.previous;},'SEQUENCE_ENVELOPE_INVALID');
mutate(x=>{x.current.bundle.signer='github-actions[bot]';},'CURRENT_BUNDLE_INVALID');
mutate(x=>{x.current.bundle.bundleSha256='f'.repeat(64);},'CURRENT_BUNDLE_INVALID');
mutate(x=>{x.previous.bundle.approvalClaim='APPROVED';},'PREVIOUS_BUNDLE_INVALID');
mutate(x=>{x.previous.commitment.snapshotSha256='f'.repeat(64);},'PREVIOUS_BUNDLE_INVALID');
mutate(x=>{x.current=x.previous;},'CAPTURE_TIME_NOT_STRICTLY_INCREASING');
mutate(x=>{x.current=evidence({capture:'2026-11-11T10:05:30Z'});},'CURRENT_BUNDLE_INVALID');
mutate(x=>{x.current=evidence({capture:'2026-11-11T10:07:00Z'});},'CAPTURE_TIME_NOT_STRICTLY_INCREASING');
mutate(x=>{x.current=evidence({capture:'2026-11-11T10:07:00Z'});},'DUPLICATE_BUNDLE_REPLAY');
mutate(x=>{x.current=evidence({capture:'2026-11-11T10:06:59Z'});},'CAPTURE_TIME_NOT_STRICTLY_INCREASING');
mutate(x=>{x.current=evidence({sourceSha:'f'.repeat(40),capture:'2026-11-11T10:08:00Z'});},'CROSS_CAPTURE_CONTEXT_MISMATCH');
mutate(x=>{x.current=evidence({reviewerId:7,capture:'2026-11-11T10:08:00Z'});},'IMMUTABLE_PROVIDER_RECORD_DRIFT');
mutate(x=>{x.current.snapshot.run.created_at='2026-11-11T10:00:30Z';
  x.current.commitment.snapshotSha256=snapshotHash(x.current.snapshot);
  x.current.bundle.snapshotSha256=snapshotHash(x.current.snapshot);
  x.current.bundle.bundleSha256=bundleHash(x.current);},
 'IMMUTABLE_PROVIDER_RECORD_DRIFT');
mutate(x=>{x.previous.captureReceipt.capturedAt='2026-02-30T10:07:00Z';},
 'PREVIOUS_BUNDLE_INVALID');
// A complete attacker-recomputed pair can still satisfy syntactic comparison,
// and therefore MUST remain HOLD, never an authenticated replay defense.
const forged=sequence({
 prev:evidence({sourceSha:'f'.repeat(40),capture:'2026-11-11T10:07:00Z'}),
 next:evidence({sourceSha:'f'.repeat(40),capture:'2026-11-11T10:08:00Z'}),
});
held(forged);
const secret=sequence();secret.current.snapshot.run.apiToken='SYNTHETIC_SECRET_NOT_FOR_OUTPUT';
const result=held(secret);
assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_NOT_FOR_OUTPUT'));checks++;
console.log(JSON.stringify({status:'OFFLINE_PAPER_EVIDENCE_CAPTURE_SEQUENCE_PASS',
 checks,actualGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0}));
