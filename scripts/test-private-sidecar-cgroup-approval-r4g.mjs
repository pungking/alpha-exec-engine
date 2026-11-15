// Issue #91 R4G — synthetic approval contract for a future isolated cgroup v2 PoC.
// This file does not discover, create, migrate, or kill any OS process/cgroup.
// A "ready" synthetic manifest is an acceptance-test fixture, NOT authority.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DENY = 'DENY';
const conditions = Object.freeze([
  'dedicatedEphemeralHost', 'hostOwnerIdentified', 'outOfBandRecoveryConfirmed',
  'separateUserHostApproval', 'humanSecurityApproved', 'humanOperationsApproved',
  'cgroupV2DelegatedChildVerified', 'noSharedPidsInScope',
  'independentSupervisorOutsideChild', 'childOnlyKillAuthorization',
  'scopeEscapeDenied', 'networkDenied', 'credentialsAbsent',
  'syntheticProducerOnly', 'boundedCleanupVerified',
]);
function evaluate(record) {
  // Strict all-true allowlist with no implicit approval from a read-only probe.
  const missing = conditions.filter(key=>record?.[key] !== true);
  const denied = missing.length !== 0 ||
    record?.hostKind !== 'DEDICATED_DISPOSABLE' ||
    record?.rootOrSharedScope === true ||
    record?.requestedOperation !== 'PROPOSE_HOST_SANDBOX_TEST';
  return {
    decision: denied ? DENY : 'DESIGN_READY_ONLY',
    missing,
    authorizesExecution: false,
    admissionApproved: false,
    hostWideNoOrphan: 'UNVERIFIED',
    requiresSeparateExecutionApproval: true,
  };
}
const valid = Object.fromEntries(conditions.map(k=>[k,true]));
valid.hostKind='DEDICATED_DISPOSABLE';
valid.rootOrSharedScope=false;
valid.requestedOperation='PROPOSE_HOST_SANDBOX_TEST';
const tests=[
  ['empty',{},DENY],
  ['synthetic-design-ready',valid,'DESIGN_READY_ONLY'],
  ['shared-host',{...valid,hostKind:'GITHUB_HOSTED_SHARED'},DENY],
  ['root-cgroup',{...valid,rootOrSharedScope:true},DENY],
  ['operational-command',{...valid,requestedOperation:'RUN_CGROUP_KILL'},DENY],
  ...conditions.map(k=>['missing-'+k,{...valid,[k]:false},DENY]),
  ['unknown-scope',{...valid,cgroupV2DelegatedChildVerified:'UNVERIFIED'},DENY],
  ['unverified-owner',{...valid,hostOwnerIdentified:null},DENY],
];
for(const [name,input,expected] of tests) {
  const result=evaluate(input);
  assert.equal(result.decision,expected,name);
  assert.equal(result.authorizesExecution,false,name);
  assert.equal(result.admissionApproved,false,name);
  assert.equal(result.requiresSeparateExecutionApproval,true,name);
  assert.equal(result.hostWideNoOrphan,'UNVERIFIED',name);
}
const baseline=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
assert.equal(baseline.operationalHold,true);
assert.equal(Object.keys(baseline.evidenceSha256).length,140);
assert.equal(baseline.workflows.length,17);
assert.equal(baseline.workflows.reduce((n,w)=>n+w.jobs.length,0),21);
assert.equal(baseline.blockers.length,10);
assert.ok(baseline.blockers.every(b=>b.status==='OPEN'));
const doc=fs.readFileSync('docs/issue-91-r4g-sandbox-acceptance.md','utf8');
for(const keyword of ['root/shared','out-of-band','separate user','human security',
 'cgroup.kill','rollback','DEFERRED','HOLD']) assert.ok(doc.includes(keyword),'missing gate '+keyword);
console.log(JSON.stringify({
  status:'R4G_OFFLINE_SANDBOX_ACCEPTANCE_CONTRACT_PASS',
  fixtureCases:tests.length,
  mandatoryGates:conditions.length,
  syntheticReadyIsExecutionAuthorization:false,
  realCgroupPoCExecuted:false,
  delegatedHostVerified:false,
  hostWideNoOrphan:'UNVERIFIED',
  operationalHold:true,
  admissionApproved:false,
}));
