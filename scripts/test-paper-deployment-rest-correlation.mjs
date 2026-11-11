import assert from 'node:assert/strict';
import { inspectPaperDeploymentRestCorrelation as inspect,
 readPaperDeploymentRestCorrelation as read } from './lib/paper-deployment-rest-correlation.mjs';
const TOKEN='synthetic-test-only-github-token';
const SHA='a'.repeat(40);
const E={repository:'pungking/alpha-exec-engine',environment:'PAPER_CUSTODY_APPROVAL',
 environmentId:26847620868,branch:'main',sha:SHA,runId:'123456',
 jobId:'234567',deploymentId:'345678',attempt:1,
 workflowPath:'.github/workflows/paper-oco-submit-canary.yml'};
const fixture=()=>({
 expected:{...E},
 run:{id:123456,run_attempt:1,head_sha:SHA,head_branch:'main',
   event:'workflow_dispatch',path:E.workflowPath,
   repository:{full_name:E.repository},head_repository:{full_name:E.repository},
   pull_requests:[]},
 job:{id:234567,run_id:123456,run_attempt:1,head_sha:SHA,
  name:'Protected PAPER approval - operational HOLD',status:'completed',conclusion:'failure'},
 deployment:{id:345678,sha:SHA,ref:'main',environment:E.environment,
   task:'deploy',creator:{login:'github-actions[bot]'}},
 statuses:[{deployment_id:345678,state:'success',environment:E.environment}],
 approvals:[{state:'approved',user:{login:'pungking',id:1},
  environments:[{id:26847620868,name:E.environment}]}],
});
let checks=0,networkCalls=0,mutations=0,brokerCalls=0;
const safe=r=>{for(const k of ['verifiedTransportOrigin','authenticatedJobToDeploymentBinding',
 'environmentPolicyIndependentlyAttested','accountWriterExclusionVerified',
 'credentialInventoryComplete','runtimeFencingVerified','operationalEligible',
 'stateMutationAuthorized','brokerSubmitAuthorized','liveTradingAuthorized'])
 assert.equal(r[k],false,k);};
const held=r=>{assert.equal(r.status,'HOLD_UNATTESTED_GITHUB_REST_CORRELATION',
 JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);
 assert.equal(r.restShapesCorrelated,true);safe(r);checks++;};
