/**
 * STEP 5C-4D-3F — offline, fail-closed deployment and account-wide writer
 * exclusion evidence inspector. All inputs are untrusted snapshots.
 * Matching evidence NEVER authorizes deployment, PAPER orders or state writes.
 * No network, filesystem, clock, credentials or side effects.
 */
const REPO = 'pungking/alpha-exec-engine';
const ENV = 'PAPER_CUSTODY_APPROVAL';
const ENV_ID = 26847620868;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = v => (typeof v === 'string' || Number.isSafeInteger(v))
  && ID.test(String(v)) && Number.isSafeInteger(Number(v));
const matchId = (a,b) => id(a) && id(b) && String(a) === String(b);
const unique = list => new Set(list).size === list.length;
const result = (findings, deploymentShape = false, inventoryShape = false) => Object.freeze({
  schemaVersion: 'paper-deployment-writer-exclusion-v1',
  status: findings.length ? 'DENY_DEPLOYMENT_OR_WRITER_EVIDENCE' : 'HOLD_UNATTESTED_DEPLOYMENT_AND_WRITER_BOUNDARY',
  findings: Object.freeze([...new Set(findings)].sort()),
  deploymentEvidenceShapeMatched: findings.length === 0 && deploymentShape,
  writerInventoryShapeMatched: findings.length === 0 && inventoryShape,
  authenticatedJobDeploymentVerified: false,
  externalEnvironmentPolicyAttested: false,
  brokerAccountOwnershipVerified: false,
  accountWideWriterExclusionVerified: false,
  legacyWriterDecommissionVerified: false,
  durableWriterClaimVerified: false,
  operationalEligible: false,
  stateMutationAuthorized: false,
  brokerSubmitAuthorized: false,
});
const writerKinds = new Set(['BROKER_SUBMIT', 'STATE_MUTATION', 'CACHE_STATE', 'LEDGER_STATE', 'EXTERNAL_BROKER_WRITER']);
const allowedDisposition = new Set(['BLOCKED_BY_TESTED_GATE', 'RETIRED_WITH_EVIDENCE', 'MIGRATED_TO_CUSTODY']);
const noDangerousKeys = v => obj(v) && !Object.keys(v).some(k => /token|secret|password|privatekey|api[_-]?key/i.test(k));

/**
 * Snapshot is not proof of a GitHub job-to-deployment relationship. REST
 * deployment/status payloads may omit job identity; any supplied jobId is
 * caller-controlled until an independently trusted job attestation exists.
 */
export function inspectPaperDeploymentWriterEvidence(input = {}) {
  const x = obj(input) ? input : {};
  const findings = [];
  const e = x.expected, run = x.run, job = x.job;
  if (!obj(e) || e.repository !== REPO || e.environment !== ENV
      || e.environmentId !== ENV_ID || e.branch !== 'main'
      || !SHA.test(e.sha || '') || !id(e.runId) || !id(e.jobId)
      || e.attempt !== 1 || !HASH.test(e.accountSha256 || '')
      || !HASH.test(e.scopeSha256 || '')) findings.push('EXPECTED_CONTEXT_INVALID');
  if (!obj(run) || !matchId(run.id,e?.runId) || run.head_branch !== 'main'
      || run.head_sha !== e?.sha || run.run_attempt !== 1
      || run.event !== 'workflow_dispatch'
      || run.repository?.full_name !== REPO) findings.push('RUN_BOUNDARY_INVALID');
  if (!obj(job) || !matchId(job.id,e?.jobId) || !matchId(job.run_id,e?.runId)
      || job.run_attempt !== 1 || job.head_sha !== e?.sha
      || job.name !== 'Protected PAPER approval - operational HOLD'
      || job.status !== 'completed' || job.conclusion !== 'failure')
    findings.push('PROTECTED_HOLD_JOB_INVALID');

  const dep = x.deployment, status = x.deploymentStatus;
  const depShape = obj(dep) && id(dep.id) && dep.environment === ENV
    && dep.ref === 'main' && dep.sha === e?.sha
    && dep.task === 'deploy'
    && dep.creator?.login === 'github-actions[bot]'
    && obj(status) && matchId(status.deployment_id,dep.id)
    && status.state === 'success' && status.environment === ENV;
  if (!depShape) findings.push('DEPLOYMENT_STATUS_UNBOUND');
  // Deployment and job REST surfaces do not provide an authenticated
  // join merely from same SHA, run and environment. No fabricated JOIN.
  if (!obj(x.jobDeploymentAttestation) || x.jobDeploymentAttestation.kind !== 'UNVERIFIED_ONLY'
      || x.jobDeploymentAttestation.verified !== false) findings.push('JOB_DEPLOYMENT_ATTESTATION_MISSING');

  const inv = x.writerInventory;
  let inventoryShape = false;
  if (!obj(inv) || inv.schemaVersion !== 'paper-account-writer-inventory-v1'
      || inv.accountSha256 !== e?.accountSha256 || inv.scopeSha256 !== e?.scopeSha256
      || inv.complete !== true || !Array.isArray(inv.writers) || inv.writers.length === 0
      || inv.writers.length > 128
      || !Array.isArray(inv.requiredLegacyIds) || inv.requiredLegacyIds.length === 0
      || inv.requiredLegacyIds.length > 128 || !unique(inv.requiredLegacyIds)
      || inv.requiredLegacyIds.some(s => typeof s !== 'string' || !s.length)) {
    findings.push('ACCOUNT_WRITER_INVENTORY_INCOMPLETE');
  } else {
    const ids = inv.writers.map(w => w?.id);
    if (!unique(ids) || ids.some(s => typeof s !== 'string' || !/^[a-z0-9][a-z0-9._/-]{1,99}$/.test(s)))
      findings.push('WRITER_IDS_INVALID');
    for (const w of inv.writers) {
      if (!noDangerousKeys(w) || !writerKinds.has(w.kind)
          || !allowedDisposition.has(w.disposition)
          || w.accountSha256 !== e?.accountSha256
          || typeof w.evidenceDigest !== 'string' || !HASH.test(w.evidenceDigest)
          || w.disposition === 'MIGRATED_TO_CUSTODY' && w.custodyEnforced !== true)
        findings.push('WRITER_CONTROL_INVALID');
    }
    const observedLegacy = inv.writers.filter(w => w?.legacy === true).map(w => w.id);
    if (!unique(observedLegacy)
        || observedLegacy.length !== inv.requiredLegacyIds.length
        || !inv.requiredLegacyIds.every(s => observedLegacy.includes(s)))
      findings.push('LEGACY_WRITER_COVERAGE_INCOMPLETE');
    if (inv.writers.some(w => w?.legacy === true && !['RETIRED_WITH_EVIDENCE','BLOCKED_BY_TESTED_GATE'].includes(w.disposition)))
      findings.push('LEGACY_WRITER_NOT_EXCLUDED');
    if (inv.externalWriterDiscovery !== 'INDEPENDENT_EVIDENCE_REQUIRED'
        || inv.brokerCredentialInventory !== 'INDEPENDENT_EVIDENCE_REQUIRED'
        || inv.custodyWriterCount !== 1)
      findings.push('EXTERNAL_OR_CUSTODY_SCOPE_UNVERIFIED');
    inventoryShape = true;
  }
  if (!obj(x.durableClaim) || x.durableClaim.status !== 'UNVERIFIED'
      || x.durableClaim.authorized !== false)
    findings.push('DURABLE_WRITER_CLAIM_UNVERIFIED');
  return result(findings, !!depShape, inventoryShape);
}
