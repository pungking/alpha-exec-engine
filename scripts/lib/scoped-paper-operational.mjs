import path from 'node:path';
import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { validateScopedPaperAuthorityFields, validateOperationalApprovalFields } from './scoped-closeout-contract.mjs';
import { readScopedPaperFile, verifyScopedPaperInputs } from './scoped-paper-adapter.mjs';
import { parseStrictJsonText } from '../../dist/src/json-utils.js';
import { decimalRatio, compare } from './closeout-decimal.mjs';

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

function controlWindow(document, config, now, start) {
  return time(document?.attestedAt) <= time(document?.validFrom) && time(document?.attestedAt) <= now
    && time(document?.validFrom) <= start && time(document?.validFrom) <= now
    && now < time(document?.expiresAt) && time(document?.expiresAt) >= time(config.oversight.handoffDeadline);
}
function custodyAttested(c, config, now) {
  return exact(c, 'schemaVersion basis accountSha256 hostIdSha256 directory preWriteHashes termsSha256 sourceSha256 recordedAt adoptionApprovalSha256 historicalEvidenceNormalized writerExclusion')
    && c.schemaVersion === 'scoped-paper-custody-attestation-v1' && c.basis === 'OPERATOR_ATTESTED_SINGLE_HOST'
    && c.accountSha256 === config.input.accountSha256 && c.hostIdSha256 === config.custody.hostIdSha256
    && c.directory === config.directory && path.resolve(c.directory) === c.directory
    && digest(c.preWriteHashes) === digest(config.input.preWriteHashes)
    && c.termsSha256 === config.input.termsSha256 && c.sourceSha256 === config.input.sourceSha256
    && time(c.recordedAt) <= now && time(c.recordedAt) <= time(config.input.authority.validFrom)
    && hash(c.adoptionApprovalSha256) && c.historicalEvidenceNormalized === false;
}
function writerAttested(w, config, now, start) {
  return exact(w, 'schemaVersion accountSha256 hostIdSha256 session validFrom expiresAt attestedAt procedureSha256 controls')
    && w.schemaVersion === 'scoped-paper-writer-attestation-v1' && digest(w) === config.writerExclusion.evidenceSha256
    && w.accountSha256 === config.input.accountSha256 && w.hostIdSha256 === config.custody.hostIdSha256
    && w.session === config.input.authority.session && w.expiresAt === config.writerExclusion.expiresAt
    && controlWindow(w, config, now, start) && hash(w.procedureSha256)
    && exact(w.controls, 'githubActions otherHosts otherProcesses manualTrading')
    && Object.entries(w.controls).every(([lane, c]) => exact(c, 'status evidenceSha256') && hash(c.evidenceSha256)
      && c.status === (lane === 'manualTrading' ? 'OPERATOR_NONINTERFERENCE' : 'WRITE_DISABLED'));
}
function attendanceAttested(a, config, now, start) {
  return exact(a, 'schemaVersion basis operatorSha256 accountSha256 hostIdSha256 session validFrom expiresAt attestedAt handoffProcedureSha256 brokerInterfaceAttended hostLossOrdersMayRemainAcknowledged')
    && a.schemaVersion === 'scoped-paper-attendance-attestation-v1' && a.basis === 'NAMED_OPERATOR_BROKER_INTERFACE'
    && hash(a.operatorSha256) && a.accountSha256 === config.input.accountSha256 && a.hostIdSha256 === config.custody.hostIdSha256
    && a.session === config.input.authority.session && controlWindow(a, config, now, start) && hash(a.handoffProcedureSha256)
    && a.brokerInterfaceAttended === true && a.hostLossOrdersMayRemainAcknowledged === true;
}

// Pinned operator attestations are necessary controls, not independent observation of their truth.
export async function assessOperationalControlEvidence({ config, files, clock, purpose = 'SUBMISSION' }) {
  const reasons = [];
  try {
    check(['SUBMISSION', 'OBSERVATION'].includes(purpose), 'CONTROL_PURPOSE_INVALID');
    config = structuredClone(config);
    await verifyOperationalEvidenceFiles({ config, files });
    const now = time(clock.now()); check(Number.isFinite(now), 'CONTROL_TIME_INVALID');
    const start = purpose === 'OBSERVATION' ? time(config.oversight.validFrom)
      : Math.min(time(config.input.authority.validFrom), time(config.oversight.validFrom));
    const { custody, operatorAttendance } = files.documents;
    if (!custodyAttested(custody, config, now)) reasons.push('SCOPED_CLOSEOUT_CUSTODY_ATTESTATION_INVALID');
    if (!writerAttested(custody?.writerExclusion, config, now, start)) reasons.push('SCOPED_CLOSEOUT_WRITER_ATTESTATION_INVALID');
    if (!attendanceAttested(operatorAttendance, config, now, start)) reasons.push('SCOPED_CLOSEOUT_ATTENDANCE_ATTESTATION_INVALID');
  } catch (error) {
    reasons.push(/^SCOPED_(?:ADAPTER|CLOSEOUT)_[A-Z_]+$/.test(error?.message) ? error.message : 'SCOPED_CLOSEOUT_CONTROL_EVIDENCE_INVALID');
  }
  return freeze({ status: reasons.length ? 'BLOCKED' : 'OPERATOR_ATTESTATIONS_BOUND_NOT_READINESS', reasons,
    executionAuthorized: false, sourceReadinessProven: false, currentStateVerified: false,
    hostIdentityIndependentlyVerified: false, writerExclusionIndependentlyVerified: false, physicalAttendanceVerified: false });
}

