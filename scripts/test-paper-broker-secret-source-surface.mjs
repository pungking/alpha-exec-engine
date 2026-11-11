import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 inspectPaperBrokerSecretSourceSurface as inspect,
} from './lib/paper-broker-secret-source-surface.mjs';

const REPO='pungking/alpha-exec-engine';
const SOURCE='4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const B=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const CLAIMS=['brokerSecretValuesRead','brokerCredentialsExistVerified',
 'paperAccountIdentityVerified','liveAccountExcluded',
 'brokerKeysExhaustivelyEnumerated','externalWritersExcluded',
 'allMutationEdgesFenced','independentReplayEnforced',
 'humanOperationalApprovalObtained','operationalEligible'];
function fixture(){
 return {schemaVersion:'paper-broker-secret-source-surface-v1',
  repository:REPO,reviewedSourceCommit:SOURCE,baseline:structuredClone(B),
  authorityClaims:Object.fromEntries(CLAIMS.map(k=>[k,false]))};
}
function job(x,file,id){
 const w=x.baseline.workflows.find(x=>x.file===file);
 assert.ok(w,'missing fixture workflow '+file);
 const j=w.jobs.find(x=>x.id===id);
 assert.ok(j,'missing fixture job '+id);
 return j;
}
let checks=0;
function safe(r){
 for(const key of ['secretValuesRead','brokerCredentialExistenceVerified',
  'paperLiveAccountSeparationVerified','externalAccountWritersExcluded',
  'mutationEdgeFencingVerified','independentReplayVerified',
  'operationalEligible','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized'])assert.equal(r[key],false,key);
 assert.ok(r.proofGaps.includes(
  'EXTERNAL_LEGACY_LOCAL_SCHEDULED_AND_DIRECT_WRITERS_NOT_EXCLUDED'));
}
function held(x){
 const r=inspect(x);
 assert.equal(r.status,'HOLD_EXTERNAL_BROKER_WRITER_INVENTORY_NOT_VERIFIED',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.reviewedSourceOnlyExposureSetMatched,true);
 assert.equal(r.sourceReferencedBrokerJobs,9);
 assert.equal(r.sourceReferencedAutomaticJobs,2);
 assert.equal(r.sourceReferencedSubmitJobs,2);
 assert.equal(r.sourceReferencedBrokerReadJobs,4);
 assert.equal(r.sourceReferencedLedgerMigrationJobs,1);
 assert.equal(r.sourceReferencedJobsWithProtectedEnvironment,0);
 assert.equal(r.reviewedSourceExposures.length,9);
 assert.ok(r.reviewedSourceExposures.some(v=>v.file==='paper-oco-submit-canary.yml'
  &&v.job==='submit-canary'));
 safe(r);checks++;return r;
}
function denied(x,why){
 const r=inspect(x);
 assert.equal(r.status,'DENY_BROKER_SECRET_SOURCE_INVENTORY_DRIFT');
 assert.ok(r.findings.includes(why),JSON.stringify(r.findings));
 assert.equal(r.reviewedSourceOnlyExposureSetMatched,false);
 assert.equal(r.sourceReferencedBrokerJobs,null);
 safe(r);checks++;
}
const change=(fn,code)=>{const x=fixture();fn(x);denied(x,code);};
held(fixture());
denied({},'SOURCE_EXPOSURE_ENVELOPE_INVALID');
denied(null,'SOURCE_EXPOSURE_ENVELOPE_INVALID');
change(x=>{x.schemaVersion='APPROVED';},'SOURCE_EXPOSURE_ENVELOPE_INVALID');
change(x=>{x.repository='attacker/repo';},'SOURCE_EXPOSURE_ENVELOPE_INVALID');
change(x=>{x.reviewedSourceCommit='a'.repeat(40);},
 'SOURCE_EXPOSURE_ENVELOPE_INVALID');
change(x=>{x.executionApproved=true;},'SOURCE_EXPOSURE_ENVELOPE_INVALID');
for(const k of CLAIMS) change(x=>{x.authorityClaims[k]=true;},
 'UNSUPPORTED_BROKER_WRITER_AUTHORITY_CLAIM');
change(x=>{x.authorityClaims.verifiedExternalWriters=true;},
 'UNSUPPORTED_BROKER_WRITER_AUTHORITY_CLAIM');
change(x=>{delete x.authorityClaims;},
 'UNSUPPORTED_BROKER_WRITER_AUTHORITY_CLAIM');
change(x=>{x.baseline.operationalHold=false;},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.sourceRef='refs/heads/paper-state';},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.sourceCommit='f'.repeat(40);},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.settingsEvidence='GITHUB_FULLY_ATTESTED';},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.workflows.pop();},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.blockers[0].status='CLOSED';},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.blockers.pop();},
 'SOURCE_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.workflows[0].jobs.push({id:'new-broker-job'});},
 'WORKFLOW_SOURCE_JOB_GRAIN_INVALID');
