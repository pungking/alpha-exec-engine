// Issue #91 STEP #91-14C-R4: offline-only re-attestation candidate,
// not a trusted-baseline update or operational approval.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file));
const sha = data => createHash('sha256').update(data).digest('hex');
const baseline = JSON.parse(read('config/paper-workflow-admission-baseline.json').toString('utf8'));
const pinned = baseline.evidenceSha256;
const wrapper = 'scripts/run-private-sidecar-step.sh';
const probe = 'scripts/probe-private-sidecar-diagnostic.mjs';
const classifier = 'scripts/classify-private-sidecar-failure.mjs';
const binding = 'scripts/paper-runtime-private-binding.mjs';
const requiredClosure = [wrapper, binding, probe, classifier];

assert.equal(baseline.operationalHold, true);
assert.equal(Object.keys(pinned).length, 140, 'reviewed source inventory is immutable in this candidate');
assert.equal(baseline.workflows.length, 17);
assert.equal(baseline.workflows.reduce((n, w) => n + w.jobs.length, 0), 21);
assert.equal(baseline.blockers.length, 10);
assert.ok(baseline.blockers.every(b => b.status === 'OPEN'));
assert.equal(baseline.reviewBy, '2026-12-11T00:00:00Z');
assert.equal(pinned[probe], undefined, 'new helper remains UNREVIEWED');
assert.equal(pinned[classifier], undefined, 'classifier remains UNREVIEWED');
assert.ok(typeof pinned[wrapper] === 'string' && typeof pinned[binding] === 'string');
assert.notEqual(sha(read(wrapper)), pinned[wrapper], 'legacy admission must block changed wrapper');
assert.equal(sha(read(binding)), pinned[binding], 'existing binding stays pinned');

// The proposed exact static invocation edge and imported dependency edge must
// be independently reviewed if source is changed. This is not general JS/shell
// program analysis, and cannot prove all possible dynamic execution edges.
const wrapperText = read(wrapper).toString('utf8');
const probeText = read(probe).toString('utf8');
const classifierText = read(classifier).toString('utf8');
assert.match(wrapperText, /node scripts\/probe-private-sidecar-diagnostic\.mjs/);
assert.match(wrapperText, /node scripts\/paper-runtime-private-binding\.mjs/);
assert.match(probeText, /new URL\(["']\.\/classify-private-sidecar-failure\.mjs["']/);
assert.match(probeText, /spawn\(command, args,/);
assert.match(classifierText, /classifyPrivateBootstrapLog/);

// Candidate-only pin set. The actual baseline/checker are never written.
// Simulated tampering of EACH execution dependency must fail the candidate
// manifest digest. No trust promotion is inferred from this self-consistency.
const candidate = Object.fromEntries(requiredClosure.map(file => [file, sha(read(file))]));
for (const file of requiredClosure) {
  assert.match(candidate[file], /^[0-9a-f]{64}$/);
  assert.notEqual(sha(Buffer.concat([read(file), Buffer.from('\n// offline mutation canary')])),
    candidate[file], file + ' tamper must be detected');
}
for (const [file, original] of Object.entries(pinned)) {
  if (file !== wrapper) {
    assert.equal(sha(read(file)), original, file + ' unexpected old-baseline drift');
  }
}
// A candidate manifest does not become trusted merely by rebuilding hashes:
// pinning the manifest requires independent custody of its reviewed digest.
const candidateManifest = JSON.stringify(Object.fromEntries(
  Object.entries(candidate).sort(([a], [b]) => a.localeCompare(b))
));
assert.notEqual(candidateManifest.length, 0);
console.log(JSON.stringify({
  status: 'OFFLINE_CANDIDATE_CLOSURE_PASS',
  oldBaseline: 'REVIEWED_ENTRYPOINT_DRIFT_EXPECTED',
  candidateOnly: true,
  reviewedSourceCount: 140,
  workflowCount: 17,
  jobCount: 21,
  openBlockerCount: 10,
  proposedDependencyCount: requiredClosure.length,
  newlyUnpinned: [probe, classifier],
  operationalHold: true,
  reattestationApproved: false,
  realRunnerNoOrphanVerified: false
}));
