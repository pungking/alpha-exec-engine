import assert from 'node:assert/strict';
import {
 inspectPaperProtectedEnvironmentPolicyCandidate as inspect,
 readPaperProtectedEnvironmentPolicyCandidate as read,
} from './lib/paper-protected-environment-policy-candidate.mjs';

const ENV='PAPER_CUSTODY_APPROVAL',TOKEN='synthetic-no-real-credential';
const ROOT='https://api.github.com/repos/pungking/alpha-exec-engine';
const PATH='/environments/'+ENV;
const BRANCH=PATH+'/deployment-branch-policies?per_page=100&page=1';
const sample=(mode='custom')=>({
 environment:{
  id:26847620868,name:ENV,
  protection_rules:[
   {id:1,type:'required_reviewers',prevent_self_review:true,
    reviewers:[{type:'User',reviewer:{id:100,login:'synthetic-reviewer'}}]},
   {id:2,type:'branch_policy'},
  ],
  deployment_branch_policy:mode==='custom'
   ?{protected_branches:false,custom_branch_policies:true}
   :{protected_branches:true,custom_branch_policies:false},
 },
 branchPolicies:mode==='custom'
  ?{total_count:1,branch_policies:[{id:200,name:'main'}]}
  :null,
});
let checks=0,realRequests=0,brokerRequests=0,externalWrites=0;
const safe=r=>{
 for(const k of ['trustedGithubApiSourceVerified','policyAtRunTimeVerified',
  'protectedAdmissionApprovalTransferredToWriter','protectedWriterJobApprovalVerified',
  'independentlyVerifiedMainBranchProtection','brokerWriterExclusivityVerified',
  'operationalEligible','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized']) assert.equal(r[k],false,k);
 assert.ok(r.proofGaps.includes('GITHUB_ENVIRONMENT_REVIEW_IS_NOT_SEPARATE_WRITER_JOB_APPROVAL'));
};
const held=(r,mode)=>{
 assert.equal(r.status,'HOLD_UNATTESTED_PROTECTED_ENVIRONMENT_POLICY',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.suppliedReviewerAndBranchGuardrailsMatch,true);
 assert.equal(r.suppliedBranchMode,mode);
 safe(r);checks++;
};
const denied=(r,code)=>{
 assert.equal(r.status,'DENY_GITHUB_ENVIRONMENT_POLICY_CANDIDATE_INVALID');
 assert.ok(r.findings.includes(code),JSON.stringify(r.findings));
 assert.equal(r.suppliedReviewerAndBranchGuardrailsMatch,false);
 safe(r);checks++;
};
const change=(fn,code)=>{
 const x=sample();fn(x);denied(inspect(x),code);
};
held(inspect(sample()),'CUSTOM_MAIN_PATTERN_UNATTESTED');
held(inspect(sample('protected')),'PROTECTED_BRANCHES_UNATTESTED');
denied(inspect(null),'POLICY_INPUT_ENVELOPE_INVALID');
denied(inspect({}),'POLICY_INPUT_ENVELOPE_INVALID');
change(x=>{x.operationalEligible=true;},'POLICY_INPUT_ENVELOPE_INVALID');
change(x=>{x.environment.id=0;},'ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID');
change(x=>{x.environment.name='LIVE_APPROVAL';},'ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID');
change(x=>{x.environment.protection_rules=null;},'ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID');
change(x=>{x.environment.deployment_branch_policy=null;},'ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID');
change(x=>{x.environment.protection_rules[0].prevent_self_review=false;},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules[0].reviewers=[];},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules[0].reviewers[0].reviewer.id=0;},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules[0].reviewers.push(
 {...x.environment.protection_rules[0].reviewers[0]});},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules.push(
 structuredClone(x.environment.protection_rules[0]));},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules[0].type='wait_timer';},
 'REQUIRED_INDEPENDENT_REVIEW_GUARD_MISSING');
change(x=>{x.environment.protection_rules[1].type='wait_timer';},
 'ENVIRONMENT_BRANCH_PROTECTION_RULE_MISSING');
change(x=>{x.environment.deployment_branch_policy.custom_branch_policies=false;},
 'DEPLOYMENT_BRANCH_RESTRICTION_UNSAFE');
change(x=>{x.environment.deployment_branch_policy.protected_branches=true;},
 'DEPLOYMENT_BRANCH_RESTRICTION_UNSAFE');
