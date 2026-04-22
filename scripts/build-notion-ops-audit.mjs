import fs from "node:fs";

const STATE_DIR = "state";
const OUTPUT_JSON = `${STATE_DIR}/notion-ops-audit.json`;
const OUTPUT_MD = `${STATE_DIR}/notion-ops-audit.md`;
const NOTION_VERSION = "2022-06-28";

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const toNum = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const short = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

const writeJson = (path, data) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
};

const writeText = (path, text) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path, text, "utf8");
};

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json"
});

const queryDatabase = async (token, databaseId, pageSize) => {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      page_size: pageSize,
      sorts: [{ timestamp: "created_time", direction: "descending" }]
    })
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(`Notion query failed (${response.status}): ${short(JSON.stringify(data), 260)}`);
  }
  return data;
};

const pagePropText = (page, key) => {
  const prop = page?.properties?.[key];
  if (!prop) return "";
  if (prop.type === "title") {
    return (prop.title || []).map((row) => row.plain_text || row.text?.content || "").join("").trim();
  }
  if (prop.type === "rich_text") {
    return (prop.rich_text || []).map((row) => row.plain_text || row.text?.content || "").join("").trim();
  }
  if (prop.type === "select") {
    return String(prop.select?.name || "").trim();
  }
  if (prop.type === "status") {
    return String(prop.status?.name || "").trim();
  }
  if (prop.type === "number") {
    return Number.isFinite(prop.number) ? String(prop.number) : "";
  }
  if (prop.type === "date") {
    return String(prop.date?.start || "").trim();
  }
  if (prop.type === "checkbox") {
    return prop.checkbox ? "true" : "false";
  }
  return "";
};

const pickExisting = (properties, candidates) => {
  for (const key of candidates) {
    if (properties?.[key]) return key;
  }
  return null;
};

