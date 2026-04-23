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
const short = (value, max = 180) => String(value ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

const DATABASE_CATALOG = [
  {
    key: "daily_snapshot",
    label: "Daily Snapshot",
    envName: "NOTION_DB_DAILY_SNAPSHOT",
    defaultStaleMinutes: 240,
    required: true,
    runKeyAudit: true
  },
  {
    key: "stock_scores",
    label: "Stock Scores",
    envName: "NOTION_DB_STOCK_SCORES",
    defaultStaleMinutes: 24 * 60,
    required: true
  },
  {
    key: "ai_alpha_analysis",
    label: "AI Alpha Analysis",
    envName: "NOTION_DB_AI_ALPHA_ANALYSIS",
    defaultStaleMinutes: 24 * 60,
    required: true
  },
  {
    key: "portfolio_watchlist",
    label: "Portfolio Watchlist",
    envName: "NOTION_DB_WATCHLIST",
    defaultStaleMinutes: 24 * 60,
    required: true
  },
  {
    key: "hf_tuning_tracker",
    label: "HF Tuning Tracker",
    envName: "NOTION_DB_HF_TUNING_TRACKER",
    defaultStaleMinutes: 12 * 60,
    required: true
  },
  {
    key: "guard_action_log",
    label: "Guard Action Log",
    envName: "NOTION_DB_GUARD_ACTION_LOG",
    defaultStaleMinutes: 24 * 60,
    required: true
  },
  {
    key: "performance_dashboard",
    label: "Performance Dashboard",
    envName: "NOTION_DB_PERFORMANCE_DASHBOARD",
    defaultStaleMinutes: 24 * 60,
    required: true
  },
  {
    key: "automation_incident_log",
    label: "Automation Incident Log",
    envName: "NOTION_DB_AUTOMATION_INCIDENT_LOG",
    defaultStaleMinutes: 7 * 24 * 60,
    required: false
  },
  {
    key: "key_rotation_ledger",
    label: "Key Rotation Ledger",
    envName: "NOTION_DB_KEY_ROTATION_LEDGER",
    defaultStaleMinutes: 7 * 24 * 60,
    required: false
  }
];

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
  if (prop.type === "select") return String(prop.select?.name || "").trim();
  if (prop.type === "status") return String(prop.status?.name || "").trim();
  if (prop.type === "number") return Number.isFinite(prop.number) ? String(prop.number) : "";
  if (prop.type === "date") return String(prop.date?.start || "").trim();
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  return "";
};

const pickExisting = (properties, candidates) => {
  for (const key of candidates) {
    if (properties?.[key]) return key;
  }
  return null;
};

const staleMinutes = (createdTime) => {
  const createdMs = Date.parse(createdTime || "");
  if (!Number.isFinite(createdMs)) return null;
  return Math.round((Date.now() - createdMs) / 60000);
};

const auditDailySnapshotDetails = ({ rows, runKeyPrefixes, staleThresholdMinutes }) => {
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

  const latestMinutes = staleMinutes(scopedRows[0]?.created_time);
  const status =
    requiredFieldMissingRows > 0 ||
    duplicateRunKeys.length > 0 ||
    (latestMinutes != null && latestMinutes > staleThresholdMinutes)
      ? "warn"
      : "pass";

  return {
    status,
    rowsChecked: scopedRows.length,
    scannedRows: rows.length,
    requiredFieldMissingRows,
    duplicateRunKeyCount: duplicateRunKeys.length,
    staleLatestMinutes: latestMinutes,
    staleThresholdMinutes,
    runKeyPrefixes,
    samples: {
      missingFields: missingSamples.slice(0, 15),
      duplicateRunKeys: duplicateRunKeys.slice(0, 15)
    }
  };
};

const auditDatabaseFreshness = ({ rows, staleThresholdMinutes, required }) => {
  const rowCount = rows.length;
  const latestCreatedAt = rows[0]?.created_time || null;
  const latestAgeMin = staleMinutes(latestCreatedAt);
  if (rowCount === 0) {
    return {
      status: required ? "warn" : "info",
      reason: "empty_database",
      rowCount,
      latestCreatedAt,
      latestAgeMin,
      staleThresholdMinutes,
      required
    };
  }
  if (latestAgeMin != null && latestAgeMin > staleThresholdMinutes) {
    return {
      status: "warn",
      reason: `stale(${latestAgeMin}m>${staleThresholdMinutes}m)`,
      rowCount,
      latestCreatedAt,
      latestAgeMin,
      staleThresholdMinutes,
      required
    };
  }
  return {
    status: "pass",
    reason: "fresh",
    rowCount,
    latestCreatedAt,
    latestAgeMin,
    staleThresholdMinutes,
    required
  };
};

