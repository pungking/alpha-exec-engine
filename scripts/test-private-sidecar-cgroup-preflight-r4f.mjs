// Issue #91 R4F: read-only cgroup v2 feasibility and approval-gate preflight.
// This code never creates a cgroup, moves a PID, writes cgroup.kill, or invokes
// operational producers. The path of any discovered host cgroup is NOT printed.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HOLD = Object.freeze({
  operationalHold: true,
  admissionReattestationApproved: false,
  hostWideNoOrphan: 'UNVERIFIED',
  cgroupWritesAttempted: false,
  realContainmentPoCExecuted: false,
});
function inspect({platform, selfCgroup, mountinfo, controllers, delegationGranted}) {
  if (platform !== 'linux') return {
    result: 'UNSUPPORTED_HOST', v2Hierarchy: false, ownV2Mount: false,
    controllerEvidence: false, delegatedScopeVerified: false,
    actualIsolationAuthorized: false, missing: ['LINUX_HOST'],
  };
  const membership = selfCgroup.split(/\r?\n/).some(line => /^0::/.test(line));
  const mounts = mountinfo.split(/\r?\n/).filter(line => line.includes(' - cgroup2 '));
  const v2 = membership && mounts.length > 0;
  const ownV2Mount = mounts.some(line => {
    // Source evidence of a cgroup2 mount, not validation of delegate ownership.
    const fields = line.split(' - ');
    return fields.length === 2 && fields[1].startsWith('cgroup2 ');
  });
  const controllerEvidence = /(?:^|\s)(?:cpu|memory|pids)(?:\s|$)/.test(controllers);
  const delegatedScopeVerified = false; // read-only probe CANNOT establish actual delegation.
  const missing = [];
  if (!v2 || !ownV2Mount) missing.push('CGROUP_V2_MEMBERSHIP_AND_MOUNT');
  if (!controllerEvidence) missing.push('CONTROLLER_LIST_UNVERIFIED');
  if (!delegationGranted) missing.push('OWNER_AUTHORIZATION_ABSENT');
  missing.push('DELEGATED_CHILD_SCOPE_NOT_VERIFIED');
  missing.push('ACTUAL_CONTAINMENT_NOT_TESTED');
  return {
    result: v2 && ownV2Mount ? 'V2_READONLY_OBSERVED' : 'V2_UNCONFIRMED',
    v2Hierarchy: v2, ownV2Mount, controllerEvidence, delegatedScopeVerified,
    actualIsolationAuthorized: false, missing,
  };
}

const fixture = [
  {name:'linux-v2', args:{platform:'linux',selfCgroup:'0::/runner',mountinfo:'48 27 0:27 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw',controllers:'cpu memory pids',delegationGranted:false}, expected:'V2_READONLY_OBSERVED'},
  {name:'linux-v1', args:{platform:'linux',selfCgroup:'4:cpu:/runner',mountinfo:'49 27 0:27 / /sys/fs/cgroup rw - cgroup cgroup rw',controllers:'',delegationGranted:false}, expected:'V2_UNCONFIRMED'},
  {name:'nonlinux', args:{platform:'darwin',selfCgroup:'',mountinfo:'',controllers:'',delegationGranted:false}, expected:'UNSUPPORTED_HOST'},
  {name:'not-a-delegation-even-with-flag', args:{platform:'linux',selfCgroup:'0::/runner',mountinfo:'48 27 0:27 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw',controllers:'pids',delegationGranted:true}, expected:'V2_READONLY_OBSERVED'},
];
for (const f of fixture) {
  const outcome = inspect(f.args);
  assert.equal(outcome.result, f.expected, f.name);
  assert.equal(outcome.delegatedScopeVerified, false, f.name);
  assert.equal(outcome.actualIsolationAuthorized, false, f.name);
}
let host;
if (process.platform !== 'linux') {
  host = inspect({platform:process.platform,selfCgroup:'',mountinfo:'',controllers:'',delegationGranted:false});
} else {
  let selfCgroup='', mountinfo='', controllers='';
  const safeRead = file => {
    try { return fs.readFileSync(file,{encoding:'utf8',flag:'r'}).slice(0,256*1024); }
    catch { return ''; }
  };
  selfCgroup=safeRead('/proc/self/cgroup');
  mountinfo=safeRead('/proc/self/mountinfo');
  controllers=safeRead('/sys/fs/cgroup/cgroup.controllers');
  host=inspect({platform:'linux',selfCgroup,mountinfo,controllers,delegationGranted:false});
}
// Do not publish paths, namespace IDs, account details, PIDs or mount records.
// Presence of cgroup v2, a writable-looking mount, or controllers does not
// demonstrate authority to manage an isolated delegated sub-tree.
assert.equal(host.actualIsolationAuthorized,false);
assert.equal(host.delegatedScopeVerified,false);
assert.equal(HOLD.cgroupWritesAttempted,false);
console.log(JSON.stringify({
  status:'R4F_READONLY_CGROUP_PREFLIGHT_PASS',
  fixtureCases:fixture.length,
  hostObservation:host.result,
  v2MembershipAndMountObserved:host.v2Hierarchy,
  controllersObserved:host.controllerEvidence,
  delegatedScopeVerified:host.delegatedScopeVerified,
  actualIsolationAuthorized:host.actualIsolationAuthorized,
  missingApprovalEvidence:host.missing,
  ...HOLD
}));
