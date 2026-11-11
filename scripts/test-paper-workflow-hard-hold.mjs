import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseWorkflow } from './check-paper-workflow-admission.mjs';
import { MUTATION_TARGETS } from './lib/paper-mutation-admission-contract.mjs';

// This source-inspection suite is offline: it neither dispatches Actions nor calls a broker.
const REVIEW_IF = '$' + "{{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}";
const MUTATE_IF = '$' + "{{ needs.admission.result == 'success' && needs.admission.outputs.operational_authorized == 'true' }}";
const HOLD_SCRIPT = [
  'set -euo pipefail',
  'echo \\'{"status":"BLOCKED_PAPER_CUSTODY_OPERATIONAL_HOLD","operationalAuthorized":false}\\'',
  'exit 1',
].join('\n');
let checks = 0;
function gateContract(w, target) {
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch'], 'only manual dispatch may target a PAPER mutation');
  assert.deepEqual(Object.keys(w.jobs).sort(), ['admission', target.job].sort(), 'unexpected job/change of writer');
  const admission = w.jobs.admission;
  const mutation = w.jobs[target.job];
  assert.equal(admission.environment, 'PAPER_CUSTODY_APPROVAL');
  assert.equal(admission.if, REVIEW_IF);
  assert.deepEqual(admission.permissions, { contents: 'read' });
  assert.equal(admission['runs-on'], 'ubuntu-latest');
  assert.equal(admission['timeout-minutes'], 5);
  assert.equal(admission.needs ?? null, null);
  assert.equal(admission.outputs ?? null, null, 'no operational_authorized output is permitted');
  assert.equal(admission.env ?? null, null, 'approval job must not accept broker/environment inputs');
  assert.equal(admission.steps.length, 1, 'no additional side-effect step may execute in approval job');
  assert.equal(admission.steps[0].name, 'Fail-closed PAPER operational custody HOLD');
  assert.equal(admission.steps[0].shell, 'bash');
  assert.equal(admission.steps[0].run.trim(), HOLD_SCRIPT);
  assert.equal(admission.steps[0].if ?? null, null);
  assert.equal(admission.steps[0].env ?? null, null);
  assert.equal(mutation.needs, 'admission', 'mutation must wait for protected review');
  assert.equal(mutation.if, MUTATE_IF, 'even a bypassed/failed approval may not authorize mutation');
  assert.equal(mutation.environment ?? null, null, 'broker job must remain unable to start');
  assert.ok(Array.isArray(mutation.steps) && mutation.steps.length > 0);
  return true;
}
const check = fn => { fn(); checks++; };
const negative = (source, target, change) => check(() => {
  const copy = structuredClone(source);
  change(copy, target.job);
  assert.throws(() => gateContract(copy, target));
});
for (const [file, target] of Object.entries(MUTATION_TARGETS)) {
  const workflow = parseWorkflow(fs.readFileSync('.github/workflows/' + file, 'utf8'));
  check(() => gateContract(workflow, target));
  negative(workflow, target, w => { delete w.jobs.admission.environment; });
  negative(workflow, target, w => { w.jobs.admission.environment = 'PAPER_UNPROTECTED'; });
  negative(workflow, target, w => { w.jobs.admission.if = '$' + '{{ always() }}'; });
  negative(workflow, target, w => { w.jobs.admission.steps[0].run = 'exit 0'; });
  negative(workflow, target, w => { w.jobs.admission.steps[0].run += '\nexit 0'; });
  negative(workflow, target, w => { w.jobs.admission.steps.push({ run: 'echo dangerous' }); });
  negative(workflow, target, w => { w.jobs.admission.outputs = { operational_authorized: 'true' }; });
  negative(workflow, target, w => { w.jobs.admission.permissions = { contents: 'write' }; });
  negative(workflow, target, w => { w.jobs.admission.env = { ALPACA_KEY_ID: '$' + '{{ secrets.ALPACA_KEY_ID }}' }; });
  negative(workflow, target, (w, job) => { delete w.jobs[job].needs; });
  negative(workflow, target, (w, job) => { w.jobs[job].if = '$' + '{{ always() }}'; });
  negative(workflow, target, (w, job) => { w.jobs[job].if = '$' + '{{ needs.admission.result == "success" }}'; });
  negative(workflow, target, (w, job) => { w.jobs[job].needs = ['admission', 'untrusted']; });
  negative(workflow, target, w => { w.on.push = { branches: ['main'] }; });
  negative(workflow, target, w => { w.jobs.hijack = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'exit 0' }] }; });
}
console.log(JSON.stringify({
  status: 'OFFLINE_PAPER_WORKFLOW_HARD_HOLD_PASS', checks,
  approvedJobs: 0, authorizedOrders: 0, authorizedStateWrites: 0,
}));
