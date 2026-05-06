import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = String(process.env.EXEC_BLOCKER_AUDIT_ROOT || "state").trim() || "state";
const OUT_DIR = String(process.env.EXEC_BLOCKER_AUDIT_OUT_DIR || "state").trim() || "state";
const OUTPUT_JSON = path.join(OUT_DIR, "execution-blocker-audit.json");
const OUTPUT_MD = path.join(OUT_DIR, "execution-blocker-audit.md");
const MAX_RUNS = Math.max(1, Math.round(Number(process.env.EXEC_BLOCKER_AUDIT_MAX_RUNS || 200)));

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readText = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
};

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const short = (value, max = 160) => String(value ?? "").trim().slice(0, max);

const addCount = (target, key, value = 1) => {
  const normalized = String(key || "").trim() || "unknown";
  target[normalized] = (target[normalized] || 0) + value;
};

const parseTokenCounts = (value) => {
  const out = {};
  const text = String(value || "").trim();
  if (!text || text === "none" || text === "null") return out;
  for (const part of text.split(",")) {
    const [key, rawCount] = part.split(":");
    const normalized = String(key || "").trim();
    if (!normalized) continue;
    const count = Number(rawCount);
    out[normalized] = (out[normalized] || 0) + (Number.isFinite(count) ? count : 1);
  }
  return out;
};

const findStateDirs = (rootDir) => {
  const found = [];
  const root = path.resolve(rootDir);
  const visit = (dir) => {
    const previewPath = path.join(dir, "last-dry-exec-preview.json");
    if (fs.existsSync(previewPath)) {
      found.push(dir);
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name));
    }
  };
  visit(root);
  return found;
};

const extractLogToken = (logText, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = logText.match(new RegExp(`${escaped}=([^\\s]+)`));
  return match ? match[1] : "";
};

const normalizeRecords = (audit) => {
  if (Array.isArray(audit?.records)) return audit.records;
  if (Array.isArray(audit?.decisions)) return audit.decisions;
  if (Array.isArray(audit?.rows)) return audit.rows;
  return [];
};

const classifyRun = ({ preview, records, fillability, stageReasonCounts }) => {
  const payloads = toNum(preview?.payloadCount);
  const skipped = toNum(preview?.skippedCount);
  const submitted = toNum(preview?.brokerSubmission?.submitted);
  const attempted = toNum(preview?.brokerSubmission?.attempted);
  const brokerReason = String(preview?.brokerSubmission?.reason || "");
  const candidates = toNum(preview?.stage6Contract?.checked, -1);
  const skipReasons = preview?.skipReasonCounts || {};
  const fillRows = Array.isArray(fillability?.rows) ? fillability.rows : [];

  if (submitted > 0) return "BROKER_SUBMITTED";
  if (attempted > 0 && submitted === 0) return "BROKER_SUBMIT_FAILED";
  if (payloads > 0) return "PAYLOAD_READY_NOT_SUBMITTED";
  if (candidates === 0 && Object.keys(stageReasonCounts).length > 0) return "STAGE6_ZERO_EXECUTABLE";
  if (skipped > 0 || Object.keys(skipReasons).length > 0 || fillRows.length > 0) return "SIDECAR_CANDIDATE_BLOCKED";
  if (brokerReason === "dedupe_skip") return "DEDUPE_REPEAT";
  if (records.length === 0) return "NO_DECISION_RECORDS";
  return "NO_PAYLOAD_UNKNOWN";
};

