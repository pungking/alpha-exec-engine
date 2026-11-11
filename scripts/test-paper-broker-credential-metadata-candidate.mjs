import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 inspectPaperBrokerCredentialMetadataCandidate as inspect,
 readPaperBrokerCredentialMetadataCandidate as read,
} from './lib/paper-broker-credential-metadata-candidate.mjs';

const REPO='pungking/alpha-exec-engine';
const SOURCE='4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const BASE=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const GH='https://api.github.com/repos/'+REPO;
const PAPER='https://paper-api.alpaca.markets';
const TOKEN='synthetic-gh-only-token';
const KEY='synthetic-paper-key-id';
const SECRET='synthetic-paper-secret-key';
const UUID='7e4662b5-8654-4acd-a497-32e4ab153504';
const CLAIMS=['githubSecretValuesRetrieved','repoSecretsScopeAttested',
 'orgSecretsExcluded','actualJobSecretsAccessibleVerified',
 'paperCredentialsReadOnlyVerified','paperLiveSeparationProven',
 'brokerAccountWriterInventoryComplete','externalWritersExcluded',
 'mutationEdgeFencingVerified','humanOperationApproved','operationalEligible'];
const flags=()=>Object.fromEntries(CLAIMS.map(k=>[k,false]));
const names=arr=>({total_count:arr.length,
 secrets:arr.map(name=>({name,created_at:'2026-11-01T00:00:00Z',
  updated_at:'2026-11-10T00:00:00Z'}))});
function fixture(){
 return {
  schemaVersion:'paper-broker-credential-metadata-candidate-v1',
  repository:REPO,reviewedSourceCommit:SOURCE,
  baseline:structuredClone(BASE),
  repoSecrets:names(['ALPACA_KEY_ID','ALPACA_SECRET_KEY','NOTION_TOKEN']),
  environmentSecrets:names([]),
  paperAccount:{id:UUID,account_number:'PRIVATE_NUMBER_MUST_NOT_PRINT',
   status:'ACTIVE',trading_blocked:false,account_blocked:false,
   trade_suspended_by_user:false,buying_power:'PRIVATE_BALANCE_MUST_NOT_PRINT'},
  authorityClaims:flags(),
 };
}
let checks=0;
function safe(result){
 for(const key of ['githubSecretValueRead','authenticGithubMetadataVerified',
  'paperAccountOriginVerified','paperLiveCredentialSeparationVerified',
  'brokerKeyPermissionScopeVerified','exclusiveAccountWriterVerified',
  'externalWriterExclusionVerified','mutationEdgeFencingVerified',
  'operationalEligible','paperBrokerSubmitAuthorized',
  'paperStateMutationAuthorized','liveTradingAuthorized'])
  assert.equal(result[key],false,key);
 assert.equal(result.sourceEvidenceTrust,'CALLER_SUPPLIED_UNVERIFIED');
 assert.ok(result.proofGaps.includes(
  'BROKER_KEY_CAN_HAVE_WRITE_PRIVILEGES_DESPITE_GET_ONLY_USE'));
 for(const value of [UUID,'PRIVATE_NUMBER_MUST_NOT_PRINT',
  'PRIVATE_BALANCE_MUST_NOT_PRINT',TOKEN,KEY,SECRET])
  assert.ok(!JSON.stringify(result).includes(value),'secret reflection');
}
function held(x,status,repoPair,envPair){
 const r=inspect(x);
 assert.equal(r.status,status,JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.repositoryAlpacaPairNamesPresent,repoPair);
 assert.equal(r.environmentAlpacaPairNamesPresent,envPair);
 assert.equal(r.accountPayloadShapeMatched,true);
 assert.equal(r.reviewedSourceBrokerJobCount,9);
 safe(r);checks++;return r;
}
function denied(x,code){
 const r=inspect(x);
 assert.equal(r.status,'DENY_BROKER_CREDENTIAL_METADATA_INVALID');
 assert.ok(r.findings.includes(code),JSON.stringify(r.findings));
 assert.equal(r.accountPayloadShapeMatched,false);
 safe(r);checks++;
}
const change=(mutate,code)=>{
 const x=fixture();mutate(x);denied(x,code);
};
const BOTH='HOLD_UNATTESTED_REPOSITORY_SECRETS_AND_PAPER_ACCOUNT';
const ABSENT='HOLD_REPOSITORY_SECRET_PAIR_ABSENT_OR_PARTIAL';
held(fixture(),BOTH,true,false);
{const x=fixture();x.repoSecrets=names([]);
 held(x,ABSENT,false,false);}
{const x=fixture();x.repoSecrets=names(['ALPACA_KEY_ID']);
 x.environmentSecrets=names(['ALPACA_KEY_ID','ALPACA_SECRET_KEY']);
 held(x,ABSENT,false,true);}
{const x=fixture();x.environmentSecrets=names(['ALPACA_KEY_ID','ALPACA_SECRET_KEY']);
 held(x,BOTH,true,true);}
{const x=fixture();x.paperAccount.trading_blocked=true;
 x.paperAccount.account_blocked=true;held(x,BOTH,true,false);}
