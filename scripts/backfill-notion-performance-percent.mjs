import fs from "node:fs";

const NOTION_VERSION = "2022-06-28";
const REPORT_PATH = "state/notion-performance-percent-backfill-report.json";

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();

const boolFromEnv = (name, fallback = false) => {
  const raw = env(name);
  if (!raw) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const toInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const toNonNegativeInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
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
    throw new Error(`Notion ${path} failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
};

const numberFormatFromDef = (def) => {
  if (!def || def.type !== "number") return "";
  const format = def?.number?.format ?? def?.number_format ?? "";
  return String(format || "").toLowerCase();
};

const getPageNumber = (page, propertyName) => {
  const prop = page?.properties?.[propertyName];
  if (!prop || prop.type !== "number") return null;
  const value = Number(prop.number);
  return Number.isFinite(value) ? value : null;
};

const roundPercentStoredValue = (storedValue, displayDigits) => {
  const storedDigits = Math.max(0, displayDigits + 2);
  return Number(storedValue.toFixed(storedDigits));
};

const main = async () => {
  const notionToken = env("NOTION_TOKEN");
  const databaseId = env("NOTION_DB_PERFORMANCE_DASHBOARD");
  const dryRun = boolFromEnv("NOTION_PERF_PERCENT_BACKFILL_DRY_RUN", true);
  const roundAll = boolFromEnv("NOTION_PERF_PERCENT_BACKFILL_ROUND_ALL", false);
  const pageSize = toInt(env("NOTION_PERF_PERCENT_BACKFILL_PAGE_SIZE"), 100);
  const maxPages = toInt(env("NOTION_PERF_PERCENT_BACKFILL_MAX_PAGES"), 50);
  const threshold = Number(env("NOTION_PERF_PERCENT_BACKFILL_THRESHOLD", "1"));
  const displayDigits = toNonNegativeInt(env("NOTION_PERF_PERCENT_BACKFILL_DISPLAY_DIGITS"), 2);

  if (!notionToken || !databaseId) {
    throw new Error("missing NOTION_TOKEN or NOTION_DB_PERFORMANCE_DASHBOARD");
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("NOTION_PERF_PERCENT_BACKFILL_THRESHOLD must be a positive number");
  }

  const db = await notionRequest(notionToken, `/v1/databases/${databaseId}`, { method: "GET" });
  const schema = db?.properties || {};
  const percentProps = Object.entries(schema)
    .filter(([, def]) => def?.type === "number" && numberFormatFromDef(def) === "percent")
    .map(([name]) => name);

  if (!percentProps.length) {
    console.log("[NOTION_PERF_BACKFILL] skip: no percent-number properties in schema");
    return;
  }

  console.log(
    `[NOTION_PERF_BACKFILL] start dryRun=${dryRun} threshold=${threshold} displayDigits=${displayDigits} roundAll=${roundAll} percentProps=${percentProps.join(",")}`
  );

  let nextCursor = null;
  let hasMore = true;
  let pageCount = 0;
  let scannedRows = 0;
  let candidateRows = 0;
  let updatedRows = 0;

  const samples = [];

  while (hasMore && pageCount < maxPages) {
    const query = {
      page_size: pageSize
    };
    if (nextCursor) query.start_cursor = nextCursor;

    const result = await notionRequest(notionToken, `/v1/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(query)
    });

    const rows = Array.isArray(result?.results) ? result.results : [];
    scannedRows += rows.length;
    pageCount += 1;

    for (const row of rows) {
      const properties = {};
      let changed = false;
      const changes = [];

      for (const propName of percentProps) {
        const current = getPageNumber(row, propName);
        if (current == null) continue;
        const shouldScale = Math.abs(current) > threshold;
        if (!shouldScale && !roundAll) continue;
        const scaled = shouldScale ? current / 100 : current;
        const corrected = roundPercentStoredValue(scaled, displayDigits);
        if (!Number.isFinite(corrected) || corrected === current) continue;
        properties[propName] = { number: corrected };
        changes.push({
          property: propName,
          before: current,
          after: corrected,
          reason: shouldScale ? "scale_and_round" : "round_only"
        });
        changed = true;
      }

      if (!changed) continue;
      candidateRows += 1;

      if (samples.length < 20) {
        samples.push({
          pageId: row.id,
          runKey: row?.properties?.["Run Key"]?.title?.[0]?.plain_text || "unknown",
          changes
        });
      }

      if (!dryRun) {
        await notionRequest(notionToken, `/v1/pages/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ properties })
        });
        updatedRows += 1;
      }
    }

    hasMore = Boolean(result?.has_more);
    nextCursor = result?.next_cursor || null;
  }

  const report = {
    at: new Date().toISOString(),
    dryRun,
    databaseId,
    percentProps,
    threshold,
    scannedRows,
    candidateRows,
    updatedRows,
    pageCount,
    maxPages,
    samples
  };

  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `[NOTION_PERF_BACKFILL] done dryRun=${dryRun} scanned=${scannedRows} candidates=${candidateRows} updated=${updatedRows} report=${REPORT_PATH}`
  );
};

main().catch((error) => {
  console.error(`[NOTION_PERF_BACKFILL] failed: ${error?.message || error}`);
  process.exit(1);
});