/**
 * STEP 5C-4D-3J: strictly scoped, opt-in, GET-only GitHub REST correlation.
 *
 * Correlated API-shaped data NEVER proves a job's protected deployment
 * approval, a trusted origin, or broker account-wide writer fencing.
 * The only successful outcome is HOLD; invalid/ambiguous reads are DENY.
 * No default token, fetch, network call, dispatch, file writes or mutations.
 */
const REPO='pungking/alpha-exec-engine';
const ENV='PAPER_CUSTODY_APPROVAL';
const JOB='Protected PAPER approval - operational HOLD';
const ENV_ID=26847620868;
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[1-9][0-9]{0,15}$/;
const MAX_RESPONSE=256*1024;
const MAX_TOTAL=1024*1024;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validId=v=>typeof v==='string'&&ID.test(v)&&Number.isSafeInteger(Number(v));
const sameId=(a,b)=>typeof a==='number'?Number.isSafeInteger(a)&&String(a)===b:validId(a)&&a===b;
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const allowedWorkflows=new Set([
 '.github/workflows/ledger-filled-migration.yml',
 '.github/workflows/paper-five-row-active-limited-state-recovery.yml',
 '.github/workflows/paper-oco-submit-canary.yml',
 '.github/workflows/persistent-oco-repair-submit.yml',
]);
const result=(findings,matched=false)=>Object.freeze({
 schemaVersion:'paper-deployment-rest-correlation-v1',
 status:findings.length?'DENY_GITHUB_REST_CORRELATION':'HOLD_UNATTESTED_GITHUB_REST_CORRELATION',
 findings:Object.freeze([...new Set(findings)].sort()),
 restShapesCorrelated:findings.length===0&&matched,
 verifiedTransportOrigin:false,
 authenticatedJobToDeploymentBinding:false,
 environmentPolicyIndependentlyAttested:false,
 accountWriterExclusionVerified:false,
 credentialInventoryComplete:false,
 runtimeFencingVerified:false,
 operationalEligible:false,
 stateMutationAuthorized:false,
 brokerSubmitAuthorized:false,
 liveTradingAuthorized:false,
});
function validExpected(e){
 return exact(e,['repository','environment','environmentId','branch','sha','runId',
 'jobId','deploymentId','attempt','workflowPath'])
 && e.repository===REPO&&e.environment===ENV&&e.environmentId===ENV_ID
 && e.branch==='main'&&SHA.test(e.sha)&&validId(e.runId)
 && validId(e.jobId)&&validId(e.deploymentId)
 && e.attempt===1&&allowedWorkflows.has(e.workflowPath);
}
/** Pure inspection of untrusted REST-shaped evidence, not an attestation. */
export function inspectPaperDeploymentRestCorrelation(input={}){
 const x=obj(input)?input:{},findings=[],e=x.expected;
 if(!validExpected(e))return result(['EXPECTED_BOUNDARY_INVALID']);
 const run=x.run, job=x.job, dep=x.deployment, statuses=x.statuses, approvals=x.approvals;
 if(!obj(run)||!sameId(run.id,e.runId)||run.run_attempt!==1
   ||run.head_sha!==e.sha||run.head_branch!=='main'||run.event!=='workflow_dispatch'
   ||run.path!==e.workflowPath||run.repository?.full_name!==REPO
   ||run.head_repository?.full_name!==REPO||!Array.isArray(run.pull_requests)
   ||run.pull_requests.length!==0) findings.push('RUN_IDENTITY_INVALID');
 if(!obj(job)||!sameId(job.id,e.jobId)||!sameId(job.run_id,e.runId)
   ||job.run_attempt!==1||job.head_sha!==e.sha||job.name!==JOB
   ||job.status!=='completed'||job.conclusion!=='failure')
   findings.push('JOB_IDENTITY_INVALID');
 if(!obj(dep)||!sameId(dep.id,e.deploymentId)||dep.sha!==e.sha
   ||dep.ref!=='main'||dep.environment!==ENV||dep.task!=='deploy'
   ||dep.creator?.login!=='github-actions[bot]')
   findings.push('DEPLOYMENT_IDENTITY_INVALID');
 if(!Array.isArray(statuses)||statuses.length!==1
   ||!obj(statuses[0])||!sameId(statuses[0].deployment_id,e.deploymentId)
   ||statuses[0].state!=='success'||statuses[0].environment!==ENV)
   findings.push('DEPLOYMENT_STATUS_AMBIGUOUS');
 if(!Array.isArray(approvals)||approvals.length!==1||!obj(approvals[0])
   ||approvals[0].state!=='approved'||approvals[0].user?.login!=='pungking'
   ||!Number.isSafeInteger(approvals[0].user?.id)||approvals[0].user.id<=0
   ||!Array.isArray(approvals[0].environments)||approvals[0].environments.length!==1
   ||approvals[0].environments[0]?.id!==ENV_ID
   ||approvals[0].environments[0]?.name!==ENV)
   findings.push('APPROVAL_HISTORY_AMBIGUOUS');
 return result(findings,true);
}
/**
 * Caller must inject a credential, a GET-capable transport, and an active AbortSignal.
 * No credential is read from env or printed. An injected/mock transport is not a
 * cryptographic authority: even matching records produce HOLD only.
 *
 * AbortSignal bounds are caller-managed: this helper cannot guarantee that a
 * malicious/noncompliant fetch implementation honors cancellation.
 */
