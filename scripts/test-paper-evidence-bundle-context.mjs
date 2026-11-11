import assert from 'node:assert/strict';
import {
 fingerprintPaperCaptureReceipt as receiptHash,
 fingerprintPaperEvidenceBundle as bundleHash,
 inspectPaperEvidenceBundleContext as inspect,
} from './lib/paper-evidence-bundle-context.mjs';
import { fingerprintPaperEvidenceSnapshot as snapshotHash,
 inspectPaperEvidenceSnapshotCommitment as inspect3L } from './lib/paper-evidence-snapshot-commitment.mjs';

const REPO='pungking/alpha-exec-engine',ENV='PAPER_CUSTODY_APPROVAL',SHA='a'.repeat(40);
const expected={repository:REPO,environment:ENV,environmentId:26847620868,
 branch:'main',sha:SHA,runId:'123456',jobId:'234567',deploymentId:'345678',
 attempt:1,workflowPath:'.github/workflows/paper-oco-submit-canary.yml'};
const createSnapshot=()=>({
 expected:{...expected},
 run:{id:123456,run_attempt:1,head_sha:SHA,head_branch:'main',event:'workflow_dispatch',
  path:expected.workflowPath,repository:{full_name:REPO},
  head_repository:{full_name:REPO},pull_requests:[],
  created_at:'2026-11-11T10:00:00Z',run_started_at:'2026-11-11T10:01:00Z'},
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
const requestContext=e=>({
 repository:e.repository,branch:e.branch,environment:e.environment,sha:e.sha,
 runId:e.runId,jobId:e.jobId,deploymentId:e.deploymentId,
 attempt:e.attempt,workflowPath:e.workflowPath,
});
function sample() {
 const snapshot=createSnapshot();
 const captureReceipt={schemaVersion:'paper-github-provenance-receipt-v1',
  transportClass:'CALLER_SUPPLIED_UNVERIFIED',
  repository:REPO,runId:expected.runId,jobId:expected.jobId,
  deploymentId:expected.deploymentId,
  capturedAt:'2026-11-11T10:07:00Z',attestation:'NONE'};
 const commitment={
  schemaVersion:'paper-github-evidence-commitment-v1',
  repository:REPO,runId:expected.runId,jobId:expected.jobId,
  deploymentId:expected.deploymentId,sourceSha:SHA,
  snapshotSha256:snapshotHash(snapshot),
  evidenceOrigin:'CALLER_SUPPLIED_UNVERIFIED',signer:'NONE',approvalClaim:'NONE',
 };
 const input={snapshot,captureReceipt,commitment,requestContext:requestContext(expected)};
 input.bundle={schemaVersion:'paper-selected-evidence-bundle-context-v1',
  repository:REPO,runId:expected.runId,jobId:expected.jobId,
  deploymentId:expected.deploymentId,sourceSha:SHA,
  snapshotSha256:snapshotHash(snapshot),
  captureReceiptSha256:receiptHash(captureReceipt),
  bundleSha256:bundleHash(input),
  evidenceOrigin:'CALLER_SUPPLIED_UNVERIFIED',signer:'NONE',
  approvalClaim:'NONE',replayProtection:'UNPROVEN'};
 return input;
}
let checks=0;
const safe=r=>{
 for(const k of ['trustedApiOriginVerified','timestampAttested',
  'jobDeploymentApprovalVerified','outOfBandReplayRejected',
  'brokerWriterExclusivityVerified','operationalEligible',
  'stateMutationAuthorized','brokerSubmitAuthorized','liveTradingAuthorized'])
  assert.equal(r[k],false,k);
};
const held=x=>{
 const r=inspect(x);assert.equal(r.status,'HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT',
  JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);
 assert.equal(r.selectedBundleContentMatched,true);
 assert.ok(r.proofGaps.includes('BUNDLE_REPLAY_PROTECTION_NOT_ENFORCED'));
 safe(r);checks++;
};
const deny=(x,reason)=>{
 const r=inspect(x);assert.equal(r.status,'DENY_UNTRUSTED_BUNDLE_CONTEXT_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.selectedBundleContentMatched,false);safe(r);checks++;
};
const change=(fn,reason)=>{let x=sample();fn(x);deny(x,reason);};
held(sample());
deny(null,'PRIOR_COMMITMENT_PRECONDITION_INVALID');
deny({},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.requestContext.jobId='999999';},'REQUEST_CONTEXT_MISMATCH');
change(x=>{x.requestContext.sha='f'.repeat(40);},'REQUEST_CONTEXT_MISMATCH');
change(x=>{x.requestContext.workflowPath='unreviewed.yml';},'REQUEST_CONTEXT_MISMATCH');
change(x=>{x.requestContext.environment='OTHER';},'REQUEST_CONTEXT_MISMATCH');
change(x=>{x.requestContext.authorized=true;},'REQUEST_CONTEXT_MISMATCH');
change(x=>{delete x.requestContext;},'REQUEST_CONTEXT_MISMATCH');
change(x=>{x.bundle.signer='github-actions[bot]';},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.evidenceOrigin='TRUSTED_GITHUB';},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.approvalClaim='APPROVED';},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.replayProtection='ENFORCED';},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.operationalEligible=true;},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.captureReceiptSha256='f'.repeat(64);},'CAPTURE_RECEIPT_DIGEST_MISMATCH');
change(x=>{x.bundle.snapshotSha256='f'.repeat(64);},'SELECTED_SNAPSHOT_DIGEST_MISMATCH');
change(x=>{x.bundle.bundleSha256='f'.repeat(64);},'REQUEST_BOUND_BUNDLE_DIGEST_MISMATCH');
change(x=>{x.bundle.runId='123457';},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.bundle.sourceSha='f'.repeat(40);},'BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');
change(x=>{x.captureReceipt.capturedAt='2026-11-11T10:08:00Z';},'CAPTURE_RECEIPT_DIGEST_MISMATCH');
change(x=>{x.captureReceipt.attestation='SIGNED';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.captureReceipt.jobId='234568';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.captureReceipt.capturedAt='2026-02-30T10:08:00Z';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.captureReceipt.token='synthetic-secret';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.commitment.snapshotSha256='f'.repeat(64);},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.snapshot.approvals[0].user.id=2;},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.snapshot.job.conclusion='success';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.snapshot.run.run_attempt=2;},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
change(x=>{x.snapshot.expected.runId='987654';},'PRIOR_COMMITMENT_PRECONDITION_INVALID');
const a=sample();assert.equal(inspect3L({snapshot:a.snapshot,captureReceipt:a.captureReceipt,
 commitment:a.commitment}).status,'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT');
