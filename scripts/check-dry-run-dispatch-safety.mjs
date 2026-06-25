import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/dry-run.yml", "utf8");
const source = fs.readFileSync("src/index.ts", "utf8");

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error(`[DRY_RUN_DISPATCH_SAFETY] missing ${label}`);
    process.exitCode = 1;
  }
}

assertContains(workflow, 'default: "safe_default"', "safe_default manual default");
assertContains(workflow, "confirm_live_execution:", "manual approval input");
assertContains(workflow, "expected_symbol:", "manual symbol scope input");
assertContains(workflow, 'requested = "safe_default" if raw_requested == "auto" else raw_requested', "manual auto coerces safe");
assertContains(workflow, "BROKER_MUTATION_APPROVAL", "approval env handoff");
assertContains(workflow, "BROKER_MUTATION_EXPECTED_SYMBOL", "symbol env handoff");
assertContains(source, 'const REQUIRED_BROKER_MUTATION_APPROVAL = "CONFIRM LIVE EXECUTION";', "exact approval phrase");
assertContains(source, "resolveWorkflowDispatchBrokerMutationGate", "workflow dispatch broker gate");
assertContains(source, "workflow_dispatch_approval_required", "approval required block reason");
assertContains(source, "workflow_dispatch_expected_symbol_required", "symbol required block reason");
assertContains(source, "workflow_dispatch_payload_scope_required", "single payload scope block reason");
assertContains(source, "workflow_dispatch_symbol_scope_mismatch", "symbol mismatch block reason");

if (process.exitCode) process.exit(process.exitCode);
console.log("[DRY_RUN_DISPATCH_SAFETY] pass");
