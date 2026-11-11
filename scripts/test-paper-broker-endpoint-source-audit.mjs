import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 PAPER_BROKER_ENDPOINT_REVIEWED_JOBS as TARGETS,
 inspectPaperBrokerEndpointSourceAudit as inspect,
} from './lib/paper-broker-endpoint-source-audit.mjs';

const REPO='pungking/alpha-exec-engine';
const MAIN='0cd1f54fa6d6f7f8220540a193cdcbbdf499e994';
const BASE=JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const SOURCES=Object.fromEntries(TARGETS.map(x=>
 [x.file,fs.readFileSync('.github/workflows/'+x.file,'utf8')]));
const AUTH=['actualGithubVariableRead','allRuntimeBrokerHostsPinned',
 'liveBrokerHostnameExcluded','brokerKeyOrderPrivilegesExcluded',
 'externalAccountWritersExcluded','allMutationEdgesFenced',
 'exactJobApprovalVerified','humanOperationalApproval','operationalEligible'];
function fixture(){
 return {schemaVersion:'paper-broker-endpoint-source-audit-v1',
  repository:REPO,reviewedMainSha:MAIN,
  baseline:structuredClone(BASE),workflowSources:{...SOURCES},
  authorityClaims:Object.fromEntries(AUTH.map(x=>[x,false]))};
}
let checks=0;
function safety(r){
 for(const k of ['actualGithubVariableVerified','liveHostExcluded',
  'runtimeEndpointBound','paperLiveAccountIsolationVerified',
  'externalWritersExcluded','brokerMutationFenced','exactJobOperationApproved',
  'operationalEligible','paperBrokerSubmitAuthorized',
  'paperStateMutationAuthorized','liveTradingAuthorized'])
  assert.equal(r[k],false,k);
 assert.ok(r.proofGaps.includes('GITHUB_ALPACA_BASE_URL_VARIABLE_VALUE_NOT_OBSERVED'));
}
const hold=x=>{
 const r=inspect(x);assert.equal(r.status,'HOLD_THREE_BROKER_ENDPOINT_VARIABLES_UNATTESTED',
  JSON.stringify(r.findings));
 assert.deepEqual(r.findings,[]);
 assert.equal(r.reviewedSourceDefinitionsMatched,true);
 assert.equal(r.sourceBrokerCredentialJobs,9);
 assert.equal(r.sourceFixedPaperUrlJobs,6);
 assert.equal(r.sourceUnresolvedVariableUrlJobs,3);
 assert.deepEqual(r.variableRoutingJobs,[
  'dry-run.yml#dry-run',
  'market-guard.yml#market-guard',
  'ledger-filled-migration.yml#ledger-filled-migration',
 ]);
 safety(r);checks++;return r;
};
const denied=(x,reason)=>{
 const r=inspect(x);
 assert.equal(r.status,'DENY_BROKER_ENDPOINT_REVIEWED_SOURCE_DRIFT');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.reviewedSourceDefinitionsMatched,false);
 assert.equal(r.sourceUnresolvedVariableUrlJobs,null);
 safety(r);checks++;
};
const change=(fn,why)=>{const x=fixture();fn(x);denied(x,why);};
function replace(x,file,needle,withText){
 assert.ok(x.workflowSources[file].includes(needle),'missing test fixture '+file);
 x.workflowSources[file]=x.workflowSources[file].replace(needle,withText);
}
hold(fixture());
assert.equal(TARGETS.length,9);checks++;
denied(null,'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
denied({},'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
change(x=>{x.schemaVersion='READY';},'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
change(x=>{x.repository='another/repo';},'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
change(x=>{x.reviewedMainSha='f'.repeat(40);},'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
change(x=>{x.verifiedAccountWriter=true;},'ENDPOINT_INPUT_OR_REVIEWED_SHA_INVALID');
for(const k of AUTH)change(x=>{x.authorityClaims[k]=true;},
 'UNSUPPORTED_BROKER_ENDPOINT_AUTHORITY_CLAIM');
change(x=>{x.authorityClaims.trustedBroker=true;},
 'UNSUPPORTED_BROKER_ENDPOINT_AUTHORITY_CLAIM');
change(x=>{delete x.authorityClaims;},
 'UNSUPPORTED_BROKER_ENDPOINT_AUTHORITY_CLAIM');
change(x=>{x.baseline.operationalHold=false;},
 'REVIEWED_ADMISSION_SOURCE_HOLD_INVALID');
change(x=>{x.baseline.settingsEvidence='ATTESTED';},
 'REVIEWED_ADMISSION_SOURCE_HOLD_INVALID');
change(x=>{x.baseline.blockers.pop();},
 'REVIEWED_ADMISSION_SOURCE_HOLD_INVALID');
change(x=>{x.baseline.workflows.pop();},
 'REVIEWED_ADMISSION_SOURCE_HOLD_INVALID');
change(x=>{delete x.workflowSources['dry-run.yml'];},
 'NINE_REVIEWED_WORKFLOW_FILES_REQUIRED');
change(x=>{x.workflowSources['external-live.yml']='jobs: {}';},
 'NINE_REVIEWED_WORKFLOW_FILES_REQUIRED');
change(x=>{x.workflowSources['market-guard.yml']=null;},
 'SOURCE_TEXT_OR_ADMISSION_DIGEST_DRIFT');
change(x=>{x.baseline.workflows.find(w=>w.file==='dry-run.yml')
 .definitionSha256='f'.repeat(64);},
 'SOURCE_TEXT_OR_ADMISSION_DIGEST_DRIFT');
change(x=>{replace(x,'paper-oco-submit-canary.yml',
 'https://paper-api.alpaca.markets','https://api.alpaca.markets');},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'persistent-oco-repair-submit.yml',
 'ALPACA_BASE_URL: https://paper-api.alpaca.markets',
 'ALPACA_BASE_URL: https://api.alpaca.markets');},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'dry-run.yml',
 'ALPACA_BASE_URL: '+String.fromCharCode(36,123,123)+' vars.ALPACA_BASE_URL }}',
 'ALPACA_BASE_URL: https://api.alpaca.markets');},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'market-guard.yml',
 'ALPACA_BASE_URL: '+String.fromCharCode(36,123,123)+' vars.ALPACA_BASE_URL }}',
 'ALPACA_BASE_URL: https://paper-api.alpaca.markets');},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'ledger-filled-migration.yml',
 "vars.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'",
 "vars.ALPACA_BASE_URL || 'https://api.alpaca.markets'");},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'dry-run.yml',
 'ALPACA_SECRET_KEY: '+String.fromCharCode(36,123,123)+' secrets.ALPACA_SECRET_KEY }}',
 'ALPACA_SECRET_KEY: MISSING');},
 'REVIEWED_ALPACA_SECRET_JOB_BINDING_DRIFT');
