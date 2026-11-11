/**
 * STEP 5C-4D-3L: content-addressed OFFLINE snapshot integrity, NOT source
 * attestation. SHA-256 binds selected non-secret REST fields to the exact
 * synthetic capture receipt, never to a broker writer or GitHub approval.
 *
 * No filesystem, network, injected transport, secret, env or state access.
 */
import { createHash } from 'node:crypto';
import { inspectPaperDeploymentProvenanceGaps } from './paper-deployment-provenance-gaps.mjs';

const REPO='pungking/alpha-exec-engine';
const SHA64=/^[a-f0-9]{64}$/;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
  &&keys.every(k=>Object.hasOwn(x,k));
const COMMITMENT_FIELDS=['schemaVersion','repository','runId','jobId',
 'deploymentId','sourceSha','snapshotSha256','evidenceOrigin','signer','approvalClaim'];
const scalar=v=>{
 if(v===undefined||v===null)return null;
 if(typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number'&&Number.isSafeInteger(v))return v;
 throw Error('INVALID_SCALAR');
};
const sequence=values=>values.map(scalar);
/**
 * Digest only allowlisted *non-secret* fields. Never hash or return arbitrary
 * provider response bodies, token-bearing headers, or unknown extra keys.
 * Caller-controlled snapshots can be freely rehashed and forged; no signature.
 */
export function fingerprintPaperEvidenceSnapshot(snapshot){
 try{
  if(!obj(snapshot)||!obj(snapshot.expected)
   ||!obj(snapshot.run)||!obj(snapshot.job)||!obj(snapshot.deployment)
   ||!Array.isArray(snapshot.statuses)||snapshot.statuses.length!==1
   ||!Array.isArray(snapshot.approvals)||snapshot.approvals.length!==1)
   return null;
  const e=snapshot.expected,r=snapshot.run,j=snapshot.job,d=snapshot.deployment;
  const s=snapshot.statuses[0],a=snapshot.approvals[0];
  if(!obj(s)||!obj(a))return null;
  const projected=[
    sequence(['paper-github-selected-evidence-v1']),
    sequence([e.repository,e.environment,e.environmentId,e.branch,e.sha,
      e.runId,e.jobId,e.deploymentId,e.attempt,e.workflowPath]),
    sequence([r.id,r.run_attempt,r.head_sha,r.head_branch,r.event,r.path,
      r.repository?.full_name,r.head_repository?.full_name,r.created_at,r.run_started_at]),
    sequence([j.id,j.run_id,j.run_attempt,j.head_sha,j.name,j.status,j.conclusion,
      j.started_at,j.completed_at]),
    sequence([d.id,d.sha,d.ref,d.environment,d.task,d.creator?.login,d.created_at]),
    sequence([s.deployment_id,s.state,s.environment,s.created_at]),
    sequence([a.state,a.user?.login,a.user?.id,
      a.environments?.[0]?.id,a.environments?.[0]?.name,a.created_at]),
  ];
  const data=JSON.stringify(projected);
  if(Buffer.byteLength(data,'utf8')>32768)return null;
  return createHash('sha256').update('paper-github-snapshot-v1\n','utf8')
    .update(data,'utf8').digest('hex');
 }catch{return null;}
}
const report=(findings,timeline,matched)=>Object.freeze({
 schemaVersion:'paper-github-evidence-commitment-v1',
 status:findings.length?'DENY_SNAPSHOT_COMMITMENT_INVALID'
   :'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT',
 findings:Object.freeze([...new Set(findings)].sort()),
 proofGaps:Object.freeze([
  'ORIGIN_IDENTITY_NOT_CRYPTOGRAPHICALLY_ATTESTED',
  'JOB_DEPLOYMENT_APPROVAL_NOT_VERIFIED',
  'ACCOUNT_WRITER_FENCING_NOT_VERIFIED',
  'OUT_OF_BAND_REPLAY_NOT_EXCLUDED',
 ]),
 selectedContentDigestMatched:findings.length===0&&matched,
 timestampSnapshotValid:timeline,
 gitHubEvidenceOriginAuthenticated:false,
 trustedSignerVerified:false,
 signedSnapshotReceiptVerified:false,
 replayGuardExternallyEnforced:false,
 jobSpecificDeploymentApproved:false,
 brokerAccountWriterExclusivityVerified:false,
 operationalEligible:false,
 stateMutationAuthorized:false,
 brokerSubmitAuthorized:false,
 liveTradingAuthorized:false,
});
/** Synthetic/manually-supplied receipt check; never returns an authority flag. */
export function inspectPaperEvidenceSnapshotCommitment(input={}){
 const x=obj(input)?input:{},findings=[];
 const timeline=inspectPaperDeploymentProvenanceGaps({
  snapshot:x.snapshot,receipt:x.captureReceipt,
 });
 if(timeline.status!=='HOLD_UNAUTHENTICATED_JOB_DEPLOYMENT_PROVENANCE'
   ||timeline.snapshotShapesCorrelated!==true){
  findings.push('PRECONDITION_PROVENANCE_INVALID');
 }
 const expected=x.snapshot?.expected;
 const c=x.commitment;
 if(!exact(c,COMMITMENT_FIELDS)||c.schemaVersion!=='paper-github-evidence-commitment-v1'
   ||c.repository!==REPO||c.repository!==expected?.repository
   ||c.runId!==expected?.runId||c.jobId!==expected?.jobId
   ||c.deploymentId!==expected?.deploymentId||c.sourceSha!==expected?.sha
   ||c.evidenceOrigin!=='CALLER_SUPPLIED_UNVERIFIED'
   ||c.signer!=='NONE'||c.approvalClaim!=='NONE'
   ||!SHA64.test(c.snapshotSha256))
  findings.push('UNTRUSTED_RECEIPT_SHAPE_INVALID');
 const calculated=fingerprintPaperEvidenceSnapshot(x.snapshot);
 if(calculated===null||calculated!==c?.snapshotSha256)
  findings.push('SNAPSHOT_CONTENT_MISMATCH');
 return report(findings,timeline.status==='HOLD_UNAUTHENTICATED_JOB_DEPLOYMENT_PROVENANCE',
  calculated!==null&&calculated===c?.snapshotSha256);
}
