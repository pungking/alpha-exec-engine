import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseDocument, visit, isAlias } from 'yaml';

const BASELINE = 'config/paper-workflow-admission-baseline.json';
const BASELINE_SHA256 = '2571341b9b9f4537c3c6782cfc6df3c62ed9c228aa842520ee17ebada752dc01';
const SOURCE = '4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const CLASSES = ['CI_FIXTURES', 'AUTOMATIC_DISPATCHER', 'AUTOMATIC_REPORT_CACHE_WRITER',
  'MANUAL_LEDGER_MIGRATION', 'MANUAL_ENCRYPTED_EXPORT', 'MANUAL_BROKER_READ_REPORT',
  'MANUAL_REPORT_PUBLISHER', 'MANUAL_ISOLATED_PROBE', 'MANUAL_BROKER_SUBMIT_CANCEL', 'MANUAL_BROKER_SUBMIT', 'MANUAL_ADMISSION_HOLD'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireContract = (v, code) => { if (!v) throw Error(code); };
export const canonical = v => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  requireContract(v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v), 'INVALID_VALUE');
  return JSON.stringify(v);
};
export const sha256 = v => createHash('sha256').update(v).digest('hex');

export function parseWorkflow(text) {
  requireContract(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024, 'WORKFLOW_SIZE_INVALID');
  const doc = parseDocument(text, { version: '1.2', uniqueKeys: true, strict: true, prettyErrors: false });
  requireContract(doc.errors.length === 0 && doc.warnings.length === 0 && doc.directives.yaml.version === '1.2', 'WORKFLOW_YAML_INVALID');
  visit(doc, (_, node) => requireContract(!isAlias(node) && !node?.anchor && !node?.tag, 'WORKFLOW_ALIAS_OR_TAG_UNREVIEWED'));
  const w = doc.toJS({ maxAliasCount: 0 }); canonical(w);
  requireContract(object(w) && object(w.on) && Object.keys(w.on).length > 0 && object(w.jobs) && Object.keys(w.jobs).length > 0, 'WORKFLOW_STRUCTURE_INVALID');
  requireContract(Object.keys(w).every(k => ['name', 'run-name', 'on', 'permissions', 'env', 'concurrency', 'jobs', 'defaults'].includes(k)), 'WORKFLOW_FIELD_UNREVIEWED');
  for (const j of Object.values(w.jobs)) requireContract(object(j) && Array.isArray(j.steps) && j.steps.length > 0 && !j.uses, 'JOB_STRUCTURE_UNREVIEWED');
  return w;
}

