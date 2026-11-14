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
    const category = probeClassifier(process.execPath, [mock, mode], {
      timeoutMs: 250, maxBuffer: 1024,
    });
    assert.equal(category, expected, mode + " fail-closed");
    assert.ok(!category.includes(secret), mode + " never publishes private text");
    assert.ok(Date.now() - elapsed < 2000, mode + " bounded time");
  }
  assert.equal(probeClassifier(path.join(root, "missing-executable"), []), "UNKNOWN");
  assert.equal(probeClassifier(process.execPath, [path.join(root, "missing-script")]), "UNKNOWN");
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
