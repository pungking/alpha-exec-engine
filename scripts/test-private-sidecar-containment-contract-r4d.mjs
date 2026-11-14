// Issue #91 STEP #91-14C-R4D — read-only scoped containment claim contract.
// This is NOT a host process isolation test or a trust baseline generator.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');
const probe = read('scripts/probe-private-sidecar-diagnostic.mjs');
const processTest = read('scripts/test-private-sidecar-process-tree-r4b.mjs');
const securityTest = read('scripts/test-private-sidecar-security-r4b.mjs');
const doc = read('docs/issue-91-r4d-process-containment-review.md');
const baseline = JSON.parse(read('config/paper-workflow-admission-baseline.json'));

// The exact six existing Linux synthetic scenarios must be kept as distinct
// observations. In particular, never conflate test-supervisor cleanup with
// process-group cleanup implemented by the application.
const cases = [
  ['same-group-success', false],
  ['escaped-timeout', true],
  ['SIGTERM', false],
  ['SIGINT', false],
  ['SIGHUP', false],
  ['killed-probe-parent', true],
];
for (const [name] of cases) {
  assert.ok(processTest.includes("'"+name+"'"), 'missing synthetic process case: ' + name);
  assert.ok(doc.includes(name), 'undocumented process boundary: ' + name);
}
assert.match(processTest, /'DEMONSTRATED_CONTAINMENT_LIMIT'/);
assert.match(processTest, /supervisorCleanup:true/);
assert.match(processTest, /hostWideNoOrphan:'UNVERIFIED'/);
assert.match(processTest, /'SIGKILL'/);
assert.match(probe, /process\.kill\(-child\.pid, "SIGKILL"\)/);
assert.match(probe, /detached: true/);
assert.match(probe, /\["SIGTERM", "SIGINT", "SIGHUP"\]/);
assert.match(securityTest, /n03SymlinkAndPathSwapVerifiedOffline:true/);
assert.match(securityTest, /otherRuntimeAndHostLimitsUnresolved:true/);
assert.match(doc, /\*\*UNVERIFIED\*\*/);
assert.match(doc, /\*\*OPEN\*\*/);

assert.equal(baseline.operationalHold, true);
assert.equal(Object.keys(baseline.evidenceSha256).length, 140);
assert.equal(baseline.workflows.length, 17);
assert.equal(baseline.workflows.reduce((n,w) => n + w.jobs.length,0), 21);
assert.equal(baseline.blockers.length,10);
assert.ok(baseline.blockers.every(x => x.status === 'OPEN'));
assert.equal(baseline.reviewBy, '2026-12-11T00:00:00Z');

console.log(JSON.stringify({
  status: 'R4D_SCOPED_CONTAINMENT_CONTRACT_PASS',
  scope: 'STATIC_OFFLINE_CLAIMS_ONLY',
  sixPriorLinuxCasesEnumerated: cases.length,
  knownEscapedOrKilledParentSurvivorCases: cases.filter(x=>x[1]).map(x=>x[0]),
  hostWideNoOrphan: 'UNVERIFIED',
  admissionReattestationApproved: false,
  operationalHold: true
}));