function strings(v) {
  if (typeof v === 'string') return [v];
  return v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
}
// Expression extraction documents names only; it never decides execution authority.
export function observeJob(w, j) {
  const values = strings([w.env ?? {}, w.on, j]);
  const secrets = [...new Set(values.flatMap(v => [...v.matchAll(/secrets\.([A-Za-z_][A-Za-z_0-9]*)/g)].map(m => m[1])))].sort();
  const environment = j.environment ?? null;
  return { environment, permissions: j.permissions ?? w.permissions ?? 'INHERITED_UNVERIFIED',
    workflowConcurrency: w.concurrency ?? null, jobConcurrency: j.concurrency ?? null,
    secrets, dynamicSecretReference: values.some(v => /secrets\s*\[|secrets\s*==|toJSON\(secrets\)/i.test(v)),
    effectiveJobFlags: Object.fromEntries(Object.entries({ ...w.env, ...j.env }).filter(([k]) =>
      /^(ALPHA_ENV|EXEC_ENABLED|READ_ONLY|LIVE_ORDER_SUBMIT_ENABLED|MARKET_GUARD_MODE|ORDER_LIFECYCLE_ENABLED)$/.test(k))),
    cacheSteps: j.steps.filter(s => s.uses?.startsWith('actions/cache')).map(s => ({ action: s.uses, if: s.if ?? null, with: s.with ?? {} })),
    stepOverrides: j.steps.flatMap((s, i) => s.env ? [{ step: i + 1, names: Object.keys(s.env).sort() }] : []) };
}

function readFile(root, file) {
  requireContract(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && !file.split('/').some(x => x === '..' || x === '.'), 'EVIDENCE_PATH_INVALID');
  const full = path.join(root, file), stat = fs.lstatSync(full);
  requireContract(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024
    && fs.realpathSync(full) === path.resolve(full), 'EVIDENCE_FILE_INVALID');
  return fs.readFileSync(full, 'utf8');
}
export function loadInputs(root = process.cwd()) {
  const baseline = JSON.parse(readFile(root, BASELINE));
  requireContract(sha256(canonical(baseline)) === BASELINE_SHA256, 'BASELINE_UNREVIEWED_CHANGE');
  const files = Object.fromEntries(fs.readdirSync(path.join(root, '.github/workflows')).sort().map(f => {
    requireContract(/^[A-Za-z0-9_-]+\.ya?ml$/.test(f), 'WORKFLOW_FILE_UNREVIEWED');
    return [f, readFile(root, '.github/workflows/' + f)];
  }));
  const evidence = Object.fromEntries(Object.keys(baseline.evidenceSha256).map(f => [f, readFile(root, f)]));
  return { files, baseline, evidence, packageScripts: JSON.parse(readFile(root, 'package.json')).scripts,
    now: new Date().toISOString() };
}

export function auditWorkflows({ files, baseline: b, evidence, packageScripts, now }) {

  requireContract(b.schemaVersion === 'paper-workflow-admission-v1' && b.sourceCommit === SOURCE
    && b.sourceRef === 'refs/heads/main' && b.stateRef === 'refs/heads/paper-state'
    && b.operationalHold === true, 'ROLE_OR_HOLD_INVALID');
  const start = Date.parse(b.reviewedAt), end = Date.parse(b.reviewBy), time = Date.parse(now);
  requireContract([start, end, time].every(Number.isFinite) && start <= time && time < end
    && end - start <= 30 * 86400000, 'BASELINE_REVIEW_EXPIRED_OR_INVALID');
  // A baseline is a reviewed, bounded HOLD, not a renewable allowlist generated by the checker.
  requireContract(sha256(canonical(b)) === BASELINE_SHA256, 'BASELINE_UNREVIEWED_CHANGE');
  requireContract(canonical(Object.keys(files).sort()) === canonical(b.workflows.map(w => w.file).sort())
    && b.workflows.length === new Set(b.workflows.map(w => w.file)).size, 'WORKFLOW_COVERAGE_MISMATCH');
  requireContract(sha256(canonical(packageScripts)) === b.packageScriptsSha256, 'PACKAGE_COMMAND_DRIFT');
  requireContract(canonical(Object.keys(evidence).sort()) === canonical(Object.keys(b.evidenceSha256).sort()), 'SOURCE_COVERAGE_MISMATCH');
  for (const [file, hash] of Object.entries(b.evidenceSha256)) requireContract(sha256(evidence[file]) === hash, 'REVIEWED_ENTRYPOINT_DRIFT');
  let jobs = 0, blockerJobs = 0;
  const classifications = {};
  for (const record of b.workflows) {
    const w = parseWorkflow(files[record.file]);
    requireContract(canonical(Object.keys(w.jobs).sort()) === canonical(record.jobs.map(j => j.id).sort())
      && record.jobs.length === new Set(record.jobs.map(j => j.id)).size, 'JOB_COVERAGE_MISMATCH');
    requireContract(!Object.keys(w.on).some(t => ['pull_request_target', 'workflow_call'].includes(t)), 'TRIGGER_UNREVIEWED');
    for (const r of record.jobs) {
      const j = w.jobs[r.id]; jobs++;
      requireContract(CLASSES.includes(r.classification) && r.operationalEligible === false
        && r.writerClaimVerified === false, 'FALSE_OPERATIONAL_PROMOTION');
      requireContract(r.blockers.length > 0 && r.blockers.every(code => b.blockers.some(v => v.code === code)), 'BLOCKER_MISSING');
      if (r.classification !== 'CI_FIXTURES') blockerJobs++;
      classifications[r.classification] = (classifications[r.classification] || 0) + 1;
      if (r.classification.startsWith('MANUAL_')) requireContract(canonical(Object.keys(w.on)) === '["workflow_dispatch"]', 'MANUAL_AUTOMATIC_TRIGGER_FORBIDDEN');
      if (r.classification === 'AUTOMATIC_REPORT_CACHE_WRITER') {
        const env = { ...w.env, ...j.env };
        for (const [key, expected] of Object.entries({ ALPHA_ENV: 'DRY_RUN', READ_ONLY: 'true', EXEC_ENABLED: 'false', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' }))
          requireContract(String(env[key]) === expected, 'AUTOMATIC_SAFETY_DEFAULT_CHANGED');
      }
      requireContract(canonical(observeJob(w, j)) === canonical(r.observed), 'JOB_PROTECTION_DRIFT');
    }
    // Hash the full parsed document: shell, inline JS/Python, step env, reusable/local actions and expressions are not guessed safe.
    requireContract(sha256(canonical(w)) === record.definitionSha256, 'WORKFLOW_DEFINITION_UNREVIEWED');
  }
  return { status: 'OFFLINE_ADMISSION_CONTRACT_PASS', workflowCount: b.workflows.length, jobCount: jobs,
    classifications, baselineBlockerCount: b.blockers.length, blockerJobs,
    unknownOrUnclassifiedJobs: 0, operationalEligibleJobs: 0, operationalHold: true,
    liveSettingsVerified: false, brokerRequests: 0, operationalStateChanged: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireContract(process.argv.length === 2, 'ARGUMENTS_UNSUPPORTED');
    console.log(JSON.stringify(auditWorkflows(loadInputs())));
  } catch (e) {
    const code = /^[A-Z][A-Z_]+$/.test(e.message) ? e.message : 'ADMISSION_INPUT_INVALID';
    console.error(JSON.stringify({ status: 'OFFLINE_ADMISSION_CONTRACT_FAIL', code, operationalHold: true }));
    process.exitCode = 1;
  }
}
