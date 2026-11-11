import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryGithub, sha } from './fixtures/github-paper-custody.mjs';
import { openGithubCustody, inspectGithubCustodyLineageReadOnly } from './lib/github-paper-custody.mjs';
import { inspectGithubPaperReviewEvidence } from './lib/github-paper-review-evidence.mjs';
import { paperCustodyAccountScopeFingerprint } from './lib/paper-custody-runtime-boundary.mjs';
import {
  inspectGithubProtectedLineageEvidence, inspectGithubProtectedLineageReadOnly,
} from './lib/github-paper-protected-lineage.mjs';

const REPO = 'pungking/alpha-exec-engine';
const RUN = '123456789', JOB = '234567890';
const PATH = '.github/workflows/paper-oco-submit-canary.yml';
const SHA = 'a'.repeat(40), CODE = sha('protected-lineage-synthetic-code');
const ENV = 'PAPER_CUSTODY_APPROVAL';
const TOKEN = 'synthetic-only-read-token-123456';
const ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-3e-synth-')));
await fs.chmod(ROOT, 0o700);
let checks = 0, networkCalls = 0, serial = 0;
const base = async () => {
  const git = memoryGithub({ configOverrides: {
    repository: REPO, workflow: PATH, runId: RUN, codeSha256: CODE,
  } });
  const directory = path.join(ROOT, 'claim-' + serial++);
  await openGithubCustody({
    config: git.config, request: git.request, privateKey: git.privateKey, directory,
  });
  const scope = {
    accountSha256: git.config.accountSha256,
    scopeSha256: git.config.scopeSha256,
    attemptId: git.config.attemptId,
  };
  const expected = {
    runId: RUN, codeSha: SHA, workflowPath: PATH,
    accountScopeSha256: paperCustodyAccountScopeFingerprint(scope),
  };
  const custodyConfig = { ...git.config, expectedCommit: git.head() };
  const run = {
    id: Number(RUN), run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main',
    head_sha: SHA, path: PATH, repository: {full_name: REPO},
    head_repository: {full_name: REPO}, pull_requests: [],
  };
  const reviews = [{ state: 'approved', user: {login:'pungking',id:10},
    environments:[{id:26847620868,name:ENV}] }];
  const environment = {
    id:26847620868, name:ENV, can_admins_bypass:false,
    protection_rules:[{type:'required_reviewers',
      reviewers:[{type:'User',reviewer:{login:'pungking',id:10}}]}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},
  };
  const branchPolicies = {total_count:1,branch_policies:[{id:5,name:'main',type:'branch'}]};
  const job = { id:Number(JOB), run_id:Number(RUN), run_attempt:1,
    head_sha:SHA, name:'Protected PAPER approval - operational HOLD',
    status:'completed',conclusion:'failure' };
  return {git, expected, scope, custodyConfig, reviewedCodeSha256:CODE,
    jobId:JOB, run, reviews, environment, branchPolicies, job};
};
const client = (f, opts = {}) => {
  let calls = 0, gitGets = 0;
  const fetchImpl = async (url, init) => {
    calls++; networkCalls++;
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer '+TOKEN);
    const api = 'https://api.github.com/repos/'+REPO;
    let status = 200, data;
    if (url === api+'/actions/runs/'+RUN) data=f.run;
    else if(url===api+'/actions/runs/'+RUN+'/approvals') data=f.reviews;
    else if(url===api+'/environments/'+ENV) data=f.environment;
    else if(url===api+'/environments/'+ENV+'/deployment-branch-policies?per_page=2')
      data=f.branchPolicies;
    else if(url===api+'/actions/jobs/'+JOB) data=f.job;
    else if(url.startsWith(api+'/git/')) {
      gitGets++;
      const r=await f.git.request({method:init.method,path:url.slice('https://api.github.com'.length),signal:init.signal??new AbortController().signal});
      status=r.status;data=r.data??{};
    } else throw Error('synthetic unexpected API URL');
    if (opts.failUrl && url.includes(opts.failUrl)) status=403;
    if (opts.badJson && url.includes(opts.badJson)) return new Response('{corrupt',{status});
    return new Response(JSON.stringify(data),{
      status, headers: opts.oversize && url.includes(opts.oversize)
        ? {'content-length':String(1024*1024+1)} : {},
    });
  };
  return {fetchImpl,get calls(){return calls;},get gitGets(){return gitGets;}};
};
const args=(f,c)=>({
  expected:f.expected,scope:f.scope,custodyConfig:f.custodyConfig,
  reviewedCodeSha256:f.reviewedCodeSha256,jobId:f.jobId,
  privateKey:f.git.privateKey,token:TOKEN,fetchImpl:c.fetchImpl,
});
const held = out => {
  assert.equal(out.status,'HOLD_PROTECTED_LINEAGE_NOT_OPERATIONAL_AUTHORITY');
  assert.deepEqual(out.findings,[]);
  assert.equal(out.evidenceShapeMatched,true);
  assert.equal(out.operationalEligible,false);
  assert.equal(out.brokerSubmitAuthorized,false);
  assert.equal(out.stateMutationAuthorized,false);
  assert.equal(out.authenticatedJobDeploymentVerified,false);
  assert.equal(out.externalEnvironmentPolicyAttested,false);
  assert.equal(out.accountWideWriterFenced,false);
  checks++;
};
const blocked = (out,code) => {
  assert.equal(out.status,'DENY_PROTECTED_LINEAGE_EVIDENCE');
  assert.ok(out.findings.includes(code),JSON.stringify(out.findings));
  assert.equal(out.evidenceShapeMatched,false);
  assert.equal(out.brokerSubmitAuthorized,false);
  assert.equal(out.stateMutationAuthorized,false);
  assert.equal(out.operationalEligible,false);
  checks++;
};
try {
  const f=await base(),c=client(f);
  const before=f.git.calls.length;
  const success=await inspectGithubProtectedLineageReadOnly(args(f,c));
  held(success);
  assert.ok(c.calls>=7);
  assert.ok(c.gitGets>=5);
  assert.ok(f.git.calls.slice(before).every(x=>x.method==='GET'));
  checks+=3;

  const review=inspectGithubPaperReviewEvidence({
    expected:f.expected,run:f.run,reviews:f.reviews,
  });
  const lineage=await inspectGithubCustodyLineageReadOnly({
    config:f.custodyConfig,request:f.git.request,privateKey:f.git.privateKey,
  });
  held(inspectGithubProtectedLineageEvidence({...args(f,c),review,lineage,
    environment:f.environment,branchPolicies:f.branchPolicies,job:f.job}));
  const pureBad={...args(f,c),review,lineage,environment:{...f.environment,can_admins_bypass:true},
    branchPolicies:f.branchPolicies,job:f.job};
  blocked(inspectGithubProtectedLineageEvidence(pureBad),'ENVIRONMENT_POLICY_INVALID');
  const pureNoLineage={...args(f,c),review,lineage:{status:'approved'},
    environment:f.environment,branchPolicies:f.branchPolicies,job:f.job};
  blocked(inspectGithubProtectedLineageEvidence(pureNoLineage),'CRYPTOGRAPHIC_CLAIM_INVALID');
  blocked(inspectGithubProtectedLineageEvidence(null),'LOCAL_SCOPE_OR_CODE_INVALID');

  const negative = async (mutate,code,expectedGit) => {
    const n=await base();mutate(n);
    const clientObj=client(n);
    const out=await inspectGithubProtectedLineageReadOnly(args(n,clientObj));
    blocked(out,code);
    if(expectedGit!==undefined)assert.equal(clientObj.gitGets,expectedGit);
    checks++;
  };
  await negative(n=>{n.environment.id=1},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.environment.can_admins_bypass=true},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.environment.protection_rules=[]},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.environment.protection_rules[0].reviewers[0].reviewer.login='other'},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.environment.deployment_branch_policy.custom_branch_policies=false},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.branchPolicies.branch_policies[0].name='dev'},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.branchPolicies.total_count=2},'ENVIRONMENT_POLICY_INVALID',0);
  await negative(n=>{n.job.head_sha='b'.repeat(40)},'ADMISSION_JOB_IDENTITY_INVALID',0);
  await negative(n=>{n.job.name='submit-canary'},'ADMISSION_JOB_IDENTITY_INVALID',0);
  await negative(n=>{n.job.conclusion='success'},'ADMISSION_JOB_IDENTITY_INVALID',0);
  await negative(n=>{n.job.run_attempt=2},'ADMISSION_JOB_IDENTITY_INVALID',0);
  await negative(n=>{n.reviews=[]},'RUN_REVIEW_INVALID',0);
  await negative(n=>{n.reviews[0].state='rejected'},'RUN_REVIEW_INVALID',0);
  await negative(n=>{n.run.head_sha='b'.repeat(40)},'RUN_REVIEW_INVALID',0);
  await negative(n=>{n.run.run_attempt=2},'RUN_REVIEW_INVALID',0);
  await negative(n=>{n.scope.accountSha256='1'.repeat(64)},'LOCAL_SCOPE_OR_CODE_INVALID',0);
  await negative(n=>{n.expected.codeSha='not-SHA'},'LOCAL_SCOPE_OR_CODE_INVALID',0);
  await negative(n=>{n.custodyConfig.ref='refs/heads/main'},'LOCAL_SCOPE_OR_CODE_INVALID',0);
  await negative(n=>{n.jobId='0'},'LOCAL_SCOPE_OR_CODE_INVALID',0);
  await negative(n=>{n.git.move('2'.repeat(40))},'CRYPTOGRAPHIC_CLAIM_INVALID');
  await negative(n=>{n.git.fail=({path:p})=>p.includes('/blobs/')
    ? {status:200,data:{sha:p.split('/').at(-1),encoding:'base64',content:'e30='}}:null;},
    'CRYPTOGRAPHIC_CLAIM_INVALID');
  await negative(n=>{n.custodyConfig.codeSha256='f'.repeat(64)},'LOCAL_SCOPE_OR_CODE_INVALID',0);

  const x=await base();const noClient=client(x);
  blocked(await inspectGithubProtectedLineageReadOnly({...args(x,noClient),token:'bad'}),
    'TRANSPORT_OR_KEY_INVALID');
  assert.equal(noClient.calls,0);checks++;
  const noKey=client(x);
  blocked(await inspectGithubProtectedLineageReadOnly({...args(x,noKey),privateKey:null}),
    'TRANSPORT_OR_KEY_INVALID');
  assert.equal(noKey.calls,0);checks++;
  const down=client(x,{failUrl:'/environments/'+ENV});
  blocked(await inspectGithubProtectedLineageReadOnly(args(x,down)),'PROTECTED_READ_FAILED');
  const malformed=client(x,{badJson:'/actions/jobs/'});
  blocked(await inspectGithubProtectedLineageReadOnly(args(x,malformed)),'PROTECTED_READ_FAILED');
  const oversized=client(x,{oversize:'/environments/'+ENV});
  blocked(await inspectGithubProtectedLineageReadOnly(args(x,oversized)),'PROTECTED_READ_FAILED');

  assert.equal(JSON.stringify(success).includes(TOKEN),false);
  assert.equal(success.actualPaperStateProvisioned,false);
  checks+=2;
  console.log(JSON.stringify({
    status:'OFFLINE_GITHUB_PAPER_PROTECTED_CRYPTO_BINDING_PASS',
    checks,actualGithubRequests:0,brokerRequests:0,
    externalStateWrites:0,operationalAuthorityGranted:0,
  }));
} finally {
  await fs.rm(ROOT,{recursive:true,force:true});
}