change(x=>{x.baseline.workflows[0].file='dry-run.yml';},
 'WORKFLOW_SOURCE_JOB_GRAIN_INVALID');
change(x=>{job(x,'paper-oco-submit-canary.yml','submit-canary')
  .observed.secrets=['ALPACA_KEY_ID'];},
 'PARTIAL_OR_UNKNOWN_BROKER_SECRET_REFERENCE');
change(x=>{job(x,'paper-oco-submit-canary.yml','submit-canary')
  .observed.secrets=[];},
 'BROKER_SECRET_EXPOSURE_SET_DRIFT');
change(x=>{job(x,'paper-oco-submit-canary.yml','submit-canary')
  .observed.secrets.push('ALPACA_NEW_CREDENTIAL');},
 'PARTIAL_OR_UNKNOWN_BROKER_SECRET_REFERENCE');
change(x=>{job(x,'dry-run.yml','dry-run')
  .observed.secrets.push('ALPACA_KEY_ID');},
 'UNREVIEWED_DYNAMIC_OR_DUPLICATE_SECRET_REFERENCE');
change(x=>{job(x,'ci.yml','build').observed.secrets=[
 'ALPACA_KEY_ID','ALPACA_SECRET_KEY'];},
 'BROKER_SECRET_EXPOSURE_SET_DRIFT');
change(x=>{job(x,'paper-oco-submit-canary.yml','submit-canary')
  .observed.environment='PAPER_CUSTODY_APPROVAL';},
 'BROKER_SECRET_ENVIRONMENT_SCOPE_DRIFT');
change(x=>{job(x,'paper-oco-read-verify.yml','read-verify')
  .observed.dynamicSecretReference=true;},
 'UNREVIEWED_DYNAMIC_OR_DUPLICATE_SECRET_REFERENCE');
change(x=>{job(x,'dry-run.yml','dry-run')
  .observed.effectiveJobFlags.EXEC_ENABLED='true';},
 'REVIEWED_BROKER_EXECUTION_FLAG_CHANGED');
change(x=>{job(x,'dry-run.yml','dry-run')
  .observed.effectiveJobFlags.LIVE_ORDER_SUBMIT_ENABLED=true;},
 'REVIEWED_BROKER_EXECUTION_FLAG_CHANGED');
change(x=>{job(x,'market-guard.yml','market-guard')
  .observed.effectiveJobFlags.READ_ONLY='false';},
 'REVIEWED_BROKER_READONLY_FLAG_CHANGED');
change(x=>{job(x,'market-guard.yml','market-guard')
  .classification='MANUAL_BROKER_SUBMIT';},
 'BROKER_JOB_ROLE_CLASSIFICATION_DRIFT');
change(x=>{job(x,'paper-oco-submit-canary.yml','submit-canary')
  .classification='MANUAL_BROKER_READ_REPORT';},
 'BROKER_JOB_ROLE_CLASSIFICATION_DRIFT');
change(x=>{job(x,'ledger-filled-migration.yml','admission')
  .observed.secrets=['ALPACA_KEY_ID','ALPACA_SECRET_KEY'];},
 'BROKER_SECRET_ENVIRONMENT_SCOPE_DRIFT');
change(x=>{job(x,'ledger-filled-migration.yml','admission')
  .observed.environment=null;},
 'PROTECTED_ADMISSION_NO_BROKER_SECRET_BOUNDARY_DRIFT');
change(x=>{job(x,'persistent-oco-repair-submit.yml','admission')
  .observed.secrets=['OTHER_SECRET'];},
 'PROTECTED_ADMISSION_NO_BROKER_SECRET_BOUNDARY_DRIFT');
const secret=fixture();
job(secret,'dry-run.yml','dry-run').observed.secrets.push(
 'SYNTHETIC_VALUE_NEVER_REFLECT');
const result=held(secret);
assert.ok(!JSON.stringify(result).includes('SYNTHETIC_VALUE_NEVER_REFLECT'));
checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_BROKER_SECRET_SOURCE_SURFACE_PASS',
 checks,workflowCount:17,jobCount:21,sourceBrokerSecretJobs:9,
 automaticBrokerSecretJobs:2,submitBrokerSecretJobs:2,
 brokerReadJobReferences:4,ledgerMigrationReferences:1,
 directProtectedBrokerSecretJobs:0,actualGithubRequests:0,brokerRequests:0,
 externalStateWrites:0,actualCredentialScopesVerified:0,
 operationalAuthorityGranted:0,
}));
