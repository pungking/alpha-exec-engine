import assert from 'node:assert/strict';
import { inspectPaperDeploymentWriterEvidence as inspect } from './lib/paper-deployment-writer-exclusion.mjs';
const SHA = 'a'.repeat(40), ACCOUNT = 'b'.repeat(64), SCOPE = 'c'.repeat(64), DIGEST = 'd'.repeat(64);
const writer = (id,legacy,kind='CACHE_STATE') => ({
  id, legacy, kind, accountSha256:ACCOUNT, evidenceDigest:DIGEST,
  disposition: legacy ? 'BLOCKED_BY_TESTED_GATE' : 'MIGRATED_TO_CUSTODY',
  custodyEnforced: !legacy,
});
const sample=()=>({
  expected:{repository:'pungking/alpha-exec-engine',environment:'PAPER_CUSTODY_APPROVAL',
    environmentId:26847620868,branch:'main',sha:SHA,runId:'123456',jobId:'456789',
    attempt:1,accountSha256:ACCOUNT,scopeSha256:SCOPE},
  run:{id:123456,run_attempt:1,head_branch:'main',head_sha:SHA,event:'workflow_dispatch',
    repository:{full_name:'pungking/alpha-exec-engine'}},
  job:{id:456789,run_id:123456,run_attempt:1,head_sha:SHA,
    name:'Protected PAPER approval - operational HOLD',status:'completed',conclusion:'failure'},
  deployment:{id:34567,environment:'PAPER_CUSTODY_APPROVAL',ref:'main',sha:SHA,task:'deploy',
    creator:{login:'github-actions[bot]'}},
  deploymentStatus:{deployment_id:34567,state:'success',environment:'PAPER_CUSTODY_APPROVAL'},
  jobDeploymentAttestation:{kind:'UNVERIFIED_ONLY',verified:false},
  writerInventory:{schemaVersion:'paper-account-writer-inventory-v1',accountSha256:ACCOUNT,
    scopeSha256:SCOPE,complete:true,custodyWriterCount:1,
    externalWriterDiscovery:'INDEPENDENT_EVIDENCE_REQUIRED',
    brokerCredentialInventory:'INDEPENDENT_EVIDENCE_REQUIRED',
    requiredLegacyIds:['legacy-dry-run','legacy-market-guard'],
    writers:[writer('legacy-dry-run',true),writer('legacy-market-guard',true),
      writer('custody-writer',false,'STATE_MUTATION')]},
  durableClaim:{status:'UNVERIFIED',authorized:false}
});
let checks=0;
const held=x=>{const r=inspect(x);assert.equal(r.status,'HOLD_UNATTESTED_DEPLOYMENT_AND_WRITER_BOUNDARY');
  assert.deepEqual(r.findings,[]);assert.equal(r.deploymentEvidenceShapeMatched,true);
  assert.equal(r.writerInventoryShapeMatched,true);
  for(const name of ['authenticatedJobDeploymentVerified','externalEnvironmentPolicyAttested',
    'brokerAccountOwnershipVerified','accountWideWriterExclusionVerified',
    'legacyWriterDecommissionVerified','durableWriterClaimVerified','operationalEligible',
    'stateMutationAuthorized','brokerSubmitAuthorized'])assert.equal(r[name],false);
  checks++;};
const deny=(x,code)=>{let r=inspect(x);assert.equal(r.status,'DENY_DEPLOYMENT_OR_WRITER_EVIDENCE');
  assert.ok(r.findings.includes(code),JSON.stringify(r.findings));
  assert.equal(r.operationalEligible,false);assert.equal(r.stateMutationAuthorized,false);
  assert.equal(r.brokerSubmitAuthorized,false);checks++;};
