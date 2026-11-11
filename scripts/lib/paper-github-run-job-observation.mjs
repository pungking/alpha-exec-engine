/**
 * STEP 5C-4D-3Q: offline, read-only classification of GitHub REST-shaped
 * completed Workflow Run and Job-list observations.
 *
 * The observed Job result (especially an older successful Writer Job) is not
 * a verified approval, proof of broker mutations, or evidence of current
 * Account Writer exclusivity. No network, clock, auth, env or state writes.
 */
import { inspectPaperProtectedWriterTopology,
  PAPER_PROTECTED_WRITER_TOPOLOGY } from './paper-protected-writer-topology.mjs';

const REPO='pungking/alpha-exec-engine';
const BASE_SHA='746901741a4a484763ef785e2b66244b9e584b1c';
const SHA=/^[a-f0-9]{40}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const safeID=x=>(typeof x==='number'&&Number.isSafeInteger(x)&&x>0)
 ||(typeof x==='string'&&/^[1-9][0-9]{0,15}$/.test(x)
    &&Number.isSafeInteger(Number(x)));
const eqID=(a,b)=>safeID(a)&&safeID(b)&&String(a)===String(b);
const ACCEPTED_CONCLUSIONS=new Set(['success','failure','cancelled','timed_out','skipped','neutral']);
const ADMISSION='Protected PAPER approval - operational HOLD';
const ENTRY=['schemaVersion','reviewedSourceSha','baseline','workflowSources',
 'expected','run','jobs'];
const EXPECTED=['repository','workflowFile','runId','runAttempt'];
const result=(issues,reason,gaps=[])=>Object.freeze({
 schemaVersion:'paper-github-run-job-observation-v1',
 status:issues.length?'DENY_GITHUB_RUN_JOB_OBSERVATION_INVALID':reason,
 findings:Object.freeze([...new Set(issues)].sort()),
 proofGaps:Object.freeze([
  'GITHUB_REST_ORIGIN_UNATTESTED',
  'PROTECTED_ENVIRONMENT_SETTINGS_NOT_RETRIEVED',
  'JOB_DEPLOYMENT_JOIN_NOT_VERIFIED',
  'GITHUB_JOB_APPROVAL_NOT_TRANSFERABLE',
  'BROKER_WRITER_EXCLUSIVITY_NOT_ATTESTED',
  'EXTERNAL_REPLAY_PROTECTION_NOT_ENFORCED',
  ...gaps,
 ]),
 sourceTopologyConsistent:issues.length===0,
 reviewedCommitMatchesObservedRun:reason==='HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION'
   &&issues.length===0,
 observedRunProvenanceVerified:false,
 protectedEnvironmentPolicyVerified:false,
 exactJobDeploymentApprovalVerified:false,
 brokerAccountWriterFenced:false,
 operationAuthorized:false,
 paperBrokerSubmitAuthorized:false,
 paperStateMutationAuthorized:false,
 liveTradingAuthorized:false,
});
/**
 * Compare API-shaped data against the reviewed 3P source at a fixed Git SHA.
 * All untrusted input remains untrusted even if run/job IDs and SHA match.
 * Historical runs at other SHAs cannot be used to infer current protections.
 */
export function inspectPaperGithubRunJobObservation(input={}){
 const x=obj(input)?input:{},issues=[];
 if(!exact(x,ENTRY)||x.schemaVersion!=='paper-github-run-job-observation-v1'
    ||x.reviewedSourceSha!==BASE_SHA)
  issues.push('OBSERVATION_ENVELOPE_OR_REVIEWED_SHA_INVALID');
 const topology=inspectPaperProtectedWriterTopology({
  baseline:x.baseline,workflowSources:x.workflowSources,
 });
 if(topology.status!=='HOLD_APPROVED_ADMISSION_NOT_WRITER_JOB_AUTHORITY'
  ||topology.reviewedSourceTopologyMatched!==true
  ||topology.operationalEligible!==false)
  issues.push('REVIEWED_SOURCE_TOPOLOGY_INVALID');
 const e=x.expected,r=x.run,js=x.jobs;
 const target=PAPER_PROTECTED_WRITER_TOPOLOGY.find(t=>t.file===e?.workflowFile);
 if(!exact(e,EXPECTED)||e.repository!==REPO||!target||!safeID(e.runId)
   ||e.runAttempt!==1)issues.push('REQUESTED_RUN_BOUNDARY_INVALID');
 if(!obj(r)||!eqID(r.id,e?.runId)||r.run_attempt!==1
   ||r.event!=='workflow_dispatch'||r.head_branch!=='main'
   ||r.path!=='.github/workflows/'+e?.workflowFile
   ||r.repository?.full_name!==REPO
   ||r.head_repository?.full_name!==REPO
   ||!SHA.test(r.head_sha||'')
   ||r.status!=='completed'
   ||!ACCEPTED_CONCLUSIONS.has(r.conclusion))
  issues.push('RUN_IDENTITY_OR_COMPLETION_INVALID');
 const allowed=new Set([ADMISSION,target?.writer]);
 if(!Array.isArray(js)||js.length>2||js.length===0
   ||js.some(j=>!obj(j)||!safeID(j.id)||!eqID(j.run_id,e?.runId)
     ||j.run_attempt!==1||j.head_sha!==r?.head_sha
     ||!allowed.has(j.name)||j.status!=='completed'
     ||!ACCEPTED_CONCLUSIONS.has(j.conclusion))
   ||new Set((Array.isArray(js)?js:[]).map(j=>String(j?.id))).size
     !==(Array.isArray(js)?js.length:0)
   ||new Set((Array.isArray(js)?js:[]).map(j=>j?.name)).size
     !==(Array.isArray(js)?js.length:0))
  issues.push('JOB_LIST_IDENTITY_OR_CARDINALITY_INVALID');
 if(issues.length)return result(issues,'DENY_GITHUB_RUN_JOB_OBSERVATION_INVALID');
 const sameSource=r.head_sha===BASE_SHA;
 if(!sameSource)
  return result([],'HOLD_HISTORICAL_SOURCE_NOT_CURRENT_AUTHORITY',[
   'OBSERVED_RUN_DIFFERENT_FROM_REVIEWED_CURRENT_SOURCE',
  ]);
 const admission=js.find(j=>j.name===ADMISSION),writer=js.find(j=>j.name===target.writer);
 if(admission?.conclusion==='success')
  issues.push('IMPOSSIBLE_SUCCESSFUL_FAIL_CLOSED_ADMISSION');
 if(writer && writer.conclusion!=='skipped')
  issues.push('UNEXPECTED_MUTATION_JOB_EXECUTION_UNDER_HOLD_SOURCE');
 if(r.conclusion==='success')
  issues.push('UNEXPECTED_SUCCESSFUL_WORKFLOW_UNDER_HOLD_SOURCE');
 if(issues.length)return result(issues,'DENY_GITHUB_RUN_JOB_OBSERVATION_INVALID');
 const missing=[];
 if(!admission)missing.push('ADMISSION_JOB_RESULT_MISSING');
 if(!writer)missing.push('MUTATION_JOB_RESULT_MISSING');
 return result([],'HOLD_SAME_SOURCE_RUN_JOBS_NOT_ATTESTATION',missing);
}
