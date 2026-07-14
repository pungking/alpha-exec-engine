import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/dry-run.yml", "utf8");
const marketGuardWorkflow = fs.readFileSync(".github/workflows/market-guard.yml", "utf8");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const paperOcoWorkflow = fs.readFileSync(".github/workflows/paper-oco-submit-canary.yml", "utf8");
const persistentRepairWorkflow = fs.readFileSync(".github/workflows/persistent-oco-repair-submit.yml", "utf8");
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

if (process.exitCode) process.exit(process.exitCode);
console.log("[DRY_RUN_DISPATCH_SAFETY] pass");
