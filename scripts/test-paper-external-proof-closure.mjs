import assert from 'node:assert/strict';
import {
 PAPER_EXTERNAL_PROOF_CLASSES as CLASSES,
 inspectPaperExternalProofClosure as inspect,
} from './lib/paper-external-proof-closure.mjs';

const make=()=>({
 schemaVersion:'paper-external-proof-closure-v1',
 context:{
  repository:'pungking/alpha-exec-engine',
  sourceRef:'refs/heads/main',sourceSha:'a'.repeat(40),
  environment:'PAPER_CUSTODY_APPROVAL',
  accountSha256:'b'.repeat(64),scopeSha256:'c'.repeat(64),
 },
 sourceInventory:{
  schemaVersion:'paper-reviewed-source-inventory-v1',
  workflowCount:17,jobCount:21,openBlockers:10,operationalHold:true,
 },
 requiredProofs:CLASSES.map(id=>({
  id,state:'NOT_ATTESTED',
  source:'INDEPENDENT_EXTERNAL_EVIDENCE_REQUIRED',
  verified:false,evidenceDigest:null,
 })),
 authorityDeclaration:{
  kind:'SOURCE_ONLY_NO_OPERATIONAL_AUTHORITY',
  sourceVerified:false,deploymentApproved:false,
  brokerWritersExcluded:false,replayProtected:false,
  humanOperationalApproval:false,operationalEligible:false,
 },
});
let checks=0;
const safety=r=>{
 for(const k of ['trustedGithubSourceConfirmed','environmentReviewPolicyAttested',
  'jobSpecificApprovalAuthenticated','accountWideBrokerCredentialsInventoried',
  'allExternalWritersExcluded','brokerMutationFencingProven',
  'independentReplayControlEnforced','separateHumanOperationalApproval',
  'operationalEligible','paperBrokerSubmitAuthorized','paperStateMutationAuthorized',
  'liveTradingAuthorized']) assert.equal(r[k],false,k);
 assert.deepEqual(r.missingProofs,[...CLASSES]);
};
const held=x=>{
 const r=inspect(x);assert.equal(r.status,'HOLD_INDEPENDENT_OPERATIONAL_PROOF_NOT_ACQUIRED',
  JSON.stringify(r.findings));assert.deepEqual(r.findings,[]);
 assert.equal(r.sourceOnlyRequirementInventoryMatched,true);
 safety(r);checks++;
};
const denied=(x,reason)=>{
 const r=inspect(x);assert.equal(r.status,'DENY_EXTERNAL_PROOF_DECLARATION_INVALID');
 assert.ok(r.findings.includes(reason),JSON.stringify(r.findings));
 assert.equal(r.sourceOnlyRequirementInventoryMatched,false);
 safety(r);checks++;
};
const change=(fn,reason)=>{const x=make();fn(x);denied(x,reason);};
held(make());
denied(null,'DECLARATION_ENVELOPE_INVALID');
denied({},'DECLARATION_ENVELOPE_INVALID');
change(x=>{x.schemaVersion='new';},'DECLARATION_ENVELOPE_INVALID');
change(x=>{x.forceOperational=true;},'DECLARATION_ENVELOPE_INVALID');
change(x=>{x.context.sourceSha='bad';},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.context.sourceRef='refs/heads/paper-state';},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.context.environment='LIVE_APPROVAL';},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.context.accountSha256='bad';},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.context.scopeSha256='f'.repeat(63);},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.context.verified=true;},'BOUND_SOURCE_ACCOUNT_CONTEXT_INVALID');
change(x=>{x.sourceInventory.workflowCount=18;},'SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
change(x=>{x.sourceInventory.jobCount=20;},'SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
change(x=>{x.sourceInventory.openBlockers=0;},'SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
change(x=>{x.sourceInventory.operationalHold=false;},'SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
change(x=>{x.sourceInventory.sourceAttested=true;},'SOURCE_ADMISSION_HOLD_INVARIANTS_INVALID');
change(x=>{x.requiredProofs.pop();},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].id=x.requiredProofs[1].id;},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].id='UNREVIEWED_PROOF';},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].state='VERIFIED';},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].source='TRUSTED';},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].verified=true;},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].evidenceDigest='d'.repeat(64);},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs[0].approved=true;},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.requiredProofs=null;},'EXTERNAL_PROOF_SET_INCOMPLETE_OR_FORGED');
change(x=>{x.authorityDeclaration.kind='TRUSTED_BROKER';},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.sourceVerified=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.deploymentApproved=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.brokerWritersExcluded=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.replayProtected=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.humanOperationalApproval=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.operationalEligible=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration.adminBypassAllowed=true;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
change(x=>{x.authorityDeclaration=null;},'UNSUPPORTED_OPERATIONAL_AUTHORITY_CLAIM');
const reversed=make();reversed.requiredProofs.reverse();held(reversed);
const untrusted=make();untrusted.context.sourceSha='f'.repeat(40);held(untrusted);
const output=JSON.stringify(inspect(make()));
assert.ok(!output.includes('Bearer '));checks++;
console.log(JSON.stringify({
 status:'OFFLINE_PAPER_EXTERNAL_PROOF_CLOSURE_PASS',
 checks,missingProofCategories:CLASSES.length,
 actualGithubRequests:0,brokerRequests:0,externalStateWrites:0,
 operationalAuthorityGranted:0,
}));
