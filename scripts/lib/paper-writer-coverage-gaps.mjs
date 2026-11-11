/**
 * STEP 5C-4D-3G: source-pinned writer-path coverage and deployment proof gaps.
 * Offline diagnostic only. A fixture, parsed YAML, or REST-shaped record is
 * not authenticated runner / broker evidence. No execution authority possible.
 */
const REQUIRED = Object.freeze([
  ['dry-run.yml','dry-run','AUTOMATIC_REPORT_CACHE_WRITER'],
  ['market-guard.yml','market-guard','AUTOMATIC_REPORT_CACHE_WRITER'],
  ['ledger-filled-migration.yml','ledger-filled-migration','MANUAL_LEDGER_MIGRATION'],
  ['paper-five-row-active-limited-state-recovery.yml','recover','MANUAL_LEDGER_MIGRATION'],
  ['paper-oco-submit-canary.yml','submit-canary','MANUAL_BROKER_SUBMIT_CANCEL'],
  ['persistent-oco-repair-submit.yml','submit-persistent-repair','MANUAL_BROKER_SUBMIT'],
]);
const HOLD_WORKFLOWS = Object.freeze([
  'ledger-filled-migration.yml',
  'paper-five-row-active-limited-state-recovery.yml',
  'paper-oco-submit-canary.yml',
  'persistent-oco-repair-submit.yml',
]);
const CLASSIFIED_WRITERS = new Set([
  'AUTOMATIC_REPORT_CACHE_WRITER','MANUAL_LEDGER_MIGRATION',
  'MANUAL_BROKER_SUBMIT_CANCEL','MANUAL_BROKER_SUBMIT',
]);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const key = (w,j) => w+'#'+j;
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const result = findings => Object.freeze({
  schemaVersion:'paper-writer-coverage-gaps-v1',
  status:findings.length ? 'DENY_WRITER_COVERAGE_INCOMPLETE' : 'HOLD_SOURCE_COVERAGE_NOT_RUNTIME_EXCLUSION',
  findings:Object.freeze([...new Set(findings)].sort()),
  sourceInventoryShapeMatched:findings.length===0,
  authenticatedJobDeploymentVerified:false,
  independentDeploymentProvenanceVerified:false,
  fullBrokerCredentialReachabilityVerified:false,
  accountWideWriterExclusionVerified:false,
  externallyEnforcedFencingVerified:false,
  legacyWriterRetiredVerified:false,
  operationalEligible:false,
  stateMutationAuthorized:false,
  brokerSubmitAuthorized:false,
});
/**
 * The baseline must ALSO be validated by check-paper-workflow-admission.mjs
 * with its reviewed checksum. This function checks the semantic coverage
 * expected for this particular revision; no user-supplied inventory is
 * accepted as proof of a closed account-wide writing surface.
 */
export function inspectPaperWriterCoverageGaps(input = {}) {
  const x=object(input)?input:{}, findings=[];
  const baseline=x.baseline;
  if(!object(baseline) || baseline.schemaVersion!=='paper-workflow-admission-v1'
    || baseline.operationalHold!==true
    || baseline.sourceRef!=='refs/heads/main'
    || baseline.stateRef!=='refs/heads/paper-state'
    || !Array.isArray(baseline.workflows) || baseline.workflows.length!==17
    || !Array.isArray(baseline.blockers) || baseline.blockers.length!==10
    || baseline.blockers.some(b=>!object(b)||b.status!=='OPEN'))
    findings.push('REVIEWED_BASELINE_SHAPE_INVALID');
  const files=Array.isArray(baseline?.workflows)?baseline.workflows:[];
  const found=new Map(), holds=new Map();
  let jobs=0;
  for(const w of files){
    if(!object(w)||typeof w.file!=='string'||!Array.isArray(w.jobs)){
      findings.push('WORKFLOW_ENTRY_INVALID');continue;
    }
    for(const j of w.jobs){
      jobs++;
      if(!object(j)||typeof j.id!=='string'||typeof j.classification!=='string'){
        findings.push('JOB_ENTRY_INVALID');continue;
      }
      const k=key(w.file,j.id);
      if(found.has(k))findings.push('JOB_DUPLICATE');
      found.set(k,j);
      if(j.classification==='MANUAL_ADMISSION_HOLD')holds.set(w.file,j);
      if(j.operationalEligible!==false||j.writerClaimVerified!==false)
        findings.push('UNSAFE_ADMISSION_PROMOTION');
    }
  }
  if(jobs!==21||found.size!==21) findings.push('JOB_COVERAGE_CHANGED');
  const known=new Map(REQUIRED.map(([w,j,c])=>[key(w,j),c]));
  const observed=[...found].filter(([_,j])=>CLASSIFIED_WRITERS.has(j.classification));
  if(observed.length!==REQUIRED.length
    ||observed.some(([k,j])=>known.get(k)!==j.classification)
    ||[...known].some(([k,c])=>found.get(k)?.classification!==c))
    findings.push('MUTATION_WRITER_PATH_CHANGED');
  if(holds.size!==HOLD_WORKFLOWS.length
    ||HOLD_WORKFLOWS.some(w=>holds.get(w)?.observed?.environment!=='PAPER_CUSTODY_APPROVAL'))
    findings.push('ADMISSION_HOLD_COVERAGE_CHANGED');
  if(REQUIRED.some(([w,j])=>found.get(key(w,j))?.observed?.environment!==null))
    findings.push('LEGACY_WRITER_ENVIRONMENT_DRIFT');

  // This is a declared inventory *comparison*, not external discovery.
  const coverage=x.coverage;
  if(!object(coverage)||coverage.schemaVersion!=='paper-writer-coverage-declaration-v1'
    ||!Array.isArray(coverage.paths)||coverage.paths.length!==REQUIRED.length
    ||!Array.isArray(coverage.externalSurfaces)||coverage.externalSurfaces.length!==4)
    findings.push('DECLARED_COVERAGE_INCOMPLETE');
  else {
    const expected=REQUIRED.map(([w,j])=>key(w,j));
    if(new Set(coverage.paths.map(p=>p?.id)).size!==REQUIRED.length
      ||coverage.paths.some(p=>!object(p)||!expected.includes(p.id)
        ||p.status!=='UNVERIFIED_RUNTIME_EXCLUSION'||!digest(p.sourceDigest)))
      findings.push('LEGACY_WRITER_EVIDENCE_INVALID');
    const surfaces=['BROKER_API_CREDENTIALS','OTHER_REPOSITORIES','OUT_OF_BAND_CLIENTS','RUNNER_AND_CACHE_STATE'];
    if(new Set(coverage.externalSurfaces.map(s=>s?.id)).size!==4
      ||coverage.externalSurfaces.some(s=>!object(s)||!surfaces.includes(s.id)
        ||s.status!=='INDEPENDENT_PROOF_REQUIRED'))
      findings.push('EXTERNAL_WRITER_SURFACE_UNBOUNDED');
  }
  if(!object(x.deploymentProof)
    ||x.deploymentProof.jobSpecificApproval!=='UNVERIFIED'
    ||x.deploymentProof.provenance!=='UNVERIFIED'
    ||x.deploymentProof.attestationVerified!==false)
    findings.push('AUTHENTICATED_DEPLOYMENT_PROOF_ABSENT');
  if(!object(x.fencingProof)||x.fencingProof.brokerSideLease!=='UNVERIFIED'
    ||x.fencingProof.writerPreemption!=='UNVERIFIED'
    ||x.fencingProof.accountWideExclusionVerified!==false)
    findings.push('ACCOUNT_FENCING_PROOF_ABSENT');
  return result(findings);
}
