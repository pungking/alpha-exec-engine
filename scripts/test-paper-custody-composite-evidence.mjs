import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryGithub, sha } from './fixtures/github-paper-custody.mjs';
import { openGithubCustody, inspectGithubCustodyLineageReadOnly } from './lib/github-paper-custody.mjs';
import { inspectGithubPaperReviewEvidence } from './lib/github-paper-review-evidence.mjs';
import { paperCustodyAccountScopeFingerprint } from './lib/paper-custody-runtime-boundary.mjs';
import { inspectPaperCustodyComposite as inspect } from './lib/paper-custody-composite-evidence.mjs';

const REPO='pungking/alpha-exec-engine';
const SH='a'.repeat(40),CODE=sha('3h-test-code'),RUN='123456789',JOB='234567890';
const PATH='.github/workflows/paper-oco-submit-canary.yml';
const ENV='PAPER_CUSTODY_APPROVAL';
const baseline=JSON.parse(await fs.readFile(new URL('../config/paper-workflow-admission-baseline.json',import.meta.url),'utf8'));
const legacy=[
  'dry-run.yml#dry-run','market-guard.yml#market-guard',
  'ledger-filled-migration.yml#ledger-filled-migration',
  'paper-five-row-active-limited-state-recovery.yml#recover',
  'paper-oco-submit-canary.yml#submit-canary',
  'persistent-oco-repair-submit.yml#submit-persistent-repair',
];
const writer=(id,accountSha256,isLegacy)=>({
  id, legacy:isLegacy, kind:isLegacy?'CACHE_STATE':'STATE_MUTATION',
  accountSha256,evidenceDigest:'d'.repeat(64),
  disposition:isLegacy?'BLOCKED_BY_TESTED_GATE':'MIGRATED_TO_CUSTODY',
  custodyEnforced:!isLegacy,
});
const work=async ()=>{
  const git=memoryGithub({configOverrides:{repository:REPO,workflow:PATH,runId:RUN,codeSha256:CODE}});
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'paper-3h-offline-')));
  await fs.chmod(root,0o700);
  try {await openGithubCustody({config:git.config,request:git.request,
    privateKey:git.privateKey,directory:path.join(root,'claim')});
  } finally {await fs.rm(root,{recursive:true,force:true});}
  const cfg={...git.config,expectedCommit:git.head()};
  const scope={accountSha256:cfg.accountSha256,scopeSha256:cfg.scopeSha256,attemptId:cfg.attemptId};
  const expected={runId:RUN,codeSha:SH,workflowPath:PATH,
    accountScopeSha256:paperCustodyAccountScopeFingerprint(scope)};
  const run={id:Number(RUN),run_attempt:1,event:'workflow_dispatch',head_branch:'main',
    head_sha:SH,path:PATH,repository:{full_name:REPO},
    head_repository:{full_name:REPO},pull_requests:[]};
  const review=inspectGithubPaperReviewEvidence({expected,run,
    reviews:[{state:'approved',user:{login:'pungking',id:10},
      environments:[{id:26847620868,name:ENV}]}]});
  const lineage=await inspectGithubCustodyLineageReadOnly({config:cfg,request:git.request,privateKey:git.privateKey});
  const environment={id:26847620868,name:ENV,can_admins_bypass:false,
    protection_rules:[{type:'required_reviewers',reviewers:[{
      type:'User',reviewer:{login:'pungking',id:10}}]}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}};
  const branchPolicies={total_count:1,branch_policies:[{id:5,name:'main',type:'branch'}]};
  const job={id:Number(JOB),run_id:Number(RUN),run_attempt:1,head_sha:SH,
    name:'Protected PAPER approval - operational HOLD',status:'completed',conclusion:'failure'};
  const accountSha256=scope.accountSha256,scopeSha256=scope.scopeSha256;
  const protectedInput={expected,scope,custodyConfig:cfg,reviewedCodeSha256:CODE,
    jobId:JOB,review,lineage,environment,branchPolicies,job};
  const deploymentInput={
    expected:{repository:REPO,environment:ENV,environmentId:26847620868,
      branch:'main',sha:SH,runId:RUN,jobId:JOB,attempt:1,accountSha256,scopeSha256},
    run,job,
    deployment:{id:34567,environment:ENV,ref:'main',sha:SH,task:'deploy',
      creator:{login:'github-actions[bot]'}},
    deploymentStatus:{deployment_id:34567,state:'success',environment:ENV},
    jobDeploymentAttestation:{kind:'UNVERIFIED_ONLY',verified:false},
    writerInventory:{schemaVersion:'paper-account-writer-inventory-v1',
      accountSha256,scopeSha256,complete:true,custodyWriterCount:1,
      externalWriterDiscovery:'INDEPENDENT_EVIDENCE_REQUIRED',
      brokerCredentialInventory:'INDEPENDENT_EVIDENCE_REQUIRED',
      requiredLegacyIds:['legacy-dry-run','legacy-market-guard'],
      writers:[writer('legacy-dry-run',accountSha256,true),
        writer('legacy-market-guard',accountSha256,true),
        writer('custody-writer',accountSha256,false)]},
    durableClaim:{status:'UNVERIFIED',authorized:false},
  };
  const writerCoverageInput={baseline:structuredClone(baseline),
    coverage:{schemaVersion:'paper-writer-coverage-declaration-v1',
      paths:legacy.map(id=>({id,status:'UNVERIFIED_RUNTIME_EXCLUSION',sourceDigest:'a'.repeat(64)})),
      externalSurfaces:['BROKER_API_CREDENTIALS','OTHER_REPOSITORIES','OUT_OF_BAND_CLIENTS',
        'RUNNER_AND_CACHE_STATE'].map(id=>({id,status:'INDEPENDENT_PROOF_REQUIRED'}))},
    deploymentProof:{jobSpecificApproval:'UNVERIFIED',provenance:'UNVERIFIED',attestationVerified:false},
    fencingProof:{brokerSideLease:'UNVERIFIED',writerPreemption:'UNVERIFIED',accountWideExclusionVerified:false}};
  return {expected:{repository:REPO,branch:'main',environment:ENV,
    mainSha:SH,accountSha256,scopeSha256},protectedInput,deploymentInput,writerCoverageInput,
    trustedEvidenceSources:{kind:'UNAVAILABLE_NOT_ATTESTED',jobDeployment:'UNVERIFIED',
      environmentPolicy:'UNVERIFIED',accountWriterInventory:'UNVERIFIED',
      brokerFencing:'UNVERIFIED',verified:false}};
};
let checks=0;
const safety=r=>{for(const k of ['jobSpecificDeploymentAuthenticated',
 'protectedEnvironmentIndependentlyAttested','brokerAccountOwnershipVerified',
 'allCredentialWritersInventoried','legacyWriterRevocationProven',
 'accountWideFencingEnforced','durableClaimRuntimeVerified','liveBrokerReconciled',
 'paperStateProvisioned','operationalEligible','stateMutationAuthorized',
 'brokerSubmitAuthorized','liveTradingAuthorized'])assert.equal(r[k],false);};
