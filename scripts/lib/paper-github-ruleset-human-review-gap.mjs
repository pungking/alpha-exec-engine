/**
 * STEP 5C-4D-3U — GitHub Ruleset evidence surface and human review gap.
 *
 * Read-only GitHub policy configuration is NOT an authenticated operational
 * approval, proof of historical enforcement, or broker Writer fencing.
 * This module contains NO READY/ALLOW path and performs no I/O by default.
 */
const REPO='pungking/alpha-exec-engine';
const BASE_SHA='c217e9031ad4c33a7b2def12e8561d4904347842';
const MAIN_ID=26952584,HOLD_ID=26956735,INTEGRITY_ID=26956389;
const MAX_BYTES=128*1024;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length
  &&keys.every(k=>Object.hasOwn(v,k));
const IDs=Object.freeze([
 Object.freeze({id:MAIN_ID,name:'alpha-main-source-protection',ref:'refs/heads/main'}),
 Object.freeze({id:HOLD_ID,name:'alpha-paper-state-admission-hold',ref:'refs/heads/paper-state'}),
 Object.freeze({id:INTEGRITY_ID,name:'alpha-paper-state-integrity',ref:'refs/heads/paper-state'}),
]);
const ROOT=['schemaVersion','repository','reviewedBaseSha','list','details','authorityClaims'];
const DETAIL=['main','paperHold','paperIntegrity'];
const AUTH=['humanGithubApproveObtained','githubOriginIndependentlyAttested',
 'atRunRulesetEnforcementVerified','environmentPolicyVerified',
 'exactJobDeploymentApproved','brokerAccountWritersExcluded',
 'brokerMutationFencingVerified','independentReplayEnforced',
 'separateHumanOperationalApproval','operationalEligible'];
const sameSet=(values,wanted)=>Array.isArray(values)&&values.length===wanted.length
 &&new Set(values).size===wanted.length
 &&wanted.every(k=>values.includes(k));
const errorList=errors=>Object.freeze([...new Set(errors)].sort());
const report=(issues,count=null)=>Object.freeze({
 schemaVersion:'paper-github-ruleset-human-review-gap-v1',
 status:issues.length?'DENY_GITHUB_RULESET_SCOPE_INVALID'
   :count===0?'HOLD_MAIN_HAS_ZERO_REQUIRED_HUMAN_APPROVALS'
   :'HOLD_GITHUB_REVIEW_POLICY_UNATTESTED',
 findings:errorList(issues),
 sourceRulesetShapeMatched:issues.length===0,
 observedRequiredApprovingReviewCount:issues.length===0?count:null,
 reviewedBaseSha:BASE_SHA,
 proofGaps:Object.freeze([
  'CALLER_SUPPLIED_RULESET_RESPONSES_NOT_INDEPENDENTLY_ATTESTED',
  'REVIEWED_BASE_SHA_NOT_AUTOMATICALLY_CURRENT_MAIN',
  'RULESET_POLICY_AT_HISTORICAL_RUN_NOT_VERIFIED',
  'MAIN_BRANCH_RULESET_DOES_NOT_AUTHENTICATE_A_HUMAN_APPROVAL',
  'CODE_REVIEW_COMMENT_NOT_GITHUB_APPROVE',
  'PROTECTED_ADMISSION_JOB_NOT_MUTATION_WRITER_JOB',
  'GITHUB_ENVIRONMENT_REVIEW_AND_ADMIN_BYPASS_UNVERIFIED',
  'PAPER_STATE_RULESETS_DO_NOT_PROVE_BROKER_WRITER_EXCLUSIVITY',
  'EXTERNAL_BROKER_CREDENTIALS_AND_WRITERS_NOT_INVENTORIED',
  'MUTATION_EDGE_FENCING_AND_REPLAY_GUARD_NOT_ENFORCED',
  'SEPARATE_HUMAN_OPERATIONAL_APPROVAL_NOT_OBTAINED',
 ]),
 trustedGithubOriginVerified:false,
 githubIndependentHumanReviewVerified:false,
 rulesetHistoricalEnforcementVerified:false,
 environmentAtRunVerified:false,
 exactWriterJobApprovalVerified:false,
 accountWideBrokerWriterFencingVerified:false,
 replayControlVerified:false,
 operationalEligible:false,
 paperBrokerSubmitAuthorized:false,
 paperStateMutationAuthorized:false,
 liveTradingAuthorized:false,
});
const goodRef=(v,ref)=>obj(v)&&obj(v.ref_name)
 &&sameSet(v.ref_name.include,[ref])
 &&sameSet(v.ref_name.exclude,[]);
