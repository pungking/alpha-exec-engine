/**
 * STEP 5C-4D-3X — source-only Alpaca broker API endpoint audit.
 * 9 broker secret-reference Jobs: 6 literal PAPER URLs; 3 unresolved repo
 * variable routes. Source URL is never runtime host/account attestation.
 * Pure offline: NO network, token lookup, broker mutation or source writes.
 */
import { canonical, parseWorkflow, sha256 } from '../check-paper-workflow-admission.mjs';
import { inspectPaperBrokerSecretSourceSurface } from './paper-broker-secret-source-surface.mjs';

const REPO='pungking/alpha-exec-engine';
const MAIN_SHA='0cd1f54fa6d6f7f8220540a193cdcbbdf499e994';
const FROZEN_SOURCE='4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const PAPER='https://paper-api.alpaca.markets';
const EX=String.fromCharCode(36,123,123);
const VARIABLE=EX+' vars.ALPACA_BASE_URL }}';
const FALLBACK=EX+" vars.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets' }}";
const KEY_ID=EX+' secrets.ALPACA_KEY_ID }}';
const SECRET=EX+' secrets.ALPACA_SECRET_KEY }}';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const EXPECTED=Object.freeze([
 ['dry-run.yml','dry-run','d087452689905f0a07fbb8051ba62b7f120166063577b96fec021cbb88c6a3c6',VARIABLE],
 ['market-guard.yml','market-guard','b8769423e19913668976e096e9a91564ca977ac9dfa9169430db515afbf3fefa',VARIABLE],
 ['ledger-filled-migration.yml','ledger-filled-migration','cc6aa0588ed7022256518d506db03165220e4291c6c884a2c6c14c67631a7926',FALLBACK],
 ['paper-five-row-broker-evidence-recovery.yml','restore-and-read','90b691f49b6862e83657cd301d9dd36f5bf4105d52b7c3f043d37ed6faa7b630',PAPER],
 ['paper-oco-read-verify.yml','read-verify','5e132d0466f139b074493fb8d066adf988b4712209b960044bd2980f71139246',PAPER],
 ['paper-oco-submit-canary.yml','submit-canary','7bddd98b4fd442959a00761a31af7ee3d0fb89f908291b6594f6d87034e90339',PAPER],
 ['persistent-oco-repair-open-verify-multi.yml','verify-open-protection-multi','fd466dacf8a79a36e35bee2b101b2e4ac95596b6d0be2d9f2fb37f31187afe36',PAPER],
 ['persistent-oco-repair-open-verify.yml','verify-open-protection','eacd43d2968050496953cb3ac48253376c6303305da0b4587cb0ed63f2057aec',PAPER],
 ['persistent-oco-repair-submit.yml','submit-persistent-repair','03a3ad8692120b035084fdad233cefe399ce3a5db1585194e2f7aa0d3b484f86',PAPER],
].map(r=>Object.freeze({file:r[0],job:r[1],definitionSha256:r[2],baseUrl:r[3]})));
export const PAPER_BROKER_ENDPOINT_REVIEWED_JOBS=EXPECTED;
const INPUT=['schemaVersion','repository','reviewedMainSha','baseline','workflowSources','authorityClaims'];
const AUTH=['actualGithubVariableRead','allRuntimeBrokerHostsPinned',
 'liveBrokerHostnameExcluded','brokerKeyOrderPrivilegesExcluded',
 'externalAccountWritersExcluded','allMutationEdgesFenced',
 'exactJobApprovalVerified','humanOperationalApproval','operationalEligible'];
