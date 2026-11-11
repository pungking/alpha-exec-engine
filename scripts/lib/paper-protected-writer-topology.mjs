/**
 * STEP 5C-4D-3P — read-only reviewed-workflow topology audit.
 *
 * The protected admission Job is NOT the broker/state-mutating Job.
 * A successful Environment review of admission must never be treated as
 * separate Job approval, account-wide Writer fencing or broker authority.
 * No network, state, credential, dispatch, broker or file writes.
 */
import { canonical, sha256, parseWorkflow } from '../check-paper-workflow-admission.mjs';

const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exactly=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const TARGETS=Object.freeze([
 {file:'ledger-filled-migration.yml',writer:'ledger-filled-migration',
  classification:'MANUAL_LEDGER_MIGRATION',
  definitionSha256:'cc6aa0588ed7022256518d506db03165220e4291c6c884a2c6c14c67631a7926'},
 {file:'paper-five-row-active-limited-state-recovery.yml',writer:'recover',
  classification:'MANUAL_LEDGER_MIGRATION',
  definitionSha256:'fec664b36241502bc105b81d1f61d7f84ac8ad158116c8820e2c3feb0784b99f'},
 {file:'paper-oco-submit-canary.yml',writer:'submit-canary',
  classification:'MANUAL_BROKER_SUBMIT_CANCEL',
  definitionSha256:'7bddd98b4fd442959a00761a31af7ee3d0fb89f908291b6594f6d87034e90339'},
 {file:'persistent-oco-repair-submit.yml',writer:'submit-persistent-repair',
  classification:'MANUAL_BROKER_SUBMIT',
  definitionSha256:'03a3ad8692120b035084fdad233cefe399ce3a5db1585194e2f7aa0d3b484f86'},
].map(Object.freeze));
export const PAPER_PROTECTED_WRITER_TOPOLOGY=TARGETS;
const ENV='PAPER_CUSTODY_APPROVAL';
const REQUIRED_NEEDS="admission";
const REQUIRED_IF='$'+"{{ needs.admission.result == 'success' && needs.admission.outputs.operational_authorized == 'true' }}";
const REQUIRED_ADMISSION_IF='$'+"{{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}";
const REQUIRED_HOLD_SCRIPT="set -euo pipefail\necho '{\"status\":\"BLOCKED_PAPER_CUSTODY_OPERATIONAL_HOLD\",\"operationalAuthorized\":false}'\nexit 1";
const fail=errors=>Object.freeze({
 schemaVersion:'paper-protected-writer-topology-v1',
 status:errors.length?'DENY_WRITER_TOPOLOGY_SOURCE_DRIFT'
  :'HOLD_APPROVED_ADMISSION_NOT_WRITER_JOB_AUTHORITY',
 findings:Object.freeze([...new Set(errors)].sort()),
 reviewedSourceTopologyMatched:errors.length===0,
 protectedAdmissionJobCount:errors.length===0?4:0,
 unboundMutationJobCount:errors.length===0?4:0,
 noAdmissionAuthorizationOutputObserved:errors.length===0,
 admissionJobItselfFailsClosed:errors.length===0,
 proofGaps:Object.freeze([
  'PROTECTED_ADMISSION_IS_NOT_MUTATION_JOB',
  'JOB_SPECIFIC_DEPLOYMENT_AUTHORIZATION_NOT_ATTESTED',
  'PROTECTED_ENVIRONMENT_RUNTIME_SETTINGS_NOT_ATTESTED',
  'BROKER_ACCOUNT_WIDE_WRITER_FENCE_NOT_VERIFIED',
  'EXTERNAL_LEGACY_WRITERS_NOT_EXCLUDED',
 ]),
 protectedAdmissionApprovalTransfersToWriter:false,
 jobSpecificOperationalApprovalVerified:false,
 environmentPolicyIndependentProof:false,
 accountWideWriterExclusionVerified:false,
 brokerMutationFencingVerified:false,
 operationalEligible:false,
 paperBrokerSubmitAuthorized:false,
 paperStateMutationAuthorized:false,
 liveTradingAuthorized:false,
});
/**
 * Source-only diagnostic: the actual checked-out Workflow texts plus their
 * separately-reviewed, SHA-256-pinned inventory must both match. Source
 * checks cannot authenticate present-day GitHub repository environment policy.
 */
