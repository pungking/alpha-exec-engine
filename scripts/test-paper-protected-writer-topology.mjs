import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 PAPER_PROTECTED_WRITER_TOPOLOGY as TARGETS,
 inspectPaperProtectedWriterTopology as inspect,
} from './lib/paper-protected-writer-topology.mjs';

const ORIGINAL=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const FILES=Object.fromEntries(TARGETS.map(t=>[
 t.file,fs.readFileSync('.github/workflows/'+t.file,'utf8'),
]));
const copy=()=>({baseline:structuredClone(ORIGINAL),workflowSources:{...FILES}});
let checks=0;
const flags=r=>{
 for(const key of ['protectedAdmissionApprovalTransfersToWriter',
  'jobSpecificOperationalApprovalVerified','environmentPolicyIndependentProof',
  'accountWideWriterExclusionVerified','brokerMutationFencingVerified',
  'operationalEligible','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized']) assert.equal(r[key],false,key);
 assert.ok(r.proofGaps.includes('PROTECTED_ADMISSION_IS_NOT_MUTATION_JOB'));
};
const held=x=>{
 const r=inspect(x);
 assert.equal(r.status,'HOLD_APPROVED_ADMISSION_NOT_WRITER_JOB_AUTHORITY',
  JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);
 assert.equal(r.reviewedSourceTopologyMatched,true);
 assert.equal(r.protectedAdmissionJobCount,4);
 assert.equal(r.unboundMutationJobCount,4);
 assert.equal(r.noAdmissionAuthorizationOutputObserved,true);
 assert.equal(r.admissionJobItselfFailsClosed,true);
 flags(r);checks++;
 return r;
};
const denied=(x,reason)=>{
 const r=inspect(x);
 assert.equal(r.status,'DENY_WRITER_TOPOLOGY_SOURCE_DRIFT');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.reviewedSourceTopologyMatched,false);
 assert.equal(r.protectedAdmissionJobCount,0);
 assert.equal(r.unboundMutationJobCount,0);
 flags(r);checks++;
};
const change=(fn,reason)=>{const x=copy();fn(x);denied(x,reason);};
const first=TARGETS[0].file,canary=TARGETS[2].file;
const mutate=(x,file,oldPart,newPart)=>{
 assert.ok(x.workflowSources[file].includes(oldPart),'fixture input missing');
 x.workflowSources[file]=x.workflowSources[file].replace(oldPart,newPart);
};
held(copy());
denied(null,'INPUT_ENVELOPE_INVALID');
denied({},'INPUT_ENVELOPE_INVALID');
change(x=>{x.runAuthorityGranted=true;},'INPUT_ENVELOPE_INVALID');
change(x=>{delete x.workflowSources[first];},'REVIEWED_WORKFLOW_SET_INCOMPLETE');
change(x=>{x.workflowSources['unknown-workflow.yml']='jobs: {}';},
 'REVIEWED_WORKFLOW_SET_INCOMPLETE');
change(x=>{x.baseline.operationalHold=false;},'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.settingsEvidence='LIVE_FETCH_CONFIRMED';},
 'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.sourceRef='refs/heads/paper-state';},
 'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.stateRef='refs/heads/main';},
 'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.workflows.pop();},'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.blockers.pop();},'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.blockers[0].status='CLOSED';},
 'FROZEN_ADMISSION_BOUNDARY_INVALID');
change(x=>{x.baseline.workflows[0].jobs[0].operationalEligible=true;},
 'WORKFLOW_DEFINITION_SHA_DRIFT'); // replaced below with target mutation
change(x=>{x.baseline.workflows.find(w=>w.file===first).definitionSha256='f'.repeat(64);},
 'WORKFLOW_DEFINITION_SHA_DRIFT');
change(x=>{x.baseline.workflows.find(w=>w.file===first).jobs.find(j=>j.id==='admission').observed.environment=null;},
 'REVIEWED_JOB_CLASSIFICATION_OR_ENV_DRIFT');
change(x=>{x.baseline.workflows.find(w=>w.file===first).jobs.find(j=>j.id==='ledger-filled-migration').observed.environment='PAPER_CUSTODY_APPROVAL';},
 'REVIEWED_JOB_CLASSIFICATION_OR_ENV_DRIFT');
change(x=>{x.baseline.workflows.find(w=>w.file===canary).jobs.find(j=>j.id==='submit-canary').writerClaimVerified=true;},
 'REVIEWED_JOB_CLASSIFICATION_OR_ENV_DRIFT');
change(x=>{mutate(x,first,'needs: admission','needs: other');},'WRITER_JOB_DEPENDENCY_OR_ENV_DRIFT');
change(x=>{mutate(x,first,"needs.admission.outputs.operational_authorized == 'true'",
 "needs.admission.outputs.operational_authorized != 'false'");},
 'WRITER_JOB_DEPENDENCY_OR_ENV_DRIFT');
change(x=>{mutate(x,canary,'    needs: admission',
 '    environment: PAPER_CUSTODY_APPROVAL\n    needs: admission');},
 'WRITER_JOB_DEPENDENCY_OR_ENV_DRIFT');
change(x=>{mutate(x,canary,'    environment: PAPER_CUSTODY_APPROVAL',
 '    environment: ANOTHER_APPROVAL');},
 'PROTECTED_ADMISSION_FAIL_CLOSED_DRIFT');
change(x=>{mutate(x,canary,'          exit 1','          exit 0');},
 'PROTECTED_ADMISSION_FAIL_CLOSED_DRIFT');
change(x=>{mutate(x,canary,'          exit 1',
 '          echo unexpected-output >> $GITHUB_OUTPUT\n          exit 1');},
 'PROTECTED_ADMISSION_FAIL_CLOSED_DRIFT');
change(x=>{mutate(x,first,'    steps:\n      - name: Fail-closed',
 '    outputs:\n      operational_authorized: true\n    steps:\n      - name: Fail-closed');},
 'PROTECTED_ADMISSION_FAIL_CLOSED_DRIFT');
change(x=>{mutate(x,canary,'  workflow_dispatch:', '  push:');},
 'WORKFLOW_DISPATCH_AND_JOB_SET_DRIFT');
change(x=>{mutate(x,first,'  admission:', '  different-admission:');},
 'WORKFLOW_DISPATCH_AND_JOB_SET_DRIFT');
change(x=>{mutate(x,first,'  admission:', '  admission: {bad: [');},
 'WORKFLOW_YAML_UNREVIEWED');
change(x=>{x.workflowSources[first]=42;},'WORKFLOW_SOURCE_NOT_EXACTLY_COVERED');
const res=held(copy());
assert.ok(!JSON.stringify(res).includes('ALPACA_SECRET_KEY'));checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_PROTECTED_WRITER_TOPOLOGY_PASS',
 checks,protectedAdmissionJobs:4,writerJobsWithoutEnvironment:4,
 actualGithubRequests:0,brokerRequests:0,stateMutations:0,
 operationalAuthorityGranted:0,
}));
