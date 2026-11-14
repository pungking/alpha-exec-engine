// Issue #91 STEP #91-14B — changed-wrapper, synthetic-only N01-N08/N12.
// The real private binding module, provider, broker and network are never used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue91-changed-wrapper-"));
const bin = path.join(root, "bin");
const wrapper = path.resolve("scripts/run-private-sidecar-step.sh");
const producer = path.join(root, "producer.sh");
const summary = path.join(root, "summary.md");
const hookCalls = path.join(root, "binding.calls");
const classCalls = path.join(root, "class.calls");
const producerCalls = path.join(root, "producer.calls");
const modePath = path.join(root, "mode");
const secret = "PRIVATE_FIXTURE_IDENTITY_AND_ORDER";
const q = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
const publicExit = n => "[SIDECAR_PRIVATE_STEP] exitCode=" + n + " rawOutputPublished=false\n";
const publicClass = c => "class=" + c + " rawOutputPublished=false rootCauseVerified=false\n";

fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "node"), [
  "#!/bin/sh",
  'if [ "$1" = "scripts/paper-runtime-private-binding.mjs" ]; then',
  '  printf "%s|%s|%s\n" "$2" "$3" "$4" >> ' + q(hookCalls),
  "  printf '%s\\n' " + q(secret) + " >&2",
  "  exit 23",
  "fi",
  'if [ "$1" = "scripts/probe-private-sidecar-diagnostic.mjs" ]; then',
  "  printf 'called\\n' >> " + q(classCalls),
  '  if [ -n "$ISSUE91_UNFORWARDED_SECRET" ]; then',
  "    printf '%s\\n' " + q(secret),
  "    exit 0",
  "  fi",
  "  case \"$(cat " + q(modePath) + ")\" in",
  "    real) exec " + q(process.execPath) + ' "$@" ;;',
  "    absent-log) rm -f \"$2\"; exec " + q(process.execPath) + ' "$@" ;;',
  "    over-limit-log) truncate -s 16777217 \"$2\"; exec " + q(process.execPath) + ' "$@" ;;',
  "    valid) printf 'DRIVE_AUTH_FAILURE\\n' ;;",
  "    multi) printf 'DRIVE_AUTH_FAILURE\\n" + secret + "\\n' ;;",
  "    unknown) printf 'UNREVIEWED_CLASS\\n' ;;",
  "    no-lf) printf 'DRIVE_AUTH_FAILURE' ;;",
  "    crlf) printf 'DRIVE_AUTH_FAILURE\\r\\n' ;;",
  "    ansi) printf '\\033[31mDRIVE_AUTH_FAILURE\\n' ;;",
  "    stderr) printf 'UNKNOWN\\n'; printf '%s\\n' " + q(secret) + " >&2 ;;",
  "    nonzero) printf 'DRIVE_AUTH_FAILURE\\n'; exit 17 ;;",
  "    missing) exit 127 ;;",
  "    timeout) sleep 12 ;;",
  "    oversize) yes X | head -c 16384 ;;",
  "    *) exit 96 ;;",
  "  esac",
  "  exit 0",
  "fi",
  "exit 96",
  "",
].join("\n"), { mode: 0o700 });