const modify=(fn,code)=>{const x=sample();fn(x);deny(x,code);};
held(sample());
deny(null,'EXPECTED_CONTEXT_INVALID');
deny({},'EXPECTED_CONTEXT_INVALID');
modify(x=>{x.expected=null;},'EXPECTED_CONTEXT_INVALID');
modify(x=>{x.expected.accountSha256='bad';},'EXPECTED_CONTEXT_INVALID');
modify(x=>{x.expected.sha='bad';},'EXPECTED_CONTEXT_INVALID');
modify(x=>{x.expected.attempt=2;},'EXPECTED_CONTEXT_INVALID');
modify(x=>{x.run.run_attempt=2;},'RUN_BOUNDARY_INVALID');
modify(x=>{x.run.event='pull_request';},'RUN_BOUNDARY_INVALID');
modify(x=>{x.run.head_sha='f'.repeat(40);},'RUN_BOUNDARY_INVALID');
modify(x=>{x.job.id=1;},'PROTECTED_HOLD_JOB_INVALID');
modify(x=>{x.job.conclusion='success';},'PROTECTED_HOLD_JOB_INVALID');
modify(x=>{x.deployment.sha='f'.repeat(40);},'DEPLOYMENT_STATUS_UNBOUND');
modify(x=>{x.deployment.id=1;},'DEPLOYMENT_STATUS_UNBOUND');
modify(x=>{x.deploymentStatus.state='inactive';},'DEPLOYMENT_STATUS_UNBOUND');
modify(x=>{x.jobDeploymentAttestation.verified=true;},'JOB_DEPLOYMENT_ATTESTATION_MISSING');
modify(x=>{x.jobDeploymentAttestation=null;},'JOB_DEPLOYMENT_ATTESTATION_MISSING');
modify(x=>{x.writerInventory.complete=false;},'ACCOUNT_WRITER_INVENTORY_INCOMPLETE');
modify(x=>{x.writerInventory.writers=[];},'ACCOUNT_WRITER_INVENTORY_INCOMPLETE');
modify(x=>{x.writerInventory.writers[0].accountSha256='f'.repeat(64);},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[0].evidenceDigest='bad';},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[0].token='forbidden';},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[0].disposition='ACTIVE';},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[2].custodyEnforced=false;},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers.push({...x.writerInventory.writers[0]});},'WRITER_IDS_INVALID');
modify(x=>{x.writerInventory.requiredLegacyIds.push('unknown');},'LEGACY_WRITER_COVERAGE_INCOMPLETE');
modify(x=>{x.writerInventory.writers[0].legacy=false;},'LEGACY_WRITER_COVERAGE_INCOMPLETE');
modify(x=>{x.writerInventory.writers[0].disposition='MIGRATED_TO_CUSTODY';x.writerInventory.writers[0].custodyEnforced=true;},'LEGACY_WRITER_NOT_EXCLUDED');
modify(x=>{x.writerInventory.externalWriterDiscovery='PROVEN';},'EXTERNAL_OR_CUSTODY_SCOPE_UNVERIFIED');
modify(x=>{x.writerInventory.custodyWriterCount=2;},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.custodyWriterCount='1';},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.custodyWriterCount=1.5;},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.writers.pop();},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.writers.push({...x.writerInventory.writers[2],id:'custody-secondary'});},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.writers[2].disposition='BLOCKED_BY_TESTED_GATE';x.writerInventory.writers[2].custodyEnforced=false;},'CUSTODY_WRITER_CARDINALITY_INVALID');
modify(x=>{x.writerInventory.writers[2].legacy='false';},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[2].legacy=null;},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[2].custodyEnforced='true';},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[0].custodyEnforced=true;},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[0].authorized=true;},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writers[2].independentlyVerified=false;},'WRITER_CONTROL_INVALID');
modify(x=>{x.writerInventory.writerAdmissionVerified=true;},'ACCOUNT_WRITER_INVENTORY_INCOMPLETE');
modify(x=>{x.jobDeploymentAttestation.independentApproval=true;},'JOB_DEPLOYMENT_ATTESTATION_MISSING');
modify(x=>{x.durableClaim.brokerWriterConfirmed=true;},'DURABLE_WRITER_CLAIM_UNVERIFIED');
modify(x=>{x.durableClaim.status='AUTHORIZED';},'DURABLE_WRITER_CLAIM_UNVERIFIED');
assert.equal(JSON.stringify(inspect(sample())).includes('forbidden'),false);checks++;
console.log(JSON.stringify({status:'OFFLINE_PAPER_DEPLOYMENT_WRITER_EXCLUSION_PASS',
 checks,actualGithubRequests:0,brokerRequests:0,externalStateWrites:0,operationalAuthorityGranted:0}));
