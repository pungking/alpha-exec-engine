/**
 * STEP 5C-4D-3W: opt-in, GET-only candidate acquisition for repository and
 * environment secret *NAMES* plus PAPER-only Alpaca account *shape*.
 *
 * No ambient tokens, filesystem, network by default, order APIs, output
 * of sensitive identifiers or any operating authority. Caller-injected
 * responses are NEVER authenticated or broker-account Writer proof.
 */
import { inspectPaperBrokerSecretSourceSurface } from './paper-broker-secret-source-surface.mjs';

const REPO='pungking/alpha-exec-engine';
const SOURCE='4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const ENV='PAPER_CUSTODY_APPROVAL';
const MAX_BYTES=96*1024;
const PAIR=Object.freeze(['ALPACA_KEY_ID','ALPACA_SECRET_KEY']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const ROOT=['schemaVersion','repository','reviewedSourceCommit','baseline',
 'repoSecrets','environmentSecrets','paperAccount','authorityClaims'];
const CLAIMS=['githubSecretValuesRetrieved','repoSecretsScopeAttested',
 'orgSecretsExcluded','actualJobSecretsAccessibleVerified',
 'paperCredentialsReadOnlyVerified','paperLiveSeparationProven',
 'brokerAccountWriterInventoryComplete','externalWritersExcluded',
 'mutationEdgeFencingVerified','humanOperationApproved','operationalEligible'];
const validSecretName=n=>typeof n==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(n);
const forbiddenMetadataKeys=['value','plaintext','encrypted_value','secret','private_key','token'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const report=(problems,details={})=>{
 const valid=problems.length===0;
 const repoPair=valid&&details.repoPair===true;
 const envPair=valid&&details.envPair===true;
 return Object.freeze({
  schemaVersion:'paper-broker-credential-metadata-candidate-v1',
  status:!valid?'DENY_BROKER_CREDENTIAL_METADATA_INVALID'
   :repoPair?'HOLD_UNATTESTED_REPOSITORY_SECRETS_AND_PAPER_ACCOUNT'
   :'HOLD_REPOSITORY_SECRET_PAIR_ABSENT_OR_PARTIAL',
  findings:Object.freeze([...new Set(problems)].sort()),
  reviewedSourceBrokerJobCount:valid?9:null,
  repositoryAlpacaPairNamesPresent:repoPair,
  environmentAlpacaPairNamesPresent:envPair,
  accountPayloadShapeMatched:valid,
  // These indicate only names appearing in caller-supplied metadata.
  sourceEvidenceTrust:'CALLER_SUPPLIED_UNVERIFIED',
  proofGaps:Object.freeze([
   'GITHUB_SECRETS_METADATA_SOURCE_NOT_INDEPENDENTLY_ATTESTED',
   'SECRETS_LIST_NEVER_RETURNS_PLAINTEXT_VALUES_OR_KEY_CAPABILITIES',
   'REPOSITORY_AND_ENVIRONMENT_NAMES_DO_NOT_COVER_ORG_INHERITANCE',
   'ENVIRONMENT_ONLY_SECRETS_ARE_NOT_AVAILABLE_TO_UNBOUND_JOBS',
   'ACCOUNT_RESPONSE_FROM_PAPER_HOST_IS_NOT_KEY_SCOPE_PROOF',
   'BROKER_ACCOUNT_IDENTITY_NOT_BOUND_TO_ALL_GITHUB_JOBS',
   'BROKER_KEY_CAN_HAVE_WRITE_PRIVILEGES_DESPITE_GET_ONLY_USE',
   'EXTERNAL_LEGACY_MANUAL_SCHEDULED_AND_LOCAL_WRITERS_UNENUMERATED',
   'EXCLUSIVE_BROKER_MUTATION_FENCE_AND_REPLAY_GUARD_NOT_PROVEN',
   'SEPARATE_HUMAN_SOURCE_AND_OPERATIONAL_APPROVAL_MISSING',
  ]),
  githubSecretValueRead:false,
  authenticGithubMetadataVerified:false,
  paperAccountOriginVerified:false,
  paperLiveCredentialSeparationVerified:false,
  brokerKeyPermissionScopeVerified:false,
  exclusiveAccountWriterVerified:false,
  externalWriterExclusionVerified:false,
  mutationEdgeFencingVerified:false,
  operationalEligible:false,
  paperBrokerSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
 });
};
function secretListShape(v){
 if(!object(v)||!Number.isInteger(v.total_count)
   ||v.total_count<0||v.total_count>100
   ||!Array.isArray(v.secrets)||v.total_count!==v.secrets.length)
  return {valid:false,names:[]};
 const names=[];
 for(const row of v.secrets){
  if(!object(row)||!validSecretName(row.name)
     ||forbiddenMetadataKeys.some(k=>Object.hasOwn(row,k)))
   return {valid:false,names:[]};
  names.push(row.name);
 }
 return {valid:new Set(names).size===names.length,names};
}
function checkedPair(names){
 const present=PAIR.filter(k=>names.includes(k));
 return present.length===PAIR.length;
}
function accountShape(v){
 return object(v)&&typeof v.id==='string'&&UUID.test(v.id)
  &&typeof v.status==='string'&&v.status.length>0&&v.status.length<=40
  &&typeof v.trading_blocked==='boolean'
  &&typeof v.account_blocked==='boolean'
  &&typeof v.trade_suspended_by_user==='boolean'
  &&(v.account_number===undefined||v.account_number===null
    ||typeof v.account_number==='string');
}
/**
 * Inspect synthetic or caller-supplied, UNTRUSTED API-shaped metadata.
 * Never echo account IDs, numbers, credentials, or provider response bodies.
 */
export function inspectPaperBrokerCredentialMetadataCandidate(input={}){
 const x=object(input)?input:{},issues=[];
 if(!exact(x,ROOT)||x.schemaVersion!=='paper-broker-credential-metadata-candidate-v1'
   ||x.repository!==REPO||x.reviewedSourceCommit!==SOURCE)
  issues.push('CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
 if(!exact(x.authorityClaims,CLAIMS)
   ||CLAIMS.some(k=>x.authorityClaims?.[k]!==false))
  issues.push('FORGED_ACCOUNT_OR_SECRET_AUTHORITY_CLAIM');
 const inv=inspectPaperBrokerSecretSourceSurface({
  schemaVersion:'paper-broker-secret-source-surface-v1',
  repository:REPO,reviewedSourceCommit:SOURCE,baseline:x.baseline,
  authorityClaims:{
   brokerSecretValuesRead:false,brokerCredentialsExistVerified:false,
   paperAccountIdentityVerified:false,liveAccountExcluded:false,
   brokerKeysExhaustivelyEnumerated:false,externalWritersExcluded:false,
   allMutationEdgesFenced:false,independentReplayEnforced:false,
   humanOperationalApprovalObtained:false,operationalEligible:false,
  },
 });
 if(inv.status!=='HOLD_EXTERNAL_BROKER_WRITER_INVENTORY_NOT_VERIFIED')
  issues.push('REVIEWED_BROKER_SOURCE_INVENTORY_INVALID');
 const repo=secretListShape(x.repoSecrets);
 const env=secretListShape(x.environmentSecrets);
 if(!repo.valid)issues.push('REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
 if(!env.valid)issues.push('ENVIRONMENT_SECRET_NAME_INVENTORY_INVALID');
 if(repo.valid&&repo.names.some(n=>n.startsWith('ALPACA_')&&!PAIR.includes(n))
  ||env.valid&&env.names.some(n=>n.startsWith('ALPACA_')&&!PAIR.includes(n)))
  issues.push('UNREVIEWED_ALPACA_SECRET_NAME');
 if(!accountShape(x.paperAccount))
  issues.push('PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
 return report(issues,{
  repoPair:repo.valid&&checkedPair(repo.names),
  envPair:env.valid&&checkedPair(env.names),
 });
}
/**
 * Optional GET-only client: exact GitHub repository and PAPER Environment
 * secret *metadata* endpoints, followed by PAPER account GET. No LIVE host
 * is ever formed. Transport may be malicious and ignore AbortSignal, so no
 * guaranteed wall-clock deadline or independent provenance attestation.
 */
export async function readPaperBrokerCredentialMetadataCandidate(input={}){
 const x=object(input)?input:{};
 const credential=v=>typeof v==='string'&&v.length>=8&&v.length<=4096
  &&/^[\x21-\x7e]+$/.test(v);
 if(!credential(x.githubToken)||!credential(x.alpacaKeyId)
   ||!credential(x.alpacaSecretKey)
   ||typeof x.fetchImpl!=='function'||!object(x.signal)
   ||typeof x.signal.addEventListener!=='function'
   ||typeof x.signal.aborted!=='boolean'||x.signal.aborted)
  return report(['READ_ONLY_CREDENTIAL_METADATA_TRANSPORT_INVALID']);
 const GH='https://api.github.com/repos/'+REPO;
 const PAPER='https://paper-api.alpaca.markets';
 const reqs=[
  {
   url:GH+'/actions/secrets?per_page=100&page=1',
   headers:{
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    Authorization:'Bearer '+x.githubToken,
   },
  },
  {
   url:GH+'/environments/'+ENV+'/secrets?per_page=100&page=1',
   headers:{
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    Authorization:'Bearer '+x.githubToken,
   },
  },
  {
   url:PAPER+'/v2/account',
   headers:{
    Accept:'application/json',
    'APCA-API-KEY-ID':x.alpacaKeyId,
    'APCA-API-SECRET-KEY':x.alpacaSecretKey,
   },
  },
 ];
 async function get(request){
  if(x.signal.aborted)throw Error('ABORTED');
  const resp=await x.fetchImpl(request.url,{
   method:'GET',headers:Object.freeze(request.headers),
   redirect:'error',cache:'no-store',signal:x.signal,
  });
  if(resp?.status!==200||typeof resp.body?.getReader!=='function')
   throw Error('UNEXPECTED_HTTP');
  const media=resp.headers?.get?.('content-type');
  if(typeof media!=='string'
    ||!/^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(media))
   throw Error('NON_JSON');
  const length=resp.headers?.get?.('content-length');
  if(length!=null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))
   throw Error('INVALID_LENGTH');
  if(/rel\s*=\s*"?next"?/i.test(resp.headers?.get?.('link')||''))
   throw Error('INCOMPLETE_LIST_PAGE');
  const reader=resp.body.getReader();
  let bytes=0;const chunks=[];
  try{
   for(;;){
    if(x.signal.aborted)throw Error('ABORTED');
    const {done,value}=await reader.read();
    if(done)break;
    if(!(value instanceof Uint8Array))throw Error('INVALID_CHUNK');
    bytes+=value.byteLength;
    if(bytes>MAX_BYTES)throw Error('TOO_LARGE');
    chunks.push(Buffer.from(value));
   }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  if(length!=null&&Number(length)!==bytes)throw Error('LENGTH_MISMATCH');
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
 }
 try{
  const repoSecrets=await get(reqs[0]);
  const environmentSecrets=await get(reqs[1]);
  const paperAccount=await get(reqs[2]);
  return inspectPaperBrokerCredentialMetadataCandidate({
   schemaVersion:'paper-broker-credential-metadata-candidate-v1',
   repository:REPO,reviewedSourceCommit:SOURCE,
   baseline:x.baseline,repoSecrets,environmentSecrets,paperAccount,
   authorityClaims:Object.fromEntries(CLAIMS.map(k=>[k,false])),
  });
 }catch{
  // Never log a provider error, token, account identifier, raw payload or URL.
  return report(['READ_ONLY_ACCOUNT_OR_GITHUB_METADATA_UNAVAILABLE']);
 }
}
