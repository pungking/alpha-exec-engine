/**
 * STEP 5C-4D-3V — reviewed source-only broker credential reference inventory.
 *
 * A source workflow secret *name* is NOT proof the GitHub secret exists, that
 * it has any broker permissions, or that a broker account has no other keys,
 * actors, machines, schedulers or API clients.
 *
 * Pure offline diagnostic. No I/O, broker API, environment, credentials,
 * network, clock, GitHub admin writes, runtime grants or state mutations.
 */
const REPO = 'pungking/alpha-exec-engine';
const REVIEWED_SOURCE_COMMIT = '4ebc37c29b7ee32001a83ed03375d96cdcd7f961';
const SOURCE_REF = 'refs/heads/main';
const STATE_REF = 'refs/heads/paper-state';
const SECRET_REFERENCES = Object.freeze(['ALPACA_KEY_ID','ALPACA_SECRET_KEY']);
const EXPECTED_EXPOSURES = Object.freeze([
 ['dry-run.yml','dry-run','AUTOMATIC_REPORT_CACHE_WRITER'],
 ['ledger-filled-migration.yml','ledger-filled-migration','MANUAL_LEDGER_MIGRATION'],
 ['market-guard.yml','market-guard','AUTOMATIC_REPORT_CACHE_WRITER'],
 ['paper-five-row-broker-evidence-recovery.yml','restore-and-read','MANUAL_BROKER_READ_REPORT'],
 ['paper-oco-read-verify.yml','read-verify','MANUAL_BROKER_READ_REPORT'],
 ['paper-oco-submit-canary.yml','submit-canary','MANUAL_BROKER_SUBMIT_CANCEL'],
 ['persistent-oco-repair-open-verify-multi.yml','verify-open-protection-multi','MANUAL_BROKER_READ_REPORT'],
 ['persistent-oco-repair-open-verify.yml','verify-open-protection','MANUAL_BROKER_READ_REPORT'],
 ['persistent-oco-repair-submit.yml','submit-persistent-repair','MANUAL_BROKER_SUBMIT'],
].map(row=>Object.freeze({
 file:row[0],job:row[1],classification:row[2],
})));
const ROOT=['schemaVersion','repository','reviewedSourceCommit','baseline','authorityClaims'];
const CLAIMS=['brokerSecretValuesRead','brokerCredentialsExistVerified',
 'paperAccountIdentityVerified','liveAccountExcluded',
 'brokerKeysExhaustivelyEnumerated','externalWritersExcluded',
 'allMutationEdgesFenced','independentReplayEnforced',
 'humanOperationalApprovalObtained','operationalEligible'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length
 &&keys.every(k=>Object.hasOwn(x,k));
const label=(file,job)=>file+'#'+job;
const fixedCount=EXPECTED_EXPOSURES.length;
const report=(problems,covered)=>Object.freeze({
 schemaVersion:'paper-broker-secret-source-surface-v1',
 status:problems.length?'DENY_BROKER_SECRET_SOURCE_INVENTORY_DRIFT'
   :'HOLD_EXTERNAL_BROKER_WRITER_INVENTORY_NOT_VERIFIED',
 findings:Object.freeze([...new Set(problems)].sort()),
 reviewedSourceOnlyExposureSetMatched:problems.length===0,
 sourceReferencedBrokerJobs:problems.length===0?fixedCount:null,
 sourceReferencedAutomaticJobs:problems.length===0?2:null,
 sourceReferencedSubmitJobs:problems.length===0?2:null,
 sourceReferencedBrokerReadJobs:problems.length===0?4:null,
 sourceReferencedLedgerMigrationJobs:problems.length===0?1:null,
 sourceReferencedJobsWithProtectedEnvironment:problems.length===0?0:null,
 reviewedSourceExposures:problems.length===0?Object.freeze([...covered]):Object.freeze([]),
 proofGaps:Object.freeze([
  'WORKFLOW_SECRET_REFERENCE_DOES_NOT_PROVE_SECRET_EXISTENCE_OR_SCOPE',
  'NO_EXTERNAL_BROKER_ACCOUNT_IDENTITY_ATTESTED',
  'PAPER_AND_LIVE_CREDENTIAL_SEPARATION_UNVERIFIED',
  'ALL_BROKER_ACCOUNT_CREDENTIALS_USERS_AND_APPS_NOT_ENUMERATED',
  'EXTERNAL_LEGACY_LOCAL_SCHEDULED_AND_DIRECT_WRITERS_NOT_EXCLUDED',
  'PROTECTED_ADMISSION_JOB_NOT_THE_DOWNSTREAM_MUTATION_JOB',
  'REPOSITORY_GITHUB_CONCURRENCY_IS_NOT_BROKER_GLOBAL_LOCK',
  'NO_BROKER_MUTATION_EDGE_FENCING_OR_INDEPENDENT_REPLAY_GUARD',
  'INDEPENDENT_HUMAN_SOURCE_AND_OPERATIONAL_APPROVAL_NOT_PROVEN',
 ]),
 secretValuesRead:false,
 brokerCredentialExistenceVerified:false,
 paperLiveAccountSeparationVerified:false,
 externalAccountWritersExcluded:false,
 mutationEdgeFencingVerified:false,
 independentReplayVerified:false,
 operationalEligible:false,
 paperBrokerSubmitAuthorized:false,
 paperStateMutationAuthorized:false,
 liveTradingAuthorized:false,
});
/**
 * Inspect the reviewed 17 Workflow / 21 Job Admission source inventory.
 * This source snapshot is in no way a complete actual account credential or
 * mutation-client inventory. Even matching source => HOLD, never READY.
 */
export function inspectPaperBrokerSecretSourceSurface(input={}){
 const x=object(input)?input:{},errors=[];
 if(!exact(x,ROOT)||x.schemaVersion!=='paper-broker-secret-source-surface-v1'
   ||x.repository!==REPO||x.reviewedSourceCommit!==REVIEWED_SOURCE_COMMIT)
  errors.push('SOURCE_EXPOSURE_ENVELOPE_INVALID');
 if(!exact(x.authorityClaims,CLAIMS)
   ||CLAIMS.some(k=>x.authorityClaims?.[k]!==false))
  errors.push('UNSUPPORTED_BROKER_WRITER_AUTHORITY_CLAIM');
 const b=x.baseline;
 if(!object(b)||b.schemaVersion!=='paper-workflow-admission-v1'
   ||b.sourceCommit!==REVIEWED_SOURCE_COMMIT
   ||b.sourceRef!==SOURCE_REF||b.stateRef!==STATE_REF
   ||b.operationalHold!==true||b.settingsEvidence!=='USER_REPORTED_NOT_FETCHED'
   ||!Array.isArray(b.workflows)||b.workflows.length!==17
   ||!Array.isArray(b.blockers)||b.blockers.length!==10
   ||b.blockers.some(k=>!object(k)||k.status!=='OPEN'))
  errors.push('SOURCE_ADMISSION_BOUNDARY_INVALID');
 if(errors.includes('SOURCE_ADMISSION_BOUNDARY_INVALID'))
  return report(errors,[]);
 const jobs=[];
 const files=new Set(),identities=new Set();
 for(const w of b.workflows){
  if(!object(w)||typeof w.file!=='string'||files.has(w.file)
    ||!Array.isArray(w.jobs)||w.jobs.length<1){
   errors.push('WORKFLOW_SOURCE_JOB_GRAIN_INVALID');continue;
  }
  files.add(w.file);
  for(const j of w.jobs){
   if(!object(j)||typeof j.id!=='string'
     ||typeof j.classification!=='string'
     ||!object(j.observed)||!Array.isArray(j.observed.secrets)
     ||!object(j.observed.effectiveJobFlags)
     ||typeof j.observed.dynamicSecretReference!=='boolean'){
    errors.push('WORKFLOW_SOURCE_JOB_GRAIN_INVALID');continue;
   }
   const key=label(w.file,j.id);
   if(identities.has(key))errors.push('DUPLICATE_SOURCE_JOB_IDENTITY');
   identities.add(key);
   jobs.push({file:w.file,job:j.id,classification:j.classification,
    observed:j.observed});
  }
 }
 if(jobs.length!==21||files.size!==17)
  errors.push('REVIEWED_JOB_COUNT_CHANGED');
 const references=[];
 for(const j of jobs){
  const s=j.observed.secrets;
  if(s.some(key=>typeof key!=='string')
    ||new Set(s).size!==s.length
    ||j.observed.dynamicSecretReference===true)
   errors.push('UNREVIEWED_DYNAMIC_OR_DUPLICATE_SECRET_REFERENCE');
  const alpaca=s.filter(k=>typeof k==='string'&&k.startsWith('ALPACA_'));
  if(alpaca.length===0)continue;
  if(alpaca.length!==2||!SECRET_REFERENCES.every(k=>alpaca.includes(k)))
   errors.push('PARTIAL_OR_UNKNOWN_BROKER_SECRET_REFERENCE');
  if(j.observed.environment!==null)
   errors.push('BROKER_SECRET_ENVIRONMENT_SCOPE_DRIFT');
  for(const [key,expected] of [['EXEC_ENABLED',false],
   ['LIVE_ORDER_SUBMIT_ENABLED',false]]){
   const v=j.observed.effectiveJobFlags[key];
   if(v!==undefined&&v!==(expected?'true':'false')&&v!==expected)
    errors.push('REVIEWED_BROKER_EXECUTION_FLAG_CHANGED');
  }
  if(j.observed.effectiveJobFlags.READ_ONLY!==undefined
    &&j.observed.effectiveJobFlags.READ_ONLY!==true
    &&j.observed.effectiveJobFlags.READ_ONLY!=='true')
   errors.push('REVIEWED_BROKER_READONLY_FLAG_CHANGED');
  references.push(label(j.file,j.job));
 }
 const expected=EXPECTED_EXPOSURES.map(s=>label(s.file,s.job)).sort();
 if(references.length!==fixedCount
    ||references.some(k=>!expected.includes(k))
    ||expected.some(k=>!references.includes(k)))
  errors.push('BROKER_SECRET_EXPOSURE_SET_DRIFT');
 for(const entry of EXPECTED_EXPOSURES){
  const row=jobs.find(x=>x.file===entry.file&&x.job===entry.job);
  if(!row||row.classification!==entry.classification)
   errors.push('BROKER_JOB_ROLE_CLASSIFICATION_DRIFT');
 }
 const admissions=jobs.filter(j=>j.classification==='MANUAL_ADMISSION_HOLD');
 if(admissions.length!==4||admissions.some(j=>j.job!=='admission'
   ||j.observed.environment!=='PAPER_CUSTODY_APPROVAL'
   ||j.observed.secrets.length!==0))
   errors.push('PROTECTED_ADMISSION_NO_BROKER_SECRET_BOUNDARY_DRIFT');
 return report(errors,EXPECTED_EXPOSURES);
}