change(x=>{x.branchPolicies=null;},'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
change(x=>{x.branchPolicies.total_count=2;},
 'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
change(x=>{x.branchPolicies.branch_policies[0].name='release/*';},
 'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
change(x=>{x.branchPolicies.branch_policies[0].name='*';},
 'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
change(x=>{x.branchPolicies.branch_policies[0].id='200';},
 'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
change(x=>{x.branchPolicies.branch_policies.push({id:201,name:'dev'});},
 'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD');
{const x=sample('protected');x.branchPolicies={total_count:0,branch_policies:[]};
 denied(inspect(x),'UNEXPECTED_CUSTOM_BRANCH_LIST');}
{const x=sample();x.environment.privateToken='DO_NOT_LOG';
 const r=inspect(x);held(r,'CUSTOM_MAIN_PATTERN_UNATTESTED');
 assert.ok(!JSON.stringify(r).includes('DO_NOT_LOG'));checks++;}
function transport(x,opts={}){
 let calls=0;const urls=[];
 const fake=async(url,request)=>{
  const index=calls++;urls.push(url);
  assert.equal(url,ROOT+(index===0?PATH:BRANCH));
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  assert.equal(request.cache,'no-store');
  assert.equal(request.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(request.headers['X-GitHub-Api-Version'],'2022-11-28');
  assert.equal(request.body,undefined);
  assert.ok(request.signal&&!request.signal.aborted);
  if(opts.throwAt===index)throw Error('Sensitive response '+TOKEN);
  const selected=index===0?x.environment:x.branchPolicies;
  const body=opts.badAt===index?opts.body:JSON.stringify(selected);
  const status=opts.badAt===index&&opts.status?opts.status:200;
  const headers={'content-type':opts.badAt===index&&opts.media?opts.media:'application/json'};
  if(opts.badAt===index&&opts.length!==undefined)headers['content-length']=opts.length;
  return new Response(body,{status,headers});
 };
 return {fake,counts:()=>({calls,urls})};
}
const signal=()=>new AbortController().signal;
async function readIt(x=sample(),opts={}){
 const t=transport(x,opts);
 const r=await read({token:TOKEN,fetchImpl:t.fake,signal:signal()});
 return {r,calls:t.counts().calls};
}
{const {r,calls}=await readIt();
 held(r,'CUSTOM_MAIN_PATTERN_UNATTESTED');assert.equal(calls,2);checks++;}
{const {r,calls}=await readIt(sample('protected'));
 held(r,'PROTECTED_BRANCHES_UNATTESTED');assert.equal(calls,1);checks++;}
const invalidCalls=async config=>{
 const x=await read(config);
 denied(x,'READ_ONLY_TRANSPORT_CONFIG_INVALID');
};
await invalidCalls({});
await invalidCalls({token:'bad key',fetchImpl:()=>{throw Error('unexpected');},signal:signal()});
await invalidCalls({token:TOKEN,fetchImpl:()=>{throw Error('unexpected');}});
{const c=new AbortController();c.abort();
 await invalidCalls({token:TOKEN,fetchImpl:()=>{throw Error('unexpected');},signal:c.signal});}
for(const opts of [
 {badAt:0,status:403,body:'{}'},
 {badAt:1,status:403,body:'{}'},
 {badAt:0,media:'text/html',body:'{}'},
 {badAt:1,media:'text/html',body:'{}'},
 {badAt:0,body:'{not-json'},
 {badAt:1,body:'{not-json'},
 {badAt:0,body:'[]'},
 {badAt:1,body:'[]'},
 {badAt:0,body:'{}',length:'10'},
 {badAt:1,body:'{}',length:'1'},
 {badAt:0,body:'{}',length:String(128*1024+1)},
 {badAt:1,body:'{}',length:'not-a-number'},
 {badAt:0,body:'"'+('x'.repeat(128*1024+1))+'"'},
 {throwAt:0},
 {throwAt:1},
]){
 const {r}=await readIt(sample(),opts);
 const expected=opts.badAt===0&&opts.body==='[]'
  ?'ENVIRONMENT_IDENTITY_OR_SHAPE_INVALID'
  :opts.badAt===1&&opts.body==='[]'
   ?'CUSTOM_MAIN_BRANCH_LIST_INCOMPLETE_OR_OVERBROAD'
   :'READ_ONLY_GITHUB_ENVIRONMENT_POLICY_UNAVAILABLE';
 denied(r,expected);
}
assert.equal(realRequests,0);assert.equal(brokerRequests,0);
assert.equal(externalWrites,0);
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_PROTECTED_ENVIRONMENT_POLICY_CANDIDATE_PASS',
 checks,syntheticGetRequests:'mock-only',actualGithubRequests:realRequests,
 brokerRequests,externalStateWrites:externalWrites,operationalAuthorityGranted:0,
}));
