import fs from "node:fs";

const STATE_DIR = String(process.env.MULTI_OCO_SUBMIT_GATE_STATE_DIR || "state").trim() || "state";
const LIMITED_PLAN_PATH = `${STATE_DIR}/limited-multi-oco-repair-plan.json`;
const OUTPUT_JSON = `${STATE_DIR}/multi-oco-submit-safety-gate.json`;
const OUTPUT_MD = `${STATE_DIR}/multi-oco-submit-safety-gate.md`;
const REQUIRED_DESIGN_APPROVAL_PHRASE = "CONFIRM MULTI SUBMIT DESIGN REVIEW";
const REQUIRED_BROKER_APPROVAL_PHRASE = "CONFIRM LIVE EXECUTION";

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = (filePath, payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
};

const short = (value, max = 320) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const asSymbol = (value) => String(value || "").trim().toUpperCase();
const uniqueSymbols = (rows) => Array.from(new Set(rows.map((row) => asSymbol(row?.symbol)).filter(Boolean))).sort();
const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const limitedPlan = readJson(LIMITED_PLAN_PATH);
const rows = Array.isArray(limitedPlan?.rows) ? limitedPlan.rows : [];
const selectedRows = rows.filter((row) => row?.selectedForApprovalBatch === true);
const eligibleRows = rows.filter((row) => row?.eligibleForLimitedBatch === true);
const designApprovalPhrase = String(process.env.MULTI_OCO_SUBMIT_DESIGN_CONFIRMATION || "").trim();
const designApprovalProvided = designApprovalPhrase === REQUIRED_DESIGN_APPROVAL_PHRASE;
const unsafeLimitedPlan =
  limitedPlan?.executionPolicy?.brokerMutationAllowed === true ||
  limitedPlan?.executionPolicy?.brokerMutationAttempted === true ||
  limitedPlan?.executionPolicy?.brokerMutationSubmitted === true ||
  limitedPlan?.summary?.brokerMutationAttempted === true ||
  limitedPlan?.summary?.brokerMutationSubmitted === true;

let overall = "multi_submit_design_forbidden";
let recommendedAction = "KEEP_REPORT_ONLY";
if (unsafeLimitedPlan) {
  overall = "blocked_unsafe_limited_plan_mutation_signal";
  recommendedAction = "STOP_AND_INSPECT_LIMITED_MULTI_PLAN";
} else if (designApprovalProvided) {
  overall = "multi_submit_design_review_authorized_report_only";
  recommendedAction = "DESIGN_REVIEW_ONLY_NO_BROKER_MUTATION";
} else if (selectedRows.length > 0) {
  overall = "blocked_multi_submit_design_approval_required";
  recommendedAction = "REQUIRE_SEPARATE_MULTI_SUBMIT_DESIGN_SAFETY_REVIEW";
}

const report = {
  generatedAt: new Date().toISOString(),
  overall,
  scope: "multi_oco_submit_safety_gate_report_only",
  executionPolicy: {
    mode: "multi_submit_safety_gate_report_only",
    targetEnvironment: "PAPER",
    brokerMutationAllowed: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAllowed: false,
    stateMutationAttempted: false,
    stateMutationApplied: false,
    multiSubmitLaneAllowed: false,
    multiSubmitLaneImplemented: false,
    dryRunMaySubmitMulti: false,
    requiredDesignApprovalPhrase: REQUIRED_DESIGN_APPROVAL_PHRASE,
    requiredBrokerApprovalPhrase: REQUIRED_BROKER_APPROVAL_PHRASE,
    designApprovalProvided,
    designApprovalUnlocksBrokerMutation: false
  },
  files: {
    limitedMultiOcoRepairPlan: Boolean(limitedPlan)
  },
  summary: {
    rows: rows.length,
    eligible: eligibleRows.length,
    selected: selectedRows.length,
    selectedSymbols: uniqueSymbols(selectedRows),
    maxRows: toNum(limitedPlan?.executionPolicy?.maxRows),
    maxQtyPerRow: toNum(limitedPlan?.executionPolicy?.maxQtyPerRow),
    designApprovalProvided,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationApplied: false,
    multiSubmitAuthorized: false
  },
  blockers: [
    "multi_submit_lane_not_implemented",
    "multi_submit_lane_not_authorized",
    "broker_mutation_requires_separate_exact_scope",
    "batch_idempotency_and_rollback_not_implemented"
  ],
  requiredBeforeAnyFutureDesign: [
    "separate design approval phrase",
    "batch idempotency ledger design",
    "per-row nested visibility precheck",
    "per-row rollback/cancel plan",
    "max batch size and max quantity policy",
    "post-submit reconciliation plan",
    "separate broker approval phrase before any actual submit"
  ],
  nextAction: recommendedAction
};

const lines = [
  "## Multi OCO Submit Safety Gate",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall}\``,
  `- summary: \`rows=${report.summary.rows} eligible=${report.summary.eligible} selected=${report.summary.selected} designApprovalProvided=${report.summary.designApprovalProvided} attempted=${report.summary.brokerMutationAttempted} submitted=${report.summary.brokerMutationSubmitted} multiAuthorized=${report.summary.multiSubmitAuthorized}\``,
  "- safety: `report-only; multi submit lane not implemented; no broker mutation; no state mutation`",
  `- selectedSymbols: \`${report.summary.selectedSymbols.join(",") || "none"}\``,
  "- blockers:"
];
for (const blocker of report.blockers) lines.push(`  - ${blocker}`);
lines.push("- requiredBeforeAnyFutureDesign:");
for (const item of report.requiredBeforeAnyFutureDesign) lines.push(`  - ${item}`);
lines.push("");

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
console.log(`[MULTI_OCO_SUBMIT_SAFETY_GATE] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${report.summary.selected} attempted=false submitted=false multiAuthorized=false`);
