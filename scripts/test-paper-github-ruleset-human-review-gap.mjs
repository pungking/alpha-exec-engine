import assert from 'node:assert/strict';
import {
 inspectPaperGithubRulesetHumanReviewGap as inspect,
 readPaperGithubRulesetHumanReviewGap as read,
} from './lib/paper-github-ruleset-human-review-gap.mjs';
const REPO='pungking/alpha-exec-engine';
const BASE='c217e9031ad4c33a7b2def12e8561d4904347842';
const TOKEN='synthetic-not-a-real-gh-token';
const ROOT='https://api.github.com/repos/'+REPO;
const IDS=[
 {id:26952584,name:'alpha-main-source-protection',ref:'refs/heads/main'},
 {id:26956735,name:'alpha-paper-state-admission-hold',ref:'refs/heads/paper-state'},
 {id:26956389,name:'alpha-paper-state-integrity',ref:'refs/heads/paper-state'},
];
const AUTH=['humanGithubApproveObtained','githubOriginIndependentlyAttested',
 'atRunRulesetEnforcementVerified','environmentPolicyVerified',
 'exactJobDeploymentApproved','brokerAccountWritersExcluded',
 'brokerMutationFencingVerified','independentReplayEnforced',
 'separateHumanOperationalApproval','operationalEligible'];
