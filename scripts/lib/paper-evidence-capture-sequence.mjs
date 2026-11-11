/**
 * STEP 5C-4D-3N — OFFLINE untrusted capture-sequence reconciliation.
 *
 * Compare two previously reviewed 3M evidence bundles for accidental reuse,
 * temporal rollback, context substitution and immutable-record drift.
 * The caller owns every input; comparison is NOT a trusted monotonic clock,
 * signed evidence, GitHub approval, external anti-replay or broker fencing.
 * No network, filesystem, clock read, secrets, broker or state mutations.
 */
import { inspectPaperEvidenceBundleContext } from './paper-evidence-bundle-context.mjs';

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).length === keys.length
  && keys.every(k => Object.hasOwn(x, k));
const ROOT_KEYS = ['schemaVersion','mode','previous','current'];
const CONTEXT_KEYS = ['repository','branch','environment','sha','runId',
  'jobId','deploymentId','attempt','workflowPath'];
const stable = snapshot => {
  if (!obj(snapshot)) return null;
  const r=snapshot.run, j=snapshot.job, d=snapshot.deployment;
  const approval=snapshot.approvals?.[0], status=snapshot.statuses?.[0];
  if (!obj(r)||!obj(j)||!obj(d)||!obj(approval)||!obj(status)) return null;
  return [
    r.created_at ?? null,r.run_started_at ?? null,
    j.started_at ?? null,j.completed_at ?? null,
    d.created_at ?? null,
    approval.user?.id ?? null,approval.user?.login ?? null,
    approval.created_at ?? null,
    status.deployment_id ?? null,status.created_at ?? null,
  ];
};
const report = (findings,hasPrior,compared,changed) => Object.freeze({
 schemaVersion:'paper-untrusted-capture-sequence-v1',
 status:findings.length?'DENY_CAPTURE_SEQUENCE_INVALID'
   :hasPrior?'HOLD_UNTRUSTED_CAPTURE_SEQUENCE':'HOLD_NO_EXTERNAL_REPLAY_HISTORY',
 findings:Object.freeze([...new Set(findings)].sort()),
 syntacticSequenceCompared:findings.length===0 && compared,
 selectedSnapshotChanged:findings.length===0 && compared && changed,
 proofGaps:Object.freeze([
  'CAPTURE_TIME_CALLER_CONTROLLED',
  'EXTERNAL_MONOTONIC_SEQUENCE_UNAVAILABLE',
  'INDEPENDENT_REPLAY_GUARD_UNAVAILABLE',
  'GITHUB_JOB_DEPLOYMENT_APPROVAL_UNPROVEN',
  'BROKER_ACCOUNT_WRITER_EXCLUSION_UNPROVEN',
 ]),
 githubOriginAuthenticated:false,
 captureTimeIndependentlyVerified:false,
 externalReplayProtectionEnforced:false,
 trustedMonotonicSequenceVerified:false,
 jobDeploymentApprovalVerified:false,
 brokerWriterExclusivityVerified:false,
 operationalEligible:false,
 stateMutationAuthorized:false,
 brokerSubmitAuthorized:false,
 liveTradingAuthorized:false,
});
/**
 * Reconciliation only; no persisted history is read or written.
 * An attacker can replay or replace *both* previous and current inputs.
 */
export function inspectPaperEvidenceCaptureSequence(input={}) {
 const x=obj(input)?input:{},findings=[];
 if(!exact(x,ROOT_KEYS)||x.schemaVersion!=='paper-untrusted-capture-sequence-v1'
   ||x.mode!=='OFFLINE_UNTRUSTED_COMPARISON')
   findings.push('SEQUENCE_ENVELOPE_INVALID');

 const current=x.current;
 const result=inspectPaperEvidenceBundleContext(current);
 if(result.status!=='HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT'
   ||result.selectedBundleContentMatched!==true
   ||result.operationalEligible!==false)
   findings.push('CURRENT_BUNDLE_INVALID');

 const hasPrior=x.previous!==null && x.previous!==undefined;
 let compared=false,changed=false;
 if(hasPrior){
   const priorResult=inspectPaperEvidenceBundleContext(x.previous);
   if(priorResult.status!=='HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT'
      ||priorResult.selectedBundleContentMatched!==true
      ||priorResult.operationalEligible!==false)
     findings.push('PREVIOUS_BUNDLE_INVALID');
   if(result.status==='HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT'
     &&priorResult.status==='HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT'){
     compared=true;
     const p=x.previous,c=current;
     if(!exact(p.requestContext,CONTEXT_KEYS)
       ||!exact(c.requestContext,CONTEXT_KEYS)
       ||CONTEXT_KEYS.some(k=>p.requestContext[k]!==c.requestContext[k]))
       findings.push('CROSS_CAPTURE_CONTEXT_MISMATCH');
     const t0=Date.parse(p.captureReceipt?.capturedAt);
     const t1=Date.parse(c.captureReceipt?.capturedAt);
     // Each individual 3M bundle already requires a canonical valid UTC time.
     if(!Number.isFinite(t0)||!Number.isFinite(t1)||t1<=t0)
       findings.push('CAPTURE_TIME_NOT_STRICTLY_INCREASING');
     if(p.bundle.bundleSha256===c.bundle.bundleSha256)
       findings.push('DUPLICATE_BUNDLE_REPLAY');
     const before=stable(p.snapshot),after=stable(c.snapshot);
     if(!before||!after||before.some((v,i)=>v!==after[i]))
       findings.push('IMMUTABLE_PROVIDER_RECORD_DRIFT');
     changed=p.bundle.snapshotSha256!==c.bundle.snapshotSha256;
   }
 }
 return report(findings,hasPrior,compared,changed);
}
