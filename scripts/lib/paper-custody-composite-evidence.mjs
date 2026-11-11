/**
 * STEP 5C-4D-3H — offline read-only composition of independently inspected
 * protected-CLAIM, job/deployment, and writer-coverage diagnostics.
 *
 * Never converts a mock, source baseline, GitHub REST-shaped response,
 * cryptographic match, or self-declared proof into operational authority.
 * No network, disk, global clock, credentials, or broker side effects.
 */
import { inspectPaperDeploymentWriterEvidence } from './paper-deployment-writer-exclusion.mjs';
import { inspectPaperWriterCoverageGaps } from './paper-writer-coverage-gaps.mjs';
import { inspectGithubProtectedLineageEvidence } from './github-paper-protected-lineage.mjs';

const OBJECT = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const status = (findings, components) => Object.freeze({
  schemaVersion: 'paper-custody-composite-evidence-v1',
  status: findings.length ? 'DENY_COMPOSITE_EVIDENCE_INCOMPLETE' : 'HOLD_COMPOSITE_EVIDENCE_NOT_OPERATIONAL_AUTHORITY',
  findings: Object.freeze([...new Set(findings)].sort()),
  components: Object.freeze({ ...components }),
  reviewedReadOnlyShapesMatched: findings.length === 0,
  jobSpecificDeploymentAuthenticated: false,
  protectedEnvironmentIndependentlyAttested: false,
  brokerAccountOwnershipVerified: false,
  allCredentialWritersInventoried: false,
  legacyWriterRevocationProven: false,
  accountWideFencingEnforced: false,
  durableClaimRuntimeVerified: false,
  liveBrokerReconciled: false,
  paperStateProvisioned: false,
  operationalEligible: false,
  stateMutationAuthorized: false,
  brokerSubmitAuthorized: false,
  liveTradingAuthorized: false,
});
function component(result, validStatus, shapeKey, fields) {
  return OBJECT(result) && result.status === validStatus
    && Array.isArray(result.findings) && result.findings.length === 0
    && result[shapeKey] === true
    && fields.every(f => result[f] === false);
}
/**
 * External inputs are diagnostic-only. A good report is an untrusted
 * *shape*, not a trusted attestation; trusted provenance is not available.
 * Gated API adapters must be built separately and reviewed before use.
 */
export function inspectPaperCustodyComposite(input = {}) {
  const x = OBJECT(input) ? input : {};
  const findings = [], components = { protectedLineage: false, deploymentWriter: false, sourceWriterCoverage: false };
  const expected = x.expected;
  if (!OBJECT(expected)
    || !SHA40.test(expected.mainSha || '')
    || !SHA64.test(expected.accountSha256 || '')
    || !SHA64.test(expected.scopeSha256 || '')
    || expected.repository !== 'pungking/alpha-exec-engine'
    || expected.branch !== 'main'
    || expected.environment !== 'PAPER_CUSTODY_APPROVAL')
    findings.push('COMPOSITE_EXPECTED_CONTEXT_INVALID');

  // Never accept unrelated account/scope/revision representations.
  if (!OBJECT(x.protectedInput)
    || x.protectedInput.expected?.codeSha !== expected?.mainSha
    || x.protectedInput.scope?.accountSha256 !== expected?.accountSha256
    || x.protectedInput.scope?.scopeSha256 !== expected?.scopeSha256)
    findings.push('PROTECTED_CLAIM_CONTEXT_UNBOUND');
  if (!OBJECT(x.deploymentInput)
    || x.deploymentInput.expected?.sha !== expected?.mainSha
    || x.deploymentInput.expected?.accountSha256 !== expected?.accountSha256
    || x.deploymentInput.expected?.scopeSha256 !== expected?.scopeSha256)
    findings.push('DEPLOYMENT_CONTEXT_UNBOUND');

  // Source-snapshot assertions in 3G must never be treated as external
  // credentials or true account-wide writer reachability.
  const protectedLineage = inspectGithubProtectedLineageEvidence(x.protectedInput);
  const deploymentWriter = inspectPaperDeploymentWriterEvidence(x.deploymentInput);
  const sourceWriterCoverage = inspectPaperWriterCoverageGaps(x.writerCoverageInput);
  components.protectedLineage = component(protectedLineage,
    'HOLD_PROTECTED_LINEAGE_NOT_OPERATIONAL_AUTHORITY',
    'evidenceShapeMatched',
    ['authenticatedJobDeploymentVerified','externalEnvironmentPolicyAttested',
      'accountWideWriterFenced','brokerSubmitAuthorized','stateMutationAuthorized','operationalEligible']);
  components.deploymentWriter = component(deploymentWriter,
    'HOLD_UNATTESTED_DEPLOYMENT_AND_WRITER_BOUNDARY',
    'deploymentEvidenceShapeMatched',
    ['authenticatedJobDeploymentVerified','accountWideWriterExclusionVerified',
      'brokerSubmitAuthorized','stateMutationAuthorized','operationalEligible'])
    && deploymentWriter.writerInventoryShapeMatched === true;
  components.sourceWriterCoverage = component(sourceWriterCoverage,
    'HOLD_SOURCE_COVERAGE_NOT_RUNTIME_EXCLUSION',
    'sourceInventoryShapeMatched',
    ['authenticatedJobDeploymentVerified','accountWideWriterExclusionVerified',
      'brokerSubmitAuthorized','stateMutationAuthorized','operationalEligible']);
  if (!components.protectedLineage) findings.push('PROTECTED_CLAIM_DIAGNOSTIC_INVALID');
  if (!components.deploymentWriter) findings.push('DEPLOYMENT_WRITER_DIAGNOSTIC_INVALID');
  // A declared custodyWriterCount alone is insufficient. 3F currently
  // validates its format, not the actual count of designated custody writers.
  const inventory = x.deploymentInput?.writerInventory;
  const writers = inventory?.writers;
  if (!Array.isArray(writers)
      || writers.filter(w => OBJECT(w) && w.legacy !== true
        && w.disposition === 'MIGRATED_TO_CUSTODY'
        && w.custodyEnforced === true).length !== 1
      || inventory.custodyWriterCount !== 1)
    findings.push('CUSTODY_WRITER_CARDINALITY_INVALID');
  if (!components.sourceWriterCoverage) findings.push('SOURCE_WRITER_COVERAGE_DIAGNOSTIC_INVALID');

  const source = x.trustedEvidenceSources;
  if (!OBJECT(source)
    || source.kind !== 'UNAVAILABLE_NOT_ATTESTED'
    || source.jobDeployment !== 'UNVERIFIED'
    || source.environmentPolicy !== 'UNVERIFIED'
    || source.accountWriterInventory !== 'UNVERIFIED'
    || source.brokerFencing !== 'UNVERIFIED'
    || source.verified !== false)
    findings.push('EXTERNAL_PROOF_BOUNDARY_INVALID');
  return status(findings, components);
}
