/**
 * STEP 5C-4D-3K — OFFLINE evidence provenance/time consistency and
 * independently unresolved GitHub job-to-deployment proof gap.
 *
 * This is a triage of caller-supplied REST snapshots. GitHub REST records,
 * timestamps, digests and any injected HTTP transport do NOT constitute an
 * authenticated statement that a particular protected job was approved.
 * No network, filesystem, broker, credential or state access.
 */
import { inspectPaperDeploymentRestCorrelation } from './paper-deployment-rest-correlation.mjs';

const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
  && keys.every(k=>Object.hasOwn(x,k));
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const millis=x=>typeof x==='string'&&ISO.test(x)&&Number.isFinite(Date.parse(x))
  ?Date.parse(x):null;
const report=(failures,gaps,correlated)=>Object.freeze({
 schemaVersion:'paper-github-provenance-gaps-v1',
 status:failures.length?'DENY_PROVENANCE_SNAPSHOT_INVALID':'HOLD_UNAUTHENTICATED_JOB_DEPLOYMENT_PROVENANCE',
 failures:Object.freeze([...new Set(failures)].sort()),
 proofGaps:Object.freeze([...new Set(gaps)].sort()),
 snapshotShapesCorrelated:!failures.length&&correlated,
 proofOfApiOrigin:false,
 githubApprovalProvenanceAuthenticated:false,
 approvalTiedToSpecificJobAttempt:false,
 deploymentTiedToSpecificJob:false,
 environmentPolicyIndependentlyVerified:false,
 accountWideBrokerWriterFenced:false,
 durableWriterClaimVerified:false,
 operationalEligible:false,
 stateMutationAuthorized:false,
 brokerSubmitAuthorized:false,
 liveTradingAuthorized:false,
});
/** Syntactic (not trusted) capture-receipt boundary. */
function validReceipt(receipt,expected){
 return exact(receipt,['schemaVersion','transportClass','repository',
  'runId','jobId','deploymentId','capturedAt','attestation'])
 && receipt.schemaVersion==='paper-github-provenance-receipt-v1'
 && receipt.transportClass==='CALLER_SUPPLIED_UNVERIFIED'
 && receipt.repository==='pungking/alpha-exec-engine'
 && receipt.runId===expected?.runId && receipt.jobId===expected?.jobId
 && receipt.deploymentId===expected?.deploymentId
 && receipt.attestation==='NONE'
 && millis(receipt.capturedAt)!==null;
}
function time(failures,gaps,obj,field,label){
 const value=obj?.[field];
 if(value==null){gaps.push(label+'_TIME_MISSING');return null;}
 const n=millis(value);
 if(n===null)failures.push(label+'_TIME_INVALID');
 return n;
}
export function inspectPaperDeploymentProvenanceGaps(input={}){
 const x=obj(input)?input:{},errors=[],gaps=[
   'TRUSTED_API_TRANSPORT_ORIGIN_UNATTESTED',
   'EXACT_JOB_DEPLOYMENT_JOIN_UNPROVEN',
   'GITHUB_ENVIRONMENT_PROTECTION_UNATTESTED',
   'RUN_REVIEW_DOES_NOT_BIND_JOB_DEPLOYMENT',
   'EXTERNAL_BROKER_WRITER_EXCLUSION_UNPROVEN',
 ];
 const correlated=inspectPaperDeploymentRestCorrelation(x.snapshot);
 if(correlated.status!=='HOLD_UNATTESTED_GITHUB_REST_CORRELATION'
   ||correlated.restShapesCorrelated!==true
   ||correlated.authenticatedJobToDeploymentBinding!==false
   ||correlated.operationalEligible!==false){
   errors.push('REST_CORRELATION_INVALID');
   return report(errors,gaps,false);
 }
 const s=x.snapshot,e=s.expected;
 if(!validReceipt(x.receipt,e))errors.push('CAPTURE_RECEIPT_INVALID');
 const runCreated=time(errors,gaps,s.run,'created_at','RUN_CREATED');
 const runStarted=time(errors,gaps,s.run,'run_started_at','RUN_STARTED');
 const jobStarted=time(errors,gaps,s.job,'started_at','JOB_STARTED');
 const jobCompleted=time(errors,gaps,s.job,'completed_at','JOB_COMPLETED');
 const deploymentCreated=time(errors,gaps,s.deployment,'created_at','DEPLOYMENT_CREATED');
 const deploymentStatus=time(errors,gaps,s.statuses[0],'created_at','DEPLOYMENT_STATUS');
 const approvalTime=time(errors,gaps,s.approvals[0],'created_at','RUN_APPROVAL');
 const capture=millis(x.receipt?.capturedAt);
 const order=(a,b,code)=>{if(a!==null&&b!==null&&a>b)errors.push(code);};
 order(runCreated,runStarted,'RUN_CLOCK_ORDER_INVALID');
 order(runStarted,jobStarted,'JOB_CLOCK_ORDER_INVALID');
 order(jobStarted,jobCompleted,'JOB_FINISH_ORDER_INVALID');
 order(runCreated,deploymentCreated,'DEPLOYMENT_BEFORE_RUN');
 order(deploymentCreated,deploymentStatus,'DEPLOYMENT_STATUS_BEFORE_DEPLOYMENT');
 order(runCreated,approvalTime,'APPROVAL_BEFORE_RUN');
 order(approvalTime,jobCompleted,'APPROVAL_AFTER_JOB');
 for(const item of [runCreated,runStarted,jobStarted,jobCompleted,
    deploymentCreated,deploymentStatus,approvalTime])
   order(item,capture,'CAPTURE_PRECEDES_EVIDENCE');
 // A successful deployment-status record coupled to a failed HOLD job is
 // *not* an authenticated join. Treat disagreement as a proof gap, not proof
 // of an impossible GitHub state (deployments may be external systems).
 if(s.job.conclusion==='failure'&&s.statuses[0].state==='success')
   gaps.push('DEPLOYMENT_SUCCESS_NOT_ATTRIBUTABLE_TO_FAILED_JOB');
 return report(errors,gaps,true);
}
