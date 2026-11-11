/**
 * STEP 5C-4D-3O: static, offline external proof acquisition gate.
 *
 * A caller-declared list of missing evidence cannot become verified
 * operational authority. This module intentionally has no ACCEPT/READY path.
 * It performs no network, filesystem, clock, credentials, broker or git writes.
 */
const REPO = 'pungking/alpha-exec-engine';
const ENV = 'PAPER_CUSTODY_APPROVAL';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => obj(v)
  && Object.keys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k));

/**
 * Required *external* evidence classes. These are requirements only,
 * not evidence that the present runner actually collected anything.
 */
export const PAPER_EXTERNAL_PROOF_CLASSES = Object.freeze([
  'TRUSTED_GITHUB_COLLECTOR_ORIGIN',
  'PROTECTED_ENVIRONMENT_ENFORCEMENT',
  'EXACT_JOB_DEPLOYMENT_APPROVAL_BINDING',
  'ACCOUNT_WIDE_BROKER_CREDENTIAL_INVENTORY',
  'ALL_LEGACY_AND_EXTERNAL_WRITER_EXCLUSION',
  'BROKER_MUTATION_EDGE_FENCING',
  'INDEPENDENT_APPEND_ONLY_REPLAY_CONTROL',
  'SEPARATE_HUMAN_OPERATIONAL_APPROVAL',
]);
const ROOT = ['schemaVersion','context','sourceInventory','requiredProofs','authorityDeclaration'];
const CONTEXT = ['repository','sourceRef','sourceSha','environment','accountSha256','scopeSha256'];
const SOURCE = ['schemaVersion','workflowCount','jobCount','openBlockers','operationalHold'];
const PROOF = ['id','state','source','verified','evidenceDigest'];
const AUTH = ['kind','sourceVerified','deploymentApproved','brokerWritersExcluded',
  'replayProtected','humanOperationalApproval','operationalEligible'];
const close = findings => Object.freeze({
  schemaVersion:'paper-external-proof-closure-v1',
  status:findings.length?'DENY_EXTERNAL_PROOF_DECLARATION_INVALID'
    :'HOLD_INDEPENDENT_OPERATIONAL_PROOF_NOT_ACQUIRED',
  findings:Object.freeze([...new Set(findings)].sort()),
  missingProofs:Object.freeze([...PAPER_EXTERNAL_PROOF_CLASSES]),
  sourceOnlyRequirementInventoryMatched:findings.length===0,
  trustedGithubSourceConfirmed:false,
  environmentReviewPolicyAttested:false,
  jobSpecificApprovalAuthenticated:false,
  accountWideBrokerCredentialsInventoried:false,
  allExternalWritersExcluded:false,
  brokerMutationFencingProven:false,
  independentReplayControlEnforced:false,
  separateHumanOperationalApproval:false,
  operationalEligible:false,
  paperBrokerSubmitAuthorized:false,
  paperStateMutationAuthorized:false,
  liveTradingAuthorized:false,
});
/**
 * Explicit 'not attested' proof placeholders cannot authorize anything.
 * No positive evidence or authority claim is supported by this source-only
 * contract. Positive proof requires a distinct independently approved gate.
 */
export function inspectPaperExternalProofClosure(input = {}) {
 const x=obj(input)?input:{},errors=[];
 if(!exact(x,ROOT)||x.schemaVersion!=='paper-external-proof-closure-v1')
   errors.push('DECLARATION_ENVELOPE_INVALID');
 const c=x.context;
 if(!exact(c,CONTEXT)||c.repository!==REPO
   ||c.sourceRef!=='refs/heads/main'
   ||!SHA40.test(c.sourceSha)
   ||c.environment!==ENV
   ||!SHA64.test(c.accountSha256)
   ||!SHA64.test(c.scopeSha256))
   errors.push('BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
 const s=x.sourceInventory;
 if(!exact(s,SOURCE)||s.schemaVersion!=='paper-reviewed-source-inventory-v1'
   ||s.workflowCount!==17||s.jobCount!==21||s.openBlockers!==10
   ||s.operationalHold!==true)
   errors.push('SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
 const p=x.requiredProofs;
 if(!Array.isArray(p)||p.length!==PAPER_EXTERNAL_PROOF_CLASSES.length
   ||p.some(y=>!exact(y,PROOF))
   ||new Set(p.map(y=>y?.id)).size!==PAPER_EXTERNAL_PROOF_CLASSES.length
   ||p.some(y=>!PAPER_EXTERNAL_PROOF_CLASSES.includes(y.id)
      ||y.state!=='NOT_ATTESTED'
      ||y.source!=='INDEPENDENT_EXTERNAL_EVIDENCE_REQUIRED'
      ||y.verified!==false
      ||y.evidenceDigest!==null))
   errors.push('EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
 const a=x.authorityDeclaration;
 if(!exact(a,AUTH)||a.kind!=='SOURCE_ONLY_NO_OPERATIONAL_AUTHORITY'
   ||AUTH.slice(1).some(k=>a[k]!==false))
   errors.push('UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
 return close(errors);
}
