import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditWorkflows, loadInputs, parseWorkflow } from './check-paper-workflow-admission.mjs';
const inputs = loadInputs();
let checks = 0;
const ok = fn => { fn(); checks++; };
const reject = fn => ok(() => assert.throws(fn));
const run = change => { const x = structuredClone(inputs); change(x); return auditWorkflows(x); };
ok(() => { const r = auditWorkflows(inputs); assert.equal(r.workflowCount, 17); assert.equal(r.jobCount, 21); assert.equal(r.operationalEligibleJobs, 0); assert.equal(r.operationalHold, true); });
ok(() => assert.deepEqual(auditWorkflows(inputs), auditWorkflows(inputs)));
for (const bad of ['on: push\non: schedule\njobs: {}', 'on: !!str push\njobs: {}', 'x: &x [*x]\non: push\njobs: {}', 'on: push\njobs: {}\n---\non: schedule', 'on: push\njobs: {}\nfoo: .nan']) reject(() => parseWorkflow(bad));
reject(() => run(x => { x.files['evil.yml'] = 'on: schedule\njobs: {evil: {runs-on: ubuntu-latest, steps: [{run: "curl -X POST broker"}]}}'; }));
reject(() => run(x => { delete x.files['dry-run.yml']; }));
const mutate = (file, fn) => run(x => { const w = parseWorkflow(x.files[file]); fn(w); x.files[file] = JSON.stringify(w); });
for (const f of ['dry-run.yml', 'market-guard.yml']) for (const [key,value] of [['EXEC_ENABLED','true'],['READ_ONLY','false'],['LIVE_ORDER_SUBMIT_ENABLED','true'],['MARKET_GUARD_MODE','execute'],['ALPHA_ENV','LIVE']]) {
 reject(() => mutate(f,w => {Object.values(w.jobs)[0].env[key]=value;}));
}
for (const f of ['dry-run.yml','market-guard.yml']) {
 reject(() => mutate(f,w=>{Object.values(w.jobs)[0].steps.push({run:'echo EXEC_ENABLED=true >> "$GITHUB_ENV"'});}));
 reject(() => mutate(f,w=>{Object.values(w.jobs)[0].steps.push({run:'node scripts/unknown.mjs',env:{READ_ONLY:'false'}});}));
 reject(() => mutate(f,w=>{Object.values(w.jobs)[0].env.EXEC_ENABLED='${{ vars.EXEC_ENABLED }}';}));
}
for (const f of ['paper-oco-submit-canary.yml','persistent-oco-repair-submit.yml']) for (const event of ['schedule','push','repository_dispatch','workflow_run','pull_request_target']) reject(() => mutate(f,w => {w.on[event]={};}));
for (const change of [w=>{w.permissions={contents:'write'};},w=>{Object.values(w.jobs)[0].permissions={actions:'write'};},w=>{w.jobs['submit-canary'].environment='PAPER_CUSTODY_APPROVAL';},w=>{w.concurrency={group:'paper-writer', 'cancel-in-progress':false};},w=>{Object.values(w.jobs)[0].steps.push({uses:'./unreviewed-action'});},w=>{w.on={push:{branches:['paper-state']}};},w=>{Object.values(w.jobs)[0].steps[0]={uses:'actions/checkout@v5',with:{ref:'paper-state'}};}]) reject(() => mutate('paper-oco-submit-canary.yml',change));
for (const change of [b=>{b.workflows.push(b.workflows[0]);},b=>{b.workflows.pop();},b=>{b.workflows[0].jobs[0].operationalEligible=true;},b=>{b.workflows[0].jobs[0].classification='UNKNOWN';},b=>{b.workflows[0].jobs[0].blockers=[];},b=>{b.operationalHold=false;},b=>{b.stateRef='refs/heads/main';},b=>{b.sourceRef='refs/heads/paper-state';},b=>{b.reviewBy='2099-01-01T00:00:00Z';},b=>{b.blockers=[];},b=>{b.extraException=true;}]) reject(() => run(x=>change(x.baseline)));
reject(() => run(x=>{x.now='2099-01-01T00:00:00Z';}));
reject(() => run(x=>{x.now='invalid';}));
reject(() => run(x=>{x.evidence['src/index.ts']+='\n// changed';}));
reject(() => run(x=>{delete x.evidence['src/index.ts'];}));
reject(() => run(x=>{x.packageScripts['guard']='node scripts/evil.mjs';}));
reject(() => run(x=>{x.evidence['scripts/run-private-sidecar-step.sh']+='\ncurl -X POST broker';}));
reject(() => mutate('ci.yml',w=>{w.jobs.hidden={ 'runs-on':'ubuntu-latest',steps:[{run:'node hidden-writer.mjs'}] };}));
reject(() => mutate('ci.yml',w=>{delete w.jobs.build;}));
reject(() => run(x=>{x.baseline.workflows[0].jobs.push(x.baseline.workflows[0].jobs[0]);}));
reject(() => run(x=>{x.baseline.workflows[0].jobs[0].writerClaimVerified=true;}));
ok(()=>{const r=run(x=>{x.files['market-guard.yml']+='\n# harmless formatting comment\n';});assert.equal(r.operationalHold,true);});
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'admission-fixture-')));
try {
 fs.mkdirSync(path.join(root,'config'));
 fs.writeFileSync(path.join(root,'config/paper-workflow-admission-baseline.json'), JSON.stringify({...inputs.baseline,evidenceSha256:{'.env':'untrusted'}}));
 ok(()=>assert.throws(()=>loadInputs(root),/BASELINE_UNREVIEWED_CHANGE/, 'Untrusted baseline must fail before reading any declared evidence path'));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
console.log(JSON.stringify({status:'OFFLINE_ADMISSION_TEST_PASS',checks,brokerRequests:0,operationalChanges:0}));
await import('./test-paper-mutation-admission-contract.mjs');
await import('./test-paper-workflow-hard-hold.mjs');
