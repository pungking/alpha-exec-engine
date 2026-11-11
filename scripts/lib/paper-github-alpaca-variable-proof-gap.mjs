/**
 * STEP 5C-4D-3Y: GitHub repository ALPACA_BASE_URL variable candidate.
 *
 * 3X inspected real source: two Jobs use vars.ALPACA_BASE_URL, and one
 * has a PAPER fallback. None of these three Jobs binds an Environment.
 * A current repository variable response never proves historical run-time
 * resolution, outbound egress, broker key scopes or external Writer fences.
 *
 * Default: pure offline. Optional exact fixed URL GET with injected transport,
 * credentials and abort signal. No ambient token, scheduling or write path.
 */
import { inspectPaperBrokerEndpointSourceAudit } from './paper-broker-endpoint-source-audit.mjs';

const REPO='pungking/alpha-exec-engine';
const BASE='111b95195fc6b911f10e23ec1e288360a0849518';
const PRIOR_MAIN='0cd1f54fa6d6f7f8220540a193cdcbbdf499e994';
const PAPER='https://paper-api.alpaca.markets';
const VARIABLE='ALPACA_BASE_URL';
const MAX_BYTES=8192;
const URL='https://api.github.com/repos/'+REPO+'/actions/variables/'+VARIABLE;
const ROOT=['schemaVersion','repository','reviewedMainSha','baseline','workflowSources',
 'variableBefore','variableAfter','authorityClaims'];
const AUTH=['actualGithubOriginAttested','historicalVariableResolutionVerified',
 'paperLiveAccountSeparationVerified','effectiveOutboundHostVerified',
 'brokerKeyOrderPermissionExcluded','externalAccountWritersExcluded',
 'brokerMutationFenceEnforced','independentReplayProtected',
 'humanOperationalApprovalObtained','operationalEligible'];
const PRIOR_AUTH=['actualGithubVariableRead','allRuntimeBrokerHostsPinned',
 'liveBrokerHostnameExcluded','brokerKeyOrderPrivilegesExcluded',
 'externalAccountWritersExcluded','allMutationEdgesFenced',
 'exactJobApprovalVerified','humanOperationalApproval','operationalEligible'];
const VAR_KEYS=['name','value','created_at','updated_at'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length
 &&keys.every(k=>Object.hasOwn(v,k));
const stamp=s=>{
 if(typeof s!=='string'
   ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))
  return false;
 const t=Date.parse(s);
 if(!Number.isFinite(t))return false;
 const normalized=s.includes('.')?s.replace(/\.(\d{1,3})Z$/,(_,d)=>'.'+d.padEnd(3,'0')+'Z')
  :s.replace('Z','.000Z');
 return new Date(t).toISOString()===normalized;
};
const variable=x=>exact(x,VAR_KEYS)&&x.name===VARIABLE
 &&typeof x.value==='string'&&x.value.length>0&&x.value.length<=512
 &&/^[\x21-\x7e]+$/.test(x.value)
 &&stamp(x.created_at)&&stamp(x.updated_at)
 &&Date.parse(x.created_at)<=Date.parse(x.updated_at);