const buildRunRow = (stateDir) => {
  const preview = readJson(path.join(stateDir, "last-dry-exec-preview.json")) || {};
  const audit = readJson(path.join(stateDir, "last-order-decision-audit.json")) || {};
  const fillability = readJson(path.join(stateDir, "fillability-report.json")) || {};
  const logText = readText(path.join(stateDir, "last-run-output.log"));
  const records = normalizeRecords(audit);
  const stageReasonText = extractLogToken(logText, "stage6_contract_reason_primary");
  const stageSkipHintText = extractLogToken(logText, "stage6_skip_hint_primary");
  const stageReasonCounts = parseTokenCounts(stageReasonText);
  const stageSkipHintCounts = parseTokenCounts(stageSkipHintText);
  const runIdMatch = stateDir.match(/sidecar-state-(\d+)/);
  const mtimeMs = fs.statSync(path.join(stateDir, "last-dry-exec-preview.json")).mtimeMs;
  const generatedAt = preview.generatedAt || preview.timestamp || new Date(mtimeMs).toISOString();

  return {
    runId: runIdMatch ? runIdMatch[1] : path.basename(stateDir),
    stateDir,
    generatedAt,
    stage6File: preview.stage6File || null,
    stage6Hash: preview.stage6Hash || null,
    stage6HashShort: short(preview.stage6Hash || "", 12) || null,
    payloadCount: toNum(preview.payloadCount),
    skippedCount: toNum(preview.skippedCount),
    candidatesChecked: toNum(preview?.stage6Contract?.checked, 0),
    candidatesExecutable: toNum(preview?.stage6Contract?.executable, 0),
    brokerReason: preview?.brokerSubmission?.reason || "N/A",
    brokerAttempted: toNum(preview?.brokerSubmission?.attempted),
    brokerSubmitted: toNum(preview?.brokerSubmission?.submitted),
    preflight: `${preview?.preflight?.status || "N/A"}:${preview?.preflight?.code || "N/A"}`,
    mode: {
      readOnly: preview?.mode?.readOnly,
      execEnabled: preview?.mode?.execEnabled
    },
    skipReasons: preview.skipReasonCounts || {},
    stageReasonCounts,
    stageSkipHintCounts,
    decisionRecordCount: records.length,
    decisionSymbols: [...new Set(records.map((row) => String(row?.symbol || "").trim()).filter(Boolean))],
    fillabilityOverall: fillability?.summary?.overall || null,
    fillabilityFindings: fillability?.summary?.findings || [],
    fillabilityRows: Array.isArray(fillability?.rows) ? fillability.rows.length : 0,
    classification: classifyRun({ preview, records, fillability, stageReasonCounts })
  };
};

const chooseGroupRepresentative = (rows) =>
  rows.find((row) => row.brokerReason !== "dedupe_skip") ||
  rows.find((row) => row.decisionRecordCount > 0) ||
  rows[0];

const buildAudit = () => {
  const stateDirs = findStateDirs(ROOT_DIR);
  const rows = stateDirs
    .map(buildRunRow)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, MAX_RUNS);

  const summary = {
    generatedAt: new Date().toISOString(),
    rootDir: path.resolve(ROOT_DIR),
    runCount: rows.length,
    uniqueStage6Count: 0,
    brokerSubmittedRuns: 0,
    payloadReadyRuns: 0,
    zeroExecutableRuns: 0,
    candidateBlockedRuns: 0,
    dedupeRuns: 0,
    noDecisionRecordRuns: 0,
    classifications: {},
    skipReasons: {},
    stageReasons: {},
    stageSkipHints: {},
    symbols: {}
  };

  const groups = new Map();
  for (const row of rows) {
    const groupKey = row.stage6HashShort || row.stage6File || row.runId;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
    addCount(summary.classifications, row.classification);
    if (row.brokerSubmitted > 0) summary.brokerSubmittedRuns += 1;
    if (row.payloadCount > 0) summary.payloadReadyRuns += 1;
    if (row.classification === "STAGE6_ZERO_EXECUTABLE") summary.zeroExecutableRuns += 1;
    if (row.classification === "SIDECAR_CANDIDATE_BLOCKED") summary.candidateBlockedRuns += 1;
    if (row.classification === "DEDUPE_REPEAT" || row.brokerReason === "dedupe_skip") summary.dedupeRuns += 1;
    if (row.decisionRecordCount === 0) summary.noDecisionRecordRuns += 1;
    for (const [key, value] of Object.entries(row.skipReasons)) addCount(summary.skipReasons, key, Number(value));
    for (const [key, value] of Object.entries(row.stageReasonCounts)) addCount(summary.stageReasons, key, Number(value));
    for (const [key, value] of Object.entries(row.stageSkipHintCounts)) addCount(summary.stageSkipHints, key, Number(value));
    for (const symbol of row.decisionSymbols) addCount(summary.symbols, symbol);
  }

  const stage6Groups = [...groups.entries()].map(([key, groupRows]) => {
    const representative = chooseGroupRepresentative(groupRows);
    return {
      key,
      runCount: groupRows.length,
      firstGeneratedAt: groupRows[groupRows.length - 1]?.generatedAt || null,
      latestGeneratedAt: groupRows[0]?.generatedAt || null,
      stage6File: representative.stage6File,
      stage6HashShort: representative.stage6HashShort,
      classification: representative.classification,
      payloadCount: Math.max(...groupRows.map((row) => row.payloadCount)),
      skippedCount: Math.max(...groupRows.map((row) => row.skippedCount)),
      brokerSubmitted: Math.max(...groupRows.map((row) => row.brokerSubmitted)),
      candidatesChecked: Math.max(...groupRows.map((row) => row.candidatesChecked)),
      candidatesExecutable: Math.max(...groupRows.map((row) => row.candidatesExecutable)),
      skipReasons: representative.skipReasons,
      stageReasons: representative.stageReasonCounts,
      symbols: representative.decisionSymbols,
      brokerReason: representative.brokerReason,
      preflight: representative.preflight
    };
  });
  summary.uniqueStage6Count = stage6Groups.length;

  return { summary, stage6Groups, runs: rows };
};