denied(null,'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
denied({},'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
change(x=>{x.schemaVersion='APPROVED';},'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
change(x=>{x.repository='untrusted/repo';},'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
change(x=>{x.reviewedSourceCommit='f'.repeat(40);},
 'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
change(x=>{x.operationalEligible=true;},'CANDIDATE_ENVELOPE_OR_SOURCE_INVALID');
for(const claim of CLAIMS)change(x=>{x.authorityClaims[claim]=true;},
 'FORGED_ACCOUNT_OR_SECRET_AUTHORITY_CLAIM');
change(x=>{x.authorityClaims.anotherClaim=true;},
 'FORGED_ACCOUNT_OR_SECRET_AUTHORITY_CLAIM');
change(x=>{delete x.authorityClaims;},
 'FORGED_ACCOUNT_OR_SECRET_AUTHORITY_CLAIM');
change(x=>{x.baseline.operationalHold=false;},
 'REVIEWED_BROKER_SOURCE_INVENTORY_INVALID');
change(x=>{x.baseline.settingsEvidence='ACTUAL_BROKER_ACCESS';},
 'REVIEWED_BROKER_SOURCE_INVENTORY_INVALID');
change(x=>{x.baseline.workflows.pop();},
 'REVIEWED_BROKER_SOURCE_INVENTORY_INVALID');
change(x=>{x.repoSecrets.total_count=4;},'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets.push({name:'ALPACA_KEY_ID'});},
 'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets[0].name='broker/key!';},
 'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets[0].plaintext=SECRET;},
 'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets[0].encrypted_value='SECRET_BYTES';},
 'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets[0].token=TOKEN;},
 'REPOSITORY_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.repoSecrets.secrets[0].name='ALPACA_OTHER_KEY';},
 'UNREVIEWED_ALPACA_SECRET_NAME');
change(x=>{x.environmentSecrets=names(['ALPACA_ADMIN_KEY']);},
 'UNREVIEWED_ALPACA_SECRET_NAME');
change(x=>{x.environmentSecrets.total_count=101;},
 'ENVIRONMENT_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.environmentSecrets.secrets=[{name:'ALPACA_SECRET_KEY',value:SECRET}];
 x.environmentSecrets.total_count=1;},'ENVIRONMENT_SECRET_NAME_INVENTORY_INVALID');
change(x=>{x.paperAccount.id='BAD';},'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{x.paperAccount.status=100;},'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{x.paperAccount.account_blocked='false';},
 'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{delete x.paperAccount.trading_blocked;},
 'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{delete x.paperAccount.trade_suspended_by_user;},
 'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{x.paperAccount.account_number=123;},
 'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
change(x=>{x.paperAccount=null;},'PAPER_ACCOUNT_RESPONSE_SHAPE_INVALID');
const paths=[
 GH+'/actions/secrets?per_page=100&page=1',
 GH+'/environments/PAPER_CUSTODY_APPROVAL/secrets?per_page=100&page=1',
 PAPER+'/v2/account',
];
function transport(f=fixture(),opts={}){
 let calls=0;const payloads=[f.repoSecrets,f.environmentSecrets,f.paperAccount];
 return {
  fetchImpl:async(url,request)=>{
   const i=calls++;
   assert.ok(i<3,'unexpected extra GET');assert.equal(url,paths[i]);
   assert.equal(request.method,'GET');
   assert.equal(request.redirect,'error');
   assert.equal(request.cache,'no-store');
   assert.equal(request.body,undefined);
   assert.ok(request.signal&&!request.signal.aborted);
   if(i<2){
    assert.equal(request.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(request.headers['X-GitHub-Api-Version'],'2022-11-28');
    assert.equal(request.headers['APCA-API-SECRET-KEY'],undefined);
   }else{
    assert.equal(request.headers.Authorization,undefined);
    assert.equal(request.headers['APCA-API-KEY-ID'],KEY);
    assert.equal(request.headers['APCA-API-SECRET-KEY'],SECRET);
   }
   if(opts.throwAt===i)throw Error('MUST_NOT_LEAK '+SECRET);
   const body=opts.badAt===i?opts.body:JSON.stringify(payloads[i]);
   const status=opts.badAt===i&&opts.status?opts.status:200;
   const headers={'content-type':opts.badAt===i&&opts.media?opts.media:'application/json'};
   if(opts.badAt===i&&opts.length!==undefined)
    headers['content-length']=opts.length;
   if(opts.badAt===i&&opts.link)headers.link=opts.link;
   return new Response(body,{status,headers});
  },
  calls:()=>calls,
 };
}
async function readFixture(f=fixture(),opts={}){
 const mock=transport(f,opts);
 const result=await read({githubToken:TOKEN,alpacaKeyId:KEY,
  alpacaSecretKey:SECRET,fetchImpl:mock.fetchImpl,
  signal:new AbortController().signal,baseline:f.baseline});
 return {result,calls:mock.calls()};
}
{const v=await readFixture();assert.equal(v.calls,3);
 assert.equal(v.result.status,BOTH);safe(v.result);checks++;}
{const f=fixture();f.repoSecrets=names([]);
 const v=await readFixture(f);assert.equal(v.calls,3);
 assert.equal(v.result.status,ABSENT);safe(v.result);checks++;}
for(const opts of [
 {badAt:0,status:403,body:'{}'},
 {badAt:1,status:404,body:'{}'},
 {badAt:2,status:401,body:'{}'},
 {badAt:0,media:'text/html',body:'{}'},
 {badAt:1,media:'text/plain',body:'{}'},
 {badAt:2,body:'{bad-json'},
 {badAt:0,body:'{bad-json'},
 {badAt:0,body:'[]'},
 {badAt:1,body:'{}',length:'12'},
 {badAt:2,body:'{}',length:'1'},
 {badAt:0,body:'{}',length:String(96*1024+1)},
 {badAt:1,body:'{}',length:'oops'},
 {badAt:2,link:'<https://api.github.com/next>; rel="next"',body:'{}'},
 {badAt:0,body:'"'+('x'.repeat(96*1024+1))+'"'},
 {throwAt:0},
 {throwAt:2},
]){
 const v=await readFixture(fixture(),opts);
 assert.equal(v.result.status,'DENY_BROKER_CREDENTIAL_METADATA_INVALID');
 assert.ok(v.result.findings.includes(
  'READ_ONLY_ACCOUNT_OR_GITHUB_METADATA_UNAVAILABLE'));
 safe(v.result);checks++;
}
for(const args of [
 {},
 {githubToken:'bad key',alpacaKeyId:KEY,alpacaSecretKey:SECRET,
  fetchImpl:()=>{throw Error('should-not-call');},
  signal:new AbortController().signal},
 {githubToken:TOKEN,alpacaKeyId:KEY,alpacaSecretKey:SECRET,
  fetchImpl:()=>{throw Error('should-not-call');}},
]){
 const r=await read(args);
 assert.ok(r.findings.includes('READ_ONLY_CREDENTIAL_METADATA_TRANSPORT_INVALID'));
 safe(r);checks++;
}
{const c=new AbortController();c.abort();
 const r=await read({githubToken:TOKEN,alpacaKeyId:KEY,
  alpacaSecretKey:SECRET,fetchImpl:()=>{throw Error('should-not-call');},
  signal:c.signal});
 assert.ok(r.findings.includes('READ_ONLY_CREDENTIAL_METADATA_TRANSPORT_INVALID'));
 safe(r);checks++;}
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_BROKER_CREDENTIAL_METADATA_CANDIDATE_PASS',
 checks,sourceBrokerSecretJobs:9,
 syntheticGetRequests:3,actualGithubRequests:0,actualBrokerRequests:0,
 externalStateWrites:0,secretValuesExposed:0,operationalAuthorityGranted:0,
}));
