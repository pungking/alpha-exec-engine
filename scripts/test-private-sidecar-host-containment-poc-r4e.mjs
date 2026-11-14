// Issue #91 R4E — disposable Linux host-containment feasibility PoC.
// Never writes cgroupfs, alters workflow/runtime policy, or operates on real
// producer processes. All kill targets are recorded synthetic PIDs and matched
// by /proc starttime (best-effort identity; not a pidfd containment guarantee).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HOLD = {admissionApproved:false, operationalHold:true, hostWideNoOrphan:'UNVERIFIED'};
if (process.platform !== 'linux') {
  console.log(JSON.stringify({status:'R4E_POC_SKIPPED',reason:'LINUX_REQUIRED',...HOLD}));
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'issue91-r4e-'));
  const recordPath = path.join(root,'synthetic-processes.json');
  const cgroup = {version:'UNVERIFIED',delegation:'UNVERIFIED',killApi:'UNVERIFIED',isolationTest:'NOT_RUN'};
  const stat = pid => {
    try {
      const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8');
      const fields=raw.slice(raw.lastIndexOf(') ')+2).split(' ');
      return {pid,state:fields[0],group:fields[2],session:fields[3],start:fields[19]};
    } catch (e) {
      if (e.code==='ENOENT'||e.code==='ESRCH') return null;
      throw e;
    }
  };
  const alive = r => {
    const s=r&&stat(r.pid);
    return Boolean(s&&s.start===r.start&&!['Z','X'].includes(s.state));
  };
  const safeKill = r => {
    if (!alive(r)) return;
    try {process.kill(r.pid,'SIGKILL');} catch(e) {if(e.code!=='ESRCH') throw e;}
  };
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  let child, timer, recorded=[];
  try {
    // This is read-only capability discovery, never delegated-cgroup creation.
    const cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n');
    const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n');
    cgroup.version=cg.some(x=>x.startsWith('0::'))&&mounts.some(x=>x.includes(' - cgroup2 '))
      ? 'V2_OBSERVED' : 'V2_NOT_CONFIRMED';
    if (cgroup.version==='V2_OBSERVED') {
      cgroup.killApi=fs.existsSync('/sys/fs/cgroup/cgroup.kill')
        ? 'ROOT_KILL_FILE_OBSERVED_NOT_AUTHORIZED'
        : 'ROOT_KILL_FILE_NOT_OBSERVED';
    }
    // A writable cgroup delegate cannot be proven from metadata alone.
    // An owned delegated subtree, process migration and cgroup.kill must be
    // tested only after separately authorized host/sandbox controls.
    const worker=String.raw`
      const fs=require('node:fs');
      const {spawn}=require('node:child_process');
      const file=process.argv[1];
      const escaped=spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],
        {detached:true,stdio:'ignore',env:{PATH:process.env.PATH}});
      const stat=pid=>{const v=fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ');
        return {pid,state:v[0],group:v[2],session:v[3],start:v[19]};};
      fs.writeFileSync(file,JSON.stringify([stat(process.pid),stat(escaped.pid)]),{mode:0o600});
      setTimeout(()=>{},4000);
    `;
    child=spawn(process.execPath,['-e',worker,recordPath],{
      cwd:root,stdio:'ignore',env:{PATH:process.env.PATH}
    });
    child.on('error',()=>{});
    timer=setTimeout(()=>safeKill(recorded[0]||stat(child.pid)),5000);
    const started=Date.now();
    while(!fs.existsSync(recordPath)&&Date.now()-started<2500) await delay(15);
    assert.ok(fs.existsSync(recordPath),'synthetic worker failed to report');
    recorded=JSON.parse(fs.readFileSync(recordPath,'utf8'));
    assert.equal(recorded.length,2);
    assert.ok(recorded.every(alive),'synthetic worker and descendant alive before test');
    assert.notEqual(recorded[0].group,recorded[1].group,'grandchild must escape worker group');
    assert.notEqual(recorded[0].session,recorded[1].session,'grandchild must escape worker session');
    safeKill(recorded[0]);
    await delay(100);
    const survived=alive(recorded[1]);
    assert.equal(survived,true,'parent SIGKILL does not contain escaped descendant');
    console.log(JSON.stringify({
      status:'R4E_ISOLATED_SYNTHETIC_POC_PASS',
      cgroup,
      disposableEscapedDescendantSurvivedParentSigkill:survived,
      ordinaryPidSupervisorCleanupIsNotHostContainment:true,
      cgroupMutationAttempted:false,
      realProducerOrNetworkInvoked:false,
      ...HOLD
    }));
  } finally {
    clearTimeout(timer);
    for (const rec of recorded.slice().reverse()) safeKill(rec);
    if (child) safeKill(stat(child.pid));
    await delay(80);
    if (recorded.length) assert.ok(recorded.every(r=>!alive(r)), 'synthetic cleanup incomplete');
    fs.rmSync(root,{recursive:true,force:true});
  }
}
