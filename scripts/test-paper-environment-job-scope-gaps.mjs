import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAPER_PROTECTED_WRITER_TOPOLOGY as TARGETS }
 from './lib/paper-protected-writer-topology.mjs';
import { inspectPaperEnvironmentJobScopeGaps as inspect }
 from './lib/paper-environment-job-scope-gaps.mjs';

const REPO='pungking/alpha-exec-engine';
const ENV='PAPER_CUSTODY_APPROVAL';
const ENV_ID=26847620868;
const MAIN_SHA='6cd26eb4fffc32c181a6768b3f9eaff589162bb8';
const BASE=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const SOURCES=Object.fromEntries(TARGETS.map(t=>[
 t.file,fs.readFileSync('.github/workflows/'+t.file,'utf8'),
]));
function fixture(target=TARGETS[0],mode='custom'){
 return {
  schemaVersion:'paper-environment-job-scope-gaps-v1',
  reviewedMainSha:MAIN_SHA,
  baseline:structuredClone(BASE),
  workflowSources:{...SOURCES},
  environmentCandidate:{
   environment:{
    id:ENV_ID,name:ENV,
    protection_rules:[
     {id:1,type:'required_reviewers',prevent_self_review:true,
      reviewers:[{type:'User',reviewer:{id:1234,login:'reviewer'}}]},
     {id:2,type:'branch_policy'},
    ],
    deployment_branch_policy:mode==='custom'
     ?{protected_branches:false,custom_branch_policies:true}
     :{protected_branches:true,custom_branch_policies:false},
   },
   branchPolicies:mode==='custom'
    ?{total_count:1,branch_policies:[{id:100,name:'main'}]}
    :null,
  },
  requested:{
   repository:REPO,sourceRef:'refs/heads/main',sourceSha:MAIN_SHA,
   workflowFile:target.file,
   protectedAdmissionJob:'admission',mutationWriterJob:target.writer,
   environmentName:ENV,environmentId:ENV_ID,
  },
  authorityClaims:{
   environmentAttestedAtRun:false,adminBypassIndependentlyExcluded:false,
   mainBranchProtectionIndependentlyVerified:false,
   mutationJobApprovalVerified:false,brokerAccountWritersFenced:false,
   independentReplayControlEnforced:false,
   separateHumanOperationalApproval:false,operationalEligible:false,
  },
 };
}
let checks=0;
const safe=r=>{
 for(const k of ['trustedGithubSourceVerified','policyAtRunTimeVerified',
  'administratorBypassExcluded','exactMutationJobDeploymentApproved',
  'accountWideBrokerWriterFencingVerified','independentReplayGuardVerified',
  'separateHumanOperationalApprovalVerified','operationalEligible',
  'paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])
  assert.equal(r[k],false,k);
 assert.ok(r.proofGaps.includes(
  'ADMISSION_ENVIRONMENT_IS_NOT_DOWNSTREAM_MUTATION_JOB_ENVIRONMENT'));
 assert.ok(r.proofGaps.includes(
  'ADMIN_BYPASS_STATE_NOT_INDEPENDENTLY_VERIFIED'));
};
const held=x=>{
 const r=inspect(x);
 assert.equal(r.status,'HOLD_PROTECTED_ADMISSION_POLICY_NOT_WRITER_AUTHORITY',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceTopologyMatched,true);
 assert.equal(r.suppliedPolicyShapeMatched,true);
 assert.equal(r.protectedAdmissionJobs,4);
 assert.equal(r.distinctMutationWriterJobs,4);
 assert.equal(r.requestedProtectedJob,'admission');
 assert.equal(r.requestedWriterJob,x.requested.mutationWriterJob);
 safe(r);checks++;
};
const denied=(x,code)=>{
 const r=inspect(x);
 assert.equal(r.status,'DENY_PROTECTED_ENVIRONMENT_SCOPE_INVALID');
 assert.ok(r.findings.includes(code),JSON.stringify(r.findings));
 assert.equal(r.sourceTopologyMatched,false);
 assert.equal(r.suppliedPolicyShapeMatched,false);
 assert.equal(r.protectedAdmissionJobs,0);
 assert.equal(r.distinctMutationWriterJobs,0);
 safe(r);checks++;
};
const change=(fn,code)=>{
 const x=fixture();fn(x);denied(x,code);
};
for(const t of TARGETS) held(fixture(t));
held(fixture(TARGETS[1],'protected'));
denied(null,'SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
denied({},'SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
change(x=>{x.schemaVersion='ready';},'SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
change(x=>{x.extraTrusted=true;},'SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
change(x=>{x.reviewedMainSha='f'.repeat(40);},'SOURCE_SCOPE_ENVELOPE_OR_SHA_INVALID');
change(x=>{x.requested.repository='other/repo';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.sourceRef='refs/heads/paper-state';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.sourceSha='f'.repeat(40);},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.workflowFile='unknown.yml';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.protectedAdmissionJob='submit-canary';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.mutationWriterJob='admission';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.mutationWriterJob=TARGETS[2].writer;},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.environmentName='OTHER';},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.environmentId=ENV_ID+1;},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.requested.writersVerified=true;},
 'EXACT_ENVIRONMENT_AND_WRITER_SCOPE_INVALID');
change(x=>{x.environmentCandidate.environment.id=ENV_ID+1;},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.environment.name='LIVE';},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.environment.protection_rules[0].prevent_self_review=false;},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.environment.protection_rules[0].reviewers=[];},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.environment.deployment_branch_policy=
 {protected_branches:false,custom_branch_policies:false};},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.branchPolicies.branch_policies[0].name='*';},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.environmentCandidate.operationalEligible=true;},
 'UNTRUSTED_POLICY_CANDIDATE_INVALID');
change(x=>{x.baseline.operationalHold=false;},
 'FOUR_WORKFLOW_SOURCE_TOPOLOGY_INVALID');
change(x=>{x.baseline.settingsEvidence='LIVE_FETCH_CONFIRMED';},
 'FOUR_WORKFLOW_SOURCE_TOPOLOGY_INVALID');
change(x=>{x.baseline.blockers[0].status='CLOSED';},
 'FOUR_WORKFLOW_SOURCE_TOPOLOGY_INVALID');
change(x=>{x.workflowSources[TARGETS[0].file]=
 x.workflowSources[TARGETS[0].file].replace('          exit 1','          exit 0');},
 'FOUR_WORKFLOW_SOURCE_TOPOLOGY_INVALID');
change(x=>{x.authorityClaims.environmentAttestedAtRun=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.adminBypassIndependentlyExcluded=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.mainBranchProtectionIndependentlyVerified=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.mutationJobApprovalVerified=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.brokerAccountWritersFenced=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.independentReplayControlEnforced=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.separateHumanOperationalApproval=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.operationalEligible=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{x.authorityClaims.brokerSubmitAuthorized=true;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
change(x=>{delete x.authorityClaims;},
 'UNSUPPORTED_EXTERNAL_AUTHORITY_DECLARATION');
const injected=fixture();
injected.environmentCandidate.environment.apiToken='PRIVATE_NEVER_OUTPUT';
const r=inspect(injected);held(injected);
assert.ok(!JSON.stringify(r).includes('PRIVATE_NEVER_OUTPUT'));checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_ENVIRONMENT_JOB_SCOPE_GAPS_PASS',
 checks,protectedAdmissionJobs:4,distinctMutationWriterJobs:4,
 actualGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0,
}));