// Local documents establish configured requirements, not measured current risk or an exemption.
export function assessOperationalRiskPolicy({ config, policy }) {
  const percentages = ['maxPositionPct', 'maxSectorPct', 'maxPortfolioExposurePct', 'maxDailyLossPct', 'maxDrawdownPct', 'maxVolatilityPct'];
  const fields = [...percentages, 'minAverageDailyDollarVolumeUsd', 'minEarningsDistanceDays'];
  try {
    check(exact(policy, 'schemaVersion accountSha256 termsSha256 policySourceSha256 limits')
      && policy.schemaVersion === 'scoped-paper-risk-policy-v1' && hash(policy.policySourceSha256)
      && policy.accountSha256 === config.input.accountSha256 && policy.termsSha256 === config.input.termsSha256
      && exact(policy.limits, fields.join(' ')), 'RISK_POLICY_INVALID');
    for (const field of fields) {
      const v = policy.limits[field];
      check(typeof v === 'string' && /^(0|[1-9]\d{0,15})(\.\d{1,9})?$/.test(v), 'RISK_POLICY_INVALID');
      const r = decimalRatio(v);
      check(compare(r, [0n, 1n]) > 0
        && (field !== 'minEarningsDistanceDays' || /^[1-9]\d*$/.test(v)), 'RISK_POLICY_INVALID');
    }
    return freeze({ status: 'POLICY_CONTRACT_VALID_NOT_CURRENT_RISK', reasons: [], configuredDimensions: fields.length,
      currentRiskVerified: false, exceptionsApproved: false });
  } catch {
    return freeze({ status: 'BLOCKED', reasons: ['SCOPED_CLOSEOUT_RISK_POLICY_INVALID'], configuredDimensions: 0,
      currentRiskVerified: false, exceptionsApproved: false });
  }
}

// Interval arithmetic never compensates payload timestamps or authenticates the reference source.
export function assessOperationalClockEvidence({ config, document: d, clock }) {
  try {
    check(exact(d, 'schemaVersion hostIdSha256 basis referenceEvidenceSha256 policy localSampleAt referenceEarliestAt referenceLatestAt')
      && d.schemaVersion === 'scoped-paper-clock-evidence-v1' && d.hostIdSha256 === config.custody.hostIdSha256
      && d.basis === 'INDEPENDENT_REFERENCE_INTERVAL' && hash(d.referenceEvidenceSha256)
      && exact(d.policy, 'maxAgeMs maxUncertaintyMs')
      && Number.isSafeInteger(d.policy.maxAgeMs) && d.policy.maxAgeMs > 0 && d.policy.maxAgeMs <= 30000
      && Number.isSafeInteger(d.policy.maxUncertaintyMs) && d.policy.maxUncertaintyMs >= 0
      && d.policy.maxUncertaintyMs <= d.policy.maxAgeMs, 'CLOCK_EVIDENCE_INVALID');
    const now = time(clock.now()), sample = time(d.localSampleAt), low = time(d.referenceEarliestAt), high = time(d.referenceLatestAt);
    check([now, sample, low, high].every(Number.isFinite) && low <= sample && sample <= high
      && high <= now && now - low <= d.policy.maxAgeMs && high - low <= d.policy.maxUncertaintyMs,
    'CLOCK_EVIDENCE_INVALID');
    return freeze({ status: 'REFERENCE_INTERVAL_CONSISTENT_NOT_AUTHENTICATED', reasons: [],
      referenceProvenanceVerified: false, hostSynchronizationVerified: false, timestampCompensationApplied: false });
  } catch {
    return freeze({ status: 'BLOCKED', reasons: ['SCOPED_CLOSEOUT_CLOCK_EVIDENCE_INVALID'],
      referenceProvenanceVerified: false, hostSynchronizationVerified: false, timestampCompensationApplied: false });
  }
}

// This is a prerequisite audit. There is no reviewed current-state/continuity producer yet.
export async function assessOperationalReadiness({ config, files, clock }) {
  let controlEvidence, riskPolicy, clockEvidence;
  const reasons = [];
  try {
    config = structuredClone(config);
    await verifyOperationalEvidenceFiles({ config, files });
    controlEvidence = await assessOperationalControlEvidence({ config, files, clock });
    riskPolicy = assessOperationalRiskPolicy({ config, policy: files.documents.riskPolicy });
    clockEvidence = assessOperationalClockEvidence({ config, document: files.documents.clockPolicy, clock });
    reasons.push(...controlEvidence.reasons, ...riskPolicy.reasons, ...clockEvidence.reasons,
      'SCOPED_CLOSEOUT_SOURCE_INITIAL_STATE_AND_CONTINUITY_UNVERIFIED',
      'SCOPED_CLOSEOUT_CURRENT_RISK_EVIDENCE_UNVERIFIED', 'SCOPED_CLOSEOUT_CLOCK_REFERENCE_PROVENANCE_UNVERIFIED');
  } catch (error) {
    reasons.push(/^SCOPED_(?:CLOSEOUT|ADAPTER)_[A-Z_]+$/.test(error?.message)
      ? error.message : 'SCOPED_CLOSEOUT_READINESS_INPUT_INVALID');
  }
  return freeze({ status: 'BLOCKED', reasons: [...new Set(reasons)], controlEvidence, riskPolicy, clockEvidence,
    executionAuthorized: false, sourceReadinessProven: false, currentStateVerified: false,
    wouldCreateBrokerPayload: false, actualBrokerMutationAttempted: false, actualStateWriteAttempted: false });
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
