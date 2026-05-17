import fs from "node:fs";

const NOTION_VERSION = "2022-06-28";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const STATE_DIR = String(process.env.PAPER_OCO_RESULT_STATE_DIR || process.env.PAPER_OCO_SUBMIT_STATE_DIR || "state").trim() || "state";
const REPORT_PATH = `${STATE_DIR}/paper-oco-canary-result-report.json`;

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const short = (value, max = 1800) => String(value ?? "").trim().slice(0, max);
const boolEnv = (name, fallback = false) => {
  const raw = env(name);
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  return fallback;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return null; }
};

const headers = (token) => ({ Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" });
const notionRequest = async (token, path, init = {}) => {
  const maxRetries = Math.max(0, Math.min(5, Number(env("NOTION_SYNC_MAX_RETRIES", "2")) || 2));
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`https://api.notion.com${path}`, { ...init, headers: { ...headers(token), ...(init.headers || {}) } });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (response.ok) return data;
    if (!RETRYABLE.has(response.status) || attempt >= maxRetries) {
      throw new Error(`Notion ${path} failed (${response.status}): ${JSON.stringify(data).slice(0, 400)}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60000, retryAfter * 1000) : Math.min(10000, 1000 * (2 ** attempt));
    console.log(`[NOTION_RETRY] path=${path} status=${response.status} attempt=${attempt + 1}/${maxRetries + 1} waitMs=${waitMs}`);
    await sleep(waitMs);
  }
  throw new Error(`Notion ${path} failed: exhausted retries`);
};

const findTitlePropertyName = (schema) => Object.entries(schema || {}).find(([, def]) => def?.type === "title")?.[0] || null;
const titleProp = (value) => ({ title: [{ text: { content: short(value, 200) } }] });
const textProp = (value) => ({ rich_text: [{ text: { content: short(value, 1900) } }] });
const selectProp = (value) => ({ select: { name: short(value || "N/A", 100) } });
const checkboxProp = (value) => ({ checkbox: Boolean(value) });
const dateTimeProp = (value) => ({ date: { start: new Date(value || Date.now()).toISOString() } });
const setAliases = (target, schema, names, handlers) => {
  for (const name of names) {
    const type = schema?.[name]?.type;
    const handler = handlers[type];
    if (!type || !handler) continue;
    target[name] = handler();
    return true;
  }
  return false;
};
const queryByTitle = async (token, databaseId, titleName, titleValue) => {
  const data = await notionRequest(token, `/v1/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ filter: { property: titleName, title: { equals: titleValue } }, page_size: 1 })
  });
  return Array.isArray(data?.results) && data.results.length ? data.results[0] : null;
};
const upsert = async (token, databaseId, titleName, titleValue, properties) => {
  const existing = await queryByTitle(token, databaseId, titleName, titleValue);
  if (existing?.id) {
    await notionRequest(token, `/v1/pages/${existing.id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
    return "updated";
  }
  await notionRequest(token, "/v1/pages", { method: "POST", body: JSON.stringify({ parent: { database_id: databaseId }, properties }) });
  return "created";
};

const main = async () => {
  const token = env("NOTION_TOKEN");
  const databaseId = env("NOTION_DB_AUTOMATION_INCIDENT_LOG");
  const required = boolEnv("NOTION_PAPER_OCO_CANARY_RESULT_SYNC_REQUIRED", false);
  const enabled = boolEnv("NOTION_PAPER_OCO_CANARY_RESULT_SYNC_ENABLED", true);
  if (!enabled) {
    console.log("[NOTION_PAPER_OCO_CANARY_RESULT] skip disabled_by_env");
    return;
  }
  if (!token || !databaseId) {
    const message = "[NOTION_PAPER_OCO_CANARY_RESULT] skip missing NOTION_TOKEN or NOTION_DB_AUTOMATION_INCIDENT_LOG";
    if (required) throw new Error(message);
    console.log(message);
    return;
  }
  const report = readJson(REPORT_PATH);
  if (!report) {
    const message = `[NOTION_PAPER_OCO_CANARY_RESULT] skip missing ${REPORT_PATH}`;
    if (required) throw new Error(message);
    console.log(message);
    return;
  }

  const runId = env("GITHUB_RUN_ID", "local");
  const repo = env("GITHUB_REPOSITORY", "local/repo");
  const server = env("GITHUB_SERVER_URL", "https://github.com");
  const runUrl = repo && runId !== "local" ? `${server}/${repo}/actions/runs/${runId}` : "N/A";
  const key = `paper-oco-canary-result-${runId}-${report.selected?.symbol || "none"}`;
  const summary = [
    `overall=${report.overall}`,
    `selected=${report.selected?.symbol || "N/A"}`,
    `qty=${report.selected?.qty ?? "N/A"}`,
    `attempted=${report.brokerMutation?.attempted}`,
    `submitted=${report.brokerMutation?.submitted}`,
    `visibility=${report.visibility?.ok}`,
    `rollback=${report.rollback?.ok}`,
    `terminal=${report.idempotency?.terminal}`,
    `clientOrderId=${report.selected?.clientOrderId || "N/A"}`
  ].join(" | ");

  const db = await notionRequest(token, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titleName = findTitlePropertyName(schema) || "Incident Key";
  const properties = { [titleName]: titleProp(key) };
  setAliases(properties, schema, ["Workflow"], { select: () => selectProp("paper-oco-submit-canary"), rich_text: () => textProp("paper-oco-submit-canary") });
  setAliases(properties, schema, ["RunId", "Run ID"], { rich_text: () => textProp(runId) });
  setAliases(properties, schema, ["Run URL", "Workflow Run URL"], { url: () => ({ url: runUrl === "N/A" ? null : runUrl }), rich_text: () => textProp(runUrl) });
  setAliases(properties, schema, ["Occurred At", "Time", "Date"], { date: () => dateTimeProp(report.generatedAt), rich_text: () => textProp(report.generatedAt) });
  setAliases(properties, schema, ["Kind", "Mode"], { select: () => selectProp("paper_oco_canary_result"), rich_text: () => textProp("paper_oco_canary_result") });
  setAliases(properties, schema, ["Component"], { select: () => selectProp("paper_oco_canary"), rich_text: () => textProp("paper_oco_canary") });
  setAliases(properties, schema, ["Source"], { select: () => selectProp("paper_oco_submit_gate"), rich_text: () => textProp("paper_oco_submit_gate") });
  setAliases(properties, schema, ["Status"], { select: () => selectProp(report.overall === "pass" ? "resolved" : "open"), rich_text: () => textProp(report.overall === "pass" ? "resolved" : "open") });
  setAliases(properties, schema, ["Resolved"], { checkbox: () => checkboxProp(report.overall === "pass") });
  setAliases(properties, schema, ["Severity"], { select: () => selectProp(report.overall === "pass" ? "P3" : "P1"), rich_text: () => textProp(report.overall === "pass" ? "P3" : "P1") });
  setAliases(properties, schema, ["Error Class"], { select: () => selectProp(report.overall === "pass" ? "CanaryPass" : "ExecutionError"), rich_text: () => textProp(report.overall === "pass" ? "CanaryPass" : "ExecutionError") });
  setAliases(properties, schema, ["Root Cause"], { rich_text: () => textProp(summary) });
  setAliases(properties, schema, ["Fix"], { rich_text: () => textProp(report.overall === "pass" ? "No fix required; canary submit/visibility/rollback/ledger terminal passed." : "Inspect paper OCO canary result report and broker rollback state immediately.") });
  setAliases(properties, schema, ["Next Action", "Action"], { rich_text: () => textProp(report.overall === "pass" ? "Design persistent protective OCO repair lane; do not scale beyond one paper row without separate approval." : "Block promotion and repair failed canary state before rerun.") });
  setAliases(properties, schema, ["Fingerprint", "Issue Fingerprint"], { rich_text: () => textProp(`paper_oco_canary_result|${report.selected?.symbol || "none"}|${report.overall}`) });
  setAliases(properties, schema, ["Summary"], { rich_text: () => textProp(summary) });

  const status = await upsert(token, databaseId, titleName, key, properties);
  console.log(`[NOTION_PAPER_OCO_CANARY_RESULT] ${status} key=${key} overall=${report.overall} selected=${report.selected?.symbol || "none"}`);
};

main().catch((error) => {
  console.error(`[NOTION_PAPER_OCO_CANARY_RESULT] FAIL ${short(error?.stack || error?.message || error, 2000)}`);
  process.exit(1);
});
