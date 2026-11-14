// Issue #91 STEP #91-14B-R1 — real probe: bounded stderr/stdout,
// missing executable, malformed output, timeout, and environment isolation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeClassifier } from "./probe-private-sidecar-diagnostic.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue91-probe-boundary-"));
const mock = path.join(root, "synthetic-classifier.mjs");
const secret = "PRIVATE_FIXTURE_IDENTITY_AND_ORDER";
fs.writeFileSync(mock, [
  "const mode = process.argv[2];",
  "switch (mode) {",
  '  case "valid": process.stdout.write("ENVIRONMENT_MISSING\\n"); break;',
  '  case "unknown": process.stdout.write("UNKNOWN\\n"); break;',
  '  case "multi": process.stdout.write("ENVIRONMENT_MISSING\\n' + secret + '\\n"); break;',
  '  case "no-lf": process.stdout.write("ENVIRONMENT_MISSING"); break;',
  '  case "crlf": process.stdout.write("ENVIRONMENT_MISSING\\r\\n"); break;',
  '  case "nul": process.stdout.write("ENVIRONMENT_MISSING\\u0000\\n"); break;',
  '  case "bad-category": process.stdout.write("UNREVIEWED_CLASS\\n"); break;',
  '  case "stderr": process.stderr.write("' + secret + '"); process.stdout.write("ENVIRONMENT_MISSING\\n"); break;',
  '  case "stderr-overflow": process.stderr.write("S".repeat(64 * 1024)); process.stdout.write("ENVIRONMENT_MISSING\\n"); break;',
  '  case "stdout-overflow": process.stdout.write("O".repeat(64 * 1024)); break;',
  '  case "nonzero": process.stdout.write("ENVIRONMENT_MISSING\\n"); process.exitCode = 23; break;',
  '  case "timeout": setInterval(() => {}, 10_000); break;',
  '  case "environment": process.stdout.write(process.env.ISSUE91_UNFORWARDED_SECRET ? "ENVIRONMENT_MISSING\\n" : "UNKNOWN\\n"); break;',
  "}",
  "",
].join("\n"));
const previous = process.env.ISSUE91_UNFORWARDED_SECRET;
process.env.ISSUE91_UNFORWARDED_SECRET = secret;
try {
  for (const [mode, expected] of [
    ["valid", "ENVIRONMENT_MISSING"],
    ["unknown", "UNKNOWN"],
    ["multi", "UNKNOWN"],
    ["no-lf", "UNKNOWN"],
    ["crlf", "UNKNOWN"],
    ["nul", "UNKNOWN"],
    ["bad-category", "UNKNOWN"],
    ["stderr", "UNKNOWN"],
    ["stderr-overflow", "UNKNOWN"],
    ["stdout-overflow", "UNKNOWN"],
    ["nonzero", "UNKNOWN"],
    ["timeout", "UNKNOWN"],
    ["environment", "UNKNOWN"],
  ]) {
    const elapsed = Date.now();
    const category = await probeClassifier(process.execPath, [mock, mode], {
      timeoutMs: 250, maxBuffer: 1024,
    });
    assert.equal(category, expected, mode + " fail-closed");
    assert.ok(!category.includes(secret), mode + " never publishes private text");
    assert.ok(Date.now() - elapsed < 2000, mode + " bounded time");
  }
  assert.equal(await probeClassifier(path.join(root, "missing-executable"), []), "UNKNOWN");
  assert.equal(await probeClassifier(process.execPath, [path.join(root, "missing-script")]), "UNKNOWN");
  // Unix process-group isolation: every direct classifier exit/failure must
  // terminate its still-running same-group descendants (not detached escapees).
  const familyScript = path.join(root, "synthetic-family.mjs");
  const childPidFile = path.join(root, "synthetic-family-child.pid");
  fs.writeFileSync(familyScript, [
    'import fs from "node:fs";',
    'import { spawn } from "node:child_process";',
    'const mode = process.argv[2];',
    'const child = spawn("sleep", ["20"], { stdio: "ignore" });',
    'fs.writeFileSync(process.argv[3], String(child.pid));',
    'if (mode === "success") {',
    '  child.unref(); process.stdout.write("ENVIRONMENT_MISSING\\n");',
    '} else if (mode === "stderr-overflow") {',
    '  process.stderr.write("S".repeat(65536));',
    '} else if (mode === "stdout-overflow") {',
    '  process.stdout.write("O".repeat(65536));',
    '} else { setInterval(() => {}, 10000); }',
    '',
  ].join("\n"));

  const descendantLive = pid => {
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
    if (process.platform !== "linux") return true;
    try {
      const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
      const state = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0];
      return state !== "Z" && state !== "X";
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };

  if (process.platform !== "win32") {
    for (const [mode, expected] of [
      ["success", "ENVIRONMENT_MISSING"],
      ["timeout", "UNKNOWN"],
      ["stderr-overflow", "UNKNOWN"],
      ["stdout-overflow", "UNKNOWN"],
    ]) {
      fs.rmSync(childPidFile, { force: true });
      const started = Date.now();
      const actual = await probeClassifier(process.execPath,
        [familyScript, mode, childPidFile], { timeoutMs: 600, maxBuffer: 1024 });
      assert.equal(actual, expected, "same-group " + mode);
      assert.ok(Date.now() - started < 2000, "bounded family " + mode);
      const childPid = Number(fs.readFileSync(childPidFile, "utf8"));
      assert.ok(Number.isSafeInteger(childPid) && childPid > 1);
      await new Promise(resolve => setTimeout(resolve, 80));
      const running = descendantLive(childPid);
      if (running) {
        try { process.kill(childPid, "SIGKILL"); } catch {}
      }
      assert.equal(running, false, "no executing descendant: " + mode);
    }
  }

  // No CLI-on-import side effects and no unexpected stderr.
  const importTest = spawnSync(process.execPath, [
    "--input-type=module", "-e",
    "import " + JSON.stringify(new URL("./probe-private-sidecar-diagnostic.mjs", import.meta.url).href),
  ], { encoding: "utf8", timeout: 1500, maxBuffer: 1024, env: {} });
  assert.equal(importTest.status, 0, "probe must be import-safe");
  assert.equal(importTest.stdout, "");
  assert.equal(importTest.stderr, "");
} finally {
  if (previous === undefined) delete process.env.ISSUE91_UNFORWARDED_SECRET;
  else process.env.ISSUE91_UNFORWARDED_SECRET = previous;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("issue91 bounded probe N03/N05/N06: PASS");
