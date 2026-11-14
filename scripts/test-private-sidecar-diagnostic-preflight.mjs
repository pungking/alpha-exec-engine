// Issue #91 STEP #91-12: TEST-ONLY candidate for future diagnostic admission.
// Deliberately not imported by scripts/run-private-sidecar-step.sh or workflows.
// Neither a deployment-ready wrapper nor evidence of live classifier integration.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ALLOWED = new Set([
  "ENVIRONMENT_MISSING", "DRIVE_AUTH_FAILURE", "STAGE6_READ_FAILURE",
  "STAGE6_TRIGGER_REJECTED", "UNKNOWN",
]);
const SYNTHETIC_SECRET = "PRIVATE_FIXTURE_TOKEN_AND_ORDER_91_12";
const EXPECTED_PUBLIC = (value) =>
  "class=" + value + " rawOutputPublished=false rootCauseVerified=false\n";

// N05: only one exact enum line with terminal LF is accepted.
function candidateSanitize(stdout) {
  if (typeof stdout !== "string" || !stdout.endsWith("\n")) return "UNKNOWN";
  const candidate = stdout.slice(0, -1);
  return ALLOWED.has(candidate) ? candidate : "UNKNOWN";
}

// N06: single-attempt, time and output bounded local subprocess invocation.
// TEST-ONLY: This function is not called from any production wrapper.
function candidateProbe(producerExit, command, args = [], environment = {}) {
  const child = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 2500,
    maxBuffer: 1024,
    windowsHide: true,
  });
  const category = child.error || child.signal || child.status !== 0
    ? "UNKNOWN" : candidateSanitize(child.stdout);
  return { producerExit, publicLine:
    "class=" + category + " rawOutputPublished=false rootCauseVerified=false\n" };
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue91-n05-n06-preflight-"));
const fixtureScript = path.join(directory, "fake-classifier.mjs");
const callLog = path.join(directory, "fake-classifier-calls.txt");
fs.writeFileSync(fixtureScript, [
  'import fs from "node:fs";',
  'fs.appendFileSync(process.env.ISSUE91_PROBE_CALL_LOG, "called\\n");',
  'const secret = "PRIVATE_FIXTURE_TOKEN_AND_ORDER_91_12";',
  'switch (process.argv[2]) {',
  '  case "valid": process.stdout.write("STAGE6_READ_FAILURE\\n"); break;',
  '  case "unknown": process.stdout.write("UNKNOWN\\n"); break;',
  '  case "invalid": process.stdout.write("ARBITRARY_UNKNOWN_CODE\\n"); break;',
  '  case "newline": process.stdout.write("STAGE6_READ_FAILURE\\n" + secret + "\\n"); break;',
  '  case "no-newline": process.stdout.write("STAGE6_READ_FAILURE"); break;',
  '  case "crlf": process.stdout.write("STAGE6_READ_FAILURE\\r\\n"); break;',
  '  case "ansi": process.stdout.write("\\x1b[31mSTAGE6_READ_FAILURE\\n"); break;',
  '  case "embedded-nul": process.stdout.write("STAGE6_READ_FAILURE\\x00\\n"); break;',
  '  case "stderr": process.stderr.write(secret); process.stdout.write("ENVIRONMENT_MISSING\\n"); break;',
  '  case "nonzero": process.stdout.write("ENVIRONMENT_MISSING\\n"); process.exitCode = 17; break;',
  '  case "oversize": process.stdout.write("Z".repeat(16 * 1024)); break;',
  '  case "timeout": setInterval(() => {}, 10000); break;',
  '  default: process.stdout.write(secret + "\\n"); break;',
  '}',
].join("\n"));

try {
  for (const [caseName, expected] of [
    ["valid", "STAGE6_READ_FAILURE"], ["unknown", "UNKNOWN"],
    ["invalid", "UNKNOWN"], ["newline", "UNKNOWN"],
    ["no-newline", "UNKNOWN"], ["crlf", "UNKNOWN"],
    ["ansi", "UNKNOWN"], ["embedded-nul", "UNKNOWN"],
    ["stderr", "ENVIRONMENT_MISSING"], ["nonzero", "UNKNOWN"],
    ["oversize", "UNKNOWN"], ["timeout", "UNKNOWN"],
  ]) {
    for (const producerExit of caseName === "timeout" ? [37] : [0, 37]) {
      fs.writeFileSync(callLog, "");
      const result = candidateProbe(
        producerExit, process.execPath, [fixtureScript, caseName],
        { ISSUE91_PROBE_CALL_LOG: callLog },
      );
      assert.equal(result.producerExit, producerExit, "producer exit must be immutable");
      assert.equal(result.publicLine,
        "class=" + expected + " rawOutputPublished=false rootCauseVerified=false\n",
        caseName);
      assert.ok(!result.publicLine.includes(SYNTHETIC_SECRET));
      assert.equal(fs.readFileSync(callLog, "utf8"), "called\n", "exactly one classifier call");
    }
  }
  // Executable not present: fail closed without changing the producer exit.
  for (const producerExit of [0, 37]) {
    const result = candidateProbe(producerExit, path.join(directory, "missing-classifier"));
    assert.equal(result.producerExit, producerExit);
    assert.equal(result.publicLine,
      "class=UNKNOWN rawOutputPublished=false rootCauseVerified=false\n");
  }
  for (const unsafe of [
    null, undefined, "", 1, "ENVIRONMENT_MISSING",
    "ENVIRONMENT_MISSING\n\n", " ENVIRONMENT_MISSING\n",
    "ENVIRONMENT_MISSING \n", "ENVIRONMENT_MISSING\n" + SYNTHETIC_SECRET,
    "ENVIRONMENT_MISSING\r\n", "ENVIRONMENT_MISSING\u0000\n",
  ]) assert.equal(candidateSanitize(unsafe), "UNKNOWN");
  assert.equal(candidateSanitize("ENVIRONMENT_MISSING\n"), "ENVIRONMENT_MISSING");
  assert.equal(candidateSanitize("UNKNOWN\n"), "UNKNOWN");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log("issue91 N05/N06 offline candidate pre-admission: PASS (not runtime)");
