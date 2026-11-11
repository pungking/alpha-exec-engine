import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 inspectPaperGithubAlpacaVariableProofGap as inspect,
 readPaperGithubAlpacaVariableProofGap as read,
} from './lib/paper-github-alpaca-variable-proof-gap.mjs';
import { PAPER_BROKER_ENDPOINT_REVIEWED_JOBS as TARGETS }
 from './lib/paper-broker-endpoint-source-audit.mjs';

const REPO='pungking/alpha-exec-engine';
const MAIN='111b95195fc6b911f10e23ec1e288360a0849518';
const PAPER='https://paper-api.alpaca.markets';
const BASE=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const SOURCES=Object.fromEntries(TARGETS.map(t=>
 [t.file,fs.readFileSync('.github/workflows/'+t.file,'utf8')]));
const TOKEN='synthetic-github-token-never-leak';
const URL='https://api.github.com/repos/'+REPO+'/actions/variables/ALPACA_BASE_URL';
const AUTH=['actualGithubOriginAttested','historicalVariableResolutionVerified',
 'paperLiveAccountSeparationVerified','effectiveOutboundHostVerified',
 'brokerKeyOrderPermissionExcluded','externalAccountWritersExcluded',
 'brokerMutationFenceEnforced','independentReplayProtected',
 'humanOperationalApprovalObtained','operationalEligible'];