const buildMarkdown = (audit) => {
  const lines = [];
  lines.push("## Notion Ops Audit");
  lines.push(`- generatedAt: \`${audit.generatedAt}\``);
  lines.push(`- status: \`${audit.status.toUpperCase()}\``);
  lines.push(`- db: \`${audit.databaseId || "N/A"}\``);
  lines.push(`- rowsChecked: \`${audit.rowsChecked}\` (scanned=\`${audit.scannedRows}\`)`);
  lines.push(`- runKeyPrefixes: \`${(audit.runKeyPrefixes || []).join(",") || "none"}\``);
  if (audit.reason) lines.push(`- reason: \`${audit.reason}\``);
  lines.push("");
  lines.push("### Checks");
  lines.push(`- required_fields_missing_rows: \`${audit.requiredFieldMissingRows}\``);
  lines.push(`- duplicate_run_key_count: \`${audit.duplicateRunKeyCount}\``);
  lines.push(`- stale_latest_minutes: \`${audit.staleLatestMinutes ?? "N/A"}\``);
  lines.push(`- stale_threshold_minutes: \`${audit.staleThresholdMinutes}\``);
  lines.push("");
  if (audit.samples?.missingFields?.length) {
    lines.push("### Missing Field Samples");
    for (const row of audit.samples.missingFields.slice(0, 8)) {
      lines.push(`- run=\`${row.runKey || "N/A"}\` missing=\`${row.missing.join(",")}\``);
    }
    lines.push("");
  }
  if (audit.samples?.duplicateRunKeys?.length) {
    lines.push("### Duplicate Run Key Samples");
    for (const row of audit.samples.duplicateRunKeys.slice(0, 8)) {
      lines.push(`- \`${row.runKey}\` count=\`${row.count}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const token = env("NOTION_TOKEN");
  const databaseId = env("NOTION_DB_DAILY_SNAPSHOT");
  const pageSize = Math.max(5, Math.min(100, toNum(env("NOTION_AUDIT_PAGE_SIZE", "40"), 40)));
  const runKeyPrefixes = env("NOTION_AUDIT_RUNKEY_PREFIXES", "sidecar-")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  const staleThresholdMinutes = Math.max(
    30,
    Math.min(24 * 60, toNum(env("NOTION_AUDIT_STALE_MINUTES", "240"), 240))
  );
  const strictFail = env("NOTION_AUDIT_STRICT_FAIL", "false").toLowerCase() === "true";

  if (!token || !databaseId) {
    const skipped = {
      generatedAt: nowIso(),
      status: "skip",
      reason: "missing_notion_token_or_db",
      databaseId: databaseId || null,
      rowsChecked: 0,
      requiredFieldMissingRows: 0,
      duplicateRunKeyCount: 0,
      staleLatestMinutes: null,
      staleThresholdMinutes,
      samples: { missingFields: [], duplicateRunKeys: [] }
    };
    writeJson(OUTPUT_JSON, skipped);
    writeText(OUTPUT_MD, buildMarkdown(skipped));
    console.log("[NOTION_AUDIT] skipped missing token/db");
    return;
  }

  const result = await queryDatabase(token, databaseId, pageSize);
  const rows = Array.isArray(result.results) ? result.results : [];
  const scopedRows = [];

  let requiredFieldMissingRows = 0;
  const missingSamples = [];
  const runKeyCounts = new Map();

  for (const page of rows) {
    const props = page?.properties || {};
    const runKeyName = pickExisting(props, ["Run Date", "Run Key", "Name"]);
    const statusName = pickExisting(props, ["Status"]);
    const sourceName = pickExisting(props, ["Source"]);
    const stage6HashName = pickExisting(props, ["Stage6 Hash"]);
    const payloadName = pickExisting(props, ["Payload Count"]);
    const skippedName = pickExisting(props, ["Skipped Count"]);
    const summaryName = pickExisting(props, ["Summary"]);

    const runKey = runKeyName ? pagePropText(page, runKeyName) : "";
    const inScope =
      runKeyPrefixes.length === 0 || runKeyPrefixes.some((prefix) => runKey.startsWith(prefix));
    if (!inScope) continue;
    scopedRows.push(page);
    if (runKey) runKeyCounts.set(runKey, (runKeyCounts.get(runKey) || 0) + 1);

    const missing = [];
    if (!runKey) missing.push("Run Key");
    if (!statusName || !pagePropText(page, statusName)) missing.push("Status");
    if (!sourceName || !pagePropText(page, sourceName)) missing.push("Source");
    if (!stage6HashName || !pagePropText(page, stage6HashName)) missing.push("Stage6 Hash");
    if (!payloadName || !pagePropText(page, payloadName)) missing.push("Payload Count");
    if (!skippedName || !pagePropText(page, skippedName)) missing.push("Skipped Count");
    if (!summaryName || !pagePropText(page, summaryName)) missing.push("Summary");

    if (missing.length > 0) {
      requiredFieldMissingRows += 1;
      missingSamples.push({ runKey, missing });
    }
  }

  const duplicateRunKeys = Array.from(runKeyCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([runKey, count]) => ({ runKey, count }))
    .sort((a, b) => b.count - a.count);

  const rowsChecked = scopedRows.length;
  const latestCreated = scopedRows[0]?.created_time ? Date.parse(scopedRows[0].created_time) : NaN;
  const staleLatestMinutes =
    Number.isFinite(latestCreated) && latestCreated > 0
      ? Math.round((Date.now() - latestCreated) / 60000)
      : null;

  let status = "pass";
  if (requiredFieldMissingRows > 0 || duplicateRunKeys.length > 0) status = "warn";
  if (staleLatestMinutes != null && staleLatestMinutes > staleThresholdMinutes) status = "warn";

  const audit = {
    generatedAt: nowIso(),
    status,
    reason: "",
    databaseId,
    rowsChecked,
    runKeyPrefixes,
    scannedRows: rows.length,
    requiredFieldMissingRows,
    duplicateRunKeyCount: duplicateRunKeys.length,
    staleLatestMinutes,
    staleThresholdMinutes,
    samples: {
      missingFields: missingSamples.slice(0, 15),
      duplicateRunKeys: duplicateRunKeys.slice(0, 15)
    }
  };

  writeJson(OUTPUT_JSON, audit);
  writeText(OUTPUT_MD, buildMarkdown(audit));
  console.log(
    `[NOTION_AUDIT] status=${status} rows=${rowsChecked} missingRows=${requiredFieldMissingRows} duplicateRunKeys=${duplicateRunKeys.length} staleMin=${staleLatestMinutes ?? "N/A"}`
  );

  if (strictFail && status !== "pass") {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("[NOTION_AUDIT] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