const deny=(r,reason)=>{assert.equal(r.status,'DENY_GITHUB_REST_CORRELATION');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));safe(r);checks++;};
const change=(fn,reason)=>{let x=fixture();fn(x);deny(inspect(x),reason);};
held(inspect(fixture()));
deny(inspect(null),'EXPECTED_BOUNDARY_INVALID');
deny(inspect({}),'EXPECTED_BOUNDARY_INVALID');
change(x=>{x.expected.runId='00123456';},'EXPECTED_BOUNDARY_INVALID');
change(x=>{x.expected.sha='bad';},'EXPECTED_BOUNDARY_INVALID');
change(x=>{x.expected.workflowPath='other.yml';},'EXPECTED_BOUNDARY_INVALID');
change(x=>{x.run.run_attempt=2;},'RUN_IDENTITY_INVALID');
change(x=>{x.run.event='pull_request';},'RUN_IDENTITY_INVALID');
change(x=>{x.run.path='unreviewed.yml';},'RUN_IDENTITY_INVALID');
change(x=>{x.run.head_repository.full_name='other/repo';},'RUN_IDENTITY_INVALID');
change(x=>{x.job.id=99999;},'JOB_IDENTITY_INVALID');
change(x=>{x.job.conclusion='success';},'JOB_IDENTITY_INVALID');
change(x=>{x.deployment.sha='f'.repeat(40);},'DEPLOYMENT_IDENTITY_INVALID');
change(x=>{x.deployment.creator.login='someone';},'DEPLOYMENT_IDENTITY_INVALID');
change(x=>{x.statuses=[];},'DEPLOYMENT_STATUS_AMBIGUOUS');
change(x=>{x.statuses.push({...x.statuses[0]});},'DEPLOYMENT_STATUS_AMBIGUOUS');
change(x=>{x.statuses[0].deployment_id=1;},'DEPLOYMENT_STATUS_AMBIGUOUS');
change(x=>{x.approvals=[];},'APPROVAL_HISTORY_AMBIGUOUS');
change(x=>{x.approvals.push({...x.approvals[0]});},'APPROVAL_HISTORY_AMBIGUOUS');
change(x=>{x.approvals[0].user.login='other';},'APPROVAL_HISTORY_AMBIGUOUS');
change(x=>{x.approvals[0].state='rejected';},'APPROVAL_HISTORY_AMBIGUOUS');
const paths=[
 '/actions/runs/123456','/actions/jobs/234567','/deployments/345678',
 '/deployments/345678/statuses?per_page=2','/actions/runs/123456/approvals',
];
const root='https://api.github.com/repos/pungking/alpha-exec-engine';
function fake(x,{badAt=-1,body='valid',length=null,contentType='application/json',
 status=200,errorAt=-1}={}){
 let n=0;
 return async(url,init)=>{
  networkCalls++;const i=n++;assert.equal(url,root+paths[i]);
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(init.headers['X-GitHub-Api-Version'],'2022-11-28');
  assert.equal(init.body,undefined);assert.ok(init.signal&&!init.signal.aborted);
  if(i===errorAt)throw Error('sensitive remote failure '+TOKEN);
  if(i===badAt) return new Response(body==='valid'?'{}':body,
    {status,headers:{'content-type':contentType,...(length?{'content-length':length}:{})}});
  const item=[x.run,x.job,x.deployment,x.statuses,x.approvals][i];
  return new Response(JSON.stringify(item),{status:200,
    headers:{'content-type':'application/json'}});
 };
}
const signal=()=>new AbortController().signal;
const readIt=async(x=fixture(),options={})=>read({expected:x.expected,token:TOKEN,
 fetchImpl:fake(x,options),signal:signal()});
held(await readIt());
deny(await read({expected:E,token:'bad',fetchImpl:()=>{throw Error('should not fetch');},
 signal:signal()}),'TRANSPORT_CONFIG_INVALID');
deny(await read({expected:{...E,runId:'wrong'},token:TOKEN,fetchImpl:()=>{throw Error('should not fetch');},
 signal:signal()}),'EXPECTED_BOUNDARY_INVALID');
deny(await read({expected:E,token:TOKEN,fetchImpl:()=>{throw Error('should not fetch');},
 signal:new AbortController().abort()}),'TRANSPORT_CONFIG_INVALID');
for(const opt of [
 {badAt:1,status:403},{badAt:2,body:'{not-json'},
 {badAt:3,contentType:'text/html'},
 {badAt:4,length:String(256*1024+1)},
 {badAt:0,length:'1'},
 {badAt:0,length:'1000'},
 {badAt:0,body:'[]'},
 {badAt:3,body:'{}'},
 {badAt:2,errorAt:2},
])deny(await readIt(fixture(),opt),'READ_ONLY_GITHUB_EVIDENCE_UNAVAILABLE');
const malicious=fixture();malicious.statuses=[...malicious.statuses,{...malicious.statuses[0]}];
deny(await readIt(malicious),'DEPLOYMENT_STATUS_AMBIGUOUS');
assert.ok(networkCalls>0);assert.equal(mutations,0);assert.equal(brokerCalls,0);
assert.ok(!JSON.stringify(inspect(fixture())).includes(TOKEN));checks++;
console.log(JSON.stringify({status:'OFFLINE_PAPER_DEPLOYMENT_REST_CORRELATION_PASS',
 checks,syntheticFetchCalls:networkCalls,actualGithubRequests:0,brokerRequests:brokerCalls,
 stateMutations:mutations,operationalAuthorityGranted:0}));
