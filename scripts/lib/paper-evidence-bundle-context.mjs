/**
 * STEP 5C-4D-3M — source-only, untrusted receipt+snapshot+request binding.
 * This detects a changed capture receipt independently of the 3L snapshot
 * digest. It NEVER authenticates GitHub, time, approvers or broker writers.
 * No network, clock, filesystem, secrets, env or state side effects.
 */
import { createHash } from 'node:crypto';
import {
  fingerprintPaperEvidenceSnapshot,
  inspectPaperEvidenceSnapshotCommitment,
} from './paper-evidence-snapshot-commitment.mjs';

const obj = value => value !== null && typeof value === 'object'
  && !Array.isArray(value);
const exact = (value, keys) => obj(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_KEYS = [
  'schemaVersion','transportClass','repository','runId','jobId',
  'deploymentId','capturedAt','attestation',
];
const CONTEXT_KEYS = [
  'repository','branch','environment','sha','runId',
  'jobId','deploymentId','attempt','workflowPath',
];
const BUNDLE_KEYS = [
  'schemaVersion','repository','runId','jobId','deploymentId','sourceSha',
  'snapshotSha256','captureReceiptSha256','bundleSha256','evidenceOrigin',
  'signer','approvalClaim','replayProtection',
];
function sha(domain, values) {
  const text = JSON.stringify(values);
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 32768) return null;
  return createHash('sha256').update(domain + '\n','utf8')
    .update(text,'utf8').digest('hex');
}
/**
 * Syntactic receipt integrity only. The caller can freely regenerate
 * this hash, and its capturedAt field is not a trusted time source.
 */
export function fingerprintPaperCaptureReceipt(receipt) {
  if (!exact(receipt, RECEIPT_KEYS)
    || receipt.schemaVersion !== 'paper-github-provenance-receipt-v1'
    || receipt.transportClass !== 'CALLER_SUPPLIED_UNVERIFIED'
    || receipt.repository !== 'pungking/alpha-exec-engine'
    || receipt.attestation !== 'NONE'
    || !['runId','jobId','deploymentId','capturedAt']
      .every(key => typeof receipt[key] === 'string')) return null;
  return sha('paper-capture-receipt-v1',
    RECEIPT_KEYS.map(key => receipt[key]));
}
/**
 * A second digest binds the 3L selected snapshot hash, capture receipt
 * (including capture time), and exact externally requested identity context.
 * Every input is caller-controlled; this is not a signature or anti-replay.
 */
export function fingerprintPaperEvidenceBundle(input = {}) {
  const x = obj(input) ? input : {};
  const check = inspectPaperEvidenceSnapshotCommitment({
    snapshot: x.snapshot, captureReceipt: x.captureReceipt,
    commitment: x.commitment,
  });
  if (check.status !== 'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT'
    || check.selectedContentDigestMatched !== true
    || check.operationalEligible !== false
    || check.signedSnapshotReceiptVerified !== false
    || !exact(x.requestContext, CONTEXT_KEYS)) return null;
  const e = x.snapshot?.expected;
  if (!obj(e) || CONTEXT_KEYS.some(key => x.requestContext[key] !== e[key])) return null;
  const receiptHash = fingerprintPaperCaptureReceipt(x.captureReceipt);
  const snapshotHash = fingerprintPaperEvidenceSnapshot(x.snapshot);
  if (receiptHash === null || snapshotHash === null) return null;
  return sha('paper-selected-evidence-bundle-v1', [
    snapshotHash, receiptHash,
    CONTEXT_KEYS.map(key => x.requestContext[key]),
  ]);
}
const report = (findings) => Object.freeze({
  schemaVersion: 'paper-selected-evidence-bundle-context-v1',
  status: findings.length ? 'DENY_UNTRUSTED_BUNDLE_CONTEXT_INVALID'
    : 'HOLD_UNVERIFIED_EVIDENCE_BUNDLE_CONTEXT',
  findings: Object.freeze([...new Set(findings)].sort()),
  selectedBundleContentMatched: findings.length === 0,
  proofGaps: Object.freeze([
    'CAPTURE_TIMESTAMP_NOT_INDEPENDENTLY_ATTESTED',
    'GITHUB_API_ORIGIN_NOT_AUTHENTICATED',
    'JOB_DEPLOYMENT_APPROVAL_NOT_AUTHENTICATED',
    'BUNDLE_REPLAY_PROTECTION_NOT_ENFORCED',
    'BROKER_ACCOUNT_WRITER_EXCLUSION_NOT_PROVEN',
  ]),
  trustedApiOriginVerified: false,
  timestampAttested: false,
  jobDeploymentApprovalVerified: false,
  outOfBandReplayRejected: false,
  brokerWriterExclusivityVerified: false,
  operationalEligible: false,
  stateMutationAuthorized: false,
  brokerSubmitAuthorized: false,
  liveTradingAuthorized: false,
});
export function inspectPaperEvidenceBundleContext(input = {}) {
  const x = obj(input) ? input : {}, findings = [];
  const check = inspectPaperEvidenceSnapshotCommitment({
    snapshot: x.snapshot, captureReceipt: x.captureReceipt,
    commitment: x.commitment,
  });
  if (check.status !== 'HOLD_UNTRUSTED_SNAPSHOT_CONTENT_COMMITMENT'
    || check.selectedContentDigestMatched !== true
    || check.operationalEligible !== false
    || check.signedSnapshotReceiptVerified !== false)
    findings.push('PRIOR_COMMITMENT_PRECONDITION_INVALID');

  const e = x.snapshot?.expected, c = x.requestContext;
  if (!obj(e) || !exact(c, CONTEXT_KEYS)
    || CONTEXT_KEYS.some(key => c[key] !== e?.[key]))
    findings.push('REQUEST_CONTEXT_MISMATCH');

  const b = x.bundle;
  if (!exact(b, BUNDLE_KEYS)
    || b.schemaVersion !== 'paper-selected-evidence-bundle-context-v1'
    || b.repository !== 'pungking/alpha-exec-engine'
    || b.repository !== e?.repository
    || b.runId !== e?.runId || b.jobId !== e?.jobId
    || b.deploymentId !== e?.deploymentId || b.sourceSha !== e?.sha
    || b.evidenceOrigin !== 'CALLER_SUPPLIED_UNVERIFIED'
    || b.signer !== 'NONE' || b.approvalClaim !== 'NONE'
    || b.replayProtection !== 'UNPROVEN'
    || !SHA256.test(b.snapshotSha256)
    || !SHA256.test(b.captureReceiptSha256)
    || !SHA256.test(b.bundleSha256))
    findings.push('BUNDLE_RECEIPT_AUTHORITY_OR_SHAPE_INVALID');

  const snapshotHash = fingerprintPaperEvidenceSnapshot(x.snapshot);
  const receiptHash = fingerprintPaperCaptureReceipt(x.captureReceipt);
  if (snapshotHash === null || snapshotHash !== b?.snapshotSha256)
    findings.push('SELECTED_SNAPSHOT_DIGEST_MISMATCH');
  if (receiptHash === null || receiptHash !== b?.captureReceiptSha256)
    findings.push('CAPTURE_RECEIPT_DIGEST_MISMATCH');
  const bundleHash = fingerprintPaperEvidenceBundle(x);
  if (bundleHash === null || bundleHash !== b?.bundleSha256)
    findings.push('REQUEST_BOUND_BUNDLE_DIGEST_MISMATCH');
  return report(findings);
}