a.captureReceipt.capturedAt='2026-11-11T10:08:00Z';
// The earlier 3L selected-only digest still matches; 3M detects the receipt drift.
assert.equal(inspect3L({snapshot:a.snapshot,captureReceipt:a.captureReceipt,
 commitment:a.commitment}).status,'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT');
deny(a,'CAPTURE_RECEIPT_DIGEST_MISMATCH');
const replay=sample();replay.captureReceipt.capturedAt='2026-11-11T10:08:00Z';
replay.bundle.captureReceiptSha256=receiptHash(replay.captureReceipt);
replay.bundle.bundleSha256=bundleHash(replay);
// A malicious party who recomputes both digests is never promoted.
held(replay);
const forged=sample();forged.snapshot.approvals[0].user.id=987;
forged.commitment.snapshotSha256=snapshotHash(forged.snapshot);
forged.bundle.snapshotSha256=snapshotHash(forged.snapshot);
forged.bundle.bundleSha256=bundleHash(forged);
held(forged);
const secret=sample();secret.snapshot.run.privateBearer='SYNTHETIC_DO_NOT_LOG';
assert.equal(bundleHash(secret),secret.bundle.bundleSha256);
held(secret);
assert.ok(!JSON.stringify(inspect(secret)).includes('SYNTHETIC_DO_NOT_LOG'));checks++;
assert.equal(receiptHash(null),null);checks++;
assert.equal(bundleHash({}),null);checks++;
console.log(JSON.stringify({status:'OFFLINE_PAPER_EVIDENCE_BUNDLE_CONTEXT_PASS',
 checks,actualGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0}));
