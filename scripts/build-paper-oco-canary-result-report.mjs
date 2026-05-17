import fs from "node:fs";

const STATE_DIR = String(process.env.PAPER_OCO_RESULT_STATE_DIR || process.env.PAPER_OCO_SUBMIT_STATE_DIR || "state").trim() || "state";
const SUBMIT_GATE_PATH = `${STATE_DIR}/paper-oco-canary-submit-gate.json`;
const LEDGER_PATH = `${STATE_DIR}/paper-oco-canary-submit-ledger.json`;
const OUTPUT_JSON = `${STATE_DIR}/paper-oco-canary-result-report.json`;
const OUTPUT_MD = `${STATE_DIR}/paper-oco-canary-result-report.md`;

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = (path, value) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
};

const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

const addCheck = (checks, id, status, detail) => checks.push({ id, status, detail: short(detail, 360) });

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Paper OCO Canary Result");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- sourceOverall: \`${report.source?.submitGateOverall || "N/A"}\``);
  lines.push(`- selected: \`${report.selected?.symbol || "N/A"} qty=${report.selected?.qty ?? "N/A"}\``);
  lines.push(`- brokerMutation: \`attempted=${report.brokerMutation.attempted} submitted=${report.brokerMutation.submitted} status=${report.brokerMutation.status ?? "N/A"}\``);
  lines.push(`- visibility: \`ok=${report.visibility.ok} stop=${report.visibility.stopCount ?? "N/A"} target=${report.visibility.targetCount ?? "N/A"}\``);
  lines.push(`- rollback: \`attempted=${report.rollback.attempted} ok=${report.rollback.ok} terminal=${report.rollback.terminalVerified}\``);
  lines.push(`- ledger: \`status=${report.idempotency.status || "N/A"} terminal=${report.idempotency.terminal}\``);
  lines.push("- checks:");
  for (const check of report.checks) lines.push(`  - [${check.status}] ${check.id}: ${short(check.detail, 220)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const submitGate = readJson(SUBMIT_GATE_PATH);
const ledger = readJson(LEDGER_PATH) || { entries: {} };
const idempotencyKey = submitGate?.idempotency?.key || null;
const ledgerEntry = idempotencyKey ? ledger?.entries?.[idempotencyKey] || null : null;
const checks = [];

addCheck(checks, "submit_gate_present", submitGate ? "PASS" : "FAIL", submitGate ? SUBMIT_GATE_PATH : "missing paper-oco-canary-submit-gate.json");
addCheck(checks, "broker_mutation_attempted", submitGate?.summary?.brokerMutationAttempted === true ? "PASS" : "FAIL", `attempted=${submitGate?.summary?.brokerMutationAttempted ?? "N/A"}`);
addCheck(checks, "broker_mutation_submitted", submitGate?.summary?.brokerMutationSubmitted === true ? "PASS" : "FAIL", `submitted=${submitGate?.summary?.brokerMutationSubmitted ?? "N/A"}`);
addCheck(checks, "post_submit_nested_visibility", submitGate?.postSubmitVisibility?.ok === true ? "PASS" : "FAIL", `ok=${submitGate?.postSubmitVisibility?.ok ?? "N/A"}`);
addCheck(checks, "rollback_cancel_ok", submitGate?.rollback?.ok === true ? "PASS" : "FAIL", `ok=${submitGate?.rollback?.ok ?? "N/A"} status=${submitGate?.rollback?.status ?? "N/A"}`);
addCheck(checks, "rollback_terminal_verified", submitGate?.rollback?.terminalVerified === true ? "PASS" : "FAIL", `terminal=${submitGate?.rollback?.terminalVerified ?? "N/A"}`);
addCheck(checks, "idempotency_ledger_terminal", ledgerEntry?.terminal === true ? "PASS" : "FAIL", `status=${ledgerEntry?.status || "N/A"} terminal=${ledgerEntry?.terminal ?? "N/A"}`);
addCheck(checks, "one_row_qty_one", submitGate?.selected?.canaryQty === 1 ? "PASS" : "FAIL", `qty=${submitGate?.selected?.canaryQty ?? "N/A"}`);

const failCount = checks.filter((row) => row.status === "FAIL").length;
const overall = failCount > 0 ? "fail" : "pass";
const report = {
  generatedAt: nowIso(),
  overall,
  source: {
    submitGatePath: SUBMIT_GATE_PATH,
    ledgerPath: LEDGER_PATH,
    submitGateOverall: submitGate?.overall || null,
    decision: submitGate?.decision?.status || null
  },
  selected: {
    symbol: submitGate?.summary?.selectedSymbol || submitGate?.selected?.symbol || null,
    qty: submitGate?.selected?.canaryQty ?? null,
    clientOrderId: submitGate?.summary?.clientOrderId || null
  },
  brokerMutation: {
    attempted: submitGate?.summary?.brokerMutationAttempted === true,
    submitted: submitGate?.summary?.brokerMutationSubmitted === true,
    status: submitGate?.brokerMutation?.status ?? null
  },
  visibility: {
    ok: submitGate?.postSubmitVisibility?.ok === true,
    stopCount: submitGate?.postSubmitVisibility?.protection?.stopOrderCount ?? null,
    targetCount: submitGate?.postSubmitVisibility?.protection?.targetOrderCount ?? null
  },
  rollback: {
    attempted: submitGate?.rollback?.attempted === true,
    ok: submitGate?.rollback?.ok === true,
    status: submitGate?.rollback?.status ?? null,
    terminalVerified: submitGate?.rollback?.terminalVerified === true
  },
  idempotency: {
    key: idempotencyKey,
    status: ledgerEntry?.status || null,
    terminal: ledgerEntry?.terminal === true,
    historyLength: Array.isArray(ledgerEntry?.history) ? ledgerEntry.history.length : 0
  },
  checks,
  summary: {
    passCount: checks.length - failCount,
    failCount
  }
};

writeJson(OUTPUT_JSON, report);
fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
console.log(`[PAPER_OCO_CANARY_RESULT] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} selected=${report.selected.symbol || "none"}`);
if (overall !== "pass") process.exitCode = 1;