function exercise(label, code, mode, privateLog, category, changes = {}) {
  for (const p of [hookCalls, classCalls, producerCalls]) fs.writeFileSync(p, "");
  fs.writeFileSync(summary, "original-summary\n");
  fs.writeFileSync(modePath, mode);
  fs.writeFileSync(producer, [
    "printf 'called\\n' >> " + q(producerCalls),
    "printf '%s\\n' " + q(privateLog),
    "printf '%s\\n' " + q("SYNTHETIC_PRIVATE_STACK_PATH") + " >&2",
    "printf '%s\\n' " + q(secret) + ' >> "$GITHUB_STEP_SUMMARY"',
    "exit " + code,
    "",
  ].join("\n"));
  const context = {
    GITHUB_WORKFLOW: "sidecar-dry-run",
    GITHUB_EVENT_NAME: "repository_dispatch",
    PAPER_EVIDENCE_PHASE: "preview",
    ...changes,
  };
  const start = Date.now();
  const run = spawnSync("bash", [wrapper, producer], {
    cwd: process.cwd(), encoding: "utf8", timeout: 8500, maxBuffer: 2048,
    env: {
      ...process.env, ...context, RUNNER_TEMP: root, GITHUB_STEP_SUMMARY: summary,
      PATH: bin + path.delimiter + process.env.PATH,
      ISSUE91_UNFORWARDED_SECRET: secret,
    },
  });
  assert.equal(run.error, undefined, label + " must terminate without wrapper timeout");
  assert.equal(run.status, code, label + " immutable producer exit");
  const expected = (category === null ? "" : publicClass(category)) + publicExit(code);
  assert.equal(run.stdout, expected, label + " exact public format");
  assert.equal(run.stderr, "", label + " no raw public stderr");
  assert.equal(fs.readFileSync(summary, "utf8"), "original-summary\n");
  assert.equal(fs.readFileSync(producerCalls, "utf8"), "called\n", "one producer");
  assert.ok(!run.stdout.includes(secret) && !run.stdout.includes("SYNTHETIC_PRIVATE_STACK_PATH"));
  const isBinding = context.GITHUB_WORKFLOW === "sidecar-dry-run" &&
    ["schedule", "repository_dispatch"].includes(context.GITHUB_EVENT_NAME) &&
    Boolean(context.PAPER_EVIDENCE_PHASE);
  const expectedHooks = isBinding ? [
    "begin|" + context.PAPER_EVIDENCE_PHASE + "|",
    "finish|" + context.PAPER_EVIDENCE_PHASE + "|" + code,
  ] : [];
  const hooks = fs.readFileSync(hookCalls, "utf8").trim().split("\n").filter(Boolean);
  assert.deepEqual(hooks, expectedHooks, label + " binding begin/finish isolation");
  assert.equal(fs.readFileSync(classCalls, "utf8"), category === null ? "" : "called\n",
    label + " classifier at most once");
  if (mode === "timeout") assert.ok(Date.now() - start < 8000, "bounded classifier");
}

try {
  const known = "[ENV_GUARD] FAIL missing=" + secret;
  for (const code of [1, 7, 127]) exercise("N01-" + code, code, "real", known, "ENVIRONMENT_MISSING");
  exercise("N02-success", 0, "real", known, null);
  exercise("N03-unknown", 13, "real", "[unknown] " + secret, "UNKNOWN");
  exercise("N03-missing-input", 13, "absent-log", known, "UNKNOWN");
  exercise("N03-over-limit-input", 13, "over-limit-log", known, "UNKNOWN");
  exercise("N04-conflict", 13, "real", known +
    "\n[DRY_RUN] FAIL Google token refresh failed (401): " + secret, "UNKNOWN");
  for (const mode of ["unknown", "multi", "no-lf", "crlf", "ansi"]) {
    exercise("N05-" + mode, 13, mode, secret, "UNKNOWN");
  }
  for (const mode of ["stderr", "nonzero", "missing", "timeout", "oversize"]) {
    exercise("N06-" + mode, 13, mode, secret, "UNKNOWN");
  }
  // N07: every permitted call above fails the *mock* binding hooks with 23.
  for (const [label, changes] of [
    ["manual", { GITHUB_EVENT_NAME: "workflow_dispatch" }],
    ["push", { GITHUB_EVENT_NAME: "push" }],
    ["other-workflow", { GITHUB_WORKFLOW: "market-guard" }],
    ["blank-phase", { PAPER_EVIDENCE_PHASE: "" }],
    ["other-phase", { PAPER_EVIDENCE_PHASE: "performance" }],
  ]) exercise("N08-" + label, 13, "multi", known, null, changes);
  // N09 must block real wrapper changes in the existing Admission gate/CI.
  // N10/N11 already covered by the unchanged Admission offline mutation tests.
  // N12 secret/stack/summary protection is asserted for all cases above.
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("issue91 changed-wrapper N01-N08/N12 offline integration: PASS");
