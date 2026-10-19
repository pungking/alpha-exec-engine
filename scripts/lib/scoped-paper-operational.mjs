import path from 'node:path';
import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { validateScopedPaperAuthorityFields, validateOperationalApprovalFields } from './scoped-closeout-contract.mjs';
import { readScopedPaperFile, verifyScopedPaperInputs } from './scoped-paper-adapter.mjs';
import { parseStrictJsonText } from '../../dist/src/json-utils.js';

export { authorizeOperationalInvocation, assertOperationalInvocation, bindOperationalObservation } from './scoped-closeout-contract.mjs';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, fields) => object(v) && Object.keys(v).sort().join(' ') === fields.split(' ').sort().join(' ');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
const pin = v => exact(v, 'path sha256') && typeof v.path === 'string' && path.isAbsolute(v.path) && hash(v.sha256);
const check = (ok, code) => { if (!ok) throw Error(`SCOPED_CLOSEOUT_${code}`); };
const fileBindings = new WeakMap();
const freeze = value => {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function validateOversight(o) {
  check(exact(o, 'validFrom expiresAt maxCycles intervalMs requestBudget handoffDeadline operatorAttendanceFile')
    && Number.isSafeInteger(o.maxCycles) && o.maxCycles > 0 && Number.isSafeInteger(1 + 8 * o.maxCycles)
    && Number.isSafeInteger(o.intervalMs) && o.intervalMs > 0
    && time(o.validFrom) < time(o.expiresAt) && time(o.expiresAt) <= time(o.handoffDeadline)
    && pin(o.operatorAttendanceFile), 'OVERSIGHT_POLICY_INVALID');
  const expected = { account: 1, lookup: 5 * o.maxCycles, positions: o.maxCycles,
    orders: o.maxCycles, clock: o.maxCycles, total: 1 + 8 * o.maxCycles };
  check(digest(o.requestBudget) === digest(expected), 'OVERSIGHT_BUDGET_INVALID');
  const duration = (o.maxCycles - 1) * o.intervalMs + expected.total * 3000;
  check(Number.isSafeInteger(duration) && duration <= time(o.expiresAt) - time(o.validFrom), 'OVERSIGHT_WINDOW_INVALID');
}

// Static validation establishes an approval hash, not the truth of any pinned source file.
export function validateOperationalConfiguration(config) {
  try {
    check(exact(config, `schemaVersion input accountBinding sourcePolicy directory sourceFile codeFiles writerExclusion custody oversight${config?.notifications === undefined ? '' : ' notifications'}`)
      && config.schemaVersion === 'scoped-paper-operational-invocation-v1', 'CONFIG_INVALID');
    validateScopedPaperAuthorityFields(config);
    const b = config.accountBinding, p = config.sourcePolicy, c = config.custody;
    check(exact(b, 'rawAccountIdSha256 rawAccountHashBasis accountHashBasis') && hash(b.rawAccountIdSha256)
      && b.rawAccountHashBasis === 'RAW_ACCOUNT_ID_UTF8' && b.accountHashBasis === 'CANONICAL_PAPER_ACCOUNT_ID', 'SOURCE_BINDING_INVALID');
    check(exact(p, 'feed currency quoteCoverage acceptsNonNbboPaperEvidence contractFile riskPolicyFile clockPolicyFile')
      && p.currency === 'USD' && ['contractFile', 'riskPolicyFile', 'clockPolicyFile'].every(k => pin(p[k]))
      && ((p.feed === 'iex' && p.quoteCoverage === 'IEX_SINGLE_EXCHANGE' && p.acceptsNonNbboPaperEvidence === true)
        || (p.feed === 'sip' && p.quoteCoverage === 'CONSOLIDATED_SIP' && p.acceptsNonNbboPaperEvidence === false)), 'SOURCE_POLICY_INVALID');
    check(exact(c, 'basis hostIdSha256 evidenceFile') && c.basis === 'REVIEWED_SINGLE_HOST_PAPER_CUSTODY'
      && hash(c.hostIdSha256) && pin(c.evidenceFile), 'CUSTODY_POLICY_INVALID');
    validateOversight(config.oversight);
    check(time(config.writerExclusion.expiresAt) >= time(config.oversight.handoffDeadline), 'WRITER_EXCLUSION_INVALID');
    return Object.freeze({ status: 'PASS', reasons: Object.freeze([]), evidenceHashes: Object.freeze([digest(config)]) });
  } catch (error) {
    const reason = /^SCOPED_CLOSEOUT_[A-Z_]+$/.test(error?.message) ? error.message : 'SCOPED_CLOSEOUT_CONFIG_INVALID';
    return Object.freeze({ status: 'BLOCKED', reasons: Object.freeze([reason]), evidenceHashes: Object.freeze([]) });
  }
}

// Exact bytes are necessary input evidence, never proof of custody, market status or readiness.
export async function loadOperationalEvidenceFiles({ config }) {
  try {
    config = structuredClone(config);
    check(validateOperationalConfiguration(config).status === 'PASS', 'CONFIG_INVALID');
    const refs = { sourceContract: config.sourcePolicy.contractFile, riskPolicy: config.sourcePolicy.riskPolicyFile,
      clockPolicy: config.sourcePolicy.clockPolicyFile, custody: config.custody.evidenceFile,
      operatorAttendance: config.oversight.operatorAttendanceFile };
    const paths = [config.sourceFile, ...config.codeFiles, ...Object.values(refs)].map(f => path.resolve(f.path));
    check(new Set(paths).size === paths.length, 'FILE_IDENTITY_DUPLICATE');
    await verifyScopedPaperInputs(config);
    const documents = {};
    for (const [name, ref] of Object.entries(refs)) {
      const bytes = await readScopedPaperFile(ref, true);
      documents[name] = parseStrictJsonText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'SCOPED_CLOSEOUT_DOCUMENT_INVALID');
      check(object(documents[name]), 'DOCUMENT_INVALID');
    }
    const files = freeze({ status: 'PINNED_BYTES_VERIFIED_NOT_READINESS', documents,
      sourceEvidenceVerified: false, brokerSubmitAllowed: false });
    fileBindings.set(files, digest(config));
    return files;
  } catch (error) {
    throw Error(/^SCOPED_(?:ADAPTER|CLOSEOUT)_[A-Z_]+$/.test(error?.message)
      ? error.message : 'SCOPED_CLOSEOUT_INPUT_FILE_INVALID');
  }
}

