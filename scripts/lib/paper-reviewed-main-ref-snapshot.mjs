/**
 * STEP 5C-4D-3T — moving main ref vs frozen 3S reviewed-source boundary.
 *
 * Pure, bounded REST-shaped reconciliation and optional GET-only collector.
 * A consistent commit/ref/branch observation is never independently trusted:
 * no broker rights, deployment authorization, trusted provenance or anti-replay.
 *
 * No ambient credentials, FS, clock, environment reads, writes or dispatch.
 */
const REPO = 'pungking/alpha-exec-engine';
const REVIEWED_3S_SOURCE = '6cd26eb4fffc32c181a6768b3f9eaff589162bb8';
const SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 96 * 1024;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
  &&keys.every(k=>Object.hasOwn(x,k));
const ROOT=['schemaVersion','reviewedSourceSha','branchBefore','gitRef',
  'headCommit','branchAfter','authorityClaims'];
const AUTH=['githubOriginVerified','repositoryRulesetVerified',
  'environmentAtRunVerified','exactWriterJobApproved',
  'brokerAccountWriterFenced','independentReplayEnforced',
  'separateHumanOperationalApproval','operationalEligible'];
const status=(errors,head,reviewedSha,parent)=>{
 const consistent=errors.length===0;
 return Object.freeze({
  schemaVersion:'paper-reviewed-main-ref-snapshot-v1',
  status:!consistent?'DENY_MAIN_REF_OBSERVATION_INVALID'
   :head===reviewedSha?'HOLD_FROZEN_REVIEWED_SOURCE_REF_MATCH'
    :'HOLD_MAIN_MOVED_BEYOND_REVIEWED_SOURCE',
  findings:Object.freeze([...new Set(errors)].sort()),
  untrustedObservedHeadSha:consistent?head:null,
  reviewedFrozenSourceSha:REVIEWED_3S_SOURCE,
  branchRefCommitShapeCorrelated:consistent,
  firstParentEqualsReviewedSha:consistent&&parent===reviewedSha,
  pinned3sSourceEqualsObservedMain:consistent&&head===reviewedSha,
  proofGaps:Object.freeze([
   'CALLER_SUPPLIED_GITHUB_RESPONSES_ARE_UNATTESTED',
   'GITHUB_REF_READS_ARE_NOT_ATOMIC_AND_HISTORY_IS_NOT_TRUSTED',
   'MAIN_RULESET_AND_ADMIN_BYPASS_NOT_INDEPENDENTLY_VERIFIED',
   'FROZEN_SOURCE_SHA_IS_NOT_ALWAYS_CURRENT_MAIN',
   'ENVIRONMENT_POLICY_AT_RUN_ATTEMPT_UNVERIFIED',
   'APPROVED_ADMISSION_JOB_NOT_MUTATION_WRITER_JOB',
   'BROKER_ACCOUNT_WIDE_WRITER_FENCING_UNVERIFIED',
   'INDEPENDENT_REPLAY_AND_HUMAN_OPERATIONAL_APPROVAL_MISSING',
  ]),
  trustedGithubOriginVerified:false,
  branchProtectionEnforcementVerified:false,
  environmentAtRunVerified:false,
  exactWriterJobDeploymentApproved:false,
  brokerWriterExclusivityVerified:false,
  externalReplayProtected:false,
  operationalEligible:false,
  paperSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
 });
};
/**
 * Branch is intentionally sampled twice around a GET ref and GET exact
 * commit; a changed observed head is DENY. Even identical snapshots cannot
 * prove a ref did not temporarily move or the collector cannot forge data.
 */
