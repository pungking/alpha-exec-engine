import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAggregateSafeEvidence,
  initializeSafeEvidence,
  preflightSafeEvidence,
} from "./build-paper-five-row-broker-evidence-safe.mjs";

const workflow = fs.readFileSync(".github/workflows/dry-run.yml", "utf8");
const watchdogWorkflow = fs.readFileSync(".github/workflows/dry-run-watchdog.yml", "utf8");
const marketGuardWorkflow = fs.readFileSync(".github/workflows/market-guard.yml", "utf8");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const paperOcoWorkflow = fs.readFileSync(".github/workflows/paper-oco-submit-canary.yml", "utf8");
const persistentRepairWorkflow = fs.readFileSync(".github/workflows/persistent-oco-repair-submit.yml", "utf8");
const fiveRowRecoveryWorkflowPath = ".github/workflows/paper-five-row-broker-evidence-recovery.yml";
const fiveRowRecoveryWorkflow = fs.existsSync(fiveRowRecoveryWorkflowPath)
  ? fs.readFileSync(fiveRowRecoveryWorkflowPath, "utf8")
  : "";
const fiveRowSafeEvidenceSource = fs.readFileSync("scripts/build-paper-five-row-broker-evidence-safe.mjs", "utf8");
const source = fs.readFileSync("src/index.ts", "utf8");

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] missing ${label}`);
    process.exitCode = 1;
  }
}

function assertJobEnvEquals(text, key, expected, label) {
  const match = text.match(new RegExp(`^\\s{6}${key}:\\s*(.+)$`, "m"));
  if (!match) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] missing ${label}`);
    process.exitCode = 1;
    return;
  }
  const actual = match[1].trim();
  if (actual !== expected) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] ${label} expected=${expected} actual=${actual}`);
    process.exitCode = 1;
  }
  if (actual.includes("vars.") || actual.includes("github.event.client_payload")) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] ${label} must not inherit repository variables or dispatch payload`);
    process.exitCode = 1;
  }
}

const automaticSafeFixture = {
  ALPHA_ENV: "DRY_RUN",
  EXEC_ENABLED: '"false"',
  READ_ONLY: '"true"',
  SIMULATION_LIVE_PARITY: '"false"',
  MARKET_GUARD_MODE: "observe",
  LIVE_ORDER_SUBMIT_ENABLED: '"false"',
};

for (const [key, expected] of Object.entries(automaticSafeFixture)) {
  assertJobEnvEquals(workflow, key, expected, `dry-run automatic ${key}`);
}
assertJobEnvEquals(
  workflow,
  "FORCE_SEND_ONCE",
  "${{ github.event_name == 'workflow_dispatch' && inputs.run_force_send_once || 'false' }}",
  "dry-run automatic FORCE_SEND_ONCE",
);
assertJobEnvEquals(workflow, "GUARD_EXECUTE_TIGHTEN_STOPS", '"false"', "dry-run automatic tighten stops");
assertJobEnvEquals(workflow, "GUARD_EXECUTE_REDUCE_POSITIONS", '"false"', "dry-run automatic reduce positions");
assertJobEnvEquals(workflow, "GUARD_EXECUTE_FLATTEN", '"false"', "dry-run automatic flatten");
assertJobEnvEquals(workflow, "ORDER_LIFECYCLE_ENABLED", '"false"', "dry-run automatic order ledger mutation");

for (const [key, expected] of Object.entries({
  ALPHA_ENV: "DRY_RUN",
  EXEC_ENABLED: '"false"',
  READ_ONLY: '"true"',
  MARKET_GUARD_MODE: "observe",
  MARKET_GUARD_FORCE_SEND_ONCE: '"false"',
  GUARD_EXECUTE_TIGHTEN_STOPS: '"false"',
  GUARD_EXECUTE_REDUCE_POSITIONS: '"false"',
  GUARD_EXECUTE_FLATTEN: '"false"',
})) {
  assertJobEnvEquals(marketGuardWorkflow, key, expected, `market-guard automatic ${key}`);
}

