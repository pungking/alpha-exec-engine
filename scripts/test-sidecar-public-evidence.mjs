import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Intentionally accept only the existing block-style workflow shape; changes
// to export paths or shell overrides must update this security contract.
const assertWorkflowBoundary = (workflow) => {
  const steps = workflow.split(/^      - /m).slice(1).map(step => step.split(/\n {0,4}\S/)[0]);
  assert.equal((workflow.match(/actions\/upload-artifact@/g) || []).length, 1, "no additional upload syntax");
  const uploads = steps.filter(step => /uses:\s*[\"\']?actions\/upload-artifact@/.test(step));
  assert.equal(uploads.length, 1, "exactly one public artifact export");
  assert.match(uploads[0], /path: \$\{\{ runner.temp \}\}\/sidecar-public-evidence\/evidence.json\n/);
  assert.equal((uploads[0].match(/^\s+path:/gm) || []).length, 1);
  assert.ok(!uploads[0].includes("state/") && !uploads[0].includes("**"));
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
fs.rmSync(dir, { recursive: true, force: true });
console.log("sidecar public evidence boundary: PASS");