function result(errors){
 const ok=errors.length===0;
 return Object.freeze({
  schemaVersion:'paper-broker-endpoint-source-audit-v1',
  status:ok?'HOLD_THREE_BROKER_ENDPOINT_VARIABLES_UNATTESTED'
    :'DENY_BROKER_ENDPOINT_REVIEWED_SOURCE_DRIFT',
  findings:Object.freeze([...new Set(errors)].sort()),
  reviewedSourceDefinitionsMatched:ok,
  sourceBrokerCredentialJobs:ok?9:null,
  sourceFixedPaperUrlJobs:ok?6:null,
  sourceUnresolvedVariableUrlJobs:ok?3:null,
  variableRoutingJobs:ok?Object.freeze(EXPECTED.filter(x=>x.baseUrl!==PAPER)
    .map(x=>x.file+'#'+x.job)):Object.freeze([]),
  proofGaps:Object.freeze([
   'GITHUB_ALPACA_BASE_URL_VARIABLE_VALUE_NOT_OBSERVED',
   'PAPER_FALLBACK_VARIABLE_CAN_BE_OVERRIDDEN_TO_LIVE',
   'LITERAL_PAPER_URL_IS_NOT_RUNTIME_HOST_ATTESTATION',
   'NESTED_SCRIPTS_AND_EXTERNAL_CLIENTS_MAY_CHOOSE_OTHER_HOSTS',
   'BROKER_KEY_ORDER_CAPABILITIES_AND_PAPER_LIVE_ISOLATION_UNVERIFIED',
   'GITHUB_SECRET_ORG_INHERITANCE_AND_RUNTIME_SCOPE_UNATTESTED',
   'EXTERNAL_ACCOUNT_WRITERS_AND_MUTATION_EDGE_FENCE_UNVERIFIED',
   'REPLAY_AND_SEPARATE_HUMAN_OPERATIONAL_APPROVAL_MISSING',
  ]),
  actualGithubVariableVerified:false,
  liveHostExcluded:false,
  runtimeEndpointBound:false,
  paperLiveAccountIsolationVerified:false,
  externalWritersExcluded:false,
  brokerMutationFenced:false,
  exactJobOperationApproved:false,
  operationalEligible:false,
  paperBrokerSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
 });
}
export function inspectPaperBrokerEndpointSourceAudit(input={}){
 const x=obj(input)?input:{},errors=[];
 if(!exact(x,INPUT)||x.schemaVersion!=='paper-broker-endpoint-source-audit-v1'
   ||x.repository!==REPO||x.reviewedMainSha!==MAIN_SHA)
  errors.push('ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
 if(!exact(x.authorityClaims,AUTH)||AUTH.some(k=>x.authorityClaims?.[k]!==false))
  errors.push('UNSUPPORTED_BROKER_ENDPOINT_AUTHORITY_CLAIM');
 const prior=inspectPaperBrokerSecretSourceSurface({
  schemaVersion:'paper-broker-secret-source-surface-v1',
  repository:REPO,reviewedSourceCommit:FROZEN_SOURCE,baseline:x.baseline,
  authorityClaims:{
   brokerSecretValuesRead:false,brokerCredentialsExistVerified:false,
   paperAccountIdentityVerified:false,liveAccountExcluded:false,
   brokerKeysExhaustivelyEnumerated:false,externalWritersExcluded:false,
   allMutationEdgesFenced:false,independentReplayEnforced:false,
   humanOperationalApprovalObtained:false,operationalEligible:false,
  },
 });
 if(prior.status!=='HOLD_EXTERNAL_BROKER_WRITER_INVENTORY_NOT_VERIFIED'
   ||prior.sourceReferencedBrokerJobs!==9)
  errors.push('REVIEWED_ADMISSION_SOURCE_HOLD_INVALID');
 const sources=x.workflowSources;
 if(!exact(sources,EXPECTED.map(e=>e.file))){
  errors.push('NINE_REVIEWED_WORKFLOW_FILES_REQUIRED');
  return result(errors);
 }
 for(const expected of EXPECTED){
  const source=sources[expected.file];
  const record=x.baseline?.workflows?.filter?.(w=>w?.file===expected.file);
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>256*1024
    ||record?.length!==1||record[0].definitionSha256!==expected.definitionSha256){
   errors.push('SOURCE_TEXT_OR_ADMISSION_DIGEST_DRIFT');continue;
  }
  let parsed;
  try{parsed=parseWorkflow(source);}catch{errors.push('WORKFLOW_YAML_PARSE_DENY');continue;}
  if(sha256(canonical(parsed))!==expected.definitionSha256)
   errors.push('WORKFLOW_CANONICAL_SOURCE_SHA_DRIFT');
  const job=parsed.jobs?.[expected.job],env=job?.env;
  if(!obj(job)||!obj(env)||env.ALPACA_KEY_ID!==KEY_ID
    ||env.ALPACA_SECRET_KEY!==SECRET)
   errors.push('REVIEWED_ALPACA_SECRET_JOB_BINDING_DRIFT');
  if(!obj(env)||env.ALPACA_BASE_URL!==expected.baseUrl)
   errors.push('REVIEWED_BROKER_URL_BINDING_DRIFT');
  if(job?.environment!=null)
   errors.push('REVIEWED_ALPACA_JOB_ENVIRONMENT_DRIFT');
 }
 return result(errors);
}
