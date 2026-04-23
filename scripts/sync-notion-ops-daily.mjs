import fs from "node:fs";

const NOTION_VERSION = "2022-06-28";
const STATE_DIR = "state";
const REPORT_PATH = `${STATE_DIR}/ops-daily-report.json`;
const OUTPUT_PATH = `${STATE_DIR}/notion-ops-daily-sync.json`;

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const hasValue = (v) => String(v ?? "").trim().length > 0;
const short = (v, max = 1800) => String(v ?? "").trim().slice(0, max);
const normalizeUrl = (v) => {
  const raw = String(v ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 1900);
};
const uniqueNonEmpty = (arr) => Array.from(new Set(arr.filter((v) => hasValue(v))));

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const boolFromEnv = (name, fallback = true) => {
  const raw = env(name);
  if (!raw) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const toIso = (value) => {
  const dt = new Date(value || "");
  if (Number.isNaN(dt.getTime())) return new Date().toISOString();
  return dt.toISOString();
};

const toDate = (value) => toIso(value).slice(0, 10);

const titleProp = (value) => ({
  title: [{ text: { content: short(value, 200) } }]
});

const textProp = (value) => ({
  rich_text: [{ text: { content: short(value, 1900) } }]
});

const numberProp = (value) => ({
  number: Number.isFinite(Number(value)) ? Number(value) : null
});

const selectProp = (value) => ({
  select: { name: short(value, 100) || "Unknown" }
});

const statusProp = (value) => ({
  status: { name: short(value, 100) || "Unknown" }
});

const dateProp = (value) => ({
  date: { start: toDate(value) }
});

const dateTimeProp = (value) => ({
  date: { start: toIso(value) }
});

const urlProp = (value) => ({
  url: normalizeUrl(value) || null
});

const notionHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json"
});