assertContains(workflow, 'default: "safe_default"', "safe_default manual default");
assertContains(workflow, 'requested = "safe_default" if raw_requested == "auto" else raw_requested', "manual auto coerces safe");
assertContains(watchdogWorkflow, 'const targetWorkflow = "dry-run.yml";', "watchdog fixed dry-run target");
assertContains(
  watchdogWorkflow,
  'const refBranch = context.payload.repository?.default_branch || "main";',
  "watchdog default-branch target",
);
if (watchdogWorkflow.includes("WATCHDOG_TARGET_WORKFLOW") || watchdogWorkflow.includes("WATCHDOG_TARGET_BRANCH")) {
  console.error("[DRY_RUN_DISPATCH_SAFETY] watchdog target must not inherit repository variables");
  process.exitCode = 1;
}
if (/gh workflow run[\s\S]{0,240}\s-f\s/.test(watchdogWorkflow)) {
  console.error("[DRY_RUN_DISPATCH_SAFETY] watchdog fallback must not override workflow_dispatch inputs");
  process.exitCode = 1;
}
assertContains(workflow, "BROKER_MUTATION_APPROVAL: ''", "dry-run approval hard disabled");
assertContains(workflow, "BROKER_MUTATION_EXPECTED_SYMBOL: ''", "dry-run symbol scope hard disabled");
assertContains(source, 'const REQUIRED_BROKER_MUTATION_APPROVAL = "CONFIRM LIVE EXECUTION";', "exact approval phrase");
assertContains(source, "resolveWorkflowDispatchBrokerMutationGate", "workflow dispatch broker gate");
assertContains(source, "automatic_trigger_broker_mutation_forbidden", "automatic broker mutation block");
assertContains(source, "workflow_dispatch_approval_required", "approval required block reason");
assertContains(source, "workflow_dispatch_paper_environment_required", "paper-only environment block reason");
assertContains(source, "workflow_dispatch_expected_symbol_required", "symbol required block reason");
assertContains(source, "workflow_dispatch_payload_scope_required", "single payload scope block reason");
assertContains(source, "workflow_dispatch_symbol_scope_mismatch", "symbol mismatch block reason");
assertContains(source, "if (existing && entryResetDaily && persistEffective)", "non-persistent idempotency daily reset guard");
assertContains(ciWorkflow, "npm run ops:test:dry-run-dispatch-safety", "CI automatic safety contract");
assertContains(paperOcoWorkflow, "ALPHA_ENV: PAPER", "paper OCO explicit PAPER environment");
assertContains(paperOcoWorkflow, '!= "CONFIRM LIVE EXECUTION"', "paper OCO exact approval phrase");
assertContains(persistentRepairWorkflow, "ALPHA_ENV: PAPER", "persistent repair explicit PAPER environment");
assertContains(persistentRepairWorkflow, '!= "CONFIRM LIVE EXECUTION"', "persistent repair exact approval phrase");

assertContains(fiveRowRecoveryWorkflow, "workflow_dispatch:", "five-row recovery manual trigger");
assertContains(
  fiveRowRecoveryWorkflow,
  "AUTHORIZE PAPER FIVE-ROW BROKER EVIDENCE READ-ONLY ONE-SHOT",
  "five-row recovery exact approval phrase",
);
assertContains(fiveRowRecoveryWorkflow, "fetch-depth: 0", "five-row recovery full ancestry checkout");
assertContains(fiveRowRecoveryWorkflow, 'test "${GITHUB_REF_NAME}" = "main"', "five-row recovery main-only guard");
assertContains(
  fiveRowRecoveryWorkflow,
  "git merge-base --is-ancestor 7a5c664665342eebb8a0f19fbf24379efc47ab2b HEAD",
  "five-row recovery required ancestor guard",
);
assertContains(
  fiveRowRecoveryWorkflow,
  "sidecar-state-main-32742503181",
  "five-row recovery exact cache key",
);
assertContains(fiveRowRecoveryWorkflow, "fail-on-cache-miss: true", "five-row recovery cache miss block");
assertContains(fiveRowSafeEvidenceSource, "targetRows !== 5", "five-row recovery exact scope gate");
assertContains(
  fiveRowRecoveryWorkflow,
  "BROKER_FILL_STATE_EVIDENCE_STATE_DIR: ${{ runner.temp }}/paper-five-row-state",
  "five-row recovery private temp output",
);
assertContains(
  fiveRowRecoveryWorkflow,
  "safe-output/paper-five-row-broker-evidence-safe.json",
  "five-row recovery aggregate-only artifact",
);
assertContains(fiveRowSafeEvidenceSource, "privateEvidenceUploaded: false", "five-row recovery private upload block");
assertContains(fiveRowSafeEvidenceSource, "stateMutationAttempted: false", "five-row recovery state mutation block");
assertContains(fiveRowSafeEvidenceSource, "brokerMutationAttempted: false", "five-row recovery broker mutation block");
for (const forbidden of [
  "restore-keys:",
  "actions/cache/save",
  "ledger-filled-migration-apply",
  "submitOrdersToBroker",
  "broker-fill-state-evidence.md\n",
]) {
  if (fiveRowRecoveryWorkflow.includes(forbidden)) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] five-row recovery contains forbidden contract: ${forbidden.trim()}`);
    process.exitCode = 1;
  }
}
for (const forbiddenTrigger of ["push:", "pull_request:", "schedule:", "repository_dispatch:"]) {
  if (fiveRowRecoveryWorkflow.includes(forbiddenTrigger)) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] five-row recovery must not use trigger: ${forbiddenTrigger}`);
    process.exitCode = 1;
  }
}

const safeFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-five-row-safe-"));
const safeFixtureOutput = path.join(safeFixtureDir, "safe.json");
const safeFixturePreflight = path.join(safeFixtureDir, "preflight.json");
fs.writeFileSync(
  path.join(safeFixtureDir, "fill-state-reconciliation-audit.json"),
  JSON.stringify({ rows: Array.from({ length: 5 }, (_, index) => ({
    symbol: `PRIVATE_${index}`,
    ledger: { key: `PRIVATE_LEDGER_${index}` },
    requiresLedgerTerminalizationReview: true,
  })) }),
);
fs.writeFileSync(path.join(safeFixtureDir, "order-ledger.json"), JSON.stringify({ orders: {} }));
fs.writeFileSync(path.join(safeFixtureDir, "order-idempotency.json"), JSON.stringify({ orders: {} }));
initializeSafeEvidence({ safeOutput: safeFixtureOutput });
const safeFixturePreflightResult = preflightSafeEvidence({
  stateDir: safeFixtureDir,
  safeOutput: safeFixtureOutput,
  preflightFile: safeFixturePreflight,
  cacheHit: true,
});
assert.equal(safeFixturePreflightResult.targetRows, 5);
assert.equal(safeFixturePreflightResult.uniqueIdentityRows, 5);
fs.writeFileSync(
  path.join(safeFixtureDir, "broker-fill-state-evidence.json"),
  JSON.stringify({
    executionPolicy: { stateMutationAttempted: false, brokerMutationAttempted: false },
    rows: Array.from({ length: 5 }, (_, index) => ({
      symbol: `PRIVATE_${index}`,
      clientOrderId: `PRIVATE_CLIENT_${index}`,
      brokerPosition: index === 0 ? { qty: "1" } : null,
      evidenceVerdict: index === 0 ? "BROKER_FILLED_CONFIRMED" : "BROKER_EVIDENCE_INCONCLUSIVE",
      readStatus: {
        position: { status: index === 1 ? 404 : 200 },
        openOrders: { count: 0 },
      },
    })),
  }),
);
const safeFixtureAggregate = buildAggregateSafeEvidence({
  stateDir: safeFixtureDir,
  safeOutput: safeFixtureOutput,
  preflightFile: safeFixturePreflight,
  brokerStepOutcome: "success",
});
assert.equal(safeFixtureAggregate.status, "PAPER_FIVE_ROW_BROKER_EVIDENCE_AGGREGATE_READY");
assert.equal(safeFixtureAggregate.targetRows, 5);
assert.equal(safeFixtureAggregate.brokerGetRequestCount, 25);
assert.equal(safeFixtureAggregate.activePositionRows, 1);
assert.equal(safeFixtureAggregate.zeroOrNotFoundPositionRows, 1);
assert.equal(safeFixtureAggregate.unknownOrUnclassifiedRows, 0);
const safeFixtureText = fs.readFileSync(safeFixtureOutput, "utf8");
assert.equal(safeFixtureText.includes("PRIVATE_"), false);
assert.equal(safeFixtureText.includes("clientOrderId"), false);

if (process.exitCode) process.exit(process.exitCode);
console.log("[DRY_RUN_DISPATCH_SAFETY] pass");