export function inspectPaperProtectedWriterTopology(input={}){
 const x=obj(input)?input:{},errors=[],b=x.baseline,files=x.workflowSources;
 if(!exactly(x,['baseline','workflowSources']))errors.push('INPUT_ENVELOPE_INVALID');
 if(!obj(b)||b.schemaVersion!=='paper-workflow-admission-v1'
   ||b.sourceRef!=='refs/heads/main'||b.stateRef!=='refs/heads/paper-state'
   ||b.operationalHold!==true||b.settingsEvidence!=='USER_REPORTED_NOT_FETCHED'
   ||!Array.isArray(b.workflows)||b.workflows.length!==17
   ||!Array.isArray(b.blockers)||b.blockers.length!==10
   ||b.blockers.some(v=>!obj(v)||v.status!=='OPEN')
   ||b.workflows.some(w=>!obj(w)||!Array.isArray(w.jobs))
   ||b.workflows.reduce((sum,w)=>sum+(Array.isArray(w.jobs)?w.jobs.length:0),0)!==21)
   errors.push('FROZEN_ADMISSION_BOUNDARY_INVALID');
 if(Array.isArray(b?.workflows)&&b.workflows.some(w=>
    !Array.isArray(w.jobs)||w.jobs.some(j=>!obj(j)
      ||j.operationalEligible!==false||j.writerClaimVerified!==false)))
   errors.push('UNREVIEWED_ADMISSION_PROMOTION');
 if(!obj(files)||canonical(Object.keys(files).sort())
   !==canonical(TARGETS.map(x=>x.file).sort()))
   errors.push('REVIEWED_WORKFLOW_SET_INCOMPLETE');
 if(errors.length)return fail(errors);
 for(const target of TARGETS){
  const record=b.workflows.filter(w=>w.file===target.file);
  const source=files[target.file];
  if(record.length!==1||typeof source!=='string'||Buffer.byteLength(source,'utf8')>1024*1024){
   errors.push('WORKFLOW_SOURCE_NOT_EXACTLY_COVERED');continue;
  }
  let w;
  try{w=parseWorkflow(source);}catch{errors.push('WORKFLOW_YAML_UNREVIEWED');continue;}
  const digest=sha256(canonical(w));
  if(digest!==target.definitionSha256||record[0].definitionSha256!==target.definitionSha256)
   errors.push('WORKFLOW_DEFINITION_SHA_DRIFT');
  if(canonical(Object.keys(w.jobs).sort())!==canonical(['admission',target.writer].sort())
    ||canonical(Object.keys(w.on))!==canonical(['workflow_dispatch'])
    ||canonical(record[0].events)!==canonical(['workflow_dispatch'])
    ||record[0].jobs.length!==2)
   {errors.push('WORKFLOW_DISPATCH_AND_JOB_SET_DRIFT');continue;}
  const admission=w.jobs.admission,writer=w.jobs[target.writer];
  if(!obj(admission)||!obj(writer)){errors.push('JOB_DEFINITION_MISSING');continue;}
  const ar=record[0].jobs.find(j=>j.id==='admission');
  const wr=record[0].jobs.find(j=>j.id===target.writer);
  if(!obj(ar)||!obj(wr)||ar.classification!=='MANUAL_ADMISSION_HOLD'
    ||wr.classification!==target.classification
    ||ar.operationalEligible!==false||wr.operationalEligible!==false
    ||ar.writerClaimVerified!==false||wr.writerClaimVerified!==false
    ||ar.observed?.environment!==ENV||wr.observed?.environment!==null)
   errors.push('REVIEWED_JOB_CLASSIFICATION_OR_ENV_DRIFT');
  if(admission.environment!==ENV||admission.name!=='Protected PAPER approval - operational HOLD'
    ||admission.if!==REQUIRED_ADMISSION_IF||admission.outputs!==undefined
    ||!Array.isArray(admission.steps)||admission.steps.length!==1
    ||admission.steps[0]?.shell!=='bash'
    ||String(admission.steps[0]?.run??'').trim()!==REQUIRED_HOLD_SCRIPT)
   errors.push('PROTECTED_ADMISSION_FAIL_CLOSED_DRIFT');
  if(writer.environment!=null||writer.needs!==REQUIRED_NEEDS||writer.if!==REQUIRED_IF)
   errors.push('WRITER_JOB_DEPENDENCY_OR_ENV_DRIFT');
 }
 return fail(errors);
}