const buildMarkdown = (audit) => {
  const lines = [];
  lines.push("## Notion Ops Audit");
  lines.push(`- generatedAt: \`${audit.generatedAt}\``);
  lines.push(`- status: \`${String(audit.status || "unknown").toUpperCase()}\``);
  lines.push(`- reason: \`${audit.reason || "n/a"}\``);
  lines.push(`- rowsChecked: \`${audit.rowsChecked}\` (scanned=\`${audit.scannedRows}\`)`);
  lines.push(`- runKeyPrefixes: \`${(audit.runKeyPrefixes || []).join(",") || "none"}\``);
  lines.push("");
  lines.push("### Daily Snapshot Integrity");
  lines.push(`- missing_rows: \`${audit.requiredFieldMissingRows}\``);
  lines.push(`- duplicate_run_keys: \`${audit.duplicateRunKeyCount}\``);
  lines.push(`- stale_latest_minutes: \`${audit.staleLatestMinutes ?? "N/A"}\``);
  lines.push(`- stale_threshold_minutes: \`${audit.staleThresholdMinutes}\``);
  lines.push("");
  lines.push("### Database Freshness");
  lines.push(
    "| database | required | status | rows | latestAgeMin | thresholdMin | reason |"
  );
  lines.push("|---|---:|---|---:|---:|---:|---|");
  for (const db of audit.databaseHealth || []) {
    lines.push(
      `| ${db.label} | ${db.required ? "yes" : "no"} | ${db.status} | ${db.rowCount ?? 0} | ${db.latestAgeMin ?? "N/A"} | ${db.staleThresholdMinutes ?? "N/A"} | ${db.reason || "n/a"} |`
    );
  }
  lines.push("");
  lines.push("### Summary Counts");
  lines.push(`- pass: \`${audit.databaseCounts?.pass ?? 0}\``);
  lines.push(`- warn: \`${audit.databaseCounts?.warn ?? 0}\``);
  lines.push(`- fail: \`${audit.databaseCounts?.fail ?? 0}\``);
  lines.push(`- info: \`${audit.databaseCounts?.info ?? 0}\``);
  lines.push(`- skip: \`${audit.databaseCounts?.skip ?? 0}\``);
  lines.push(`- missing_config: \`${audit.missingConfigCount ?? 0}\``);
  lines.push(`- empty_db: \`${audit.emptyDatabaseCount ?? 0}\``);
  lines.push(`- stale_db: \`${audit.staleDatabaseCount ?? 0}\``);
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
  const pageSize = Math.max(5, Math.min(100, toNum(env("NOTION_AUDIT_PAGE_SIZE", "40"), 40)));
  const runKeyPrefixes = env("NOTION_AUDIT_RUNKEY_PREFIXES", "sidecar-")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  const defaultStaleMinutes = Math.max(
    30,
    Math.min(30 * 24 * 60, toNum(env("NOTION_AUDIT_STALE_MINUTES", "240"), 240))
  );
  const strictFail = env("NOTION_AUDIT_STRICT_FAIL", "false").toLowerCase() === "true";

  if (!token) {
    const skipped = {
      generatedAt: nowIso(),
      status: "skip",
      reason: "missing_notion_token",
      rowsChecked: 0,
      scannedRows: 0,
      requiredFieldMissingRows: 0,
      duplicateRunKeyCount: 0,
      staleLatestMinutes: null,
      staleThresholdMinutes: defaultStaleMinutes,
      runKeyPrefixes,
      samples: { missingFields: [], duplicateRunKeys: [] },
      databaseHealth: [],
      databaseCounts: { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 },
      missingConfigCount: 0,
      emptyDatabaseCount: 0,
      staleDatabaseCount: 0
    };
    writeJson(OUTPUT_JSON, skipped);
    writeText(OUTPUT_MD, buildMarkdown(skipped));
    console.log("[NOTION_AUDIT] skipped missing token");
    return;
  }

  const databaseHealth = [];
  let dailyDetails = null;

  for (const cfg of DATABASE_CATALOG) {
    const dbId = env(cfg.envName);
    const staleThresholdMinutes = Math.max(
      30,
      Math.min(
        30 * 24 * 60,
        toNum(env(`NOTION_AUDIT_${cfg.key.toUpperCase()}_STALE_MINUTES`), cfg.defaultStaleMinutes ?? defaultStaleMinutes)
      )
    );

    if (!dbId) {
      databaseHealth.push({
        key: cfg.key,
        label: cfg.label,
        envName: cfg.envName,
        required: cfg.required,
        status: "skip",
        reason: "missing_db_env",
        rowCount: 0,
        latestCreatedAt: null,
        latestAgeMin: null,
        staleThresholdMinutes
      });
      continue;
    }

    try {
      const result = await queryDatabase(token, dbId, pageSize);
      const rows = Array.isArray(result.results) ? result.results : [];
      const freshness = auditDatabaseFreshness({
        rows,
        staleThresholdMinutes,
        required: cfg.required
      });
      databaseHealth.push({
        key: cfg.key,
        label: cfg.label,
        envName: cfg.envName,
        databaseId: dbId,
        ...freshness
      });

      if (cfg.runKeyAudit) {
        dailyDetails = auditDailySnapshotDetails({
          rows,
          runKeyPrefixes,
          staleThresholdMinutes
        });
      }
    } catch (error) {
      databaseHealth.push({
        key: cfg.key,
        label: cfg.label,
        envName: cfg.envName,
        databaseId: dbId,
        required: cfg.required,
        status: "fail",
        reason: short(error instanceof Error ? error.message : String(error), 220),
        rowCount: 0,
        latestCreatedAt: null,
        latestAgeMin: null,
        staleThresholdMinutes
      });
    }
  }

  const counts = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const row of databaseHealth) {
    const key = ["pass", "warn", "fail", "info", "skip"].includes(row.status) ? row.status : "warn";
    counts[key] += 1;
  }

  const missingConfigCount = databaseHealth.filter((row) => row.reason === "missing_db_env").length;
  const emptyDatabaseCount = databaseHealth.filter((row) => row.reason === "empty_database").length;
  const staleDatabaseCount = databaseHealth.filter((row) =>
    String(row.reason || "").startsWith("stale(")
  ).length;

  const requiredBad = databaseHealth.filter(
    (row) => row.required && (row.status === "warn" || row.status === "fail" || row.status === "skip")
  );

  let status = "pass";
  let reason = "healthy";
  if (requiredBad.some((row) => row.status === "fail")) {
    status = "fail";
    reason = "required_db_query_failed";
  } else if (requiredBad.length > 0) {
    status = "warn";
    reason = "required_db_stale_or_missing";
  } else if (counts.warn > 0 || counts.fail > 0) {
    status = "warn";
    reason = "optional_db_attention";
  }

  const audit = {
    generatedAt: nowIso(),
    status,
    reason,
    rowsChecked: dailyDetails?.rowsChecked ?? 0,
    scannedRows: dailyDetails?.scannedRows ?? 0,
    requiredFieldMissingRows: dailyDetails?.requiredFieldMissingRows ?? 0,
    duplicateRunKeyCount: dailyDetails?.duplicateRunKeyCount ?? 0,
    staleLatestMinutes: dailyDetails?.staleLatestMinutes ?? null,
    staleThresholdMinutes: dailyDetails?.staleThresholdMinutes ?? defaultStaleMinutes,
    runKeyPrefixes,
    samples: dailyDetails?.samples || { missingFields: [], duplicateRunKeys: [] },
    databaseHealth,
    databaseCounts: counts,
    missingConfigCount,
    emptyDatabaseCount,
    staleDatabaseCount
  };

  writeJson(OUTPUT_JSON, audit);
  writeText(OUTPUT_MD, buildMarkdown(audit));
  console.log(
    `[NOTION_AUDIT] status=${status} reason=${reason} pass=${counts.pass} warn=${counts.warn} fail=${counts.fail} skip=${counts.skip} stale=${staleDatabaseCount} missingConfig=${missingConfigCount}`
  );

  if (strictFail && status !== "pass") {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("[NOTION_AUDIT] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
