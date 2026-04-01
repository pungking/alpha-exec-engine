import fs from "node:fs";

const NOTION_VERSION = "2022-06-28";
const RETRYABLE_NOTION_STATUS = new Set([429, 500, 502, 503, 504]);

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const hasValue = (value) => String(value ?? "").trim().length > 0;

const boolFromEnv = (name, fallback = true) => {
  const raw = env(name);
  if (!raw) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const shortText = (value, max = 1800) => String(value ?? "").trim().slice(0, max);
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toIsoDateTime = (isoLike) => {
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
};

const toDateOnly = (isoLike) => {
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const readJson = (path) => {
  if (!path || !fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const notionHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json"
});

const notionRequest = async (token, path, init = {}) => {
  const maxRetriesRaw = Number(env("NOTION_SYNC_MAX_RETRIES", "2"));
  const maxRetries = Number.isFinite(maxRetriesRaw) ? Math.max(0, Math.min(5, Math.trunc(maxRetriesRaw))) : 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
    if (response.ok) {
      return data;
    }

    const message = `Notion ${path} failed (${response.status}): ${JSON.stringify(data).slice(0, 400)}`;
    const retryable = RETRYABLE_NOTION_STATUS.has(response.status);
    if (!retryable || attempt >= maxRetries) {
      throw new Error(message);
    }

    const retryAfterRaw = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
      ? Math.min(60000, retryAfterRaw * 1000)
      : Math.min(10000, 1000 * (2 ** attempt));
    console.log(
      `[NOTION_RETRY] path=${path} status=${response.status} attempt=${attempt + 1}/${maxRetries + 1} waitMs=${waitMs}`
    );
    await sleep(waitMs);
  }
  throw new Error(`Notion ${path} failed: exhausted retries`);
};

const findTitlePropertyName = (schema) => {
  const entries = Object.entries(schema || {});
  const hit = entries.find(([, def]) => String(def?.type || "") === "title");
  return hit ? hit[0] : null;
};

const titleProp = (value) => ({
  title: [{ text: { content: shortText(value, 200) } }]
});

const textProp = (value) => ({
  rich_text: [{ text: { content: shortText(value, 1900) } }]
});

const numberProp = (value) => ({
  number: toNumber(value)
});

const toRoundedNumber = (value, digits = 2) => {
  const n = toNumber(value);
  if (n == null) return null;
  return Number(n.toFixed(digits));
};

const numberFormatFromSchema = (schema, propertyName) => {
  const def = schema?.[propertyName];
  if (!def || def.type !== "number") return "";
  const format = def?.number?.format ?? def?.number_format ?? "";
  return String(format || "").toLowerCase();
};

const normalizeNumberForProperty = (schema, propertyName, value, options = {}) => {
  const { digits = 2, percentFromWhole = false } = options;
  let n = toRoundedNumber(value, digits);
  if (n == null) return null;
  const format = numberFormatFromSchema(schema, propertyName);
  if (format === "percent" && percentFromWhole && Math.abs(n) > 1) {
    // Notion percent-format numbers use 0~1 scale for 0~100%.
    n = Number((n / 100).toFixed(Math.min(6, digits + 2)));
  }
  return n;
};

const resolveNumberByAliases = (schema, names, value, options = {}) => {
  for (const name of names) {
    if (schema?.[name]?.type !== "number") continue;
    return normalizeNumberForProperty(schema, name, value, options);
  }
  return toRoundedNumber(value, options.digits ?? 2);
};
const checkboxProp = (value) => ({
  checkbox: Boolean(value)
});

const dateProp = (value) => ({
  date: { start: toDateOnly(value) }
});
const dateTimeProp = (value) => ({
  date: { start: toIsoDateTime(value) }
});

const selectProp = (value) => ({
  select: { name: shortText(value, 100) || "Partial" }
});

const queryExistingByTitle = async (token, databaseId, titlePropertyName, titleValue) => {
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

const queryPagesByRichText = async (token, databaseId, richTextPropertyName, value, pageSize = 10) => {
  if (!richTextPropertyName || !hasValue(value)) return [];
  const payload = {
    filter: {
      property: richTextPropertyName,
      rich_text: { equals: String(value) }
    },
    page_size: Math.max(1, Math.min(100, pageSize))
  };
  const data = await notionRequest(token, `/v1/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return Array.isArray(data?.results) ? data.results : [];
};

const upsertPage = async (token, databaseId, titlePropertyName, titleValue, properties) => {
  const existing = await queryExistingByTitle(token, databaseId, titlePropertyName, titleValue);
  if (existing?.id) {
    await notionRequest(token, `/v1/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties })
    });
    return "updated";
  }

  await notionRequest(token, "/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties
    })
  });
  return "created";
};

const setProperty = (target, schema, name, handlers) => {
  const def = schema?.[name];
  if (!def || !def.type) return;
  const handler = handlers[def.type];
  if (!handler) return;
  target[name] = handler();
};

const setPropertyAliases = (target, schema, names, handlers) => {
  for (const name of names) {
    const def = schema?.[name];
    if (!def || !def.type) continue;
    const handler = handlers[def.type];
    if (!handler) continue;
    target[name] = handler();
    return true;
  }
  return false;
};

const findPropertyAlias = (schema, names, allowedTypes = []) => {
  for (const name of names) {
    const def = schema?.[name];
    if (!def || !def.type) continue;
    if (allowedTypes.length > 0 && !allowedTypes.includes(def.type)) continue;
    return name;
  }
  return null;
};

const readPagePropertyValue = (page, schema, name) => {
  if (!page?.properties || !schema?.[name]) return "";
  const prop = page.properties[name];
  const def = schema[name];
  if (!prop || !def?.type) return "";
  switch (def.type) {
    case "title":
      return (prop.title || []).map((row) => row.plain_text || row.text?.content || "").join("").trim();
    case "rich_text":
      return (prop.rich_text || []).map((row) => row.plain_text || row.text?.content || "").join("").trim();
    case "select":
      return String(prop.select?.name || "").trim();
    case "status":
      return String(prop.status?.name || "").trim();
    case "number":
      return Number.isFinite(prop.number) ? String(prop.number) : "";
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "date":
      return String(prop.date?.start || "").trim();
    default:
      return "";
  }
};

const readPagePropertyNumber = (page, schema, name) => {
  if (!page?.properties || !schema?.[name]) return null;
  const def = schema[name];
  const prop = page.properties[name];
  if (!prop || def?.type !== "number") return null;
  return toNumber(prop.number);
};

const isResolvedIncidentStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "resolved" || normalized === "closed" || normalized === "done";
};

