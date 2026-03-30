import fs from "node:fs";

const NOTION_VERSION = "2022-06-28";

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();

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
    throw new Error(`Notion ${path} failed (${response.status}): ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
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

const dateProp = (value) => ({
  date: { start: toDateOnly(value) }
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
};

main().catch((error) => {
  console.error(`[NOTION_SIDECAR_SYNC] failed: ${error?.message || error}`);
  process.exit(1);
});
