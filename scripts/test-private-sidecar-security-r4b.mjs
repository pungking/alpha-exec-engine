// Synthetic evidence only. Expected RED cases are recorded, never relabelled as safety PASS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditWorkflows, loadInputs, parseWorkflow, sha256 } from './check-paper-workflow-admission.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-security-'));
const safeEnv = { PATH: process.env.PATH, ALPHA_ENV: 'PAPER', READ_ONLY: 'true',
  EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' };
let checks = 0;
const results = [];
const check = (name, fn) => { fn(); checks++; results.push({ name, status: 'TESTED' }); };
const denied = (name, fn, code) => check(name, () => assert.throws(fn, e => e.message === code));
try {
  const classifier = path.resolve('scripts/classify-private-sidecar-failure.mjs');
  const file = path.join(root, 'synthetic.log');
  const known = '[ENV_GUARD] FAIL missing=SYNTHETIC_PRIVATE_CANARY\n';
  const invoke = (target, preload) => spawnSync(process.execPath,
    [...(preload ? ['--import', preload] : []), classifier, target],
    { encoding: 'utf8', env: safeEnv, timeout: 3000, maxBuffer: 2048 });
  const category = result => {
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^(UNKNOWN|ENVIRONMENT_MISSING)\n$/);
    return result.stdout;
  };
  fs.writeFileSync(file, known, { mode: 0o600 });
  check('N03-readable-control', () => assert.equal(category(invoke(file)), 'ENVIRONMENT_MISSING\n'));
  check('N03-missing', () => assert.equal(category(invoke(file + '.missing')), 'UNKNOWN\n'));
  // Deterministic EACCES injection also works when the CI process is root.
  const unreadable = path.join(root, 'unreadable.mjs');
  fs.writeFileSync(unreadable, `import fs from 'node:fs';
    const read = fs.readFileSync; fs.readFileSync = function(p, ...a) {
      if (p === ${JSON.stringify(file)}) throw Object.assign(Error('fixture'), {code:'EACCES'});
      return read.call(this,p,...a);
    };`);
  check('N03-injected-EACCES', () => assert.equal(category(invoke(file, unreadable)), 'UNKNOWN\n'));
  fs.chmodSync(file, 0);
  if (process.getuid?.() !== 0) {
    check('N03-actual-mode000', () => assert.equal(category(invoke(file)), 'UNKNOWN\n'));
  } else results.push({ name: 'N03-actual-mode000', status: 'UNVERIFIED_ROOT_BYPASSES_DAC' });
  fs.chmodSync(file, 0o600);
  const link = path.join(root, 'link.log');
  fs.symlinkSync(file, link);
  const observedLink = category(invoke(link));
  check('N03-symlink-boundary-observed', () => assert.equal(observedLink, 'ENVIRONMENT_MISSING\n'));
  results.push({ name: 'N03-symlink-must-be-UNKNOWN', status: 'DEMONSTRATED_GAP', expected: 'UNKNOWN', observed: observedLink.trim() });
  // Swap the synthetic pathname AFTER stat; no race timing or host file is involved.
  const race = path.join(root, 'race.mjs');
  fs.writeFileSync(file, 'unclassified\n');
  fs.writeFileSync(race, `import fs from 'node:fs';
    const stat = fs.statSync; fs.statSync = function(p,...a) {
      const s = stat.call(this,p,...a);
      if (p === ${JSON.stringify(file)}) {
        fs.renameSync(p,p+'.old'); fs.writeFileSync(p,${JSON.stringify(known)});
      } return s;
    };`);
  const observedRace = category(invoke(file, race));
  check('N03-deterministic-stat-read-swap-observed', () => assert.equal(observedRace, 'ENVIRONMENT_MISSING\n'));
  results.push({ name: 'N03-TOCTOU-must-be-UNKNOWN', status: 'DEMONSTRATED_GAP', expected: 'UNKNOWN', observed: observedRace.trim() });

  const current = loadInputs();
  denied('N09-real-candidate-old-admission', () => auditWorkflows(current), 'REVIEWED_ENTRYPOINT_DRIFT');
  // Restore ONLY independently pinned old bytes in an in-memory baseline fixture.
  // The on-disk candidate and all trusted hashes remain unchanged.
  const old = spawnSync('git', ['show', '73984070264f6e47cc8ab212b4ea4db0e09d7c20:scripts/run-private-sidecar-step.sh'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 3000 });
  assert.equal(old.status, 0);
  const original = structuredClone(current);
  const wrapper = 'scripts/run-private-sidecar-step.sh';
  assert.equal(sha256(old.stdout), original.baseline.evidenceSha256[wrapper]);
  original.evidence[wrapper] = old.stdout;
  check('N10-trusted-old-fixture-control', () => assert.equal(auditWorkflows(original).operationalEligibleJobs, 0));
  const mutation = (name, change, error) => denied(name, () => {
    const x = structuredClone(original); change(x); return auditWorkflows(x);
  }, error);
  mutation('N10-baseline-hash', x => { x.baseline.packageScriptsSha256 = '0'.repeat(64); }, 'BASELINE_UNREVIEWED_CHANGE');
  mutation('N10-review-extension', x => { x.baseline.reviewBy = '2026-12-12T00:00:00Z'; }, 'BASELINE_REVIEW_EXPIRED_OR_INVALID');
  mutation('N10-package-command', x => { x.packageScripts.start = 'node unreviewed.mjs'; }, 'PACKAGE_COMMAND_DRIFT');
  mutation('N10-protected-source', x => { x.evidence['src/index.ts'] += '\n// fixture'; }, 'REVIEWED_ENTRYPOINT_DRIFT');
  mutation('N10-workflow-command', x => {
    const w = parseWorkflow(x.files['ci.yml']); w.jobs.build.steps.push({run: 'echo unreviewed'});
    x.files['ci.yml'] = JSON.stringify(w);
  }, 'WORKFLOW_DEFINITION_UNREVIEWED');
  for (const fileName of ['dry-run.yml', 'market-guard.yml']) {
    for (const [key, value] of Object.entries({ALPHA_ENV:'LIVE', READ_ONLY:'false', EXEC_ENABLED:'true',
      LIVE_ORDER_SUBMIT_ENABLED:'true', MARKET_GUARD_MODE:'execute'})) {
      mutation(`N11-${fileName}-${key}`, x => {
        const w = parseWorkflow(x.files[fileName]);
        const job = Object.values(w.jobs).find(j => j.defaults?.run?.shell?.includes('run-private-sidecar-step'));
        assert.ok(job); job.env[key] = value; x.files[fileName] = JSON.stringify(w);
      }, 'AUTOMATIC_SAFETY_DEFAULT_CHANGED');
    }
  }
  check('no-baseline-or-candidate-write', () => assert.deepEqual({...loadInputs(), now:current.now}, current));
} finally { fs.rmSync(root, {recursive: true, force: true}); }
console.log(JSON.stringify({status:'R4B_SECURITY_EVIDENCE_COLLECTED_NOT_ADMITTED', checks,
  results, operationalHold:true, runtimeDefectsFixed:false, historicRootCauseVerified:false}));