const flattenCounts = (obj) => {
  if (!obj || typeof obj !== "object") return "none";
  const entries = Object.entries(obj)
    .map(([key, value]) => [String(key), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}:${value}`).join(",");
};

const resolveMarketCondition = ({ profile, vix, level }) => {
  const normalized = String(profile || "").toLowerCase();
  const vixNum = toNumber(vix);
  const levelNum = toNumber(level);
  if (levelNum !== null && levelNum >= 3) return "VOLATILE";
  if (vixNum !== null && vixNum >= 30) return "VOLATILE";
  if (normalized === "risk_off") return "BEAR";
  if (vixNum !== null && vixNum >= 24) return "BEAR";
  if (vixNum !== null && vixNum <= 18) return "BULL";
  return "NEUTRAL";
};

const buildDryRunPayload = () => {
  const state = readJson("state/last-run.json") || {};
  const preview = readJson("state/last-dry-exec-preview.json") || {};
  const stage6File = state.lastStage6FileName || "N/A";
  const stage6Hash = shortText(state.lastStage6Sha256 || "", 64);
  const payloadCount = Number(preview.payloadCount ?? 0);
  const skippedCount = Number(preview.skippedCount ?? 0);
  const gate = preview?.hfTuningPhase?.gateStatus || "N/A";
  const livePromotion = preview?.hfLivePromotion?.status || "N/A";
  const regime = preview?.regime || {};
  const stage6Contract = preview?.stage6Contract || {};
  const hfGate = preview?.hfSentimentGate || {};
  const preflight = preview?.preflight || {};
  const guardControl = preview?.guardControl || {};
  const mode = preview?.mode || {};
  const vixLevel = toNumber(regime?.vix);
  const stage6Count = toNumber(stage6Contract?.checked);
  const finalPicksCount = toNumber(stage6Contract?.executable);
  const marketCondition = resolveMarketCondition({
    profile: regime?.profile,
    vix: regime?.vix
  });
  const summary = [
    "source=sidecar_dry_run",
    `stage6File=${stage6File}`,
    `stage6Hash=${stage6Hash ? stage6Hash.slice(0, 12) : "N/A"}`,
    `payloads=${payloadCount}`,
    `skipped=${skippedCount}`,
    `skipReasons=${flattenCounts(preview.skipReasonCounts)}`,
    `preflight=${preflight.status ?? "N/A"}:${preflight.code ?? "N/A"}`,
    `guardLevel=${guardControl.level ?? "N/A"}`,
    `guardBlocked=${guardControl.blocked ?? "N/A"}`,
    `hfGate=${gate}`,
    `hfLivePromotion=${livePromotion}`,
    `hfApplied=${hfGate.applied ?? "N/A"}`,
    `execEnabled=${mode.execEnabled ?? "N/A"}`,
    `readOnly=${mode.readOnly ?? "N/A"}`
  ].join(" ");
  return {
    engine: "sidecar_dry_run",
    source: "sidecar_dry_run",
    date: state.lastSentAt || preview?.generatedAt || new Date().toISOString(),
    stage6Count,
    finalPicksCount,
    vixLevel,
    marketCondition,
    stage6File,
    stage6HashShort: stage6Hash ? stage6Hash.slice(0, 12) : "N/A",
    payloadCount,
    skippedCount,
    guardLevel: guardControl.level ?? "N/A",
    hfGateStatus: gate,
    hfLivePromotion: livePromotion,
    topTickers: `${stage6File} (${stage6Hash ? stage6Hash.slice(0, 12) : "N/A"})`,
    summary
  };
};

const buildMarketGuardPayload = () => {
  const guard = readJson("state/last-market-guard.json") || {};
  const guardState = readJson("state/market-guard-state.json") || {};
  const control = readJson("state/guard-control.json") || {};
  const vixLevel = toNumber(guard?.vix);
  const marketCondition = resolveMarketCondition({
    vix: guard?.vix,
    level: guard?.level
  });
  const summary = [
    "source=sidecar_market_guard",
    `level=L${guard.level ?? "N/A"}`,
    `raw=L${guard.rawLevel ?? "N/A"}`,
    `vix=L${guard.vixLevel ?? "N/A"}`,
    `index=L${guard.indexLevel ?? "N/A"}`,
    `signal=${guard.vixSource || "N/A"}`,
    `vixValue=${guard.vix ?? "N/A"}`,
    `indexDrop=${guard.indexWorstDropPct ?? "N/A"}`,
    `mode=${guard.mode || "N/A"}`,
    `runActions=${guard.shouldRunActions ?? "N/A"}`,
    `actionReason=${guard.actionReason || "N/A"}`,
    `haltNewEntries=${control.haltNewEntries ?? "N/A"}`,
    `controlLevel=${control.level ?? "N/A"}`,
    `cooldownUntil=${guardState.cooldownUntil || "N/A"}`
  ].join(" ");
  return {
    engine: "sidecar_market_guard",
    source: "sidecar_market_guard",
    date: guard.generatedAt || new Date().toISOString(),
    vixLevel,
    marketCondition,
    stage6Count: null,
    finalPicksCount: null,
    stage6File: "N/A",
    stage6HashShort: "N/A",
    payloadCount: null,
    skippedCount: null,
    guardLevel: guard.level ?? "N/A",
    hfGateStatus: "N/A",
    hfLivePromotion: "N/A",
    actionReason: guard.actionReason || "N/A",
    runActions: guard.shouldRunActions ?? "N/A",
    topTickers: `L${guard.level ?? "N/A"} ${guard.actionReason || "N/A"}`,
    summary
  };
};

const normalizeGuardResult = (rawStatus) => {
  const status = String(rawStatus || "").trim().toLowerCase();
  if (status === "executed") return "submitted";
  if (status === "failed") return "failed";
  return "skipped";
};

const buildGuardActionRows = (runKey) => {
  const guard = readJson("state/last-market-guard.json") || {};
  const records = Array.isArray(guard?.actionResult?.records) ? guard.actionResult.records : [];
  const fallbackTime = guard.generatedAt || new Date().toISOString();
  const level = guard.level ?? null;
  const source = "sidecar_market_guard";
  const engine = "sidecar_market_guard";
  if (records.length === 0) {
    return [
      {
        title: `${runKey}:none`,
        runKey,
        time: fallbackTime,
        level,
        action: "none",
        symbol: "N/A",
        result: "skipped",
        reason: shortText(guard.actionReason || "no_action_records", 500),
        orderId: "N/A",
        rawStatus: "none",
        source,
        engine
      }
    ];
  }
  return records.map((row, index) => {
    const action = String(row?.action || `action_${index + 1}`);
    const rawStatus = String(row?.status || "unknown");
    const reasonTokens = [row?.reason, row?.detail].filter(Boolean).map((v) => String(v));
    return {
      title: `${runKey}:${action}`,
      runKey,
      time: row?.lastSeenAt || fallbackTime,
      level,
      action,
      symbol: "N/A",
      result: normalizeGuardResult(rawStatus),
      reason: shortText(reasonTokens.join(" | ") || "N/A", 500),
      orderId: "N/A",
      rawStatus,
      source,
      engine
    };
  });
};

const buildHfTuningTrackerRow = (runKey, statusRaw) => {
  const preview = readJson("state/last-dry-exec-preview.json") || {};
  const state = readJson("state/last-run.json") || {};
  const tuning = preview?.hfTuningPhase || {};
  const perfLoop = preview?.perfLoop || {};
  const freeze = preview?.hfFreeze || {};
  const live = preview?.hfLivePromotion || {};
  const probe = preview?.hfPayloadProbeStatus || preview?.hfPayloadProbe || {};
  const alert = preview?.hfAlert || {};
  const nextAction = preview?.hfNextAction || {};
  const dailyVerdict = preview?.hfDailyVerdict || {};
  const stage6File = state.lastStage6FileName || preview.stage6File || "N/A";
  const stage6Hash = shortText(state.lastStage6Sha256 || preview.stage6Hash || "", 64);

  const alertStatus = alert?.triggered ? "TRIGGERED" : "CLEAR";
  const alertDetail = `${alertStatus}:${alert?.reason || (alert?.triggered ? "unknown" : "none")}`;
  const decisionStatus = String(nextAction?.status || dailyVerdict?.status || "N/A").toUpperCase();
  const decisionText = [
    decisionStatus,
    nextAction?.action || dailyVerdict?.action || "N/A",
    nextAction?.reason || dailyVerdict?.reason || "N/A"
  ].join(" | ");

  return {
    title: runKey,
    runKey,
    time: state.lastSentAt || preview.generatedAt || new Date().toISOString(),
    gateProgress: tuning?.gateProgress || "N/A",
    perfGate: perfLoop?.gateStatus || tuning?.gateStatus || "N/A",
    freezeStatus: freeze?.status || "N/A",
    livePromotion: live?.status || "N/A",
    payloadProbe: probe?.status || "N/A",
    alertStatus,
    alertDetail: shortText(alertDetail, 300),
    decisionStatus: shortText(decisionStatus, 100),
    decisionText: shortText(decisionText, 500),
    stage6File,
    stage6Hash: stage6Hash ? stage6Hash.slice(0, 12) : "N/A",
    source: "sidecar_dry_run",
    engine: "sidecar_dry_run",
    statusRaw
  };
};

const workflowLabelForKind = (kind) => {
  if (kind === "market_guard") return "market-guard";
  return "dry-run";
};

const runUrlFromEnv = () => {
  const server = env("GITHUB_SERVER_URL", "https://github.com");
  const repo = env("GITHUB_REPOSITORY");
  const runId = env("GITHUB_RUN_ID");
  if (!repo || !runId) return "";
  return `${server}/${repo}/actions/runs/${runId}`;
};

const readText = (path, maxLen = 200000) => {
  if (!path || !fs.existsSync(path)) return "";
  try {
    return String(fs.readFileSync(path, "utf8") || "").slice(0, maxLen);
  } catch {
    return "";
  }
};

const slugify = (value, max = 80) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);

const parseErrorClassFromMessage = (message) => {
  const text = String(message || "").toLowerCase();
  if (!text) return "Unknown";
  if (text.includes("hf_alert") || text.includes("drift") || text.includes("marker")) return "DataError";
  if (text.includes("auth") || text.includes("credential") || text.includes("forbidden") || text.includes("401")) {
    return "AuthError";
  }
  if (text.includes("timeout")) return "Timeout";
  if (
    text.includes("network") ||
    text.includes("dns") ||
    text.includes("econn") ||
    text.includes("503") ||
    text.includes("502")
  ) {
    return "NetworkError";
  }
  if (text.includes("rate") || text.includes("429")) return "RateLimit";
  if (text.includes("missing") || text.includes("invalid") || text.includes("config")) return "ConfigError";
  if (text.includes("parse") || text.includes("schema") || text.includes("data")) return "DataError";
  return "Unknown";
};

const parseErrorClassFromOpsHealthCheck = (check) => {
  const id = String(check?.id || "").toLowerCase();
  if (id.includes("workflow") || id.includes("job")) return "ConfigError";
  if (id.includes("auth") || id.includes("credential")) return "AuthError";
  if (id.includes("network") || id.includes("timeout") || id.includes("rate")) return "NetworkError";
  if (
    id.includes("hf_alert") ||
    id.includes("marker") ||
    id.includes("return_outlier") ||
    id.includes("perf") ||
    id.includes("stage")
  ) {
    return "DataError";
  }
  return parseErrorClassFromMessage(`${check?.id || ""} ${check?.detail || ""}`);
};

const severityFromErrorClass = (errorClass) => {
  switch (String(errorClass || "")) {
    case "AuthError":
    case "ConfigError":
      return "P1";
    case "NetworkError":
    case "Timeout":
    case "RateLimit":
    case "DataError":
      return "P2";
    default:
      return "P2";
  }
};

const fixTemplateByErrorClass = (errorClass) => {
  switch (String(errorClass || "")) {
    case "AuthError":
      return "Check secret/token validity and integration permissions, then rerun workflow.";
    case "ConfigError":
      return "Validate required env/vars naming and values, then rerun workflow.";
    case "NetworkError":
      return "Retry run once; if persistent, verify provider/API availability and fallback sources.";
    case "Timeout":
      return "Increase timeout/retry or reduce request volume and rerun workflow.";
    case "RateLimit":
      return "Throttle request frequency, stagger schedules, and rerun after cooldown.";
    case "DataError":
      return "Inspect source payload/schema mismatch and patch parser/guard before rerun.";
    default:
      return "Inspect logs, identify root cause, patch safely, and rerun workflow.";
  }
};

const buildOpsHealthCheckIncident = ({ runKey, workflow, runId, runUrl, kind, check }) => {
  const id = slugify(check?.id || "ops_health");
  const status = String(check?.status || "").toLowerCase();
  const detail = shortText(check?.detail || "ops_health_check_triggered", 500);
  const errorClass = parseErrorClassFromOpsHealthCheck(check);
  const severity = status === "fail" ? "P1" : "P2";
  return {
    title: `${runKey}:ops_health:${id}:${status || "warn"}`,
    workflow,
    runId,
    runUrl,
    kind,
    component: "ops_health",
    source: "ops_health_report",
    occurredAt: new Date().toISOString(),
    errorClass,
    severity,
    rootCause: shortText(`${check?.id || "ops_health"} | ${detail}`, 500),
    fix: fixTemplateByErrorClass(errorClass),
    nextAction: shortText(
      `Open ${workflow} run logs, focus on check=${check?.id || "unknown"}, then rerun after fix.`,
      500
    ),
    fingerprint: slugify(`${workflow}|${kind}|ops_health|${id}|${status || "warn"}`, 120),
    resolved: false
  };
};

const buildAutomationIncidents = ({ kind, runKey, statusRaw }) => {
  const workflow = workflowLabelForKind(kind);
  const runId = env("GITHUB_RUN_ID", "local");
  const runUrl = runUrlFromEnv() || "N/A";
  const runAttempt = env("GITHUB_RUN_ATTEMPT", "1");
  const occurredAt = new Date().toISOString();
  const incidentByFingerprint = new Map();
  const incidents = [];
  const pushIncident = (incident) => {
    const fingerprint =
      shortText(
        incident?.fingerprint ||
          slugify(
            `${incident?.workflow || workflow}|${incident?.kind || kind}|${incident?.errorClass || "Unknown"}|${
              incident?.rootCause || incident?.title || "unknown"
            }`,
            120
          ),
        120
      ) || `fp_${incidents.length + 1}`;
    if (incidentByFingerprint.has(fingerprint)) return;
    incidentByFingerprint.set(fingerprint, true);
    incidents.push({
      ...incident,
      workflow,
      runId,
      runUrl,
      kind,
      occurredAt,
      fingerprint
    });
  };

  if (statusRaw !== "success") {
    pushIncident({
      title: `${runKey}:job:${statusRaw}`,
      errorClass: "Unknown",
      severity: "P1",
      rootCause: `workflow_status_${statusRaw}`,
      fix: "Inspect failing step logs, patch root cause, rerun workflow.",
      nextAction: "Open failed step in GitHub Actions and apply minimal safe fix before rerun.",
      component: "workflow",
      source: "gha_status",
      fingerprint: slugify(`${workflow}|${kind}|workflow_status_${statusRaw}|attempt_${runAttempt}`, 120),
      resolved: false
    });
  }

  if (kind === "market_guard") {
    const guard = readJson("state/last-market-guard.json") || {};
    const records = Array.isArray(guard?.actionResult?.records) ? guard.actionResult.records : [];
    for (const row of records) {
      if (String(row?.status || "").toLowerCase() !== "failed") continue;
      const action = String(row?.action || "unknown_action");
      const reason = [row?.reason, row?.detail].filter(Boolean).map((v) => String(v)).join(" | ");
      const errorClass = parseErrorClassFromMessage(reason);
      pushIncident({
        title: `${runKey}:action:${action}:failed`,
        errorClass,
        severity: severityFromErrorClass(errorClass),
        rootCause: shortText(reason || "guard_action_failed", 500),
        fix: fixTemplateByErrorClass(errorClass),
        nextAction: `Inspect market-guard action=${action} failure detail, then rerun market-guard after fix.`,
        component: "market_guard_action",
        source: "market_guard_action_result",
        fingerprint: slugify(`${workflow}|${kind}|action|${action}|${errorClass}`, 120),
        resolved: false
      });
    }
  }

  if (kind === "dry_run") {
    const preview = readJson("state/last-dry-exec-preview.json") || {};
    const hfAlert = preview?.hfAlert || {};
    const logText = readText("state/last-run-output.log");
    const dedupeRun = logText.includes("[DEDUPE] SKIP send");
    if (hfAlert?.triggered) {
      const errorClass = parseErrorClassFromMessage(hfAlert?.reason || "hf_alert_triggered");
      pushIncident({
        title: `${runKey}:hf_alert`,
        errorClass,
        severity: dedupeRun ? "P3" : "P2",
        rootCause: shortText(String(hfAlert?.reason || "hf_alert_triggered"), 500),
        fix: fixTemplateByErrorClass(errorClass),
        nextAction: dedupeRun
          ? "Previous alert is still active (dedupe run). Keep observe mode and wait for next non-dedupe sample."
          : "Review HF shadow/drift deltas and rerun validation pack after threshold sanity check.",
        component: "hf_alert",
        source: dedupeRun ? "dry_run_dedupe" : "dry_run_preview",
        fingerprint: slugify(
          `${workflow}|${kind}|hf_alert|${hfAlert?.reason || "hf_alert_triggered"}|dedupe_${dedupeRun}`,
          120
        ),
        resolved: false
      });
    }
  }

  const opsHealth = readJson("state/ops-health-report.json") || {};
  const checks = Array.isArray(opsHealth?.checks) ? opsHealth.checks : [];
  for (const check of checks) {
    const status = String(check?.status || "").toLowerCase();
    if (status !== "warn" && status !== "fail") continue;
    pushIncident(
      buildOpsHealthCheckIncident({
        runKey,
        workflow,
        runId,
        runUrl,
        kind,
        check
      })
    );
  }

  return incidents;
};

const syncAutomationIncidentLog = async ({ notionToken, kind, runKey, statusRaw }) => {
  const enabled = boolFromEnv("NOTION_AUTOMATION_INCIDENT_LOG_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_AUTOMATION_INCIDENT_LOG_SYNC_REQUIRED", false);
  const rollupEnabled = boolFromEnv("NOTION_AUTOMATION_INCIDENT_LOG_ROLLUP_ENABLED", true);
  const databaseId = env("NOTION_DB_AUTOMATION_INCIDENT_LOG");
  if (!enabled) {
    console.log(`[NOTION_AUTOMATION_INCIDENT_LOG] skip: disabled_by_env key=${runKey}`);
    return "skipped_disabled";
  }
  if (!databaseId) {
    const message = `[NOTION_AUTOMATION_INCIDENT_LOG] skip: missing NOTION_DB_AUTOMATION_INCIDENT_LOG key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_db";
  }

  const incidents = buildAutomationIncidents({ kind, runKey, statusRaw });
  if (incidents.length === 0) {
    console.log(`[NOTION_AUTOMATION_INCIDENT_LOG] skip: no_incident key=${runKey}`);
    return "skipped_no_incident";
  }

  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Incident Key";
  const fingerprintPropertyName = findPropertyAlias(schema, ["Fingerprint", "Issue Fingerprint"], ["rich_text"]);
  const statusPropertyName = findPropertyAlias(schema, ["Status"], ["select", "status", "rich_text"]);
  const occurrencesPropertyName = findPropertyAlias(schema, ["Occurrences", "Run Count", "Seen Count"], ["number"]);
  const firstSeenPropertyName = findPropertyAlias(schema, ["First Seen", "First Seen At"], ["date", "rich_text"]);
  const lastSeenPropertyName = findPropertyAlias(schema, ["Last Seen", "Occurred At", "Time", "Date"], [
    "date",
    "rich_text"
  ]);
  let created = 0;
  let updated = 0;

  for (const row of incidents) {
    const properties = {};
    setPropertyAliases(properties, schema, ["Workflow"], {
      select: () => selectProp(row.workflow),
      rich_text: () => textProp(row.workflow)
    });
    setPropertyAliases(properties, schema, ["RunId", "Run ID"], {
      rich_text: () => textProp(row.runId)
    });
    setPropertyAliases(properties, schema, ["Run URL", "Workflow Run URL"], {
      url: () => ({ url: row.runUrl }),
      rich_text: () => textProp(row.runUrl)
    });
    setPropertyAliases(properties, schema, ["Occurred At", "Time", "Date"], {
      date: () => dateTimeProp(row.occurredAt),
      rich_text: () => textProp(row.occurredAt)
    });
    setPropertyAliases(properties, schema, ["Kind", "Mode"], {
      select: () => selectProp(row.kind),
      rich_text: () => textProp(row.kind)
    });
    setPropertyAliases(properties, schema, ["Component"], {
      select: () => selectProp(row.component || "unknown"),
      rich_text: () => textProp(row.component || "unknown")
    });
    setPropertyAliases(properties, schema, ["Source"], {
      select: () => selectProp(row.source || "notion_sync"),
      rich_text: () => textProp(row.source || "notion_sync")
    });
    setPropertyAliases(properties, schema, ["Error Class"], {
      select: () => selectProp(row.errorClass),
      rich_text: () => textProp(row.errorClass)
    });
    setPropertyAliases(properties, schema, ["Severity"], {
      select: () => selectProp(row.severity),
      rich_text: () => textProp(row.severity)
    });
    setPropertyAliases(properties, schema, ["Root Cause"], {
      rich_text: () => textProp(row.rootCause)
    });
    setPropertyAliases(properties, schema, ["Fix"], {
      rich_text: () => textProp(row.fix)
    });
    setPropertyAliases(properties, schema, ["Next Action", "Action"], {
      rich_text: () => textProp(row.nextAction || row.fix)
    });
    setPropertyAliases(properties, schema, ["Fingerprint", "Issue Fingerprint"], {
      rich_text: () => textProp(row.fingerprint)
    });
    setPropertyAliases(properties, schema, ["Status"], {
      select: () => selectProp(row.resolved ? "resolved" : "open"),
      rich_text: () => textProp(row.resolved ? "resolved" : "open")
    });
    setPropertyAliases(properties, schema, ["Resolved"], {
      checkbox: () => checkboxProp(row.resolved)
    });
    let existing = null;
    if (rollupEnabled && fingerprintPropertyName) {
      const matches = await queryPagesByRichText(
        notionToken,
        databaseId,
        fingerprintPropertyName,
        row.fingerprint,
        10
      );
      if (matches.length > 0) {
        existing =
          matches.find((page) => {
            if (!statusPropertyName) return true;
            const statusValue = readPagePropertyValue(page, schema, statusPropertyName);
            return !isResolvedIncidentStatus(statusValue);
          }) || matches[0];
      }
    }
    if (!existing) {
      existing = await queryExistingByTitle(notionToken, databaseId, titlePropertyName, row.title);
    }

    if (existing?.id) {
      const existingFirstSeen =
        readPagePropertyValue(existing, schema, firstSeenPropertyName) ||
        readPagePropertyValue(existing, schema, lastSeenPropertyName) ||
        row.occurredAt;
      const existingOccurrences = readPagePropertyNumber(existing, schema, occurrencesPropertyName);
      if (occurrencesPropertyName) {
        properties[occurrencesPropertyName] = numberProp((existingOccurrences ?? 0) + 1);
      }
      if (firstSeenPropertyName) {
        const firstSeenText = existingFirstSeen || row.occurredAt;
        setPropertyAliases(properties, schema, [firstSeenPropertyName], {
          date: () => dateTimeProp(firstSeenText),
          rich_text: () => textProp(firstSeenText)
        });
      }
      if (lastSeenPropertyName) {
        setPropertyAliases(properties, schema, [lastSeenPropertyName], {
          date: () => dateTimeProp(row.occurredAt),
          rich_text: () => textProp(row.occurredAt)
        });
      }

      await notionRequest(notionToken, `/v1/pages/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties })
      });
      updated += 1;
      continue;
    }

    if (occurrencesPropertyName) {
      properties[occurrencesPropertyName] = numberProp(1);
    }
    if (firstSeenPropertyName) {
      setPropertyAliases(properties, schema, [firstSeenPropertyName], {
        date: () => dateTimeProp(row.occurredAt),
        rich_text: () => textProp(row.occurredAt)
      });
    }
    if (lastSeenPropertyName) {
      setPropertyAliases(properties, schema, [lastSeenPropertyName], {
        date: () => dateTimeProp(row.occurredAt),
        rich_text: () => textProp(row.occurredAt)
      });
    }

    properties[titlePropertyName] = titleProp(row.title);
    await notionRequest(notionToken, "/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties
      })
    });
    created += 1;
  }

  console.log(
    `[NOTION_AUTOMATION_INCIDENT_LOG] synced key=${runKey} rows=${incidents.length} created=${created} updated=${updated} rollup=${rollupEnabled}`
  );
  return `ok(rows=${incidents.length})`;
};

const KEY_ROTATION_CATALOG = [
  { keyName: "NOTION_TOKEN", scope: "Notion" },
  { keyName: "NOTION_DB_DAILY_SNAPSHOT", scope: "GitHub Variables" },
  { keyName: "NOTION_DB_GUARD_ACTION_LOG", scope: "GitHub Variables" },
  { keyName: "NOTION_DB_HF_TUNING_TRACKER", scope: "GitHub Variables" },
  { keyName: "ALPACA_KEY_ID", scope: "Alpaca" },
  { keyName: "ALPACA_SECRET_KEY", scope: "Alpaca" },
  { keyName: "TELEGRAM_TOKEN", scope: "Telegram" },
  { keyName: "GDRIVE_CLIENT_ID", scope: "Google Drive" },
  { keyName: "GDRIVE_CLIENT_SECRET", scope: "Google Drive" },
  { keyName: "GDRIVE_REFRESH_TOKEN", scope: "Google Drive" },
  { keyName: "FINNHUB_API_KEY", scope: "Other" },
  { keyName: "CNBC_RAPIDAPI_KEY", scope: "Other" },
  { keyName: "RAPID_API_KEY", scope: "Other" }
];

const syncKeyRotationLedger = async ({ notionToken, kind, runKey }) => {
  const enabled = boolFromEnv("NOTION_KEY_ROTATION_LEDGER_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_KEY_ROTATION_LEDGER_SYNC_REQUIRED", false);
  const databaseId = env("NOTION_DB_KEY_ROTATION_LEDGER");
  if (!enabled) {
    console.log(`[NOTION_KEY_ROTATION_LEDGER] skip: disabled_by_env key=${runKey}`);
    return "skipped_disabled";
  }
  if (!databaseId) {
    const message = `[NOTION_KEY_ROTATION_LEDGER] skip: missing NOTION_DB_KEY_ROTATION_LEDGER key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_db";
  }

  const rows = KEY_ROTATION_CATALOG.filter((entry) => hasValue(process.env[entry.keyName])).map((entry) => ({
    keyName: entry.keyName,
    scope: entry.scope
  }));
  if (!rows.length) {
    console.log(`[NOTION_KEY_ROTATION_LEDGER] skip: no_visible_keys key=${runKey}`);
    return "skipped_no_keys";
  }

  const verifiedAt = new Date().toISOString();
  const workflow = workflowLabelForKind(kind);
  const note = `auto-verified via ${workflow} (${runKey})`;
  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Key Name";
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const properties = {
      [titlePropertyName]: titleProp(row.keyName)
    };
    setPropertyAliases(properties, schema, ["Scope"], {
      select: () => selectProp(row.scope),
      rich_text: () => textProp(row.scope)
    });
    setPropertyAliases(properties, schema, ["Last Verified At"], {
      date: () => dateTimeProp(verifiedAt),
      rich_text: () => textProp(verifiedAt)
    });
    setPropertyAliases(properties, schema, ["Notes"], {
      rich_text: () => textProp(note)
    });

    const upsertStatus = await upsertPage(notionToken, databaseId, titlePropertyName, row.keyName, properties);
    if (upsertStatus === "created") created += 1;
    if (upsertStatus === "updated") updated += 1;
  }

  console.log(
    `[NOTION_KEY_ROTATION_LEDGER] synced key=${runKey} rows=${rows.length} created=${created} updated=${updated}`
  );
  return `ok(rows=${rows.length})`;
};

const fmtFixed = (value, digits = 2) => {
  const n = toNumber(value);
  if (n == null) return "N/A";
  return Number(n).toFixed(digits);
};

const buildPerformanceDashboardRow = ({ kind, runKey, statusRaw }) => {
  const dashboard = readJson("state/performance-dashboard.json") || {};
  const simulation = dashboard?.simulation || {};
  const live = dashboard?.live || {};
  const chartSeries = Array.isArray(simulation?.chartSeries) ? simulation.chartSeries : [];
  const topWinners = Array.isArray(simulation?.topWinners) ? simulation.topWinners : [];
  const topLosers = Array.isArray(simulation?.topLosers) ? simulation.topLosers : [];

  const seriesCompact = chartSeries
    .slice(-30)
    .map((row) => {
      const at = toIsoDateTime(row?.at || dashboard?.generatedAt || Date.now()).slice(0, 16);
      const fillRatePct = fmtFixed(row?.fillRatePct, 2);
      const avgR = fmtFixed(row?.avgR, 4);
      const closedCount = fmtFixed(row?.closedCount ?? row?.tradeCount, 0);
      return `${at}|${fillRatePct}|${avgR}|${closedCount}`;
    })
    .join(";");

  const winnerText = topWinners
    .slice(0, 5)
    .map((row) => `${String(row?.symbol || "N/A").toUpperCase()}:${fmtFixed(row?.avgReturnPct, 2)}%`)
    .join(", ");
  const loserText = topLosers
    .slice(0, 5)
    .map((row) => `${String(row?.symbol || "N/A").toUpperCase()}:${fmtFixed(row?.avgReturnPct, 2)}%`)
    .join(", ");

  const liveTotals = live?.totals || {};
  const liveAccount = live?.account || {};
  const liveAvailable = Boolean(live?.available);
  const generatedAt = dashboard?.generatedAt || simulation?.updatedAt || new Date().toISOString();
  const summary = [
    `kind=${kind}`,
    `status=${statusRaw}`,
    `batch=${simulation?.batchId || "N/A"}`,
    `simRows=${simulation?.totalRows ?? "N/A"}`,
    `simClosed=${simulation?.closedRows ?? "N/A"}`,
    `simWinRate=${fmtFixed(simulation?.winRatePct, 2)}%`,
    `simAvgClosedR=${fmtFixed(simulation?.avgClosedR, 4)}`,
    `simAvgClosedReturn=${fmtFixed(simulation?.avgClosedReturnPct, 2)}%`,
    `liveAvailable=${liveAvailable}`,
    `livePositions=${liveTotals?.positionCount ?? "N/A"}`,
    `liveUnrealized=${fmtFixed(liveTotals?.totalUnrealizedPl, 2)}`,
    `liveReturnPct=${fmtFixed(liveTotals?.totalReturnPct, 2)}%`,
    `equity=${fmtFixed(liveAccount?.equity, 2)}`
  ].join(" ");

  return {
    title: runKey,
    runKey,
    time: generatedAt,
    kind,
    statusRaw,
    source: `sidecar_${kind}`,
    batchId: shortText(simulation?.batchId || "N/A", 120),
    simulation: {
      totalRows: toNumber(simulation?.totalRows),
      filledRows: toNumber(simulation?.filledRows),
      openRows: toNumber(simulation?.openRows),
      closedRows: toNumber(simulation?.closedRows),
      winRatePct: toRoundedNumber(simulation?.winRatePct, 2),
      avgClosedReturnPct: toRoundedNumber(simulation?.avgClosedReturnPct, 2),
      avgClosedR: toRoundedNumber(simulation?.avgClosedR, 4),
      topWinners: shortText(winnerText || "N/A", 500),
      topLosers: shortText(loserText || "N/A", 500),
      seriesCompact: shortText(seriesCompact || "N/A", 1800)
    },
    live: {
      available: liveAvailable,
      positionCount: toNumber(liveTotals?.positionCount),
      totalUnrealizedPl: toRoundedNumber(liveTotals?.totalUnrealizedPl, 2),
      totalReturnPct: toRoundedNumber(liveTotals?.totalReturnPct, 2),
      equity: toRoundedNumber(liveAccount?.equity, 2)
    },
    summary: shortText(summary, 1800),
    hasData: Boolean(simulation && Object.keys(simulation).length > 0)
  };
};

const syncPerformanceDashboard = async ({ notionToken, kind, runKey, statusRaw }) => {
  const enabled = boolFromEnv("NOTION_PERFORMANCE_DASHBOARD_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_PERFORMANCE_DASHBOARD_SYNC_REQUIRED", false);
  const databaseId = env("NOTION_DB_PERFORMANCE_DASHBOARD");
  if (!enabled) {
    console.log(`[NOTION_PERFORMANCE_DASHBOARD] skip: disabled_by_env key=${runKey}`);
    return "skipped_disabled";
  }
  if (!databaseId) {
    const message = `[NOTION_PERFORMANCE_DASHBOARD] skip: missing NOTION_DB_PERFORMANCE_DASHBOARD key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_db";
  }

  const row = buildPerformanceDashboardRow({ kind, runKey, statusRaw });
  if (!row.hasData) {
    const message = `[NOTION_PERFORMANCE_DASHBOARD] skip: missing state/performance-dashboard.json key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_state";
  }

  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Run Key";

  const properties = {
    [titlePropertyName]: titleProp(row.title)
  };
  setPropertyAliases(properties, schema, ["Run Key"], {
    rich_text: () => textProp(row.runKey)
  });
  setPropertyAliases(properties, schema, ["Time", "Date", "Generated At"], {
    date: () => dateTimeProp(row.time),
    rich_text: () => textProp(row.time)
  });
  setPropertyAliases(properties, schema, ["Kind", "Mode"], {
    select: () => selectProp(row.kind),
    rich_text: () => textProp(row.kind)
  });
  setPropertyAliases(properties, schema, ["Status"], {
    select: () => selectProp(row.statusRaw),
    rich_text: () => textProp(row.statusRaw)
  });
  setPropertyAliases(properties, schema, ["Source"], {
    select: () => selectProp(row.source),
    rich_text: () => textProp(row.source)
  });
  setPropertyAliases(properties, schema, ["Batch ID"], {
    rich_text: () => textProp(row.batchId)
  });

  setPropertyAliases(properties, schema, ["Sim Rows"], {
    number: () => numberProp(row.simulation.totalRows),
    rich_text: () => textProp(row.simulation.totalRows ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Filled"], {
    number: () => numberProp(row.simulation.filledRows),
    rich_text: () => textProp(row.simulation.filledRows ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Open"], {
    number: () => numberProp(row.simulation.openRows),
    rich_text: () => textProp(row.simulation.openRows ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Closed"], {
    number: () => numberProp(row.simulation.closedRows),
    rich_text: () => textProp(row.simulation.closedRows ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Win Rate %"], {
    number: () =>
      numberProp(resolveNumberByAliases(schema, ["Sim Win Rate %"], row.simulation.winRatePct, { digits: 2, percentFromWhole: true })),
    rich_text: () => textProp(row.simulation.winRatePct ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Avg Closed Return %"], {
    number: () =>
      numberProp(
        resolveNumberByAliases(schema, ["Sim Avg Closed Return %"], row.simulation.avgClosedReturnPct, {
          digits: 2,
          percentFromWhole: true
        })
      ),
    rich_text: () => textProp(row.simulation.avgClosedReturnPct ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Avg Closed R"], {
    number: () => numberProp(row.simulation.avgClosedR),
    rich_text: () => textProp(row.simulation.avgClosedR ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Sim Top Winners"], {
    rich_text: () => textProp(row.simulation.topWinners)
  });
  setPropertyAliases(properties, schema, ["Sim Top Losers"], {
    rich_text: () => textProp(row.simulation.topLosers)
  });
  setPropertyAliases(properties, schema, ["Series"], {
    rich_text: () => textProp(row.simulation.seriesCompact)
  });

  setPropertyAliases(properties, schema, ["Live Available"], {
    checkbox: () => checkboxProp(row.live.available),
    rich_text: () => textProp(row.live.available ? "true" : "false")
  });
  setPropertyAliases(properties, schema, ["Live Position Count"], {
    number: () => numberProp(row.live.positionCount),
    rich_text: () => textProp(row.live.positionCount ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Live Unrealized PnL"], {
    number: () => numberProp(row.live.totalUnrealizedPl),
    rich_text: () => textProp(row.live.totalUnrealizedPl ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Live Return %"], {
    number: () =>
      numberProp(resolveNumberByAliases(schema, ["Live Return %"], row.live.totalReturnPct, { digits: 2, percentFromWhole: true })),
    rich_text: () => textProp(row.live.totalReturnPct ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Live Equity"], {
    number: () => numberProp(row.live.equity),
    rich_text: () => textProp(row.live.equity ?? "N/A")
  });
  setPropertyAliases(properties, schema, ["Summary"], {
    rich_text: () => textProp(row.summary)
  });

  const upsertStatus = await upsertPage(notionToken, databaseId, titlePropertyName, row.title, properties);
  console.log(
    `[NOTION_PERFORMANCE_DASHBOARD] ${upsertStatus} key=${runKey} simRows=${row.simulation.totalRows ?? "N/A"} live=${row.live.available}`
  );
  return upsertStatus;
};

const syncGuardActionLog = async ({ notionToken, runKey, statusRaw }) => {
  const enabled = boolFromEnv("NOTION_GUARD_ACTION_LOG_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_GUARD_ACTION_LOG_SYNC_REQUIRED", false);
  const databaseId = env("NOTION_DB_GUARD_ACTION_LOG");
  if (!enabled) {
    console.log(`[NOTION_GUARD_ACTION_LOG] skip: disabled_by_env key=${runKey}`);
    return "skipped_disabled";
  }
  if (!databaseId) {
    const message = `[NOTION_GUARD_ACTION_LOG] skip: missing NOTION_DB_GUARD_ACTION_LOG key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_db";
  }

  const rows = buildGuardActionRows(runKey);
  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Name";
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const properties = {
      [titlePropertyName]: titleProp(row.title)
    };
    const levelLabel = row.level == null ? "N/A" : `L${row.level}`;
    setPropertyAliases(properties, schema, ["Run Key"], {
      rich_text: () => textProp(row.runKey)
    });
    setPropertyAliases(properties, schema, ["Time", "Date"], {
      date: () => dateTimeProp(row.time),
      rich_text: () => textProp(row.time)
    });
    setPropertyAliases(properties, schema, ["Level", "Guard Level"], {
      number: () => numberProp(row.level),
      rich_text: () => textProp(row.level ?? "N/A"),
      select: () => selectProp(levelLabel)
    });
    setPropertyAliases(properties, schema, ["Action"], {
      select: () => selectProp(row.action),
      rich_text: () => textProp(row.action)
    });
    setPropertyAliases(properties, schema, ["Symbol"], {
      rich_text: () => textProp(row.symbol)
    });
    setPropertyAliases(properties, schema, ["Result"], {
      select: () => selectProp(row.result),
      rich_text: () => textProp(row.result)
    });
    setPropertyAliases(properties, schema, ["Reason"], {
      rich_text: () => textProp(row.reason)
    });
    setPropertyAliases(properties, schema, ["OrderId", "Order ID"], {
      rich_text: () => textProp(row.orderId)
    });
    setPropertyAliases(properties, schema, ["Raw Status"], {
      select: () => selectProp(row.rawStatus),
      rich_text: () => textProp(row.rawStatus)
    });
    setPropertyAliases(properties, schema, ["Engine"], {
      select: () => selectProp(row.engine),
      rich_text: () => textProp(row.engine)
    });
    setPropertyAliases(properties, schema, ["Source"], {
      select: () => selectProp(row.source),
      rich_text: () => textProp(row.source)
    });
    setPropertyAliases(properties, schema, ["Status"], {
      select: () => selectProp(statusRaw),
      rich_text: () => textProp(statusRaw)
    });

    const upsertStatus = await upsertPage(notionToken, databaseId, titlePropertyName, row.title, properties);
    if (upsertStatus === "created") created += 1;
    if (upsertStatus === "updated") updated += 1;
  }

  console.log(
    `[NOTION_GUARD_ACTION_LOG] synced key=${runKey} rows=${rows.length} created=${created} updated=${updated}`
  );
  return `ok(rows=${rows.length})`;
};

const syncHfTuningTracker = async ({ notionToken, runKey, statusRaw }) => {
  const enabled = boolFromEnv("NOTION_HF_TUNING_TRACKER_SYNC_ENABLED", true);
  const required = boolFromEnv("NOTION_HF_TUNING_TRACKER_SYNC_REQUIRED", false);
  const databaseId = env("NOTION_DB_HF_TUNING_TRACKER");
  if (!enabled) {
    console.log(`[NOTION_HF_TUNING_TRACKER] skip: disabled_by_env key=${runKey}`);
    return "skipped_disabled";
  }
  if (!databaseId) {
    const message = `[NOTION_HF_TUNING_TRACKER] skip: missing NOTION_DB_HF_TUNING_TRACKER key=${runKey}`;
    if (required) throw new Error(message);
    console.log(message);
    return "skipped_missing_db";
  }

  const row = buildHfTuningTrackerRow(runKey, statusRaw);
  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Name";

  const properties = {
    [titlePropertyName]: titleProp(row.title)
  };
  setPropertyAliases(properties, schema, ["Run Key"], {
    rich_text: () => textProp(row.runKey)
  });
  setPropertyAliases(properties, schema, ["Time", "Date"], {
    date: () => dateTimeProp(row.time),
    rich_text: () => textProp(row.time)
  });
  setPropertyAliases(properties, schema, ["Gate Progress"], {
    rich_text: () => textProp(row.gateProgress)
  });
  setPropertyAliases(properties, schema, ["Perf Gate"], {
    select: () => selectProp(row.perfGate),
    rich_text: () => textProp(row.perfGate)
  });
  setPropertyAliases(properties, schema, ["Freeze Status"], {
    select: () => selectProp(row.freezeStatus),
    rich_text: () => textProp(row.freezeStatus)
  });
  setPropertyAliases(properties, schema, ["Live Promotion"], {
    select: () => selectProp(row.livePromotion),
    rich_text: () => textProp(row.livePromotion)
  });
  setPropertyAliases(properties, schema, ["Payload Probe"], {
    select: () => selectProp(row.payloadProbe),
    rich_text: () => textProp(row.payloadProbe)
  });
  setPropertyAliases(properties, schema, ["Alert", "Alert (Select)"], {
    select: () => selectProp(row.alertStatus),
    checkbox: () => checkboxProp(row.alertStatus === "TRIGGERED"),
    rich_text: () => textProp(row.alertDetail)
  });
  setPropertyAliases(properties, schema, ["Decision"], {
    select: () => selectProp(row.decisionStatus),
    rich_text: () => textProp(row.decisionText)
  });
  setPropertyAliases(properties, schema, ["Decision (Text)"], {
    rich_text: () => textProp(row.decisionText)
  });
  setPropertyAliases(properties, schema, ["Engine"], {
    select: () => selectProp(row.engine),
    rich_text: () => textProp(row.engine)
  });
  setPropertyAliases(properties, schema, ["Source"], {
    select: () => selectProp(row.source),
    rich_text: () => textProp(row.source)
  });
  setPropertyAliases(properties, schema, ["Stage6 File"], {
    rich_text: () => textProp(row.stage6File)
  });
  setPropertyAliases(properties, schema, ["Stage6 Hash"], {
    rich_text: () => textProp(row.stage6Hash)
  });
  setPropertyAliases(properties, schema, ["Status"], {
    select: () => selectProp(statusRaw),
    rich_text: () => textProp(statusRaw)
  });

  const upsertStatus = await upsertPage(notionToken, databaseId, titlePropertyName, row.title, properties);
  console.log(
    `[NOTION_HF_TUNING_TRACKER] ${upsertStatus} key=${runKey} perfGate=${row.perfGate} decision=${row.decisionStatus}`
  );
  return upsertStatus;
};

const kindConfig = {
  dry_run: {
    enabledVar: "NOTION_SIDECAR_SYNC_ENABLED",
    requiredVar: "NOTION_SIDECAR_SYNC_REQUIRED",
    runKeyPrefix: "sidecar-dryrun",
    payloadBuilder: buildDryRunPayload
  },
  market_guard: {
    enabledVar: "NOTION_MARKET_GUARD_SYNC_ENABLED",
    requiredVar: "NOTION_MARKET_GUARD_SYNC_REQUIRED",
    runKeyPrefix: "sidecar-guard",
    payloadBuilder: buildMarketGuardPayload
  }
};

const runSecondarySync = async (label, requiredVarName, runner) => {
  try {
    return await runner();
  } catch (error) {
    const required = boolFromEnv(requiredVarName, false);
    const message = `[${label}] failed: ${error?.message || error}`;
    if (required) {
      throw new Error(message);
    }
    console.log(`::warning::${message}`);
    return "failed_non_blocking";
  }
};

const main = async () => {
  const kind = env("NOTION_SYNC_KIND", "dry_run").toLowerCase();
  const config = kindConfig[kind];
  if (!config) {
    throw new Error(`unsupported NOTION_SYNC_KIND: ${kind}`);
  }

  if (!boolFromEnv(config.enabledVar, true)) {
    console.log(`[NOTION_SIDECAR_SYNC] skip: disabled_by_env kind=${kind}`);
    return;
  }

  const notionToken = env("NOTION_TOKEN");
  const dbDaily = env("NOTION_DB_DAILY_SNAPSHOT");
  const required = boolFromEnv(config.requiredVar, false);
  if (!notionToken || !dbDaily) {
    const message = `[NOTION_SIDECAR_SYNC] skip: missing NOTION_TOKEN or NOTION_DB_DAILY_SNAPSHOT kind=${kind}`;
    if (required) throw new Error(message);
    console.log(message);
    return;
  }

  const runId = env("GITHUB_RUN_ID", "local");
  const runAttempt = env("GITHUB_RUN_ATTEMPT", "1");
  const runKey = `${config.runKeyPrefix}-${runId}-${runAttempt}`;
  const statusRaw = env("GHA_JOB_STATUS", "success").toLowerCase();
  const status = statusRaw === "success" ? "Success" : "Partial";
  const payload = config.payloadBuilder();

  const db = await notionRequest(notionToken, `/v1/databases/${dbDaily}`, { method: "GET" });
  const schema = db?.properties || {};
  const titlePropertyName = findTitlePropertyName(schema) || "Run Date";

  const properties = {
    [titlePropertyName]: titleProp(runKey)
  };

  setProperty(properties, schema, "Date", {
    date: () => dateProp(payload.date || new Date().toISOString()),
    rich_text: () => textProp(toDateOnly(payload.date || new Date().toISOString()))
  });
  setProperty(properties, schema, "Status", {
    select: () => selectProp(status),
    rich_text: () => textProp(status)
  });
  setProperty(properties, schema, "Summary", {
    rich_text: () => textProp(payload.summary)
  });
  setProperty(properties, schema, "Top Tickers", {
    rich_text: () => textProp(payload.topTickers)
  });
  setProperty(properties, schema, "Engine", {
    rich_text: () => textProp(payload.engine),
    select: () => selectProp(payload.engine)
  });
  setProperty(properties, schema, "Source", {
    rich_text: () => textProp(payload.source),
    select: () => selectProp(payload.source)
  });
  setProperty(properties, schema, "VIX Level", {
    number: () => numberProp(payload.vixLevel),
    rich_text: () => textProp(payload.vixLevel ?? "N/A")
  });
  setProperty(properties, schema, "Market Condition", {
    select: () => selectProp(payload.marketCondition),
    rich_text: () => textProp(payload.marketCondition)
  });
  setProperty(properties, schema, "Stage 6 Count", {
    number: () => numberProp(payload.stage6Count),
    rich_text: () => textProp(payload.stage6Count ?? "N/A")
  });
  setProperty(properties, schema, "Final Picks Count", {
    number: () => numberProp(payload.finalPicksCount),
    rich_text: () => textProp(payload.finalPicksCount ?? "N/A")
  });
  setProperty(properties, schema, "Stage6 File", {
    rich_text: () => textProp(payload.stage6File ?? "N/A")
  });
  setProperty(properties, schema, "Stage6 Hash", {
    rich_text: () => textProp(payload.stage6HashShort ?? "N/A")
  });
  setProperty(properties, schema, "Payload Count", {
    number: () => numberProp(payload.payloadCount),
    rich_text: () => textProp(payload.payloadCount ?? "N/A")
  });
  setProperty(properties, schema, "Skipped Count", {
    number: () => numberProp(payload.skippedCount),
    rich_text: () => textProp(payload.skippedCount ?? "N/A")
  });
  setProperty(properties, schema, "Guard Level", {
    number: () => numberProp(payload.guardLevel),
    rich_text: () => textProp(payload.guardLevel ?? "N/A")
  });
  setProperty(properties, schema, "HF Gate", {
    select: () => selectProp(payload.hfGateStatus ?? "N/A"),
    rich_text: () => textProp(payload.hfGateStatus ?? "N/A")
  });
  setProperty(properties, schema, "HF Live Promotion", {
    select: () => selectProp(payload.hfLivePromotion ?? "N/A"),
    rich_text: () => textProp(payload.hfLivePromotion ?? "N/A")
  });
  setProperty(properties, schema, "Action Reason", {
    rich_text: () => textProp(payload.actionReason ?? "N/A")
  });
  setProperty(properties, schema, "Run Actions", {
    rich_text: () => textProp(payload.runActions ?? "N/A")
  });

  const upsertStatus = await upsertPage(notionToken, dbDaily, titlePropertyName, runKey, properties);
  console.log(
    `[NOTION_SIDECAR_SYNC] ${upsertStatus} kind=${kind} key=${runKey} status=${statusRaw} engine=${payload.engine}`
  );

  if (kind === "dry_run") {
    await runSecondarySync("NOTION_HF_TUNING_TRACKER", "NOTION_HF_TUNING_TRACKER_SYNC_REQUIRED", () =>
      syncHfTuningTracker({ notionToken, runKey, statusRaw })
    );
  }
  if (kind === "market_guard") {
    await runSecondarySync("NOTION_GUARD_ACTION_LOG", "NOTION_GUARD_ACTION_LOG_SYNC_REQUIRED", () =>
      syncGuardActionLog({ notionToken, runKey, statusRaw })
    );
  }
  await runSecondarySync("NOTION_PERFORMANCE_DASHBOARD", "NOTION_PERFORMANCE_DASHBOARD_SYNC_REQUIRED", () =>
    syncPerformanceDashboard({ notionToken, kind, runKey, statusRaw })
  );
  await runSecondarySync("NOTION_AUTOMATION_INCIDENT_LOG", "NOTION_AUTOMATION_INCIDENT_LOG_SYNC_REQUIRED", () =>
    syncAutomationIncidentLog({ notionToken, kind, runKey, statusRaw })
  );
  await runSecondarySync("NOTION_KEY_ROTATION_LEDGER", "NOTION_KEY_ROTATION_LEDGER_SYNC_REQUIRED", () =>
    syncKeyRotationLedger({ notionToken, kind, runKey })
  );
};

main().catch((error) => {
  console.error(`[NOTION_SIDECAR_SYNC] failed: ${error?.message || error}`);
  process.exit(1);
});