const formatCounts = (obj) => {
  const entries = Object.entries(obj || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}:${value}`).join(", ");
};

const buildMarkdown = (audit) => {
  const lines = [];
  lines.push("## Sidecar Execution Blocker Audit");
  lines.push(`- generatedAt: \`${audit.summary.generatedAt}\``);
  lines.push(`- rootDir: \`${audit.summary.rootDir}\``);
  lines.push(
    `- summary: \`runs=${audit.summary.runCount} uniqueStage6=${audit.summary.uniqueStage6Count} payloadRuns=${audit.summary.payloadReadyRuns} submittedRuns=${audit.summary.brokerSubmittedRuns} zeroExecutableRuns=${audit.summary.zeroExecutableRuns} candidateBlockedRuns=${audit.summary.candidateBlockedRuns} dedupeRuns=${audit.summary.dedupeRuns}\``
  );
  lines.push(`- classifications: \`${formatCounts(audit.summary.classifications)}\``);
  lines.push(`- stageReasons: \`${formatCounts(audit.summary.stageReasons)}\``);
  lines.push(`- skipReasons: \`${formatCounts(audit.summary.skipReasons)}\``);
  lines.push(`- symbols: \`${formatCounts(audit.summary.symbols)}\``);
  lines.push("");
  lines.push("| Stage6 | Runs | Class | Candidates | Payload/Skipped | Submitted | Top Blockers | Symbols |");
  lines.push("| --- | ---: | --- | ---: | ---: | ---: | --- | --- |");
  for (const group of audit.stage6Groups.slice(0, 30)) {
    const blockers = group.classification === "STAGE6_ZERO_EXECUTABLE" ? group.stageReasons : group.skipReasons;
    lines.push(
      `| ${group.stage6HashShort || "N/A"} | ${group.runCount} | ${group.classification} | ${group.candidatesChecked} | ${group.payloadCount}/${group.skippedCount} | ${group.brokerSubmitted} | ${formatCounts(blockers)} | ${group.symbols.join(",") || "none"} |`
    );
  }
  lines.push("");
  lines.push("### Recommended P0 Route");
  if (audit.summary.zeroExecutableRuns > 0) {
    lines.push("- `STAGE6_ZERO_EXECUTABLE` exists: audit Stage6 earnings/missing-data gate before broker-submit tuning.");
  }
  if ((audit.summary.skipReasons.entry_too_far_from_market || 0) > 0) {
    lines.push("- `entry_too_far_from_market` repeats: move to Stage6 entry/OTE and RR-at-current calibration.");
  }
  if ((audit.summary.skipReasons.entry_notional_below_limit_price || 0) > 0) {
    lines.push("- `entry_notional_below_limit_price` repeats: test risk-based high-price sizing separately from entry calibration.");
  }
  if (audit.summary.brokerSubmittedRuns === 0) {
    lines.push("- No submitted runs in sample: do not treat workflow success as execution success.");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const audit = buildAudit();
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(audit), "utf8");
  console.log(
    `[EXEC_BLOCKER_AUDIT] runs=${audit.summary.runCount} uniqueStage6=${audit.summary.uniqueStage6Count} submittedRuns=${audit.summary.brokerSubmittedRuns} zeroExecutableRuns=${audit.summary.zeroExecutableRuns} candidateBlockedRuns=${audit.summary.candidateBlockedRuns}`
  );
};

main();
