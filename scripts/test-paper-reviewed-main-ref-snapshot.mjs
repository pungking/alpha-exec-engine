import assert from 'node:assert/strict';
import {
 inspectPaperReviewedMainRefSnapshot as inspect,
 readPaperReviewedMainRefSnapshot as read,
} from './lib/paper-reviewed-main-ref-snapshot.mjs';

const REPO='pungking/alpha-exec-engine';
const OLD='6cd26eb4fffc32c181a6768b3f9eaff589162bb8';
const MERGE='73361997484c83a17e5dd391dcf566179b2f6521';
const TREE='ec366d4aedae5c30a4dc754ca8b2031cfc06d77a';
const NEXT='a'.repeat(40),TOKEN='synthetic-not-a-real-token';
const API='https://api.github.com/repos/'+REPO;
const AUTH=['githubOriginVerified','repositoryRulesetVerified',
 'environmentAtRunVerified','exactWriterJobApproved',
 'brokerAccountWriterFenced','independentReplayEnforced',
 'separateHumanOperationalApproval','operationalEligible'];
const flags=()=>Object.fromEntries(AUTH.map(k=>[k,false]));
function sample({head=MERGE,parent=OLD,after=head,ref=head,commit=head,
 protectedFlag=true,reviewed=OLD}={}){
 const branch=sha=>({name:'main',protected:protectedFlag,
  commit:{sha},protection:{enabled:true}});
 return {
  schemaVersion:'paper-reviewed-main-ref-snapshot-v1',
  repository:REPO,reviewedSourceSha:reviewed,
  branchBefore:branch(head),
  gitRef:{ref:'refs/heads/main',object:{type:'commit',sha:ref}},
  headCommit:{sha:commit,parents:[{sha:parent}],commit:{tree:{sha:TREE}}},
  branchAfter:branch(after),
  authorityClaims:flags(),
 };
}
let checks=0,actualGithubRequests=0,brokerRequests=0,externalWrites=0;
function safe(r){
 for(const key of ['trustedGithubOriginVerified','branchProtectionEnforcementVerified',
  'environmentAtRunVerified','exactWriterJobDeploymentApproved',
  'brokerWriterExclusivityVerified','externalReplayProtected',
  'operationalEligible','paperSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])assert.equal(r[key],false,key);
 assert.ok(r.proofGaps.includes('FROZEN_SOURCE_SHA_IS_NOT_ALWAYS_CURRENT_MAIN'));
 assert.equal(r.reviewedFrozenSourceSha,OLD);
}
function hold(x,desired){
 const r=inspect(x);assert.equal(r.status,desired,JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);assert.equal(r.branchRefCommitShapeCorrelated,true);
 safe(r);checks++;return r;
}
function deny(x,why){
 const r=inspect(x);assert.equal(r.status,'DENY_MAIN_REF_OBSERVATION_INVALID');
 assert.ok(r.findings.includes(why),JSON.stringify(r.findings));
 assert.equal(r.branchRefCommitShapeCorrelated,false);safe(r);checks++;
}
const mutate=(fn,why)=>{const x=sample();fn(x);deny(x,why);};
const MOVED='HOLD_MAIN_MOVED_BEYOND_REVIEWED_SOURCE';
const SAME='HOLD_FROZEN_REVIEWED_SOURCE_REF_MATCH';
let r=hold(sample(),MOVED);
assert.equal(r.untrustedObservedHeadSha,MERGE);
assert.equal(r.firstParentEqualsReviewedSha,true);
assert.equal(r.pinned3sSourceEqualsObservedMain,false);
r=hold(sample({head:OLD,parent:'b'.repeat(40)}),SAME);
assert.equal(r.pinned3sSourceEqualsObservedMain,true);
r=hold(sample({head:NEXT,parent:MERGE}),MOVED);
assert.equal(r.firstParentEqualsReviewedSha,false);
deny({},'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
deny(null,'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
mutate(x=>{x.schemaVersion='ready';},'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
mutate(x=>{x.repository='other/repo';},'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
mutate(x=>{x.reviewedSourceSha=MERGE;},'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
mutate(x=>{x.verified=true;},'REVIEW_ANCHOR_OR_ENVELOPE_INVALID');
mutate(x=>{x.authorityClaims.githubOriginVerified=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.repositoryRulesetVerified=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.environmentAtRunVerified=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.exactWriterJobApproved=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.brokerAccountWriterFenced=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.independentReplayEnforced=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.separateHumanOperationalApproval=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.operationalEligible=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.authorityClaims.override=true;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{delete x.authorityClaims;},'FORGED_OPERATIONAL_AUTHORITY_CLAIM');
mutate(x=>{x.branchBefore.name='dev';},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.branchAfter.name='notmain';},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.branchBefore.protected=false;},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.branchAfter.protected=false;},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.branchBefore.commit.sha='bad';},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.branchAfter.commit.sha='bad';},'MAIN_BRANCH_IDENTITY_OR_PROTECTED_FLAG_INVALID');
mutate(x=>{x.gitRef.ref='refs/heads/paper-state';},'HEAD_GIT_REF_IDENTITY_INVALID');
mutate(x=>{x.gitRef.object.type='tag';},'HEAD_GIT_REF_IDENTITY_INVALID');
mutate(x=>{x.gitRef.object.sha='bad';},'HEAD_GIT_REF_IDENTITY_INVALID');
mutate(x=>{x.headCommit.sha='bad';},'HEAD_COMMIT_IDENTITY_INVALID');
mutate(x=>{x.headCommit.parents=[];},'HEAD_COMMIT_IDENTITY_INVALID');
mutate(x=>{x.headCommit.parents=[{sha:'bad'}];},'HEAD_COMMIT_IDENTITY_INVALID');
mutate(x=>{x.headCommit.parents=[{sha:OLD},{sha:NEXT},{sha:MERGE}];},
 'HEAD_COMMIT_IDENTITY_INVALID');
mutate(x=>{x.headCommit.commit.tree.sha='bad';},'HEAD_COMMIT_IDENTITY_INVALID');
mutate(x=>{x.branchAfter.commit.sha=NEXT;},'NON_ATOMIC_OR_CONTRADICTORY_MAIN_HEAD');
mutate(x=>{x.gitRef.object.sha=NEXT;},'NON_ATOMIC_OR_CONTRADICTORY_MAIN_HEAD');
mutate(x=>{x.headCommit.sha=NEXT;},'NON_ATOMIC_OR_CONTRADICTORY_MAIN_HEAD');
const secret=sample();secret.branchBefore.privateBearer='PRIVATE_DO_NOT_LOG';
r=hold(secret,MOVED);
assert.ok(!JSON.stringify(r).includes('PRIVATE_DO_NOT_LOG'));checks++;
const signal=()=>new AbortController().signal;
function transport(snapshot=sample(),opts={}){
 let calls=0;
 const paths=['/branches/main','/git/ref/heads/main',
  '/commits/'+snapshot.branchBefore.commit.sha,'/branches/main'];
 const rows=[snapshot.branchBefore,snapshot.gitRef,snapshot.headCommit,snapshot.branchAfter];
 return {
  fake:async(url,req)=>{
   const i=calls++;assert.ok(i<4);assert.equal(url,API+paths[i]);
   assert.equal(req.method,'GET');assert.equal(req.redirect,'error');
   assert.equal(req.cache,'no-store');assert.equal(req.body,undefined);
   assert.equal(req.headers.Authorization,'Bearer '+TOKEN);
   assert.equal(req.headers['X-GitHub-Api-Version'],'2022-11-28');
   assert.ok(req.signal&&!req.signal.aborted);
   if(opts.throwAt===i)throw Error('SENSITIVE_TOKEN '+TOKEN);
   const body=opts.badAt===i?opts.body:JSON.stringify(rows[i]);
   const status=opts.badAt===i&&opts.status?opts.status:200;
   const media=opts.badAt===i&&opts.media?opts.media:'application/json';
   const headers={'content-type':media};
   if(opts.badAt===i&&opts.length!==undefined)
     headers['content-length']=opts.length;
   return new Response(body,{status,headers});
  },
  calls:()=>calls,
 };
}
async function collect(snapshot=sample(),opts={}){
 const t=transport(snapshot,opts);
 const result=await read({token:TOKEN,fetchImpl:t.fake,signal:signal()});
 return {result,calls:t.calls()};
}
{const x=await collect();assert.equal(x.calls,4);
 assert.equal(x.result.status,MOVED);safe(x.result);checks++;}
{const x=await collect(sample({head:OLD,parent:NEXT}));
 assert.equal(x.calls,4);assert.equal(x.result.status,SAME);safe(x.result);checks++;}
for(const opts of [
 {badAt:0,status:403,body:'{}'},
 {badAt:1,status:403,body:'{}'},
 {badAt:2,status:404,body:'{}'},
 {badAt:3,status:503,body:'{}'},
 {badAt:0,media:'text/html',body:'{}'},
 {badAt:1,media:'text/plain',body:'{}'},
 {badAt:2,body:'{invalid'},
 {badAt:3,body:'{invalid'},
 {badAt:0,body:'[]'},
 {badAt:0,body:'{}',length:'9'},
 {badAt:1,body:'{}',length:'1'},
 {badAt:2,body:'{}',length:String(96*1024+1)},
 {badAt:3,body:'{}',length:'invalid'},
 {badAt:1,body:'"'+('x'.repeat(96*1024+1))+'"'},
 {throwAt:0},
 {throwAt:2},
]){
 const {result}=await collect(sample(),opts);
 assert.equal(result.status,'DENY_MAIN_REF_OBSERVATION_INVALID');
 assert.ok(result.findings.includes('READ_ONLY_GITHUB_MAIN_REF_UNAVAILABLE'));
 safe(result);checks++;
}
for(const x of [
 {},
 {token:'bad value',fetchImpl:()=>{throw Error('call');},signal:signal()},
 {token:TOKEN,fetchImpl:()=>{throw Error('call');}},
]){
 const r=await read(x);
 assert.ok(r.findings.includes('READ_ONLY_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;
}
{const c=new AbortController();c.abort();
 const r=await read({token:TOKEN,fetchImpl:()=>{throw Error('call');},signal:c.signal});
 assert.ok(r.findings.includes('READ_ONLY_COLLECTOR_CONFIG_INVALID'));
 safe(r);checks++;}
assert.equal(actualGithubRequests,0);
assert.equal(brokerRequests,0);
assert.equal(externalWrites,0);
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_REVIEWED_MAIN_REF_SNAPSHOT_PASS',
 checks,reviewedSha:OLD,observedMainShaFixture:MERGE,
 mockGetRequests:4,actualGithubRequests,brokerRequests,
 externalStateWrites:externalWrites,operationalAuthorityGranted:0,
}));