const notionRequest = async (token, path, init = {}) => {
  const response = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      ...notionHeaders(token),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(`Notion ${path} failed (${response.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
};

const findTitlePropertyName = (schema) => {
  const entries = Object.entries(schema || {});
  const hit = entries.find(([, def]) => String(def?.type || "") === "title");
  return hit ? hit[0] : null;
};

const findPropertyAlias = (schema, names, types = []) => {
  for (const name of names) {
    const def = schema?.[name];
    if (!def?.type) continue;
    if (types.length > 0 && !types.includes(def.type)) continue;
    return name;
  }
  return null;
};

const queryByTitle = async (token, databaseId, titlePropertyName, titleValue) => {
  const payload = {
    filter: {
      property: titlePropertyName,
      title: { equals: titleValue }
    },
    page_size: 1
  };
  const data = await notionRequest(token, `/v1/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return Array.isArray(data?.results) && data.results.length > 0 ? data.results[0] : null;
};

const setProp = (props, schema, name, buildFn) => {
  const def = schema?.[name];
  if (!def?.type) return;
  props[name] = buildFn(def.type);
};

const makeRunKey = (generatedAt) => `ops-daily-${toDate(generatedAt)}`;

const collectEvidenceUrls = (report) => {
  const urls = uniqueNonEmpty(
    [
      report?.evidence?.primaryUrl,
      report?.evidence?.opsRunUrl,
      report?.evidence?.canaryLatestUrl,
      report?.evidence?.dryRunLatestUrl,
      report?.evidence?.marketGuardLatestUrl,
      report?.execReadinessNow?.htmlUrl,
      report?.latestGuard?.htmlUrl,
      report?.canary?.latest?.[0]?.htmlUrl,
      report?.dryRun?.latest?.[0]?.htmlUrl,
      report?.marketGuard?.latest?.[0]?.htmlUrl
    ].map(normalizeUrl)
  );
  return {
    primary: urls[0] || null,
    all: urls
  };
};

const writeOutput = (payload) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = async () => {
  const enabled = boolFromEnv("NOTION_OPS_DAILY_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_OPS_DAILY_SYNC_REQUIRED", false);
  const requireEvidenceUrl = boolFromEnv("NOTION_OPS_DAILY_REQUIRE_EVIDENCE_URL", true);
  const token = env("NOTION_TOKEN");
  const databaseId = env("NOTION_DB_DAILY_SNAPSHOT");

  if (!enabled) {
    const out = { at: new Date().toISOString(), status: "skip", reason: "disabled" };
    writeOutput(out);
    console.log("[NOTION_OPS_DAILY] skipped disabled");
    return;
  }

  if (!hasValue(token) || !hasValue(databaseId)) {
    const out = { at: new Date().toISOString(), status: "skip", reason: "missing_token_or_db" };
    writeOutput(out);
    console.log("[NOTION_OPS_DAILY] skipped missing token/db");
    if (required) process.exit(1);
    return;
  }

  const report = readJson(REPORT_PATH);
  if (!report || typeof report !== "object") {
    const out = { at: new Date().toISOString(), status: "skip", reason: "missing_ops_daily_report" };
    writeOutput(out);
    console.log("[NOTION_OPS_DAILY] skipped missing report");
    if (required) process.exit(1);
    return;
  }

  const db = await notionRequest(token, `/v1/databases/${databaseId}`);
  const schema = db?.properties || {};
  const titleProperty = findTitlePropertyName(schema);
  if (!titleProperty) {
    const out = { at: new Date().toISOString(), status: "fail", reason: "missing_title_property" };
    writeOutput(out);
    console.error("[NOTION_OPS_DAILY] fail missing title property");
    process.exit(1);
  }

  const runKey = makeRunKey(report.generatedAt || new Date().toISOString());
  const nowIso = new Date().toISOString();
  const evidence = collectEvidenceUrls(report);
  const summary = [
    `ops_daily=${String(report.status || "n/a").toUpperCase()}`,
    `canary=${report?.canary?.success ?? 0}/${report?.canary?.completed ?? 0}`,
    `dryrun=${report?.dryRun?.success ?? 0}/${report?.dryRun?.completed ?? 0}`,
    `verify=${report?.canaryVerify?.parsed ?? 0}/${report?.canaryVerify?.inspected ?? 0}`,
    `canaryFresh=${String(report?.canaryFreshness?.status || "unknown")}`,
    `execReady=${String(report?.execReadinessNow?.status || "UNKNOWN")}`,
    `preflight=${report?.canaryVerify?.preflightPassRuns ?? 0}/${report?.canaryVerify?.parsed ?? 0}`,
    `submit=${report?.canaryVerify?.submittedTotal ?? 0}/${report?.canaryVerify?.attemptedTotal ?? 0}`,
    `notionAudit=${String(report?.notionAudit?.status || "n/a")}`,
    `evidence=${evidence.primary || "n/a"}`
  ].join(" | ");

  const properties = {
    [titleProperty]: titleProp(runKey)
  };

  const statusName = findPropertyAlias(schema, ["Status"], ["select", "status"]);
  if (statusName) {
    const val = String(report.status || "warn").toUpperCase();
    if (schema[statusName].type === "status") properties[statusName] = statusProp(val);
    else properties[statusName] = selectProp(val);
  }

  const sourceName = findPropertyAlias(schema, ["Source"], ["select", "rich_text"]);
  if (sourceName) {
    if (schema[sourceName].type === "select") properties[sourceName] = selectProp("ops_daily");
    else properties[sourceName] = textProp("ops_daily");
  }

  const engineName = findPropertyAlias(schema, ["Engine"], ["select", "rich_text"]);
  if (engineName) {
    if (schema[engineName].type === "select") properties[engineName] = selectProp("mcp_ops_daily");
    else properties[engineName] = textProp("mcp_ops_daily");
  }

  const summaryName = findPropertyAlias(schema, ["Summary"], ["rich_text"]);
  if (summaryName) properties[summaryName] = textProp(summary);

  const timeName = findPropertyAlias(schema, ["Time", "Date"], ["date"]);
  if (timeName) {
    const isTime = timeName.toLowerCase() === "time";
    properties[timeName] = isTime ? dateTimeProp(report.generatedAt || nowIso) : dateProp(report.generatedAt || nowIso);
  }

  const runDateName = findPropertyAlias(schema, ["Run Date"], ["rich_text", "title"]);
  if (runDateName && runDateName !== titleProperty) {
    if (schema[runDateName].type === "rich_text") properties[runDateName] = textProp(runKey);
  }

  const payloadCountName = findPropertyAlias(schema, ["Payload Count"], ["number"]);
  if (payloadCountName) properties[payloadCountName] = numberProp(report?.canaryVerify?.submittedTotal ?? null);

  const skippedCountName = findPropertyAlias(schema, ["Skipped Count"], ["number"]);
  if (skippedCountName)
    properties[skippedCountName] = numberProp(
      Math.max(0, Number(report?.canaryVerify?.attemptedTotal || 0) - Number(report?.canaryVerify?.submittedTotal || 0))
    );

  const evidenceUrlName = findPropertyAlias(schema, ["Evidence URL", "Run URL", "Workflow URL"], ["url", "rich_text"]);
  const evidenceLinksName = findPropertyAlias(schema, ["Evidence URLs", "Evidence Links"], ["rich_text"]);
  if (requireEvidenceUrl && !evidence.primary) {
    throw new Error("missing_evidence_url");
  }
  if (requireEvidenceUrl && !evidenceUrlName && !evidenceLinksName) {
    throw new Error("missing_evidence_url_property");
  }

  if (evidence.primary && evidenceUrlName) {
    if (schema[evidenceUrlName].type === "url") properties[evidenceUrlName] = urlProp(evidence.primary);
    if (schema[evidenceUrlName].type === "rich_text") properties[evidenceUrlName] = textProp(evidence.primary);
  }
  if (evidence.all.length > 0 && evidenceLinksName) {
    properties[evidenceLinksName] = textProp(evidence.all.join(" | "));
  }

  const existing = await queryByTitle(token, databaseId, titleProperty, runKey);
  let action = "created";
  if (existing?.id) {
    await notionRequest(token, `/v1/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties })
    });
    action = "updated";
  } else {
    await notionRequest(token, "/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties
      })
    });
  }

  const out = {
    at: nowIso,
    status: "ok",
    action,
    runKey,
    databaseId,
    summary,
    requireEvidenceUrl,
    evidencePrimary: evidence.primary,
    evidenceCount: evidence.all.length,
    evidenceUrlProperty: evidenceUrlName || null,
    evidenceLinksProperty: evidenceLinksName || null
  };
  writeOutput(out);
  console.log(`[NOTION_OPS_DAILY] ok action=${action} runKey=${runKey}`);
};

main().catch((error) => {
  const required = boolFromEnv("NOTION_OPS_DAILY_SYNC_REQUIRED", false);
  const out = {
    at: new Date().toISOString(),
    status: "fail",
    reason: error instanceof Error ? error.message : String(error)
  };
  writeOutput(out);
  console.error(`[NOTION_OPS_DAILY] fail: ${out.reason}`);
  if (required) process.exit(1);
});