export function inspectPaperReviewedMainRefSnapshot(input={}){
 const x=obj(input)?input:{},errors=[];
 if(!exact(x,ROOT)||x.schemaVersion!=='paper-reviewed-main-ref-snapshot-v1'
   ||x.reviewedSourceSha!==REVIEWED_3S_SOURCE)
  errors.push('REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
 if(!exact(x.authorityClaims,AUTH)||AUTH.some(k=>x.authorityClaims?.[k]!==false))
  errors.push('FORGED_OPERATIONAL_AUTHORITY_CLAIM');
 const before=x.branchBefore,after=x.branchAfter,ref=x.gitRef,commit=x.headCommit;
 const goodBranch=b=>obj(b)&&b.name==='main'
  &&obj(b.commit)&&SHA.test(b.commit.sha||'')
  &&b.protected===true;
 if(!goodBranch(before)||!goodBranch(after))
  errors.push('MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
 const h=goodBranch(before)?before.commit.sha:null;
 if(!obj(ref)||ref.ref!=='refs/heads/main'
   ||ref.object?.type!=='commit'||!SHA.test(ref.object?.sha||''))
  errors.push('HEAD_GIT_REF_IDENTITY_INVALID');
 if(!obj(commit)||!SHA.test(commit.sha||'')
   ||!Array.isArray(commit.parents)||commit.parents.length<1
   ||commit.parents.length>2||commit.parents.some(p=>!obj(p)||!SHA.test(p.sha||''))
   ||!SHA.test(commit.commit?.tree?.sha||''))
  errors.push('HEAD_COMMIT_IDENTITY_INVALID');
 if(h===null||h!==after?.commit?.sha||h!==ref?.object?.sha||h!==commit?.sha)
  errors.push('NON_ATOMIC_OR_CONTRADICTORY_MAIN_HEAD');
 return status(errors,h,x.reviewedSourceSha,commit?.parents?.[0]?.sha);
}
/**
 * Optional bounded GET-only adapter with injected fetch/credentials.
 * A forged fetch, transient branch movement or ignored signal cannot be
 * ruled out. No runtime authority is returned under any circumstances.
 */
export async function readPaperReviewedMainRefSnapshot(input={}){
 const x=obj(input)?input:{};
 const missing={schemaVersion:'paper-reviewed-main-ref-snapshot-v1',
  reviewedSourceSha:REVIEWED_3S_SOURCE,branchBefore:null,gitRef:null,
  headCommit:null,branchAfter:null,
  authorityClaims:Object.fromEntries(AUTH.map(k=>[k,false]))};
 if(typeof x.token!=='string'||x.token.length<8||x.token.length>4096
   ||!/^[\x21-\x7e]+$/.test(x.token)
   ||typeof x.fetchImpl!=='function'||!obj(x.signal)
   ||typeof x.signal.addEventListener!=='function'
   ||typeof x.signal.aborted!=='boolean'||x.signal.aborted)
  return status(['READ_ONLY_COLLECTOR_CONFIG_INVALID'],null,REVIEWED_3S_SOURCE,null);
 const root='https://api.github.com/repos/'+REPO;
 const headers=Object.freeze({
  Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28',
  Authorization:'Bearer '+x.token,
 });
 async function get(path){
  if(x.signal.aborted)throw Error('ABORT');
  const response=await x.fetchImpl(root+path,{
   method:'GET',headers,redirect:'error',cache:'no-store',signal:x.signal,
  });
  if(response?.status!==200||typeof response.body?.getReader!=='function')
   throw Error('STATUS_OR_BODY');
  const type=response.headers?.get?.('content-type');
  if(typeof type!=='string'
    ||!/^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(type))
   throw Error('CONTENT_TYPE');
  const announced=response.headers?.get?.('content-length');
  if(announced!=null&&(!/^\d+$/.test(announced)||Number(announced)>MAX_BYTES))
   throw Error('LENGTH');
  const reader=response.body.getReader();
  let bytes=0;const chunks=[];
  try{
   for(;;){
    if(x.signal.aborted)throw Error('ABORT');
    const {done,value}=await reader.read();
    if(done)break;
    if(!(value instanceof Uint8Array))throw Error('CHUNK');
    bytes+=value.byteLength;
    if(bytes>MAX_BYTES)throw Error('TOO_LARGE');
    chunks.push(Buffer.from(value));
   }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  if(announced!=null&&Number(announced)!==bytes)throw Error('LENGTH_MISMATCH');
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
 }
 try{
  const branchBefore=await get('/branches/main');
  if(!obj(branchBefore)||!SHA.test(branchBefore.commit?.sha||''))
   throw Error('BRANCH_SHAPE');
  const gitRef=await get('/git/ref/heads/main');
  // Never concatenate unvalidated caller input into a URL.
  const headCommit=await get('/commits/'+branchBefore.commit.sha);
  const branchAfter=await get('/branches/main');
  return inspectPaperReviewedMainRefSnapshot({...missing,
   branchBefore,gitRef,headCommit,branchAfter});
 }catch{
  return status(['READ_ONLY_GITHUB_MAIN_REF_UNAVAILABLE'],null,REVIEWED_3S_SOURCE,null);
 }
}
