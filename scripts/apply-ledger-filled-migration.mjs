import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.LEDGER_FILLED_MIGRATION_APPLY_STATE_DIR || process.env.LEDGER_FILLED_MIGRATION_STATE_DIR || "state").trim() || "state";
const APPLY_REQUESTED = String(process.env.LEDGER_FILLED_MIGRATION_APPLY || "false").trim().toLowerCase() === "true";
const APPROVAL = String(process.env.LEDGER_FILLED_MIGRATION_APPROVAL || "").trim();
const REQUIRED_APPROVAL = "CONFIRM STATE LEDGER MIGRATION";
const SYMBOL_FILTER = String(process.env.LEDGER_FILLED_MIGRATION_SYMBOLS || "")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const MAX_ROWS = Number(process.env.LEDGER_FILLED_MIGRATION_MAX_ROWS || "1");

const FILES = {
  plan: `${STATE_DIR}/ledger-filled-migration-plan.json`,
  orderLedger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`,
  outputJson: `${STATE_DIR}/ledger-filled-migration-apply-report.json`,
  outputMd: `${STATE_DIR}/ledger-filled-migration-apply-report.md`
};

const asSymbol = (value) => String(value || "").trim().toUpperCase();
const short = (value, max = 260) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const sha256 = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
const readText = (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null);
const readJson = (filePath) => {
  const text = readText(filePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const writeJsonAtomic = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(tmpPath, "utf8"));
  fs.renameSync(tmpPath, filePath);
};
const writeTextAtomic = (filePath, text) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
};
const fileMeta = (filePath) => {
  const text = readText(filePath);
  if (text == null) return { exists: false, path: filePath, bytes: 0, sha256: null };
  return { exists: true, path: filePath, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
};
const count = (rows, predicate) => rows.filter(predicate).length;

const buildRow = ({ planRow, orderLedger, idempotency, generatedAt }) => {
  const symbol = asSymbol(planRow?.symbol);
  const ledgerKey = planRow?.keys?.ledgerKey || planRow?.diffPreview?.orderLedger?.key || null;
  const idempotencyKey = planRow?.keys?.idempotencyKey || planRow?.diffPreview?.orderIdempotency?.key || null;
  const ledgerCurrent = ledgerKey ? orderLedger?.orders?.[ledgerKey] : null;
  const idempotencyCurrent = idempotencyKey ? idempotency?.orders?.[idempotencyKey] : null;
  const ledgerAfterPatch = planRow?.diffPreview?.orderLedger?.after || null;
  const idempotencyAfterPatch = planRow?.diffPreview?.orderIdempotency?.after || null;
  const gates = [];
  const addGate = (id, pass, detail) => gates.push({ id, status: pass ? "PASS" : "BLOCK", detail: short(detail, 360) });

  addGate("plan_row_ready", planRow?.readyForApplyReview === true, `readyForApplyReview=${planRow?.readyForApplyReview ?? "N/A"}`);
  addGate("filled_state_only", String(planRow?.proposedTerminalState || "").toLowerCase() === "filled", `proposedTerminalState=${planRow?.proposedTerminalState || "N/A"}`);
  addGate("broker_filled_evidence", planRow?.brokerEvidenceVerdict === "BROKER_FILLED_CONFIRMED", `brokerEvidenceVerdict=${planRow?.brokerEvidenceVerdict || "N/A"}`);
  addGate("ledger_key_present", Boolean(ledgerKey), `ledgerKey=${ledgerKey || "N/A"}`);
  addGate("idempotency_key_present", Boolean(idempotencyKey), `idempotencyKey=${idempotencyKey || "N/A"}`);
  addGate("ledger_entry_present", Boolean(ledgerCurrent), `ledger entry ${ledgerCurrent ? "present" : "missing"}`);
  addGate("idempotency_entry_present", Boolean(idempotencyCurrent), `idempotency entry ${idempotencyCurrent ? "present" : "missing"}`);
  addGate("ledger_patch_present", Boolean(ledgerAfterPatch), `ledger after patch ${ledgerAfterPatch ? "present" : "missing"}`);
  addGate("idempotency_patch_present", Boolean(idempotencyAfterPatch), `idempotency after patch ${idempotencyAfterPatch ? "present" : "missing"}`);

  const ledgerAfter = ledgerCurrent && ledgerAfterPatch
    ? { ...ledgerCurrent, ...ledgerAfterPatch, updatedAt: generatedAt, migrationAppliedAt: generatedAt }
    : null;
  const idempotencyAfter = idempotencyCurrent && idempotencyAfterPatch
    ? { ...idempotencyCurrent, ...idempotencyAfterPatch, brokerCheckedAt: generatedAt, migrationAppliedAt: generatedAt }
    : null;
  const blockingGates = gates.filter((gate) => gate.status !== "PASS");
  return {
    symbol,
    ledgerKey,
    idempotencyKey,
    readyForApply: blockingGates.length === 0,
    blockingGates: blockingGates.length,
    gates,
    before: {
      orderLedger: ledgerCurrent || null,
      orderIdempotency: idempotencyCurrent || null
    },
    after: {
      orderLedger: ledgerAfter,
      orderIdempotency: idempotencyAfter
    },
    auditRecord: {
      type: "ledger_filled_terminalization_applied",
      generatedAt,
      symbol,
      ledgerKey,
      idempotencyKey,
      brokerEvidenceVerdict: planRow?.brokerEvidenceVerdict || null,
      previousLedgerStatus: ledgerCurrent?.status || null,
      appliedLedgerStatus: ledgerAfter?.status || null,
      previousIdempotencyBrokerStatus: idempotencyCurrent?.brokerStatus || idempotencyCurrent?.status || null,
      appliedIdempotencyBrokerStatus: idempotencyAfter?.brokerStatus || idempotencyAfter?.status || null,
      stateMutationApplied: false
    }
  };
};

const selectRows = (planRows) => {
  let rows = planRows.filter((row) => row?.readyForApplyReview === true && String(row?.proposedTerminalState || "").toLowerCase() === "filled");
  if (SYMBOL_FILTER.length > 0) {
    const allow = new Set(SYMBOL_FILTER);
    rows = rows.filter((row) => allow.has(asSymbol(row?.symbol)));
  }
  rows = rows.sort((a, b) => asSymbol(a?.symbol).localeCompare(asSymbol(b?.symbol)));
  return rows;
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ledger Filled Migration Apply Report");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- scope: \`${report.scope}\``);
  lines.push(`- apply_requested: \`${report.apply.requested}\``);
  lines.push(`- state_mutation: \`attempted=${report.summary.stateMutationAttempted} applied=${report.summary.stateMutationApplied}\``);
  lines.push(`- backup: \`created=${report.backup.created} dir=${report.backup.backupDir || "N/A"}\``);
  lines.push(`- summary: \`selected=${report.summary.selectedRows} ready=${report.summary.readyRows} blocked=${report.summary.blockedRows} postVerified=${report.summary.postVerifiedRows}\``);
  lines.push("| Symbol | Ready | Applied | Post Verified | Ledger Key | Idempotency Key | Blocked Gates | Reason |");
  lines.push("| --- | --- | --- | --- | --- | --- | ---: | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(`| ${row.symbol || "N/A"} | ${row.readyForApply ? "yes" : "no"} | ${row.stateMutationApplied ? "yes" : "no"} | ${row.postVerify?.passed ? "yes" : "no"} | ${row.ledgerKey || "N/A"} | ${row.idempotencyKey || "N/A"} | ${row.blockingGates} | ${short(row.reason, 180)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const backupStamp = generatedAt.replace(/[:.]/g, "-");
  const backupDir = `${STATE_DIR}/migration-backups/${backupStamp}`;
  const plan = readJson(FILES.plan);
  const orderLedger = readJson(FILES.orderLedger);
  const idempotency = readJson(FILES.idempotency);
  const ledgerBeforeText = readText(FILES.orderLedger);
  const idempotencyBeforeText = readText(FILES.idempotency);
  const planRows = Array.isArray(plan?.rows) ? plan.rows : [];
  const selectedPlanRows = selectRows(planRows);
  const rows = selectedPlanRows.map((planRow) => buildRow({ planRow, orderLedger, idempotency, generatedAt }));
  const globalGates = [];
  const addGlobalGate = (id, pass, detail) => globalGates.push({ id, status: pass ? "PASS" : "BLOCK", detail: short(detail, 360) });

  addGlobalGate("plan_present", Boolean(plan), `plan=${FILES.plan}`);
  addGlobalGate("order_ledger_present", Boolean(orderLedger?.orders), `orderLedger=${FILES.orderLedger}`);
  addGlobalGate("idempotency_present", Boolean(idempotency?.orders), `idempotency=${FILES.idempotency}`);
  addGlobalGate("ready_rows_present", rows.length > 0, `selectedRows=${rows.length}`);
  addGlobalGate("max_rows_guard", !APPLY_REQUESTED || (Number.isFinite(MAX_ROWS) && MAX_ROWS > 0 && rows.length <= MAX_ROWS), `selectedRows=${rows.length} maxRows=${MAX_ROWS}`);
  addGlobalGate("symbol_scope_required_for_multi_row", !APPLY_REQUESTED || rows.length <= 1 || SYMBOL_FILTER.length > 0, `symbols=${SYMBOL_FILTER.join(",") || "dynamic_single_row"}`);
  addGlobalGate("ledger_hash_matches_plan", !APPLY_REQUESTED || plan?.fileHashes?.orderLedger?.sha256 === sha256(ledgerBeforeText || ""), `plan=${plan?.fileHashes?.orderLedger?.sha256 || "N/A"} current=${sha256(ledgerBeforeText || "")}`);
  addGlobalGate("idempotency_hash_matches_plan", !APPLY_REQUESTED || plan?.fileHashes?.idempotency?.sha256 === sha256(idempotencyBeforeText || ""), `plan=${plan?.fileHashes?.idempotency?.sha256 || "N/A"} current=${sha256(idempotencyBeforeText || "")}`);

  const rowBlocked = rows.some((row) => !row.readyForApply);
  const globalBlocked = globalGates.some((gate) => gate.status !== "PASS");
  let backup = {
    created: false,
    backupDir: null,
    orderLedgerBackupPath: null,
    idempotencyBackupPath: null,
    auditRecordPath: null,
    orderLedgerBeforeHash: sha256(ledgerBeforeText || ""),
    idempotencyBeforeHash: sha256(idempotencyBeforeText || "")
  };
  let stateMutationAttempted = false;
  let stateMutationApplied = false;
  let postOrderLedger = orderLedger;
  let postIdempotency = idempotency;

  if (APPLY_REQUESTED && !globalBlocked && !rowBlocked) {
    stateMutationAttempted = true;
    fs.mkdirSync(backupDir, { recursive: true });
    backup = {
      ...backup,
      created: true,
      backupDir,
      orderLedgerBackupPath: `${backupDir}/order-ledger.json.before`,
      idempotencyBackupPath: `${backupDir}/order-idempotency.json.before`,
      auditRecordPath: `${backupDir}/ledger-filled-migration-audit.jsonl`
    };
    fs.writeFileSync(backup.orderLedgerBackupPath, ledgerBeforeText || "", "utf8");
    fs.writeFileSync(backup.idempotencyBackupPath, idempotencyBeforeText || "", "utf8");

    const nextLedger = JSON.parse(JSON.stringify(orderLedger));
    const nextIdempotency = JSON.parse(JSON.stringify(idempotency));
    for (const row of rows) {
      nextLedger.orders[row.ledgerKey] = row.after.orderLedger;
      nextIdempotency.orders[row.idempotencyKey] = row.after.orderIdempotency;
      row.auditRecord.stateMutationApplied = true;
      fs.appendFileSync(backup.auditRecordPath, `${JSON.stringify(row.auditRecord)}\n`, "utf8");
    }
    writeJsonAtomic(FILES.orderLedger, nextLedger);
    writeJsonAtomic(FILES.idempotency, nextIdempotency);
    postOrderLedger = readJson(FILES.orderLedger);
    postIdempotency = readJson(FILES.idempotency);
    stateMutationApplied = true;
  }

  for (const row of rows) {
    const ledgerPost = row.ledgerKey ? postOrderLedger?.orders?.[row.ledgerKey] : null;
    const idempotencyPost = row.idempotencyKey ? postIdempotency?.orders?.[row.idempotencyKey] : null;
    const passed = Boolean(
      ledgerPost?.status === "filled" &&
      ledgerPost?.brokerStatus === "filled" &&
      idempotencyPost?.brokerStatus === "filled" &&
      idempotencyPost?.terminal === false &&
      idempotencyPost?.releaseReason == null
    );
    row.postVerify = {
      passed: stateMutationApplied ? passed : false,
      ledgerStatus: ledgerPost?.status || null,
      ledgerBrokerStatus: ledgerPost?.brokerStatus || null,
      idempotencyBrokerStatus: idempotencyPost?.brokerStatus || null,
      idempotencyTerminal: idempotencyPost?.terminal ?? null,
      idempotencyReleaseReason: idempotencyPost?.releaseReason ?? null
    };
    row.stateMutationApplied = stateMutationApplied && passed;
    row.reason = !APPLY_REQUESTED
      ? "apply_not_requested_report_only"
      : !row.readyForApply
        ? `blocked:${row.gates.filter((gate) => gate.status !== "PASS").map((gate) => gate.id).join(",")}`
        : stateMutationApplied && passed
          ? "state_migration_applied_and_post_verified"
          : "state_migration_not_applied_or_post_verify_failed";
  }

  const summary = {
    selectedRows: rows.length,
    readyRows: count(rows, (row) => row.readyForApply),
    blockedRows: count(rows, (row) => !row.readyForApply),
    postVerifiedRows: count(rows, (row) => row.postVerify?.passed === true),
    stateMutationAttempted,
    stateMutationApplied
  };
  const overall = !APPLY_REQUESTED
    ? rows.length > 0
      ? "apply_not_requested_ready_rows_present"
      : "apply_not_requested_no_ready_rows"
    : globalBlocked || rowBlocked
      ? "apply_blocked_by_safety_gates"
      : stateMutationApplied && summary.postVerifiedRows === rows.length
        ? "state_migration_applied_and_verified"
        : "state_migration_attempted_but_not_verified";

  const report = {
    generatedAt,
    overall,
    scope: "portfolio_wide_dynamic_order_ledger_idempotency_filled_migration_apply_lane_state_only_not_broker_mutation",
    apply: {
      requested: APPLY_REQUESTED,
      approvalProvided: APPROVAL === REQUIRED_APPROVAL,
      requiredApprovalPhrase: REQUIRED_APPROVAL,
      symbolFilter: SYMBOL_FILTER,
      maxRows: Number.isFinite(MAX_ROWS) ? MAX_ROWS : null
    },
    files: Object.fromEntries(Object.entries(FILES).filter(([key]) => !key.startsWith("output")).map(([key, filePath]) => [key, fs.existsSync(filePath)])),
    fileHashes: {
      before: {
        orderLedger: fileMeta(backup.orderLedgerBackupPath || FILES.orderLedger),
        idempotency: fileMeta(backup.idempotencyBackupPath || FILES.idempotency)
      },
      after: {
        orderLedger: fileMeta(FILES.orderLedger),
        idempotency: fileMeta(FILES.idempotency)
      }
    },
    backup,
    globalGates,
    executionPolicy: {
      mode: APPLY_REQUESTED ? "state_migration_apply_requested" : "report_only_apply_not_requested",
      brokerMutationAllowed: false,
      brokerMutationAttempted: false,
      brokerMutationSubmitted: false,
      stateMutationAllowed: APPLY_REQUESTED && APPROVAL === REQUIRED_APPROVAL,
      stateMutationAttempted,
      stateMutationApplied
    },
    summary,
    rows
  };
  writeJsonAtomic(FILES.outputJson, report);
  writeTextAtomic(FILES.outputMd, buildMarkdown(report));
  console.log(`[LEDGER_FILLED_MIGRATION_APPLY] saved json=${FILES.outputJson} md=${FILES.outputMd} overall=${overall} rows=${rows.length} attempted=${stateMutationAttempted} applied=${stateMutationApplied}`);
};

main();