export async function readPaperDeploymentRestCorrelation(input={}){
 const x=obj(input)?input:{};
 if(!validExpected(x.expected))return result(['EXPECTED_BOUNDARY_INVALID']);
 if(typeof x.token!=='string'||x.token.length<8||x.token.length>4096
   ||!/^\x21-\x7e+$/.test(x.token)||typeof x.fetchImpl!=='function'
   ||!obj(x.signal)||typeof x.signal.addEventListener!=='function'
   ||typeof x.signal.aborted!=='boolean'||x.signal.aborted)
   return result(['TRANSPORT_CONFIG_INVALID']);
 const e=x.expected;
 const root='https://api.github.com/repos/'+REPO;
 const routes=[
  ['/actions/runs/'+e.runId,'run'],
  ['/actions/jobs/'+e.jobId,'job'],
  ['/deployments/'+e.deploymentId,'deployment'],
  ['/deployments/'+e.deploymentId+'/statuses?per_page=2','statuses'],
  ['/actions/runs/'+e.runId+'/approvals','approvals'],
 ];
 const headers=Object.freeze({Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+x.token});
 const data={},limits={bytes:0};
 try {
  for(const [route,k] of routes){
   if(x.signal.aborted)throw Error('ABORTED');
   const response=await x.fetchImpl(root+route,{method:'GET',headers,
    redirect:'error',cache:'no-store',signal:x.signal});
   if(response?.status!==200||typeof response.body?.getReader!=='function')
    throw Error('RESPONSE_INVALID');
   const contentType=response.headers?.get?.('content-type');
   if(typeof contentType!=='string'||!/^application\/(?:json|[^;]+\+json)(?:\s*;|$)/i.test(contentType))
    throw Error('CONTENT_TYPE_INVALID');
   const contentLength=response.headers?.get?.('content-length');
   if(contentLength!=null&&(!/^\d+$/.test(contentLength)
      ||Number(contentLength)>MAX_RESPONSE
      ||limits.bytes+Number(contentLength)>MAX_TOTAL))
    throw Error('RESPONSE_TOO_LARGE');
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{
    for(;;){
     if(x.signal.aborted)throw Error('ABORTED');
     const {done,value}=await reader.read();
     if(done)break;
     if(!(value instanceof Uint8Array))throw Error('RESPONSE_INVALID');
     size+=value.byteLength;limits.bytes+=value.byteLength;
     if(size>MAX_RESPONSE||limits.bytes>MAX_TOTAL)throw Error('RESPONSE_TOO_LARGE');
     chunks.push(Buffer.from(value));
    }
   }catch(err){await reader.cancel().catch(()=>{});throw err;}
   finally{reader.releaseLock();}
   const parsed=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
   if((k==='statuses'||k==='approvals')?!Array.isArray(parsed):!obj(parsed))
    throw Error('RESPONSE_SHAPE_INVALID');
   data[k]=parsed;
  }
  return inspectPaperDeploymentRestCorrelation({expected:e,...data});
 }catch{
  // Avoid leaking token, error bodies, provider messages or remote URLs.
  return result(['READ_ONLY_GITHUB_EVIDENCE_UNAVAILABLE']);
 }
}