export async function verifyOperationalEvidenceFiles({ config, files }) {
  check(fileBindings.has(files) && fileBindings.get(files) === digest(config), 'FILES_UNBOUND');
  await loadOperationalEvidenceFiles({ config });
  return true;
}

// Local file validation cannot grant an in-process execution capability or establish source truth.
export async function loadOperationalInvocationFiles({ configFile, approvalFile }) {
  try {
    check(pin(configFile) && pin(approvalFile) && path.resolve(configFile.path) !== path.resolve(approvalFile.path), 'FILE_PINS_INVALID');
    const read = async file => parseStrictJsonText(new TextDecoder('utf-8', { fatal: true }).decode(await readScopedPaperFile(file, true)), 'SCOPED_CLOSEOUT_DOCUMENT_INVALID');
    const config = await read(configFile), approval = await read(approvalFile);
    check(validateOperationalConfiguration(config).status === 'PASS', 'CONFIG_INVALID');
    validateOperationalApprovalFields(config, approval);
    const files = await loadOperationalEvidenceFiles({ config });
    return freeze({ config, approval, files });
  } catch (error) {
    throw Error(/^SCOPED_(?:ADAPTER|CLOSEOUT)_[A-Z_]+$/.test(error?.message)
      ? error.message : 'SCOPED_CLOSEOUT_INPUT_FILE_INVALID');
  }
}
