import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Intentionally accept only the existing block-style workflow shape; changes
// to export paths or shell overrides must update this security contract.
const assertWorkflowBoundary = (workflow) => {
  const steps = workflow.split(/^      - /m).slice(1).map(step => step.split(/\n {0,4}\S/)[0]);
  const uploads = steps.filter(step => /uses:\s*[\"\']?actions\/upload-artifact@/.test(step));
  const encrypted = uploads.filter(s => /^name: Upload encrypted same-run private evidence\n/.test(s));
  const expected = workflow.includes("name: sidecar-dry-run\n") ? 2 : 1;
  assert.equal((workflow.match(/actions\/upload-artifact@/g) || []).length, expected, "no additional upload syntax");
  assert.equal(uploads.length, expected);
  assert.equal(encrypted.length, expected - 1);
  for (const step of uploads) {
    assert.equal((step.match(/^\s+path:/gm) || []).length, 1);
    assert.ok(!step.includes("state/") && !step.includes("**"));
    if (encrypted.includes(step)) {
      assert.match(step, /path: \$\{\{ runner.temp \}\}\/paper-runtime-encrypted\/envelope.json\n/);
      assert.match(step, /steps.paper_binding.outcome == 'success' && steps.paper_binding.outputs.encrypted == 'true'/);
      assert.match(step, /retention-days: 1\n/);
    } else assert.match(step, /path: \$\{\{ runner.temp \}\}\/sidecar-public-evidence\/evidence.json\n/);
  }
  const shells = [...workflow.matchAll(/^\s+shell:\s*(.+)$/gm)].map(match => match[1]);
  assert.deepEqual(shells, ["bash scripts/run-private-sidecar-step.sh {0}", "bash"]);
  const publicSteps = steps.filter(step => /^\s+shell:/m.test(step));
  assert.equal(publicSteps.length, 1);
  assert.match(publicSteps[0], /^name: Publish aggregate-only sidecar evidence\n/);
  assert.match(publicSteps[0], /^        run: node scripts\/build-sidecar-public-evidence.mjs\n(?:\n|$)/m);
};
for (const name of ["dry-run", "market-guard"]) {
  const workflow = fs.readFileSync(`.github/workflows/${name}.yml`, "utf8");
  assertWorkflowBoundary(workflow);
  assert.throws(() => assertWorkflowBoundary(workflow + `
      - uses: actions/upload-artifact@v7
        with:
          path: state/order-ledger.json
`));
  assert.throws(() => assertWorkflowBoundary(workflow + `
      - uses: "actions/upload-artifact@v7"
        with:
          path: state/order-ledger.json
`));
  assert.throws(() => assertWorkflowBoundary(workflow + `
      - run: cat state/order-ledger.json
        shell: sh
`));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-sidecar-fixture-"));
const state = path.join(dir, "state");
fs.mkdirSync(state);
const secret = "PRIVATE_FIXTURE_IDENTITY_AND_ORDER";
const raw = { generatedAt: secret, rows: [{ symbol: secret, qty: 123.45 }],
  entryOrderLifecycle: { summary: { closedLoopRows: 0, terminalLedgerMismatchRows: 1 } },
  paperExitReadiness: { summary: { filledPositionRows: 11, selectedCandidateCount: 0, unknownRows: 0 } },
};
fs.writeFileSync(path.join(state, "live-readiness-scorecard.json"), JSON.stringify(raw));
fs.writeFileSync(path.join(state, "last-dry-exec-preview.json"), JSON.stringify({
  mode: { readOnly: true, execEnabled: false }, brokerSubmission: { attempted: 0, submitted: 0 },
  paperExitShadowIntent: { wouldCreateBrokerPayload: false, marketSessionEvidence: { marketOpen: true } },
  secret,
}));
const summary = path.join(dir, "summary.md");
const env = { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: secret, GITHUB_SHA: secret };
const exporter = path.resolve("scripts/build-sidecar-public-evidence.mjs");
const runExport = () => spawnSync(process.execPath, [exporter], { cwd: dir, env, encoding: "utf8" });
let result = runExport();
assert.equal(result.status, 0, result.stderr);
const output = path.join(dir, "sidecar-public-evidence/evidence.json");
const first = fs.readFileSync(output, "utf8");
const evidence = JSON.parse(first);
assert.equal(evidence.paperExit.filledPositionRows, 11);
assert.equal(evidence.paperExit.selectedCandidateCount, 0);
assert.equal(evidence.lifecycle.closedLoopRows, 0);
assert.equal(evidence.protection.positions, null, "missing report is not zero positions");
assert.deepEqual(Object.keys(evidence.sourceHashes).sort(), [
  "live-readiness-scorecard.json", "last-dry-exec-preview.json",
  "position-protection-root-cause-audit.json", "performance-dashboard-public.json",
].sort());
assert.equal(evidence.sourceHashes["position-protection-root-cause-audit.json"], null);
assert.equal(evidence.sourceHashes["performance-dashboard-public.json"], null);
assert.equal(evidence.runId, null);
assert.equal(evidence.headSha, null);
assert.ok(![first, result.stdout, result.stderr, fs.readFileSync(summary, "utf8")].join("").includes(secret));
assert.equal(runExport().status, 0);
assert.equal(fs.readFileSync(output, "utf8"), first, "deterministic aggregate");
env.GITHUB_RUN_ID = "12345"; env.GITHUB_SHA = "a".repeat(40);
const binding = { status: "PAPER_RUNTIME_PRIVATE_BINDING_ENCRYPTED", runId: env.GITHUB_RUN_ID, headSha: env.GITHUB_SHA,
  envelopeSha256: "b".repeat(64), bindingSha256: "c".repeat(64), sameRunBindingVerified: true, raw: secret };
const bindingFile = path.join(dir, "paper-runtime-binding-safe.json");
fs.writeFileSync(bindingFile, JSON.stringify(binding));
assert.equal(runExport().status, 0);
const bound = JSON.parse(fs.readFileSync(output, "utf8")).privateBinding;
assert.equal(bound.sameRunBindingVerified, true);
assert.equal(bound.executionReadinessVerified, false);
assert.equal(bound.envelopeSha256, binding.envelopeSha256);
assert.ok(!fs.readFileSync(output, "utf8").includes(secret));
fs.writeFileSync(bindingFile, JSON.stringify({ ...binding, runId: "777" }));
assert.equal(runExport().status, 0);
const mismatched = JSON.parse(fs.readFileSync(output, "utf8")).privateBinding;
assert.equal(mismatched.sameRunBindingVerified, false);
assert.equal(mismatched.status, "BINDING_INCOMPLETE");
assert.equal(mismatched.envelopeSha256, null);
assert.equal(fs.readFileSync(path.join(state, "live-readiness-scorecard.json"), "utf8"), JSON.stringify(raw));
fs.writeFileSync(path.join(state, "live-readiness-scorecard.json"), "{invalid " + secret);
assert.equal(runExport().status, 0);
assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).paperExit.filledPositionRows, null);

const wrapper = path.resolve("scripts/run-private-sidecar-step.sh");
const step = path.join(dir, "step.sh");
fs.writeFileSync(summary, "original-summary\n");
env.GITHUB_OUTPUT = path.join(dir, "output");
env.GITHUB_ENV = path.join(dir, "env");
fs.writeFileSync(step, `echo '${secret}'; echo '${secret}' >&2; echo '${secret}' >> "$GITHUB_STEP_SUMMARY"; echo 'ready=true' >> "$GITHUB_OUTPUT"; echo 'FIXTURE_READY=true' >> "$GITHUB_ENV"; exit 7\n`);
result = spawnSync("bash", [wrapper, step], { env, encoding: "utf8" });
assert.equal(result.status, 7, "failure exit code must be preserved");
assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
assert.equal(fs.readFileSync(summary, "utf8"), "original-summary\n");
assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "ready=true\n");
assert.equal(fs.readFileSync(env.GITHUB_ENV, "utf8"), "FIXTURE_READY=true\n");
fs.writeFileSync(step, "false | cat\necho unsafe-success\n");
result = spawnSync("bash", [wrapper, step], { env, encoding: "utf8" });
assert.notEqual(result.status, 0, "pipefail must be preserved");
// Issue #91: offline-only classifier returns a fixed category, never the private log.
const privateCases = [
  ["[ENV_GUARD] FAIL missing=PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "ENVIRONMENT_MISSING"],
  ["[DRY_RUN] FAIL Google token refresh failed (401): PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "DRIVE_AUTH_FAILURE"],
  ["[DRY_RUN] FAIL Drive list failed (503): PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "STAGE6_READ_FAILURE"],
  ["[TRIGGER_VALIDATE] fail stage6 hash mismatch expected=PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "STAGE6_TRIGGER_REJECTED"],
  ["[DRY_RUN] FAIL unrecognized PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "UNKNOWN"],
  ["[DRY_RUN] FAIL Google token refresh failed (401): PRIVATE_FIXTURE_IDENTITY_AND_ORDER\n[TRIGGER_VALIDATE] fail stage6 hash mismatch expected=PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "UNKNOWN"],
  ["[DRY_RUN] FAIL Drive list failed (503): PRIVATE_FIXTURE_IDENTITY_AND_ORDER\n[ENV_GUARD] FAIL missing=PRIVATE_FIXTURE_IDENTITY_AND_ORDER", "UNKNOWN"],
];
const classifier = path.resolve("scripts/classify-private-sidecar-failure.mjs");
for (const [privateLine, expectedClass] of privateCases) {
  const fixtureLog = path.join(dir, "private-classification-input.log");
  fs.writeFileSync(fixtureLog, privateLine + "\n");
  const direct = spawnSync(process.execPath, [classifier, fixtureLog], { encoding: "utf8" });
  assert.equal(direct.status, 0);
  assert.equal(direct.stdout.trim(), expectedClass);
  assert.ok(!direct.stdout.includes(secret));
  // No runtime wrapper change: classification stays offline pending admission review.
  assert.equal(fs.readFileSync(fixtureLog, "utf8"), privateLine + "\n");
  assert.ok(!direct.stderr.includes(secret));
}
const missingPrivate = spawnSync(process.execPath, [classifier, path.join(dir, "missing-private-file")], { encoding: "utf8" });
assert.equal(missingPrivate.status, 0);
assert.equal(missingPrivate.stdout.trim(), "UNKNOWN");

// STEP #91-10: supplemental N01/N02/N03/N08/N12 synthetic-only checks.
// The production wrapper and reviewed admission baseline are not modified.
const assertNoRawPublic = (run, expectedCode) => {
  assert.equal(run.status, expectedCode, 'producer exit status is unchanged');
  assert.ok(![run.stdout, run.stderr].join('').includes(secret), 'private identity leaked');
  assert.ok(![run.stdout, run.stderr].join('').includes('SYNTHETIC_PRIVATE_STACK_PATH'), 'private stack leaked');
  assert.ok(!run.stdout.includes('[SIDECAR_BOOTSTRAP_CLASS]'), 'classifier must remain offline only');
  assert.ok(run.stdout.includes('[SIDECAR_PRIVATE_STEP] exitCode=' + expectedCode + ' rawOutputPublished=false'));
};
for (const exitCode of [1, 127, 0]) {
  fs.writeFileSync(summary, 'original-summary\n');
  fs.writeFileSync(step, [
    'echo ' + JSON.stringify(secret),
    'echo ' + JSON.stringify('SYNTHETIC_PRIVATE_STACK_PATH') + ' >&2',
    'echo ' + JSON.stringify(secret) + ' >> "$GITHUB_STEP_SUMMARY"',
    'exit ' + exitCode,
    ''
  ].join('\n'));
  const syntheticEnv = { ...env, GITHUB_WORKFLOW: 'sidecar-dry-run', GITHUB_EVENT_NAME: 'workflow_dispatch', PAPER_EVIDENCE_PHASE: 'preview' };
  const run = spawnSync('bash', [wrapper, step], { env: syntheticEnv, encoding: 'utf8' });
  assertNoRawPublic(run, exitCode);
  assert.equal(fs.readFileSync(summary, 'utf8'), 'original-summary\n', 'public summary unchanged');
}
// N08: synthetic event/phase variations avoid naturally-triggered private binding hooks and do not activate a diagnostic path.
for (const [eventName, phase] of [['schedule', ''], ['repository_dispatch', ''], ['workflow_dispatch', 'preview']]) {
  fs.writeFileSync(step, 'exit 13\n');
  const run = spawnSync('bash', [wrapper, step], {
    env: { ...env, GITHUB_WORKFLOW: 'sidecar-dry-run', GITHUB_EVENT_NAME: eventName, PAPER_EVIDENCE_PHASE: phase }, encoding: 'utf8'
  });
  assertNoRawPublic(run, 13);
}
// N03: unknown, malformed, missing and over-limit log files yield only UNKNOWN.
const oversizedLog = path.join(dir, 'oversized-private.log');
fs.writeFileSync(oversizedLog, '[DRY_RUN] FAIL Google token refresh failed (401): ' + secret);
fs.truncateSync(oversizedLog, 16 * 1024 * 1024 + 1);
for (const fixture of [oversizedLog, path.join(dir, 'not-present.log')]) {
  const run = spawnSync(process.execPath, [classifier, fixture], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, 'UNKNOWN\n');
  assert.equal(run.stderr, '');
}
const malformed = path.join(dir, 'malformed-private.log');
fs.writeFileSync(malformed, secret + '\n[unrecognized stack] SYNTHETIC_PRIVATE_STACK_PATH\n');
const malformedRun = spawnSync(process.execPath, [classifier, malformed], { encoding: 'utf8' });
assert.equal(malformedRun.status, 0);
assert.equal(malformedRun.stdout, 'UNKNOWN\n');
assert.equal(malformedRun.stderr, '');

// STEP #91-11 N07 (partial): synthetic failed private-binding hooks only.
// Intercept "node" through PATH so no real binding script or provider is called.
const mockBin = path.join(dir, "binding-hook-fail-bin");
fs.mkdirSync(mockBin);
const hookCalls = path.join(dir, "synthetic-binding-hook-calls.txt");
const mockNode = path.join(mockBin, "node");
fs.writeFileSync(mockNode, [
  "#!/bin/sh",
  'if [ "$1" != "scripts/paper-runtime-private-binding.mjs" ]; then exit 97; fi',
  'printf "%s|%s|%s\n" "$2" "$3" "$4" >> "$ISSUE91_HOOK_CALLS"',
  'printf "%s\n" "PRIVATE_FIXTURE_IDENTITY_AND_ORDER" >&2',
  "exit 23",
  "",
].join("\n"), { mode: 0o700 });
for (const originalExit of [0, 19]) {
  fs.writeFileSync(hookCalls, "");
  fs.writeFileSync(summary, "original-summary\n");
  fs.writeFileSync(step, "exit " + originalExit + "\n");
  const syntheticEnv = {
    ...env,
    PATH: mockBin + path.delimiter + process.env.PATH,
    ISSUE91_HOOK_CALLS: hookCalls,
    GITHUB_WORKFLOW: "sidecar-dry-run",
    GITHUB_EVENT_NAME: "schedule",
    PAPER_EVIDENCE_PHASE: "preview",
  };
  const run = spawnSync("bash", [wrapper, step], { env: syntheticEnv, encoding: "utf8" });
  assertNoRawPublic(run, originalExit);
  assert.deepEqual(fs.readFileSync(hookCalls, "utf8").trim().split("\n"), [
    "begin|preview|",
    "finish|preview|" + originalExit,
  ], "failed mock begin and finish hooks must both be attempted");
  assert.equal(fs.readFileSync(summary, "utf8"), "original-summary\n");
  assert.ok(!run.stdout.includes("PAPER_RUNTIME_PRIVATE_BINDING_ENCRYPTED"));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log("sidecar public evidence boundary: PASS");