const flags=()=>Object.fromEntries(AUTH.map(x=>[x,false]));
const rule=type=>({type});
function fixture(count=0){
 const list=IDS.map(({id,name})=>({id,name,target:'branch',enforcement:'active'}));
 const details=Object.fromEntries(['main','paperHold','paperIntegrity'].map((key,i)=>[
 key,{id:IDS[i].id,name:IDS[i].name,target:'branch',enforcement:'active',
 bypass_actors:[],conditions:{ref_name:{include:[IDS[i].ref],exclude:[]}},
 rules:i===0?[
  rule('deletion'),rule('non_fast_forward'),
  {type:'pull_request',parameters:{
    required_approving_review_count:count,
    allowed_merge_methods:['merge'],require_code_owner_review:false,
    require_last_push_approval:false,required_review_thread_resolution:false,
  }},
  {type:'required_status_checks',parameters:{
    strict_required_status_checks_policy:true,
    do_not_enforce_on_create:false,
    required_status_checks:[{context:'build',integration_id:15368}],
  }},
 ]:i===1?[rule('creation'),rule('update')]
  :[rule('deletion'),rule('non_fast_forward')],
 }]));
 return {schemaVersion:'paper-github-ruleset-human-review-gap-v1',
  repository:REPO,reviewedBaseSha:BASE,list,details,authorityClaims:flags()};
}
let checks=0,actualGithubRequests=0,brokerRequests=0,externalWrites=0;
const safe=r=>{
 for(const key of ['trustedGithubOriginVerified','githubIndependentHumanReviewVerified',
  'rulesetHistoricalEnforcementVerified','environmentAtRunVerified',
  'exactWriterJobApprovalVerified','accountWideBrokerWriterFencingVerified',
  'replayControlVerified','operationalEligible','paperBrokerSubmitAuthorized',
  'paperStateMutationAuthorized','liveTradingAuthorized'])
  assert.equal(r[key],false,key);
 assert.ok(r.proofGaps.includes('CODE_REVIEW_COMMENT_NOT_GITHUB_APPROVE'));
 assert.ok(r.proofGaps.includes('PAPER_STATE_RULESETS_DO_NOT_PROVE_BROKER_WRITER_EXCLUSIVITY'));
};
const held=(x,status,count)=>{
 const r=inspect(x);
 assert.equal(r.status,status,JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceRulesetShapeMatched,true);
 assert.equal(r.observedRequiredApprovingReviewCount,count);
 safe(r);checks++;return r;
};
const denied=(x,reason)=>{
 const r=inspect(x);
 assert.equal(r.status,'DENY_GITHUB_RULESET_SCOPE_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.sourceRulesetShapeMatched,false);
 assert.equal(r.observedRequiredApprovingReviewCount,null);
 safe(r);checks++;return r;
};
const mutate=(fn,reason)=>{
 const x=fixture();fn(x);denied(x,reason);
};
const ZERO='HOLD_MAIN_HAS_ZERO_REQUIRED_HUMAN_APPROVALS';
const POSITIVE='HOLD_GITHUB_REVIEW_POLICY_UNATTESTED';
held(fixture(),ZERO,0);
held(fixture(1),POSITIVE,1);
held(fixture(2),POSITIVE,2);
denied(null,'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
denied({},'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
mutate(x=>{x.schemaVersion='TRUSTED';},'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
mutate(x=>{x.repository='attacker/repo';},'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
mutate(x=>{x.reviewedBaseSha='f'.repeat(40);},'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
mutate(x=>{x.allowTrade=true;},'SOURCE_RULESET_ENVELOPE_OR_SHA_INVALID');
for(const k of AUTH)mutate(x=>{x.authorityClaims[k]=true;},
 'UNSUPPORTED_RULESET_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.adminApproved=true;},
 'UNSUPPORTED_RULESET_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{delete x.authorityClaims;},
 'UNSUPPORTED_RULESET_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.list.pop();},'REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
mutate(x=>{x.list[0].enforcement='disabled';},'REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
mutate(x=>{x.list[0].id=99;},'REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
mutate(x=>{x.list[0].id=x.list[1].id;},'REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
mutate(x=>{x.list.push({id:4,name:'unknown',target:'branch',enforcement:'active'});},
 'REVIEWED_ACTIVE_RULESET_LIST_DRIFT');
mutate(x=>{x.details.main.id=99;},'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.paperHold.enforcement='disabled';},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.paperIntegrity.name='unreviewed';},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.main.bypass_actors.push({actor_id:1,actor_type:'User'});},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.paperHold.bypass_actors.push({actor_id:2,actor_type:'Team'});},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.paperIntegrity.conditions.ref_name.include=['refs/heads/main'];},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.main.conditions.ref_name.exclude=['refs/heads/main'];},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.main.conditions.ref_name.include=['refs/heads/*'];},
 'RULESET_DETAIL_IDENTITY_OR_BYPASS_DRIFT');
mutate(x=>{x.details.main.rules.push(rule('update'));},'MAIN_RULE_TYPES_DRIFT');
mutate(x=>{x.details.main.rules=x.details.main.rules.filter(r=>r.type!=='deletion');},
 'MAIN_RULE_TYPES_DRIFT');
mutate(x=>{x.details.paperHold.rules=[rule('update')];},
 'PAPER_STATE_ADMISSION_HOLD_RULES_DRIFT');
mutate(x=>{x.details.paperIntegrity.rules=[rule('deletion')];},
 'PAPER_STATE_INTEGRITY_RULES_DRIFT');
mutate(x=>{x.details.main.rules.find(r=>r.type==='pull_request').parameters.required_approving_review_count=-1;},
 'MAIN_PR_MERGE_REVIEW_CONSTRAINTS_INVALID');
mutate(x=>{x.details.main.rules.find(r=>r.type==='pull_request').parameters.required_approving_review_count=1.5;},
 'MAIN_PR_MERGE_REVIEW_CONSTRAINTS_INVALID');
mutate(x=>{x.details.main.rules.find(r=>r.type==='pull_request').parameters.allowed_merge_methods=['squash'];},
 'MAIN_PR_MERGE_REVIEW_CONSTRAINTS_INVALID');
mutate(x=>{x.details.main.rules.find(r=>r.type==='required_status_checks').parameters.strict_required_status_checks_policy=false;},
 'MAIN_REQUIRED_BUILD_CHECK_POLICY_DRIFT');
mutate(x=>{x.details.main.rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks[0].context='untrusted';},
 'MAIN_REQUIRED_BUILD_CHECK_POLICY_DRIFT');
mutate(x=>{x.details.main.rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks[0].integration_id=9;},
 'MAIN_REQUIRED_BUILD_CHECK_POLICY_DRIFT');
mutate(x=>{x.details.main.rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks=[];},
 'MAIN_REQUIRED_BUILD_CHECK_POLICY_DRIFT');
const secret=fixture();secret.details.main.providerToken='SYNTHETIC_SECRET_NOT_LOGGED';
const result=held(secret,ZERO,0);
assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_NOT_LOGGED'));checks++;
const signal=()=>new AbortController().signal;
function mock(source=fixture(),opts={}){
 const paths=['/rulesets?per_page=100&page=1',
 '/rulesets/26952584','/rulesets/26956735','/rulesets/26956389'];
 const bodies=[source.list,source.details.main,source.details.paperHold,
  source.details.paperIntegrity];
 let calls=0;
 return {fake:async(url,request)=>{
  const index=calls++;
  assert.ok(index<4);assert.equal(url,ROOT+paths[index]);
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  assert.equal(request.cache,'no-store');
  assert.equal(request.body,undefined);
  assert.equal(request.headers.Authorization,'Bearer '+TOKEN);
  assert.ok(request.signal&&!request.signal.aborted);
  if(opts.throwAt===index)throw Error('secret must not escape '+TOKEN);
  const content=opts.badAt===index?opts.body:JSON.stringify(bodies[index]);
  const status=opts.badAt===index&&opts.status?opts.status:200;
  const headers={'content-type':opts.badAt===index&&opts.media?opts.media:'application/json'};
  if(opts.badAt===index&&opts.length!==undefined)
   headers['content-length']=opts.length;
  if(opts.badAt===index&&opts.link)
   headers.link=opts.link;
  return new Response(content,{status,headers});
 },count:()=>calls};
}
async function readMock(source=fixture(),options={}){
 const m=mock(source,options);
 const result=await read({token:TOKEN,fetchImpl:m.fake,signal:signal()});
 return {result,count:m.count()};
}
{const o=await readMock();assert.equal(o.count,4);
 assert.equal(o.result.status,ZERO);safe(o.result);checks++;}
{const o=await readMock(fixture(1));assert.equal(o.count,4);
 assert.equal(o.result.status,POSITIVE);safe(o.result);checks++;}
for(const opt of [
 {badAt:0,status:403,body:'{}'},
 {badAt:1,status:404,body:'{}'},
 {badAt:2,status:429,body:'{}'},
 {badAt:3,status:503,body:'{}'},
 {badAt:0,media:'text/html',body:'{}'},
 {badAt:1,media:'text/plain',body:'{}'},
 {badAt:0,body:'{bad json'},
 {badAt:2,body:'{bad json'},
 {badAt:0,body:'[]'},
 {badAt:1,body:'{}',length:'7'},
 {badAt:2,body:'{}',length:'1'},
 {badAt:3,body:'{}',length:'999999'},
 {badAt:0,body:'{}',length:'wrong'},
 {badAt:1,link:'<https://api.github.com/next>; rel="next"',body:'{}'},
 {badAt:1,body:'"'+('x'.repeat(128*1024+1))+'"'},
 {throwAt:0},
 {throwAt:3},
]){
 const {result}=await readMock(fixture(),opt);
 assert.equal(result.status,'DENY_GITHUB_RULESET_SCOPE_INVALID');
 assert.ok(result.findings.includes('READ_ONLY_GITHUB_RULESET_SNAPSHOT_UNAVAILABLE'));
 safe(result);checks++;
}
for(const args of [
 {},
 {token:'bad key',fetchImpl:()=>{throw Error('must not call');},signal:signal()},
 {token:TOKEN,fetchImpl:()=>{throw Error('must not call');}},
]){
 const r=await read(args);
 assert.ok(r.findings.includes('READ_ONLY_RULESET_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;
}
{const c=new AbortController();c.abort();
 const r=await read({token:TOKEN,fetchImpl:()=>{throw Error('must not call');},signal:c.signal});
 assert.ok(r.findings.includes('READ_ONLY_RULESET_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;}
assert.equal(actualGithubRequests,0);
assert.equal(brokerRequests,0);
assert.equal(externalWrites,0);
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_GITHUB_RULESET_HUMAN_REVIEW_GAP_PASS',
 checks,requiredHumanReviewsInObservedFixture:0,
 protectedRulesets:3,actualGithubRequests,brokerRequests,
 externalStateWrites:externalWrites,operationalAuthorityGranted:0,
}));