const validatedCore=(v,target)=>{
 if(!obj(v)||v.id!==target.id||v.name!==target.name
   ||v.target!=='branch'||v.enforcement!=='active'
   ||!Array.isArray(v.bypass_actors)||v.bypass_actors.length!==0
   ||!goodRef(v.conditions,target.ref)||!Array.isArray(v.rules))
  return false;
 return v.rules.every(rule=>obj(rule)&&typeof rule.type==='string');
};
/**
 * The 3 GET responses are caller-controlled. Matching active Ruleset shapes
 * proves neither that GitHub enforced them at run time nor that an independent
 * human approved source changes or PAPER broker mutations.
 */
export function inspectPaperGithubRulesetHumanReviewGap(input={}){
 const x=obj(input)?input:{},issues=[];
 if(!exact(x,ROOT)||x.schemaVersion!=='paper-github-ruleset-human-review-gap-v1'
   ||x.repository!==REPO||x.reviewedBaseSha!==BASE_SHA)
  issues.push('SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
 if(!exact(x.authorityClaims,AUTH)
   ||AUTH.some(k=>x.authorityClaims?.[k]!==false))
  issues.push('UNSUPPORTED_RULESET_OPERATIONAL_AUTHORITY_CLAIM');
 const list=x.list,details=x.details;
 if(!Array.isArray(list)||list.length!==IDs.length
   ||list.some(s=>!obj(s)||!IDs.some(t=>s.id===t.id&&s.name===t.name
      &&s.target==='branch'&&s.enforcement==='active'))
   ||new Set(list.map(s=>s?.id)).size!==IDs.length)
  issues.push('REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
 if(!exact(details,DETAIL)
   ||!validatedCore(details.main,IDs[0])
   ||!validatedCore(details.paperHold,IDs[1])
   ||!validatedCore(details.paperIntegrity,IDs[2]))
  issues.push('RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
 if(issues.includes('RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT'))
  return report(issues);
 const main=details.main,hold=details.paperHold,integrity=details.paperIntegrity;
 if(!sameSet(main.rules.map(r=>r.type),
   ['deletion','non_fast_forward','pull_request','required_status_checks']))
  issues.push('MAIN_RULE_TYPES_DRIFT');
 if(!sameSet(hold.rules.map(r=>r.type),['creation','update']))
  issues.push('PAPER_STATE_ADMISSION_HOLD_RULES_DRIFT');
 if(!sameSet(integrity.rules.map(r=>r.type),['deletion','non_fast_forward']))
  issues.push('PAPER_STATE_INTEGRITY_RULES_DRIFT');
 const pr=main.rules.find(r=>r.type==='pull_request')?.parameters;
 const checks=main.rules.find(r=>r.type==='required_status_checks')?.parameters;
 if(!obj(pr)||!Number.isSafeInteger(pr.required_approving_review_count)
   ||pr.required_approving_review_count<0||pr.required_approving_review_count>6
   ||!sameSet(pr.allowed_merge_methods,['merge']))
  issues.push('MAIN_PR_MERGE_REVIEW_CONSTRAINTS_INVALID');
 if(!obj(checks)||checks.strict_required_status_checks_policy!==true
   ||checks.do_not_enforce_on_create!==false
   ||!Array.isArray(checks.required_status_checks)
   ||checks.required_status_checks.length!==1
   ||checks.required_status_checks[0]?.context!=='build'
   ||checks.required_status_checks[0]?.integration_id!==15368)
  issues.push('MAIN_REQUIRED_BUILD_CHECK_POLICY_DRIFT');
 return report(issues,pr?.required_approving_review_count??null);
}
/**
 * Opt-in GET-only adapter. Exact static URLs; no ambient token, redirects,
 * retries, writes or actual network call unless a caller supplies fetchImpl.
 * Its results are still untrusted diagnostic candidates, never approval.
 */
export async function readPaperGithubRulesetHumanReviewGap(input={}){
 const x=obj(input)?input:{};
 if(typeof x.token!=='string'||x.token.length<8||x.token.length>4096
   ||!/^[\x21-\x7e]+$/.test(x.token)
   ||typeof x.fetchImpl!=='function'||!obj(x.signal)
   ||typeof x.signal.addEventListener!=='function'
   ||typeof x.signal.aborted!=='boolean'||x.signal.aborted)
  return report(['READ_ONLY_RULESET_COLLECTOR_CONFIG_INVALID']);
 const base='https://api.github.com/repos/'+REPO;
 const headers=Object.freeze({
  Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28',
  Authorization:'Bearer '+x.token,
 });
 async function get(path){
  if(x.signal.aborted)throw Error('ABORT');
  const response=await x.fetchImpl(base+path,{
   method:'GET',headers,redirect:'error',cache:'no-store',signal:x.signal,
  });
  if(response?.status!==200||typeof response.body?.getReader!=='function')
   throw Error('HTTP_STATUS_OR_BODY');
  const type=response.headers?.get?.('content-type');
  if(typeof type!=='string'
    ||!/^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(type))
   throw Error('NON_JSON_RESPONSE');
  const announced=response.headers?.get?.('content-length');
  if(announced!=null&&(!/^\d+$/.test(announced)||Number(announced)>MAX_BYTES))
   throw Error('BAD_LENGTH');
  if(/rel\s*=\s*"?next"?/i.test(response.headers?.get?.('link')||''))
   throw Error('NON_EXHAUSTIVE_PAGE');
  const reader=response.body.getReader();
  let bytes=0;const chunks=[];
  try{
   for(;;){
    if(x.signal.aborted)throw Error('ABORT');
    const {done,value}=await reader.read();
    if(done)break;
    if(!(value instanceof Uint8Array))throw Error('BAD_STREAM_CHUNK');
    bytes+=value.byteLength;
    if(bytes>MAX_BYTES)throw Error('TOO_LARGE');
    chunks.push(Buffer.from(value));
   }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  if(announced!=null&&Number(announced)!==bytes)
   throw Error('CONTENT_LENGTH_MISMATCH');
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
 }
 try{
  const list=await get('/rulesets?per_page=100&page=1');
  if(!Array.isArray(list)||list.length!==IDs.length
     ||!IDs.every(t=>list.some(s=>s?.id===t.id)))
   throw Error('RULESET_SET_CHANGED');
  const main=await get('/rulesets/'+MAIN_ID);
  const paperHold=await get('/rulesets/'+HOLD_ID);
  const paperIntegrity=await get('/rulesets/'+INTEGRITY_ID);
  return inspectPaperGithubRulesetHumanReviewGap({
   schemaVersion:'paper-github-ruleset-human-review-gap-v1',
   repository:REPO,reviewedBaseSha:BASE_SHA,
   list,details:{main,paperHold,paperIntegrity},
   authorityClaims:Object.fromEntries(AUTH.map(k=>[k,false])),
  });
 }catch{
  // Never leak injected bearer, URLs, error bodies or provider raw payloads.
  return report(['READ_ONLY_GITHUB_RULESET_SNAPSHOT_UNAVAILABLE']);
 }
}