change(x=>{replace(x,'paper-oco-read-verify.yml',
 'ALPACA_KEY_ID: '+String.fromCharCode(36,123,123)+' secrets.ALPACA_KEY_ID }}',
 'ALPACA_KEY_ID: bogus');},
 'REVIEWED_ALPACA_SECRET_JOB_BINDING_DRIFT');
change(x=>{replace(x,'market-guard.yml',
 '  market-guard:\n    runs-on:',
 '  market-guard:\n    environment: PAPER_CUSTODY_APPROVAL\n    runs-on:');},
 'REVIEWED_ALPACA_JOB_ENVIRONMENT_DRIFT');
change(x=>{replace(x,'paper-oco-read-verify.yml',
 'ALPACA_BASE_URL: https://paper-api.alpaca.markets',
 'ALPACA_BASE_URL: https://paper-api.alpaca.markets\n      UNREVIEWED_EXTRA: true');},
 'WORKFLOW_CANONICAL_SOURCE_SHA_DRIFT');
change(x=>{x.workflowSources['dry-run.yml']='jobs: [broken';},
 'WORKFLOW_YAML_PARSE_DENY');
change(x=>{replace(x,'paper-five-row-broker-evidence-recovery.yml',
 'ALPACA_BASE_URL: https://paper-api.alpaca.markets',
 'ALPACA_BASE_URL: '+String.fromCharCode(36,123,123)+' vars.CUSTOM }}');},
 'REVIEWED_BROKER_URL_BINDING_DRIFT');
change(x=>{replace(x,'paper-five-row-broker-evidence-recovery.yml',
 'id: broker_evidence','id: misidentified_broker_step');},
 'REVIEWED_BROKER_STEP_SCOPE_DRIFT');
change(x=>{replace(x,'paper-five-row-broker-evidence-recovery.yml',
 "if: steps.preflight.outputs.ready == 'true'","if: always()");},
 'REVIEWED_BROKER_STEP_SCOPE_DRIFT');
change(x=>{replace(x,'paper-oco-read-verify.yml',
 '      - name: Setup Node\n        uses: actions/setup-node@v4',
 '      - name: Setup Node\n        env:\n          ALPACA_BASE_URL: https://api.alpaca.markets\n        uses: actions/setup-node@v4');},
 'UNREVIEWED_BROKER_STEP_ENV_OVERRIDE');
const proof=hold(fixture());
for(const value of ['ALPACA_SECRET_KEY','ALPACA_KEY_ID',
 'https://api.alpaca.markets'])
 assert.ok(!JSON.stringify(proof).includes(value),'credential or LIVE URL reflection');
checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_BROKER_ENDPOINT_SOURCE_AUDIT_PASS',
 checks,sourceCredentialJobs:9,literalPaperUrlJobs:6,
 unresolvedVariableRouteJobs:3,
 actualGithubVariableFetches:0,actualBrokerRequests:0,
 secretValuesRead:0,externalStateWrites:0,operationalAuthorityGranted:0,
}));