const held=x=>{const r=inspect(x);assert.equal(r.status,'HOLD_COMPOSITE_EVIDENCE_NOT_OPERATIONAL_AUTHORITY',
 JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);assert.equal(r.reviewedReadOnlyShapesMatched,true);
 for(const c of Object.values(r.components))assert.equal(c,true);safety(r);checks++;};
const deny=(x,k)=>{const r=inspect(x);assert.equal(r.status,'DENY_COMPOSITE_EVIDENCE_INCOMPLETE');
 assert.ok(r.findings.includes(k),JSON.stringify(r.findings));safety(r);checks++;};
const x=await work();held(x);
deny(null,'COMPOSITE_EXPECTED_CONTEXT_INVALID');
deny({},'COMPOSITE_EXPECTED_CONTEXT_INVALID');
const change=(fn,k)=>{let a=structuredClone(x);fn(a);deny(a,k);};
change(a=>{a.expected.mainSha='bad';},'COMPOSITE_EXPECTED_CONTEXT_INVALID');
change(a=>{a.expected.accountSha256='bad';},'COMPOSITE_EXPECTED_CONTEXT_INVALID');
change(a=>{a.protectedInput.scope.accountSha256='f'.repeat(64);},'PROTECTED_CLAIM_CONTEXT_UNBOUND');
change(a=>{a.protectedInput.expected.codeSha='f'.repeat(40);},'PROTECTED_CLAIM_CONTEXT_UNBOUND');
change(a=>{a.deploymentInput.expected.scopeSha256='f'.repeat(64);},'DEPLOYMENT_CONTEXT_UNBOUND');
change(a=>{a.deploymentInput.job.conclusion='success';},'DEPLOYMENT_WRITER_DIAGNOSTIC_INVALID');
change(a=>{a.deploymentInput.writerInventory.writers.pop();},'DEPLOYMENT_WRITER_DIAGNOSTIC_INVALID');
change(a=>{a.protectedInput.environment.can_admins_bypass=true;},'PROTECTED_CLAIM_DIAGNOSTIC_INVALID');
change(a=>{a.protectedInput.lineage.status='APPROVED';},'PROTECTED_CLAIM_DIAGNOSTIC_INVALID');
change(a=>{a.writerCoverageInput.baseline.workflows.pop();},'SOURCE_WRITER_COVERAGE_DIAGNOSTIC_INVALID');
change(a=>{a.writerCoverageInput.coverage.paths[0].status='VERIFIED';},'SOURCE_WRITER_COVERAGE_DIAGNOSTIC_INVALID');
change(a=>{a.trustedEvidenceSources.verified=true;},'EXTERNAL_PROOF_BOUNDARY_INVALID');
change(a=>{a.trustedEvidenceSources.brokerFencing='PROVEN';},'EXTERNAL_PROOF_BOUNDARY_INVALID');
console.log(JSON.stringify({status:'OFFLINE_PAPER_CUSTODY_COMPOSITE_EVIDENCE_PASS',
 checks,githubRequests:0,brokerRequests:0,externalStateWrites:0,executionAuthorityGranted:0}));