function report(errors){
 const held=errors.length===0;
 return Object.freeze({
  schemaVersion:'paper-github-alpaca-base-url-proof-gap-v1',
  status:held?'HOLD_UNATTESTED_REPO_PAPER_VARIABLE_CANDIDATE'
    :'DENY_UNVERIFIED_OR_UNSAFE_BROKER_VARIABLE',
  findings:Object.freeze([...new Set(errors)].sort()),
  sourceNineBrokerJobsBound:held,
  repoVariableCandidateMatchesPaperLiteral:held,
  candidateRepoVariableMatchedAcrossTwoReads:held,
  reviewedVariableDependentJobs:held?3:null,
  reviewedLiteralPaperUrlJobs:held?6:null,
  proofGaps:Object.freeze([
   'GITHUB_VARIABLE_RESPONSES_CALLER_SUPPLIED_NOT_AUTHENTICATED',
   'CURRENT_VARIABLE_VALUE_NOT_HISTORICAL_RUN_RESOLUTION',
   'TWO_GET_READS_DO_NOT_ATTEST_ATOMIC_REF_OR_CONFIG_SNAPSHOT',
   'BROKER_JOB_ENVIRONMENT_AND_STEP_OVERRIDE_DIFFERENCES_SOURCE_ONLY',
   'NESTED_SCRIPTS_EGRESS_AND_OUT_OF_BAND_HOSTS_UNVERIFIED',
   'ALPACA_KEY_PERMISSIONS_AND_PAPER_LIVE_ACCOUNT_ISOLATION_UNVERIFIED',
   'EXTERNAL_LEGACY_MANUAL_SCHEDULED_WRITER_PATHS_UNENUMERATED',
   'BROKER_MUTATION_FENCE_REPLAY_AND_HUMAN_APPROVAL_MISSING',
  ]),
  untrustedVariableClassification:held?'PAPER_LITERAL_CANDIDATE':'UNVERIFIED_OR_UNSAFE',
  githubVariableValueExposed:false,
  trueGithubOriginAttested:false,
  variableAtRunTimeVerified:false,
  actualRuntimeBrokerHostVerified:false,
  liveBrokerHostExcluded:false,
  paperLiveCredentialSeparationVerified:false,
  brokerKeyWriteCapabilityExcluded:false,
  externalWritersExcluded:false,
  accountWideMutationFenceVerified:false,
  operationalEligible:false,
  paperBrokerSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
 });
}
/** An exact PAPER candidate is still HOLD, never trusted source evidence. */
export function inspectPaperGithubAlpacaVariableProofGap(input={}){
 const x=object(input)?input:{},errors=[];
 if(!exact(x,ROOT)
   ||x.schemaVersion!=='paper-github-alpaca-base-url-proof-gap-v1'
   ||x.repository!==REPO||x.reviewedMainSha!==BASE)
  errors.push('REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
 if(!exact(x.authorityClaims,AUTH)
   ||AUTH.some(k=>x.authorityClaims?.[k]!==false))
  errors.push('FORGED_VARIABLE_OR_BROKER_AUTHORITY_CLAIM');
 const prior=inspectPaperBrokerEndpointSourceAudit({
  schemaVersion:'paper-broker-endpoint-source-audit-v1',
  repository:REPO,reviewedMainSha:PRIOR_MAIN,
  baseline:x.baseline,workflowSources:x.workflowSources,
  authorityClaims:Object.fromEntries(PRIOR_AUTH.map(k=>[k,false])),
 });
 if(prior.status!=='HOLD_THREE_BROKER_ENDPOINT_VARIABLES_UNATTESTED'
   ||prior.sourceUnresolvedVariableUrlJobs!==3
   ||prior.sourceFixedPaperUrlJobs!==6)
  errors.push('NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
 if(!variable(x.variableBefore)||!variable(x.variableAfter))
  errors.push('GITHUB_VARIABLE_RESPONSE_INVALID');
 if(!errors.includes('GITHUB_VARIABLE_RESPONSE_INVALID')){
  if(x.variableBefore.value!==x.variableAfter.value
    ||x.variableBefore.updated_at!==x.variableAfter.updated_at
    ||x.variableBefore.created_at!==x.variableAfter.created_at)
   errors.push('NON_ATOMIC_GITHUB_VARIABLE_READ_CHANGED');
  if(x.variableBefore.value!==PAPER||x.variableAfter.value!==PAPER)
   errors.push('BROKER_VARIABLE_IS_NOT_EXACT_PAPER_HOST');
 }
 return report(errors);
}
/**
 * Exact GET endpoint twice to catch visible configuration changes. Fail closed
 * if 401/403/404/429, ambiguous scope, bad media/length/payload, or transport
 * error. 404 is NOT proof a variable is absent; privileges may be insufficient.
 */
export async function readPaperGithubAlpacaVariableProofGap(input={}){
 const x=object(input)?input:{};
 if(typeof x.githubToken!=='string'||x.githubToken.length<8
   ||x.githubToken.length>4096||!/^[\x21-\x7e]+$/.test(x.githubToken)
   ||typeof x.fetchImpl!=='function'||!object(x.signal)
   ||typeof x.signal.addEventListener!=='function'
   ||typeof x.signal.aborted!=='boolean'||x.signal.aborted)
  return report(['READ_ONLY_VARIABLE_COLLECTOR_CONFIG_INVALID']);
 // Reject unreviewed source BEFORE even attempting a GitHub GET. A matching
 // snapshot remains HOLD: this check never authenticates repository state.
 const scope=inspectPaperBrokerEndpointSourceAudit({
  schemaVersion:'paper-broker-endpoint-source-audit-v1',
  repository:REPO,reviewedMainSha:PRIOR_MAIN,
  baseline:x.baseline,workflowSources:x.workflowSources,
  authorityClaims:Object.fromEntries(PRIOR_AUTH.map(k=>[k,false])),
 });
 if(scope.status!=='HOLD_THREE_BROKER_ENDPOINT_VARIABLES_UNATTESTED')
  return report(['NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID']);
 const headers=Object.freeze({
  Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28',
  Authorization:'Bearer '+x.githubToken,
 });
 async function get(){
  if(x.signal.aborted)throw Error('ABORT');
  const res=await x.fetchImpl(URL,{
   method:'GET',headers,redirect:'error',cache:'no-store',signal:x.signal,
  });
  if(res?.status!==200||typeof res.body?.getReader!=='function')
   throw Error('BAD_STATUS_OR_BODY');
  const type=res.headers?.get?.('content-type');
  if(typeof type!=='string'
    ||!/^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(type))
   throw Error('NON_JSON');
  const announced=res.headers?.get?.('content-length');
  if(announced!=null&&(!/^\d+$/.test(announced)||Number(announced)>MAX_BYTES))
   throw Error('BAD_LENGTH');
  const reader=res.body.getReader();
  let n=0;const chunks=[];
  try{
   for(;;){
    if(x.signal.aborted)throw Error('ABORT');
    const {done,value}=await reader.read();
    if(done)break;
    if(!(value instanceof Uint8Array))throw Error('BAD_CHUNK');
    n+=value.byteLength;
    if(n>MAX_BYTES)throw Error('OVERSIZE');
    chunks.push(Buffer.from(value));
   }
  }catch(e){await reader.cancel().catch(()=>{});throw e;}
  finally{reader.releaseLock();}
  if(announced!=null&&Number(announced)!==n)throw Error('MISMATCH_LENGTH');
  return JSON.parse(Buffer.concat(chunks,n).toString('utf8'));
 }
 try{
  const variableBefore=await get();
  if(!variable(variableBefore))
   return report(['GITHUB_VARIABLE_RESPONSE_INVALID']);
  const variableAfter=await get();
  return inspectPaperGithubAlpacaVariableProofGap({
   schemaVersion:'paper-github-alpaca-base-url-proof-gap-v1',
   repository:REPO,reviewedMainSha:BASE,
   baseline:x.baseline,workflowSources:x.workflowSources,
   variableBefore,variableAfter,
   authorityClaims:Object.fromEntries(AUTH.map(k=>[k,false])),
  });
 }catch{
  // Never log the injected token or raw variable value, URL or HTTP error.
  return report(['READ_ONLY_GITHUB_VARIABLE_UNAVAILABLE']);
 }
}