const flags=()=>Object.fromEntries(AUTH.map(k=>[k,false]));
function vars(value=PAPER){
 return {name:'ALPACA_BASE_URL',value,
  created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-10T00:00:00Z'};
}
function fixture(value=PAPER){
 return {
  schemaVersion:'paper-github-alpaca-base-url-proof-gap-v1',
  repository:REPO,reviewedMainSha:MAIN,
  baseline:structuredClone(BASE),workflowSources:{...SOURCES},
  variableBefore:vars(value),variableAfter:vars(value),authorityClaims:flags(),
 };
}
let checks=0;
function safe(r){
 for(const k of ['githubVariableValueExposed','trueGithubOriginAttested',
  'variableAtRunTimeVerified','actualRuntimeBrokerHostVerified',
  'liveBrokerHostExcluded','paperLiveCredentialSeparationVerified',
  'brokerKeyWriteCapabilityExcluded','externalWritersExcluded',
  'accountWideMutationFenceVerified','operationalEligible',
  'paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])assert.equal(r[k],false,k);
 assert.ok(r.proofGaps.includes(
  'CURRENT_VARIABLE_VALUE_NOT_HISTORICAL_RUN_RESOLUTION'));
 for(const sensitive of ['synthetic-github-token-never-leak',
  'https://api.alpaca.markets','paper-alpaca-key','secret-private-value'])
  assert.ok(!JSON.stringify(r).includes(sensitive),'sensitive value reflection');
}
function hold(x){
 const r=inspect(x);
 assert.equal(r.status,'HOLD_UNATTESTED_REPO_PAPER_VARIABLE_CANDIDATE',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceNineBrokerJobsBound,true);
 assert.equal(r.reviewedVariableDependentJobs,3);
 assert.equal(r.reviewedLiteralPaperUrlJobs,6);
 assert.equal(r.candidateRepoVariableMatchedAcrossTwoReads,true);
 assert.equal(r.untrustedVariableClassification,'PAPER_LITERAL_CANDIDATE');
 safe(r);checks++;return r;
}
function deny(x,expected){
 const r=inspect(x);
 assert.equal(r.status,'DENY_UNVERIFIED_OR_UNSAFE_BROKER_VARIABLE');
 assert.ok(r.findings.includes(expected),JSON.stringify(r.findings));
 assert.equal(r.operationalEligible,false);
 safe(r);checks++;
}
const mutate=(fn,code)=>{const x=fixture();fn(x);deny(x,code);};
hold(fixture());
deny(null,'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
deny({},'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
mutate(x=>{x.schemaVersion='OPERATIONAL';},'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
mutate(x=>{x.repository='another/owner';},'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
mutate(x=>{x.reviewedMainSha='f'.repeat(40);},'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
mutate(x=>{x.externalBrokerApproved=true;},'REVIEWED_REPO_VARIABLE_SCOPE_OR_SHA_INVALID');
for(const k of AUTH)mutate(x=>{x.authorityClaims[k]=true;},
 'FORGED_VARIABLE_OR_BROKER_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.actualLiveSafe=true;},
 'FORGED_VARIABLE_OR_BROKER_AUTHORITY_CLAIM');
mutate(x=>{delete x.authorityClaims;},
 'FORGED_VARIABLE_OR_BROKER_AUTHORITY_CLAIM');
mutate(x=>{x.baseline.operationalHold=false;},
 'NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
mutate(x=>{x.baseline.settingsEvidence='ATTESTED';},
 'NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
mutate(x=>{x.baseline.workflows.pop();},
 'NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
mutate(x=>{delete x.workflowSources['dry-run.yml'];},
 'NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
mutate(x=>{x.workflowSources['market-guard.yml']=x.workflowSources['market-guard.yml']
 .replace('vars.ALPACA_BASE_URL','vars.LIVE_BASE_URL');},
 'NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID');
const badVariable=(fn,code='GITHUB_VARIABLE_RESPONSE_INVALID')=>{
 const x=fixture();fn(x.variableBefore);deny(x,code);
};
badVariable(v=>{v.name='ALPACA_SECRET_KEY';});
badVariable(v=>{v.value='';});
badVariable(v=>{v.value=null;});
badVariable(v=>{v.value='has a space';});
badVariable(v=>{v.value='a'.repeat(513);});
badVariable(v=>{v.created_at='2026-11-31T00:00:00Z';});
badVariable(v=>{v.created_at='2026-11-01T25:00:00Z';});
badVariable(v=>{v.updated_at='2026-10-31T00:00:00Z';});
badVariable(v=>{v.updated_at='not-a-date';});
badVariable(v=>{v.secret='secret-private-value';});
badVariable(v=>{delete v.created_at;});
mutate(x=>{x.variableAfter.name='ANOTHER_VAR';},
 'GITHUB_VARIABLE_RESPONSE_INVALID');
mutate(x=>{x.variableAfter.updated_at='2026-11-11T00:00:00Z';},
 'NON_ATOMIC_GITHUB_VARIABLE_READ_CHANGED');
mutate(x=>{x.variableAfter.created_at='2026-10-31T00:00:00Z';},
 'NON_ATOMIC_GITHUB_VARIABLE_READ_CHANGED');
mutate(x=>{x.variableAfter.value='https://api.alpaca.markets';},
 'NON_ATOMIC_GITHUB_VARIABLE_READ_CHANGED');
for(const value of [
 'https://api.alpaca.markets',
 'http://paper-api.alpaca.markets',
 'https://paper-api.alpaca.markets/',
 'https://paper-api.alpaca.markets.evil.org',
 'https://paper-api.alpaca.markets:443',
 'https://paper-api.alpaca.markets/v2/orders',
 'https://example.com',
 'https://PAPER-api.alpaca.markets',
 'https://paper-api.alpaca.markets?token=safe',
]){
 deny(fixture(value),'BROKER_VARIABLE_IS_NOT_EXACT_PAPER_HOST');
}
const proof=hold(fixture());
assert.ok(!JSON.stringify(proof).includes('https://paper-api.alpaca.markets'));
checks++;
const signal=()=>new AbortController().signal;
function mock(value=PAPER,opts={}){
 let calls=0;
 return {fetchImpl:async(url,request)=>{
  const n=calls++;
  assert.ok(n<2,'only exactly two GETs allowed');
  assert.equal(url,URL);
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  assert.equal(request.cache,'no-store');
  assert.equal(request.body,undefined);
  assert.equal(request.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(request.headers['X-GitHub-Api-Version'],'2022-11-28');
  assert.equal(request.headers['APCA-API-SECRET-KEY'],undefined);
  assert.ok(request.signal&&!request.signal.aborted);
  if(opts.throwAt===n)throw Error('SECRET synthetic-github-token-never-leak');
  const payload=vars(value);
  if(opts.updatedAtSecond&&n===1)payload.updated_at=opts.updatedAtSecond;
  const body=opts.badAt===n?opts.body:JSON.stringify(payload);
  const status=opts.badAt===n&&opts.status?opts.status:200;
  const headers={'content-type':opts.badAt===n&&opts.media?opts.media:'application/json'};
  if(opts.badAt===n&&opts.length!==undefined)
    headers['content-length']=opts.length;
  return new Response(body,{status,headers});
 },count:()=>calls};
}
async function collect(value=PAPER,options={},source=fixture()){
 const m=mock(value,options);
 const result=await read({githubToken:TOKEN,fetchImpl:m.fetchImpl,
  signal:signal(),baseline:source.baseline,workflowSources:source.workflowSources});
 return {result,count:m.count()};
}
{
 const r=await collect();assert.equal(r.count,2);
 assert.equal(r.result.status,'HOLD_UNATTESTED_REPO_PAPER_VARIABLE_CANDIDATE');
 safe(r.result);checks++;
}
{
 const r=await collect('https://api.alpaca.markets');
 assert.equal(r.count,2);
 assert.ok(r.result.findings.includes('BROKER_VARIABLE_IS_NOT_EXACT_PAPER_HOST'));
 safe(r.result);checks++;
}
{
 const input=fixture();input.baseline.operationalHold=false;
 const r=await collect(PAPER,{},input);
 assert.equal(r.count,0,'invalid source must make zero GitHub requests');
 assert.ok(r.result.findings.includes('NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID'));
 safe(r.result);checks++;
}
{
 const input=fixture();input.workflowSources['market-guard.yml']=
 input.workflowSources['market-guard.yml'].replace('vars.ALPACA_BASE_URL','vars.OTHER_HOST');
 const r=await collect(PAPER,{},input);
 assert.equal(r.count,0,'unreviewed source must make zero GitHub requests');
 assert.ok(r.result.findings.includes('NINE_JOB_BROKER_ENDPOINT_REVIEW_INVALID'));
 safe(r.result);checks++;
}
{
 const r=await collect(PAPER,{updatedAtSecond:'2026-11-11T00:00:00Z'});
 assert.equal(r.count,2);
 assert.ok(r.result.findings.includes('NON_ATOMIC_GITHUB_VARIABLE_READ_CHANGED'));
 safe(r.result);checks++;
}
for(const opts of [
 {badAt:0,status:401,body:'{}'},
 {badAt:0,status:403,body:'{}'},
 {badAt:0,status:404,body:'{}'},
 {badAt:1,status:404,body:'{}'},
 {badAt:1,status:429,body:'{}'},
 {badAt:0,media:'text/html',body:'{}'},
 {badAt:1,media:'text/plain',body:'{}'},
 {badAt:0,body:'{bad-json'},
 {badAt:1,body:'{bad-json'},
 {badAt:0,body:'[]'},
 {badAt:0,body:'{}',length:'99999'},
 {badAt:1,body:'{}',length:'abc'},
 {badAt:1,body:'{}',length:'10'},
 {badAt:1,body:'"'+('x'.repeat(8192+1))+'"'},
 {throwAt:0},
 {throwAt:1},
]){
 const r=await collect(PAPER,opts);
 assert.equal(r.result.status,'DENY_UNVERIFIED_OR_UNSAFE_BROKER_VARIABLE');
 const expected=opts.badAt===0&&opts.body==='[]'
  ?'GITHUB_VARIABLE_RESPONSE_INVALID':'READ_ONLY_GITHUB_VARIABLE_UNAVAILABLE';
 assert.ok(r.result.findings.includes(expected),JSON.stringify(r.result.findings));
 safe(r.result);checks++;
}
for(const args of [
 {},
 {githubToken:'bad token',fetchImpl:()=>{throw Error('should-not-call');},signal:signal()},
 {githubToken:TOKEN,fetchImpl:()=>{throw Error('should-not-call');}},
]){
 const r=await read(args);
 assert.ok(r.findings.includes('READ_ONLY_VARIABLE_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;
}
{const ctrl=new AbortController();ctrl.abort();
 const r=await read({githubToken:TOKEN,fetchImpl:()=>{throw Error('should-not-call');},
  signal:ctrl.signal});
 assert.ok(r.findings.includes('READ_ONLY_VARIABLE_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;}
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_GITHUB_ALPACA_VARIABLE_PROOF_GAP_PASS',
 checks,variableRoutingSourceJobs:3,literalPaperUrlJobs:6,
 syntheticGetRequests:2,actualGithubVariableRequests:0,
 actualBrokerRequests:0,externalStateWrites:0,operationalAuthorityGranted:0,
}));
