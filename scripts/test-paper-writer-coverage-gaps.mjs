import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectPaperWriterCoverageGaps as inspect } from './lib/paper-writer-coverage-gaps.mjs';
const reviewed=JSON.parse(await readFile(new URL('../config/paper-workflow-admission-baseline.json',import.meta.url),'utf8'));
const ids=[
  'dry-run.yml#dry-run','market-guard.yml#market-guard',
  'ledger-filled-migration.yml#ledger-filled-migration',
  'paper-five-row-active-limited-state-recovery.yml#recover',
  'paper-oco-submit-canary.yml#submit-canary',
  'persistent-oco-repair-submit.yml#submit-persistent-repair',
];
const ext=['BROKER_API_CREDENTIALS','OTHER_REPOSITORIES','OUT_OF_BAND_CLIENTS','RUNNER_AND_CACHE_STATE'];
const sample=()=>({
 baseline:structuredClone(reviewed),
 coverage:{schemaVersion:'paper-writer-coverage-declaration-v1',
   paths:ids.map(id=>({id,status:'UNVERIFIED_RUNTIME_EXCLUSION',sourceDigest:'a'.repeat(64)})),
   externalSurfaces:ext.map(id=>({id,status:'INDEPENDENT_PROOF_REQUIRED'}))},
 deploymentProof:{jobSpecificApproval:'UNVERIFIED',provenance:'UNVERIFIED',attestationVerified:false},
 fencingProof:{brokerSideLease:'UNVERIFIED',writerPreemption:'UNVERIFIED',accountWideExclusionVerified:false},
});
let checks=0;
const safe=r=>{for(const p of ['authenticatedJobDeploymentVerified','independentDeploymentProvenanceVerified',
  'fullBrokerCredentialReachabilityVerified','accountWideWriterExclusionVerified',
  'externallyEnforcedFencingVerified','legacyWriterRetiredVerified','operationalEligible',
  'stateMutationAuthorized','brokerSubmitAuthorized'])assert.equal(r[p],false);};
const held=x=>{const r=inspect(x);assert.equal(r.status,'HOLD_SOURCE_COVERAGE_NOT_RUNTIME_EXCLUSION');
 assert.deepEqual(r.findings,[]);assert.equal(r.sourceInventoryShapeMatched,true);safe(r);checks++;};
const deny=(x,reason)=>{const r=inspect(x);assert.equal(r.status,'DENY_WRITER_COVERAGE_INCOMPLETE');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));safe(r);checks++;};
const mutate=(fn,reason)=>{const v=sample();fn(v);deny(v,reason);};
held(sample());
deny(null,'REVIEWED_BASELINE_SHAPE_INVALID');
deny({},'REVIEWED_BASELINE_SHAPE_INVALID');
mutate(v=>{v.baseline.operationalHold=false;},'REVIEWED_BASELINE_SHAPE_INVALID');
mutate(v=>{v.baseline.workflows=[];},'REVIEWED_BASELINE_SHAPE_INVALID');
mutate(v=>{v.baseline.blockers[0].status='CLOSED';},'REVIEWED_BASELINE_SHAPE_INVALID');
mutate(v=>{v.baseline.workflows[0].jobs.push({...v.baseline.workflows[0].jobs[0]});},'JOB_DUPLICATE');
mutate(v=>{v.baseline.workflows[0].jobs[0].operationalEligible=true;},'UNSAFE_ADMISSION_PROMOTION');
mutate(v=>{v.baseline.workflows.find(w=>w.file==='dry-run.yml').jobs[0].classification='CI_FIXTURES';},'MUTATION_WRITER_PATH_CHANGED');
mutate(v=>{v.baseline.workflows.find(w=>w.file==='paper-oco-submit-canary.yml').jobs.find(j=>j.id==='admission').observed.environment=null;},'ADMISSION_HOLD_COVERAGE_CHANGED');
mutate(v=>{v.baseline.workflows.find(w=>w.file==='market-guard.yml').jobs[0].observed.environment='PAPER_CUSTODY_APPROVAL';},'LEGACY_WRITER_ENVIRONMENT_DRIFT');
mutate(v=>{v.coverage.paths.pop();},'DECLARED_COVERAGE_INCOMPLETE');
mutate(v=>{v.coverage.paths[0].id='wrong';},'LEGACY_WRITER_EVIDENCE_INVALID');
mutate(v=>{v.coverage.paths[0].status='VERIFIED';},'LEGACY_WRITER_EVIDENCE_INVALID');
mutate(v=>{v.coverage.paths[1].sourceDigest='invalid';},'LEGACY_WRITER_EVIDENCE_INVALID');
mutate(v=>{v.coverage.paths[1].id=v.coverage.paths[0].id;},'LEGACY_WRITER_EVIDENCE_INVALID');
mutate(v=>{v.coverage.externalSurfaces[0].status='PROVEN';},'EXTERNAL_WRITER_SURFACE_UNBOUNDED');
mutate(v=>{v.coverage.externalSurfaces[0].id='UNKNOWN';},'EXTERNAL_WRITER_SURFACE_UNBOUNDED');
mutate(v=>{v.deploymentProof.attestationVerified=true;},'AUTHENTICATED_DEPLOYMENT_PROOF_ABSENT');
mutate(v=>{v.deploymentProof.jobSpecificApproval='APPROVED';},'AUTHENTICATED_DEPLOYMENT_PROOF_ABSENT');
mutate(v=>{v.fencingProof.accountWideExclusionVerified=true;},'ACCOUNT_FENCING_PROOF_ABSENT');
mutate(v=>{v.fencingProof.brokerSideLease='ACQUIRED';},'ACCOUNT_FENCING_PROOF_ABSENT');
console.log(JSON.stringify({status:'OFFLINE_PAPER_WRITER_COVERAGE_GAPS_PASS',checks,
 githubCalls:0,brokerRequests:0,externalStateWrites:0,operationalAuthorityGranted:0}));
