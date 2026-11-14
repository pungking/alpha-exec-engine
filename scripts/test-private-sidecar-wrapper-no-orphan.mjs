// Issue #91 STEP #91-14B-R2 — real wrapper + real probe, synthetic classifier.
// Linux-only same-Unix-process-group no-running-descendant regression.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue91-wrapper-family-"));
const bin = path.join(root, "bin");
const wrapper = path.resolve("scripts/run-private-sidecar-step.sh");
const realProbe = path.resolve("scripts/probe-private-sidecar-diagnostic.mjs");
const copiedProbe = path.join(root, "probe-private-sidecar-diagnostic.mjs");
const fakeClassifier = path.join(root, "classify-private-sidecar-failure.mjs");
const modePath = path.join(root, "family-mode");
const childPidFile = path.join(root, "descendant.pid");
const hookCalls = path.join(root, "binding.calls");
const producer = path.join(root, "producer.sh");
const summary = path.join(root, "public-summary.md");
const secret = "ISSUE91_SYNTHETIC_PRIVATE_CANARY";
const q = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
const isRunning = pid => {
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const state = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0];
    return state !== "Z" && state !== "X";
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }
};
fs.mkdirSync(bin);
fs.copyFileSync(realProbe, copiedProbe);
fs.writeFileSync(fakeClassifier, [
  'import fs from "node:fs";',
  'import { spawn } from "node:child_process";',
  'const mode = fs.readFileSync(' + JSON.stringify(modePath) + ', "utf8").trim();',
  'const child = spawn("sleep", ["20"], { stdio: "ignore" });',
  'fs.writeFileSync(' + JSON.stringify(childPidFile) + ', String(child.pid));',
  'if (mode === "success") {',
  '  child.unref(); process.stdout.write("ENVIRONMENT_MISSING\\n");',
  '} else if (mode === "stderr-overflow") {',
  '  process.stderr.write("S".repeat(65536));',
  '} else { setInterval(() => {}, 10000); }',
  '',
].join("\n"));
fs.writeFileSync(path.join(bin, "node"), [
  "#!/bin/sh",
  'if [ "$1" = "scripts/paper-runtime-private-binding.mjs" ]; then',
  '  printf "%s|%s|%s\\n" "$2" "$3" "$4" >> ' + q(hookCalls),
  "  exit 23",
  "fi",
  'if [ "$1" = "scripts/probe-private-sidecar-diagnostic.mjs" ]; then',
  "  exec " + q(process.execPath) + " " + q(copiedProbe) + ' "$2"',
  "fi",
  "exit 96",
  "",
].join("\n"), { mode: 0o700 });
fs.writeFileSync(producer, [
  "printf '%s\\n' " + q("[ENV_GUARD] FAIL missing=" + secret),
  "exit 19",
  "",
].join("\n"));
try {
  if (process.platform !== "linux") {
    console.log("issue91 changed-wrapper Unix group test: SKIPPED (Linux-only)");
  } else {
    for (const [mode, expected] of [
      ["success", "ENVIRONMENT_MISSING"],
      ["timeout", "UNKNOWN"],
      ["stderr-overflow", "UNKNOWN"],
    ]) {
      fs.rmSync(childPidFile, { force: true });
      fs.writeFileSync(modePath, mode);
      fs.writeFileSync(hookCalls, "");
      fs.writeFileSync(summary, "original-summary\n");
      const start = Date.now();
      const run = spawnSync("bash", [wrapper, producer], {
        cwd: process.cwd(), encoding: "utf8", timeout: 7500, maxBuffer: 2048,
        env: {
          ...process.env, RUNNER_TEMP: root, GITHUB_STEP_SUMMARY: summary,
          GITHUB_WORKFLOW: "sidecar-dry-run",
          GITHUB_EVENT_NAME: "repository_dispatch",
          PAPER_EVIDENCE_PHASE: "preview",
          PATH: bin + path.delimiter + process.env.PATH,
        },
      });
      assert.equal(run.error, undefined, mode + " wrapper must terminate");
      assert.equal(run.status, 19, mode + " original producer exit");
      assert.ok(Date.now() - start < 6000, mode + " bounded wrapper");
      assert.equal(run.stdout,
        "class=" + expected + " rawOutputPublished=false rootCauseVerified=false\n" +
        "[SIDECAR_PRIVATE_STEP] exitCode=19 rawOutputPublished=false\n");
      assert.equal(run.stderr, "", mode + " no private stderr");
      assert.ok(!run.stdout.includes(secret));
      assert.equal(fs.readFileSync(summary, "utf8"), "original-summary\n");
      assert.deepEqual(fs.readFileSync(hookCalls, "utf8").trim().split("\n"), [
        "begin|preview|", "finish|preview|19",
      ]);
      const childPid = Number(fs.readFileSync(childPidFile, "utf8"));
      assert.ok(Number.isSafeInteger(childPid) && childPid > 1);
      await new Promise(resolve => setTimeout(resolve, 90));
      const live = isRunning(childPid);
      if (live) { try { process.kill(childPid, "SIGKILL"); } catch {} }
      assert.equal(live, false, mode + " must not leave executing same-group descendant");
    }
    console.log("issue91 changed-wrapper same-group no-running-descendant: PASS");
  }
} finally {
  fs.rmSync(root, { force: true, recursive: true });
}
