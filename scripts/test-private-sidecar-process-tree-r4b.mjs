// Linux synthetic process trees only; never a claim about runner-wide containment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

if (process.platform !== 'linux') {
  console.log(JSON.stringify({status:'R4B_LINUX_PROCESS_TREE_UNVERIFIED', reason:'NON_LINUX_HOST'}));
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-tree-'));
  const q = s => "'" + s.replaceAll("'", "'\\''") + "'";
  const delay = ms => new Promise(r => setTimeout(r, ms));
  function stat(pid) {
    try {
      const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      return {pid, state:fields[0], group:fields[2], session:fields[3], start:fields[19]};
    } catch (e) { if (e.code === 'ENOENT' || e.code === 'ESRCH') return null; throw e; }
  }
  const alive = record => {
    const current = stat(record.pid);
    return current && current.start === record.start && !['Z','X'].includes(current.state);
  };
  const kill = record => { if (record && alive(record)) {
    try { process.kill(record.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  } };
  const results = [];
  try {
    for (const mode of ['same-group-success','escaped-timeout','SIGTERM','SIGINT','SIGHUP','killed-probe-parent']) {
      const dir = path.join(root, mode); fs.mkdirSync(dir, {mode:0o700});
      const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
      const recordFile = path.join(dir, 'tree.json');
      const probe = path.join(dir, 'probe-private-sidecar-diagnostic.mjs');
      fs.copyFileSync('scripts/probe-private-sidecar-diagnostic.mjs', probe);
      fs.writeFileSync(path.join(dir, 'classify-private-sidecar-failure.mjs'), `
        import fs from 'node:fs'; import {spawn} from 'node:child_process';
        const child = spawn(process.execPath, ['-e','setTimeout(()=>{},8000)'],
          {detached:${mode === 'escaped-timeout'}, stdio:'ignore', env:{}});
        const read = pid => { const f=fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ');
          return {pid,state:f[0],group:f[2],session:f[3],start:f[19]}; };
        fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify([read(process.ppid),read(process.pid),read(child.pid)]));
        if (${mode === 'same-group-success'}) {child.unref();process.stdout.write('ENVIRONMENT_MISSING\\n');}
        else setTimeout(()=>{},8000);
      `);
      fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh
        if [ "$1" = scripts/paper-runtime-private-binding.mjs ]; then exit 23; fi
        if [ "$1" = scripts/probe-private-sidecar-diagnostic.mjs ]; then exec ${q(process.execPath)} ${q(probe)} "$2"; fi
        exit 96
      `, {mode:0o700});
      const producer = path.join(dir, 'producer.sh');
      fs.writeFileSync(producer, "printf '[ENV_GUARD] FAIL missing=SYNTHETIC_PRIVATE_CANARY\\n'; exit 19\n");
      const started = Date.now();
      const wrapper = spawn('bash', [path.resolve('scripts/run-private-sidecar-step.sh'), producer], {
        cwd:process.cwd(), stdio:['ignore','pipe','pipe'], env:{
          PATH:bin+':'+process.env.PATH, RUNNER_TEMP:dir, GITHUB_WORKFLOW:'sidecar-dry-run',
          GITHUB_EVENT_NAME:'repository_dispatch', PAPER_EVIDENCE_PHASE:'preview',
          ALPHA_ENV:'PAPER', READ_ONLY:'true', EXEC_ENABLED:'false',
          LIVE_ORDER_SUBMIT_ENABLED:'false', MARKET_GUARD_MODE:'observe'
        }
      });
      let stdout = '', stderr = '', records = [];
      const wrapperRecord = stat(wrapper.pid);
      const finished = new Promise((resolve,reject) => {
        wrapper.on('error', reject); wrapper.on('close', (code,signal) => resolve({code,signal}));
      });
      wrapper.stdout.on('data', b => { stdout += b; if (stdout.length > 2048) kill(wrapperRecord); });
      wrapper.stderr.on('data', b => { stderr += b; if (stderr.length > 2048) kill(wrapperRecord); });
      let deadline;
      try {
        const timeout = new Promise((_,reject) => { deadline = setTimeout(() => {
          kill(wrapperRecord); reject(Error('SYNTHETIC_CASE_DEADLINE'));
        }, 7000); });
        await Promise.race([(async () => {
          while (!fs.existsSync(recordFile)) { assert.ok(Date.now()-started < 3000, 'tree readiness'); await delay(10); }
          records = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
          if (mode.startsWith('SIG')) process.kill(records[0].pid, mode);
          if (mode === 'killed-probe-parent') kill(records[0]);
          const result = await finished;
          assert.deepEqual(result, {code:19,signal:null}, 'original producer exit preserved');
          assert.equal(stderr, '', 'no public private diagnostics');
          const expected = mode === 'same-group-success' ? 'ENVIRONMENT_MISSING' : 'UNKNOWN';
          assert.equal(stdout, `class=${expected} rawOutputPublished=false rootCauseVerified=false\n[SIDECAR_PRIVATE_STEP] exitCode=19 rawOutputPublished=false\n`);
          assert.ok(Date.now()-started < 6500, 'bounded wrapper completion');
          await delay(80);
          const survivor = Boolean(alive(records[2]));
          const escape = mode === 'escaped-timeout';
          assert.equal(records[1].group === records[2].group, !escape);
          assert.equal(records[1].session === records[2].session, !escape);
          assert.equal(survivor, escape || mode === 'killed-probe-parent');
          results.push({mode, producerExit:result.code, category:expected,
            descendantSurvived:survivor, status:survivor?'DEMONSTRATED_CONTAINMENT_LIMIT':'TESTED_SAME_GROUP_CLEANUP'});
        })(), timeout]);
      } finally {
        clearTimeout(deadline);
        if (!records.length && fs.existsSync(recordFile)) records = JSON.parse(fs.readFileSync(recordFile,'utf8'));
        for (const record of records.reverse()) kill(record);
        kill(wrapperRecord);
        await finished;
        await delay(80);
        assert.ok(records.every(r => !alive(r)), 'supervisor cleanup of exact synthetic processes');
      }
    }
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
  console.log(JSON.stringify({status:'R4B_LINUX_PROCESS_EVIDENCE_COLLECTED', results,
    hostWideNoOrphan:'UNVERIFIED', processIdentity:'PID_AND_PROC_STARTTIME', supervisorCleanup:true}));
}
